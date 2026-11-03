import { useState } from 'react';
import type { CSSProperties } from 'react';
import { changePeriodData, usePeriodData } from '../periodStore';
import type { PeriodDay } from '../periodData';
import { ActivitySummary } from './ActivitySummary';
import { ActivityTimer } from './ActivityTimer';
import { getActivityTimer, useActivityTimers } from '../activityTimerStore';
import { withCalendarMinutes } from '../activityCalendar';
import { useCalendarMinutes } from './useCalendarMinutes';
import type { CalendarImport } from '../journal';
import { getLanguage } from '../i18n';
import { periodBounds, periodDates } from '../periods';
import type { PeriodMode } from '../periods';
import { Icon } from './Icon';
import { RatingChart } from './RatingChart';
import './periodNotes.css';

export type Mode = PeriodMode;
// The checklist has its own controls; the journal's action layout (orbit, inline, swipe) does not change it.
/** The heading of an overview: "Mai 2026", "Quartal 2 · 2026", "4. Mai – 10. Mai 2026". */
export function periodTitle(date: string, mode: Mode): string {
  const en = getLanguage() === 'en';
  const tr = (de: string, english: string) => en ? english : de;
  const [start, end] = periodBounds(date, mode);
  const dateLabel = (value: string) => new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
  return mode === 'year' ? start.slice(0, 4) : mode === 'quarter' ? `${tr('Quartal','Quarter')} ${Math.floor((Number(start.slice(5,7))-1)/3)+1} · ${start.slice(0,4)}` : mode === 'month' ? new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${start}T12:00:00`)) : `${dateLabel(start)} – ${dateLabel(end)} ${end.slice(0,4)}`;
}
export const periodEyebrow = (mode: Exclude<Mode, 'day'>) => {
  const en = getLanguage() === 'en';
  return ({ week: en ? 'Weekly overview' : 'Wochenübersicht', month: en ? 'Monthly overview' : 'Monatsübersicht', quarter: en ? 'Quarterly overview' : 'Quartalsübersicht', year: en ? 'Yearly overview' : 'Jahresübersicht' })[mode];
};

/**
 * `part` splits an overview over two book pages: the note with the ratings, then the activities. The page around it
 * shows the heading then. Without `part` everything is shown together, as before.
 */
export function PeriodNotes({ date, mode, onManage, onImport, part }: { date: string; mode: Mode; onManage: () => void; onImport: (entries: CalendarImport[]) => Promise<void>; part?: 'notes' | 'activities' }) {
  const en = getLanguage() === 'en';
  const tr = (de: string, english: string) => en ? english : de;
  useActivityTimers();
  const { data, error } = usePeriodData();
  const change = changePeriodData;
  const [start, end] = periodBounds(date, mode);
  const calendar = useCalendarMinutes(start, end, data?.definitions);
  if (!data) return <section className="period-section">{error || tr('Wird geladen …', 'Loading …')}</section>;
  // Analytics count the calendar time too; the stored minutes are only what was typed in the checklist.
  const shown = withCalendarMinutes(data, calendar);
  const dates = periodDates(start, end);
  const key = `${mode}:${start}`;
  const day = data.days[date] ?? { items: {} };
  const changeDay = (update: (value: PeriodDay) => PeriodDay) => change(current => ({ ...current, days: { ...current.days, [date]: update(current.days[date] ?? { items: {} }) } }));
  const active = data.definitions.filter(item => item.active || getActivityTimer(date,item.id));
  const records = Object.entries(data.days).filter(([d]) => d >= start && d <= end);
  const ratings = records.flatMap(([, value]) => value.rating == null ? [] : [value.rating]);
  return <section className="period-section" aria-label={tr('Checkliste und Auswertung', 'Checklist and analytics')}>
    {mode !== 'day' && !part && <div className="document-header"><div className="eyebrow">{periodEyebrow(mode)}</div><h1>{periodTitle(date, mode)}</h1></div>}
    {part !== 'activities' && <div className="section-heading"><div className="section-title"><h2>{mode === 'day' ? tr('Tagesbewertung', 'Daily rating') : tr('Notiz & Auswertung', 'Note & analytics')}</h2></div></div>}
    {error && <div className="error" role="alert">{tr('Speichern fehlgeschlagen: ', 'Save failed: ')}{error}</div>}
    {mode === 'day' ? <>
      <div className="period-rating">
        <div className="rating-heading"><label htmlFor="daily-rating">{tr('Tagesbewertung', 'Daily rating')}</label><output htmlFor="daily-rating">{day.rating ?? '\u2013'}<small> / 10</small></output></div>
        <input id="daily-rating" type="range" min="1" max="10" step="1" value={day.rating ?? 1} aria-valuetext={day.rating == null ? tr('Noch nicht bewertet','Not rated yet') : `${day.rating} / 10`} onChange={e => changeDay(current => ({ ...current, rating: Number(e.target.value) }))} onPointerDown={() => { if (day.rating == null) changeDay(current => ({ ...current, rating: 1 })); }} onKeyDown={e => { if (['Enter',' '].includes(e.key) && day.rating == null) { e.preventDefault(); changeDay(current => ({ ...current, rating: 1 })); } }} />
        <div className="rating-scale"><span>1 · {tr('Schwierig','Difficult')}</span><button type="button" disabled={day.rating == null} onClick={() => changeDay(current => ({ ...current, rating: undefined }))}>{tr('Zurücksetzen','Reset')}</button><span>10 · {tr('Großartig','Great')}</span></div>
      </div>
      <div className="checklist-section-heading"><div><h3>{tr('Checkliste','Checklist')}</h3><p>{tr('Deine Aktivitäten für diesen Tag.','Your activities for this day.')}</p></div><button type="button" className="checklist-manage" onClick={onManage}><Icon name="settings" />{tr('Aktivitäten','Activities')}</button></div>
      {!data.definitions.some(item => item.active) && <p className="checklist-empty">{tr('Lege deine Aktivitäten in den Einstellungen fest.','Set up your activities in settings.')}</p>}
      {/* One line per activity, like a journal entry: check box in the symbol slot, name, optional note and time. Turning
          the note or time off leaves the row's height unchanged, so the rows below never move. */}
      {/* Time from the calendar (entries with the activity's tag, e.g. from the timer) is added to the typed minutes;
          the field shows the sum, and typing changes only the typed part. Calendar time also checks the activity. */}
      <div className="period-list">{active.map(item => { const record = day.items[item.id] ?? { done: false }; const timed = calendar[date]?.[item.id] ?? 0; const done = record.done || timed > 0; return <div className="period-item" data-activity-id={item.id} data-done={done || undefined} style={{ '--activity-color': item.color } as CSSProperties} key={item.id}>
        <label className="activity-label" title={timed ? tr(`${timed} min im Kalender`, `${timed} min in the calendar`) : undefined}><span className="activity-checkbox"><input type="checkbox" checked={done} aria-disabled={timed > 0 || undefined} onChange={e => { if (timed) return; const done = e.target.checked; changeDay(current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done } } })); }} /><Icon name="check" className="activity-check-mark" /></span><span className="activity-name">{item.name}</span></label>
        <div className="activity-entry-fields">
          {item.textField && <input className="activity-note-input" type="text" aria-label={`${item.name} ${tr('Notiz','note')}`} placeholder={tr('Notiz …','Note …')} value={record.text ?? ''} onChange={e => { const text = e.target.value; changeDay(current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done: current.items[item.id]?.done ?? false, text } } })); }} />}
          {item.trackTime && <MinutesField label={`${item.name} ${tr('Minuten','minutes')}`} typed={record.minutes} timed={timed} disabled={!!getActivityTimer(date,item.id)} onChange={minutes => changeDay(current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done: current.items[item.id]?.done || (minutes ?? 0)>0, minutes } } }))} />}
        </div>
        <ActivityTimer date={date} activity={item} text={record.text ?? ''} onImport={onImport} />
      </div>; })}</div>
    </> : <>
      {part !== 'activities' && <>
      <p className="period-range">{start} – {end}</p>
      <label className="period-note">{tr('Notiz','Note')}<textarea value={data.notes[key] ?? ''} onChange={e => { const text = e.target.value; change(current => ({ ...current, notes: { ...current.notes, [key]: text } })); }} placeholder={tr('Gedanken zu diesem Zeitraum …','Thoughts about this period …')} /></label>
      <h3>{tr('Bewertungen','Ratings')}</h3><p className="rating-summary">{ratings.length ? `${tr('Durchschnitt','Average')}: ${(ratings.reduce((a,b) => a+b,0)/ratings.length).toFixed(1)} / 10 · ${ratings.length} ${tr('Tage','days')}` : tr('Noch keine Bewertungen in diesem Zeitraum.','No ratings in this period yet.')}</p>
      <RatingChart dates={dates} ratings={Object.fromEntries(records.map(([d, value]) => [d, value.rating]))} monthly={mode === 'quarter' || mode === 'year'} />
      </>}
      {part !== 'notes' && <>
      <div className="checklist-section-heading"><div><h3>{tr('Aktivitäten im Überblick','Activity overview')}</h3><p>{tr('Erfasste Zeit und Aktivitätstage im gewählten Zeitraum.','Recorded time and activity days in this period.')}</p></div><button type="button" className="checklist-manage" onClick={onManage}><Icon name="settings" />{tr('Aktivitäten','Activities')}</button></div>
      {!data.definitions.length && <p className="checklist-empty">{tr('Lege deine Aktivitäten in den Einstellungen fest.','Set up your activities in settings.')}</p>}
      <div className={`activity-summary-grid is-${mode}`}>{data.definitions.filter(item => item.active || dates.some(d => shown.days[d]?.items?.[item.id])).map(item => <ActivitySummary key={item.id} activity={item} dates={dates} data={shown} mode={mode} />)}</div>
      </>}
    </>}
  </section>;
}

/** The day's total minutes: typed ones plus calendar time. While typing, the field keeps the text as entered; the typed
 *  part becomes the entered total minus the calendar time (never below zero). */
function MinutesField({ label, typed, timed, disabled, onChange }: { label: string; typed: number | undefined; timed: number; disabled: boolean; onChange: (minutes: number | undefined) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const total = typed == null && !timed ? '' : String((typed ?? 0) + timed);
  return <label className="activity-time"><Icon name="clock" /><input type="number" disabled={disabled} min={timed} step="1" aria-label={label} placeholder="0" value={draft ?? total}
    onFocus={() => setDraft(total)} onBlur={() => setDraft(null)}
    onChange={e => { const value = e.target.value; setDraft(value); const minutes = value === '' ? undefined : Math.max(0, Math.floor(Number(value)) - timed); if (minutes != null && !Number.isSafeInteger(minutes)) return; onChange(minutes); }} /><span>min</span></label>;
}
