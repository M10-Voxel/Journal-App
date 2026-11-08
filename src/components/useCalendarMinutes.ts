import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { activityMinutesById } from '../activityCalendar';
import type { CalendarMinutes } from '../activityCalendar';
import { loadActivityMinutes } from '../journal';
import { createRefreshQueue } from '../refreshQueue';
import type { ActivityDefinition } from '../periodData';

/** The activities' calendar time between `from` and `to`, reloaded whenever a day in that range changes anywhere
 *  (the calendar, the journal, the timer's import). */
export function useCalendarMinutes(from: string, to: string, definitions: readonly ActivityDefinition[] | undefined): CalendarMinutes {
  const [days, setDays] = useState<{ key: string; minutes: CalendarMinutes }>({ key: '', minutes: {} });
  const tags = JSON.stringify([...new Set(definitions?.flatMap(item => item.calendarTagId ? [item.calendarTagId] : []) ?? [])].sort());
  // Keep the already displayed totals while a new activity tag is loading; filter removed tags by definitions below.
  const key = `${from}:${to}`;
  useEffect(() => {
    const selected: string[] = JSON.parse(tags);
    if (!selected.length) return;
    const refresh = createRefreshQueue(() => loadActivityMinutes(from, to, selected), minutes => setDays({ key, minutes }), () => {});
    void refresh.request();
    const stop = listen<string[]>('journal:changed', event => { if (event.payload.some(date => date >= from && date <= to)) void refresh.request(); });
    const restored = listen('history:restored', () => { void refresh.request(); });
    return () => { refresh.dispose(); void stop.then(unlisten => unlisten()); void restored.then(unlisten => unlisten()); };
  }, [from, to, tags]);
  return days.key === key && definitions ? activityMinutesById(days.minutes, definitions) : {};
}
