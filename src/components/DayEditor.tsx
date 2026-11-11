import type { RefObject } from 'react';
import type { Day, Entry, EntryKind, LinkedAction } from '../journal';
import { t } from '../i18n';
import { entryKindOrder, sameGroup } from '../entries';
import { filterKey, tagOf } from '../tags';
import type { Tag } from '../tags';
import { Icon } from './Icon';
import { entryLabels, JournalEntry } from './JournalEntry';
import type { EntryChange } from './JournalEntry';
import type { ActionLayout } from './EntryActionDock';
import type { useEntryDrag } from './useEntryDrag';
import { adjacentText, focusText } from './focus';

/** The full daily entries editor, shared by the journal page and its desktop widget. */
export function DayEditor({ day, entries, tags, layout, hiddenCount = 0, onShowAll, savedTraces, newEntryId, openEntryId, focusEntryId, focusMoveEntryId, entriesRef, drag, announcement, className = '', onTitle, onCreate, onNavigate, onChange, onRemove, onLinkedChange, onMoveOffset, onOpenChange }: {
  day: Day; entries: Entry[]; tags: Tag[]; layout: ActionLayout; hiddenCount?: number; onShowAll?: () => void;
  savedTraces: ReadonlySet<string>; newEntryId: string | null; openEntryId: string | null;
  focusEntryId: { current: string | null }; focusMoveEntryId: { current: string | null }; entriesRef: RefObject<HTMLDivElement | null>;
  drag: ReturnType<typeof useEntryDrag>; announcement: string; className?: string;
  onTitle(title: string): void; onCreate(kind: EntryKind, afterId?: string, withoutTag?: boolean): void; onNavigate(date: string): void;
  onChange(id: string, change: EntryChange): void; onRemove(id: string): void;
  onLinkedChange(others: { id: string; date: string }[], action: LinkedAction): void;
  onMoveOffset(id: string, offset: -1 | 1, keepTextFocus?: boolean): boolean; onOpenChange(id: string, open: boolean): void;
}) {
  // Keep action visibility and positioning with the editor, including hosts without the app frame.
  return <div className={`editor actions-${layout} ${className}`}>
    <label className="visually-hidden" htmlFor="title">{t('Titel des Tages')}</label>
    <input id="title" className="title-input" placeholder={t('Gib deinem Tag einen Namen …')} value={day.title}
      onKeyDown={event => { if ((event.key === 'Enter' || event.key === 'ArrowDown') && !event.altKey && !event.shiftKey && focusText(adjacentText(null, 1), 'end')) event.preventDefault(); }} onChange={event => onTitle(event.target.value)} />
    <section className="journal-section" aria-labelledby="entries-heading">
      <div className="section-heading">
        <div className="section-title"><h2 id="entries-heading">{t('Einträge')}</h2><span className="entry-count">{entries.length}</span>
          {hiddenCount > 0 && <button type="button" className="entry-hidden-count" data-tip={t('Alle Tags zeigen')} onClick={onShowAll}><Icon name="tag" />{t('{0} ausgeblendet', hiddenCount)}</button>}</div>
        <div className="kind-picker" role="group" aria-label={t('Eintrag hinzufügen')}>
          {entryKindOrder.map(kind => <button type="button" key={kind} title={t('Neu · Alt {0}', { task: 'A', event: 'E', note: 'N' }[kind])} onClick={() => onCreate(kind)}><Icon name={kind} />{entryLabels()[kind]}</button>)}
        </div>
      </div>
      <div className="entries" ref={entriesRef}>
        <span className="visually-hidden" id="entry-reorder-help">{t('Innerhalb desselben Typs und derselben Priorität ziehen oder mit Alt und den Pfeiltasten nach oben und unten verschieben. Das funktioniert auch direkt im Text.')}</span>
        <span className="visually-hidden" role="status">{announcement}</span>
        {entries.length === 0 && <div className="empty"><Icon name="journal" /><p>{t('Ein neuer Tag. Platz für deine Gedanken.')}</p><span className="page-hint">{t('Füge oben eine Aufgabe, Notiz oder ein Ereignis hinzu.')}</span></div>}
        {entries.map((entry, index) => <JournalEntry key={entry.id} layout={layout} entry={entry} day={day.date} tag={tagOf(tags, entry.tag)}
          tagFirst={index === 0 || entries[index - 1].kind !== entry.kind || filterKey(entries[index - 1].tag) !== filterKey(entry.tag)}
          tagLast={index === entries.length - 1 || entries[index + 1].kind !== entry.kind || filterKey(entries[index + 1].tag) !== filterKey(entry.tag)}
          traceSaved={savedTraces.has(entry.id)} onCreate={onCreate} onNavigate={onNavigate} isNew={entry.id === newEntryId} isOpen={entry.id === openEntryId} focusEntryId={focusEntryId} focusMoveEntryId={focusMoveEntryId}
          isGroupStart={index > 0 && entries[index - 1].kind !== entry.kind}
          canMoveUp={index > 0 && sameGroup(entries[index - 1], entry)} canMoveDown={index < entries.length - 1 && sameGroup(entries[index + 1], entry)}
          dragState={drag.view?.sourceId === entry.id ? 'source' : drag.view?.targetId === entry.id ? `drop-${drag.view.placement}` : null}
          drag={drag.handlers} onMoveOffset={onMoveOffset} onOpenChange={onOpenChange} onChange={onChange} onRemove={onRemove} onLinkedChange={onLinkedChange} />)}
      </div>
    </section>
  </div>;
}
