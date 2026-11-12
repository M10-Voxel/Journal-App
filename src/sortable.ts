/**
 * Sorting a vertical list by dragging, the way the item follows the pointer: the held item moves with it, the others
 * slide aside to make room, and the list scrolls at its edges. Only on letting go does the new order count. The DOM is
 * moved by transforms alone (no re-renders while dragging); after the drop the transforms stay until the list has
 * re-rendered in its new order (or a moment has passed), so nothing jumps back while the change is being saved.
 * Escape, a lost pointer or a cancelled gesture put everything back.
 */
export interface SortOptions {
  /** The held item and its list (in DOM order, the held one included). */
  item: HTMLElement; items: HTMLElement[];
  /** Pointer position at the start. */
  x: number; y: number;
  /** Called on letting go with the item's place before and after (indexes into `items`); not called if it stayed. */
  onDrop: (from: number, to: number) => void | Promise<unknown>;
  /** Called when the gesture ends either way (dropped, cancelled). */
  onEnd?: () => void;
  /** Called when the drag really starts (past the threshold). */
  onStart?: () => void;
  threshold?: number;
  /** Held beyond the list's first or last item, the item has no new place (letting go there changes nothing). */
  stayWithin?: boolean;
}

const scrollerOf = (element: HTMLElement): HTMLElement | null => {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const style = getComputedStyle(node);
    if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight) return node;
  }
  return document.scrollingElement as HTMLElement | null;
};

export class SortSession {
  active = false;
  private readonly options: SortOptions;
  private readonly from: number;
  private to: number;
  private y: number;
  private scroller: HTMLElement | null = null;
  private startScroll = 0;
  private mids: number[] = [];
  private span = { top: 0, bottom: 0 };
  private shift = 0;
  private frame = 0;
  private ended = false;

  constructor(options: SortOptions) {
    this.options = options;
    this.from = this.to = Math.max(0, options.items.indexOf(options.item));
    this.y = options.y;
  }

  /** The pointer moved; returns whether the drag is under way. */
  move(x: number, y: number) {
    if (this.ended) return false;
    this.y = y;
    if (!this.active && Math.hypot(x - this.options.x, y - this.options.y) >= (this.options.threshold ?? 4)) this.begin();
    return this.active;
  }

  private begin() {
    const { item, items } = this.options;
    this.active = true;
    this.scroller = scrollerOf(item);
    this.startScroll = this.scroller?.scrollTop ?? 0;
    const rects = items.map(element => element.getBoundingClientRect());
    this.mids = rects.map(rect => rect.top + rect.height / 2 + this.startScroll);
    this.span = { top: Math.min(...rects.map(rect => rect.top)) + this.startScroll, bottom: Math.max(...rects.map(rect => rect.bottom)) + this.startScroll };
    // The room the held item takes: its height and the gap to its neighbour.
    const own = rects[this.from], next = rects[this.from + 1] ?? rects[this.from - 1];
    const gap = next ? Math.max(0, next.top > own.top ? next.top - own.bottom : own.top - next.bottom) : 0;
    this.shift = own.height + gap;
    document.documentElement.dataset.sorting = '';
    // Marked by attributes, not classes: a row re-rendered while held keeps its mark.
    item.dataset.sortState = 'source';
    for (const element of items) if (element !== item) element.dataset.sortState = 'sibling';
    window.getSelection()?.removeAllRanges();
    this.options.onStart?.();
    this.frame = requestAnimationFrame(this.tick);
  }

  private tick = () => {
    if (!this.active || this.ended) return;
    const scroller = this.scroller;
    if (scroller) {
      const bounds = scroller === document.scrollingElement ? { top: 0, bottom: innerHeight } : scroller.getBoundingClientRect();
      const edge = 44, distance = this.y < bounds.top + edge ? this.y - bounds.top - edge : this.y > bounds.bottom - edge ? this.y - bounds.bottom + edge : 0;
      if (distance) scroller.scrollTop += Math.max(-14, Math.min(14, distance / 3));
    }
    this.layout();
    this.frame = requestAnimationFrame(this.tick);
  };

  /** Positions the held item under the pointer and the others around its place. */
  private layout() {
    const { item, items } = this.options;
    const scroll = (this.scroller?.scrollTop ?? 0) - this.startScroll;
    const dy = this.y - this.options.y + scroll;
    const centre = this.mids[this.from] + dy;
    let to = 0;
    this.mids.forEach((mid, index) => { if (index !== this.from && centre > mid) to++; });
    if (this.options.stayWithin && (centre < this.span.top || centre > this.span.bottom)) to = this.from;
    this.to = to;
    item.style.transform = `translateY(${dy}px)`;
    items.forEach((element, index) => {
      if (element === item) return;
      const offset = index > this.from && index <= to ? -this.shift : index < this.from && index >= to ? this.shift : 0;
      element.style.transform = offset ? `translateY(${offset}px)` : '';
    });
  }

  /** Letting go: the new place counts. */
  finish() {
    if (this.ended) return;
    if (!this.active) { this.end(); return; }
    this.layout();
    const { from, to } = this;
    this.stopFrame();
    if (from === to) { this.restore(true); return; }
    const settled = this.settleWhenReordered();
    try {
      const result = this.options.onDrop(from, to);
      if (result && typeof (result as Promise<unknown>).then === 'function') (result as Promise<unknown>).catch(() => this.restore(true)).finally(settled);
    } catch { this.restore(true); }
  }

  /** Escape or a lost gesture: everything slides back. */
  cancel() {
    if (this.ended) return;
    this.stopFrame();
    this.restore(this.active);
  }

  private stopFrame() { if (this.frame) cancelAnimationFrame(this.frame); this.frame = 0; }

  /** Keeps the dropped look until the list shows its new order, then removes the transforms in one go. */
  private settleWhenReordered() {
    const parent = this.options.item.parentElement;
    let done = false;
    const clear = () => { if (done) return; done = true; observer?.disconnect(); window.clearTimeout(timer); this.restore(false); };
    const order = () => [...(parent?.children ?? [])];
    const before = order();
    const observer = parent ? new MutationObserver(() => { const now = order(); if (now.length !== before.length || now.some((node, index) => node !== before[index])) clear(); }) : null;
    observer?.observe(parent!, { childList: true });
    const timer = window.setTimeout(clear, 1200);
    return () => window.setTimeout(clear, 400);
  }

  /** Back to the plain list: with a short slide (cancelled) or at once (the list has its new order). */
  private restore(animate: boolean) {
    if (this.ended) return;
    this.ended = true;
    const { item, items } = this.options;
    for (const element of items) {
      if (!animate) element.style.transition = 'none';
      else if (element === item) element.style.transition = 'transform 160ms ease';
      element.style.transform = '';
      delete element.dataset.sortState;
    }
    delete document.documentElement.dataset.sorting;
    requestAnimationFrame(() => { for (const element of items) element.style.transition = ''; });
    this.end();
  }

  private end() { this.ended = true; this.options.onEnd?.(); }
}

/** Elements that keep their own pointer meaning inside a draggable row. */
export const interactive = 'input, textarea, select, button:not([data-sort-handle]), a, label, [contenteditable="true"], [role="slider"], .color-button';

/**
 * Starts sorting from a pointer press on a row (or its handle): window listeners follow the pointer, Escape cancels.
 * `list` gives the rows in DOM order at the start. Returns false if the press is not a drag start.
 */
export function startSort(event: PointerEvent | { button: number; isPrimary: boolean; clientX: number; clientY: number; target: EventTarget | null; preventDefault(): void },
  item: HTMLElement, list: HTMLElement[], onDrop: SortOptions['onDrop'], extra: Partial<Pick<SortOptions, 'onStart' | 'onEnd'>> = {}) {
  if (event.button !== 0 || !event.isPrimary || list.length < 2) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(interactive) && !target.closest('[data-sort-handle]')) return false;
  event.preventDefault();
  const session = new SortSession({ item, items: list, x: event.clientX, y: event.clientY, onDrop, onStart: extra.onStart,
    onEnd: () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', cancel); removeEventListener('keydown', key, true); removeEventListener('blur', cancel); extra.onEnd?.(); } });
  const move = (moved: PointerEvent) => { if (session.move(moved.clientX, moved.clientY)) moved.preventDefault(); };
  const up = () => session.finish();
  const cancel = () => session.cancel();
  const key = (pressed: KeyboardEvent) => { if (pressed.key === 'Escape' && session.active) { pressed.preventDefault(); pressed.stopPropagation(); session.cancel(); } };
  addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', cancel); addEventListener('keydown', key, true); addEventListener('blur', cancel);
  return true;
}

/** Moves an item of a list from one index to another (a copy; the same list if nothing moves). */
export function moveTo<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next;
}
