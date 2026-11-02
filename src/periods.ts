import { localDate, shiftDate, weekDates } from './dates.ts';
export type PeriodMode = 'day' | 'week' | 'month' | 'quarter' | 'year';
export function periodBounds(date: string, mode: PeriodMode): [string, string] {
  if (mode === 'day') return [date, date];
  if (mode === 'week') { const days = weekDates(date); return [days[0], days[6]]; }
  const [year, month] = date.split('-').map(Number);
  const start = mode === 'year' ? 0 : mode === 'quarter' ? Math.floor((month - 1) / 3) * 3 : month - 1;
  const count = mode === 'year' ? 12 : mode === 'quarter' ? 3 : 1;
  return [localDate(new Date(year, start, 1, 12)), localDate(new Date(year, start + count, 0, 12))];
}
export function periodDates(start: string, end: string): string[] {
  const result: string[] = [];
  for (let date = start; date <= end; date = shiftDate(date, 1)) result.push(date);
  return result;
}
export function ratingBuckets(dates: string[], ratings: Record<string, number | undefined>, monthly: boolean) {
  const groups = new Map<string, string[]>();
  for (const date of dates) { const key = monthly ? date.slice(0, 7) : date; groups.set(key, [...(groups.get(key) ?? []), date]); }
  return [...groups].map(([key, days]) => {
    const values = days.flatMap(day => ratings[day] == null ? [] : [ratings[day]!]);
    return { key, count: values.length, value: values.length ? values.reduce((a,b) => a+b, 0) / values.length : null };
  });
}
