import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { dateFormat, t, useLanguage } from '../i18n';
import { formatShortDate, monthGrid, shiftDate, shiftMonth, weekDates } from '../dates';
import { formatMonthName } from '../calendar';
import { mailTagDefinitions } from '../mailTags';
import { tagOf } from '../tags';
import { useTags } from '../tagStore';
import type { Entry } from '../journal';
import type { PeriodMode } from '../periods';
import { periodBounds } from '../periods';
import { plainText } from '../markdown';
import { formatSpan } from '../planning';
import { usePeriodData } from '../periodStore';
import { periodTitle } from './PeriodNotes';
import { CompactMonth, useCalendarData, useNow } from './calendarShared';
import { Icon } from './Icon';
import { useFloatingWindow, windowGrips, writeWindowRect } from './useFloatingWindow';
import type { FloatingDrag } from './useFloatingWindow';
import { columns, defaultLayout, dropTarget, floatPanel, leaveRow, minSpan, normalizeLayout, own, placePanel, resizeInRow, rowsOf, setHeight, setSpan, spanOf, toggleHalf, toggleMinimized, visiblePanels } from '../nebulaLayout';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { detachable } from './DetachedPanel';
import type { DetachedKind } from './DetachedPanel';
import type { Box, Drop, Family, NebulaLayout, PanelId, WindowId } from '../nebulaLayout';

/**
 * Nebula: the app as a Y2K desktop. A grey rail on the left (status, turning days, the views as hooked tabs, the
 * calendar switch), terminal windows in the middle with the day's own building blocks (entries, data, board – or the
 * overview's note and activities), holographic tickets for the next appointments and an editorial poster on the right.
 * Everything here is rendered by the app (main.tsx) and only arranged; the decoration is a layer of its own
 * (`NebulaBackdrop`) that never takes the pointer and stands still with reduced motion.
 */

const noon = (date: string) => { const [year, month, day] = date.split('-').map(Number); return new Date(year, month - 1, day, 12); };
/** ISO week number (weeks start on Monday, week 1 holds the first Thursday). */
export function isoWeek(date: string): number {
  const value = noon(date);
  const thursday = new Date(value); thursday.setDate(value.getDate() + 3 - (value.getDay() + 6) % 7);
  const first = new Date(thursday.getFullYear(), 0, 4, 12);
  return 1 + Math.round(((thursday.getTime() - first.getTime()) / 86400000 - 3 + (first.getDay() + 6) % 7) / 7);
}

/** A line of words running past, repeated (decoration only: the same words are said elsewhere). */
function Marquee({ words }: { words: string[] }) {
  const line = Array.from({ length: 8 }, () => words).flat();
  return <div className="nebula-marquee" aria-hidden="true">
    <div className="nebula-marquee-track">{[0, 1].map(copy => <span key={copy}>{line.map((word, index) => <span key={index}>{word}<i>•</i></span>)}</span>)}</div>
  </div>;
}

const timeOf = (now: Date) => `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

type Upcoming = { date: string; entry: Entry; tag: string };
/** The tickets' tags: delivery, payment and appointments (the mail tags, by their fixed ids or their names). */
const ticketTags = Object.values(mailTagDefinitions);
/**
 * What comes next among the entries with a ticket tag (any kind, with or without a time), from today on; open ones
 * only, and today's timed ones only until they are over.
 */
function useUpcoming(today: string, count: number): Upcoming[] {
  const now = useNow();
  const tags = useTags();
  const { days } = useCalendarData(today, shiftDate(today, 60));
  const time = timeOf(now);
  const ticketTag = (id: string | null | undefined): string | null => {
    if (!id) return null;
    const own = tagOf(tags, id);
    const fixed = ticketTags.find(tag => tag.id === id || (own && [tag.de, tag.en].some(name => name.toLowerCase() === own.name.trim().toLowerCase())));
    return fixed ? own?.name ?? fixed.de : null;
  };
  const list: Upcoming[] = [];
  for (const [date, day] of days) {
    if (date < today) continue;
    for (const entry of day.entries) {
      const tag = ticketTag(entry.tag);
      if (!tag || entry.done || entry.cancelled) continue;
      if (date === today && entry.time && (entry.end ?? entry.time) < time) continue;
      list.push({ date, entry, tag });
    }
  }
  return list.sort((a, b) => `${a.date} ${a.entry.time ?? ''}`.localeCompare(`${b.date} ${b.entry.time ?? ''}`)).slice(0, count);
}

/** A holographic ticket: its number, tag, day and time; a click opens the day. */
function Ticket({ item, index, onOpen }: { item: Upcoming; index: number; onOpen: (date: string, entry: string) => void }) {
  const text = plainText(item.entry.text) || t('ohne Text');
  return <button type="button" className={`nebula-ticket is-${item.entry.kind}`} style={{ '--ticket': index } as CSSProperties} data-ticket-date={item.date} data-ticket-tag={item.tag}
    title={t('{0} · Tag öffnen', text)} onClick={() => onOpen(item.date, item.entry.id)}>
    <span className="nebula-ticket-number" aria-hidden="true">NO.{String(index + 1).padStart(3, '0')}</span>
    <span className="nebula-ticket-tag">{item.tag}</span>
    <strong className="nebula-ticket-text">{text}</strong>
    <span className="nebula-ticket-meta"><span>{formatShortDate(item.date)}</span>{item.entry.time ? <time>{formatSpan(item.entry.time, item.entry.end)}</time> : <span>{t('ganztägig')}</span>}</span>
    <span className="nebula-ticket-arrow" aria-hidden="true">→</span>
  </button>;
}

const calendarViewKey = 'journal.nebulaCalendar';

/** The calendar's own day view, rendered by the app (main.tsx) with its handlers: creating, editing, removing. */
export type DayCalendar = (showDate: string | undefined, onDateChange: (date: string) => void) => ReactNode;

/**
 * The calendar beside the overview: a month to pick days in, or the calendar's own day view (24 hours, zoom, creating
 * by dragging, editing by right click). In an overview (week … year) the day shown can be changed within the period
 * without leaving the overview: in the week by a strip of its seven days, otherwise with the calendar's own arrows.
 */
function NebulaCalendarPanel({ mode, date, today, onPick, dayCalendar }: { mode: PeriodMode; date: string; today: string; onPick: (date: string) => void; dayCalendar: DayCalendar }) {
  useLanguage();
  const [view, setView] = useState<'month' | 'day'>(() => { try { return localStorage.getItem(calendarViewKey) === 'day' ? 'day' : 'month'; } catch { return 'month'; } });
  const choose = (next: 'month' | 'day') => { setView(next); try { localStorage.setItem(calendarViewKey, next); } catch { /* this session */ } };
  const [start, end] = periodBounds(date, mode);
  // In an overview, the day picked in the strip; the day the calendar shows (it may be stepped further on its own).
  const [focus, setFocus] = useState(date);
  useEffect(() => setFocus(date), [date, mode]);
  const [shown, setShown] = useState(date);
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  const grid = monthGrid(month);
  const { days } = useCalendarData(grid[0], grid[grid.length - 1]);
  const weekday = dateFormat({ weekday: 'short' });

  return <section className={`nebula-cal-panel is-${view}`} aria-label={t('Kalender')}>
    <header className="nebula-terminal-head">
      <span className="nebula-prompt" aria-hidden="true"><b>[journal@~]$</b> ./cal.sh</span>
      <div className="nebula-cal-views" role="tablist" aria-label={t('Kalenderansicht')}>
        {(['month', 'day'] as const).map(value => <button key={value} type="button" role="tab" aria-selected={view === value} data-cal-view={value} onClick={() => choose(value)}>{value === 'month' ? t('Monat') : t('Tag')}</button>)}
      </div>
    </header>
    {view === 'month' ? <div className="nebula-cal-body">
      <div className="nebula-cal-head">
        <button type="button" className="nebula-cal-step" aria-label={t('Vorheriger Monat')} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
        <strong>{formatMonthName(`${month}-01`)} <span>{month.slice(0, 4)}</span></strong>
        <button type="button" className="nebula-cal-step" aria-label={t('Nächster Monat')} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
      </div>
      <CompactMonth month={month} days={days} today={today} selected={date} onMonth={setMonth} onPick={onPick} />
    </div> : <div className="nebula-cal-day">
      {mode === 'week' && <div className="nebula-cal-strip" role="group" aria-label={t('Tag der Woche')}>
        {weekDates(start).map(value => <button key={value} type="button" data-strip-date={value} aria-pressed={value === shown} className={value === today ? 'is-today' : undefined}
          title={formatShortDate(value)} onClick={() => setFocus(value)}><small>{weekday.format(noon(value)).slice(0, 2)}</small><span>{Number(value.slice(8))}</span></button>)}
      </div>}
      {dayCalendar(mode === 'day' ? undefined : focus || undefined, value => { setShown(value); if (mode !== 'day') setFocus(value >= start && value <= end ? value : ''); })}
    </div>}
  </section>;
}

/**
 * A window floating over the desk: the calendar and notebook (until they are docked in the grid), or one of the day's
 * own windows taken out of the grid. Until it is moved the calendar and notebook keep their place from the stylesheet,
 * the others a place in the middle. Its head moves it (a double click: back to that place), its edges and corners resize
 * it, a click brings it to the front. Released with Shift over the grid it joins the grid; released outside the journal's
 * window it becomes a window of its own (calendar, notebook, board). Focus darkens everything else.
 */
function DeskWindow({ id, stage, open, front, focused, command, label, closeLabel, className, bodyClass, disabled, sectionRef, drag, onClose, onFront, onFocus, onDock, children }: {
  id: PanelId; stage: React.RefObject<HTMLDivElement | null>; open: boolean; front: boolean; focused: boolean; command: string; label: string; closeLabel?: string;
  className: string; bodyClass: string; disabled?: boolean; sectionRef?: React.RefObject<HTMLElement | null>; drag: FloatingDrag;
  onClose?: () => void; onFront: () => void; onFocus: () => void; onDock: () => void; children: ReactNode;
}) {
  useLanguage();
  const ownRef = useRef<HTMLElement>(null);
  const frame = sectionRef ?? ownRef;
  const place = useFloatingWindow(`journal.nebulaWindow.${id}`, stage, frame, drag);
  return <section ref={frame} className={`${className}${open ? ' is-open' : ''}${place.floating ? ' is-floating' : ''}${place.dragging ? ' is-dragging' : ''}${front ? ' is-front' : ''}${focused ? ' is-focused' : ''}`}
    style={place.style} data-window={id} aria-label={label} aria-hidden={!open || undefined} inert={!open || disabled} onPointerDownCapture={onFront}
    onKeyDown={event => { if (onClose && event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) { event.preventDefault(); onClose(); } }}>
    <header className="nebula-terminal-head nebula-window-head" onPointerDown={place.startMove} onDoubleClick={event => { if (!(event.target as Element).closest('button')) place.dock(); }}
      title={t('Ziehen zum Verschieben · ⇧ beim Loslassen: ins Raster · aus dem Fenster ziehen: eigenes Fenster')}>
      <span className="nebula-prompt" aria-hidden="true"><b>[journal@~]$</b> {command}</span>
      <span className="nebula-window-tools">
        {place.floating && <button type="button" className="nebula-window-dock" aria-label={t('{0}: Ausgangsposition', label)} title={t('Ausgangsposition · Doppelklick auf die Leiste')} onClick={place.dock}>⊡</button>}
        <button type="button" className="nebula-window-grid" aria-label={t('{0} ins Raster andocken', label)} title={t('Ins Raster andocken')} onClick={onDock}>⊞</button>
        <button type="button" className="nebula-window-focus" aria-pressed={focused} aria-label={t('{0}: Fokus', label)} title={focused ? t('Fokus beenden') : t('Fokus: Hintergrund abdunkeln')} onClick={onFocus}>◐</button>
        {onClose && closeLabel && <button type="button" className="nebula-calendar-close" aria-label={closeLabel} title={`${closeLabel} · Esc`} onClick={onClose}>×</button>}
      </span>
    </header>
    <div className={bodyClass}>{children}</div>
    {open && windowGrips.map(grip => <span key={grip.name} className={`nebula-grip is-${grip.name}`} aria-hidden="true" onPointerDown={place.startResize(grip.edges)} />)}
  </section>;
}

/**
 * A window in the desk's grid. Its bar carries it: the window itself follows the pointer while a violet bar marks where it
 * lands; let go outside the grid it floats, outside the journal's window it becomes a window of its own. Its buttons
 * minimize it to the bar, switch between half and whole row, let a calendar or notebook float again, or close it. Its
 * right edge sets its width in columns, its lower edge its height (a double click there: back to the default).
 */
function Panel({ id, command, label, minimized, span, height, held, dropBefore, pair, onGrab, onMinimize, onHalf, onSpan, onHeight, onFloat, onClose, children }: {
  id: PanelId; command: string; label: string; minimized: boolean; span: number; height?: number; held: { dx: number; dy: number } | null;
  /** Where a dragged window would land: above this one, or beside it (sharing its width; the half it would take is shown). */
  dropBefore: 'top' | 'split-left' | 'split-right' | null;
  /** The window sharing the row that gives or takes width when this one is resized (nebulaLayout: resizeInRow). */
  pair: { id: PanelId; total: number } | null;
  onGrab: (event: React.PointerEvent<HTMLElement>) => void; onMinimize: () => void; onHalf: () => void; onSpan: (span: number | null) => void; onHeight: (height: number | null) => void;
  onFloat?: () => void; onClose?: () => void; children: ReactNode;
}) {
  useLanguage();
  const root = useRef<HTMLElement>(null), body = useRef<HTMLDivElement>(null);
  function resizeHeight(event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || !body.current) return;
    event.preventDefault();
    const start = event.clientY, origin = body.current.getBoundingClientRect().height;
    let last = origin;
    const move = (moved: PointerEvent) => { last = Math.max(120, origin + moved.clientY - start); if (body.current) body.current.style.height = `${last}px`; };
    const end = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end); if (last !== origin) onHeight(last); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  // The width snaps to the grid's columns while it is dragged (shown at once, stored on release).
  function resizeWidth(event: React.PointerEvent<HTMLElement>) {
    const element = root.current, grid = element?.parentElement;
    if (event.button !== 0 || !element || !grid) return;
    event.preventDefault();
    const gap = parseFloat(getComputedStyle(grid).columnGap) || 0, column = (grid.clientWidth - gap * (columns - 1)) / columns;
    const start = event.clientX, origin = element.getBoundingClientRect().width;
    // With a neighbour in the row, the two share their width: it shrinks or grows as this one changes, at once.
    const neighbour = pair ? grid.querySelector<HTMLElement>(`:scope > [data-panel="${pair.id}"]`) : null;
    const most = pair ? pair.total - minSpan : columns;
    let last = span;
    element.classList.add('is-sizing'); neighbour?.classList.add('is-sizing');
    const move = (moved: PointerEvent) => {
      last = Math.max(minSpan, Math.min(most, Math.round((origin + moved.clientX - start + gap) / (column + gap))));
      element.style.setProperty('--span', String(last));
      if (pair) neighbour?.style.setProperty('--span', String(pair.total - last));
    };
    const end = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      element.classList.remove('is-sizing'); element.style.removeProperty('--span');
      neighbour?.classList.remove('is-sizing'); neighbour?.style.removeProperty('--span');
      if (last !== span) onSpan(last);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  return <section ref={root} className={`nebula-terminal nebula-panel is-${id}${span < columns ? ' is-part' : ''}${span === columns / 2 ? ' is-half' : ''}${minimized ? ' is-minimized' : ''}${held ? ' is-held' : ''}${dropBefore ? ` is-drop-${dropBefore}` : ''}`}
    data-panel={id} data-span={span} aria-label={label} style={{ '--span': span, ...held ? { transform: `translate(${held.dx}px, ${held.dy}px) rotate(-.6deg)` } : {} } as CSSProperties}>
    <header className="nebula-terminal-head nebula-panel-head" onPointerDown={onGrab} onDoubleClick={event => { if (!(event.target as Element).closest('button')) onMinimize(); }}
      title={t('Ziehen zum Umordnen · aus dem Raster ziehen: schweben · Doppelklick: minimieren')}>
      <span className="nebula-prompt" aria-hidden="true"><b>[journal@~]$</b> {command}</span>
      <span className="visually-hidden">{label}</span>
      {minimized && <span className="nebula-panel-state" aria-hidden="true">[ {t('minimiert')} ]</span>}
      <span className="nebula-window-tools">
        <button type="button" className="nebula-panel-half" aria-pressed={span === columns / 2} aria-label={t('{0}: halbe Breite', label)} title={span === columns / 2 ? t('Ganze Breite') : t('Halbe Breite')} onClick={onHalf}>{span === columns / 2 ? '▭' : '◫'}</button>
        <button type="button" className="nebula-panel-minimize" aria-expanded={!minimized} aria-label={minimized ? t('{0} wiederherstellen', label) : t('{0} minimieren', label)}
          title={minimized ? t('Wiederherstellen') : t('Minimieren')} onClick={onMinimize}>{minimized ? '▢' : '_'}</button>
        {onFloat && <button type="button" className="nebula-panel-float" aria-label={t('{0} lösen', label)} title={t('Aus dem Raster lösen (schwebt über dem Schreibtisch)')} onClick={onFloat}>⧉</button>}
        {onClose && <button type="button" className="nebula-calendar-close" aria-label={t('{0} schließen', label)} title={t('Schließen')} onClick={onClose}>×</button>}
      </span>
    </header>
    <div ref={body} className={`nebula-terminal-body nebula-panel-body${height ? ' has-height' : ''}`} hidden={minimized} style={height ? { height } : undefined}>{children}</div>
    {!minimized && <span className="nebula-panel-resize" aria-hidden="true" title={t('Höhe ziehen · Doppelklick: automatisch')} onPointerDown={resizeHeight} onDoubleClick={() => onHeight(null)} />}
    <span className="nebula-panel-width" aria-hidden="true" title={t('Breite ziehen · Doppelklick: ganze Reihe')} onPointerDown={resizeWidth} onDoubleClick={() => onSpan(null)} />
  </section>;
}

/** The running line between the windows (decoration). Off for now; switch it on here to bring it back. */
const showMarquee = false;

const layoutKey = 'journal.nebulaLayout.v1';
function useNebulaLayout(): [NebulaLayout, (update: (layout: NebulaLayout) => NebulaLayout) => void] {
  const [layout, setLayout] = useState<NebulaLayout>(() => { try { return normalizeLayout(JSON.parse(localStorage.getItem(layoutKey) ?? 'null')); } catch { return defaultLayout(); } });
  const change = (update: (layout: NebulaLayout) => NebulaLayout) => setLayout(current => {
    const next = update(current);
    try { localStorage.setItem(layoutKey, JSON.stringify(next)); } catch { /* this session */ }
    return next;
  });
  return [layout, change];
}

/** The poster's big figure: the day, the week's number, the month, the quarter or the year. */
function posterFigure(date: string, mode: PeriodMode): { figure: string; caption: string } {
  const [year, month, day] = date.split('-').map(Number);
  if (mode === 'day') return { figure: String(day).padStart(2, '0'), caption: `${dateFormat({ weekday: 'long' }).format(noon(date))} · ${dateFormat({ month: 'long', year: 'numeric' }).format(noon(date))}` };
  if (mode === 'week') return { figure: String(isoWeek(date)).padStart(2, '0'), caption: `${t('Woche')} · ${periodTitle(date, mode)}` };
  if (mode === 'month') return { figure: String(month).padStart(2, '0'), caption: periodTitle(date, mode) };
  if (mode === 'quarter') return { figure: `Q${Math.floor((month - 1) / 3) + 1}`, caption: periodTitle(date, mode) };
  return { figure: `’${String(year).slice(2)}`, caption: t('Jahr {0}', year) };
}

/** Status of the shown day (or period), said once in the rail and as prose on the poster. */
export interface NebulaStats { entries: number; open: number; done: number; events: number }

function Orbit() {
  return <svg className="nebula-orbit-glyph" viewBox="0 0 120 120" aria-hidden="true">
    <ellipse cx="60" cy="60" rx="54" ry="18" />
    <ellipse cx="60" cy="60" rx="54" ry="18" transform="rotate(60 60 60)" />
    <ellipse cx="60" cy="60" rx="54" ry="18" transform="rotate(-60 60 60)" />
    <circle cx="60" cy="60" r="7" />
  </svg>;
}

/** The decoration: glitch pixels, slanted orbits and waves on the black desk. */
export function NebulaBackdrop() {
  const pixels = [[6, 12, 18, 6], [9, 14, 6, 6], [71, 8, 26, 4], [84, 64, 8, 8], [42, 88, 30, 3], [92, 30, 5, 14], [3, 72, 10, 10], [58, 4, 6, 6], [30, 40, 4, 4], [66, 94, 12, 4]];
  return <div className="nebula-backdrop" aria-hidden="true">
    <svg className="nebula-orbits" viewBox="0 0 1000 700" preserveAspectRatio="xMidYMid slice">
      <g className="nebula-orbit-a"><ellipse cx="500" cy="350" rx="620" ry="150" /></g>
      <g className="nebula-orbit-b"><ellipse cx="500" cy="350" rx="520" ry="110" /></g>
      <g className="nebula-orbit-c"><ellipse cx="500" cy="350" rx="700" ry="220" /></g>
    </svg>
    <svg className="nebula-waves" viewBox="0 0 240 40" preserveAspectRatio="none">
      {[0, 1, 2].map(row => <path key={row} d={`M0 ${10 + row * 10} q 10 -8 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0 t 20 0`} />)}
    </svg>
    {pixels.map(([x, y, w, h], index) => <i key={index} className="nebula-glitch" style={{ left: `${x}%`, top: `${y}%`, width: `${w * 4}px`, height: `${h * 2}px`, '--glitch': index } as CSSProperties} />)}
    <span className="nebula-cross is-a">+</span><span className="nebula-cross is-b">×</span><span className="nebula-cross is-c">+</span>
  </div>;
}

export function NebulaDesk({ mode, date, today, modes, modeLabels, dirty, title, stats, onMode, onStep, onToday, stepLabels, datePicker, tagFilter,
  entries, data, board, notes, activities, calendar, calendarOpen, onCalendarToggle, onCalendarClose, notebook, notebookOpen = false, onNotebookToggle, onNotebookClose, onOpenDay, onNavigate, dayCalendar, scrollRef, disabled }: {
  mode: PeriodMode; date: string; today: string; modes: readonly PeriodMode[]; modeLabels: string[]; dirty: boolean; title: string; stats: NebulaStats;
  onMode: (mode: PeriodMode) => void; onStep: (step: 1 | -1) => void; onToday: () => void; stepLabels: { prev: { label: string; tip: string }; next: { label: string; tip: string } };
  /** The date as a button opening the mini calendar (Ctrl+G). */
  datePicker: ReactNode; tagFilter: ReactNode;
  entries: ReactNode; data: ReactNode; board: ReactNode; notes: ReactNode; activities: ReactNode;
  calendar: ReactNode; calendarOpen: boolean; onCalendarToggle: () => void; onCalendarClose: () => void;
  /** The notebook: a window of its own like the calendar's; with both open each takes half of the middle. */
  notebook?: ReactNode; notebookOpen?: boolean; onNotebookToggle?: () => void; onNotebookClose?: () => void;
  onOpenDay: (date: string, entry?: string) => void; onNavigate: (date: string) => void; dayCalendar: DayCalendar; scrollRef: React.RefObject<HTMLDivElement | null>; disabled?: boolean;
}) {
  const language = useLanguage();
  const { data: periodData } = usePeriodData();
  const rating = mode === 'day' ? periodData?.days[date]?.rating : undefined;
  // Up to six tickets in one row, as many as fit (each at least 210 px wide).
  const upcoming = useUpcoming(today, 6);
  const ticketRow = useRef<HTMLDivElement>(null);
  const [ticketCount, setTicketCount] = useState(3);
  useEffect(() => {
    const row = ticketRow.current;
    if (!row) return;
    const fit = () => setTicketCount(Math.max(1, Math.min(6, Math.floor((row.clientWidth + 14) / (210 + 14)))));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(row);
    return () => observer.disconnect();
  }, [upcoming.length > 0]);
  const { figure, caption } = posterFigure(date, mode);
  const [start, end] = periodBounds(date, mode);
  const isToday = mode === 'day' ? date === today : start <= today && today <= end;
  const word = mode === 'day' ? (date === today ? t('heute') : dateFormat({ weekday: 'long' }).format(noon(date)).toLowerCase())
    : modeLabels[modes.indexOf(mode)].toLowerCase();
  const dayArg = mode === 'day' ? `--day ${date}` : `--${mode} ${start}`;
  const prose = mode === 'day'
    ? [stats.entries === 1 ? t('Ein Eintrag') : t('{0} Einträge', stats.entries), t('{0} offen', stats.open), t('{0} erledigt', stats.done),
      ...rating != null ? [t('Bewertung {0} / 10', rating)] : []].join(' · ') + '.'
    : t('{0} bis {1}', formatShortDate(start), formatShortDate(end));
  // The calendar window takes the focus away from what lies under it; Esc on it closes it (main.tsx: Ctrl+K, Esc).
  // How much of the poster (and the gap below it) is still on screen: the calendar below it grows by what scrolls away.
  const posterRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const desk = scrollRef.current, poster = posterRef.current;
    if (!desk || !poster) return;
    let frame = 0;
    const measure = () => { frame = 0; desk.style.setProperty('--nb-poster-shown', `${Math.max(0, poster.offsetHeight + 18 - desk.scrollTop)}px`); desk.style.setProperty('--nb-poster-h', `${poster.offsetHeight}px`); };
    const later = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    desk.addEventListener('scroll', later, { passive: true });
    const observer = new ResizeObserver(later); observer.observe(poster); observer.observe(desk);
    return () => { cancelAnimationFrame(frame); desk.removeEventListener('scroll', later); observer.disconnect(); };
  }, []);
  const calendarRef = useRef<HTMLElement>(null);
  useEffect(() => { if (!calendarOpen && calendarRef.current?.contains(document.activeElement)) document.querySelector<HTMLElement>('.nebula-calendar-toggle')?.focus({ preventScroll: true }); }, [calendarOpen]);
  const notebookRef = useRef<HTMLElement>(null);
  useEffect(() => { if (!notebookOpen && notebookRef.current?.contains(document.activeElement)) document.querySelector<HTMLElement>('.nebula-notebook-toggle')?.focus({ preventScroll: true }); }, [notebookOpen]);
  // The windows over the desk: which lies on top, and which one has the focus (everything else darkened).
  const stageRef = useRef<HTMLDivElement>(null);
  const [front, setFront] = useState<PanelId>('calendar');
  const [focused, setFocused] = useState<PanelId | null>(null);

  // The grid of windows in the middle (nebulaLayout.ts): its order, widths, minimized windows, heights; the calendar and
  // notebook while docked in it; the day's own windows floating over the desk.
  const [layout, changeLayout] = useNebulaLayout();
  const family: Family = mode === 'day' ? 'day' : 'period';
  const openWindows: Record<WindowId, boolean> = { calendar: calendarOpen, notebook: notebookOpen && Boolean(notebook) };
  // Windows pulled out of the journal (their own windows now); the board comes back when its window closes.
  const [detached, setDetached] = useState<PanelId[]>([]);
  useEffect(() => {
    const back = (kind: string) => setDetached(current => current.filter(id => id !== kind));
    const closed = listen<string>('nebula:panel-closed', event => back(event.payload));
    const returned = listen<string>('nebula:panel-return', event => {
      back(event.payload);
      if (event.payload === 'calendar' && !calendarOpenRef.current) onCalendarToggle();
      if (event.payload === 'notebook' && !notebookOpenRef.current) onNotebookToggle?.();
    });
    return () => { void closed.then(stop => stop()); void returned.then(stop => stop()); };
  }, []);
  const calendarOpenRef = useRef(calendarOpen); calendarOpenRef.current = calendarOpen;
  const notebookOpenRef = useRef(notebookOpen); notebookOpenRef.current = notebookOpen;
  const shown = visiblePanels(layout, family, openWindows).filter(id => !detached.includes(id));
  const shownRef = useRef(shown); shownRef.current = shown;
  const floatingOwn = layout.floating.filter(id => own[family].includes(id) && !detached.includes(id));
  const docked = (id: WindowId) => layout.docked.includes(id);
  const isOpen = (id: PanelId) => id === 'calendar' ? calendarOpen : id === 'notebook' ? openWindows.notebook : !detached.includes(id);
  const focusOpen = focused !== null && isOpen(focused) && (id => id === 'calendar' || id === 'notebook' ? !docked(id) : floatingOwn.includes(id))(focused);
  useEffect(() => { if (focused && !focusOpen) setFocused(null); }, [focused, focusOpen]);
  const toggleFocus = (id: PanelId) => { setFront(id); setFocused(current => current === id ? null : id); };
  const gridRef = useRef<HTMLDivElement>(null);
  // A drag in progress: the window moved (carried from the grid, or floating), where it would land, whether Shift is held
  // while a floating window is over the grid (only then it docks), and whether the pointer has left the journal's window.
  const [drop, setDrop] = useState<{ id: PanelId; target: Drop; floating: boolean; shift: boolean; out: boolean } | null>(null);
  const [held, setHeld] = useState<{ id: PanelId; dx: number; dy: number } | null>(null);
  const boxes = (without: PanelId): (Box & { id: PanelId })[] => [...(gridRef.current?.querySelectorAll<HTMLElement>(':scope > .nebula-panel') ?? [])]
    .filter(element => element.dataset.panel !== without).map(element => { const r = element.getBoundingClientRect(); return { id: element.dataset.panel as PanelId, left: r.left, top: r.top, width: r.width, height: r.height, wide: element.dataset.span === String(columns) }; });
  const none: Drop = { index: -1 };
  const overGrid = (point: { x: number; y: number }) => { const r = gridRef.current?.getBoundingClientRect(); return Boolean(r && point.x >= r.left - 12 && point.x <= r.right + 12 && point.y >= r.top - 12 && point.y <= r.bottom + 40); };
  const outside = (point: { x: number; y: number }) => point.x < 0 || point.y < 0 || point.x > window.innerWidth || point.y > window.innerHeight;
  const canLeave = (id: PanelId): id is DetachedKind => detachable.includes(id as DetachedKind);
  /** A window becomes a window of its own where the pointer let go of it (screen coordinates), at its current size. */
  const detach = (id: DetachedKind, screen: { x: number; y: number }, size: { width: number; height: number }) => {
    void invoke('panel_detach', { kind: id, x: Math.round(screen.x - 60), y: Math.round(screen.y - 14), width: Math.round(size.width + 10), height: Math.round(size.height + 10) }).then(() => {
      if (id === 'calendar') onCalendarClose(); else if (id === 'notebook') onNotebookClose?.();
      else { changeLayout(current => leaveRow(current, shownRef.current, id)); setDetached(current => current.includes(id) ? current : [...current, id]); }
    }, () => {});
  };
  const sizeOf = (id: PanelId) => { const r = document.querySelector<HTMLElement>(`[data-panel="${id}"], [data-window="${id}"]`)?.getBoundingClientRect(); return { width: r?.width ?? 560, height: r?.height ?? 460 }; };
  const floatingDrag = (id: PanelId): FloatingDrag => ({
    onDrag: (point, shift) => setDrop(!Number.isFinite(point.x) ? null : outside(point) && canLeave(id) ? { id, target: none, floating: true, shift, out: true }
      : overGrid(point) ? { id, target: dropTarget(boxes(id), point), floating: true, shift, out: false } : null),
    onDrop: (point, shift) => {
      setDrop(null);
      if (outside(point) && canLeave(id)) { detach(id, { x: window.screenX + point.x, y: window.screenY + point.y }, sizeOf(id)); return true; }
      if (!shift || !overGrid(point)) return false;
      setFocused(null);
      const target = dropTarget(boxes(id), point);
      changeLayout(current => placePanel(current, family, shownRef.current, id, target, openWindows, false));
      return true;
    },
  });
  const dockAtEnd = (id: PanelId) => { setFocused(null); changeLayout(current => placePanel(current, family, shown, id, { index: shown.length }, openWindows, false)); };
  /** Floating: at the pointer when carried out of the grid, else where it floated last. */
  const float = (id: PanelId, point?: { x: number; y: number }) => {
    const stage = stageRef.current?.getBoundingClientRect(), size = sizeOf(id);
    if (point && stage) writeWindowRect(`journal.nebulaWindow.${id}`, { x: Math.max(0, point.x - stage.left - 60), y: Math.max(0, point.y - stage.top - 12), w: Math.max(360, Math.min(size.width, 720)), h: Math.max(280, Math.min(size.height, 560)) });
    setFront(id);
    changeLayout(current => floatPanel(leaveRow(current, shownRef.current, id), id));
  };
  /** Grabbing a docked window's bar: after a few pixels the window is carried (it follows the pointer); let go in the grid
   *  it takes the marked place, beside the grid it floats there, outside the journal's window it becomes its own window. */
  function grab(id: PanelId, event: React.PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button, input, select, textarea, a')) return;
    const header = event.currentTarget;
    header.setPointerCapture(event.pointerId);
    const startX = event.clientX, startY = event.clientY;
    let moving = false, last = { x: startX, y: startY, screenX: event.screenX, screenY: event.screenY };
    const move = (moved: PointerEvent) => {
      last = { x: moved.clientX, y: moved.clientY, screenX: moved.screenX, screenY: moved.screenY };
      if (!moving && Math.hypot(last.x - startX, last.y - startY) < 6) return;
      moving = true;
      setHeld({ id, dx: last.x - startX, dy: last.y - startY });
      const out = outside(last) && canLeave(id);
      setDrop({ id, target: !out && overGrid(last) ? dropTarget(boxes(id), last) : none, floating: false, shift: false, out });
    };
    const end = (ended: PointerEvent) => {
      header.removeEventListener('pointermove', move); header.removeEventListener('pointerup', end); header.removeEventListener('pointercancel', end);
      const size = sizeOf(id);
      setDrop(null); setHeld(null);
      if (!moving || ended.type === 'pointercancel') return;
      if (outside(last) && canLeave(id)) detach(id, { x: last.screenX, y: last.screenY }, size);
      else if (overGrid(last)) { const target = dropTarget(boxes(id), last); changeLayout(current => placePanel(current, family, shownRef.current, id, target, openWindows, true)); }
      else float(id, last);
    };
    header.addEventListener('pointermove', move); header.addEventListener('pointerup', end); header.addEventListener('pointercancel', end);
  }
  const panelLabels: Record<PanelId, string> = { entries: t('Einträge'), data: t('Daten'), board: t('Pinnwand'), notes: t('Notiz'), activities: t('Aktivitäten'), calendar: t('Kalender'), notebook: t('Notizen') };
  const commandOf = (id: PanelId) => id === 'entries' || id === 'notes' || id === 'activities' ? `./${id}.sh ${dayArg}` : ({ data: './data.sh', board: './board.sh', calendar: './calendar.sh', notebook: './notes.sh --tree' } as Record<string, string>)[id];
  const panelContent: Record<PanelId, ReactNode> = { entries, data, board, notes, activities, calendar, notebook };
  const isDefault = JSON.stringify(layout) === JSON.stringify(defaultLayout());

  return <div ref={stageRef} className={`nebula-stage${calendarOpen && !docked('calendar') ? ' is-calendar-open' : ''}${notebookOpen && !docked('notebook') ? ' is-notebook-open' : ''}${focusOpen ? ' is-focus' : ''}`} data-period-mode={mode}>
    <NebulaBackdrop />
    <div className="nebula-desk" ref={scrollRef} inert={disabled}>
      <aside className="nebula-rail nebula-paper" aria-label={t('Navigation')}>
        <div className="nebula-rail-head">
          <span className="nebula-glyphs" aria-hidden="true">+ ×</span>
          <dl className="nebula-status">
            <div><dt>{t('Einträge')}</dt><dd data-stat="entries">{stats.entries}</dd></div>
            <div><dt>{t('offen')}</dt><dd data-stat="open">{stats.open}</dd></div>
            <div><dt>{t('Bewertung')}</dt><dd data-stat="rating">{rating ?? '–'}</dd></div>
          </dl>
        </div>
        <div className="nebula-day-nav" role="group" aria-label={mode === 'day' ? t('Tagesnavigation') : language === 'en' ? 'Period navigation' : 'Zeitraumnavigation'}>
          <button type="button" className="nebula-step" aria-label={stepLabels.prev.label} title={stepLabels.prev.tip} onClick={() => onStep(-1)}><Icon name="left" /></button>
          <button type="button" className="nebula-today" disabled={isToday} title={t('Heute · Alt H')} onClick={onToday}>[ {t('Heute')} ]</button>
          <button type="button" className="nebula-step" aria-label={stepLabels.next.label} title={stepLabels.next.tip} onClick={() => onStep(1)}><Icon name="right" /></button>
        </div>
        <div className="nebula-rail-date">{datePicker}</div>
        <nav className="nebula-tabs" aria-label={language === 'en' ? 'Journal views' : 'Journalansichten'}>
          {modes.map((value, index) => <button type="button" key={value} className="nebula-tab" data-period-mode={value} aria-current={mode === value ? 'page' : undefined}
            title={`${modeLabels[index]} · ${t('Strg')} ${index + 1}`} onClick={() => onMode(value)}>
            <span className="nebula-hook" aria-hidden="true" /><span>{modeLabels[index]}</span>{index === 0 && dirty && <span className="unsaved-dot" aria-label={t('Ungespeicherte Änderungen')} />}
          </button>)}
        </nav>
        {mode === 'day' && <div className="nebula-rail-tags">{tagFilter}</div>}
        <button type="button" className={`nebula-calendar-toggle${calendarOpen ? ' is-open' : ''}`} aria-expanded={calendarOpen} aria-keyshortcuts="Control+K"
          title={calendarOpen ? t('Kalender schließen · Strg K') : t('Kalender öffnen · Strg K')} onClick={onCalendarToggle}>
          <span className="nebula-calendar-command">./{t('kalender')}</span><span className="nebula-calendar-keys"><kbd>{t('Strg')}</kbd> <kbd>K</kbd></span>
        </button>
        {onNotebookToggle && <button type="button" className={`nebula-notebook-toggle${notebookOpen ? ' is-open' : ''}`} aria-expanded={notebookOpen} aria-keyshortcuts="Control+Shift+N"
          title={notebookOpen ? t('Notizen schließen · Strg ⇧ N') : t('Notizen öffnen · Strg ⇧ N')} onClick={onNotebookToggle}>
          <span className="nebula-calendar-command">./{t('notizen')}</span><span className="nebula-calendar-keys"><kbd>{t('Strg')}</kbd> <kbd>⇧</kbd> <kbd>N</kbd></span>
        </button>}
        <span className="nebula-rail-arrow" aria-hidden="true">×+ ───────→</span>
      </aside>

      <div className="nebula-terminals">
        {/* The grid of windows (twelve columns). A carried window follows the pointer; a violet bar marks where it lands. */}
        <div ref={gridRef} className={`nebula-grid${drop ? ' is-dragging' : ''}${drop && !drop.out && !drop.target.beside && drop.target.index === shown.filter(id => id !== drop.id).length && (!drop.floating || drop.shift) ? ' is-drop-end' : ''}`}>
          {shown.map((id, index) => {
            const others = drop ? shown.filter(other => other !== drop.id) : shown;
            const marking = drop && !drop.out && (!drop.floating || drop.shift) && drop.id !== id;
            const mark: 'top' | 'split-left' | 'split-right' | null = !marking ? null : drop.target.beside?.id === id ? (drop.target.beside.side === 'left' ? 'split-left' : 'split-right')
              : !drop.target.beside && others.indexOf(id) === drop.target.index ? 'top' : null;
            const row = rowsOf(layout, shown).find(list => list.includes(id)) ?? [];
            const neighbour = row[row.indexOf(id) + 1] ?? row[row.indexOf(id) - 1];
            const window = id === 'calendar' || id === 'notebook' ? id : null;
            return [<Panel key={id} id={id} command={commandOf(id)} label={panelLabels[id]} minimized={layout.minimized.includes(id)} span={spanOf(layout, id)} height={layout.heights[id] ?? (window ? 560 : undefined)}
              held={held?.id === id ? held : null} dropBefore={mark} pair={neighbour ? { id: neighbour, total: spanOf(layout, id) + spanOf(layout, neighbour) } : null}
              onGrab={event => grab(id, event)} onMinimize={() => changeLayout(current => toggleMinimized(current, id))} onHalf={() => changeLayout(current => toggleHalf(current, id))}
              onSpan={span => changeLayout(current => span == null ? setSpan(current, id, columns) : resizeInRow(current, shown, id, span))} onHeight={height => changeLayout(current => setHeight(current, id, height))}
              onFloat={() => float(id)} onClose={window === 'calendar' ? onCalendarClose : window === 'notebook' ? onNotebookClose : undefined}>
              <div className={window === 'calendar' ? 'nebula-calendar-body' : window === 'notebook' ? 'nebula-notebook-body' : 'nebula-panel-content'}
                ref={window === 'calendar' ? calendarRef as React.RefObject<HTMLDivElement> : window === 'notebook' ? notebookRef as React.RefObject<HTMLDivElement> : undefined}>{panelContent[id]}</div>
            </Panel>, showMarquee && index === 0 ? <Marquee key="marquee" words={mode === 'day' ? [word, word, title.trim() || word] : [word, word, periodTitle(date, mode)]} /> : null];
          })}
          {drop?.floating && !drop.shift && !drop.out && <p className="nebula-dock-hint" role="status">{t('⇧ halten und loslassen: hier andocken')}</p>}
        </div>
        {drop?.out && <p className="nebula-detach-hint" role="status">{t('Loslassen: als eigenes Fenster')}</p>}
        {!isDefault && <button type="button" className="nebula-layout-reset" title={t('Fenster wieder wie am Anfang anordnen')} onClick={() => changeLayout(() => defaultLayout())}>./layout --reset</button>}
        <section className="nebula-tickets" aria-label={t('Nächste Termine')}>
          <h2 className="nebula-label">{t('Nächste Termine')} <span aria-hidden="true">────→</span></h2>
          {upcoming.length ? <div ref={ticketRow} className="nebula-ticket-row" style={{ gridTemplateColumns: `repeat(${Math.min(ticketCount, upcoming.length)}, minmax(0, 1fr))` }}>{upcoming.slice(0, ticketCount).map((item, index) => <Ticket key={`${item.date}:${item.entry.id}`} item={item} index={index} onOpen={onOpenDay} />)}</div>
            : <p className="nebula-empty">[ {t('Keine Termine in Sicht.')} ]</p>}
        </section>
      </div>

      <div className="nebula-side">
      <aside ref={posterRef} className="nebula-poster nebula-paper" aria-label={t('Überblick')}>
        <div className="nebula-bar" aria-hidden="true" />
        <div className="nebula-poster-figure" data-figure={figure}>{figure}</div>
        <hr />
        <p className="nebula-poster-caption">{caption}</p>
        <p className="nebula-poster-title">[ {title.trim() || (mode === 'day' ? t('Gib deinem Tag einen Namen …') : periodTitle(date, mode))} ]</p>
        <p className="nebula-poster-prose">{prose}</p>
        <Orbit />
        <div className="nebula-bar is-foot" aria-hidden="true" />
      </aside>
      <NebulaCalendarPanel mode={mode} date={date} today={today} onPick={onNavigate} dayCalendar={dayCalendar} />
      </div>
    </div>

    {/* Focus: everything but the focused window lies under a dark veil; a click on it ends the focus. */}
    {focusOpen && <div className="nebula-dim" aria-hidden="true" onPointerDown={() => setFocused(null)} />}
    {/* The calendar and the notebook as windows of their own over the desk; they stay mounted (closed: inert and hidden). */}
    {!docked('calendar') && <DeskWindow id="calendar" stage={stageRef} sectionRef={calendarRef} open={calendarOpen} front={front === 'calendar'} focused={focused === 'calendar' && calendarOpen} command="./calendar.sh"
      label={t('Kalender und Navigation')} closeLabel={t('Kalender schließen')} className="nebula-calendar" bodyClass="nebula-calendar-body" disabled={disabled} drag={floatingDrag('calendar')}
      onClose={onCalendarClose} onFront={() => setFront('calendar')} onFocus={() => toggleFocus('calendar')} onDock={() => dockAtEnd('calendar')}>{calendar}</DeskWindow>}
    {notebook && !docked('notebook') && <DeskWindow id="notebook" stage={stageRef} sectionRef={notebookRef} open={notebookOpen} front={front === 'notebook'} focused={focused === 'notebook' && notebookOpen} command="./notes.sh --tree"
      label={t('Notizen')} closeLabel={t('Notizen schließen')} className="nebula-notebook" bodyClass="nebula-notebook-body" disabled={disabled} drag={floatingDrag('notebook')}
      onClose={() => onNotebookClose?.()} onFront={() => setFront('notebook')} onFocus={() => toggleFocus('notebook')} onDock={() => dockAtEnd('notebook')}>{notebook}</DeskWindow>}
    {/* The day's own windows taken out of the grid float like the calendar (they cannot be closed, only docked again). */}
    {floatingOwn.map(id => <DeskWindow key={id} id={id} stage={stageRef} open front={front === id} focused={focused === id} command={commandOf(id)} label={panelLabels[id]}
      className={`nebula-floating nebula-terminal is-${id}`} bodyClass="nebula-terminal-body nebula-floating-body" disabled={disabled} drag={floatingDrag(id)}
      onFront={() => setFront(id)} onFocus={() => toggleFocus(id)} onDock={() => dockAtEnd(id)}>{panelContent[id]}</DeskWindow>)}
  </div>;
}
