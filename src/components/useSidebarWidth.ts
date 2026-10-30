import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';

// The sidebar's width, set by dragging its edge (or with ← → on the focused edge; a double click resets it).
// Stored on the device like the other view settings. The journal always keeps `journalMin` pixels.
const key = 'journal.sidebar';
export const sidebarDefault = 400;
const sidebarMin = 280;
const journalMin = 420;

function stored(): number {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value >= sidebarMin ? value : sidebarDefault;
}

export function useSidebarWidth() {
  const [width, setWidth] = useState(stored);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const max = Math.max(sidebarMin, windowWidth - journalMin);
  const clamp = (value: number) => Math.round(Math.min(max, Math.max(sidebarMin, value)));
  const shown = clamp(width);
  const commit = (value: number) => {
    setWidth(value);
    try { localStorage.setItem(key, String(value)); } catch { /* keep it for this session */ }
  };
  return {
    width: shown, dragging,
    handle: {
      role: 'separator', 'aria-orientation': 'vertical' as const, 'aria-label': 'Breite der Seitenleiste', 'aria-valuenow': shown, 'aria-valuemin': sidebarMin, 'aria-valuemax': max, tabIndex: 0,
      title: 'Ziehen ändert die Breite · Doppelklick setzt sie zurück',
      onPointerDown(event: PointerEvent<HTMLElement>) {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { x: event.clientX, width: shown };
        setDragging(true);
      },
      onPointerMove(event: PointerEvent<HTMLElement>) {
        if (drag.current) setWidth(clamp(drag.current.width + event.clientX - drag.current.x));
      },
      onPointerUp(event: PointerEvent<HTMLElement>) {
        if (!drag.current) return;
        commit(clamp(drag.current.width + event.clientX - drag.current.x));
        drag.current = null;
        setDragging(false);
      },
      onLostPointerCapture() { if (drag.current) { drag.current = null; setDragging(false); } },
      onDoubleClick() { commit(clamp(sidebarDefault)); },
      onKeyDown(event: KeyboardEvent<HTMLElement>) {
        const step = ({ ArrowLeft: -24, ArrowRight: 24 } as Record<string, number>)[event.key];
        if (!step || event.altKey || event.ctrlKey) return;
        event.preventDefault();
        event.stopPropagation();
        commit(clamp(shown + step * (event.shiftKey ? 4 : 1)));
      },
    },
  };
}
