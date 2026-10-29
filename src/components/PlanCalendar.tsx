import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatDate, formatMonth, formatShortDate, localDate, monthGrid, shiftDate, shiftMonth } from '../dates';
import { nextFullHour, pickedDays } from '../planning';
import type { Schedule } from '../planning';
import { ClockDial } from './ClockDial';
import { Icon } from './Icon';

const weekdayInitials = ['M', 'D', 'M', 'D', 'F', 'S', 'S'];

// Month calendar with optional time and reminder.
// Keyboard: arrows move the day, Page↑/↓ the month, H today, U clock, E reminder, Entf clears the time, Enter plans, Escape goes back.
// "Mehrere Tage" (M or the ⇇ toggle): two left clicks (or Space) set a range; right clicks (or Shift+Space) take days out of it
// or add days outside it. The entry is planned to all picked days.
export type PlannerView = 'date' | 'time' | 'days';
export function PlanCalendar({ day, initial, initialView = 'date', onPreview, onConfirm, onCancel }: {
  day: string; initial: { date: string } & Schedule; initialView?: PlannerView;
  onPreview: (date: string, count: number) => void; onConfirm: (dates: string[], schedule: Schedule) => void; onCancel: () => void;
}) {
  const [selected, setSelected] = useState(initial.date);
  const [month, setMonth] = useState(initial.date.slice(0, 7));
  const [time, setTime] = useState(initial.time || (initialView === 'time' ? nextFullHour() : ''));
  const [reminder, setReminder] = useState(initial.reminder);
  const [view, setView] = useState<'date' | 'time'>(initialView === 'time' ? 'time' : 'date');
  const [multi, setMulti] = useState(initialView === 'days');
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [toggled, setToggled] = useState<string[]>([]);
  const picked = pickedDays(range, toggled, day);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusSelected = useRef(initialView !== 'time');
  const today = localDate();
  const moved = multi ? picked.length > 0 : selected !== day;

  useEffect(() => { onPreview(multi ? picked[0] ?? day : selected, multi ? picked.length : 1); }, [selected, multi, picked]);
  useEffect(() => {
    gridRef.current?.closest('.entry-dock-shell')?.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, []);
  useLayoutEffect(() => {
    if (!focusSelected.current) return;
    focusSelected.current = false;
    gridRef.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus({ preventScroll: true });
  });

  function showCalendar() {
    focusSelected.current = true;
    setView('date');
  }
  function toggleClock() {
    if (view === 'time') { showCalendar(); return; }
    if (!time) setTime(nextFullHour());
    setView('time');
  }
  function clearTime() {
    setTime('');
    if (view === 'time') showCalendar();
  }
  function select(date: string, focus = false) {
    focusSelected.current = focus;
    setSelected(date);
    setMonth(date.slice(0, 7));
  }
  const confirm = () => { if (!multi || picked.length) onConfirm(multi ? picked : [selected], { time: time || null, reminder }); };
  function toggleMulti() {
    setMulti(current => !current);
    setRange(null); setPending(null); setToggled([]);
    focusSelected.current = true;
  }
  /** Left click: the first click starts a range, the second closes it (a third starts a new one, clearing the flips). */
  function setPoint(date: string) {
    if (pending) { setRange({ from: [pending, date].sort()[0], to: [pending, date].sort()[1] }); setPending(null); return; }
    setPending(date);
    setRange({ from: date, to: date });
    setToggled([]);
  }
  /** Right click: flips a single day, out of the range or in addition to it. */
  function flip(date: string) {
    if (date === day) return;
    setToggled(current => current.includes(date) ? current.filter(value => value !== date) : [...current, date]);
  }

  // Cell look in multi mode: the range is a continuous band; flipped days are holes in it, or single dots outside.
  function rangeClass(date: string): string {
    const inside = range !== null && date >= range.from && date <= range.to;
    const isPicked = picked.includes(date);
    return `${inside ? ' in-range' : ''}${inside && date === range!.from ? ' range-start' : ''}${inside && date === range!.to ? ' range-end' : ''}${date === pending ? ' is-pending' : ''}${isPicked ? ' is-picked' : ''}${inside && !isPicked && date !== day ? ' is-excluded' : ''}${!inside && isPicked ? ' is-added' : ''}`;
  }

  function onGridKey(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in steps) select(shiftDate(selected, steps[event.key]), true);
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const target = shiftMonth(selected.slice(0, 7), event.key === 'PageUp' ? -1 : 1);
      const lastDay = monthGrid(target).filter(date => date.startsWith(target)).at(-1)!;
      select(`${target}-${selected.slice(8)}` > lastDay ? lastDay : `${target}-${selected.slice(8)}`, true);
    } else if (event.key === 'Enter') confirm();
    else if (event.key === ' ' && multi) { if (event.shiftKey) flip(selected); else setPoint(selected); }
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  // tabIndex -1: clicks on empty parts of the panel keep focus inside the entry instead of closing it.
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key === 'Escape') { if (view === 'time') showCalendar(); else onCancel(); }
    else if (event.key === 'Enter' && (event.target as HTMLElement).classList.contains('clock-face')) confirm();
    else if (event.code === 'KeyU') toggleClock();
    else if (event.code === 'KeyE') setReminder(value => !value);
    else if (event.code === 'KeyH' && view === 'date') select(today, true);
    else if (event.code === 'KeyM' && view === 'date') toggleMulti();
    else if (event.key === 'Delete' && time) clearTime();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  // tabIndex -1: clicks on empty parts of the panel keep focus inside the entry instead of closing it.
  // The calendar stays rendered under the clock, so switching views never changes the panel's size.
  return <div className={`planner is-${view}${multi ? ' is-multi' : ''}`} role="dialog" aria-label="Planen" tabIndex={-1} onKeyDown={onKey}>
    <div className="planner-body">
    <div className="planner-calendar" inert={view === 'time'} aria-hidden={view === 'time'}>
    <div className="planner-head">
      <button type="button" className="planner-nav" aria-label="Vorheriger Monat" onClick={() => setMonth(current => shiftMonth(current, -1))}><Icon name="left" /></button>
      <span className="planner-month" key={month} aria-live="polite">{formatMonth(month)}</span>
      <button type="button" className="planner-multi" aria-pressed={multi} aria-label="Mehrere Tage" data-tip="Mehrere Tage · M — Klick: Bereich, Rechtsklick: Tag an/aus" onClick={toggleMulti}>
        <Icon name="scheduled-multi" />
      </button>
      <button type="button" className="planner-nav" aria-label="Nächster Monat" onClick={() => setMonth(current => shiftMonth(current, 1))}><Icon name="right" /></button>
    </div>
    <div className="planner-weekdays" aria-hidden="true">{weekdayInitials.map((initial, index) => <span key={index}>{initial}</span>)}</div>
    <div className="planner-grid" role="grid" aria-label={formatMonth(month)} ref={gridRef} onKeyDown={onGridKey}>
      {monthGrid(month).map(date => <button key={date} type="button" role="gridcell" tabIndex={date === selected ? 0 : -1}
        className={`planner-day${date.startsWith(month) ? '' : ' is-outside'}${date === today ? ' is-today' : ''}${date === day ? ' is-origin' : ''}${date < today ? ' is-past' : ''}${multi && date === selected ? ' is-cursor' : ''}${multi ? rangeClass(date) : ''}`}
        aria-selected={multi ? picked.includes(date) : date === selected} aria-current={multi && date === selected ? 'true' : undefined} aria-label={`${formatDate(date)}${date === day ? ', aktueller Tag' : ''}`}
        onClick={() => { select(date); if (multi) setPoint(date); }} onDoubleClick={() => { if (!multi) onConfirm([date], { time: time || null, reminder }); }}
        onContextMenu={event => { if (!multi) return; event.preventDefault(); select(date); flip(date); }}>
        <span>{Number(date.slice(8))}</span>
      </button>)}
    </div>
    </div>
    {view === 'time' && <ClockDial time={time} onChange={setTime} onBack={showCalendar} />}
    </div>
    <div className="planner-foot">
      <div className={`planner-time${time ? ' is-set' : ''}${view === 'time' ? ' is-active' : ''}`}>
        <button type="button" className="planner-time-toggle" aria-pressed={view === 'time'} aria-label={view === 'time' ? 'Zurück zum Kalender' : time ? `Uhrzeit ${time} ändern` : 'Uhrzeit wählen (optional)'} data-tip={view === 'time' ? 'Kalender · U' : 'Uhrzeit · U'} onClick={toggleClock}>
          <Icon name={view === 'time' ? 'calendar' : 'clock'} /><span key={time}>{time || '--:--'}</span>
        </button>
        {time && <button type="button" className="planner-clear" aria-label="Uhrzeit entfernen" data-tip="Entfernen · Entf" onClick={clearTime}><Icon name="done" /></button>}
      </div>
      <button type="button" className="planner-reminder" aria-pressed={reminder} aria-label="Erinnern" data-tip={reminder ? 'Erinnerung an · E' : 'Erinnern · E'} onClick={() => setReminder(value => !value)}>
        <Icon name="bell" key={String(reminder)} />
      </button>
      <button type="button" className={`planner-confirm${moved ? ' is-move' : ''}`} disabled={multi && !picked.length}
        aria-label={`${multi ? `Planen auf ${picked.length} Tage` : moved ? `Planen auf ${formatDate(selected)}` : 'Übernehmen'}${time ? `, ${time} Uhr` : ''}`} data-tip="Enter" onClick={confirm}>
        <Icon name={multi ? 'scheduled-multi' : moved ? 'scheduled' : 'check'} />
        <span key={multi ? picked.length : selected}>{multi ? picked.length === 1 ? formatShortDate(picked[0]) : `${picked.length} Tage` : moved ? formatShortDate(selected) : 'Hier'}</span>
      </button>
    </div>
  </div>;
}
