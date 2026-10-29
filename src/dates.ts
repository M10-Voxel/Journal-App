// Calendar dates are local `YYYY-MM-DD` strings; noon avoids DST edge cases when doing arithmetic.
const longFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const shortFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit' });
const weekdayFormat = new Intl.DateTimeFormat('de-DE', { weekday: 'short' });
const monthFormat = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });
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
export function shiftMonth(month: string, amount: number): string {
  const [year, value] = month.split('-').map(Number);
  return localDate(new Date(year, value - 1 + amount, 1, 12)).slice(0, 7);
}
export function formatDate(date: string): string { return longFormat.format(noon(date)); }
/** "Do., 30.10." */
export function formatShortDate(date: string): string { return shortFormat.format(noon(date)); }
export function formatWeekday(date: string): string { return weekdayFormat.format(noon(date)).slice(0, 2); }
export function formatMonth(month: string): string { return monthFormat.format(noon(`${month}-01`)); }
export function weekDates(date: string): string[] {
  const monday = shiftDate(date, -((noon(date).getDay() + 6) % 7));
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}
/** Six Monday-first weeks covering the month (`YYYY-MM`), padded with days of the neighbouring months. */
export function monthGrid(month: string): string[] {
  const first = weekDates(`${month}-01`)[0];
  return Array.from({ length: 42 }, (_, index) => shiftDate(first, index));
}
