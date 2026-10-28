import { invoke } from '@tauri-apps/api/core';

export type EntryKind = 'task' | 'event' | 'note';
export interface Entry { id: string; kind: EntryKind; text: string; done: boolean; cancelled: boolean }
export interface Day { date: string; title: string; body: string; revision: number; entries: Entry[] }

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
    return saved;
  },
};

const longFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const noon = (date: string) => { const [year, month, day] = date.split('-').map(Number); return new Date(year, month - 1, day, 12); };

export function localDate(date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
export function shiftDate(date: string, amount: number): string {
  const value = noon(date);
  value.setDate(value.getDate() + amount);
  return localDate(value);
}
export function formatDate(date: string): string { return longFormat.format(noon(date)); }
export function formatWeekday(date: string): string { return weekdayFormat.format(noon(date)).slice(0, 2); }
export function weekDates(date: string): string[] {
  const monday = shiftDate(date, -((noon(date).getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}
