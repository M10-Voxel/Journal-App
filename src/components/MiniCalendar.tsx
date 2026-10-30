import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { localDate } from '../journal';
import { monthGrid, shiftMonth } from '../dates';
import { formatMonthName } from '../calendar';
import { CompactMonth, openInJournal, useCalendarData, useJournalDate, useNow } from './calendarShared';
import { Icon } from './Icon';

// The compact month window: a small, separate window to jump to days with one click (like the calendar in
// the macOS menu bar). It follows the journal's month and can stay on top of other windows.
export function MiniCalendar() {
  const today = localDate(useNow());
  const journalDate = useJournalDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [pinned, setPinned] = useState(false);
  const grid = monthGrid(month);
  const { days, error } = useCalendarData(grid[0], grid[grid.length - 1]);
  useEffect(() => { if (journalDate) setMonth(journalDate.slice(0, 7)); }, [journalDate]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key === 'h' || event.key === 'H') setMonth(today.slice(0, 7));
      else if (event.key === 'PageUp' || event.key === 'PageDown') setMonth(current => shiftMonth(current, event.key === 'PageUp' ? -1 : 1));
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [today]);
  function togglePin() {
    const next = !pinned;
    void getCurrentWindow().setAlwaysOnTop(next).then(() => setPinned(next), () => {});
  }

  return <div className="mini" onWheel={event => { if (Math.abs(event.deltaY) > 4) setMonth(current => shiftMonth(current, event.deltaY > 0 ? 1 : -1)); }}>
    <header className="mini-head">
      <h1 className="cal-title" key={month}><strong>{formatMonthName(`${month}-01`)}</strong> <span>{month.slice(0, 4)}</span></h1>
      <div className="mini-actions">
        <button type="button" className="cal-icon-button" aria-label="Vorheriger Monat" title="Vorheriger Monat · Bild ↑" onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
        <button type="button" className="cal-today" title="Heute · H" disabled={month === today.slice(0, 7)} onClick={() => setMonth(today.slice(0, 7))}>Heute</button>
        <button type="button" className="cal-icon-button" aria-label="Nächster Monat" title="Nächster Monat · Bild ↓" onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
        <button type="button" className={`cal-icon-button mini-pin${pinned ? ' is-on' : ''}`} aria-pressed={pinned} aria-label="Immer im Vordergrund" title="Immer im Vordergrund" onClick={togglePin}><Icon name="pin" /></button>
      </div>
    </header>
    {error && <div className="cal-error" role="alert">{error}</div>}
    <CompactMonth month={month} days={days} today={today} selected={journalDate} onMonth={setMonth} onPick={date => openInJournal(date)} />
  </div>;
}
