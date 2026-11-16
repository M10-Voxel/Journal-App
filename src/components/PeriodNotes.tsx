import { memo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { changePeriodData, usePeriodData } from '../periodStore';
import type { PeriodDay } from '../periodData';
import { activitySummary, periodKey, ratingScale, seriesOf, withPeriodValues } from '../periodData';
import { ActivitySummary } from './ActivitySummary';
import { ActivityTimer } from './ActivityTimer';
import { getActivityTimer, useActivityTimers } from '../activityTimerStore';
import { withCalendarMinutes } from '../activityCalendar';
import { useCalendarMinutes } from './useCalendarMinutes';
import type { CalendarImport } from '../journal';
import { localDate } from '../dates';
import { t, useLanguage } from '../i18n';
import { periodBounds, periodDates } from '../periods';
import type { PeriodMode } from '../periods';
import type { Module } from '../features';
import { Icon } from './Icon';
import { ValueChart } from './ValueChart';
import type { ChartSeries } from './ValueChart';
import { ScaleInput } from './ScaleInput';
import { PeriodEntries } from './PeriodEntries';
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
/** The rating's name in a view: the day's, the week's … */
export const ratingName = (mode: Mode) => ({ day: t("Tagesbewertung"), week: t("Wochenbewertung"), month: t("Monatsbewertung"), quarter: t("Quartalsbewertung"), year: t("Jahresbewertung") })[mode];
/** The own values' name in a view: the day's (Tageswerte), a period's (Werte, of the period itself). */
export const scalesName = (mode: Mode) => mode === 'day' ? t("Tageswerte") : t("Werte");

/**
 * The parts of a day or an overview, for windows and book pages of their own:
 * - `rating`, `scales`: the rating and the own values (a period's values are its own, not its days').
 * - `activities`: the checklist (a period's adds up its days; its timer and check box are today's).
 * - `note`: the note; `ratings`: the chart of the days' values; `summary`: the activities' overview (the evaluation).
 * - `entries`: a period's own entries (the day's are the journal's, DayEditor).
 * - `data` (rating, values, checklist) and `notes` (note and chart): the book's pages, as far as `modules` show them.
 * Without `part` everything `modules` show (without `modules`: what a day or an overview showed before the views could
 * be chosen); the page around a part shows the heading then.
 */
export type PeriodPart = 'rating' | 'scales' | 'activities' | 'note' | 'ratings' | 'summary' | 'entries' | 'notes' | 'data';
export type ManageTab = 'activities' | 'scales';
const partModules: Record<Exclude<PeriodPart, 'notes' | 'data'>, Module> = { rating: 'rating', scales: 'scales', activities: 'activities', note: 'note', ratings: 'evaluation', summary: 'evaluation', entries: 'entries' };
const legacy = (mode: Mode): ReadonlySet<Module> => new Set(mode === 'day' ? ['rating', 'scales', 'activities'] : ['note', 'evaluation']);
/** `bare`: only the values themselves (a desktop widget): no headings, hints or "manage" buttons; with nothing set up yet,
 *  the hint itself opens the settings. */
export const PeriodNotes = memo(PeriodNotesView);
function PeriodNotesView({ date, mode, onManage, onImport, part, modules, bare = false }: { date: string; mode: Mode; onManage: (tab?: ManageTab) => void; onImport: (entries: CalendarImport[]) => Promise<void>; part?: PeriodPart; modules?: ReadonlySet<Module>; bare?: boolean }) {
  useLanguage();
  const timers = useActivityTimers();
  const { data, error } = usePeriodData();
  const change = changePeriodData;
  const [start, end] = periodBounds(date, mode);
  const calendar = useCalendarMinutes(start, end, data?.definitions);
  // Which blocks show: a single part, or the parts of a page (`data`, `notes`) or of the whole view that are on.
  const on = modules ?? legacy(mode);
  const blocks = new Set<Exclude<PeriodPart, 'notes' | 'data'>>(
    part === 'data' ? (['rating', 'scales', 'activities'] as const).filter(item => on.has(item))
    : part === 'notes' ? [...on.has('note') ? ['note' as const] : [], ...mode !== 'day' && on.has('evaluation') ? ['ratings' as const] : []]
    : part ? [part]
    : (Object.keys(partModules) as (keyof typeof partModules)[]).filter(item => on.has(partModules[item]) && (mode !== 'day' || (item !== 'ratings' && item !== 'summary' && item !== 'entries'))));
  if (!blocks.size) return null;
  if (!data) return <section className="period-section">{error || t("Wird geladen …")}</section>;
  // Analytics count the calendar time too; the stored minutes are only what was typed in the checklist.
  const shown = withCalendarMinutes(data, calendar);
  const dates = periodDates(start, end);
  const key = periodKey(mode, start);
  const today = localDate();
  const day = data.days[date] ?? { items: {} };
  const changeDay = (target: string, update: (value: PeriodDay) => PeriodDay) => change(current => ({ ...current, days: { ...current.days, [target]: update(current.days[target] ?? { items: {} }) } }));
  const active = data.definitions.filter(item => item.active || getActivityTimer(date,item.id));
  const rating = ratingScale(data);
  // Without a colour of its own the rating takes the theme's accent.
  const ratingColor = data.rating ? rating.color : 'var(--accent)';
  const scales = data.scales ?? [];
  // A day's values are the day's; a period's are its own (periodData `periods`).
  const values = mode === 'day' ? day : data.periods?.[key] ?? {};
  const setRating = (value: number | undefined) => mode === 'day' ? changeDay(date, current => ({ ...current, rating: value })) : change(current => withPeriodValues(current, key, item => ({ ...item, rating: value })));
  const setScale = (id: string, value: number | undefined) => {
    const next = (current: Record<string, number> | undefined) => { const result = { ...current }; if (value == null) delete result[id]; else result[id] = value; return result; };
    if (mode !== 'day') { change(current => withPeriodValues(current, key, item => ({ ...item, scales: next(item.scales) }))); return; }
    changeDay(date, current => {
      const scales = next(current.scales);
      const { scales: _unused, ...rest } = current;
      return Object.keys(scales).length ? { ...rest, scales } : rest;
    });
  };
  const manageScales = <button type="button" className="checklist-manage is-scales" onClick={() => onManage('scales')}><Icon name="settings" />{scalesName('day')}</button>;
  const manageActivities = <button type="button" className="checklist-manage" onClick={() => onManage('activities')}><Icon name="settings" />{t("Aktivitäten")}</button>;
  const series: ChartSeries[] = [
    { key: 'rating', label: t("Tagesbewertung"), color: ratingColor, min: rating.min, max: rating.max, values: seriesOf(dates, data.days, 'rating', rating) },
    ...scales.filter(item => item.active || dates.some(d => data.days[d]?.scales?.[item.id] != null)).map(item => ({ key: item.id, label: item.name || t("Ohne Namen"), color: item.color, min: item.min, max: item.max, values: seriesOf(dates, data.days, item.id, item) })),
  ];
  const only = (item: PeriodPart) => blocks.size === 1 && blocks.has(item as never);
  // The section's heading: the day's rating heads its values; an overview's note and evaluation share one.
  const heading = mode === 'day' ? only('scales') && part === 'scales' ? scalesName(mode) : blocks.has('rating') && !blocks.has('note') ? ratingName(mode) : null
    : (blocks.has('note') || !part) && (blocks.has('note') || blocks.has('ratings') || blocks.has('summary')) && !blocks.has('entries') && !blocks.has('rating') && !blocks.has('scales') && !blocks.has('activities') ? t("Notiz & Auswertung") : null;
  const empty = (text: string, tab: ManageTab) => bare ? <button type="button" className="checklist-empty is-action" onClick={() => onManage(tab)}><Icon name="settings" />{text}</button> : <p className="checklist-empty">{text}</p>;
  const subheading = (title: string, hint: string, action?: ReactNode) => !bare && <div className="checklist-section-heading"><div><h3>{title}</h3><p className="page-hint">{hint}</p></div>{action}</div>;
  const todayIn = start <= today && today <= end;
  // A period's checklist: the timer that runs for an activity on a day of the period, else today's (when it lies in it).
  const timerDay = (id: string) => Object.keys(timers).map(name => name.slice(0, 10)).find(value => value >= start && value <= end && getActivityTimer(value, id)) ?? (todayIn ? today : null);
  const duration = (minutes: number) => minutes >= 60 ? `${Math.floor(minutes/60)} h ${minutes%60 ? `${minutes%60} min` : ''}`.trim() : `${minutes} min`;

  return <section className={`period-section${bare ? ' is-bare' : ''}`} data-part={part} data-mode={mode} aria-label={t("Checkliste und Auswertung")}>
    {mode !== 'day' && !part && <div className="document-header"><div className="eyebrow">{periodEyebrow(mode)}</div><h1>{periodTitle(date, mode)}</h1></div>}
    {heading && !bare && <div className="section-heading"><div className="section-title"><h2>{heading}</h2></div>{part === 'scales' && manageScales}</div>}
    {error && <div className="error" role="alert">{t("Speichern fehlgeschlagen: ")}{error}</div>}
    {blocks.has('entries') && mode !== 'day' && <PeriodEntries periodKey={key} />}
    {blocks.has('rating') && <div className="period-rating">
      <div className="rating-heading"><span id={`${mode}-rating-label`}>{ratingName(mode)}</span></div>
      <ScaleInput id={mode === 'day' ? 'daily-rating' : `${mode}-rating`} label={ratingName(mode)} value={values.rating} min={rating.min} max={rating.max} color={ratingColor} onChange={setRating} />
      <div className="rating-scale"><span>{rating.min} · {t("Schwierig")}</span><button type="button" disabled={values.rating == null} onClick={() => setRating(undefined)}>{t("Zurücksetzen")}</button><span>{rating.max} · {t("Großartig")}</span></div>
    </div>}
    {blocks.has('scales') && <div className="period-scales">
      {part !== 'scales' && subheading(scalesName(mode), mode === 'day' ? t("Deine eigenen Werte für diesen Tag.") : t("Deine eigenen Werte für diesen Zeitraum, unabhängig von den Tagen."), manageScales)}
      {!scales.some(item => item.active) ? empty(t("Lege Tageswerte wie Stress oder Schlaf in den Einstellungen fest."), 'scales')
        : <div className="scale-list">{scales.filter(item => item.active).map(item => { const value = values.scales?.[item.id]; return <div className="scale-row" data-scale-id={item.id} key={item.id} style={{ '--scale-color': item.color } as CSSProperties}>
          <span className="scale-name">{item.name || t("Ohne Namen")}</span>
          <ScaleInput label={item.name || t("Tageswert")} value={value} min={item.min} max={item.max} color={item.color} onChange={next => setScale(item.id, next)} />
          <button type="button" className="scale-clear" disabled={value == null} aria-label={`${item.name}: ${t("Zurücksetzen")}`} title={t("Zurücksetzen")} onClick={() => setScale(item.id, undefined)}>×</button>
        </div>; })}</div>}
    </div>}
    {blocks.has('activities') && mode === 'day' && <>
      {!bare && subheading(t("Checkliste"), t("Deine Aktivitäten für diesen Tag."), manageActivities)}
      {!data.definitions.some(item => item.active) && empty(t("Lege deine Aktivitäten in den Einstellungen fest."), 'activities')}
      {/* One line per activity, like a journal entry: check box in the symbol slot, name, optional note and time. Turning
          the note or time off leaves the row's height unchanged, so the rows below never move. */}
      {/* Time from the calendar (entries with the activity's tag, e.g. from the timer) is added to the typed minutes;
          the field shows the sum, and typing changes only the typed part. Calendar time also checks the activity. */}
      <div className="period-list">{active.map(item => { const record = day.items[item.id] ?? { done: false }; const timed = calendar[date]?.[item.id] ?? 0; const done = record.done || timed > 0; return <div className="period-item" data-activity-id={item.id} data-done={done || undefined} style={{ '--activity-color': item.color } as CSSProperties} key={item.id}>
        <label className="activity-label" title={timed ? t("{0} min im Kalender", timed) : undefined}><span className="activity-checkbox"><input type="checkbox" checked={done} aria-disabled={timed > 0 || undefined} onChange={e => { if (timed) return; const done = e.target.checked; changeDay(date, current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done } } })); }} /><Icon name="check" className="activity-check-mark" /></span><span className="activity-name">{item.name}</span></label>
        <div className="activity-entry-fields">
          {item.textField && <input className="activity-note-input" type="text" aria-label={`${item.name} ${t("Notiz")}`} placeholder={t("Notiz …")} value={record.text ?? ''} onChange={e => { const text = e.target.value; changeDay(date, current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done: current.items[item.id]?.done ?? false, text } } })); }} />}
          {item.trackTime && <MinutesField label={`${item.name} ${t("Minuten")}`} typed={record.minutes} timed={timed} disabled={!!getActivityTimer(date,item.id)} onChange={minutes => changeDay(date, current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done: current.items[item.id]?.done || (minutes ?? 0)>0, minutes } } }))} />}
        </div>
        <ActivityTimer date={date} activity={item} text={record.text ?? ''} onImport={onImport} />
      </div>; })}</div>
    </>}
    {/* A period's checklist adds up its days: the time typed or recorded on them, the days with the activity. Its check
        box is today's, and its timer records on the day it runs (the calendar entries fall on the days they belong to). */}
    {blocks.has('activities') && mode !== 'day' && <>
      {!bare && subheading(t("Checkliste"), todayIn ? t("Die Zeit aller Tage dieses Zeitraums; Haken und Timer gelten für heute.") : t("Die Zeit aller Tage dieses Zeitraums."), manageActivities)}
      {!data.definitions.some(item => item.active) && empty(t("Lege deine Aktivitäten in den Einstellungen fest."), 'activities')}
      <div className="period-list is-period">{data.definitions.filter(item => item.active || timerDay(item.id) && getActivityTimer(timerDay(item.id)!, item.id)).map(item => {
        const total = activitySummary(dates, shown.days, item.id), timerDate = timerDay(item.id);
        const record = data.days[today]?.items[item.id], timedToday = calendar[today]?.[item.id] ?? 0, doneToday = todayIn && (!!record?.done || timedToday > 0);
        return <div className="period-item" data-activity-id={item.id} data-done={doneToday || undefined} style={{ '--activity-color': item.color } as CSSProperties} key={item.id}>
          <label className="activity-label" title={todayIn ? t("Heute erledigt") : undefined}>
            <span className="activity-checkbox">{todayIn ? <><input type="checkbox" checked={doneToday} aria-label={`${item.name}: ${t("Heute erledigt")}`} aria-disabled={timedToday > 0 || undefined}
              onChange={e => { if (timedToday) return; const done = e.target.checked; changeDay(today, current => ({ ...current, items: { ...current.items, [item.id]: { ...current.items[item.id], done } } })); }} /><Icon name="check" className="activity-check-mark" /></> : <i className="activity-dot" aria-hidden="true" />}</span>
            <span className="activity-name">{item.name}</span>
          </label>
          <div className="activity-entry-fields">
            <span className="activity-period-days" title={t("Tage mit dieser Aktivität")}>{total.activeDays} / {dates.length} {t("Tage")}</span>
            {(item.trackTime || total.minutes > 0) && <span className="activity-time is-total" title={t("Zeit aller Tage")}><Icon name="clock" />{duration(total.minutes)}</span>}
          </div>
          {timerDate && <ActivityTimer date={timerDate} activity={item} text={data.days[timerDate]?.items[item.id]?.text ?? ''} onImport={onImport} />}
        </div>;
      })}</div>
    </>}
    {blocks.has('note') && <>
      <p className="period-range">{start} – {end}</p>
      <label className="period-note">{t("Notiz")}<textarea spellCheck={false} value={data.notes[key] ?? ''} onChange={e => { const text = e.target.value; change(current => ({ ...current, notes: { ...current.notes, [key]: text } })); }} placeholder={mode === 'day' ? t("Gedanken zu diesem Tag …") : t("Gedanken zu diesem Zeitraum …")} /></label>
    </>}
    {blocks.has('ratings') && mode !== 'day' && <div className="period-ratings">
      <div className="checklist-section-heading"><div><h3>{t("Bewertungen")}</h3><p className="page-hint">{t("Tagesbewertung und Tageswerte im Verlauf.")}</p></div>{manageScales}</div>
      <ValueChart dates={dates} series={series} monthly={mode === 'quarter' || mode === 'year'} />
    </div>}
    {blocks.has('summary') && mode !== 'day' && <>
      <div className="checklist-section-heading"><div><h3>{t("Aktivitäten im Überblick")}</h3><p className="page-hint">{t("Erfasste Zeit und Aktivitätstage im gewählten Zeitraum.")}</p></div>{manageActivities}</div>
      {!data.definitions.length && <p className="checklist-empty">{t("Lege deine Aktivitäten in den Einstellungen fest.")}</p>}
      <div className={`activity-summary-grid is-${mode}`}>{data.definitions.filter(item => item.active || dates.some(d => shown.days[d]?.items?.[item.id])).map(item => <ActivitySummary key={item.id} activity={item} dates={dates} data={shown} mode={mode} />)}</div>
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
