import type { TextField } from './entryEditor';

// Keyboard navigation between entry texts (and the day's title above them), in document order.
const texts = () => Array.from(document.querySelectorAll<TextField>('.entry:not(.entry-leaving) .entry-text'));

export function focusText(element: TextField | HTMLInputElement | null, caret: 'start' | 'end' = 'end'): boolean {
  if (!element) return false;
  element.focus({ preventScroll: true });
  const position = caret === 'end' ? element.value.length : 0;
  element.setSelectionRange(position, position);
  element.scrollIntoView({ block: 'nearest' });
  return true;
}
/** The entry text `offset` steps away from the entry containing `from` (or the first/last one when `from` is outside the list). */
export function adjacentText(from: Element | null, offset: -1 | 1): TextField | null {
  const all = texts();
  const own = from?.closest('.entry')?.querySelector<TextField>('.entry-text');
  const index = own ? all.indexOf(own) : -1;
  if (index < 0) return offset === 1 ? all[0] ?? null : all.at(-1) ?? null;
  return all[index + offset] ?? null;
}
export const titleInput = () => document.querySelector<HTMLInputElement>('#title');
