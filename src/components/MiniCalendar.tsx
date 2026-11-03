import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { localDate } from '../journal';
import { monthGrid, shiftMonth, shiftDate } from '../dates';
import { formatMonthName } from '../calendar';
import { CompactMonth, openInJournal, useCalendarData, useJournalDate, useNow } from './calendarShared';
import { Icon } from './Icon';
import { TagFilter } from './TagFilter';
import { useHiddenTags, useTags } from '../tagStore';
import { filterTagDays } from '../tags';

// The compact month window: a small, separate window to jump to days with one click (like the calendar in
// the macOS menu bar). It follows the journal's month and can stay on top of other windows.
export function MiniCalendar() {
  useLanguage();
  const today = localDate(useNow());
  const journalDate = useJournalDate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [pinned, setPinned] = useState(false);
  const grid = monthGrid(month);
  const { days, error } = useCalendarData(shiftDate(grid[0],-366), grid[grid.length - 1]);
  const tags = useTags();
  const [hiddenTags, setHiddenTags] = useHiddenTags('calendar');
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
        <button type="button" className="cal-icon-button" aria-label={t("Vorheriger Monat")} title={t("Vorheriger Monat · Bild ↑")} onClick={() => setMonth(shiftMonth(month, -1))}><Icon name="left" /></button>
        <button type="button" className="cal-today" title={t("Heute · H")} disabled={month === today.slice(0, 7)} onClick={() => setMonth(today.slice(0, 7))}>{t("Heute")}</button>
        <button type="button" className="cal-icon-button" aria-label={t("Nächster Monat")} title={t("Nächster Monat · Bild ↓")} onClick={() => setMonth(shiftMonth(month, 1))}><Icon name="right" /></button>
        <button type="button" className={`cal-icon-button mini-pin${pinned ? ' is-on' : ''}`} aria-pressed={pinned} aria-label={t("Immer im Vordergrund")} title={t("Immer im Vordergrund")} onClick={togglePin}><Icon name="pin" /></button>
      </div>
    </header>
    {tags.length > 0 && <div className="mini-tag-toolbar"><TagFilter label={t('Tags im Kalender')} hidden={hiddenTags} onChange={setHiddenTags} /></div>}
    {error && <div className="cal-error" role="alert">{error}</div>}
    <CompactMonth month={month} days={filterTagDays(days, hiddenTags)} today={today} selected={journalDate} onMonth={setMonth} onPick={date => openInJournal(date)} />
  </div>;
}
