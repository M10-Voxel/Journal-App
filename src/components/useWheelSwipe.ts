import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';

const threshold = 60;
const quiet = 220;

/**
 * Turns pages with the wheel: a horizontal swipe on a trackpad (one step per gesture, its momentum included) or
 * Shift + mouse wheel (one step per notch). With `vertical`, the plain wheel turns pages as well.
 * Returns the wheel handler; it reports whether it took the event. A positive step is "next" (swipe left, wheel down).
 */
export function useWheelSwipe(onStep: (step: 1 | -1) => void, { vertical = false, root, ignore = '' }: { vertical?: boolean; root?: RefObject<HTMLElement | null>; ignore?: string } = {}) {
  const state = useRef({ total: 0, locked: false, timer: 0, last: 0 });
  const latest = useRef(onStep);
  latest.current = onStep;
  useEffect(() => () => window.clearTimeout(state.current.timer), []);
  const handle = (event: Pick<WheelEvent, 'deltaX' | 'deltaY' | 'deltaMode' | 'shiftKey' | 'ctrlKey' | 'defaultPrevented'>) => {
    if (event.ctrlKey || event.defaultPrevented) return false;
    // Shift + wheel arrives as horizontal scrolling in Chromium, or as vertical in other engines.
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const raw = horizontal ? event.deltaX : event.shiftKey || vertical ? event.deltaY : 0;
    const delta = raw * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 600 : 1);
    if (!delta) return false;
    const current = state.current;
    const now = performance.now();
    if (now - current.last > quiet) { current.total = 0; current.locked = false; }
    current.last = now;
    window.clearTimeout(current.timer);
    current.timer = window.setTimeout(() => { current.total = 0; current.locked = false; }, quiet);
    if (current.locked) return true;
    current.total += delta;
    if (Math.abs(current.total) < threshold) return true;
    const step = current.total > 0 ? 1 : -1;
    current.total = 0;
    // A trackpad keeps sending small events after the swipe; they belong to the same step. A mouse notch (a large
    // vertical delta, possibly turned sideways by Shift) is a step of its own.
    current.locked = !((event.shiftKey || (vertical && !horizontal)) && Math.abs(delta) >= 50);
    latest.current(step);
    return true;
  };
  const handler = useRef(handle); handler.current = handle;
  useEffect(() => {
    if (!root) return;
    // Listen after React's bubbling handlers (entry swipes/popovers can stop propagation), with cancellation enabled.
    // The document stays mounted when the day or calendar cells under a stationary pointer are replaced.
    const wheel = (event: WheelEvent) => {
      const container = root.current, target = event.target;
      if (!container || !(target instanceof Element) || !container.contains(target) || (ignore && target.closest(ignore))) return;
      // A real horizontal scroller, such as the yearly heatmap, owns gestures over its contents.
      for (let element: Element | null = target; element && element !== container; element = element.parentElement) {
        if (element instanceof HTMLElement && element.scrollWidth > element.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(element).overflowX)) return;
      }
      if (handler.current(event) && event.cancelable) event.preventDefault();
    };
    document.addEventListener('wheel',wheel,{ passive:false });
    return () => document.removeEventListener('wheel',wheel);
  },[root,ignore]);
  return handle;
}
