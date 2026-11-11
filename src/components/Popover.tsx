import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PopupHead } from './PopupChrome';
import { usePopupLook } from '../popupLook';
import { useDismissLayer } from './useDismissLayer';
import { popupViewport } from './WidgetPopupSurface';

/**
 * A small floating panel at an element (tag picker, tag filter, colour picker): below it when there is room, else above,
 * always inside the window. A press outside or Escape closes it; closing by key returns the focus to the element.
 * Rendered into the body, so no toolbar or scrolling list clips it; React still passes its events to the owner, which
 * is why Escape is taken here and not by a dialog behind it.
 */
export function Popover({ anchor, onClose, className = '', label, children, align = 'start', focus = true }: {
  anchor: HTMLElement | null; onClose: (byKey: boolean) => void; className?: string; label: string; children: ReactNode;
  align?: 'start' | 'end'; focus?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const look = usePopupLook();
  const [place, setPlace] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useDismissLayer({element:()=>ref.current,anchor:()=>anchor?.matches('button,input,select,textarea,[role="button"],[role="combobox"]')?anchor:null,ignore:()=>!!document.querySelector('.shortcut-backdrop')&&!anchor?.closest('.shortcut-backdrop'),onDismiss:()=>close.current(false)});
  useLayoutEffect(() => {
    const position = () => {
      const panel = ref.current;
      if (!anchor?.isConnected || !panel) return;
      const rect = anchor.getBoundingClientRect(), margin = 8, gap = 6;
      const width = panel.offsetWidth, height = panel.offsetHeight;
      const bounds = popupViewport(), right = bounds.left + bounds.width, bottom = bounds.top + bounds.height;
      const below = rect.bottom + gap + height <= bottom - margin || rect.top - gap - height < bounds.top + margin;
      const top = Math.min(below ? rect.bottom + gap : rect.top - gap - height, bottom - margin - height);
      const wanted = align === 'end' ? rect.right - width : rect.left;
      const left = Math.max(bounds.left + margin, Math.min(right - margin - width, wanted));
      const fittedTop = Math.max(bounds.top + margin, top);
      setPlace(current => current && current.left === left && current.top === fittedTop && current.above === !below ? current : { left, top: fittedTop, above: !below });
    };
    position();
    const observer = new ResizeObserver(position);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    window.addEventListener('widget:popup-geometry', position);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); window.removeEventListener('widget:popup-geometry', position); };
  }, [anchor, align]);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    // The marked element, else a text field (so typing, digits and arrows work at once), else the first button that is
    // not the head's close button (which comes first in the panel).
    if (focus) {
      const panel = ref.current;
      (panel?.querySelector<HTMLElement>('[data-autofocus]') ?? panel?.querySelector<HTMLElement>('input:not(:disabled):not([type=checkbox]):not([type=radio]), textarea:not(:disabled)')
        ?? panel?.querySelector<HTMLElement>('button:not(:disabled):not(.chrome-close)'))?.focus({ preventScroll: true });
    }
    return () => {
      if (ref.current?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div ref={ref} className={`popover ${className}${place?.above ? ' is-above' : ''}`} role="dialog" aria-label={label}
    style={{ left: place?.left ?? -9999, top: place?.top ?? 0 } as CSSProperties}
    onPointerDown={event => event.stopPropagation()}
    onClick={event => event.stopPropagation()}
    onDoubleClick={event => event.stopPropagation()}
    onContextMenu={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close.current(true); }
      // Nothing typed here reaches the views behind (their keys, the journal's Alt shortcuts).
      event.stopPropagation();
    }}><PopupHead look={look} title={label} command={className.split(' ')[0] || 'popup'} onClose={() => close.current(true)} />{children}</div>, document.body);
}
