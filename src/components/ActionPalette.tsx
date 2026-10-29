import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';

export interface PaletteItem<P> {
  id: string; label: string; icon: IconName; keywords?: string; hint?: string; preview?: P; disabled?: boolean;
  /** The current state (e.g. the task's status) is listed but marked instead of being offered as an action. */
  current?: boolean;
  /** Keeps the palette open after running (e.g. it opens the calendar in its place). */
  stays?: boolean;
  run: () => void;
}

const normalize = (text: string) => text.toLocaleLowerCase('de').normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Every word of the query must start a word of the label or keywords; matches at the label's start rank first. */
export function filterItems<T extends { label: string; keywords?: string }>(items: readonly T[], query: string): T[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [...items];
  const scored = items.map((item, index) => {
    const label = normalize(item.label);
    const haystack = `${label} ${normalize(item.keywords ?? '')}`.split(/[\s·,/-]+/);
    const matches = words.every(word => haystack.some(part => part.startsWith(word)));
    return { item, index, matches, rank: label.startsWith(words[0]) ? 0 : 1 };
  });
  return scored.filter(entry => entry.matches).sort((a, b) => a.rank - b.rank || a.index - b.index).map(entry => entry.item);
}

// Keyboard-first command palette for one entry, like Ctrl+Shift+P in an editor: type to filter, ↑/↓ to choose, Enter to run.
// The highlighted action previews its effect on the entry, exactly like hovering in the other layouts.
export function ActionPalette<P>({ items, onPreview, onClose }: { items: PaletteItem<P>[]; onPreview: (preview: P | null) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => filterItems(items, query), [items, query]);
  const runnable = visible.filter(item => !item.disabled && !item.current);
  const current = runnable[Math.min(active, runnable.length - 1)];

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { onPreview(current?.preview ?? null); }, [current?.id]);
  useEffect(() => () => onPreview(null), []);
  useLayoutEffect(() => { listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' }); }, [current?.id]);

  function run(item: PaletteItem<P> | undefined) {
    if (!item || item.disabled || item.current) return;
    item.run();
    if (!item.stays) onClose();
  }

  return <div className="palette" role="dialog" aria-label="Aktionen">
    <label className="palette-search">
      <Icon name="search" />
      <input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={current ? `palette-${current.id}` : undefined}
        placeholder="Aktion …" value={query} data-primary-action="true" autoFocus spellCheck={false} autoComplete="off"
        onChange={event => setQuery(event.target.value)}
        onKeyDown={event => {
          if (event.altKey || event.ctrlKey) return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') setActive(index => (Math.min(index, runnable.length - 1) + (event.key === 'ArrowDown' ? 1 : -1) + runnable.length) % Math.max(runnable.length, 1));
          else if (event.key === 'Home' || event.key === 'End') setActive(event.key === 'Home' ? 0 : runnable.length - 1);
          else if (event.key === 'Enter') run(current);
          else if (event.key === 'Backspace' && query === '') onClose();
          else return;
          event.preventDefault();
          event.stopPropagation();
        }} />
    </label>
    <div className="palette-list" id="palette-list" role="listbox" ref={listRef}>
      {visible.map((item, index) => <div key={item.id} id={`palette-${item.id}`} role="option" className={`palette-item${item.current ? ' is-current' : ''}`}
        aria-selected={item === current} aria-disabled={item.disabled || item.current || undefined} style={{ '--i': index } as CSSProperties}
        onPointerMove={() => { const position = runnable.indexOf(item); if (position >= 0 && position !== active) setActive(position); }}
        onMouseDown={event => event.preventDefault()} onClick={() => run(item)}>
        <Icon name={item.icon} />
        <span className="palette-label">{item.label}</span>
        {item.current ? <span className="palette-badge">aktuell</span> : item.hint && <kbd>{item.hint}</kbd>}
      </div>)}
      {visible.length === 0 && <div className="palette-empty">Keine passende Aktion</div>}
    </div>
  </div>;
}
