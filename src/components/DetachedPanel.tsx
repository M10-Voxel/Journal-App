import { useEffect, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { t, useLanguage } from '../i18n';
import { localDate } from '../dates';
import { BulletinBoard } from './BulletinBoard';
import { Calendar } from './CalendarWindow';
import { openInJournal, useJournalDate } from './calendarShared';
import { Notebook } from './Notebook';
import { windowGrips } from './useFloatingWindow';
import { requestCalendarCreate, requestCalendarMove } from '../calendarRequests';
import type { BoardPeriod } from '../boardPlacement';

/** What can leave the journal as a window of its own: windows whose data every window keeps in step. */
export type DetachedKind = 'calendar' | 'notebook' | 'board';
export const detachable: readonly DetachedKind[] = ['calendar', 'notebook', 'board'];

type ResizeDirection = Parameters<ReturnType<typeof getCurrentWindow>['startResizeDragging']>[0];
const directions: Record<string, ResizeDirection> = { n: 'North', s: 'South', w: 'West', e: 'East', nw: 'NorthWest', ne: 'NorthEast', sw: 'SouthWest', se: 'SouthEast' };

/**
 * A window of Nebula's desk pulled out of the journal (NebulaDesk): the same frame as in the app, drawn by the page
 * (the window has no system frame, shadow or rounded corners). Its bar moves the window, its edges resize it; the calendar
 * and the board follow the day the journal shows. "Zurück" puts it back into the journal's desk.
 */
export function DetachedPanel({ kind }: { kind: DetachedKind }) {
  useLanguage();
  const window = getCurrentWindow();
  const date = useJournalDate() ?? localDate();
  const [boardContext, setBoardContext] = useState<{ date: string; period: BoardPeriod } | null>(null);
  useEffect(() => {
    if (kind !== 'board') return;
    let active = true;
    const stop = listen<{ date: string; period: BoardPeriod }>('journal:board-context', event => { if (active) setBoardContext(event.payload); });
    void stop.then(() => { if (active) void emit('journal:hello'); });
    return () => { active = false; void stop.then(unlisten => unlisten()); };
  }, [kind]);
  const label = kind === 'calendar' ? t('Kalender') : kind === 'notebook' ? t('Notizen') : t('Pinnwand');
  const command = kind === 'calendar' ? './calendar.sh' : kind === 'notebook' ? './notes.sh --tree' : `./board.sh${boardContext ? ` --${boardContext.period} ${boardContext.date}` : ''}`;
  const back = async () => { await emit('nebula:panel-return', kind).catch(() => {}); await window.close(); };
  return <div className="nebula-detached">
    <section className={`nebula-terminal nebula-panel is-${kind} is-detached`} aria-label={label}>
      <header className="nebula-terminal-head nebula-panel-head" onMouseDown={event => {
        if (event.button !== 0 || (event.target as Element).closest('button')) return;
        event.preventDefault();
        void (event.detail === 2 ? window.toggleMaximize() : window.startDragging());
      }}>
        <span className="nebula-prompt" aria-hidden="true"><b>[journal@~]$</b> {command}</span>
        <span className="visually-hidden">{label}</span>
        <span className="nebula-window-tools">
          <button type="button" className="nebula-panel-return" aria-label={t('{0} zurück in die App', label)} title={t('Zurück in die App')} onClick={() => void back()}>⇲</button>
          <button type="button" className="nebula-panel-minimize" aria-label={t('{0} minimieren', label)} title={t('Minimieren')} onClick={() => void window.minimize()}>_</button>
          <button type="button" className="nebula-calendar-close" aria-label={t('{0} schließen', label)} title={t('Schließen')} onClick={() => void window.close()}>×</button>
        </span>
      </header>
      <div className="nebula-terminal-body nebula-panel-body nebula-detached-body">
        {kind === 'calendar' ? <Calendar embedded withoutDay journalDate={date} onOpen={openInJournal} onCreate={requestCalendarCreate} onMove={requestCalendarMove} /> : kind === 'notebook' ? <Notebook /> : boardContext ? <BulletinBoard key={`${boardContext.period}:${boardContext.date}`} date={boardContext.date} period={boardContext.period} /> : <p role="status">{t('Wird geladen …')}</p>}
      </div>
      {windowGrips.map(grip => <span key={grip.name} className={`nebula-grip is-${grip.name}`} aria-hidden="true"
        onMouseDown={event => { if (event.button === 0) { event.preventDefault(); void window.startResizeDragging(directions[grip.name]); } }} />)}
    </section>
  </div>;
}
