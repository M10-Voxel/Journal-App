import type { ActivityRecord } from './periodData';

/** Journal Keys' seven shades and 30 minute boundaries. */
export function activityPalette(color: string): string[] {
  const base = [1, 3, 5].map(offset => parseInt(color.slice(offset, offset + 2), 16));
  return [.64, .43, .21, 0, -.16, -.32, -.48].map(amount => `#${base.map(channel => Math.round(amount >= 0 ? channel + (255 - channel) * amount : channel * (1 + amount)).toString(16).padStart(2, '0')).join('')}`);
}
export function activityLevel(record: ActivityRecord | undefined, trackTime: boolean): number {
  const minutes = Number.isFinite(record?.minutes) ? Math.max(0, record!.minutes!) : 0;
  if (!record?.done && minutes <= 0) return 0;
  return trackTime ? Math.min(7, Math.floor(minutes / 30) + 1) : 1;
}
export const activityLevelLabel = (index: number) => index === 6 ? '180+ min' : `${index * 30}–${index * 30 + 29} min`;
