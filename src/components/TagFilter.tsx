import { t, useLanguage } from '../i18n';
import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { untagged } from '../tags';
import { manageTags, useTags } from '../tagStore';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { EntryIcon } from './EntryIcon';
import { groupTags, orderedTags, tagKindLabel, useTagKindOrder } from '../tagKinds';
import { useActivityTagIds } from '../tagGroups';

/**
 * Showing and hiding tags in a view: a small button with the colours of the shown tags (struck through where some are
 * hidden), and a list to tick them on and off. 1–9 and 0 (no tag) toggle at once, A shows all again; Alt+click (or
 * Shift+Enter) keeps only that one.
 */
export function TagFilter({ hidden, onChange, label }: { hidden: ReadonlySet<string>; onChange: (next: ReadonlySet<string>) => void; label: string }) {
  useLanguage();
  const activityIds = useActivityTagIds();
  useTagKindOrder();
  const tags = orderedTags(useTags(), activityIds);
  const groups = groupTags(tags, activityIds);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  if (!tags.length) return null;
  const keys = [untagged, ...tags.map(tag => tag.id)];
  const hiddenCount = keys.filter(key => hidden.has(key)).length;
  const toggle = (key: string) => { const next = new Set(hidden); if (next.has(key)) next.delete(key); else next.add(key); onChange(next); };
  const only = (key: string) => onChange(new Set(keys.filter(other => other !== key)));
  const shownTags = tags.filter(tag => !hidden.has(tag.id));
  return <>
    <button ref={button} type="button" className={`tag-filter-button${hiddenCount ? ' is-filtering' : ''}`} aria-haspopup="dialog" aria-expanded={open}
      aria-label={hiddenCount ? t('{0}: {1} ausgeblendet', label, hiddenCount) : label} data-tip={hiddenCount ? t('{0} ausgeblendet', hiddenCount) : t('Tags ein- und ausblenden')} onClick={() => setOpen(current => !current)}>
      <Icon name="tag" />
      <span className="tag-filter-dots" aria-hidden="true">{shownTags.slice(0, 4).map(tag => <i key={tag.id} style={{ '--tag': tag.color } as CSSProperties} />)}</span>
      {hiddenCount > 0 && <span className="tag-filter-count" aria-hidden="true">−{hiddenCount}</span>}
    </button>
    {open && <Popover anchor={button.current} className="tag-filter" label={label} align="end" onClose={byKey => { setOpen(false); if (byKey) button.current?.focus(); }}>
      <div ref={list} className="tag-filter-list" role="group" aria-label={label}
        onKeyDown={event => {
          const rows = [...list.current!.querySelectorAll<HTMLButtonElement>('.tag-filter-row')];
          const index = rows.indexOf(document.activeElement as HTMLButtonElement);
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); rows[(index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length]?.focus(); }
          else if (/^[0-9]$/.test(event.key) && !event.ctrlKey && !event.altKey) { event.preventDefault(); const key = event.key === '0' ? untagged : tags[Number(event.key) - 1]?.id; if (key) toggle(key); }
          else if (event.key.toLowerCase() === 'a' && !event.ctrlKey && !event.altKey) { event.preventDefault(); onChange(new Set()); }
        }}>
        {groups.map((group, groupIndex) => <div key={group.kind} className={`tag-filter-group is-${group.kind}`} role="group" aria-label={tagKindLabel(group.kind)}>
          {groups.length > 1 && <span className="tag-group-label" aria-hidden="true">{tagKindLabel(group.kind)}</span>}
          {group.tags.map(tag => { const index = tags.indexOf(tag); return <button key={tag.id} type="button" role="checkbox" className="tag-filter-row" aria-checked={!hidden.has(tag.id)} style={{ '--tag': tag.color } as CSSProperties}
            data-autofocus={index === 0 && groupIndex === 0 ? true : undefined} onClick={event => event.altKey ? only(tag.id) : toggle(tag.id)}
            onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); only(tag.id); } }}>
            <span className="tag-check" aria-hidden="true"><Icon name="check" /></span>{tag.icon && <EntryIcon name={tag.icon} className="tag-icon" />}<span className="tag-filter-name">{tag.name}</span>{index < 9 && <kbd>{index + 1}</kbd>}
          </button>; })}
        </div>)}
        <button type="button" role="checkbox" className="tag-filter-row is-untagged" aria-checked={!hidden.has(untagged)}
          onClick={event => event.altKey ? only(untagged) : toggle(untagged)} onKeyDown={event => { if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); only(untagged); } }}>
          <span className="tag-check" aria-hidden="true"><Icon name="check" /></span><span className="tag-filter-name">{t('Ohne Tag')}</span><kbd>0</kbd>
        </button>
      </div>
      <div className="tag-picker-foot">
        <button type="button" disabled={!hiddenCount} onClick={() => onChange(new Set())}>{t('Alle zeigen')} <kbd>A</kbd></button>
        <span>{t('Alt+Klick: nur dieser')}</span>
        {manageTags.available() && <button type="button" aria-label={t('Tags verwalten')} data-tip={t('Tags verwalten')} onClick={() => { setOpen(false); manageTags(); }}><Icon name="settings" /></button>}
      </div>
    </Popover>}
  </>;
}
