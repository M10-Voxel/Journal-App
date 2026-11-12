import { useRef } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { t } from '../i18n';
import { startSort } from '../sortable';
import { Icon } from './Icon';

type Drop = (from: number, to: number) => void | Promise<unknown>;

/**
 * Rows sorted by dragging (sortable.ts): spread on a row marked `data-sort-item`; its list is the row's siblings with
 * that mark. Pressing on anything that is not a field or a button (or on the handle) and moving drags the row.
 */
export function useSortRows(onDrop: Drop) {
  const latest = useRef(onDrop); latest.current = onDrop;
  return (event: PointerEvent<HTMLElement>) => {
    const item = event.currentTarget.closest<HTMLElement>('[data-sort-item]');
    if (!item?.parentElement) return;
    const list = [...item.parentElement.children].filter((node): node is HTMLElement => node instanceof HTMLElement && node.hasAttribute('data-sort-item'));
    startSort(event.nativeEvent, item, list, (from, to) => latest.current(from, to));
  };
}

/**
 * The grip of a sortable row: drag it (or the row), or focus it and press ↑ / ↓ to move the row a place; the focus stays
 * on the grip. `name` says which row it moves.
 */
export function SortHandle({ name, index, count, onMove }: { name: string; index: number; count: number; onMove: (from: number, to: number) => void | Promise<unknown> }) {
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    if ((event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.ctrlKey || event.metaKey) return;
    const to = index + (event.key === 'ArrowUp' ? -1 : 1);
    event.preventDefault(); event.stopPropagation();
    if (to < 0 || to >= count) return;
    const handle = event.currentTarget, row = handle.closest<HTMLElement>('[data-sort-item]'), id = row?.dataset.sortItem;
    void Promise.resolve(onMove(index, to)).then(() => requestAnimationFrame(() => {
      const moved = id ? row?.parentElement?.querySelector<HTMLElement>(`[data-sort-item="${CSS.escape(id)}"] [data-sort-handle]`) : null;
      (moved ?? handle).focus({ preventScroll: false });
    }));
  };
  return <button type="button" className="sort-handle" data-sort-handle aria-label={t('{0} verschieben (ziehen oder ↑ ↓)', name)} title={t('Ziehen zum Verschieben · ↑ ↓')} onKeyDown={key}>
    <Icon name="grip" />
  </button>;
}
