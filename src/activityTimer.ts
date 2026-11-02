import { localDate } from './dates.ts';
import type { CalendarImport } from './journal.ts';

export interface ActivityTimerState { id: string; startedAt: number | null; elapsedMs: number; segments: { start: number; end: number }[]; tagId: string }
export function elapsedTimer(timer: ActivityTimerState, now: number): number { return timer.elapsedMs + (timer.startedAt == null ? 0 : Math.max(0, now - timer.startedAt)); }
export function pauseTimer(timer: ActivityTimerState, now: number): ActivityTimerState {
  if (timer.startedAt == null) return timer;
  return { ...timer, startedAt: null, elapsedMs: elapsedTimer(timer,now), segments: now > timer.startedAt ? [...timer.segments, { start: timer.startedAt, end: now }] : timer.segments };
}
export function timerClock(milliseconds: number) { const seconds = Math.floor(milliseconds/1000); return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value => String(value).padStart(2,'0')).join(':'); }
async function entryId(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
  const hex = [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2,'0')).join('');
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-8${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
/** Outward minute rounding keeps short sessions visible; midnight splits keep calendar days correct. */
export async function timerCalendarEntries(timer: ActivityTimerState, title: string, description: string): Promise<CalendarImport[]> {
  const entries: CalendarImport[] = [];
  for (const segment of timer.segments) {
    let cursor = segment.start;
    while (cursor < segment.end) {
      const start = new Date(cursor), date = localDate(start);
      const midnight = new Date(start.getFullYear(),start.getMonth(),start.getDate()+1,0).getTime();
      const end = Math.min(segment.end,midnight), finish = new Date(end);
      const clock = (minute: number) => `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
      const from = start.getHours()*60+start.getMinutes();
      const to = end === midnight ? 1440 : Math.min(1440,Math.max(from+1,finish.getHours()*60+finish.getMinutes()+(finish.getSeconds() || finish.getMilliseconds() ? 1 : 0)));
      const uid = `activity-time:${timer.id}:${segment.start}:${date}`;
      entries.push({ date, entry: { id:await entryId(uid), calendarUid:uid, kind:'event',text:title,description, time:clock(from),end:clock(to),done:false,cancelled:false,priority:false,reminder:false,showInJournal:false,tag:timer.tagId,plan:null } });
      cursor = end;
    }
  }
  return entries;
}
