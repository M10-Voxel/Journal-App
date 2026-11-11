import { useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { t, useLanguage } from '../i18n';
import { formatDate, formatShortDate, localDate, monthGrid, shiftMonth } from '../dates';
import { formatMonthName } from '../calendar';
import { CompactMonth, useCalendarData } from './calendarShared';
import { Icon } from './Icon';
import { Popover } from './Popover';
import './fieldPickers.css';

// A date and a time in a form, picked in the app's own popups instead of the browser's (which no design reaches): the
// date in the month the other calendar popups use, the time in two columns, hours and minutes, that scroll like the
// native picker's. Both are popovers, so every design and popup look dresses them (popup-styles.css).

/** A day: the button shows it, its popup is a month to pick from (days before `min` give `min`). */
export function DateField({ value, min, label, className = '', onChange }: { value: string; min?: string; label: string; className?: string; onChange: (date: string) => void }) {
  useLanguage();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = (focus: boolean) => { setOpen(false); if (focus) button.current?.focus(); };
  return <>
    <button ref={button} type="button" className={`field-trigger is-date ${className}`} data-value={value} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${label}: ${formatDate(value)}`} onClick={() => setOpen(current => !current)}>
      <span>{formatShortDate(value)}</span><Icon name="calendar" />
    </button>
    {open && <Popover anchor={button.current} className="date-pick field-picker is-date" label={label} focus={false} onClose={close}>
      <DateBody value={value} onPick={date => { onChange(min && date < min ? min : date); close(true); }} />
    </Popover>}
  </>;
}

function DateBody({ value, onPick }: { value: string; onPick: (date: string) => void }) {
  useLanguage();
  const [month, setMonth] = useState(value.slice(0, 7));
  const grid = monthGrid(month);
  const { days } = useCalendarData(grid[0], grid[grid.length - 1]);
  const ref = useRef<HTMLDivElement>(null);
  // The chosen day takes the focus, like in the mini calendar.
  useLayoutEffect(() => { ref.current?.querySelector<HTMLElement>('.cal-compact-day[tabindex="0"]')?.focus({ preventScroll: true }); }, []);
  return <div ref={ref}>
    <div className="mini-picker-head"><strong><span className="mini-picker-month">{formatMonthName(`${month}-01`)}</span> <span className="mini-picker-year">{month.slice(0, 4)}</span></strong>
      <button type="button" className="cal-icon-button" aria-label={t("Vorheriger Monat")} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
      <button type="button" className="cal-icon-button" aria-label={t("Nächster Monat")} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
    </div>
    <CompactMonth month={month} days={days} today={localDate()} selected={value} onMonth={setMonth} onPick={onPick} />
  </div>;
}

const pad = (value: number) => String(value).padStart(2, '0');
const hours = Array.from({ length: 24 }, (_, hour) => hour), minutes = Array.from({ length: 60 }, (_, minute) => minute);

/**
 * A time (`HH:MM`): the button shows it, its popup has two columns, hours and minutes, each scrolled to its value.
 * A click on an hour sets it, a minute sets it and closes. Keys: ↑ ↓ change the column's value, ← → switch columns,
 * Enter closes.
 */
export function TimeField({ value, label, className = '', onChange, onClear }: { value: string; label: string; className?: string; onChange: (time: string) => void; onClear?: () => void }) {
  useLanguage();
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = (focus: boolean) => { setOpen(false); if (focus) button.current?.focus(); };
  return <>
    <button ref={button} type="button" className={`field-trigger is-time ${className}`} data-value={value} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`${label}: ${value || t('ohne Uhrzeit')}`} onClick={() => setOpen(current => !current)}>
      <Icon name="clock" /><span>{value || '--:--'}</span>
    </button>
    {/* An optional time can be taken off again. */}
    {onClear && value && <button type="button" className="field-clear" aria-label={t('{0} entfernen', label)} title={t('Entfernen')} onClick={onClear}><Icon name="done" /></button>}
    {open && <Popover anchor={button.current} className="time-pick field-picker is-time" label={label} focus={false} onClose={close}>
      <TimeColumns value={value || '09:00'} onChange={onChange} onDone={() => close(true)} />
    </Popover>}
  </>;
}

export function TimeColumns({ value, onChange, onDone }: { value: string; onChange: (time: string) => void; onDone: () => void }) {
  useLanguage();
  const [hour, minute] = value.split(':').map(Number);
  const root = useRef<HTMLDivElement>(null);
  const set = (h: number, m: number) => onChange(`${pad((h + 24) % 24)}:${pad((m + 60) % 60)}`);
  // Each column keeps its value in the middle (on open and when a key moves it).
  useLayoutEffect(() => {
    for (const column of root.current?.querySelectorAll<HTMLElement>('.time-column') ?? []) {
      const chosen = column.querySelector<HTMLElement>('[aria-selected="true"]');
      if (chosen) column.scrollTop = chosen.offsetTop - column.clientHeight / 2 + chosen.offsetHeight / 2;
    }
  }, [hour, minute]);
  useLayoutEffect(() => { root.current?.querySelector<HTMLElement>('.time-column [aria-selected="true"]')?.focus({ preventScroll: true }); }, []);
  function onKey(event: KeyboardEvent<HTMLDivElement>, part: 'hour' | 'minute') {
    const step = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (step) { if (part === 'hour') set(hour + step, minute); else set(hour, minute + step); }
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') root.current?.querySelectorAll<HTMLElement>('.time-column')[event.key === 'ArrowLeft' ? 0 : 1]?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
    else if (event.key === 'Enter') onDone();
    else return;
    event.preventDefault();
  }
  // The focus follows the value inside its column.
  useLayoutEffect(() => {
    const active = document.activeElement as HTMLElement | null, column = active?.closest('.time-column');
    if (column && root.current?.contains(column)) column.querySelector<HTMLElement>('[aria-selected="true"]')?.focus({ preventScroll: true });
  }, [hour, minute]);
  const column = (part: 'hour' | 'minute', values: number[], current: number) =>
    <div className={`time-column is-${part}`} role="listbox" aria-label={part === 'hour' ? t('Stunde') : t('Minute')} onKeyDown={event => onKey(event, part)}>
      {values.map(value => <button key={value} type="button" role="option" className="time-option" aria-selected={value === current} tabIndex={value === current ? 0 : -1}
        data-value={pad(value)} onClick={() => { if (part === 'hour') set(value, minute); else { set(hour, value); onDone(); } }}>{pad(value)}</button>)}
    </div>;
  return <div ref={root} className="time-columns">
    {column('hour', hours, hour)}
    <span className="time-colon" aria-hidden="true">:</span>
    {column('minute', minutes, minute)}
  </div>;
}
