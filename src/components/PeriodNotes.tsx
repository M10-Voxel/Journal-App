import { useState } from 'react';
import type { CSSProperties } from 'react';
import { changePeriodData, usePeriodData } from '../periodStore';
import type { PeriodDay } from '../periodData';
import { ratingScale, seriesOf } from '../periodData';
import { ActivitySummary } from './ActivitySummary';
import { ActivityTimer } from './ActivityTimer';
import { getActivityTimer, useActivityTimers } from '../activityTimerStore';
import { withCalendarMinutes } from '../activityCalendar';
import { useCalendarMinutes } from './useCalendarMinutes';
import type { CalendarImport } from '../journal';
import { t, useLanguage } from '../i18n';
import { periodBounds, periodDates } from '../periods';
import type { PeriodMode } from '../periods';
import { Icon } from './Icon';
import { ValueChart } from './ValueChart';
import type { ChartSeries } from './ValueChart';
import { ScaleInput } from './ScaleInput';
import './periodNotes.css';
import './scaleInput.css';

export type Mode = PeriodMode;
// The checklist has its own controls; the journal's action layout (orbit, inline, swipe) does not change it.
/** Pure formatting helpers: callers subscribe to language changes in their components.
 * The heading of an overview: "Mai 2026", "Quartal 2 · 2026", "4. Mai – 10. Mai 2026". */
export function periodTitle(date: string, mode: Mode): string {
  const [start, end] = periodBounds(date, mode);
  const dateLabel = (value: string) => new Intl.DateTimeFormat(t("de-DE"), { day: 'numeric', month: 'short' }).format(new Date(`${value}T12:00:00`));
  return mode === 'year' ? start.slice(0, 4) : mode === 'quarter' ? `${t("Quartal")} ${Math.floor((Number(start.slice(5,7))-1)/3)+1} · ${start.slice(0,4)}` : mode === 'month' ? new Intl.DateTimeFormat(t("de-DE"), { month: 'long', year: 'numeric' }).format(new Date(`${start}T12:00:00`)) : `${dateLabel(start)} – ${dateLabel(end)} ${end.slice(0,4)}`;
}
export const periodEyebrow = (mode: Exclude<Mode, 'day'>) => {
  return ({ week: t("Wochenübersicht"), month: t("Monatsübersicht"), quarter: t("Quartalsübersicht"), year: t("Jahresübersicht") })[mode];
};

/**
 * The parts of a day or an overview, for windows and book pages of their own. A day: its rating, its day values, its
 * checklist; an overview: its note, its ratings (the summary and the chart of the daily rating and the day values), its
 * activities (`notes`: the note with the ratings, the book's first page). The page around a part shows the heading then.
 * Without `part` everything is shown together.
 */
export type PeriodPart = 'rating' | 'scales' | 'activities' | 'note' | 'ratings' | 'notes';
export type ManageTab = 'activities' | 'scales';
/** `bare`: only the values themselves (a desktop widget): no headings, hints or "manage" buttons; with nothing set up yet,
 *  the hint itself opens the settings. */
export function PeriodNotes({ date, mode, onManage, onImport, part, bare = false }: { date: string; mode: Mode; onManage: (tab?: ManageTab) => void; onImport: (entries: CalendarImport[]) => Promise<void>; part?: PeriodPart; bare?: boolean }) {
  useLanguage();
  useActivityTimers();
  const { data, error } = usePeriodData();
  const change = changePeriodData;
  const [start, end] = periodBounds(date, mode);
  const calendar = useCalendarMinutes(start, end, data?.definitions);
  if (!data) return <section className="period-section">{error || t("Wird geladen …")}</section>;
  // Analytics count the calendar time too; the stored minutes are only what was typed in the checklist.
  const shown = withCalendarMinutes(data, calendar);
  const dates = periodDates(start, end);
  const key = `${mode}:${start}`;
  const day = data.days[date] ?? { items: {} };
  const changeDay = (update: (value: PeriodDay) => PeriodDay) => change(current => ({ ...current, days: { ...current.days, [date]: update(current.days[date] ?? { items: {} }) } }));
  const active = data.definitions.filter(item => item.active || getActivityTimer(date,item.id));
  const rating = ratingScale(data);
  // Without a colour of its own the rating takes the theme's accent.
  const ratingColor = data.rating ? rating.color : 'var(--accent)';
  const scales = data.scales ?? [];
  const has = (...parts: PeriodPart[]) => !part || parts.includes(part);
  const setScale = (id: string, value: number | undefined) => changeDay(current => {
    const values = { ...current.scales };
    if (value == null) delete values[id]; else values[id] = value;
    const { scales: _unused, ...rest } = current;
    return Object.keys(values).length ? { ...rest, scales: values } : rest;
  });
  const manageScales = <button type="button" className="checklist-manage is-scales" onClick={() => onManage('scales')}><Icon name="settings" />{t("Tageswerte")}</button>;
  const series: ChartSeries[] = [
    { key: 'rating', label: t("Tagesbewertung"), color: ratingColor, min: rating.min, max: rating.max, values: seriesOf(dates, data.days, 'rating', rating) },
    ...scales.filter(item => item.active || dates.some(d => data.days[d]?.scales?.[item.id] != null)).map(item => ({ key: item.id, label: item.name || t("Ohne Namen"), color: item.color, min: item.min, max: item.max, values: seriesOf(dates, data.days, item.id, item) })),
  ];
  const heading = mode === 'day' ? part === 'scales' ? t("Tageswerte") : has('rating') ? t("Tagesbewertung") : null
    : has('note', 'notes') ? t("Notiz & Auswertung") : null;
  const empty = (text: string, tab: ManageTab) => bare ? <button type="button" className="checklist-empty is-action" onClick={() => onManage(tab)}><Icon name="settings" />{text}</button> : <p className="checklist-empty">{text}</p>;
  return <section className={`period-section${bare ? ' is-bare' : ''}`} data-part={part} aria-label={t("Checkliste und Auswertung")}>
    {mode !== 'day' && !part && <div className="document-header"><div className="eyebrow">{periodEyebrow(mode)}</div><h1>{periodTitle(date, mode)}</h1></div>}
    {heading && !bare && <div className="section-heading"><div className="section-title"><h2>{heading}</h2></div>{part === 'scales' && manageScales}</div>}
    {error && <div className="error" role="alert">{t("Speichern fehlgeschlagen: ")}{error}</div>}
    {mode === 'day' ? <>
      {has('rating') && <div className="period-rating">
        <div className="rating-heading"><span id="daily-rating-label">{t("Tagesbewertung")}</span></div>
        <ScaleInput id="daily-rating" label={t("Tagesbewertung")} value={day.rating} min={rating.min} max={rating.max} color={ratingColor} onChange={value => changeDay(current => ({ ...current, rating: value }))} />
        <div className="rating-scale"><span>{rating.min} · {t("Schwierig")}</span><button type="button" disabled={day.rating == null} onClick={() => changeDay(current => ({ ...current, rating: undefined }))}>{t("Zurücksetzen")}</button><span>{rating.max} · {t("Großartig")}</span></div>
      </div>}
      {has('scales') && <div className="period-scales">
        {part !== 'scales' && <div className="checklist-section-heading"><div><h3>{t("Tageswerte")}</h3><p className="page-hint">{t("Deine eigenen Werte für diesen Tag.")}</p></div>{manageScales}</div>}
        {!scales.some(item => item.active) ? empty(t("Lege Tageswerte wie Stress oder Schlaf in den Einstellungen fest."), 'scales')
          : <div className="scale-list">{scales.filter(item => item.active).map(item => { const value = day.scales?.[item.id]; return <div className="scale-row" data-scale-id={item.id} key={item.id} style={{ '--scale-color': item.color } as CSSProperties}>
            <span className="scale-name">{item.name || t("Ohne Namen")}</span>
            <ScaleInput label={item.name || t("Tageswert")} value={value} min={item.min} max={item.max} color={item.color} onChange={next => setScale(item.id, next)} />
            <button type="button" className="scale-clear" disabled={value == null} aria-label={`${item.name}: ${t("Zurücksetzen")}`} title={t("Zurücksetzen")} onClick={() => setScale(item.id, undefined)}>×</button>
          </div>; })}</div>}
      </div>}
      {has('activities') && <>
      {!bare && <div className="checklist-section-heading"><div><h3>{t("Checkliste")}</h3><p className="page-hint">{t("Deine Aktivitäten für diesen Tag.")}</p></div><button type="button" className="checklist-manage" onClick={() => onManage('activities')}><Icon name="settings" />{t("Aktivitäten")}</button></div>}
      {!data.definitions.some(item => item.active) && empty(t("Lege deine Aktivitäten in den Einstellungen fest."), 'activities')}
      {/* One line per activity, like a journal entry: check box in the symbol slot, name, optional note and time. Turning
          the note or time off leaves the row's height unchanged, so the rows below never move. */}
      {/* Time from the calendar (entries with the activity's tag, e.g. from the timer) is added to the typed minutes;
          the field shows the sum, and typing changes only the typed part. Calendar time also checks the activity. */}
      <div className="period-list">{active.map(item => { const record = day.items[item.id] ?? { done: false }; const timed = calendar[date]?.[item.id] ?? 0; const done = record.done || timed > 0; return <div className="period-item" data-activity-id={item.id} data-done={done || undefined} style={{ '--activity-color': item.color } as CSSProperties} key={item.id}>
        <label className="activity-label" title={timed ? t("{0} min im Kalender", timed) : undefined}><span className="activity-checkbox"><input type="checkbox" checked={done} aria-disabled={timed > 0 || undefined} onChange={e => { if (timed) return; const done = e.target.checked; changeDay(current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done } } })); }} /><Icon name="check" className="activity-check-mark" /></span><span className="activity-name">{item.name}</span></label>
        <div className="activity-entry-fields">
          {item.textField && <input className="activity-note-input" type="text" aria-label={`${item.name} ${t("Notiz")}`} placeholder={t("Notiz …")} value={record.text ?? ''} onChange={e => { const text = e.target.value; changeDay(current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done: current.items[item.id]?.done ?? false, text } } })); }} />}
          {item.trackTime && <MinutesField label={`${item.name} ${t("Minuten")}`} typed={record.minutes} timed={timed} disabled={!!getActivityTimer(date,item.id)} onChange={minutes => changeDay(current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done: current.items[item.id]?.done || (minutes ?? 0)>0, minutes } } }))} />}
        </div>
        <ActivityTimer date={date} activity={item} text={record.text ?? ''} onImport={onImport} />
      </div>; })}</div>
      </>}
    </> : <>
      {has('note', 'notes') && <>
      <p className="period-range">{start} – {end}</p>
      <label className="period-note">{t("Notiz")}<textarea value={data.notes[key] ?? ''} onChange={e => { const text = e.target.value; change(current => ({ ...current, notes: { ...current.notes, [key]: text } })); }} placeholder={t("Gedanken zu diesem Zeitraum …")} /></label>
      </>}
      {has('ratings', 'notes') && <div className="period-ratings">
        <div className="checklist-section-heading"><div><h3>{t("Bewertungen")}</h3><p className="page-hint">{t("Tagesbewertung und Tageswerte im Verlauf.")}</p></div>{manageScales}</div>
        <ValueChart dates={dates} series={series} monthly={mode === 'quarter' || mode === 'year'} />
      </div>}
      {has('activities') && <>
      <div className="checklist-section-heading"><div><h3>{t("Aktivitäten im Überblick")}</h3><p className="page-hint">{t("Erfasste Zeit und Aktivitätstage im gewählten Zeitraum.")}</p></div><button type="button" className="checklist-manage" onClick={() => onManage('activities')}><Icon name="settings" />{t("Aktivitäten")}</button></div>
      {!data.definitions.length && <p className="checklist-empty">{t("Lege deine Aktivitäten in den Einstellungen fest.")}</p>}
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
