import { emit, listen } from '@tauri-apps/api/event';
import type { CalendarDay, CalendarImport, Entry } from './journal';
import type { EntryEdit, NewEntry } from './components/CalendarComposer';
import type { ScopeOption } from './planning';

type CalendarAction = { kind:'move'; entry:Entry; from:string; to:string; time:string|null; end:string|null }
  | { kind:'create'; date:string; entry:NewEntry }
  | { kind:'edit'; date:string; entryId:string; change:EntryEdit; scope?:ScopeOption }
  | { kind:'remove'; date:string; entryId:string; others:ScopeOption['others'] }
  | { kind:'export' }
  | { kind:'import'; entries:CalendarImport[] };
export type CalendarRequest = {id:string} & CalendarAction;
type Result = {id:string; error?:string; days?:CalendarDay[]};
const pending = new Set<Promise<Result>>();
async function request(action: CalendarAction): Promise<Result> {
  const id=crypto.randomUUID();
  let stop:(()=>void)|undefined, timer:ReturnType<typeof setTimeout>|undefined, finished=false;
  const result=new Promise<Result>((resolve,reject)=>{
    timer=setTimeout(()=>{finished=true;reject(new Error('Der Kalender konnte die Hauptansicht nicht erreichen.'));},30000);
    void listen<Result>('calendar:request-result',event=>{
      if(event.payload.id!==id)return;
      event.payload.error ? reject(new Error(event.payload.error)) : resolve(event.payload);
    }).then(unlisten=>{if(finished){unlisten();return;}stop=unlisten;void emit('calendar:request',{...action,id}).catch(reject);},reject);
  });
  pending.add(result);
  try{return await result;}finally{finished=true;pending.delete(result);if(timer)clearTimeout(timer);stop?.();}
}
// Used when closing this calendar, never by history: the journal's mutation itself requests the history save barrier.
export async function flushCalendarRequests(){while(pending.size)await Promise.all([...pending]);}
export const requestCalendarMove = async(entry:Entry,from:string,to:string,time:string|null,end:string|null)=>{await request({kind:'move',entry,from,to,time,end});};
export const requestCalendarCreate = async(date:string,entry:NewEntry)=>{await request({kind:'create',date,entry});};
export const requestCalendarEdit = async(date:string,entryId:string,change:EntryEdit,scope?:ScopeOption)=>{await request({kind:'edit',date,entryId,change,scope});};
export const requestCalendarRemove = async(date:string,entryId:string,others:ScopeOption['others'])=>{await request({kind:'remove',date,entryId,others});};
export const requestCalendarImport = async(entries:CalendarImport[])=>{await request({kind:'import',entries});};
export const requestCalendarExport = async():Promise<CalendarDay[]>=>{
  const result=await request({kind:'export'});if(!result.days)throw new Error('Der Kalenderexport ist unvollständig.');return result.days;
};
