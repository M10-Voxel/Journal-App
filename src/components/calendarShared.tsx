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
import '../calendar.css';

// Shared by the calendar (in the journal's sidebar or its own window) and the compact month window. They only read the
// journal: a click shows the day (or the entry) in the journal, which stays the only place where entries are edited.

/** Days with content between `from` and `to`, reloaded whenever the journal saves one of them. Days loaded before stay
 *  (and are replaced as their range loads again), so stepping back to a page shows its entries at once. */
export function useCalendarData(from: string, to: string) {
  const [days, setDays] = useState<Map<string, CalendarDay>>(() => new Map());
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const fetch = () => loadRange(from, to)
      .then(list => { if (active) { setDays(previous => {
        const next = new Map([...previous].filter(([date]) => date < from || date > to));
        for (const day of list) next.set(day.date, day);
        return next;
      }); setError(''); } })
      .catch(reason => { if (active) setError(String(reason)); });
    void fetch();
    const stop = listen<string[]>('journal:changed', event => { if (event.payload.some(date => date >= from && date <= to)) void fetch(); });
    return () => { active = false; void stop.then(unlisten => unlisten()); };
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
export const EditInCalendar = createContext<{ edit: ((entry: Entry, date: string, element: HTMLElement) => void) | null; editingId: string | null }>({ edit: null, editingId: null });

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
  const open = useContext(OpenInJournal);
  const { edit, editingId } = useContext(EditInCalendar);
  // A tagged entry takes its tag's colour: the block (or bar) is tinted with it and edged in it.
  const tag = tagOf(useTags(), entry.tag);
  const state = entry.done ? ' is-done' : entry.cancelled ? ' is-cancelled' : '';
  return <button type="button" className={`cal-item is-${entry.kind} is-${variant}${short ? ' is-short' : ''}${state}${entry.priority ? ' is-priority' : ''}${tag ? ' has-tag' : ''}${editingId === entry.id ? ' is-editing' : ''}${night ? ` is-night-${night}` : ''}`}
    style={tag ? { ...style, '--tag': tag.color } as CSSProperties : style} data-tag={tag?.name}
    title={t("{0}{1} · Im Journal zeigen{2}", entryTitle(entry, tag?.name), entry.description ? `\n${entry.description}` : '', edit ? t(" · Rechtsklick: bearbeiten") : '')} aria-label={t("{0}. Im Journal zeigen", entryTitle(entry, tag?.name))}
    onContextMenu={event => { if (!edit) return; event.preventDefault(); event.stopPropagation(); edit(entry, date, event.currentTarget); }}
    onKeyDown={event => { if (edit && (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10'))) { event.preventDefault(); edit(entry, date, event.currentTarget); } }}
    onPointerEnter={event => measureTime(event.currentTarget)} onFocus={event => measureTime(event.currentTarget)}
    onClick={event => { event.stopPropagation(); open(date, entry.id); }} onDoubleClick={event => event.stopPropagation()}>
    <Icon name={entrySymbol(entry)} />
    <span className="cal-item-text">{plainText(entry.text) || t("ohne Text")}</span>
    {entry.time && <time className="cal-item-time" aria-hidden="true"><span>{formatSpan(entry.time, entry.end)}</span></time>}
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
        const classes = `cal-compact-day${outside ? ' is-outside' : ''}${date === today ? ' is-today' : ''}${index % 7 === 5 ? ' is-saturday' : index % 7 === 6 ? ' is-sunday' : ''}`;
        return <button key={date} type="button" className={classes} aria-selected={date === selected} aria-current={date === today ? 'date' : undefined}
          tabIndex={date === current ? 0 : -1} title={dayLabel(date, days.get(date))} onClick={() => { setFocus(date); onPick(date); }}>
          <span>{Number(date.slice(8))}</span>
          <DayDots day={days.get(date)} />
        </button>;
      })}
    </div>
  </div>;
}
