import { memo, useLayoutEffect, useRef } from 'react';
import { Entry } from '../journal';
import { EntryText } from './EntryText';
import { EntryActionDock } from './EntryActionDock';
import { Icon } from './Icon';
import type { EntryDragHandlers } from './useEntryDrag';

export const entryLabels = { task: 'Aufgabe', event: 'Ereignis', note: 'Notiz' };
export type EntryChange = Partial<Pick<Entry, 'text' | 'done' | 'cancelled'>>;
export type DragState = 'source' | 'drop-before' | 'drop-after' | null;
interface TextSelection { start: number; end: number; direction: 'forward' | 'backward' | 'none' }

// Memoized: all callbacks receive the entry ID and are stable, so typing in one row re-renders only that row.
export const JournalEntry = memo(function JournalEntry({ entry, isNew, isOpen, isGroupStart, canMoveUp, canMoveDown, dragState, drag, onMoveOffset, onOpenChange, onChange, onRemove, focusEntryId, focusMoveEntryId }: {
  entry: Entry; isNew: boolean; isOpen: boolean; onOpenChange: (id: string, open: boolean) => void;
  onChange: (id: string, change: EntryChange) => void; onRemove: (id: string) => void; focusEntryId: { current: string | null };
  isGroupStart: boolean; canMoveUp: boolean; canMoveDown: boolean; dragState: DragState; drag: EntryDragHandlers;
  onMoveOffset: (id: string, offset: -1 | 1, keepTextFocus?: boolean) => boolean; focusMoveEntryId: { current: string | null };
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gripRef = useRef<HTMLButtonElement>(null);
  const restoreSelection = useRef<TextSelection | null>(null);
  const label = entryLabels[entry.kind];
  const status = entry.kind === 'task' ? entry.done ? 'done' : entry.cancelled ? 'cancelled' : 'open' : undefined;
  const statusLabel = status === 'done' ? ', erledigt' : status === 'cancelled' ? ', abgebrochen' : status === 'open' ? ', offen' : '';

  useLayoutEffect(() => {
    const selection = restoreSelection.current;
    if (selection) {
      const text = rootRef.current?.querySelector('textarea');
      text?.focus({ preventScroll: true });
      text?.setSelectionRange(selection.start, selection.end, selection.direction);
      text?.scrollIntoView({ block: 'nearest' });
      restoreSelection.current = null;
    } else if (focusMoveEntryId.current === entry.id) {
      gripRef.current?.focus({ preventScroll: true });
      gripRef.current?.scrollIntoView({ block: 'nearest' });
      focusMoveEntryId.current = null;
    }
  });

  function closeActions() {
    onOpenChange(entry.id, false);
    triggerRef.current?.focus({ preventScroll: true });
  }

  const dragClass = dragState === 'source' ? ' entry-dragging' : dragState ? ` ${dragState}` : '';
  return <div ref={rootRef} className={`entry${isNew ? ' entry-new' : ''}${isGroupStart ? ' entry-group-start' : ''}${dragClass}`} data-entry-id={entry.id} data-entry-kind={entry.kind} data-status={status}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) onOpenChange(entry.id, false); }}
    onFocusCapture={event => { if (event.target instanceof HTMLTextAreaElement) onOpenChange(entry.id, false); }}
    onKeyDown={event => {
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
        event.preventDefault();
        event.stopPropagation();
        const text = event.target instanceof HTMLTextAreaElement ? event.target : null;
        if (text) restoreSelection.current = { start: text.selectionStart, end: text.selectionEnd, direction: text.selectionDirection };
        if (!onMoveOffset(entry.id, event.key === 'ArrowUp' ? -1 : 1, Boolean(text))) restoreSelection.current = null;
      }
      if (event.key === 'Escape') {
        drag.cancel();
        if (isOpen) { event.preventDefault(); closeActions(); }
      }
    }}>
    <button ref={gripRef} type="button" className="entry-grip" aria-label={`${label} verschieben: ${entry.text || 'ohne Text'}`} aria-describedby="entry-reorder-help" title="Zum Verschieben ziehen · Alt + ↑ / ↓" disabled={!canMoveUp && !canMoveDown}
      onPointerDown={event => { onOpenChange(entry.id, false); drag.start(event, entry); }} onPointerMove={drag.move} onPointerUp={drag.end} onPointerCancel={drag.cancel} onLostPointerCapture={drag.cancel}><Icon name="grip" /></button>
    <div className="entry-main">
      <div className="entry-actions">
        <button ref={triggerRef} type="button" className="entry-symbol" aria-label={`Aktionen für ${label}${statusLabel}: ${entry.text || 'ohne Text'}`} aria-expanded={isOpen} onClick={() => onOpenChange(entry.id, !isOpen)} onKeyDown={event => { if (event.key === 'ArrowDown' && !event.altKey && !isOpen) { event.preventDefault(); onOpenChange(entry.id, true); } }}>
          <Icon name={status === 'done' ? 'done' : entry.kind} className={status === 'done' ? 'completed-icon' : ''} />
        </button>
      </div>
      <EntryText entry={entry} label={label} focusEntryId={focusEntryId} onChange={text => onChange(entry.id, { text })} />
    </div>
    <EntryActionDock entry={entry} label={label} isOpen={isOpen} canMoveUp={canMoveUp} canMoveDown={canMoveDown} onClose={closeActions} onRemove={() => onRemove(entry.id)} onMove={offset => { onMoveOffset(entry.id, offset); }} onStatusChange={next => {
      const done = next === 'done';
      const cancelled = next === 'cancelled';
      if (entry.done !== done || entry.cancelled !== cancelled) onChange(entry.id, { done, cancelled });
    }} />
  </div>;
});
