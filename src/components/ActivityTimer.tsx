import { useEffect, useState } from 'react';
import type { CalendarImport } from '../journal';
import type { ActivityDefinition } from '../periodData';
import { t, useLanguage } from '../i18n';
import { elapsedTimer, timerClock } from '../activityTimer';
import { getActivityTimer, useActivityTimers, activityTimerKey, startActivityTimer, pauseActivityTimer, stopActivityTimer } from '../activityTimerStore';
import { flushPeriodData } from '../periodStore';
import { Icon } from './Icon';

const pending = new Set<string>();
// The timer lives in the database (shared with every window and J-TerminaL). Its time goes to the calendar as entries
// with the activity's tag when it is stopped (journal-core `timers`); the checklist counts it from there.
// `onImport` is no longer needed (the database imports the sessions itself); it stays accepted for older callers.
export function ActivityTimer({ date, activity, text }: { date: string; activity: ActivityDefinition; text: string; onImport?: (entries: CalendarImport[]) => Promise<void> }) {
  useActivityTimers(); useLanguage();
  const timer = getActivityTimer(date,activity.id);
  const [now,setNow] = useState(Date.now());
  const [busy,setBusy] = useState(false), [error,setError] = useState('');
  useEffect(() => { if (timer?.startedAt == null) return; const interval = window.setInterval(() => setNow(Date.now()),500); return () => window.clearInterval(interval); },[timer?.startedAt]);
  if (!activity.trackTime && !timer) return null;
  const run = async (action: () => Promise<void>) => {
    const key = activityTimerKey(date,activity.id);
    if (pending.has(key)) return;
    pending.add(key); setBusy(true); setError('');
    // Edits of the period data still queued here go first: the database changes it too (ticking the activity).
    try { await flushPeriodData(); await action(); setNow(Date.now()); }
    catch (reason) { setError(String(reason)); }
    finally { pending.delete(key); setBusy(false); }
  };
  const start = () => run(() => startActivityTimer(date, activity.id, activity.calendarTagId));
  const pause = () => run(() => pauseActivityTimer(date, activity.id));
  const stop = () => run(async () => {
    try { await stopActivityTimer(date, activity, `${t("Checklisten-Zeit")} · ${date}${text ? `
${text}` : ''}`, t("Aktivität")); }
    catch (reason) { throw `${t("Timer konnte nicht gespeichert werden. Stopp erneut versuchen:")} ${String(reason)}`; }
  });
  return <div className="activity-timer" data-running={timer?.startedAt != null || undefined}>
    {timer && <output aria-label={t("Erfasste Zeit")}>{timerClock(elapsedTimer(timer,now))}</output>}
    <div className="activity-timer-actions">
      {/* While running, Pause takes Start's place; Stop appears once there is time to save. */}
      {timer?.startedAt != null
        ? <button type="button" className="timer-pause" disabled={busy} onClick={() => void pause()} aria-label={`${activity.name}: ${t("Timer pausieren")}`} title={t("Timer pausieren")}><Icon name="pause" /></button>
        : <button type="button" className="timer-start" disabled={busy} onClick={() => void start()} aria-label={`${activity.name}: ${timer ? t("Timer fortsetzen") : t("Timer starten")}`} title={timer ? t("Timer fortsetzen") : t("Timer starten")}><Icon name="play" /></button>}
      {timer && <button type="button" className="timer-stop" disabled={busy} onClick={() => void stop()} aria-label={`${activity.name}: ${t("Stoppen und im Kalender speichern")}`} title={t("Stoppen und im Kalender speichern")}><Icon name="stop" /></button>}
    </div>
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}
