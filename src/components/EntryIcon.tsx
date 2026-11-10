import { createElement, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { t, useLanguage } from '../i18n';
import { iconsNow, loadIcons, onIconsLoaded, searchIcons } from '../entryIcons';
import type { IconNode } from '../entryIcons';
import { Icon } from './Icon';
import { Popover } from './Popover';

/** The icon set once it is there (loading starts with the first icon shown or the picker). */
function useIcons() {
  const icons = useSyncExternalStore(onIconsLoaded, iconsNow, iconsNow);
  useEffect(() => { if (!icons) void loadIcons(); }, [icons]);
  return icons;
}

/**
 * An entry's icon: a flat line drawing in `currentColor` (the calendar sets it to the tag's colour). The themes adjust
 * only the line: thinner ink in the journal, a glow in Nebula, square steps in the pixel look (see calendar.css).
 */
export function EntryIcon({ name, className = '', title }: { name: string; className?: string; title?: string }) {
  const icons = useIcons();
  const node = icons?.get(name);
  if (!node) return <span className={`entry-icon is-loading ${className}`} aria-hidden="true" />;
  return <IconSvg node={node} className={className} title={title} />;
}
function IconSvg({ node, className = '', title }: { node: IconNode; className?: string; title?: string }) {
  return <svg className={`entry-icon ${className}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
    aria-hidden={title ? undefined : true} role={title ? 'img' : undefined} aria-label={title}>
    {node.map(([tag, attributes], index) => createElement(tag, { key: index, ...attributes }))}
  </svg>;
}

const columns = 8;
/**
 * Choosing an entry's icon, like a Notion page's: everyday icons first, a search (German or English words) over the
 * whole set, and "no icon". Shown in the tag's colour (`color`). Arrows move in the grid, Enter takes it, Escape closes.
 */
export function IconPicker({ anchor, value, color, onPick, onClose }: {
  anchor: HTMLElement | null; value: string | null | undefined; color?: string; onPick: (name: string | null) => void; onClose: (byKey: boolean) => void;
}) {
  useLanguage();
  const icons = useIcons();
  const [query, setQuery] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(0);
  const grid = useRef<HTMLDivElement>(null);
  const names = icons ? (!query.trim() && showAll ? [...icons.keys()].sort() : searchIcons(icons.keys(), query, Infinity)) : [];
  const options: (string | null)[] = query.trim() ? names : [null, ...names];
  const shown = Math.min(active, Math.max(0, options.length - 1));
  useLayoutEffect(() => {
    const panel = grid.current;
    const option = panel?.querySelector<HTMLElement>(`[data-icon-index="${shown}"]`);
    if (!panel || !option) return;
    const bounds = panel.getBoundingClientRect(), item = option.getBoundingClientRect();
    if (item.top < bounds.top) panel.scrollTop -= bounds.top - item.top;
    else if (item.bottom > bounds.bottom) panel.scrollTop += item.bottom - bounds.bottom;
  }, [shown, query, showAll, icons]);
  const pick = (name: string | null | undefined) => { if (name === undefined) return; onPick(name); onClose(true); };
  return <Popover anchor={anchor} className="icon-picker" label={t('Icon wählen')} onClose={onClose}>
    <div className="icon-picker-body" style={color ? { '--tag': color } as CSSProperties : undefined}>
      <div className="icon-picker-top">
      <label className="tag-picker-search icon-picker-search"><Icon name="search" />
        <input value={query} placeholder={t('Icon suchen, z. B. Arzt, Sport …')} aria-label={t('Icon suchen')} role="combobox" aria-expanded="true" aria-controls="icon-picker-grid"
          aria-activedescendant={options.length ? `icon-option-${shown}` : undefined}
          onChange={event => { setQuery(event.target.value); setActive(0); }}
          onKeyDown={event => {
            const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
            if (event.key in moves && (event.key.startsWith('ArrowU') || event.key.startsWith('ArrowD') || !query || event.currentTarget.selectionStart === event.currentTarget.value.length)) {
              event.preventDefault(); setActive(Math.max(0, Math.min(options.length - 1, shown + moves[event.key])));
            } else if (event.key === 'Enter') { event.preventDefault(); pick(options[shown]); }
            else if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
          }} /></label>
      {/* Two small tabs: everyday icons or the whole set (a search always looks through all of them). */}
      <div className="icon-picker-browse" role="group" aria-label={t('Icons')}>
        {([[false, t('Häufig')], [true, t('Alle Icons')]] as const).map(([all, label]) => <button key={label} type="button" data-browse={all ? 'all' : 'common'} aria-pressed={!query.trim() && showAll === all}
          onClick={() => { setShowAll(all); setQuery(''); setActive(0); if (grid.current) grid.current.scrollTop = 0; }}>{label}</button>)}
      </div>
      </div>
      <div ref={grid} className="icon-picker-grid" id="icon-picker-grid" role="listbox" aria-label={t('Icons')}>
        {!icons && <p className="icon-picker-empty">{t('Icons werden geladen …')}</p>}
        {icons && !options.length && <p className="icon-picker-empty">{t('Kein Icon gefunden.')}</p>}
        {options.map((name, index) => <button key={name ?? 'none'} id={`icon-option-${index}`} type="button" role="option" tabIndex={-1} data-icon-index={index} data-icon={name ?? ''}
          aria-selected={index === shown} className={`icon-option${name === (value ?? null) ? ' is-current' : ''}${name ? '' : ' is-none'}`} title={name ?? t('Kein Icon')}
          aria-label={name ?? t('Kein Icon')} onPointerMove={() => setActive(index)} onClick={() => pick(name)}>
          {name ? <IconSvg node={icons!.get(name)!} /> : icons?.get('ban') ? <IconSvg node={icons.get('ban')!} /> : <Icon name="cancel" />}
        </button>)}
      </div>
      <div className="tag-picker-foot"><span>{query.trim() || showAll ? t('{0} Treffer', names.length) : t('Suche findet alle {0}', icons?.size ?? '…')}</span><span>{t('Pfeile · Enter')}</span></div>
    </div>
  </Popover>;
}
