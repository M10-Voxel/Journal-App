export interface ActivityDefinition { id: string; name: string; color: string; trackTime: boolean; textField: boolean; active: boolean; calendarTagId?: string }
export interface ActivityRecord { done: boolean; minutes?: number; text?: string }
export interface PeriodDay { rating?: number; items: Record<string, ActivityRecord> }
/** `calendarTime`: the days' minutes hold only typed time; the timer's time lives in the calendar (see activityCalendar.ts). */
export interface PeriodData { definitions: ActivityDefinition[]; days: Record<string, PeriodDay>; notes: Record<string, string>; calendarTime?: boolean }
export const emptyPeriodData = (): PeriodData => ({ definitions: [], days: {}, notes: {} });
export function moveActivity(definitions: ActivityDefinition[], id: string, target: string) {
  const from = definitions.findIndex(item => item.id === id), to = definitions.findIndex(item => item.id === target);
  if (from < 0 || to < 0) return definitions;
  const next = [...definitions]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
export function normalizePeriodData(raw: Partial<PeriodData>): PeriodData {
  return { definitions: (raw.definitions ?? []).map(item => ({ ...item, color: /^#[\da-f]{6}$/i.test(item.color ?? '') ? item.color : '#569eff', trackTime: item.trackTime !== false, textField: item.textField !== false, active: item.active !== false })), days: raw.days ?? {}, notes: raw.notes ?? {}, ...(raw.calendarTime ? { calendarTime: true } : {}) };
}
/** Minutes recorded before checkbox support was fixed also belong in the totals. */
export function activitySummary(dates: string[], days: Record<string, PeriodDay>, id: string) {
  const records = dates.map(date => ({ date, record: days[date]?.items?.[id] }));
  const minutes = records.reduce((sum, { record }) => sum + (Number.isFinite(record?.minutes) ? Math.max(0, record!.minutes!) : 0), 0);
  const activeDays = records.filter(({ record }) => record?.done || (record?.minutes ?? 0) > 0).length;
  return { records, minutes, activeDays };
}
