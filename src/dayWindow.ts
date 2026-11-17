// The "Tage" view: a band of whole weeks side by side. A window of 1–5 consecutive days is open (hours, entries with
// text), every other day of the band is folded to a narrow strip that still shows when it is busy. See docs/days-view.md.
import { shiftDate } from './dates.ts';

export const maxOpenDays = 5;
export const defaultOpenDays = 3;
/** Width of a folded day (px) and the least an open day should get. */
export const foldedWidth = 8;
export const openMinWidth = 72;
/** In a narrow panel open days may shrink to this, so that at least two weeks are shown. */
export const openTightWidth = 44;

export const clampOpenDays = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? Math.max(1, Math.min(maxOpenDays, Math.round(value))) : defaultOpenDays;
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);

/** The open dates: `size` days from `start`. */
export const windowDates = (start: string, size: number) => Array.from({ length: size }, (_, index) => shiftDate(start, index));

/**
 * Opening a range: from the window to `date` (either way), at most `maxOpenDays` long; when longer, it ends at `date`.
 * Used for Shift+click and for dragging over the day heads.
 */
export function spanTo(start: string, size: number, date: string): { start: string; size: number } {
  const end = shiftDate(start, size - 1);
  if (date >= start && date <= end) return { start, size };
  if (date > end) { const from = daysBetween(start, date) + 1 > maxOpenDays ? shiftDate(date, -(maxOpenDays - 1)) : start; return { start: from, size: daysBetween(from, date) + 1 }; }
  const to = daysBetween(date, end) + 1 > maxOpenDays ? shiftDate(date, maxOpenDays - 1) : end;
  return { start: date, size: daysBetween(date, to) + 1 };
}
/** The range between two dates (drawn over the day heads), cut to `maxOpenDays` from `anchor`. */
export function rangeOf(anchor: string, date: string): { start: string; size: number } {
  if (date >= anchor) { const to = daysBetween(anchor, date) + 1 > maxOpenDays ? shiftDate(anchor, maxOpenDays - 1) : date; return { start: anchor, size: daysBetween(anchor, to) + 1 }; }
  const from = daysBetween(date, anchor) + 1 > maxOpenDays ? shiftDate(anchor, -(maxOpenDays - 1)) : date;
  return { start: from, size: daysBetween(from, anchor) + 1 };
}

/**
 * How many whole weeks fit: folded days get `foldedWidth`, open ones at least `openMinWidth` – or, so that a narrow panel
 * still shows two weeks, at least `openTightWidth`.
 */
export function bandWeeks(width: number, size: number): number {
  const open = (weeks: number) => (width - (weeks * 7 - size) * foldedWidth) / size;
  let weeks = 1;
  while (weeks < 6 && open(weeks + 1) >= openMinWidth) weeks++;
  return weeks < 2 && open(2) >= openTightWidth ? 2 : weeks;
}

/**
 * The open days' width (px) in a viewport `width` wide: what is left when `bandWeeks` weeks are shown, the others folded.
 * The band itself is longer than the viewport and scrolls sideways.
 */
export function openWidth(width: number, size: number): number {
  const shown = bandWeeks(width, size) * 7;
  return Math.max(openTightWidth, (width - (shown - size) * foldedWidth) / size);
}

/** Days kept around the open ones on both sides; the band grows when scrolled near its ends. */
export const bandBuffer = 42;
/** The band's dates: the stored range, widened to hold the open days and `bandBuffer` days around them. Never narrowed. */
export function bandRange(stored: { from: string; to: string } | null, start: string, size: number): { from: string; to: string } {
  const from = shiftDate(start, -bandBuffer), to = shiftDate(start, size - 1 + bandBuffer);
  if (!stored) return { from, to };
  return { from: stored.from < from ? stored.from : from, to: stored.to > to ? stored.to : to };
}
export const datesBetween = (from: string, to: string) => Array.from({ length: daysBetween(from, to) + 1 }, (_, index) => shiftDate(from, index));

/** Where the band is scrolled (px) so that the open days sit in the middle of a viewport `width` wide. */
export function centeredScroll(dates: readonly string[], start: string, size: number, width: number): number {
  const before = Math.max(0, dates.indexOf(start));
  return Math.max(0, before * foldedWidth + size * openWidth(width, size) / 2 - width / 2);
}

/** Column widths (px) for the band. */
export function bandColumns(dates: readonly string[], open: ReadonlySet<string>, width: number, size: number): number[] {
  const share = openWidth(width, size);
  return dates.map(date => open.has(date) ? share : foldedWidth);
}
