import { t, useLanguage, getLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { formatDate, formatMonth, formatShortDate, localDate, monthGrid, shiftDate, shiftMonth } from '../dates';
import { nextFullHour, pickedDays } from '../planning';
import type { Schedule } from '../planning';
import { defaultRule, describe, occurrences, withStart } from '../repeat';
import type { RepeatRule } from '../repeat';
import { ClockDial } from './ClockDial';
import { RepeatPanel } from './RepeatPanel';
import { Icon } from './Icon';

const weekdayInitials = () => getLanguage() === 'en' ? ['M','T','W','T','F','S','S'] : ['M','D','M','D','F','S','S'];

// Month calendar with optional time, reminder and repetition.
// Keyboard: arrows move the day, Page↑/↓ the month, H today, U clock, W repeat, E reminder, Entf clears the time, Enter plans, Escape goes back.
// "Mehrere Tage" is chosen before opening (its own action, Alt ⇧ T) and stays for the whole planner: two left clicks (or Space)
// set a range; right clicks (or Shift+Space) take days out of it or add days outside it. The entry is planned to all picked days.
// Several days do not repeat; so there is no switching between the two inside the planner.
// "Wiederholen" (W or the ↻ toggle, only when planning one day): the repeat view (see RepeatPanel) lies over the calendar like the clock; the calendar then
// marks the occurrences. A new repetition starts on the chosen date; an entry repeating already keeps its series' start.
// Choosing an end date ("Datum") turns the calendar into a picker for that day until one is clicked.
export type PlannerView = 'date' | 'time' | 'days' | 'repeat';
export function PlanCalendar({ day, initial, initialView = 'date', onPreview, onConfirm, onCancel }: {
  day: string; initial: { date: string; repeat?: RepeatRule | null } & Schedule; initialView?: PlannerView;
  onPreview: (date: string, count: number) => void; onConfirm: (dates: string[], schedule: Schedule, repeat: RepeatRule | null) => void; onCancel: () => void;
}) {
  useLanguage();
  const [selected, setSelected] = useState(initial.date);
  const [month, setMonth] = useState(initial.date.slice(0, 7));
  const [time, setTime] = useState(initial.time || (initialView === 'time' ? nextFullHour() : ''));
  const [reminder, setReminder] = useState(initial.reminder);
  const [rule, setRule] = useState<RepeatRule | null>(initial.repeat ?? (initialView === 'repeat' ? defaultRule(initial.date) : null));
  const [view, setView] = useState<'date' | 'time' | 'repeat'>(initialView === 'time' || initialView === 'repeat' ? initialView : 'date');
  const [pickEnd, setPickEnd] = useState(false);
  const [endCursor, setEndCursor] = useState(initial.date);
  const multi = initialView === 'days';
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [toggled, setToggled] = useState<string[]>([]);
  const picked = pickedDays(range, toggled, day);
  const gridRef = useRef<HTMLDivElement>(null);
  const focusSelected = useRef(initialView !== 'time' && initialView !== 'repeat');
  const today = localDate();
  const moved = multi ? picked.length > 0 : selected !== day;
  const grid = monthGrid(month);
  // The repetition the calendar shows; several days are planned without one.
  const shownRule = multi ? null : rule;
  const repeating = new Set(shownRule ? occurrences(shownRule, grid[0], grid[grid.length - 1], grid.length) : []);
  const cursor = pickEnd ? endCursor : selected;

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
    setPickEnd(false);
    setView('date');
  }
  function toggleClock() {
    if (view === 'time') { showCalendar(); return; }
    if (!time) setTime(nextFullHour());
    setPickEnd(false);
    setView('time');
  }
  function toggleRepeat() {
    if (view === 'repeat') { showCalendar(); return; }
    if (multi) return;
    if (!rule) setRule(defaultRule(selected));
    setPickEnd(false);
    setView('repeat');
  }
  function stopRepeat() {
    setRule(null);
    showCalendar();
  }
  function startPickEnd() {
    focusSelected.current = true;
    setEndCursor(rule?.end?.until ?? selected);
    setMonth((rule?.end?.until ?? selected).slice(0, 7));
    setPickEnd(true);
    setView('date');
  }
  function chooseEnd(date: string) {
    setRule(current => current && { ...current, end: { until: date < current.start ? current.start : date } });
    setPickEnd(false);
    setView('repeat');
  }
  function clearTime() {
    setTime('');
    if (view === 'time') showCalendar();
  }
  // A new repetition starts on the chosen date; one the entry has already stays with its series.
  const ruleFor = (date: string) => rule && !initial.repeat ? withStart(rule, date) : rule;
  function select(date: string, focus = false) {
    focusSelected.current = focus;
    setSelected(date);
    setMonth(date.slice(0, 7));
    setRule(ruleFor(date));
  }
  function moveCursor(date: string) {
    if (!pickEnd) { select(date, true); return; }
    focusSelected.current = true;
    setEndCursor(date);
    setMonth(date.slice(0, 7));
  }
  const confirm = () => { if (!multi || picked.length) onConfirm(multi ? picked : [selected], { time: time || null, reminder }, multi ? initial.repeat ?? null : rule); };
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
    if (event.key in steps) moveCursor(shiftDate(cursor, steps[event.key]));
    else if (event.key === 'PageUp' || event.key === 'PageDown') {
      const target = shiftMonth(cursor.slice(0, 7), event.key === 'PageUp' ? -1 : 1);
      const lastDay = monthGrid(target).filter(date => date.startsWith(target)).at(-1)!;
      moveCursor(`${target}-${cursor.slice(8)}` > lastDay ? lastDay : `${target}-${cursor.slice(8)}`);
    } else if (event.key === 'Enter') { if (pickEnd) chooseEnd(endCursor); else confirm(); }
    else if (event.key === ' ' && multi) { if (event.shiftKey) flip(selected); else setPoint(selected); }
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  // tabIndex -1: clicks on empty parts of the panel keep focus inside the entry instead of closing it.
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    if (event.key === 'Escape') { if (pickEnd) { setPickEnd(false); setView('repeat'); } else if (view !== 'date') showCalendar(); else onCancel(); }
    else if (event.key === 'Enter' && (target.classList.contains('clock-face') || target.classList.contains('repeat'))) confirm();
    else if (event.code === 'KeyU') toggleClock();
    else if (event.code === 'KeyW') toggleRepeat();
    else if (event.code === 'KeyE') setReminder(value => !value);
    else if (event.code === 'KeyH' && view === 'date') moveCursor(today);
    else if (event.key === 'Delete' && time) clearTime();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const confirmIcon = multi ? 'scheduled-multi' : moved ? 'scheduled' : rule ? 'repeat' : 'check';
  // tabIndex -1: clicks on empty parts of the panel keep focus inside the entry instead of closing it.
  // The calendar stays rendered under the clock and the repeat view, so switching views never changes the panel's size.
  return <div className={`planner is-${view}${multi ? ' is-multi' : ''}${pickEnd ? ' is-picking-end' : ''}`} role="dialog" aria-label={t("Planen")} tabIndex={-1} onKeyDown={onKey}>
    <div className="planner-body">
    <div className="planner-calendar" inert={view !== 'date'} aria-hidden={view !== 'date'}>
    {/* Picking the end looks like the calendar card's end picker: back on the left, the month, ↑ ↓ to turn months. */}
    {pickEnd ? <div className="planner-head is-picking-end">
      <button type="button" className="planner-nav" aria-label={t("Zurück zur Wiederholung")} data-tip={t("Zurück · Esc")} onClick={() => { setPickEnd(false); setView('repeat'); }}><Icon name="left" /></button>
      <span className="planner-month" key={`${month}-end`} aria-live="polite"><em>{t("Ende · ")}</em>{formatMonth(month)}</span>
      <button type="button" className="planner-nav" aria-label={t("Vorheriger Monat")} onClick={() => setMonth(current => shiftMonth(current, -1))}><Icon name="up" /></button>
      <button type="button" className="planner-nav" aria-label={t("Nächster Monat")} onClick={() => setMonth(current => shiftMonth(current, 1))}><Icon name="down" /></button>
    </div> : <div className="planner-head">
      <button type="button" className="planner-nav" aria-label={t("Vorheriger Monat")} onClick={() => setMonth(current => shiftMonth(current, -1))}><Icon name="left" /></button>
      <span className="planner-month" key={month} aria-live="polite">{formatMonth(month)}</span>
      {!multi && <button type="button" className="planner-repeat" aria-pressed={Boolean(shownRule)} aria-label={shownRule ? t("Wiederholen: {0}", describe(shownRule)) : t("Wiederholen")} data-tip={shownRule ? `${describe(shownRule)} · W` : t("Wiederholen · W")} onClick={toggleRepeat}>
        <Icon name="repeat" />
      </button>}
      <button type="button" className="planner-nav" aria-label={t("Nächster Monat")} onClick={() => setMonth(current => shiftMonth(current, 1))}><Icon name="right" /></button>
    </div>}
    <div className="planner-weekdays" aria-hidden="true">{weekdayInitials().map((initial, index) => <span key={index}>{initial}</span>)}</div>
    <div className="planner-grid" role="grid" aria-label={pickEnd ? t("Ende wählen, {0}", formatMonth(month)) : formatMonth(month)} ref={gridRef} onKeyDown={onGridKey}>
      {grid.map(date => <button key={date} type="button" role="gridcell" tabIndex={date === cursor ? 0 : -1}
        className={`planner-day${date.startsWith(month) ? '' : ' is-outside'}${date === today ? ' is-today' : ''}${date === day ? ' is-origin' : ''}${date < today ? ' is-past' : ''}${(multi || pickEnd) && date === cursor ? ' is-cursor' : ''}${multi ? rangeClass(date) : ''}${repeating.has(date) ? ' is-repeat' : ''}${shownRule?.end?.until === date ? ' is-repeat-end' : ''}`}
        aria-selected={multi ? picked.includes(date) : date === selected} aria-current={(multi || pickEnd) && date === cursor ? 'true' : undefined}
        aria-label={`${formatDate(date)}${date === day ? t(", aktueller Tag") : ''}${repeating.has(date) ? t(", Wiederholung") : ''}`}
        onClick={() => { if (pickEnd) { chooseEnd(date); return; } select(date); if (multi) setPoint(date); }}
        onDoubleClick={() => { if (!multi && !pickEnd) onConfirm([date], { time: time || null, reminder }, ruleFor(date)); }}
        onContextMenu={event => { if (!multi) return; event.preventDefault(); select(date); flip(date); }}>
        <span>{Number(date.slice(8))}</span>
      </button>)}
    </div>
    </div>
    {view === 'time' && <ClockDial time={time} onChange={setTime} onBack={showCalendar} />}
    {view === 'repeat' && rule && <RepeatPanel rule={rule} today={today} onBack={showCalendar} onOff={stopRepeat} onPickEnd={startPickEnd}
      onChange={next => {
        // A written rule may begin on another day ("am 15.", "Karfreitag"); a new repetition then plans the entry there.
        if (!initial.repeat && next.start !== selected) { setSelected(next.start); setMonth(next.start.slice(0, 7)); }
        setRule(next);
      }} />}
    </div>
    <div className="planner-foot">
      <div className={`planner-time${time ? ' is-set' : ''}${view === 'time' ? ' is-active' : ''}`}>
        <button type="button" className="planner-time-toggle" aria-pressed={view === 'time'} aria-label={view === 'time' ? t("Zurück zum Kalender") : time ? t("Uhrzeit {0} ändern", time) : t("Uhrzeit wählen (optional)")} data-tip={view === 'time' ? t("Kalender · U") : t("Uhrzeit · U")} onClick={toggleClock}>
          <Icon name={view === 'time' ? 'calendar' : 'clock'} /><span key={time}>{time || '--:--'}</span>
        </button>
        {time && <button type="button" className="planner-clear" aria-label={t("Uhrzeit entfernen")} data-tip={t("Entfernen · Entf")} onClick={clearTime}><Icon name="done" /></button>}
      </div>
      <button type="button" className="planner-reminder" aria-pressed={reminder} aria-label={t("Erinnern")} data-tip={`${reminder ? t("Erinnerung an") : t("Erinnern")} ${time ? t("um {0}", time) : t("um 9:00")} · E`} onClick={() => setReminder(value => !value)}>
        <Icon name="bell" key={String(reminder)} />
      </button>
      <button type="button" className={`planner-confirm${moved ? ' is-move' : ''}`} disabled={(multi && !picked.length) || pickEnd}
        aria-label={`${multi ? t("Planen auf {0} Tage", picked.length) : moved ? t("Planen auf {0}", formatDate(selected)) : t("Übernehmen")}${time ? t(", {0} Uhr", time) : ''}${shownRule ? `, ${describe(shownRule)}` : ''}`} data-tip="Enter" onClick={confirm}>
        <Icon name={confirmIcon} key={confirmIcon} />
        <span key={multi ? picked.length : selected}>{multi ? picked.length === 1 ? formatShortDate(picked[0]) : t("{0} Tage", picked.length) : moved ? formatShortDate(selected) : t("Hier")}</span>
      </button>
    </div>
  </div>;
}
