import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { localDate, monthGrid, shiftMonth } from '../dates';
import { formatMonthName, formatWeekdayLong } from '../calendar';
import { CompactMonth, useCalendarData, useNow } from './calendarShared';
import { Icon } from './Icon';
import { useDismissLayer } from './useDismissLayer';

/** The existing compact calendar, used as a date picker without a native Windows popup. `children` replace the button's
 *  own label (weekday, date, icon), e.g. the book's page title. */
export function MiniCalendarPicker({ date, open, onOpenChange, onPick, buttonRef, className = 'date-picker-button', children }: {
  date: string; open: boolean; onOpenChange: (open: boolean) => void; onPick: (date: string) => void; buttonRef: RefObject<HTMLButtonElement | null>;
  className?: string; children?: ReactNode;
}) {
  useLanguage();
  const rootRef = useRef<HTMLDivElement>(null);
  return <div className="mini-calendar-picker" ref={rootRef}>
    <button ref={buttonRef} type="button" className={className} aria-label={children ? undefined : t("Datum auswählen")} title={t("Mini-Kalender · Strg G")} aria-expanded={open} aria-controls="journal-mini-calendar" onClick={() => onOpenChange(!open)}>
      {children ?? <><span className="date-picker-weekday">{formatWeekdayLong(date)}</span><span>{date.split('-').reverse().join('.')}</span><Icon name="calendar" /></>}
    </button>
    {open && <PickerPanel date={date} rootRef={rootRef} onPick={value => { onPick(value); onOpenChange(false); buttonRef.current?.focus(); }} onClose={restore => { onOpenChange(false); if (restore) buttonRef.current?.focus(); }} />}
  </div>;
}

function PickerPanel({ date, rootRef, onPick, onClose }: {
  date: string; rootRef: RefObject<HTMLDivElement | null>; onPick: (date: string) => void; onClose: (restore: boolean) => void;
}) {
  useLanguage();
  const [month, setMonth] = useState(date.slice(0, 7));
  const today = localDate(useNow());
  const grid = monthGrid(month);
  const { days, error } = useCalendarData(grid[0], grid[grid.length - 1]);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useDismissLayer({element:()=>panelRef.current,anchor:()=>rootRef.current,onDismiss:()=>closeRef.current(false)});
  useEffect(() => {
    const frame = requestAnimationFrame(() => panelRef.current?.querySelector<HTMLElement>('.cal-compact-day[tabindex="0"]')?.focus());
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); closeRef.current(true); } };
    window.addEventListener('keydown', escape);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', escape); };
  }, []);
  return <div ref={panelRef} className="mini-picker-panel" role="dialog" aria-label={t("Mini-Kalender")} id="journal-mini-calendar"
    onKeyDown={event => {
      if (event.key === 'Escape' || (event.ctrlKey && event.code === 'KeyG')) { event.preventDefault(); onClose(true); }
      if (event.key === 'Tab') {
        const buttons = [...panelRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled):not([tabindex="-1"])')];
        const first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      event.stopPropagation();
    }}>
    <div className="mini-picker-head"><strong>{formatMonthName(`${month}-01`)} <span>{month.slice(0, 4)}</span></strong>
      <button type="button" className="cal-icon-button" aria-label={t("Vorheriger Monat")} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
      <button type="button" className="cal-icon-button" aria-label={t("Nächster Monat")} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
    </div>
    {error && <div className="mini-picker-error" role="alert">{error}</div>}
    <CompactMonth month={month} days={days} today={today} selected={date} onMonth={setMonth} onPick={onPick} />
    <div className="mini-picker-foot"><button type="button" onClick={() => onPick(today)}>{t("Heute")}</button><span className="page-hint">{t("← → Tage · Bild ↑ ↓ Monat")}</span></div>
  </div>;
}
