import { useSyncExternalStore } from 'react';
import type { Entry } from './journal';

/**
 * Entries chosen in the calendar by drawing a frame around them (left drag over the calendar): each must lie wholly
 * inside it. Chosen entries are only marked; dragging one moves them all by the same days and minutes, Delete removes
 * them, Escape or a press elsewhere lets them go. Every shown calendar entry registers its element here.
 */
export interface Picked { entry: Entry; date: string }
const items = new Map<HTMLElement, Picked>();
let selected = new Map<string, Picked>();
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function registerCalendarItem(element: HTMLElement, picked: Picked) { items.set(element, picked); }
export function unregisterCalendarItem(element: HTMLElement) { items.delete(element); }
/** Chooses the entries of `root` whose element lies wholly inside `frame` (and keeps `keep` chosen, with Ctrl). */
export function selectInFrame(root: Element, frame: DOMRect, keep = false) {
  const next = new Map(keep ? selected : []);
  for (const [element, picked] of items) {
    if (!element.isConnected || !root.contains(element)) continue;
    const rect = element.getBoundingClientRect();
    if (rect.width && rect.left >= frame.left && rect.right <= frame.right && rect.top >= frame.top && rect.bottom <= frame.bottom) next.set(picked.entry.id, picked);
  }
  const same = next.size === selected.size && [...next.keys()].every(id => selected.has(id));
  if (!same) { selected = next; notify(); }
}
/** The elements of the other chosen entries (to show them moving along with the one being dragged). */
export function chosenElements(except: string): HTMLElement[] {
  if (!selected.has(except)) return [];
  return [...items].filter(([element, picked]) => element.isConnected && picked.entry.id !== except && selected.has(picked.entry.id)).map(([element]) => element);
}
/** After moving, the chosen entries stay chosen at their new place. */
export function rememberMoved(moves: Picked[]) {
  let changed = false;
  for (const picked of moves) if (selected.has(picked.entry.id)) { selected.set(picked.entry.id, picked); changed = true; }
  if (changed) { selected = new Map(selected); notify(); }
}
export function clearCalendarSelection() { if (selected.size) { selected = new Map(); notify(); } }
export const calendarSelection = (): ReadonlyMap<string, Picked> => selected;
export function useCalendarSelected(id: string): boolean {
  return useSyncExternalStore(subscribe, () => selected.has(id));
}
export function useCalendarSelectionSize(): number {
  return useSyncExternalStore(subscribe, () => selected.size);
}
