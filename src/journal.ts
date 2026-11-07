import { invoke } from '@tauri-apps/api/core';
import { localDate, shiftDate } from './dates.ts';
import { lastOccurrence, occurrences, seriesHorizon } from './repeat.ts';
import type { RepeatRule } from './repeat.ts';

export type EntryKind = 'task' | 'event' | 'note';
export type PlanVia = 'tomorrow' | 'date' | 'days';
/** One planned occurrence: the date and the ID of the entry that saving creates there. */
export interface PlanTarget { date: string; id: string }
/** Set on the original entry once it was planned away; it then stays behind as a trace. A single target may start a series. */
export interface Plan { via: PlanVia; targets: PlanTarget[]; time: string | null; end?: string | null; reminder: boolean; repeat?: Repeat | null }
/**
 * Membership in a repeating series. Every occurrence is an entry of its own, linked with the others like planned copies.
 * Saving an entry with a series not stored yet starts it there (`dates` become occurrences); with `rule: null` the entry
 * leaves its series instead. Leaving ends the series on that day: its open later occurrences go. Without `repeat`,
 * an entry stays in its series.
 */
export interface Repeat { series: string; rule: RepeatRule | null; horizon: string; dates?: string[] }
export interface Entry {
  id: string; kind: EntryKind; text: string; done: boolean; cancelled: boolean; priority: boolean;
  /** Additional calendar details, separate from the title. */
  description?: string;
  /** The tag's ID (see tags.ts); passed on to planned copies and occurrences like the text. */
  tag?: string | null;
  /** Optional `HH:MM` on the entry's own day. */
  time?: string | null;
  /** Optional end `HH:MM` on the same day, after `time` (entries marked as a range in the calendar). */
  end?: string | null;
  /** The user wants to be reminded. Stored only; notifications are not implemented yet. */
  reminder?: boolean;
  /** Hidden entries remain stored and visible in the calendar. Defaults to true. */
  showInJournal?: boolean;
  /** Stable iCalendar identity for repeat imports. */
  calendarUid?: string | null;
  plan?: Plan | null;
  /** Date of the trace this entry was planned from (read-only, derived by the backend). */
  origin?: string | null;
  repeat?: Repeat | null;
}
export interface Day {
  date: string; title: string; body: string; revision: number; entries: Entry[];
  /** Other days a save changed: planned entries created there, edits passed on to linked entries. */
  touched?: string[];
  /** Entries whose edits in this save stay with them instead of reaching their linked entries ("only this one"). */
  keepAlone?: string[];
}

/** A day as the calendar windows show it: only days with a title or entries, traces left out. */
export interface CalendarDay { date: string; title: string; hasJournal?: boolean; entries: Entry[] }
export interface CalendarImport { date: string; entry: Entry; tag?: {id:string;name:string;color:string} }
/** A due reminder (see reminders.rs): an open task or event with the bell, at its time (without one at 9:00). */
export interface Reminder { id: string; date: string; kind: 'task' | 'event' | 'info'; text: string; time: string | null; end: string | null; due: string; late: boolean; snoozed: boolean }

// Persisted state per date. This window is the only writer, so a cached day stays valid until it is saved here.
const cache = new Map<string, Promise<Day>>();
const settled = new Map<string, Day>();

const maxCachedDays = 32;
function cacheDay(date: string, request: Promise<Day>) {
  cache.delete(date); cache.set(date, request);
  while (cache.size > maxCachedDays) {
    const oldest = cache.keys().next().value!;
    cache.delete(oldest); settled.delete(oldest);
  }
}

function fetchDay(date: string): Promise<Day> {
  let request = cache.get(date);
  if (!request) {
    request = ensureSeries(date).then(() => invoke<Day>('load_day', { date }));
    cacheDay(date, request);
    request.then(day => { if (cache.get(date) === request) settled.set(date, day); }, () => { if (cache.get(date) === request) cache.delete(date); });
  }
  cache.delete(date); cache.set(date, request);
  return request;
}

export const journal = {
  exportCalendar: () => invoke<CalendarDay[]>('export_calendar'),
  async importCalendar(entries: CalendarImport[]): Promise<string[]> {
    const touched = await invoke<string[]>('import_calendar', { entries });
    for (const date of touched) { cache.delete(date); settled.delete(date); }
    return touched;
  },
  load: fetchDay,
  invalidate() { cache.clear(); settled.clear(); },
  cached: (date: string): Day | undefined => settled.get(date),
  async moveCalendarEntry(id: string, from: string, to: string, time: string | null, end: string | null): Promise<string[]> {
    const touched = await invoke<string[]>('move_calendar_entry', { id, from, to, time, end });
    for (const date of touched) { cache.delete(date); settled.delete(date); }
    return touched;
  },
  prefetch(dates: readonly string[]) { for (const date of dates) fetchDay(date).catch(() => {}); },
  /** Shows a reminder again ten minutes from now. */
  snoozeReminder: (reminder: Pick<Reminder, 'id' | 'due'>) => invoke<void>('snooze_reminder', { id: reminder.id, due: reminder.due }),
  /** The stored group an entry belongs to (itself included); empty while it is not saved yet. */
  linked: (id: string) => invoke<LinkedEntry[]>('load_linked', { id }),
  /** Removes entries or sets task states on other days; their cached state is dropped. */
  async changeLinked(changes: { id: string; action: LinkedAction }[]): Promise<string[]> {
    const touched = await invoke<string[]>('change_linked', { changes });
    for (const date of touched) { cache.delete(date); settled.delete(date); }
    return touched;
  },
  /** Gives chosen entries of a group on other days the kind, text, details and (when moved) times of an edited one. */
  async editLinked(ids: string[], edit: LinkedEdit): Promise<string[]> {
    const touched = await invoke<string[]>('edit_linked', { ids, edit });
    for (const date of touched) { cache.delete(date); settled.delete(date); }
    return touched;
  },
  async save(day: Day): Promise<Day> {
    const saved = await invoke<Day>('save_day', { day });
    cacheDay(saved.date, Promise.resolve(saved));
    settled.set(saved.date, saved);
    // Planned entries are created and edits passed on to linked entries on other days, so their cached state is outdated.
    for (const date of saved.touched ?? []) if (date !== saved.date) { cache.delete(date); settled.delete(date); }
    return saved;
  },
};

/** An entry of a linked group (trace, copies, chains, occurrences of a series), in date order; see `journal.linked`. */
export interface LinkedEntry { id: string; date: string; kind: EntryKind; done: boolean; cancelled: boolean; trace: boolean; series?: string | null }
export interface LinkedEdit {
  kind: EntryKind; text: string; description: string; tag: string | null; priority: boolean; reminder: boolean; showInJournal: boolean;
  times?: { time: string | null; end: string | null };
}
export type LinkedAction = 'remove' | 'done' | 'cancelled' | 'open';

/** The calendar windows only read; they hear about saves through the `journal:changed` event. */
export const loadRange = (from: string, to: string) => ensureSeries(to).then(() => invoke<CalendarDay[]>('load_range', { from, to }));

// Series have occurrences up to their horizon. Before a day beyond it is shown, the series are extended to the end of
// that year (at least to the default horizon, at most ten years ahead). Every window does so once per year it reaches;
// the store skips a series another window has extended already.
let ensured = '';
let ensuring: Promise<void> = Promise.resolve();
function ensureSeries(date: string): Promise<void> {
  const today = localDate(), limit = `${Number(today.slice(0, 4)) + 10}-12-31`;
  const wanted = seriesHorizon(today, date > limit ? limit : date);
  if (wanted <= ensured) return ensuring;
  ensured = wanted;
  ensuring = ensuring.then(async () => {
    const series = await invoke<{ series: string; rule: RepeatRule; horizon: string }[]>('load_series');
    const extensions = series.filter(item => item.horizon < wanted && (lastOccurrence(item.rule) ?? '9999-12-31') > item.horizon)
      .map(item => ({ series: item.series, from: item.horizon, to: wanted, dates: occurrences(item.rule, shiftDate(item.horizon, 1), wanted) }));
    if (!extensions.length) return;
    const touched = await invoke<string[]>('extend_series', { extensions });
    for (const date of touched) { cache.delete(date); settled.delete(date); }
  }).catch(() => { ensured = ''; });
  return ensuring;
}

export { formatDate, formatShortDate, formatWeekday, localDate, shiftDate, weekDates } from './dates.ts';
export type { RepeatRule } from './repeat.ts';
