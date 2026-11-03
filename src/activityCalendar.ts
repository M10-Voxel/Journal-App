import type { CalendarDay, Entry } from './journal.ts';
import type { ActivityDefinition, PeriodData } from './periodData.ts';
import type { Tag } from './tags.ts';

// An activity's time comes from two places: minutes typed into the checklist (stored with the day) and calendar
// entries carrying the activity's tag (the timer creates those, but any entry with the tag counts). The calendar part
// is never stored in the period data, so moving or changing such an entry changes the time everywhere.

const clockMinutes = (time: string) => Number(time.split(':')[0]) * 60 + Number(time.split(':')[1]);
/** Length of a timed range on its day; entries without an end or cancelled tasks take no time. */
export function entryMinutes(entry: Pick<Entry, 'time' | 'end' | 'cancelled'>): number {
  if (!entry.time || !entry.end || entry.cancelled) return 0;
  return Math.max(0, clockMinutes(entry.end) - clockMinutes(entry.time));
}
export type CalendarMinutes = Record<string, Record<string, number>>;
/** Minutes per date and activity ID from the calendar entries tagged with an activity's tag. */
export function calendarMinutes(days: readonly CalendarDay[], definitions: readonly ActivityDefinition[]): CalendarMinutes {
  const byTag = new Map(definitions.filter(item => item.calendarTagId).map(item => [item.calendarTagId!, item.id]));
  const result: CalendarMinutes = {};
  for (const day of days) for (const entry of day.entries) {
    const id = entry.tag ? byTag.get(entry.tag) : undefined, minutes = id ? entryMinutes(entry) : 0;
    if (!id || !minutes) continue;
    const date = result[day.date] ??= {};
    date[id] = (date[id] ?? 0) + minutes;
  }
  return result;
}
/** The period data as shown: each day's minutes are the typed ones plus those from the calendar. */
export function withCalendarMinutes(data: PeriodData, minutes: CalendarMinutes): PeriodData {
  const days = { ...data.days };
  for (const [date, items] of Object.entries(minutes)) {
    const day = days[date] ?? { items: {} };
    const merged = { ...day.items };
    for (const [id, extra] of Object.entries(items)) merged[id] = { ...merged[id], done: merged[id]?.done ?? false, minutes: (merged[id]?.minutes ?? 0) + extra };
    days[date] = { ...day, items: merged };
  }
  return { ...data, days };
}

const maxTagName = 40;
/** Tags for activities without one: an existing tag of the same name that no other activity uses, or a new one in the
 *  activity's colour. A remembered tag that was deleted comes back under its ID, so its calendar entries stay linked. */
export function activityTags(tags: readonly Tag[], definitions: readonly ActivityDefinition[], newId: () => string): { tags: Tag[]; definitions: ActivityDefinition[] } {
  const next = [...tags], used = new Set(definitions.map(item => item.calendarTagId).filter(Boolean));
  const named = (name: string) => next.find(tag => tag.name.toLowerCase() === name.toLowerCase());
  const updated = definitions.map(item => {
    if (item.calendarTagId && next.some(tag => tag.id === item.calendarTagId)) return item;
    const base = (item.name.trim() || 'Aktivität').slice(0, maxTagName - 5);
    const existing = !item.calendarTagId ? named(base) : undefined;
    if (existing && !used.has(existing.id)) { used.add(existing.id); return { ...item, calendarTagId: existing.id }; }
    let name = base, suffix = 1;
    while (named(name)) name = `${base} (${++suffix})`;
    const tag = { id: item.calendarTagId ?? newId(), name, color: item.color };
    next.push(tag); used.add(tag.id);
    return { ...item, calendarTagId: tag.id };
  });
  return { tags: next, definitions: updated };
}
