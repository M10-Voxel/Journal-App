import type { Entry, Plan, PlanVia } from './journal';
import { shiftDate } from './dates.ts';

export interface Schedule { time: string | null; reminder: boolean }
type PlanChange = Partial<Pick<Entry, 'time' | 'reminder' | 'plan'>>;

export const canPlan = (entry: Entry) => entry.kind !== 'note' && !entry.plan;
export const isTrace = (entry: Entry) => Boolean(entry.plan);

/**
 * The change that planning an entry living on `day` to `dates` produces.
 * Staying on the same day only sets time and reminder; any other date turns the entry into a trace
 * whose targets are created on those days when the day is saved. Several dates are the basis for "Mehrere Tage".
 */
export function planChange(day: string, dates: readonly string[], schedule: Schedule, via: PlanVia = dates.length > 1 ? 'days' : 'date', newId: () => string = () => crypto.randomUUID()): PlanChange {
  const targets = [...new Set(dates)].filter(date => date !== day).sort();
  if (targets.length === 0) return { time: schedule.time, reminder: schedule.reminder };
  const plan: Plan = { via: targets.length > 1 ? 'days' : via === 'days' ? 'date' : via, targets: targets.map(date => ({ date, id: newId() })), time: schedule.time, reminder: schedule.reminder };
  return { plan };
}
export const tomorrowChange = (entry: Entry, day: string, newId?: () => string) =>
  planChange(day, [shiftDate(day, 1)], { time: entry.time ?? null, reminder: entry.reminder ?? false }, 'tomorrow', newId);

export function isValidTime(time: string | null | undefined): boolean {
  return time == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

export type ClockMode = 'hour' | 'minute';
export const formatTime = (hour: number, minute: number) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
export function parseTime(time: string): { hour: number; minute: number } {
  const [hour, minute] = time.split(':').map(Number);
  return { hour: hour || 0, minute: minute || 0 };
}
/** The next full hour after `now`, as a sensible starting point for the clock. */
export const nextFullHour = (now = new Date()) => formatTime((now.getHours() + 1) % 24, 0);
/** Clockwise degrees from 12 o'clock for the hand: hours on a 12-hour face, minutes on a 60-minute face. */
export const clockAngle = (mode: ClockMode, hour: number, minute: number) => mode === 'hour' ? (hour % 12) * 30 : minute * 6;
/**
 * The time under a pointer at (`dx`, `dy`) from the face's centre. Hours: closer than `innerRadius` selects the
 * inner ring (13–00), otherwise the outer ring (1–12). Minutes snap to five.
 */
export function clockValue(mode: ClockMode, dx: number, dy: number, innerRadius: number, current: { hour: number; minute: number }): string {
  const degrees = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
  const slot = Math.round(degrees / 30) % 12;
  if (mode === 'minute') return formatTime(current.hour, slot * 5);
  const inner = Math.hypot(dx, dy) < innerRadius;
  return formatTime(inner ? (slot === 0 ? 0 : slot + 12) : (slot === 0 ? 12 : slot), current.minute);
}
/** Moves the hour (wrapping within the day) or the minutes (carrying into the hour) by `step`. */
export function stepTime(time: string, mode: ClockMode, step: number): string {
  const { hour, minute } = parseTime(time);
  if (mode === 'hour') return formatTime((hour + step + 24) % 24, minute);
  const total = (hour * 60 + minute + step + 1440) % 1440;
  return formatTime(Math.floor(total / 60), total % 60);
}

export interface ClockTyping { time: string; mode: ClockMode; pending: number | null }
/**
 * Typing a digit on the clock. A digit that cannot start a two-digit value (hours 3–9, minutes 6–9) is taken at once;
 * otherwise it waits for a second digit, which is only used if the result still fits. Hours then continue with minutes,
 * and a second hour digit that does not fit (e.g. 2 then 5) becomes the first minute digit instead.
 */
export function typeDigit({ time, mode, pending }: ClockTyping, digit: number): ClockTyping {
  const { hour, minute } = parseTime(time);
  if (mode === 'hour') {
    if (pending === null) return digit * 10 > 23 ? { time: formatTime(digit, minute), mode: 'minute', pending: null } : { time: formatTime(digit, minute), mode: 'hour', pending: digit };
    const value = pending * 10 + digit;
    if (value <= 23) return { time: formatTime(value, minute), mode: 'minute', pending: null };
    return typeDigit({ time, mode: 'minute', pending: null }, digit);
  }
  if (pending === null) return { time: formatTime(hour, digit), mode, pending: digit * 10 > 59 ? null : digit };
  return { time: formatTime(hour, pending * 10 + digit), mode, pending: null };
}

/** Every date from `a` to `b` (inclusive, in either order). */
export function datesBetween(a: string, b: string): string[] {
  const [from, to] = [a, b].sort();
  const dates: string[] = [];
  for (let value = from; value <= to; value = shiftDate(value, 1)) dates.push(value);
  return dates;
}
/**
 * The days picked for "Mehrere Tage": the range between two left-clicked days, with right-clicked days flipped
 * (taken out inside the range, added outside it). The entry's own day is never a target.
 */
export function pickedDays(range: { from: string; to: string } | null, toggled: readonly string[], day: string): string[] {
  const inRange = new Set(range ? datesBetween(range.from, range.to) : []);
  for (const date of toggled) if (inRange.has(date)) inRange.delete(date); else inRange.add(date);
  inRange.delete(day);
  return [...inRange].sort();
}
