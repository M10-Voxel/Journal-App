export interface PopupRect { left: number; top: number; width: number; height: number }
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value));

/** Resize only the selected edges; dragging the header keeps the rectangle's size. */
export function moveWidgetRect(start: PopupRect, dx: number, dy: number, edge: string, minWidth: number, minHeight: number): PopupRect {
  if (!edge) return { ...start, left: start.left + dx, top: start.top + dy };
  const next = { ...start };
  if (edge.includes('e')) next.width = Math.max(minWidth, start.width + dx);
  if (edge.includes('s')) next.height = Math.max(minHeight, start.height + dy);
  if (edge.includes('w')) { next.width = Math.max(minWidth, start.width - dx); next.left = start.left + start.width - next.width; }
  if (edge.includes('n')) { next.height = Math.max(minHeight, start.height - dy); next.top = start.top + start.height - next.height; }
  return next;
}

/** Position against the desktop work area, independently of the widget's scrollable content. */
export function placeWidgetPopup(anchor: PopupRect, size: { width: number; height: number }, bounds: PopupRect, inset = 0): PopupRect {
  const margin = 8, gap = 6;
  const width = Math.min(size.width, Math.max(1, bounds.width - margin * 2));
  const height = Math.min(size.height, Math.max(1, bounds.height - margin * 2));
  const below = anchor.top + anchor.height + gap;
  const above = anchor.top - height - gap;
  return {
    left: clamp(anchor.left + inset, bounds.left + margin, bounds.left + bounds.width - width - margin),
    top: clamp(below + height <= bounds.top + bounds.height - margin ? below : above, bounds.top + margin, bounds.top + bounds.height - height - margin),
    width, height,
  };
}
