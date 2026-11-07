import { calendarDaysWithSpans } from '../calendarSpans';
import type { SpanEntry } from '../calendarSpans';
import { decodeMailContent } from '../mailContent';
import { MailContent } from './MailContent';
import { copyCalendarEntry } from '../calendarClipboard';
import { journal } from '../journal';
import { linkedScopes } from '../planning';
import type { ScopeOption } from '../planning';
import { ScopeChoice } from './ScopeChoice';
import { t, useLanguage, getLanguage } from '../i18n';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { CalendarDay, Entry, formatShortDate, loadRange, shiftDate } from '../journal';
import { monthGrid } from '../dates';
import { plainText } from '../markdown';
import { shiftMonthKeepingDay } from '../calendar';
import { formatSpan } from '../planning';
import { describe } from '../repeat';
import { Icon, IconName, priorityIcon } from './Icon';
import { entryLabels } from './JournalEntry';
import { tagOf } from '../tags';
import { useTags } from '../tagStore';
import { Popover } from './Popover';
import { beginCalendarDrag } from '../calendarDrag';
import { calendarSelection, chosenElements, registerCalendarItem, rememberMoved, unregisterCalendarItem, useCalendarSelected } from '../calendarSelection';
import { minutesOf } from '../calendar';
import { timeOfMinutes } from '../planning';
import '../calendar.css';

// Shared by the calendar (in the journal's sidebar or its own window) and the compact month window. They only read the
// journal: a click shows the day (or the entry) in the journal, which stays the only place where entries are edited.

/** Days with content between `from` and `to`, reloaded whenever the journal saves one of them. Only the current requested range is retained, so browsing does not grow memory indefinitely. */
export function useCalendarData(from: string, to: string) {
  const [days, setDays] = useState<Map<string, CalendarDay>>(() => new Map());
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const fetch = () => Promise.all(Array.from({length:Math.ceil((Date.parse(to)-Date.parse(from))/86400000/390)+1},(_,i)=>{const start=shiftDate(from,i*390);return start>to ? Promise.resolve([]) : loadRange(start,shiftDate(start,389)<to?shiftDate(start,389):to);})).then(parts=>parts.flat())
      .then(list => { if (active) { setDays(() => {
        const next = new Map<string, CalendarDay>();
        for (const day of list) next.set(day.date, day);
        return next;
      }); setError(''); } })
      .catch(reason => { if (active) setError(String(reason)); });
    void fetch();
    const stop = listen<string[]>('journal:changed', event => { if (event.payload.some(date => date >= from && date <= to)) void fetch(); });
    const restored = listen('history:restored', () => { void fetch(); });
    return () => { active = false; void stop.then(unlisten => unlisten()); void restored.then(unlisten => unlisten()); };
  }, [from, to]);
  return { days, error };
}

/** The day the journal window shows. A new window asks for it once; afterwards the journal announces every change. */
export function useJournalDate(): string | null {
  const [date, setDate] = useState<string | null>(null);
  useEffect(() => {
    const stop = listen<string>('journal:date', event => setDate(event.payload));
    void stop.then(() => emit('journal:hello'));
    return () => { void stop.then(unlisten => unlisten()); };
  }, []);
  return date;
}

/** The current minute (for the line marking "now"), and with it today's date, which changes at midnight. */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** From a separate window, the journal window is asked to show the day; in the sidebar the journal provides its own. */
export const openInJournal = (date: string, entry?: string) => { void invoke('show_day', { date, entry: entry ?? null }).catch(() => {}); };
export const OpenInJournal = createContext<(date: string, entry?: string) => void>(openInJournal);
/** Right-clicking an entry edits it in place (in the sidebar, where the calendar may change the journal). */
export const EditInCalendar = createContext<{ edit: ((entry: Entry, date: string, element: HTMLElement) => void) | null; editingId: string | null; move?: (entry: Entry, from: string, to: string, time: string | null, end: string | null) => Promise<void>; remove?: (entry: Entry, date: string, others: ScopeOption['others']) => Promise<void> }>({ edit: null, editingId: null });

export function entrySymbol(entry: Entry): IconName {
  if (entry.done) return 'done';
  return entry.priority ? priorityIcon(entry.kind) : entry.kind;
}
export const entryTitle = (entry: Entry, tag?: string) => `${tag ? `${tag} · ` : ''}${entryLabels()[entry.kind]}${entry.time ? entry.end ? t(" von {0} bis {1}", entry.time, entry.end) : t(" um {0}", entry.time) : ''}${entry.done ? t(", erledigt") : entry.cancelled ? t(", abgebrochen") : ''}${entry.repeat?.rule ? `, ${describe(entry.repeat.rule)}` : ''}: ${plainText(entry.text) || t("ohne Text")}`;

/** How fast the time scrolls when it does not fit (px per second). */
const tickerSpeed = 36;
/**
 * The time of an entry appears only while hovering (or focusing) it, in its bottom right corner. Where it does not fit,
 * it runs through that corner from right to left. Written for any label, so a later "09:00 – 10:30" works the same.
 */
function measureTime(item: HTMLElement) {
  const badge = item.querySelector<HTMLElement>('.cal-item-time');
  const label = badge?.firstElementChild as HTMLElement | null;
  if (!badge || !label) return;
  // Measured as it sits when it fits: 2 px from the item's edges, 3 px padding on each side of the label.
  badge.classList.remove('is-scrolling');
  const room = item.clientWidth - 4;
  const overflow = label.scrollWidth + 6 > room;
  badge.classList.toggle('is-scrolling', overflow);
  if (overflow) {
    badge.style.setProperty('--room', `${room}px`);
    badge.style.setProperty('--travel', `${room + label.scrollWidth}px`);
    badge.style.setProperty('--duration', `${(room + label.scrollWidth) / tickerSpeed}s`);
  }
}

/** One entry: its journal symbol and the text. Events are filled bars, tasks and notes lines (like Samsung's calendar). */
/** `night`: a block past midnight – `start` on its own day (cut at 24:00), `rest` its continuation on the next. */
export function CalendarItem({ entry, date, variant = 'line', short = false, style, night }: { entry: Entry; date: string; variant?: 'line' | 'block'; short?: boolean; style?: CSSProperties; night?: 'start' | 'rest' }) {
  useLanguage();
  const shownDate = night === 'rest' ? shiftDate(date, 1) : date;
  date=(entry as SpanEntry).spanOrigin ?? date;
  const open = useContext(OpenInJournal);
  const { edit, editingId, remove, move } = useContext(EditInCalendar);
  const suppressDragClick = useRef(false);
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const beginMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!move || event.button !== 0 || !event.isPrimary) return;
    const element = event.currentTarget;
    if (!element.closest('.cal')) return;
    dragCleanup.current?.();
    dragCleanup.current = beginCalendarDrag({ element, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, entry, date, shownDate, companions: chosenElements(entry.id),
      onDragEnd: () => { suppressDragClick.current = true; window.setTimeout(() => { suppressDragClick.current = false; }, 500); },
      onDrop: target => {
        // A chosen entry takes the other chosen ones along: the same days, and the same minutes where both have a time.
        const others = calendarSelection().has(entry.id) ? [...calendarSelection().values()].filter(item => item.entry.id !== entry.id) : [];
        const days = Math.round((Date.parse(target.date) - Date.parse(date)) / 86400000);
        const minutes = entry.time && target.time ? minutesOf(target.time) - minutesOf(entry.time) : 0;
        const places = [{ entry, from: date, to: target.date, time: target.time, end: target.end }, ...others.map(({ entry: other, date: from }) => {
          if (!other.time || !minutes) return { entry: other, from, to: shiftDate(from, days), time: other.time ?? null, end: other.end ?? null };
          const start = minutesOf(other.time) + minutes, carry = Math.floor(start / 1440), inDay = start - carry * 1440;
          const end = other.end ? timeOfMinutes(inDay + minutesOf(other.end) - minutesOf(other.time)) : null;
          return { entry: other, from, to: shiftDate(from, days + carry), time: timeOfMinutes(inDay), end };
        })];
        // They stay chosen at their new places until a press elsewhere.
        rememberMoved(places.map(place => ({ entry: { ...place.entry, time: place.time, end: place.end }, date: place.to })));
        // One after another: each move saves the day it touches, so parallel ones could race on the same day.
        void places.reduce((done, place) => done.then(() => move(place.entry, place.from, place.to, place.time, place.end)), Promise.resolve()).catch(reason => setError(String(reason)));
      },
    });
  };
  // A tagged entry takes its tag's colour: the block (or bar) is tinted with it and edged in it.
  const tag = tagOf(useTags(), entry.tag);
  // The small field at an entry with a description opens it in a card of its own.
  const [details, setDetails] = useState(false);
  const noteRef = useRef<HTMLButtonElement>(null);
  const chosen = useCalendarSelected(entry.id);
  useEffect(() => { const element = noteRef.current; if (!element) return; registerCalendarItem(element, { entry, date }); return () => unregisterCalendarItem(element); }, [entry, date]);
  const hovered = useRef(false);
  const [options, setOptions] = useState<ScopeOption[] | null>(null);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(false);
  useEffect(() => {
    const key = async (event: globalThis.KeyboardEvent) => {
      if (!(hovered.current || details) || (event.target instanceof Element && event.target.closest('input,textarea,[contenteditable=true]'))) return;
      if (event.ctrlKey && event.key.toLowerCase()==='c') { event.preventDefault(); copyCalendarEntry(entry); }
      if (event.key!=='Delete' || !remove || deleting || options || calendarSelection().size) return;
      event.preventDefault(); setDeleting(true);
      try { const choices=linkedScopes(await journal.linked(entry.id),entry.id,'remove'); if(choices.length>1)setOptions(choices);else await remove(entry,date,[]); }
      catch(reason){setError(String(reason));}finally{setDeleting(false);}
    };
    window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
  },[details,entry,date,remove,deleting,options]);
  const mail=decodeMailContent(entry.description);
  const detailTitle=details ? plainText(entry.text) || t("ohne Text") : '';
  const overview=details ? <div className="cal-details-overview">
    <div className="cal-details-head"><span className="cal-details-kind"><Icon name={entrySymbol(entry)} /></span><strong>{detailTitle}</strong></div>
    <div className="cal-details-meta">
      <span className="cal-details-date"><Icon name="calendar" />{formatShortDate(date)}</span>
      {entry.time && <span className="cal-details-time"><Icon name="clock" />{formatSpan(entry.time,entry.end)}</span>}
      {tag && <span className="cal-details-tag"><span className="tag-dot" />{tag.name}</span>}
    </div>
  </div> : null;
  const spanning=Boolean(entry.end && Number(entry.end.split(':')[0])>=24);
  const state = entry.done ? ' is-done' : entry.cancelled ? ' is-cancelled' : '';
  return <button type="button" className={`cal-item is-${entry.kind} is-${variant}${short ? ' is-short' : ''}${spanning ? ' is-multiday' : ''}${state}${entry.priority ? ' is-priority' : ''}${tag ? ' has-tag' : ''}${editingId === entry.id ? ' is-editing' : ''}${chosen ? ' is-selected' : ''}${night ? ` is-night-${night}` : ''}`}
    ref={noteRef} style={tag ? { ...style, '--tag': tag.color } as CSSProperties : style} data-tag={tag?.name}
    data-calendar-entry={entry.id} data-calendar-time={night === 'rest' ? '00:00' : entry.time ?? undefined}
    data-calendar-end={night === 'start' ? '24:00' : night === 'rest' && entry.end ? timeOfMinutes(minutesOf(entry.end) - 1440) : entry.end ?? undefined}
    title={t("{0}{1} · Im Journal zeigen{2}", entryTitle(entry, tag?.name), !mail && entry.description ? `\n${entry.description}` : '', edit ? t(" · Rechtsklick: bearbeiten") : '')} aria-label={entryTitle(entry, tag?.name)}
    onContextMenu={event => { if (!edit) return; event.preventDefault(); event.stopPropagation(); edit(entry, date, event.currentTarget); }}
    onKeyDown={event => { if (edit && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); edit(entry, date, event.currentTarget); } }}
    onPointerEnter={event => { hovered.current=true; measureTime(event.currentTarget); }} onPointerLeave={() => {hovered.current=false;}} onFocus={event => measureTime(event.currentTarget)}
    onPointerDown={beginMove} onClick={event => { event.stopPropagation(); if(suppressDragClick.current){suppressDragClick.current=false;return;} setDetails(value=>!value); }} onDoubleClick={event => event.stopPropagation()}>
    <Icon name={entrySymbol(entry)} />
    <span className="cal-item-text">{plainText(entry.text) || t("ohne Text")}</span>
    {entry.time && <time className="cal-item-time" aria-hidden="true"><span>{formatSpan(entry.time, entry.end)}</span></time>}
    {options && <Popover anchor={noteRef.current} label={t("L?schen")} onClose={()=>setOptions(null)}><ScopeChoice action="remove" options={options} onCancel={()=>setOptions(null)} onChoose={option=>{setOptions(null);void remove?.(entry,date,option.others).catch(reason=>setError(String(reason)));}} /></Popover>}
    {error && <Popover anchor={noteRef.current} label={t("Fehler")} onClose={()=>setError('')}><p role="alert">{error}</p></Popover>}
    {details && <Popover anchor={noteRef.current} className={`cal-details${mail ? ' has-mail' : ''}`} label={t("Beschreibung")} onClose={() => setDetails(false)}>
      {/* Clicks in here stay here: the entry around it would otherwise open the journal. */}
      <div className="cal-details-body" onClick={event => event.stopPropagation()} onDoubleClick={event => event.stopPropagation()} onContextMenu={event => event.stopPropagation()} style={tag ? { '--tag': tag.color } as CSSProperties : undefined}>
        {mail ? <MailContent mail={mail} heading={overview} entryTitle={detailTitle}/> : <>{overview}<p className="cal-details-text">{entry.description}</p></>}
        <div className="tag-picker-foot cal-details-actions"><button type="button" onClick={() => copyCalendarEntry(entry)}><Icon name="copy" />{t("Kopieren")}<kbd>{t("Strg")} C</kbd></button><button type="button" onClick={() => {setDetails(false);if(noteRef.current)edit?.(entry,date,noteRef.current);}}><Icon name="pencil" />{t("Bearbeiten")}</button><span className="cal-details-escape"><kbd>Esc</kbd></span><button type="button" onClick={() => { setDetails(false); open(date, entry.id); }}><Icon name="journal" />{t("Im Journal zeigen")}</button></div>
      </div>
    </Popover>}
    </button>;
}

const weekdayInitials = () => getLanguage() === 'en' ? ['M','T','W','T','F','S','S'] : ['M','D','M','D','F','S','S'];
/** Up to three dots below a day number: events, open tasks, and everything else. */
function DayDots({ day }: { day: CalendarDay | undefined }) {
  useLanguage();
  if (!day?.entries.length) return null;
  const has = { event: day.entries.some(entry => entry.kind === 'event'), task: day.entries.some(entry => entry.kind === 'task' && !entry.done && !entry.cancelled), other: day.entries.some(entry => entry.kind === 'note' || entry.done || entry.cancelled) };
  return <span className="cal-dots" aria-hidden="true">{has.event && <i className="is-event" />}{has.task && <i className="is-task" />}{has.other && <i />}</span>;
}
export function dayLabel(date: string, day: CalendarDay | undefined): string {
  const count = day?.entries.length ?? 0;
  const lines = day?.entries.slice(0, 6).map(entry => `${entry.time ? `${entry.time} ` : ''}${plainText(entry.text) || t("ohne Text")}`) ?? [];
  return [`${formatShortDate(date)}${day?.title ? ` · ${day.title}` : ''} · ${count ? `${count} ${count === 1 ? t("Eintrag") : t("Einträge")}` : t("keine Einträge")}`, ...lines, ...count > 6 ? ['…'] : []].join('\n');
}

/**
 * A small month to click days in (the compact window and the day view's side). Arrow keys move between days,
 * Page ↑/↓ change the month, Enter or a click picks the day. The day the journal shows is filled, today is ringed.
 */
export function CompactMonth({ month, days, today, selected, onPick, onMonth }: {
  month: string; days: Map<string, CalendarDay>; today: string; selected: string | null; onPick: (date: string) => void; onMonth: (month: string) => void;
}) {
  useLanguage();
  const shownDates=monthGrid(month);days=calendarDaysWithSpans(days,shownDates[0],shownDates[shownDates.length-1]);
  const [focus, setFocus] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const current = focus?.startsWith(month) ? focus : selected?.startsWith(month) ? selected : today.startsWith(month) ? today : `${month}-01`;
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus();
  });
  function move(target: string) {
    moved.current = true;
    setFocus(target);
    if (!target.startsWith(month)) onMonth(target.slice(0, 7));
  }
  function onKeyDown(event: KeyboardEvent) {
    const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[event.key];
    if (step && !event.altKey && !event.ctrlKey) move(shiftDate(current, step));
    else if (event.key === 'PageUp' || event.key === 'PageDown') move(shiftMonthKeepingDay(current, event.key === 'PageUp' ? -1 : 1));
    else return;
    event.preventDefault();
    event.stopPropagation();
  }
  return <div className="cal-compact">
    <div className="cal-compact-weekdays" aria-hidden="true">{weekdayInitials().map((initial, index) => <span key={index} className={index === 5 ? 'is-saturday' : index === 6 ? 'is-sunday' : undefined}>{initial}</span>)}</div>
    <div ref={gridRef} className="cal-compact-grid" role="grid" aria-label={t("Tage des Monats")} onKeyDown={onKeyDown} key={month}>
      {monthGrid(month).map((date, index) => {
        const outside = !date.startsWith(month);
        const classes = `cal-compact-day${hasJournalContent(days.get(date)) ? ' has-journal-content' : ''}${outside ? ' is-outside' : ''}${date === today ? ' is-today' : ''}${index % 7 === 5 ? ' is-saturday' : index % 7 === 6 ? ' is-sunday' : ''}`;
        return <button key={date} type="button" className={classes} data-date={date} aria-selected={date === selected} aria-current={date === today ? 'date' : undefined}
          tabIndex={date === current ? 0 : -1} title={dayLabel(date, days.get(date))} onClick={() => { setFocus(date); onPick(date); }}>
          <span>{Number(date.slice(8))}</span>
          <DayDots day={days.get(date)} />
        </button>;
      })}
    </div>
  </div>;
}

/** The backend flag also covers free text and planned traces, even when calendar filters hide them. */
export const hasJournalContent = (day: CalendarDay | undefined) => day?.hasJournal ?? Boolean(day && (day.title.trim() || day.entries.some(entry => entry.showInJournal !== false)));
