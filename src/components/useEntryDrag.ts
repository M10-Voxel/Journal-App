import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { Entry } from '../journal';

type Placement = 'before' | 'after';
interface DragView { sourceId: string; targetId: string | null; placement: Placement }
interface DragSession extends DragView {
  kind: Entry['kind']; pointerId: number; handle: HTMLButtonElement;
  startX: number; startY: number; x: number; y: number; active: boolean;
}
export interface EntryDragHandlers {
  start: (event: PointerEvent<HTMLButtonElement>, entry: Entry) => void;
  move: (event: PointerEvent<HTMLButtonElement>) => void;
  end: (event: PointerEvent<HTMLButtonElement>) => void;
  cancel: () => void;
}

export function useEntryDrag(scrollRef: RefObject<HTMLDivElement | null>, onMove: (source: string, target: string, placement: Placement) => void) {
  const session = useRef<DragSession | null>(null);
  const frame = useRef<number | null>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;
  const [view, setView] = useState<DragView | null>(null);

  // The handlers only touch refs and state setters, so they stay identical across renders and memoized rows are not invalidated.
  const handlers = useMemo<EntryDragHandlers>(() => {
    function updateTarget() {
      const drag = session.current;
      if (!drag?.active) return;
      const row = document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-entry-id]');
      const targetId = row?.dataset.entryKind === drag.kind && row.dataset.entryId !== drag.sourceId ? row.dataset.entryId ?? null : null;
      const bounds = row?.getBoundingClientRect();
      const placement: Placement = bounds && drag.y > bounds.top + bounds.height / 2 ? 'after' : 'before';
      if (drag.targetId !== targetId || drag.placement !== placement) {
        drag.targetId = targetId;
        drag.placement = placement;
        setView({ sourceId: drag.sourceId, targetId, placement });
      }
    }

    // Pointer moves are coalesced into one hit test per frame.
    function tick() {
      const drag = session.current;
      const scroll = scrollRef.current;
      if (!drag?.active) return;
      if (scroll) {
        const bounds = scroll.getBoundingClientRect();
        const distance = drag.y < bounds.top + 40 ? drag.y - bounds.top - 40 : drag.y > bounds.bottom - 40 ? drag.y - bounds.bottom + 40 : 0;
        if (distance) scroll.scrollTop += Math.max(-12, Math.min(12, distance / 3));
      }
      updateTarget();
      frame.current = requestAnimationFrame(tick);
    }

    function cancel() {
      const drag = session.current;
      session.current = null;
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
      if (drag?.handle.hasPointerCapture(drag.pointerId)) drag.handle.releasePointerCapture(drag.pointerId);
      setView(current => current === null ? current : null);
    }

    return {
      cancel,
      start(event, entry) {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus({ preventScroll: true });
        event.currentTarget.setPointerCapture(event.pointerId);
        session.current = { sourceId: entry.id, kind: entry.kind, pointerId: event.pointerId, handle: event.currentTarget,
          startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false, targetId: null, placement: 'before' };
      },
      move(event) {
        const drag = session.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.x = event.clientX; drag.y = event.clientY;
        if (!drag.active && Math.hypot(drag.x - drag.startX, drag.y - drag.startY) >= 5) {
          drag.active = true;
          setView({ sourceId: drag.sourceId, targetId: null, placement: 'before' });
          frame.current = requestAnimationFrame(tick);
        }
      },
      end(event) {
        const drag = session.current;
        if (!drag || event.pointerId !== drag.pointerId) return;
        drag.x = event.clientX; drag.y = event.clientY;
        updateTarget();
        if (drag.active && drag.targetId) onMoveRef.current(drag.sourceId, drag.targetId, drag.placement);
        cancel();
      },
    };
  }, [scrollRef]);

  useEffect(() => () => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    session.current = null;
  }, []);

  return { view, handlers };
}
