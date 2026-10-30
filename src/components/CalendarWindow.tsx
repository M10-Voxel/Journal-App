import { memo, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDay, Entry, EntryKind, formatDate, formatWeekday, localDate } from '../journal';
import { monthGrid } from '../dates';
import { plainText } from '../markdown';
import { CalendarView, calendarViews, durationOf, formatDuration, formatMonthName, isoWeek, layoutTimed, minutesOf, orderForCalendar, shiftView, slotMinutes, snapMinutes, snapRange, viewDates, viewRange, viewTitle } from '../calendar';
import { timeOfMinutes } from '../planning';
import { CalendarComposer } from './CalendarComposer';
import type { Draft, EntryEdit, NewEntry } from './CalendarComposer';
import { CalendarItem, CompactMonth, EditInCalendar, OpenInJournal, dayLabel, entrySymbol, openInJournal, useCalendarData, useJournalDate, useNow } from './calendarShared';
import { Icon } from './Icon';
import { useWheelSwipe } from './useWheelSwipe';

// The calendar: in the journal's sidebar, or in a window of its own (currently not offered). Year and month like
// Apple's and Samsung's calendars, week, work week and day as a time grid with a band for entries without time
// (Apple's "ganztägig"), the kinds to show as toggles like TaskNotes' filters. It follows the day the journal shows.
// Keys (with the focus in the calendar): ← → step, H today, J / M / W / A / T (or 1–5) switch the view.
// Swiping sideways (or Shift + wheel) steps as well.
type Kinds = Record<EntryKind, boolean>;
const storageKey = 'journal.calendar';
function loadPrefs(): { view: CalendarView; kinds: Kinds } {
  const fallback = { view: 'month' as CalendarView, kinds: { event: true, task: true, note: false } };
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) ?? '{}') as Partial<typeof fallback>;
    return { view: calendarViews.some(item => item.view === stored.view) ? stored.view! : fallback.view, kinds: { ...fallback.kinds, ...stored.kinds } };
  } catch { return fallback; }
}
const kindPlurals: Record<EntryKind, string> = { event: 'Ereignisse', task: 'Aufgaben', note: 'Notizen' };
const weekdayNames = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const weekendClass = (date: string, index?: number) => {
  const weekday = index ?? (new Date(`${date}T12:00`).getDay() + 6) % 7;
  return weekday === 5 ? ' is-saturday' : weekday === 6 ? ' is-sunday' : '';
};

/** The calendar as a window of its own: it hears the journal's day through events and asks the journal window to show days. */
export function CalendarWindow() {
  return <Calendar journalDate={useJournalDate()} onOpen={openInJournal} autoFocus />;
}

// Memoized: in the sidebar it must not re-render while the journal is being typed in (`onOpen` is stable).
/** An entry being edited (right click): its day and the element the card is placed at. */
type Editing = { entry: Entry; date: string; element: HTMLElement };
export const Calendar = memo(function Calendar({ journalDate, onOpen, onCreate, onEdit, onRemove, embedded = false, autoFocus = false }: {
  journalDate: string | null; onOpen: (date: string, entry?: string) => void; embedded?: boolean; autoFocus?: boolean;
  onCreate?: (date: string, entry: NewEntry) => Promise<void>; onEdit?: (date: string, id: string, change: EntryEdit) => Promise<void>; onRemove?: (date: string, id: string, others: { id: string; date: string }[]) => Promise<void>;
}) {
  const [prefs, setPrefs] = useState(loadPrefs);
  const { view, kinds } = prefs;
  const now = useNow();
  const today = localDate(now);
  const [date, setDate] = useState(journalDate ?? today);
  const [slide, setSlide] = useState<'next' | 'prev' | null>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const range = viewRange(view, date);
  const { days, error } = useCalendarData(range.from, range.to);
  const title = viewTitle(view, date);
  const entriesOn = (value: string) => orderForCalendar((days.get(value)?.entries ?? []).filter(entry => kinds[entry.kind]));

  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch { /* keep it for this session */ } }, [prefs]);
  useEffect(() => { if (autoFocus) rootRef.current?.focus(); }, []);
  // Whenever the journal shows another day, the calendar goes there; browsing the calendar leaves the journal alone.
  useEffect(() => { if (journalDate) go(journalDate); }, [journalDate]);
  // Another page or view leaves the entry being edited behind.
  const pageKey = view === 'year' ? date.slice(0, 4) : view === 'month' ? date.slice(0, 7) : viewDates(view, date)[0];
  useEffect(() => setEditing(null), [view, pageKey]);
  const refocus = () => rootRef.current?.focus({ preventScroll: true });
  // Timed entries in a time grid are edited there, as a range that can be moved and resized; all others in place.
  const gridDates = view === 'week' || view === 'workweek' || view === 'day' ? viewDates(view, date) : [];
  const inGrid = editing?.entry.time && gridDates.includes(editing.date) ? editing : null;
  const save = async (change: EntryEdit) => { if (editing) { await onEdit!(editing.date, editing.entry.id, change); setEditing(null); refocus(); } };
  const remove = async (others: { id: string; date: string }[]) => { if (editing) { await onRemove!(editing.date, editing.entry.id, others); setEditing(null); refocus(); } };
  const editContext = { edit: onEdit ? (entry: Entry, value: string, element: HTMLElement) => setEditing({ entry, date: value, element }) : null, editingId: editing?.entry.id ?? null };

  const setView = (next: CalendarView) => setPrefs(current => ({ ...current, view: next }));
  // Going somewhere directly shows it in place; stepping slides the next page in from that side.
  const go = (value: string) => { setSlide(null); setDate(value); };
  const show = (next: CalendarView, value: string) => { go(value); setView(next); };
  // A day clicked in any view opens its note in the journal; the calendar goes there too.
  const openDay = (value: string) => { go(value); onOpen(value); };
  const step = (amount: 1 | -1) => { setSlide(amount > 0 ? 'next' : 'prev'); setDate(shiftView(view, date, amount)); };
  const swipe = useWheelSwipe(step);
  function onKeyDown(event: KeyboardEvent) {
    if ((event.target as Element).closest('input, .cal-composer')) return;
    if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
    const byKey = calendarViews.find((item, index) => item.key === event.key.toUpperCase() || String(index + 1) === event.key);
    if (byKey) setView(byKey.view);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') step(event.key === 'ArrowLeft' ? -1 : 1);
    else if (event.key === 'h' || event.key === 'H') go(today);
    else return;
    event.preventDefault();
  }

  const selectedIndex = calendarViews.findIndex(item => item.view === view);
  return <OpenInJournal.Provider value={onOpen}><EditInCalendar.Provider value={editContext}>
    <div ref={rootRef} className={`cal${embedded ? ' is-embedded' : ''}`} data-view={view} tabIndex={-1} aria-label="Kalender" onKeyDown={onKeyDown}>
      <nav className="cal-viewbar" aria-label="Kalenderansicht">
        <div className="cal-views" role="tablist" aria-label="Ansicht" style={{ '--index': selectedIndex, '--count': calendarViews.length } as CSSProperties}>
          <span className="cal-views-indicator" aria-hidden="true" />
          {calendarViews.map((item, index) => <button key={item.view} type="button" role="tab" aria-selected={item.view === view} aria-label={item.label} title={`${item.label} · ${item.key} oder ${index + 1}`} onClick={() => setView(item.view)}>
            <span className="cal-view-long">{item.label}</span><span className="cal-view-short" aria-hidden="true">{item.short}</span>
          </button>)}
        </div>
      </nav>
      <header className="cal-toolbar">
        <h1 className="cal-title" key={`${view}-${title.main}-${title.sub}`}><strong>{title.main}</strong>{title.sub && <span>{title.sub}</span>}</h1>
        <div className="cal-actions">
          <div className="cal-filter" role="group" aria-label="Angezeigte Einträge">
            {(['event', 'task', 'note'] as EntryKind[]).map(kind => <button key={kind} type="button" className={`cal-filter-${kind}`} aria-pressed={kinds[kind]} title={`${kindPlurals[kind]} zeigen`}
              onClick={() => setPrefs(current => ({ ...current, kinds: { ...current.kinds, [kind]: !current.kinds[kind] } }))}><Icon name={kind} /></button>)}
          </div>
          <span className="cal-separator" />
          <div className="cal-nav">
            <button type="button" className="cal-icon-button" aria-label="Zurück" title="Zurück · ←" onClick={() => step(-1)}><Icon name="left" /></button>
            <button type="button" className="cal-today" title="Heute · H" onClick={() => go(today)}>Heute</button>
            <button type="button" className="cal-icon-button" aria-label="Weiter" title="Weiter · →" onClick={() => step(1)}><Icon name="right" /></button>
          </div>
        </div>
      </header>
      {error && <div className="cal-error" role="alert">{error}</div>}
      <div className="cal-body" key={view} onWheel={swipe}>
        <div className={`cal-page${slide ? ` slide-${slide}` : ''}`} key={pageKey}>
          {view === 'year' && <YearView date={date} today={today} journalDate={journalDate} days={days} entriesOn={entriesOn} onDay={openDay} onMonth={value => show('month', value)} />}
          {view === 'month' && <MonthView date={date} today={today} journalDate={journalDate} days={days} entriesOn={entriesOn} onDay={openDay} onMore={value => show('day', value)} onWeek={value => show('week', value)} />}
          {(view === 'week' || view === 'workweek' || view === 'day') && <div className="cal-split">
            <TimeGrid dates={viewDates(view, date)} today={today} now={now} journalDate={journalDate} entriesOn={entriesOn} onDay={openDay} onCreate={onCreate}
              editing={inGrid} onEditEnd={byKey => { setEditing(null); if (byKey) refocus(); }} onSave={save} onRemove={remove} />
            {view === 'day' && <DaySide date={date} today={today} journalDate={journalDate} days={days} onPick={openDay} />}
          </div>}
        </div>
      </div>
    </div>
    {editing && !inGrid && <CalendarComposer key={editing.entry.id} date={editing.date} draft={null} entry={editing.entry} onSave={save} onRemove={remove}
      anchor={() => editing.element.isConnected ? editing.element.getBoundingClientRect() : null} onCancel={byKey => { setEditing(null); if (byKey) refocus(); }} />}
  </EditInCalendar.Provider></OpenInJournal.Provider>;
});

/**
 * Twelve small months (Apple's year view). Below a day's number a dot means tasks, a blue ring events, both a dot in a
 * blue ring (notes, when shown, a faint dot). A day opens its note in the journal, a month name the month view.
 */
function YearView({ date, today, journalDate, days, entriesOn, onDay, onMonth }: { date: string; today: string; journalDate: string | null; days: Map<string, CalendarDay>; entriesOn: (date: string) => Entry[]; onDay: (date: string) => void; onMonth: (date: string) => void }) {
  const year = date.slice(0, 4);
  return <div className="cal-year">
    {Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, '0')}`).map(month => <section key={month} className={`cal-year-month${today.startsWith(month) ? ' is-current' : ''}`} aria-label={formatMonthName(`${month}-01`)}>
      <button type="button" className="cal-year-name" onClick={() => onMonth(date.startsWith(month) ? date : `${month}-01`)}>{formatMonthName(`${month}-01`)}</button>
      <div className="cal-year-weekdays" aria-hidden="true">{weekdayNames.map((name, index) => <span key={name} className={weekendClass('', index)}>{name[0]}</span>)}</div>
      <div className="cal-year-grid">
        {monthGrid(month).map((value, index) => {
          if (!value.startsWith(month)) return <span key={value} />;
          const entries = entriesOn(value);
          const task = entries.some(entry => entry.kind === 'task'), event = entries.some(entry => entry.kind === 'event');
          const mark = task || event ? `${task ? ' is-task' : ''}${event ? ' is-event' : ''}` : entries.length ? ' is-note' : '';
          return <button key={value} type="button" className={`cal-year-day${weekendClass(value, index % 7)}${value === today ? ' is-today' : ''}${value === journalDate ? ' is-journal' : ''}${mark ? ' has-mark' : ''}`}
            aria-current={value === today ? 'date' : undefined} title={dayLabel(value, days.get(value))} onClick={() => onDay(value)}>
            <span>{Number(value.slice(8))}</span>{mark && <i className={`cal-year-mark${mark}`} aria-hidden="true" />}
          </button>;
        })}
      </div>
    </section>)}
  </div>;
}

/** Six weeks with week numbers. As many entries as fit, then "+n weitere"; a day number opens the day view. */
function MonthView({ date, today, journalDate, days, entriesOn, onDay, onMore, onWeek }: {
  date: string; today: string; journalDate: string | null; days: Map<string, CalendarDay>; entriesOn: (date: string) => Entry[]; onDay: (date: string) => void; onMore: (date: string) => void; onWeek: (date: string) => void;
}) {
  const month = date.slice(0, 7);
  const grid = monthGrid(month);
  const gridRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState(3);
  useLayoutEffect(() => {
    const element = gridRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setLines(Math.max(0, Math.floor((entry.contentRect.height / 6 - 30) / 20))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div className="cal-month">
    <div className="cal-month-head" aria-hidden="true"><span>KW</span>{weekdayNames.map((name, index) => <span key={name} className={weekendClass('', index)}>{name}</span>)}</div>
    <div className="cal-month-grid" ref={gridRef} key={month}>
      {Array.from({ length: 6 }, (_, week) => <div key={week} className="cal-month-week">
        <button type="button" className="cal-month-kw" title="Woche zeigen" onClick={() => onWeek(grid[week * 7])}>{isoWeek(grid[week * 7])}</button>
        {grid.slice(week * 7, week * 7 + 7).map((value, index) => {
          const entries = entriesOn(value);
          const visible = entries.length > lines ? entries.slice(0, Math.max(0, lines - 1)) : entries;
          const title = days.get(value)?.title;
          return <div key={value} className={`cal-month-day${weekendClass(value, index)}${value.startsWith(month) ? '' : ' is-outside'}${value === today ? ' is-today' : ''}${value === journalDate ? ' is-journal' : ''}`}
            onClick={() => onDay(value)}>
            <div className="cal-month-day-head">
              <button type="button" className="cal-month-number" aria-label={`${formatDate(value)} im Journal öffnen`} aria-current={value === today ? 'date' : undefined} onClick={event => { event.stopPropagation(); onDay(value); }}>
                {value.endsWith('-01') ? <>{Number(value.slice(8))}.<small> {formatMonthName(value).slice(0, 3)}</small></> : Number(value.slice(8))}
              </button>
              {title && <span className="cal-month-title" title={title}>{title}</span>}
            </div>
            {visible.map(entry => <CalendarItem key={entry.id} entry={entry} date={value} />)}
            {entries.length > visible.length && <button type="button" className="cal-more" title="Alle in der Tagesansicht" onClick={event => { event.stopPropagation(); onMore(value); }}>+{entries.length - visible.length} weitere</button>}
          </div>;
        })}
      </div>)}
    </div>
  </div>;
}

const hourHeight = 48;
/** How close (px) to the visible grid's top or bottom edge a drag starts scrolling, and how fast at most (px per frame). */
const scrollZone = 40, scrollSpeed = 14;
type Gesture = { mode: 'new' | 'start' | 'end' | 'move'; column: HTMLElement; date: string; anchor: number; origin: Draft; y: number; moved: boolean };
/**
 * Days as columns over 24 hours. Entries without time sit in the band on top, timed ones in the grid (as long as they
 * last, an hour without an end; side by side where they overlap). Today's column shows the current time as a line, like
 * Apple's red one. With `onCreate`, dragging in a column marks a range in quarter hours (a click marks an hour; near the
 * edges the grid scrolls along) and the composer opens next to it; the marked range can still be moved and resized.
 */
function TimeGrid({ dates, today, now, journalDate, entriesOn, onDay, onCreate, editing, onEditEnd, onSave, onRemove }: {
  dates: string[]; today: string; now: Date; journalDate: string | null; entriesOn: (date: string) => Entry[]; onDay: (date: string) => void;
  onCreate?: (date: string, entry: NewEntry) => Promise<void>;
  editing: Editing | null; onEditEnd: (byKey: boolean) => void; onSave: (change: EntryEdit) => Promise<void>; onRemove: (others: { id: string; date: string }[]) => Promise<void>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [marking, setMarking] = useState(false);
  const gesture = useRef<Gesture | null>(null);
  const frame = useRef(0);
  const columns = dates.map(date => {
    const entries = entriesOn(date);
    return { date, untimed: entries.filter(entry => !entry.time), timed: layoutTimed(entries.filter((entry): entry is Entry & { time: string } => Boolean(entry.time))) };
  });
  const earliest = Math.min(7 * 60, ...columns.flatMap(column => column.timed.map(item => item.start)));
  // Scroll to the morning (or the first entry before it) when the shown days change, not on every reload.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (earliest - 30) / 60 * hourHeight);
    setDraft(null);
  }, [dates[0], dates.length]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  // Editing a timed entry shows it as a marked range over its block: moved, resized and saved like a new one.
  const editDraft = useRef(false);
  useEffect(() => {
    if (!editing?.entry.time) {
      // Editing ended elsewhere (another view, a click outside): its range goes with it.
      if (editDraft.current) { editDraft.current = false; setDraft(null); }
      return;
    }
    const start = minutesOf(editing.entry.time);
    editDraft.current = true;
    setDraft({ date: editing.date, start, end: start + durationOf({ time: editing.entry.time, end: editing.entry.end }) });
  }, [editing?.entry.id]);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  // After Enter or Escape the calendar keeps the focus, so its keys work on.
  const refocus = () => (scrollRef.current?.closest('.cal') as HTMLElement | null)?.focus({ preventScroll: true });
  const minutesAt = (column: HTMLElement, y: number) => (y - column.getBoundingClientRect().top) / hourHeight * 60;
  const snap = (value: number) => Math.round(value / snapMinutes) * snapMinutes;
  function follow(y: number) {
    const current = gesture.current;
    if (!current) return;
    current.y = y;
    const at = minutesAt(current.column, y);
    const { origin } = current;
    if (Math.abs(at - current.anchor) / 60 * hourHeight > 3) current.moved = true;
    if (current.mode === 'new') setDraft({ date: current.date, ...snapRange(current.anchor, at) });
    else if (current.mode === 'start') setDraft({ ...origin, start: Math.min(origin.end - snapMinutes, Math.max(0, snap(at))) });
    else if (current.mode === 'end') setDraft({ ...origin, end: Math.max(origin.start + snapMinutes, Math.min(24 * 60, snap(at))) });
    else {
      const length = origin.end - origin.start;
      const start = Math.min(24 * 60 - length, Math.max(0, origin.start + snap(at - current.anchor)));
      setDraft({ ...origin, start, end: start + length });
    }
  }
  // While dragging near the top or bottom of the visible hours, the grid scrolls (faster the closer) and the range follows.
  function autoScroll() {
    const current = gesture.current, scroller = scrollRef.current;
    if (!current || !scroller) return;
    const top = scroller.querySelector('.cal-time-top')!.getBoundingClientRect().bottom, bottom = scroller.getBoundingClientRect().bottom;
    const speed = current.y < top + scrollZone ? -(top + scrollZone - current.y) : current.y > bottom - scrollZone ? current.y - (bottom - scrollZone) : 0;
    if (speed) {
      scroller.scrollTop += Math.max(-scrollSpeed, Math.min(scrollSpeed, speed / 2));
      follow(current.y);
    }
    frame.current = requestAnimationFrame(autoScroll);
  }
  function begin(event: ReactPointerEvent<HTMLElement>, mode: Gesture['mode'], date: string) {
    if (!onCreate || event.button !== 0) return;
    // Marking anew leaves the entry being edited.
    if (mode === 'new' && editing) { editDraft.current = false; onEditEnd(false); }
    const column = (event.currentTarget.closest('.cal-time-column') as HTMLElement | null) ?? event.currentTarget;
    event.preventDefault();
    event.stopPropagation();
    column.setPointerCapture(event.pointerId);
    const anchor = minutesAt(column, event.clientY);
    gesture.current = { mode, column, date, anchor, origin: mode === 'new' ? { date, ...snapRange(anchor, anchor) } : draft!, y: event.clientY, moved: false };
    setMarking(true);
    if (mode === 'new') setDraft(gesture.current.origin);
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(autoScroll);
  }
  function finish() {
    const current = gesture.current;
    if (!current) return;
    gesture.current = null;
    cancelAnimationFrame(frame.current);
    setMarking(false);
    // A click without dragging marks an hour from the clicked quarter.
    if (current.mode === 'new' && !current.moved) {
      const start = Math.min(24 * 60 - snapMinutes, Math.floor(current.anchor / snapMinutes) * snapMinutes);
      setDraft({ date: current.date, start, end: Math.min(24 * 60, start + slotMinutes) });
    }
  }
  const columnHandlers = (date: string) => onCreate ? {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => { if (!(event.target as Element).closest('.cal-item, .cal-selection')) begin(event, 'new', date); },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>) => { if (gesture.current) follow(event.clientY); },
    onPointerUp: finish,
    onLostPointerCapture: finish,
  } : {};

  return <div className={`cal-time${onCreate ? ' can-create' : ''}${marking ? ' is-marking' : ''}`} ref={scrollRef} style={{ '--days': dates.length, '--hour': `${hourHeight}px` } as CSSProperties}>
    <div className="cal-time-top">
      <div className="cal-time-head">
        <span className="cal-time-corner">KW {isoWeek(dates[0])}</span>
        {dates.map(date => {
          const label = <><span className="cal-time-weekday">{formatWeekday(date)}</span><strong>{Number(date.slice(8))}</strong></>;
          const classes = `cal-time-day${weekendClass(date)}${date === today ? ' is-today' : ''}${date === journalDate ? ' is-journal' : ''}`;
          return <button key={date} type="button" className={classes} title={`${formatDate(date)} im Journal öffnen`} onClick={() => onDay(date)}>{label}</button>;
        })}
      </div>
      <div className="cal-time-allday">
        <span className="cal-time-corner">ohne Zeit</span>
        {columns.map(column => <div key={column.date} className={`cal-time-allday-cell${weekendClass(column.date)}`}>
          {column.untimed.map(entry => <CalendarItem key={entry.id} entry={entry} date={column.date} />)}
        </div>)}
      </div>
    </div>
    <div className="cal-time-body">
      <div className="cal-time-hours" aria-hidden="true">{Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * hourHeight }}>{hour ? `${String(hour).padStart(2, '0')}:00` : ''}</span>)}</div>
      {columns.map(column => <div key={column.date} className={`cal-time-column${weekendClass(column.date)}${column.date === today ? ' is-today' : ''}`} {...columnHandlers(column.date)}>
        {column.timed.map(({ item, start, duration, column: index, columns: count }) => <CalendarItem key={item.id} entry={item} date={column.date} variant="block" short={duration < 45}
          style={{ top: start / 60 * hourHeight + 1, height: Math.max(10, duration / 60 * hourHeight - 3), left: `calc(${index / count * 100}% + 2px)`, width: `calc(${100 / count}% - 4px)` }} />)}
        {column.date === today && <div className="cal-now" style={{ top: nowMinutes / 60 * hourHeight }} aria-hidden="true" />}
        {draft?.date === column.date && <div ref={selectionRef} className={`cal-selection${marking ? ' is-marking' : ''}${draft.end - draft.start < 45 ? ' is-short' : ''}`}
          style={{ top: draft.start / 60 * hourHeight, height: (draft.end - draft.start) / 60 * hourHeight }} onPointerDown={event => begin(event, 'move', column.date)}>
          <i className="cal-selection-edge is-start" title="Beginn ziehen" onPointerDown={event => begin(event, 'start', column.date)} />
          <span className="cal-selection-time">{timeOfMinutes(draft.start)} – {timeOfMinutes(draft.end)}</span>
          <span className="cal-selection-length">{formatDuration(draft.end - draft.start)}</span>
          <i className="cal-selection-edge is-end" title="Ende ziehen" onPointerDown={event => begin(event, 'end', column.date)} />
        </div>}
      </div>)}
      {dates.includes(today) && <div className="cal-now-row" style={{ top: nowMinutes / 60 * hourHeight }} aria-hidden="true"><span>{String(now.getHours()).padStart(2, '0')}:{String(now.getMinutes()).padStart(2, '0')}</span></div>}
    </div>
    {draft && !marking && onCreate && (editing && draft.date === editing.date
      ? <CalendarComposer key={editing.entry.id} date={draft.date} draft={draft} entry={editing.entry} anchor={() => selectionRef.current?.getBoundingClientRect() ?? null} onChange={setDraft}
        onCancel={byKey => { setDraft(null); onEditEnd(byKey); }} onSave={async change => { await onSave(change); setDraft(null); }} onRemove={async others => { await onRemove(others); setDraft(null); }} />
      : <CalendarComposer key={`new-${draft.date}`} date={draft.date} draft={draft} anchor={() => selectionRef.current?.getBoundingClientRect() ?? null} onChange={setDraft}
        onCancel={byKey => { setDraft(null); if (byKey) refocus(); }} onCreate={async entry => { await onCreate(draft.date, entry); setDraft(null); refocus(); }} />)}
  </div>;
}

/** Next to the day's hours: the month to pick another day, and the day as the journal has it (title, counts, notes). */
function DaySide({ date, today, journalDate, days, onPick }: { date: string; today: string; journalDate: string | null; days: Map<string, CalendarDay>; onPick: (date: string) => void }) {
  const open = useContext(OpenInJournal);
  const { edit } = useContext(EditInCalendar);
  const [month, setMonth] = useState(date.slice(0, 7));
  useEffect(() => setMonth(date.slice(0, 7)), [date]);
  // Paging the small month on its own needs that month's days for the dots.
  const grid = monthGrid(month);
  const shown = useCalendarData(grid[0], grid[grid.length - 1]).days;
  const day = days.get(date);
  const entries = day?.entries ?? [];
  const tasks = entries.filter(entry => entry.kind === 'task');
  const notes = entries.filter(entry => entry.kind === 'note');
  const events = entries.filter(entry => entry.kind === 'event');
  return <aside className="cal-day-side" aria-label="Tagesübersicht">
    <CompactMonth month={month} days={shown} today={today} selected={date} onMonth={setMonth} onPick={onPick} />
    <section className="cal-day-summary">
      <h2>{formatDate(date)}</h2>
      {day?.title ? <p className="cal-day-name">{day.title}</p> : <p className="cal-day-name is-empty">Ohne Titel</p>}
      <div className="cal-day-stats">
        <span><Icon name="event" />{events.length} {events.length === 1 ? 'Ereignis' : 'Ereignisse'}</span>
        <span><Icon name="task" />{tasks.filter(entry => entry.done).length}/{tasks.length} {tasks.length === 1 ? 'Aufgabe' : 'Aufgaben'} erledigt</span>
      </div>
      {notes.length > 0 && <div className="cal-day-notes">
        <h3>Notizen</h3>
        {notes.map(note => <button key={note.id} type="button" className={`cal-day-note${note.priority ? ' is-priority' : ''}`} onClick={() => open(date, note.id)}
          onContextMenu={event => { if (!edit) return; event.preventDefault(); edit(note, date, event.currentTarget); }}><Icon name={entrySymbol(note)} /><span>{plainText(note.text) || 'ohne Text'}</span></button>)}
      </div>}
      <button type="button" className="cal-open" disabled={date === journalDate} onClick={() => open(date)}><Icon name="jump" />Im Journal öffnen</button>
    </section>
  </aside>;
}
