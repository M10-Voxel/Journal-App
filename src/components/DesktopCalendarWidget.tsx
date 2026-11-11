import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Calendar } from './CalendarWindow';
import { DesktopWidgetFrame } from './DesktopWidgetFrame';
import { useWidgetHost } from './useWidgetHost';
import { calendarInitialDate, calendarWidgetPreferencesKey, loadCalendarPreferences } from '../calendarPreferences';
import type { CalendarLocation } from '../calendarPreferences';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { flushCalendarRequests, requestCalendarCreate, requestCalendarEdit, requestCalendarImport, requestCalendarMove, requestCalendarRemove } from '../calendarRequests';
import { openInJournal } from './calendarShared';
import { localDate } from '../dates';
import { t } from '../i18n';

/** Files dragged over the widget: whether one of them may be a calendar file (the name is known only on drop). */
const carriesFiles = (event: DragEvent) => [...event.dataTransfer.types].includes('Files');

export function DesktopCalendarWidget({widget,registry}:{widget:DesktopWidgetInstance;registry:DesktopWidgetState}){
  const key=calendarWidgetPreferencesKey(widget.id);
  const [location,setLocation]=useState<CalendarLocation>(()=>{const prefs=loadCalendarPreferences(key);return{view:prefs.view,date:calendarInitialDate(prefs,localDate())};});
  const [error,setError]=useState(''), [paused,setPaused]=useState(false), [notice,setNotice]=useState(''), [dropping,setDropping]=useState(false);
  // The calendar puts its turning, title and view tabs into the widget's header (see Calendar's headerSlot).
  const [header,setHeader]=useState<HTMLDivElement|null>(null);
  const noticeTimer=useRef<number|undefined>(undefined);
  useEffect(()=>{const stop=listen<boolean>('editor:paused',event=>setPaused(event.payload));return()=>{void stop.then(unlisten=>unlisten());window.clearTimeout(noticeTimer.current);};},[]);
  const close=useWidgetHost({id:widget.id,flush:flushCalendarRequests,onError:setError});
  const focus=useCallback((target:EventTarget|null)=>{if(target instanceof Element&&!target.closest('button,input,textarea,select,[contenteditable=true]'))target.closest<HTMLElement>('.cal')?.focus({preventScroll:true});},[]);
  const tell=(message:string)=>{setNotice(message);window.clearTimeout(noticeTimer.current);noticeTimer.current=window.setTimeout(()=>setNotice(''),4000);};
  // A calendar file (.ics) dropped on the widget is imported at once (known calendar UIDs are updated, nothing removed).
  const drop=async(files:File[])=>{
    const calendars=files.filter(file=>/\.ics$/i.test(file.name));
    if(!calendars.length){tell(t('Nur Kalenderdateien (.ics) können importiert werden.'));return;}
    try{
      const {importCalendar}=await import('../ical');
      let count=0;
      for(const file of calendars){
        if(file.size>5_000_000)throw new Error(t('Die ICS-Datei ist zu groß (höchstens 5 MB)'));
        const {entries}=importCalendar(await file.text());
        if(entries.length){await requestCalendarImport(entries);count+=entries.length;}
      }
      tell(count?t('{0} Einträge importiert.',count):t('Die Datei enthält keine Ereignisse oder Aufgaben.'));
    }catch(reason){setError(String(reason instanceof Error?reason.message:reason));}
  };
  return <DesktopWidgetFrame widget={widget} registry={registry} date={location.date} navRef={setHeader} onError={setError} onClose={()=>void close()}
    onOpen={()=>void flushCalendarRequests().then(()=>openInJournal(location.date)).catch(reason=>setError(String(reason)))}>
    {error&&<p className="widget-message is-error" role="alert">{t('Kalender')}: {error}</p>}
    {paused&&<p className="widget-message" role="status">{t('Wird verarbeitet …')}</p>}
    {notice&&<p className="widget-message" role="status">{notice}</p>}
    <div className={`desktop-widget-calendar${dropping?' is-dropping':''}`} inert={paused} onPointerDownCapture={event=>focus(event.target)}
      onDragEnter={event=>{if(carriesFiles(event)){event.preventDefault();setDropping(true);}}}
      onDragOver={event=>{if(carriesFiles(event)){event.preventDefault();event.dataTransfer.dropEffect='copy';}}}
      onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node|null))setDropping(false);}}
      onDrop={event=>{if(!carriesFiles(event))return;event.preventDefault();setDropping(false);void drop([...event.dataTransfer.files]);}}>
      <Calendar journalDate={null} preferencesKey={key} tagScope={`widget-${widget.id}`} rememberDate onStateChange={setLocation} headerSlot={header}
        onOpen={openInJournal} onCreate={requestCalendarCreate} onEdit={requestCalendarEdit} onMove={requestCalendarMove} onRemove={requestCalendarRemove}/>
      {dropping&&<div className="desktop-widget-drop" aria-hidden="true"><span>{t('Kalenderdatei loslassen zum Importieren')}</span></div>}
    </div>
  </DesktopWidgetFrame>;
}
