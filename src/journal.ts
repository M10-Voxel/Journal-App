import { invoke } from '@tauri-apps/api/core';

export type EntryKind = 'task' | 'event' | 'note';
export type PlanVia = 'tomorrow' | 'date' | 'days';
/** One planned occurrence: the date and the ID of the entry that saving creates there. */
export interface PlanTarget { date: string; id: string }
/** Set on the original entry once it was planned away; it then stays behind as a trace. */
export interface Plan { via: PlanVia; targets: PlanTarget[]; time: string | null; end?: string | null; reminder: boolean }
export interface Entry {
  id: string; kind: EntryKind; text: string; done: boolean; cancelled: boolean; priority: boolean;
  /** Optional `HH:MM` on the entry's own day. */
  time?: string | null;
  /** Optional end `HH:MM` on the same day, after `time` (entries marked as a range in the calendar). */
  end?: string | null;
  /** The user wants to be reminded. Stored only; notifications are not implemented yet. */
  reminder?: boolean;
  plan?: Plan | null;
  /** Date of the trace this entry was planned from (read-only, derived by the backend). */
  origin?: string | null;
}
export interface Day {
  date: string; title: string; body: string; revision: number; entries: Entry[];
  /** Other days a save changed: planned entries created there, edits passed on to linked entries. */
  touched?: string[];
}

/** A day as the calendar windows show it: only days with a title or entries, traces left out. */
export interface CalendarDay { date: string; title: string; entries: Entry[] }

// Persisted state per date. This window is the only writer, so a cached day stays valid until it is saved here.
const cache = new Map<string, Promise<Day>>();
const settled = new Map<string, Day>();

function fetchDay(date: string): Promise<Day> {
  let request = cache.get(date);
  if (!request) {
    request = invoke<Day>('load_day', { date });
    cache.set(date, request);
    request.then(day => { if (cache.get(date) === request) settled.set(date, day); }, () => { if (cache.get(date) === request) cache.delete(date); });
  }
  return request;
}

export const journal = {
  load: fetchDay,
  cached: (date: string): Day | undefined => settled.get(date),
  prefetch(dates: readonly string[]) { for (const date of dates) fetchDay(date).catch(() => {}); },
  /** The stored group an entry belongs to (itself included); empty while it is not saved yet. */
  linked: (id: string) => invoke<LinkedEntry[]>('load_linked', { id }),
  /** Removes entries or sets task states on other days; their cached state is dropped. */
  async changeLinked(changes: { id: string; action: LinkedAction }[]): Promise<string[]> {
    const touched = await invoke<string[]>('change_linked', { changes });
    for (const date of touched) { cache.delete(date); settled.delete(date); }
    return touched;
  },
  async save(day: Day): Promise<Day> {
    const saved = await invoke<Day>('save_day', { day });
    cache.set(saved.date, Promise.resolve(saved));
    settled.set(saved.date, saved);
    // Planned entries are created and edits passed on to linked entries on other days, so their cached state is outdated.
    for (const date of saved.touched ?? []) if (date !== saved.date) { cache.delete(date); settled.delete(date); }
    return saved;
  },
};

/** An entry of a linked group (trace, copies, chains), in date order; see `journal.linked`. */
export interface LinkedEntry { id: string; date: string; kind: EntryKind; done: boolean; cancelled: boolean; trace: boolean }
export type LinkedAction = 'remove' | 'done' | 'cancelled' | 'open';

/** The calendar windows only read; they hear about saves through the `journal:changed` event. */
export const loadRange = (from: string, to: string) => invoke<CalendarDay[]>('load_range', { from, to });

export { formatDate, formatShortDate, formatWeekday, localDate, shiftDate, weekDates } from './dates';
