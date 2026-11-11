import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { placeWidgetPopup } from '../widgetPopupGeometry';
import { connectWidgetSurface, getWidgetSurface, popupViewport, subscribeWidgetSurface } from '../widgetSurface';
export { inDesktopWidget, popupViewport } from '../widgetSurface';

/** Keep one stable native canvas for the lifetime of the widget. */
export function WidgetPopupSurface() {
  useLayoutEffect(connectWidgetSurface, []);
  return null;
}

/** Move a floating panel out of the widget's scrolling/clipping containers without changing its React owner. */
export function WidgetFloatingPanel({ anchor, children, layout = 'sheet', orbit = false, inset = 0 }: {
  anchor: () => HTMLElement | null; children: ReactNode; layout?: string; orbit?: boolean; inset?: number;
}) {
  const surface = useSyncExternalStore(subscribeWidgetSurface, getWidgetSurface);
  const ref = useRef<HTMLDivElement>(null), getAnchor = useRef(anchor); getAnchor.current = anchor;
  const [place, setPlace] = useState<{ left: number; top: number; width?: number; height?: number }>({ left: -10000, top: 0 });
  useLayoutEffect(() => {
    const position = () => {
      const panel = ref.current, target = getAnchor.current();
      if (!panel || !target?.isConnected) return;
      const a = target.getBoundingClientRect(), bounds = popupViewport();
      let next: typeof place;
      if (orbit) {
        const width = Math.min(a.width, Math.max(120, bounds.width - 150));
        const fitted = placeWidgetPopup({ left: a.left - 66, top: a.top - 82, width, height: 0 }, { width: width + 132, height: a.height + 152 }, bounds);
        next = { left: fitted.left + 66, top: fitted.top + 76, width, height: a.height };
      } else {
        const fitted = placeWidgetPopup(a, { width: panel.offsetWidth, height: panel.offsetHeight }, bounds, inset);
        next = { left: fitted.left, top: fitted.top };
      }
      setPlace(old => JSON.stringify(old) === JSON.stringify(next) ? old : next);
      const tag = getComputedStyle(target).getPropertyValue('--tag');
      if (tag && panel.style.getPropertyValue('--tag') !== tag) panel.style.setProperty('--tag', tag);
    };
    position();
    const resize = new ResizeObserver(position);
    if (ref.current) resize.observe(ref.current);
    const target = getAnchor.current(); if (target) resize.observe(target);
    window.addEventListener('resize', position); window.addEventListener('scroll', position, true);
    window.addEventListener('widget:popup-geometry', position);
    return () => { resize.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); window.removeEventListener('widget:popup-geometry', position); };
  }, [surface, orbit, inset]);
  return createPortal(<div ref={ref} className={`widget-floating-popup actions-${layout} ${orbit ? 'is-orbit' : 'is-panel'}`} style={place}>{children}</div>, document.body);
}
