import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PopupHead } from './PopupChrome';
import { usePopupLook } from '../popupLook';

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
  useLayoutEffect(() => {
    const position = () => {
      const panel = ref.current;
      if (!anchor?.isConnected || !panel) return;
      const rect = anchor.getBoundingClientRect(), margin = 8, gap = 6;
      const width = panel.offsetWidth, height = panel.offsetHeight;
      const below = rect.bottom + gap + height <= innerHeight - margin || rect.top - gap - height < margin;
      const top = below ? Math.min(rect.bottom + gap, innerHeight - margin - height) : rect.top - gap - height;
      const wanted = align === 'end' ? rect.right - width : rect.left;
      const left = Math.max(margin, Math.min(innerWidth - margin - width, wanted));
      setPlace(current => current && current.left === left && current.top === top && current.above === !below ? current : { left, top: Math.max(margin, top), above: !below });
    };
    position();
    const observer = new ResizeObserver(position);
    if (ref.current) observer.observe(ref.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { observer.disconnect(); window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [anchor, align]);
  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (focus) ref.current?.querySelector<HTMLElement>('[data-autofocus], input, button:not(:disabled)')?.focus({ preventScroll: true });
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (document.querySelector('.shortcut-backdrop') && !anchor?.closest('.shortcut-backdrop')) return;
      if (!ref.current?.contains(target) && !anchor?.contains(target)) close.current(false);
    };
    window.addEventListener('pointerdown', outside, true);
    return () => {
      window.removeEventListener('pointerdown', outside, true);
      if (ref.current?.contains(document.activeElement) || document.activeElement === document.body) previous?.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(<div ref={ref} className={`popover ${className}${place?.above ? ' is-above' : ''}`} role="dialog" aria-label={label}
    style={{ left: place?.left ?? -9999, top: place?.top ?? 0 } as CSSProperties}
    onPointerDown={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); close.current(true); }
      // Nothing typed here reaches the views behind (their keys, the journal's Alt shortcuts).
      event.stopPropagation();
    }}><PopupHead look={look} title={label} command={className.split(' ')[0] || 'popup'} onClose={() => close.current(true)} />{children}</div>, document.body);
}
