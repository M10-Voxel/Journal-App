import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { Entry } from '../journal';
import { SortSession } from '../sortable';

type Placement = 'before' | 'after';
interface DragView { sourceId: string; targetId: string | null; placement: Placement }
export interface EntryDragHandlers {
  start: (event: PointerEvent<HTMLButtonElement>, entry: Entry) => void;
  move: (event: PointerEvent<HTMLButtonElement>) => void;
  end: (event: PointerEvent<HTMLButtonElement>) => void;
  cancel: () => void;
}

/**
 * Dragging an entry by its grip (sortable.ts): the entry follows the pointer and the others of its kind, priority and tag
 * slide aside; on letting go it takes its new place (`onMove` with the entry it lands before or after). The arrows and
 * Alt ↑ / Alt ↓ stay as they are.
 */
export function useEntryDrag(scrollRef: RefObject<HTMLDivElement | null>, onMove: (source: string, target: string, placement: Placement) => void) {
  const session = useRef<{ sort: SortSession; pointerId: number; handle: HTMLButtonElement } | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [view, setView] = useState<DragView | null>(null);

  // The handlers only touch refs and state setters, so they stay identical across renders and memoized rows are not invalidated.
  const handlers = useMemo<EntryDragHandlers>(() => {
    const release = () => {
      const drag = session.current;
      session.current = null;
      if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
    };
    return {
      cancel() { const drag = session.current; release(); drag?.sort.cancel(); },
      start(event, entry) {
        if (event.button !== 0 || !event.isPrimary) return;
        const row = event.currentTarget.closest<HTMLElement>('[data-entry-id]');
        if (!row) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        // Entries move only among those of the same kind, priority and tag group (sameGroup).
        const same = (other: HTMLElement) => other.dataset.entryKind === row.dataset.entryKind && other.dataset.priority === row.dataset.priority && (other.dataset.group ?? '') === (row.dataset.group ?? '');
        const root = scrollRef.current ?? row.parentElement ?? document.body;
        const rows = [...root.querySelectorAll<HTMLElement>('[data-entry-id]')].filter(other => other.parentElement === row.parentElement && same(other));
        const sourceId = entry.id;
        const sort = new SortSession({ item: row, items: rows, x: event.clientX, y: event.clientY, stayWithin: true,
          onStart: () => setView({ sourceId, targetId: null, placement: 'before' }),
          onEnd: () => setView(null),
          onDrop: (from, to) => {
            const target = rows[to]?.dataset.entryId;
            if (target) onMoveRef.current(sourceId, target, to > from ? 'after' : 'before');
          } });
        session.current = { sort, pointerId: event.pointerId, handle: event.currentTarget };
      },
      move(event) {
        const drag = session.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.sort.move(event.clientX, event.clientY);
      },
      end(event) {
        const drag = session.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.sort.move(event.clientX, event.clientY);
        release();
        drag.sort.finish();
      },
    };
  }, [scrollRef]);

  // Escape while dragging puts the entry back.
  useEffect(() => {
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && session.current?.sort.active) { event.preventDefault(); event.stopPropagation(); handlers.cancel(); } };
    addEventListener('keydown', key, true);
    return () => { removeEventListener('keydown', key, true); handlers.cancel(); };
  }, [handlers]);

  return { view, handlers };
}
