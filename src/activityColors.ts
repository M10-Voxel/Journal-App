import type { ActivityRecord } from './periodData';

/** Journal Keys' seven shades and 30 minute boundaries. */
export function activityPalette(color: string): string[] {
  const base = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return [.64, .43, .21, 0, -.16, -.32, -.48].map(amount => `#${base.map(channel => Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount)).toString(16).padStart(2, '0')).join('')}`);
}
/** The minutes the seven shades run over: the first starts at `min`, the last at `max` (six equal steps between). */
export interface ActivityRange { min: number; max: number }
export const defaultRange: ActivityRange = { min: 0, max: 180 };
export const maxRangeMinutes = 1440;
/** Whole minutes in 0–1440, `max` at least six minutes above `min` (one per step); anything else falls back to the default. */
export function activityRange(source?: { minMinutes?: number; maxMinutes?: number }): ActivityRange {
  const whole = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(maxRangeMinutes, Math.max(0, Math.round(value))) : fallback;
  const min = whole(source?.minMinutes, defaultRange.min), max = whole(source?.maxMinutes, defaultRange.max);
  return max >= min + 6 ? { min, max } : defaultRange;
}
/** 0: nothing done; 1–7: the shade for the minutes (below `min` still the first, from `max` on the last). */
export function activityLevel(record: ActivityRecord | undefined, trackTime: boolean, range: ActivityRange = defaultRange): number {
  const minutes = Number.isFinite(record?.minutes) ? Math.max(0, record!.minutes!) : 0;
  if (!record?.done && minutes <= 0) return 0;
  return trackTime ? Math.max(1, Math.min(7, Math.floor((minutes - range.min) / ((range.max - range.min) / 6)) + 1)) : 1;
}
/** The minutes shade `index` (0–6) stands for. */
export function activityLevelLabel(index: number, range: ActivityRange = defaultRange): string {
  const step = (range.max - range.min) / 6, from = (level: number) => Math.round(range.min + level * step);
  if (index >= 6) return `${range.max}+ min`;
  return `${index === 0 && range.min > 0 ? '0' : from(index)}–${from(index + 1) - 1} min`;
}
