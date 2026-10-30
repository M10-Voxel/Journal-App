import type { Entry, LinkedEntry, Plan, PlanVia } from './journal';
import { shiftDate } from './dates.ts';

/** `end` (optional) closes a time span that starts at `time`. */
export interface Schedule { time: string | null; end?: string | null; reminder: boolean }
type PlanChange = Partial<Pick<Entry, 'time' | 'end' | 'reminder' | 'plan'>>;

export const canPlan = (entry: Entry) => entry.kind !== 'note' && !entry.plan;
export const isTrace = (entry: Entry) => Boolean(entry.plan);
/** Notes have no time, reminder or planning, so only an entry without them can become one. */
export const canBeNote = (entry: Entry) => !entry.time && !entry.end && !entry.reminder && !entry.plan;

/**
 * The change that planning an entry living on `day` to `dates` produces.
 * Staying on the same day only sets time and reminder; any other date turns the entry into a trace
 * whose targets are created on those days when the day is saved. Several dates are the basis for "Mehrere Tage".
 */
export function planChange(day: string, dates: readonly string[], schedule: Schedule, via: PlanVia = dates.length > 1 ? 'days' : 'date', newId: () => string = () => crypto.randomUUID()): PlanChange {
  const targets = [...new Set(dates)].filter(date => date !== day).sort();
  const end = schedule.time ? schedule.end ?? null : null;
  if (targets.length === 0) return { time: schedule.time, end, reminder: schedule.reminder };
  const plan: Plan = { via: targets.length > 1 ? 'days' : via === 'days' ? 'date' : via, targets: targets.map(date => ({ date, id: newId() })), time: schedule.time, end, reminder: schedule.reminder };
  return { plan };
}
export const tomorrowChange = (entry: Entry, day: string, newId?: () => string) =>
  planChange(day, [shiftDate(day, 1)], { time: entry.time ?? null, end: entry.end ?? null, reminder: entry.reminder ?? false }, 'tomorrow', newId);

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const timeOfMinutes = (value: number) => formatTime(Math.floor(value / 60), value % 60);
/** The end that keeps an entry's duration when it starts at `time` instead; none if it would pass midnight. */
export function keepDuration(entry: Pick<Entry, 'time' | 'end'>, time: string | null): string | null {
  if (!time || !entry.time || !entry.end) return null;
  const end = minutes(time) + minutes(entry.end) - minutes(entry.time);
  return end < 24 * 60 ? timeOfMinutes(end) : null;
}
/** "09:00", or "09:00–10:30" for a span. */
export const formatSpan = (time: string | null | undefined, end?: string | null) => time ? end ? `${time}–${end}` : time : '';

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

/** Removing, finishing or cancelling an entry that belongs to a linked group may reach more of it. */
export type ScopeAction = 'remove' | 'done' | 'cancelled';
export type Scope = 'this' | 'following' | 'all';
export interface ScopeOption { scope: Scope; others: Pick<LinkedEntry, 'id' | 'date'>[] }
/**
 * The choices an action on `id` offers within its linked group (in date order): only this entry, also the following
 * ones, and – when removing or cancelling – all of them, the earlier ones included. Only choices that reach more than
 * the one before are offered; a single choice means there is nothing to ask. Removing reaches traces too; finishing and
 * cancelling only tasks that are not traces and not in that state already.
 */
export function linkedScopes(group: readonly LinkedEntry[], id: string, action: ScopeAction): ScopeOption[] {
  const index = group.findIndex(item => item.id === id);
  if (index < 0) return [{ scope: 'this', others: [] }];
  const reached = (item: LinkedEntry) => item.id !== id && (action === 'remove' || (item.kind === 'task' && !item.trace && !(action === 'done' ? item.done : item.cancelled)));
  const pick = (items: readonly LinkedEntry[]) => items.filter(reached).map(({ id, date }) => ({ id, date }));
  const following = pick(group.slice(index + 1)), earlier = pick(group.slice(0, index));
  const options: ScopeOption[] = [{ scope: 'this', others: [] }];
  if (following.length) options.push({ scope: 'following', others: following });
  if (action !== 'done' && earlier.length) options.push({ scope: 'all', others: [...earlier, ...following] });
  return options;
}
