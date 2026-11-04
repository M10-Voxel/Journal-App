import { useCallback, useLayoutEffect, useRef } from 'react';
import type { RefObject } from 'react';

// FLIP animation for the entry list: `capture` records where every row is before a change,
// the next layout pass lets each row glide from that spot to its new place.
export function useListMotion(containerRef: RefObject<HTMLElement | null>) {
  const snapshot = useRef<Map<string, number> | null>(null);

  const capture = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const origin = container.getBoundingClientRect().top;
    snapshot.current = new Map(Array.from(container.querySelectorAll<HTMLElement>('[data-entry-id]'), row => [row.dataset.entryId!, row.getBoundingClientRect().top - origin]));
  }, [containerRef]);

  useLayoutEffect(() => {
    const before = snapshot.current;
    const container = containerRef.current;
    snapshot.current = null;
    if (!before || !container || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-entry-id]'));
    for (const row of rows) for (const animation of row.getAnimations()) if (animation.id === 'list-motion') animation.cancel();
    // The pixel theme moves in square steps, a little faster (see pixel.css).
    const pixel = document.documentElement.dataset.pixel !== undefined;
    const origin = container.getBoundingClientRect().top;
    for (const row of rows) {
      const top = before.get(row.dataset.entryId!);
      if (top === undefined) continue;
      const delta = top - (row.getBoundingClientRect().top - origin);
      if (Math.abs(delta) < 1) continue;
      row.animate([{ transform: `translateY(${delta}px)` }, { transform: 'translateY(0)' }], pixel ? { id: 'list-motion', duration: 160, easing: 'steps(8, end)' } : { id: 'list-motion', duration: 320, easing: 'cubic-bezier(.22, 1.2, .36, 1)' });
    }
  });

  return capture;
}
