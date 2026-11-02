import { useEffect, useState } from 'react';
import type { CalendarImport } from '../journal';
import type { ActivityDefinition } from '../periodData';
import { getLanguage } from '../i18n';
import { elapsedTimer, pauseTimer, timerCalendarEntries, timerClock } from '../activityTimer';
import { getActivityTimer, writeActivityTimer, useActivityTimers, activityTimerKey } from '../activityTimerStore';
import { changePeriodData, flushPeriodData } from '../periodStore';
import { saveTags } from '../tagStore';
import { Icon } from './Icon';

const pending = new Set<string>();
// The timer's time goes to the calendar as entries with the activity's tag; the checklist counts it from there.
export function ActivityTimer({ date, activity, text, onImport }: { date: string; activity: ActivityDefinition; text: string; onImport: (entries: CalendarImport[]) => Promise<void> }) {
  useActivityTimers();
  const timer = getActivityTimer(date,activity.id);
  const [now,setNow] = useState(Date.now());
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  const tr = (de:string,english:string) => getLanguage() === 'en' ? english : de;
  useEffect(() => { if (timer?.startedAt == null) return; const interval = window.setInterval(() => setNow(Date.now()),500); return () => window.clearInterval(interval); },[timer?.startedAt]);
  if (!activity.trackTime && !timer) return null;
  const start = () => {
    try {
      const current = getActivityTimer(date,activity.id);
      if (current?.startedAt != null) return;
      const started = Date.now(); setNow(started);
      writeActivityTimer(date,activity.id,{ ...(current ?? { id:crypto.randomUUID(), tagId:activity.calendarTagId ?? crypto.randomUUID(), elapsedMs:0,segments:[] }), startedAt:started });
      changePeriodData(data => { const day = data.days[date] ?? { items:{} }; return { ...data, days:{ ...data.days,[date]:{ ...day,items:{ ...day.items,[activity.id]:{ ...day.items[activity.id],done:true } } } } }; });
      setError('');
    } catch (reason) { setError(String(reason)); }
  };
  const pause = () => { try { const current = getActivityTimer(date,activity.id); if (current) { writeActivityTimer(date,activity.id,pauseTimer(current,Date.now())); setNow(Date.now()); } } catch(reason) { setError(String(reason)); } };
  const stop = async () => {
    const key = activityTimerKey(date,activity.id), current = getActivityTimer(date,activity.id);
    if (!current || pending.has(key)) return;
    pending.add(key); setBusy(true); setError('');
    try {
      const stopped = { ...pauseTimer(current,Date.now()), tagId:activity.calendarTagId ?? current.tagId };
      writeActivityTimer(date,activity.id,stopped); setNow(Date.now());
      await saveTags(tags => {
        if (tags.some(tag => tag.id === stopped.tagId)) return tags.map(tag => tag.id === stopped.tagId ? { ...tag,color:activity.color } : tag);
        const base = (activity.name.trim() || tr('Aktivität','Activity')).slice(0,32);
        let name = base, suffix = 1;
        while (tags.some(tag => tag.name.toLowerCase() === name.toLowerCase())) name = `${base} (${++suffix})`;
        return [...tags,{ id:stopped.tagId,name,color:activity.color }];
      });
      const entries = await timerCalendarEntries(stopped,activity.name,`${tr('Checklisten-Zeit','Checklist time')} · ${date}${text ? `\n${text}` : ''}`);
      if (entries.length) await onImport(entries);
      changePeriodData(data => { const day = data.days[date] ?? { items:{} }; return { ...data,definitions:data.definitions.map(item => item.id === activity.id ? { ...item,calendarTagId:stopped.tagId } : item),days:{ ...data.days,[date]:{ ...day,items:{ ...day.items,[activity.id]:{ ...day.items[activity.id],done:true } } } } }; });
      await flushPeriodData();
      writeActivityTimer(date,activity.id,null);
    } catch(reason) { setError(`${tr('Timer konnte nicht gespeichert werden. Stopp erneut versuchen:','Could not save timer. Retry Stop:')} ${String(reason)}`); }
    finally { pending.delete(key); setBusy(false); }
  };
  return <div className="activity-timer" data-running={timer?.startedAt != null || undefined}>
    {timer && <output aria-label={tr('Erfasste Zeit','Elapsed time')}>{timerClock(elapsedTimer(timer,now))}</output>}
    <div className="activity-timer-actions">
      {/* While running, Pause takes Start's place; Stop appears once there is time to save. */}
      {timer?.startedAt != null
        ? <button type="button" className="timer-pause" disabled={busy} onClick={pause} aria-label={`${activity.name}: ${tr('Timer pausieren','Pause timer')}`} title={tr('Timer pausieren','Pause timer')}><Icon name="pause" /></button>
        : <button type="button" className="timer-start" disabled={busy} onClick={start} aria-label={`${activity.name}: ${timer ? tr('Timer fortsetzen','Resume timer') : tr('Timer starten','Start timer')}`} title={timer ? tr('Timer fortsetzen','Resume timer') : tr('Timer starten','Start timer')}><Icon name="play" /></button>}
      {timer && <button type="button" className="timer-stop" disabled={busy} onClick={() => void stop()} aria-label={`${activity.name}: ${tr('Stoppen und im Kalender speichern','Stop and save to calendar')}`} title={tr('Stoppen und im Kalender speichern','Stop and save to calendar')}><Icon name="stop" /></button>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
