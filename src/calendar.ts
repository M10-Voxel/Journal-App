import type { Entry } from './journal';
import { monthGrid, shiftDate, shiftMonth, weekDates } from './dates.ts';

// The calendar window's views, after Apple's and Samsung's calendars (year, month, week, day) and TaskNotes' work week.
export type CalendarView = 'year' | 'month' | 'week' | 'workweek' | 'day';
/** `short` is shown when the calendar is narrow (a slim sidebar). */
export const calendarViews: { view: CalendarView; label: string; short: string; key: string }[] = [
  { view: 'year', label: 'Jahr', short: 'Jahr', key: 'J' }, { view: 'month', label: 'Monat', short: 'Monat', key: 'M' }, { view: 'week', label: 'Woche', short: 'Woche', key: 'W' },
  { view: 'workweek', label: 'Arbeitswoche', short: 'Mo–Fr', key: 'A' }, { view: 'day', label: 'Tag', short: 'Tag', key: 'T' },
];

const noon = (date: string) => { const [year, month, day] = date.split('-').map(Number); return new Date(year, month - 1, day, 12); };
const daysInMonth = (month: string) => { const [year, value] = month.split('-').map(Number); return new Date(year, value, 0).getDate(); };
/** The same day `amount` months later, or the month's last day if it is shorter (31.01. + 1 → 28./29.02.). */
export function shiftMonthKeepingDay(date: string, amount: number): string {
  const month = shiftMonth(date.slice(0, 7), amount);
  return `${month}-${String(Math.min(Number(date.slice(8)), daysInMonth(month))).padStart(2, '0')}`;
}

/** The dates a view shows as columns (week views and the day) or, for month and year, every date it needs data for. */
export function viewDates(view: CalendarView, date: string): string[] {
  if (view === 'day') return [date];
  if (view === 'week') return weekDates(date);
  if (view === 'workweek') return weekDates(date).slice(0, 5);
  if (view === 'month') return monthGrid(date.slice(0, 7));
  const dates: string[] = [];
  for (let value = `${date.slice(0, 4)}-01-01`; value.startsWith(date.slice(0, 4)); value = shiftDate(value, 1)) dates.push(value);
  return dates;
}
/** The dates to load for a view. The day view also shows its month next to the hours. */
export function viewRange(view: CalendarView, date: string): { from: string; to: string } {
  const dates = viewDates(view === 'day' ? 'month' : view, date);
  return { from: dates[0], to: dates[dates.length - 1] };
}
/** One step back or forth: a year, a month, a week or a day. */
export function shiftView(view: CalendarView, date: string, step: number): string {
  if (view === 'year') return shiftMonthKeepingDay(date, step * 12);
  if (view === 'month') return shiftMonthKeepingDay(date, step);
  return shiftDate(date, step * (view === 'day' ? 1 : 7));
}

/** ISO 8601 week number (weeks start on Monday; week 1 holds the year's first Thursday). */
export function isoWeek(date: string): number {
  const thursday = noon(shiftDate(weekDates(date)[0], 3));
  const firstThursday = noon(shiftDate(weekDates(`${thursday.getFullYear()}-01-04`)[0], 3));
  return Math.round((thursday.getTime() - firstThursday.getTime()) / 604800000) + 1;
}

const monthName = new Intl.DateTimeFormat('de-DE', { month: 'long' });
const shortMonth = new Intl.DateTimeFormat('de-DE', { month: 'short' });
const dayTitle = new Intl.DateTimeFormat('de-DE', { day: 'numeric', month: 'long' });
const weekdayLong = new Intl.DateTimeFormat('de-DE', { weekday: 'long' });
export const formatMonthName = (date: string) => monthName.format(noon(date));
export const formatWeekdayLong = (date: string) => weekdayLong.format(noon(date));
/** The title like Apple's: the bold part ("Oktober", "30. Oktober") and the quiet part ("2026", "KW 44 · 2026"). */
export function viewTitle(view: CalendarView, date: string): { main: string; sub: string } {
  const year = date.slice(0, 4);
  if (view === 'year') return { main: year, sub: '' };
  if (view === 'month') return { main: formatMonthName(date), sub: year };
  if (view === 'day') return { main: dayTitle.format(noon(date)), sub: `${formatWeekdayLong(date)} · ${year}` };
  const dates = viewDates(view, date);
  const [first, last] = [dates[0], dates[dates.length - 1]];
  const main = first.slice(0, 7) === last.slice(0, 7) ? formatMonthName(first) : `${shortMonth.format(noon(first))} – ${shortMonth.format(noon(last))}`;
  return { main, sub: `KW ${isoWeek(date)} · ${last.slice(0, 4)}` };
}

export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** Entries with a start but no end take an hour in the time grid. */
export const slotMinutes = 60;
/** Ranges marked in the time grid snap to quarter hours. */
export const snapMinutes = 15;
/** How long an entry lasts in the time grid: up to its end, or `slotMinutes` (at most until midnight). */
export const durationOf = (item: { time: string; end?: string | null }) =>
  item.end ? minutesOf(item.end) - minutesOf(item.time) : Math.min(slotMinutes, 24 * 60 - minutesOf(item.time));

/** A marked range in minutes: from `anchor`'s quarter hour to `current`'s (in either direction), at least one quarter. */
export function snapRange(anchor: number, current: number): { start: number; end: number } {
  const clamp = (value: number) => Math.min(24 * 60 - snapMinutes, Math.max(0, value));
  const from = clamp(Math.floor(anchor / snapMinutes) * snapMinutes);
  const to = clamp(Math.floor(current / snapMinutes) * snapMinutes);
  return { start: Math.min(from, to), end: Math.max(from, to) + snapMinutes };
}
/** "1 h 30", "45 min", "2 h". */
export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? rest ? `${hours} h ${rest}` : `${hours} h` : `${rest} min`;
}

/** How an entry sorts within a day: without time first (like all-day events), then by time; priority and events first. */
export function orderForCalendar(entries: readonly Entry[]): Entry[] {
  const kindRank = { event: 0, task: 1, note: 2 };
  return [...entries].sort((a, b) => (a.time ? 1 : 0) - (b.time ? 1 : 0) || (a.time ?? '').localeCompare(b.time ?? '')
    || Number(b.priority) - Number(a.priority) || kindRank[a.kind] - kindRank[b.kind]);
}

/**
 * Columns for timed entries that overlap (each lasting `durationOf`): entries that overlap directly or through others
 * form a group that shares the width; each takes the first free column.
 */
export function layoutTimed<T extends { id: string; time: string; end?: string | null }>(items: readonly T[]): { item: T; start: number; duration: number; column: number; columns: number }[] {
  const sorted = [...items].sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || durationOf(b) - durationOf(a) || a.id.localeCompare(b.id));
  const placed: { item: T; start: number; duration: number; column: number; columns: number }[] = [];
  let group: typeof placed = [];
  let groupEnd = -1;
  const close = () => { const columns = Math.max(0, ...group.map(entry => entry.column)) + 1; for (const entry of group) entry.columns = columns; group = []; };
  for (const item of sorted) {
    const start = minutesOf(item.time), duration = durationOf(item);
    if (start >= groupEnd) close();
    const ends: number[] = [];
    for (const other of group) if (other.start + other.duration > start) ends[other.column] = 1;
    let column = 0;
    while (ends[column]) column++;
    const entry = { item, start, duration, column, columns: 1 };
    group.push(entry);
    placed.push(entry);
    groupEnd = Math.max(groupEnd, start + duration);
  }
  close();
  return placed;
}
