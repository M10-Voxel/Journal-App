import { emit, listen } from '@tauri-apps/api/event';
import type { Entry } from './journal';
import type { NewEntry } from './components/CalendarComposer';

export type CalendarRequest = { id: string } & ({ kind:'move'; entry:Entry; from:string; to:string; time:string|null; end:string|null } | { kind:'create'; date:string; entry:NewEntry });
type Result = { id:string; error?:string };
async function request(action: Omit<Extract<CalendarRequest,{kind:'move'}>,'id'> | Omit<Extract<CalendarRequest,{kind:'create'}>,'id'>) {
  const id=crypto.randomUUID();
  let stop: (() => void) | undefined, timer: ReturnType<typeof setTimeout> | undefined, finished=false;
  const result = new Promise<void>((resolve,reject) => {
    timer=setTimeout(()=>{ finished=true; reject(new Error('Der Kalender konnte die Hauptansicht nicht erreichen.')); },30000);
    void listen<Result>('calendar:request-result', event => { if(event.payload.id!==id)return; event.payload.error ? reject(new Error(event.payload.error)) : resolve(); }).then(unlisten => { if(finished){unlisten();return;} stop=unlisten; void emit('calendar:request',{...action,id}).catch(reject); },reject);
  });
  try { await result; } finally { finished=true;if(timer)clearTimeout(timer);stop?.(); }
}
export const requestCalendarMove = (entry:Entry,from:string,to:string,time:string|null,end:string|null) => request({kind:'move',entry,from,to,time,end});
export const requestCalendarCreate = (date:string,entry:NewEntry) => request({kind:'create',date,entry});
