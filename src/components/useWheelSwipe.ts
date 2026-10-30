import { useEffect, useRef } from 'react';
import type { WheelEvent } from 'react';

const threshold = 60;
const quiet = 220;

/**
 * Turns pages with the wheel: a horizontal swipe on a trackpad (one step per gesture, its momentum included) or
 * Shift + mouse wheel (one step per notch). With `vertical`, the plain wheel turns pages as well.
 * Returns the wheel handler; it reports whether it took the event. A positive step is "next" (swipe left, wheel down).
 */
export function useWheelSwipe(onStep: (step: 1 | -1) => void, { vertical = false } = {}) {
  const state = useRef({ total: 0, locked: false, timer: 0 });
  const latest = useRef(onStep);
  latest.current = onStep;
  useEffect(() => () => window.clearTimeout(state.current.timer), []);
  return (event: WheelEvent) => {
    // Shift + wheel arrives as horizontal scrolling in Chromium, or as vertical in other engines.
    const horizontal = Math.abs(event.deltaX) > Math.abs(event.deltaY);
    const delta = horizontal ? event.deltaX : event.shiftKey || vertical ? event.deltaY : 0;
    if (!delta) return false;
    const current = state.current;
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
}
