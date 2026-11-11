import type { CalendarView } from './calendar';
import type { EntryKind } from './journal';

export type CalendarKinds = Record<EntryKind, boolean>;
export interface CalendarLocation { view: CalendarView; date: string }
export interface CalendarPreferences { view: CalendarView; kinds: CalendarKinds; date: string | null; followToday: boolean }
export const calendarPreferencesKey = 'journal.calendar';
export const calendarWidgetPreferencesKey = (id: string) => `${calendarPreferencesKey}.widget-${id}`;
const views: CalendarView[] = ['year', 'month', 'week', 'workweek', 'day'];
export function parseCalendarPreferences(raw: string | null): CalendarPreferences {
  let value: Partial<CalendarPreferences> = {};
  try { const parsed = JSON.parse(raw ?? '{}'); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) value = parsed; } catch { /* use defaults */ }
  const kinds: CalendarKinds = {event: true, task: true, note: false};
  for (const kind of ['event', 'task', 'note'] as const) if (typeof value.kinds?.[kind] === 'boolean') kinds[kind] = value.kinds[kind];
  const date = typeof value.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && !Number.isNaN(Date.parse(`${value.date}T12:00:00`)) && new Date(`${value.date}T12:00:00`).getDate() === Number(value.date.slice(8)) ? value.date : null;
  return {view: views.includes(value.view!) ? value.view! : 'month', kinds, date, followToday: typeof value.followToday === 'boolean' ? value.followToday : true};
}
export function loadCalendarPreferences(key = calendarPreferencesKey): CalendarPreferences {
  try { return parseCalendarPreferences(localStorage.getItem(key) ?? (key === calendarPreferencesKey ? null : localStorage.getItem(calendarPreferencesKey))); }
  catch { return parseCalendarPreferences(null); }
}
export const calendarInitialDate = (prefs: CalendarPreferences, today: string) => prefs.followToday ? today : prefs.date ?? today;
export function copyWidgetPreferences(source: string, target: string) {
  try {
    const marker = `journal.widget-initialized.${target}`;
    if (localStorage.getItem(marker) !== null) return;
    const calendar = localStorage.getItem(calendarWidgetPreferencesKey(source));
    if (calendar !== null) localStorage.setItem(calendarWidgetPreferencesKey(target), calendar);
    const filters = JSON.parse(localStorage.getItem('journal.hiddenTags') ?? '{}');
    if (filters && typeof filters === 'object' && Array.isArray(filters[`widget-${source}`])) localStorage.setItem('journal.hiddenTags', JSON.stringify({...filters,[`widget-${target}`]:filters[`widget-${source}`]}));
    localStorage.setItem(marker, '1');
  } catch { /* positions and content remain usable if browser storage is unavailable */ }
}
