import { invoke } from '@tauri-apps/api/core';

export type EntryKind = 'task' | 'event' | 'note';
export type PlanVia = 'tomorrow' | 'date' | 'days';
/** One planned occurrence: the date and the ID of the entry that saving creates there. */
export interface PlanTarget { date: string; id: string }
/** Set on the original entry once it was planned away; it then stays behind as a trace. */
export interface Plan { via: PlanVia; targets: PlanTarget[]; time: string | null; reminder: boolean }
export interface Entry {
  id: string; kind: EntryKind; text: string; done: boolean; cancelled: boolean; priority: boolean;
  /** Optional `HH:MM` on the entry's own day. */
  time?: string | null;
  /** The user wants to be reminded. Stored only; notifications are not implemented yet. */
  reminder?: boolean;
  plan?: Plan | null;
  /** Date of the trace this entry was planned from (read-only, derived by the backend). */
  origin?: string | null;
}
export interface Day {
  date: string; title: string; body: string; revision: number; entries: Entry[];
  /** Other days a save changed: planned entries created there, linked entries removed. */
  touched?: string[];
}

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
  async save(day: Day): Promise<Day> {
    const saved = await invoke<Day>('save_day', { day });
    cache.set(saved.date, Promise.resolve(saved));
    settled.set(saved.date, saved);
    // Planned entries are created and linked entries removed on other days, so their cached state is outdated.
    for (const date of saved.touched ?? []) if (date !== saved.date) { cache.delete(date); settled.delete(date); }
    return saved;
  },
};

export { formatDate, formatShortDate, formatWeekday, localDate, shiftDate, weekDates } from './dates';
