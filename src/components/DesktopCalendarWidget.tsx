import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Calendar } from './CalendarWindow';
import { DesktopWidgetFrame, ensureWidgetSurface } from './DesktopWidgetFrame';
import { calendarInitialDate, calendarWidgetPreferencesKey, loadCalendarPreferences } from '../calendarPreferences';
import type { CalendarLocation } from '../calendarPreferences';
import type { DesktopWidgetInstance, DesktopWidgetState } from '../desktopWidgets';
import { updateDesktopWidget } from '../desktopWidgets';
import { flushCalendarRequests, requestCalendarCreate, requestCalendarEdit, requestCalendarExport, requestCalendarImport, requestCalendarMove, requestCalendarRemove } from '../calendarRequests';
import { openInJournal } from './calendarShared';
import { localDate } from '../dates';
import { t } from '../i18n';
import { manageTags } from '../tagStore';

export function DesktopCalendarWidget({widget,registry}:{widget:DesktopWidgetInstance;registry:DesktopWidgetState}){
  const key=calendarWidgetPreferencesKey(widget.id);
  const [location,setLocation]=useState<CalendarLocation>(()=>{const prefs=loadCalendarPreferences(key);return{view:prefs.view,date:calendarInitialDate(prefs,localDate())};});
  const [error,setError]=useState(''), [paused,setPaused]=useState(false);
  useEffect(()=>{const stop=listen<boolean>('editor:paused',event=>setPaused(event.payload));return()=>{void stop.then(unlisten=>unlisten());};},[]);
  useEffect(()=>manageTags.register(()=>{void invoke('desktop_widget_open_settings',{tab:'tags'}).catch(reason=>setError(String(reason)));}),[]);
  const close=useCallback(async()=>{try{await flushCalendarRequests();await updateDesktopWidget({enabled:false},widget.id);}catch(reason){setError(String(reason));}},[widget.id]);
  useEffect(()=>{
    let stopped=false;
    void ensureWidgetSurface().then(()=>{if(!stopped)return invoke('desktop_widget_ready');}).catch(reason=>setError(String(reason)));
    const stop=listen('desktop-widget:close',()=>void close());
    return()=>{stopped=true;void stop.then(unlisten=>unlisten());};
  },[close]);
  const focus=useCallback((target:EventTarget|null)=>{if(target instanceof Element&&!target.closest('button,input,textarea,select,[contenteditable=true]'))target.closest<HTMLElement>('.cal')?.focus({preventScroll:true});},[]);
  return <DesktopWidgetFrame widget={widget} registry={registry} command={`./calendar.sh --view ${location.view} --day ${location.date}`} onError={setError} onClose={()=>void close()}
    onOpen={()=>void flushCalendarRequests().then(()=>openInJournal(location.date)).catch(reason=>setError(String(reason)))}>
    {error&&<p className="widget-message is-error" role="alert">{t('Kalender')}: {error}</p>}
    {paused&&<p className="widget-message" role="status">{t('Wird verarbeitet …')}</p>}
    <div className="desktop-widget-calendar" inert={paused} onPointerDownCapture={event=>focus(event.target)}>
      <Calendar journalDate={null} preferencesKey={key} tagScope={`widget-${widget.id}`} rememberDate onStateChange={setLocation}
        onOpen={openInJournal} onCreate={requestCalendarCreate} onEdit={requestCalendarEdit} onMove={requestCalendarMove} onRemove={requestCalendarRemove} onExport={requestCalendarExport} onImport={requestCalendarImport}/>
    </div>
  </DesktopWidgetFrame>;
}
