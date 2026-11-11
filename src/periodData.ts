import { activityRange } from './activityColors.ts';
export interface ActivityDefinition { id: string; name: string; color: string; trackTime: boolean; textField: boolean; active: boolean; calendarTagId?: string;
  /** The minutes the graph's seven shades run over (default 0 and 180, see activityColors.ts). */
  minMinutes?: number; maxMinutes?: number }
export interface ActivityRecord { done: boolean; minutes?: number; text?: string }
/** A day value of the user's own ("Tageswert", e.g. stress or sleep): a whole number between `min` and `max`. */
export interface ScaleDefinition { id: string; name: string; color: string; min: number; max: number; active: boolean }
/** The daily rating's look and span (default: the accent colour, 0 to 10). */
export interface RatingScale { color: string; min: number; max: number }
/** `scales`: the day values by the scale's id (an object, so syncing merges them one by one, see sync/merge.ts). */
export interface PeriodDay { rating?: number; scales?: Record<string, number>; items: Record<string, ActivityRecord> }
/** `calendarTime`: the days' minutes hold only typed time; the timer's time lives in the calendar (see activityCalendar.ts). */
export interface PeriodData { definitions: ActivityDefinition[]; days: Record<string, PeriodDay>; notes: Record<string, string>; calendarTime?: boolean;
  scales?: ScaleDefinition[]; rating?: RatingScale }
export const defaultRatingColor = '#569eff';
export const defaultScaleRange = { min: 0, max: 10 } as const;
/** Spans: whole numbers, `min` below `max`, at most this far apart (a click per step must stay possible). */
export const maxScaleSpan = 1000;
const validColor = (value: unknown, fallback: string) => typeof value === 'string' && /^#[\da-f]{6}$/i.test(value) ? value : fallback;
/** A span made valid: whole numbers, min < max; without a valid one the default 0–10. */
export function scaleRange(item: { min?: unknown; max?: unknown } | undefined): { min: number; max: number } {
  const min = Math.round(Number(item?.min)), max = Math.round(Number(item?.max));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max || max - min > maxScaleSpan || Math.abs(min) > 100000 || Math.abs(max) > 100000) return { ...defaultScaleRange };
  return { min, max };
}
/** A value as shown: kept as stored, but clamped into the span (values from an older span stay stored). */
export const clampToScale = (value: number, range: { min: number; max: number }) => Math.max(range.min, Math.min(range.max, value));
export const ratingScale = (data: Pick<PeriodData, 'rating'> | null | undefined): RatingScale => ({ color: validColor(data?.rating?.color, defaultRatingColor), ...scaleRange(data?.rating ?? defaultScaleRange) });
export function moveScale(definitions: ScaleDefinition[], id: string, target: string) {
  const from = definitions.findIndex(item => item.id === id), to = definitions.findIndex(item => item.id === target);
  if (from < 0 || to < 0) return definitions;
  const next = [...definitions]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
export function moveActivity(definitions: ActivityDefinition[], id: string, target: string) {
  const from = definitions.findIndex(item => item.id === id), to = definitions.findIndex(item => item.id === target);
  if (from < 0 || to < 0) return definitions;
  const next = [...definitions]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
/** The shades' minutes only when they are a valid range (activityRange); otherwise the default applies. */
const rangeFields = (item: Partial<ActivityDefinition>): Pick<ActivityDefinition, 'minMinutes' | 'maxMinutes'> => {
  const { min, max } = activityRange(item);
  return item.minMinutes === undefined && item.maxMinutes === undefined ? {} : { minMinutes: min, maxMinutes: max };
};
export function normalizePeriodData(raw: Partial<PeriodData>): PeriodData {
  const scales = Array.isArray(raw.scales) ? raw.scales.filter(item => item && typeof item.id === 'string' && item.id).map((item): ScaleDefinition => ({
    id: item.id, name: typeof item.name === 'string' ? item.name : '', color: validColor(item.color, defaultRatingColor), ...scaleRange(item), active: item.active !== false })) : [];
  // The rating is stored only once it differs from the default (an older vault keeps its data as it was).
  const rating = raw.rating && typeof raw.rating === 'object' ? ratingScale(raw) : undefined;
  return { definitions: (raw.definitions ?? []).map(item => ({ ...item, color: /^#[\da-f]{6}$/i.test(item.color ?? '') ? item.color : '#569eff', trackTime: item.trackTime !== false, textField: item.textField !== false, active: item.active !== false, ...rangeFields(item) })), days: raw.days ?? {}, notes: raw.notes ?? {}, ...(raw.calendarTime ? { calendarTime: true } : {}),
    ...(scales.length ? { scales } : {}), ...(rating ? { rating } : {}) };
}
/** What a chart line shows: the daily rating (`rating`) or a day value (the scale's id). */
export type SeriesKey = 'rating' | string;
/** The values of one line by date (missing days stay missing: the line breaks there); stored values clamped to the span. */
export function seriesOf(dates: readonly string[], days: Record<string, PeriodDay>, key: SeriesKey, range: { min: number; max: number }): Record<string, number | undefined> {
  const result: Record<string, number | undefined> = {};
  for (const date of dates) {
    const raw = key === 'rating' ? days[date]?.rating : days[date]?.scales?.[key];
    result[date] = typeof raw === 'number' && Number.isFinite(raw) ? clampToScale(raw, range) : undefined;
  }
  return result;
}
/** The chart's y axis: the union of the spans of every shown line (default 0–10 when none is shown). */
export function chartRange(ranges: readonly { min: number; max: number }[]): { min: number; max: number } {
  if (!ranges.length) return { ...defaultScaleRange };
  return { min: Math.min(...ranges.map(range => range.min)), max: Math.max(...ranges.map(range => range.max)) };
}
/** Minutes recorded before checkbox support was fixed also belong in the totals. */
export function activitySummary(dates: string[], days: Record<string, PeriodDay>, id: string) {
  const records = dates.map(date => ({ date, record: days[date]?.items?.[id] }));
  const minutes = records.reduce((sum, { record }) => sum + (Number.isFinite(record?.minutes) ? Math.max(0, record!.minutes!) : 0), 0);
  const activeDays = records.filter(({ record }) => record?.done || (record?.minutes ?? 0) > 0).length;
  return { records, minutes, activeDays };
}
/**
 * The cells of a day value's input (ScaleInput): one per step up to `maxCells`, else that many cells each standing for
 * a stretch of the span (a cell is lit once the value reaches its first value).
 */
export const maxCells = 24;
export function scaleCells(range: { min: number; max: number }): number[] {
  const steps = range.max - range.min + 1;
  if (steps <= maxCells) return Array.from({ length: steps }, (_, index) => range.min + index);
  return Array.from({ length: maxCells }, (_, index) => range.min + Math.round(index * (range.max - range.min) / (maxCells - 1)));
}
/** The value at a point along the input (`t` from 0 at its left to 1 at its right): the cell under it, or with many
 *  steps the nearest value. */
export function valueAt(t: number, range: { min: number; max: number }): number {
  const at = Math.max(0, Math.min(1, t)), steps = range.max - range.min + 1;
  if (steps <= maxCells) return range.min + Math.min(steps - 1, Math.floor(at * steps));
  return range.min + Math.round(at * (range.max - range.min));
}
/** Where a value sits along the input (0–1): a cell's middle, or its share of the span. */
export function positionOf(value: number, range: { min: number; max: number }): number {
  const steps = range.max - range.min + 1, clamped = clampToScale(value, range);
  return steps <= maxCells ? (clamped - range.min + .5) / steps : (clamped - range.min) / (range.max - range.min);
}
