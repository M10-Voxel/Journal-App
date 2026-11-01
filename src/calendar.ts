import { t, dateFormat } from './i18n.ts';
import type { Entry } from './journal';
import { monthGrid, shiftDate, shiftMonth, weekDates } from './dates.ts';

// The calendar window's views, after Apple's and Samsung's calendars (year, month, week, day) and TaskNotes' work week.
export type CalendarView = 'year' | 'month' | 'week' | 'workweek' | 'day';
/** `short` is shown when the calendar is narrow (a slim sidebar). */
export const calendarViews = (): { view: CalendarView; label: string; short: string; key: string }[] => ([
  { view: 'year', label: t("Jahr"), short: t("Jahr"), key: 'J' }, { view: 'month', label: t("Monat"), short: t("Monat"), key: 'M' }, { view: 'week', label: t("Woche"), short: t("Woche"), key: 'W' },
  { view: 'workweek', label: t("Arbeitswoche"), short: t("Mo–Fr"), key: 'A' }, { view: 'day', label: t("Tag"), short: t("Tag"), key: 'T' },
]);

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

const monthName = () => dateFormat({ month: 'long' });
const shortMonth = () => dateFormat({ month: 'short' });
const weekdayLong = () => dateFormat({ weekday: 'long' });
export const formatMonthName = (date: string) => monthName().format(noon(date));
export const formatWeekdayLong = (date: string) => weekdayLong().format(noon(date));
/** One-line calendar heading: what is shown, and – in the week views the week, in the day view the day – in grey after it. */
export function viewTitle(view: CalendarView, date: string): { main: string; sub: string } {
  const year = date.slice(0, 4);
  if (view === 'year') return { main: year, sub: '' };
  if (view === 'month') return { main: `${formatMonthName(date)} ${year}`, sub: '' };
  if (view === 'day') return { main: `${formatMonthName(date)} ${year}`, sub: `${formatWeekdayLong(date)}, ${Number(date.slice(8))}.` };
  const sub = t("KW {0}", isoWeek(date));
  const dates = viewDates(view, date);
  const [first, last] = [dates[0], dates[dates.length - 1]];
  const main = first.slice(0, 4) !== last.slice(0, 4)
    ? `${shortMonth().format(noon(first))} ${first.slice(0, 4)} – ${shortMonth().format(noon(last))} ${last.slice(0, 4)}`
    : `${first.slice(0, 7) === last.slice(0, 7) ? formatMonthName(first) : `${shortMonth().format(noon(first))} – ${shortMonth().format(noon(last))}`} ${year}`;
  return { main, sub };
}

/** The heading's short form for a narrow calendar: "Nov 2026", "Okt – Nov 2026". */
export const shortTitle = (main: string) => {
  const names=Array.from({length:12},(_,index)=>monthName().format(new Date(2000,index,15,12)));
  return main.replace(new RegExp(`(${names.join('|')})`, 'g'), month => shortMonth().format(noon(`2000-${String(names.indexOf(month) + 1).padStart(2, '0')}-15`)));
};

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
 * Timed entries share lanes within each overlapping group. Cards span two half-width steps, so the next lane
 * overlaps half of the previous card, leaving its left edge available to click. A lone card fills the day.
 */
export function layoutTimed<T extends { id: string; time: string; end?: string | null }>(items: readonly T[]): { item: T; start: number; duration: number; column: number; columns: number; left: number; width: number }[] {
  const sorted = [...items].sort((a, b) => minutesOf(a.time) - minutesOf(b.time) || durationOf(b) - durationOf(a) || a.id.localeCompare(b.id));
  const placed: { item: T; start: number; duration: number; column: number; columns: number; left: number; width: number }[] = [];
  let group: typeof placed = [];
  let groupEnd = -1;
  const close = () => {
    const columns = Math.max(0, ...group.map(entry => entry.column)) + 1;
    const step = 100 / (columns + 1);
    for (const entry of group) { entry.columns = columns; entry.left = entry.column * step; entry.width = 2 * step; }
    group = [];
  };
  for (const item of sorted) {
    const start = minutesOf(item.time), duration = durationOf(item);
    if (start >= groupEnd) close();
    const ends: number[] = [];
    for (const other of group) if (other.start + other.duration > start) ends[other.column] = 1;
    let column = 0;
    while (ends[column]) column++;
    const entry = { item, start, duration, column, columns: 1, left: 0, width: 100 };
    group.push(entry);
    placed.push(entry);
    groupEnd = Math.max(groupEnd, start + duration);
  }
  close();
  return placed;
}
