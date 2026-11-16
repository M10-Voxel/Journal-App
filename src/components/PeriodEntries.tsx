import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import { changePeriodData, usePeriodData } from '../periodStore';
import { movePeriodEntry, periodEntries, withPeriodEntries } from '../periodData';
import type { PeriodEntry } from '../periodData';
import { t, useLanguage } from '../i18n';
import { Icon } from './Icon';

/** Asks the shown period's entries for a new one (Alt A / Alt N while a week … year with entries is on screen). */
export const periodEntryEvent = 'journal:period-entry';

/**
 * A week's … year's own entries (Einstellungen → Funktionen → Einträge): tasks with their check box and notes, kept in
 * the period data (`entries`, by the period's key), not in the calendar. Enter starts the next entry of the same kind,
 * Backspace in an empty one removes it, Alt ↑/↓ moves it among its kind.
 */
export function PeriodEntries({ periodKey, heading = true }: { periodKey: string; heading?: boolean }) {
  useLanguage();
  const { data } = usePeriodData();
  const listRef = useRef<HTMLDivElement>(null);
  const focusId = useRef<string | null>(null);
  const entries = data ? periodEntries(data, periodKey) : [];
  const change = (update: (entries: Record<string, PeriodEntry>) => Record<string, PeriodEntry>) => changePeriodData(current => withPeriodEntries(current, periodKey, update));
  const add = (kind: PeriodEntry['kind']) => {
    const id = crypto.randomUUID();
    focusId.current = id;
    change(current => {
      const order = Math.max(-1, ...Object.values(current).filter(item => item.kind === kind).map(item => item.order)) + 1;
      return { ...current, [id]: { kind, text: '', order } };
    });
  };
  const remove = (id: string, focusBefore = false) => {
    const index = entries.findIndex(item => item.id === id);
    if (focusBefore && index > 0) focusId.current = entries[index - 1].id;
    change(current => { const { [id]: _removed, ...rest } = current; return rest; });
  };
  const patch = (id: string, value: Partial<PeriodEntry>) => change(current => current[id] ? { ...current, [id]: { ...current[id], ...value } } : current);
  // A new (or moved) entry takes the focus once it is on screen.
  useEffect(() => {
    if (!focusId.current) return;
    const field = listRef.current?.querySelector<HTMLInputElement>(`[data-period-entry="${focusId.current}"] .period-entry-text`);
    if (field) { field.focus(); focusId.current = null; }
  });
  useEffect(() => {
    const create = (event: Event) => add((event as CustomEvent<PeriodEntry['kind']>).detail === 'note' ? 'note' : 'task');
    window.addEventListener(periodEntryEvent, create);
    return () => window.removeEventListener(periodEntryEvent, create);
  });
  const key = (entry: PeriodEntry & { id: string }) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
      event.preventDefault(); focusId.current = entry.id;
      changePeriodData(current => movePeriodEntry(current, periodKey, entry.id, event.key === 'ArrowUp' ? -1 : 1));
    } else if (event.key === 'Enter' && !event.altKey && !event.shiftKey) { event.preventDefault(); add(entry.kind); }
    else if (event.key === 'Backspace' && !entry.text) { event.preventDefault(); remove(entry.id, true); }
  };
  const labels = { task: t('Aufgabe'), note: t('Notiz') };
  return <div className="period-entries">
    <div className="checklist-section-heading">
      <div>{heading && <h3>{t('Einträge')}<span className="entry-count">{entries.length}</span></h3>}<p className="page-hint">{t('Aufgaben und Notizen für diesen Zeitraum.')}</p></div>
      <div className="kind-picker" role="group" aria-label={t('Eintrag hinzufügen')}>
        {(['task', 'note'] as const).map(kind => <button type="button" key={kind} title={t('Neu · Alt {0}', kind === 'task' ? 'A' : 'N')} onClick={() => add(kind)}><Icon name={kind} />{labels[kind]}</button>)}
      </div>
    </div>
    <div className="period-entry-list" ref={listRef}>
      {!entries.length && <p className="checklist-empty">{t('Noch keine Einträge für diesen Zeitraum.')}</p>}
      {entries.map((entry, index) => <div key={entry.id} className={`period-entry is-${entry.kind}${index > 0 && entries[index - 1].kind !== entry.kind ? ' is-group-start' : ''}`} data-period-entry={entry.id} data-done={entry.done || undefined}>
        {entry.kind === 'task'
          ? <button type="button" className="period-entry-symbol" aria-pressed={!!entry.done} aria-label={entry.done ? t('Als offen markieren') : t('Als erledigt markieren')} onClick={() => patch(entry.id, { done: !entry.done })}><Icon name={entry.done ? 'done' : 'task'} /></button>
          : <span className="period-entry-symbol" aria-hidden="true"><Icon name="note" /></span>}
        <input className="period-entry-text" type="text" spellCheck={false} aria-label={labels[entry.kind]} placeholder={entry.kind === 'task' ? t('Neue Aufgabe …') : t('Neue Notiz …')} value={entry.text}
          onChange={event => patch(entry.id, { text: event.target.value })} onKeyDown={key(entry)} />
        <button type="button" className="period-entry-remove" aria-label={`${labels[entry.kind]}: ${t('Löschen')}`} title={t('Löschen')} onClick={() => remove(entry.id)}><Icon name="trash" /></button>
      </div>)}
    </div>
  </div>;
}
