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

/** One window: a prompt in its head (`[journal@~]$ ./entries.sh --day …`), the content below. */
export function Terminal({ command, label, className = '', actions, children }: { command: string; label: string; className?: string; actions?: ReactNode; children: ReactNode }) {
  return <section className={`nebula-terminal ${className}`} aria-label={label}>
    <header className="nebula-terminal-head">
      <span className="nebula-prompt" aria-hidden="true"><b>[journal@~]$</b> {command}</span>
      <span className="visually-hidden">{label}</span>
      <span className="nebula-terminal-glyphs" aria-hidden="true">+ ×</span>
      {actions}
    </header>
    <div className="nebula-terminal-body">{children}</div>
  </section>;
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
  entries, data, board, notes, activities, calendar, calendarOpen, onCalendarToggle, onCalendarClose, onOpenDay, onNavigate, dayCalendar, scrollRef, disabled }: {
  mode: PeriodMode; date: string; today: string; modes: readonly PeriodMode[]; modeLabels: string[]; dirty: boolean; title: string; stats: NebulaStats;
  onMode: (mode: PeriodMode) => void; onStep: (step: 1 | -1) => void; onToday: () => void; stepLabels: { prev: { label: string; tip: string }; next: { label: string; tip: string } };
  /** The date as a button opening the mini calendar (Ctrl+G). */
  datePicker: ReactNode; tagFilter: ReactNode;
  entries: ReactNode; data: ReactNode; board: ReactNode; notes: ReactNode; activities: ReactNode;
  calendar: ReactNode; calendarOpen: boolean; onCalendarToggle: () => void; onCalendarClose: () => void;
  onOpenDay: (date: string, entry?: string) => void; onNavigate: (date: string) => void; dayCalendar: DayCalendar; scrollRef: React.RefObject<HTMLDivElement | null>; disabled?: boolean;
}) {
  const language = useLanguage();
  const { data: periodData } = usePeriodData();
  const rating = mode === 'day' ? periodData?.days[date]?.rating : undefined;
  const upcoming = useUpcoming(today, 3);
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
    const measure = () => { frame = 0; desk.style.setProperty('--nb-poster-shown', `${Math.max(0, poster.offsetHeight + 18 - desk.scrollTop)}px`); };
    const later = () => { if (!frame) frame = requestAnimationFrame(measure); };
    measure();
    desk.addEventListener('scroll', later, { passive: true });
    const observer = new ResizeObserver(later); observer.observe(poster); observer.observe(desk);
    return () => { cancelAnimationFrame(frame); desk.removeEventListener('scroll', later); observer.disconnect(); };
  }, []);
  const calendarRef = useRef<HTMLElement>(null);
  useEffect(() => { if (!calendarOpen && calendarRef.current?.contains(document.activeElement)) document.querySelector<HTMLElement>('.nebula-calendar-toggle')?.focus({ preventScroll: true }); }, [calendarOpen]);

  return <div className={`nebula-stage${calendarOpen ? ' is-calendar-open' : ''}`} data-period-mode={mode}>
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
        <span className="nebula-rail-arrow" aria-hidden="true">×+ ───────→</span>
      </aside>

      <div className="nebula-terminals">
        {mode === 'day' ? <>
          <Terminal className="is-entries" command={`./entries.sh ${dayArg}`} label={t('Einträge')}>{entries}</Terminal>
          <Marquee words={[word, word, title.trim() || word]} />
          <div className="nebula-pair">
            <Terminal className="is-data" command="./data.sh" label={t('Daten')}>{data}</Terminal>
            <Terminal className="is-board" command="./board.sh" label={t('Pinnwand')}>{board}</Terminal>
          </div>
        </> : <>
          <Terminal className="is-notes" command={`./notes.sh ${dayArg}`} label={t('Notiz')}>{notes}</Terminal>
          <Marquee words={[word, word, periodTitle(date, mode)]} />
          <Terminal className="is-activities" command={`./activities.sh ${dayArg}`} label={t('Aktivitäten')}>{activities}</Terminal>
        </>}
        <section className="nebula-tickets" aria-label={t('Nächste Termine')}>
          <h2 className="nebula-label">{t('Nächste Termine')} <span aria-hidden="true">────→</span></h2>
          {upcoming.length ? <div className="nebula-ticket-row">{upcoming.map((item, index) => <Ticket key={`${item.date}:${item.entry.id}`} item={item} index={index} onOpen={onOpenDay} />)}</div>
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

    {/* The calendar as a window of its own over the terminals; it stays mounted (closed: inert and hidden). */}
    <section ref={calendarRef} className={`nebula-calendar${calendarOpen ? ' is-open' : ''}`} aria-label={t('Kalender und Navigation')} aria-hidden={!calendarOpen || undefined} inert={!calendarOpen || disabled}
      onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('input, textarea, [contenteditable="true"], [role="dialog"]')) { event.preventDefault(); onCalendarClose(); } }}>
      <header className="nebula-terminal-head">
        <span className="nebula-prompt" aria-hidden="true"><b>[journal@~]$</b> ./calendar.sh</span>
        <button type="button" className="nebula-calendar-close" aria-label={t('Kalender schließen')} title={t('Kalender schließen · Esc')} onClick={onCalendarClose}>×</button>
      </header>
      <div className="nebula-calendar-body">{calendar}</div>
    </section>
  </div>;
}
