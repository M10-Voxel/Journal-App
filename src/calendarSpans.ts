import type { CalendarDay, Entry } from './journal';
import { shiftDate } from './dates.ts';
/** View-only origin: continuations always edit/delete the original stored entry. */
export type SpanEntry = Entry & { spanOrigin?: string };
export type CalendarSpan = { entry: SpanEntry; start: string; end: string; lane: number };

/** One stable lane per interval, shared by every day and week of the visible range. */
export function calendarSpanLanes(dates: readonly string[], entriesOn: (date: string) => Entry[]): CalendarSpan[] {
 if (!dates.length) return [];
 const unique = new Map<string, Omit<CalendarSpan, 'lane'>>();
 for (const date of dates) for (const entry of entriesOn(date) as SpanEntry[]) {
  if (!entry.time || !entry.end) continue;
  const [hours, minutes] = entry.end.split(':').map(Number);
  const last = Math.floor((hours * 60 + minutes - 1) / 1440);
  if (!Number.isFinite(last) || last < 1 || last > 366) continue;
  const start = entry.spanOrigin ?? date, end = shiftDate(start, last);
  if (end >= dates[0] && start <= dates[dates.length - 1]) unique.set(`${start}/${entry.id}`, { entry: { ...entry, spanOrigin: start }, start, end });
 }
 const occupied: string[] = [];
 return [...unique.values()].sort((a,b) => a.start.localeCompare(b.start) || b.end.localeCompare(a.end) || a.entry.id.localeCompare(b.entry.id)).map(span => {
  let lane = occupied.findIndex(end => end < span.start);
  if (lane < 0) lane = occupied.length;
  occupied[lane] = span.end;
  return { ...span, lane };
 });
}

/** Cut an interval at a week or month boundary, keeping its actual end caps. */
export function calendarSpanSegment(span: CalendarSpan, dates: readonly string[]) {
 const start = dates.findIndex(date => date >= span.start && date <= span.end);
 if (start < 0) return null;
 let end = start;
 while (end + 1 < dates.length && dates[end + 1] <= span.end) end++;
 return { start, end, starts: dates[start] === span.start, ends: dates[end] === span.end };
}
export function calendarDaysWithSpans(days: Map<string,CalendarDay>, from:string, to:string):Map<string,CalendarDay> {
 const result=new Map([...days].filter(([date])=>date>=from && date<=to).map(([date,day])=>[date,{...day,entries:[...day.entries]}]));
 for(const [date,day] of days)for(const entry of day.entries as SpanEntry[]){
  if(entry.spanOrigin || !entry.time || !entry.end)continue;
  const [hours,minutes]=entry.end.split(':').map(Number),last=Math.floor((hours*60+minutes-1)/1440);
  if(!Number.isFinite(last) || last<1 || last>366)continue;
  for(let offset=1;offset<=last;offset++){
   const target=shiftDate(date,offset);if(target<from)continue;if(target>to)break;
   const shown=result.get(target) ?? {date:target,title:'',hasJournal:false,entries:[]};
   if(!shown.entries.some(item=>item.id===entry.id))shown.entries.push({...entry,spanOrigin:date} as SpanEntry);
   result.set(target,shown);
  }
 }
 return result;
}
