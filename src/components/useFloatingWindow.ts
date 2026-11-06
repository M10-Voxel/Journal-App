import { useViewHistory } from '../viewHistory';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from 'react';

/**
 * A window that can float over the desk (Nebula's calendar and notebook): moved by its head, resized at its edges and
 * corners, kept inside the stage. Until it is moved it keeps its docked place from the stylesheet (`rect` null); once
 * moved its place and size are remembered on the device (`key`) and a double click on the head docks it again.
 */
export type WindowRect = { x: number; y: number; w: number; h: number };
export type Edges = { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean };
export const minWindow = { w: 300, h: 220 };

/** The rectangle kept inside the stage: at least the minimum size (as far as the stage allows), never outside it. */
export function clampRect(rect: WindowRect, stage: { width: number; height: number }): WindowRect {
  const w = Math.min(Math.max(rect.w, minWindow.w), stage.width), h = Math.min(Math.max(rect.h, minWindow.h), stage.height);
  return { x: Math.min(Math.max(rect.x, 0), Math.max(0, stage.width - w)), y: Math.min(Math.max(rect.y, 0), Math.max(0, stage.height - h)), w, h };
}
/** Where a drag from `origin` by (dx, dy) leaves the window: moved as a whole, or with the grabbed edges. */
export function dragRect(origin: WindowRect, dx: number, dy: number, edges: Edges | 'move'): WindowRect {
  if (edges === 'move') return { ...origin, x: origin.x + dx, y: origin.y + dy };
  let { x, y, w, h } = origin;
  // An edge stops at the minimum size instead of pushing the opposite one.
  if (edges.left) { const next = Math.min(dx, w - minWindow.w); x += next; w -= next; }
  if (edges.right) w = Math.max(minWindow.w, w + dx);
  if (edges.top) { const next = Math.min(dy, h - minWindow.h); y += next; h -= next; }
  if (edges.bottom) h = Math.max(minWindow.h, h + dy);
  return { x, y, w, h };
}

const read = (key: string): WindowRect | null => {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? 'null') as WindowRect | null;
    return value && [value.x, value.y, value.w, value.h].every(Number.isFinite) ? value : null;
  } catch { return null; }
};
export const writeWindowRect = (key: string, rect: WindowRect | null) => write(key, rect);
const write = (key: string, rect: WindowRect | null) => { try { if (rect) localStorage.setItem(key, JSON.stringify(rect)); else localStorage.removeItem(key); } catch { /* this session */ } };

/** While a window is moved by its head: the pointer (and Shift); on release `onDrop` may take it (docking), the window
 *  then keeps its last floating place. */
export interface FloatingDrag { onDrag?: (point: { x: number; y: number }, shift: boolean) => void; onDrop?: (point: { x: number; y: number }, shift: boolean) => boolean }

export function useFloatingWindow(key: string, stage: RefObject<HTMLElement | null>, frame: RefObject<HTMLElement | null>, drag: FloatingDrag = {}) {
  const [rect, setRect] = useState<WindowRect | null>(() => read(key));
  const [dragging, setDragging] = useState(false);
  useViewHistory(rect, value => { setRect(value); write(key, value); });
  const latest = useRef(rect); latest.current = rect;
  // The stage may shrink (a smaller window): the floating window stays inside it.
  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      const current = latest.current;
      if (!current) return;
      const next = clampRect(current, { width: element.clientWidth, height: element.clientHeight });
      if (next.x !== current.x || next.y !== current.y || next.w !== current.w || next.h !== current.h) setRect(next);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  function start(event: ReactPointerEvent<HTMLElement>, edges: Edges | 'move') {
    if (event.button !== 0 || !stage.current || !frame.current) return;
    if (edges === 'move' && (event.target as Element).closest('button, input, select, textarea, a, [role="tab"]')) return;
    event.preventDefault();
    // Captured, so the pointer stays with the window even outside the journal's window (pulling it out).
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* the pointer is gone already */ }
    const area = stage.current.getBoundingClientRect(), box = frame.current.getBoundingClientRect();
    const origin = { x: box.left - area.left, y: box.top - area.top, w: box.width, h: box.height };
    const size = { width: area.width, height: area.height };
    const startX = event.clientX, startY = event.clientY;
    const before = latest.current;
    let last = origin;
    setDragging(true);
    const move = (moved: PointerEvent) => {
      last = clampRect(dragRect(origin, moved.clientX - startX, moved.clientY - startY, edges), size); setRect(last);
      if (edges === 'move') drag.onDrag?.({ x: moved.clientX, y: moved.clientY }, moved.shiftKey);
    };
    const end = (ended: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      setDragging(false);
      // Taken by the drop (docked into the grid): the window keeps the place it floated at before this drag.
      if (edges === 'move' && ended.type === 'pointerup' && drag.onDrop?.({ x: ended.clientX, y: ended.clientY }, ended.shiftKey)) { setRect(before); return; }
      if (edges === 'move') drag.onDrag?.({ x: NaN, y: NaN }, false);
      if (last !== origin) write(key, last);
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  const dock = () => { setRect(null); write(key, null); };
  const style: CSSProperties | undefined = rect ? { left: rect.x, top: rect.y, width: rect.w, height: rect.h, right: 'auto', bottom: 'auto' } : undefined;
  return { rect, style, dragging, floating: rect !== null, startMove: (event: ReactPointerEvent<HTMLElement>) => start(event, 'move'), startResize: (edges: Edges) => (event: ReactPointerEvent<HTMLElement>) => start(event, edges), dock };
}

/** The eight grips of a floating window: its edges and corners. */
export const windowGrips: { name: string; edges: Edges }[] = [
  { name: 'n', edges: { top: true } }, { name: 's', edges: { bottom: true } }, { name: 'w', edges: { left: true } }, { name: 'e', edges: { right: true } },
  { name: 'nw', edges: { top: true, left: true } }, { name: 'ne', edges: { top: true, right: true } }, { name: 'sw', edges: { bottom: true, left: true } }, { name: 'se', edges: { bottom: true, right: true } },
];
