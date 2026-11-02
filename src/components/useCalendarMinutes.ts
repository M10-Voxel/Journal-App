import { listen } from '@tauri-apps/api/event';
import { useEffect, useState } from 'react';
import { calendarMinutes } from '../activityCalendar';
import type { CalendarMinutes } from '../activityCalendar';
import { loadRange } from '../journal';
import type { CalendarDay } from '../journal';
import type { ActivityDefinition } from '../periodData';

/** The activities' calendar time between `from` and `to`, reloaded whenever a day in that range changes anywhere
 *  (the calendar, the journal, the timer's import). */
export function useCalendarMinutes(from: string, to: string, definitions: readonly ActivityDefinition[] | undefined): CalendarMinutes {
  const [days, setDays] = useState<{ key: string; list: CalendarDay[] }>({ key: '', list: [] });
  const key = `${from}:${to}`;
  useEffect(() => {
    let active = true;
    const fetch = () => loadRange(from, to).then(list => { if (active) setDays({ key, list }); }, () => {});
    void fetch();
    const stop = listen<string[]>('journal:changed', event => { if (event.payload.some(date => date >= from && date <= to)) void fetch(); });
    return () => { active = false; void stop.then(unlisten => unlisten()); };
  }, [from, to]);
  return days.key === key && definitions ? calendarMinutes(days.list, definitions) : {};
}
