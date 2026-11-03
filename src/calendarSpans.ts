import type { CalendarDay, Entry } from './journal';
import { shiftDate } from './dates.ts';
/** View-only origin: continuations always edit/delete the original stored entry. */
export type SpanEntry = Entry & { spanOrigin?: string };
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
