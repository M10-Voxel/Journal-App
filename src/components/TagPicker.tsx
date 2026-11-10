import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { matchTags, maxTagName, nextTagColor } from '../tags';
import type { Tag } from '../tags';
import { createTag, manageTags, useTags } from '../tagStore';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { kindOfTag, orderedTags, tagKindLabel, useTagKindOrder } from '../tagKinds';
import { useActivityTagIds } from '../tagGroups';

type Option = { kind: 'none' } | { kind: 'tag'; tag: Tag } | { kind: 'create'; name: string };

/**
 * Choosing an entry's tag: type to find one (or to make a new one), ↑ ↓ and Enter, or press its number right away
 * (0: no tag). Opened with Alt G or from the entry's tag.
 */
export function TagPicker({ anchor, value, onPick, onClose }: {
  anchor: HTMLElement | null; value: string | null | undefined; onPick: (id: string | null) => void; onClose: (byKey: boolean) => void;
}) {
  useLanguage();
  // Own tags first, then the checklist's, then the mail import's, each kind set apart.
  const activityIds = useActivityTagIds();
  useTagKindOrder();
  const tags = orderedTags(useTags(), activityIds);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const choosing = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const { matches, exact } = matchTags(tags, query);
  const name = query.trim();
  const options: Option[] = [...name ? [] : [{ kind: 'none' } as const], ...matches.map(tag => ({ kind: 'tag', tag }) as const),
    ...name && !exact ? [{ kind: 'create', name } as const] : []];
  const current = options.findIndex(option => option.kind === 'tag' ? option.tag.id === value : option.kind === 'none' && !value);
  const [active, setActive] = useState(Math.max(0, current));
  const shown = Math.min(active, options.length - 1);
  useEffect(() => {
    const container = list.current, option = container?.children[shown] as HTMLElement | undefined;
    if (!container || !option) return;
    const top = option.offsetTop - container.offsetTop;
    if (top < container.scrollTop) container.scrollTop = top;
    else if (top + option.offsetHeight > container.scrollTop + container.clientHeight) container.scrollTop = top + option.offsetHeight - container.clientHeight;
  }, [shown, query]);
  async function choose(option: Option | undefined) {
    if (!option || choosing.current) return;
    if (option.kind === 'none') onPick(null);
    else if (option.kind === 'tag') onPick(option.tag.id);
    else {
      choosing.current = true;
      setBusy(true);
      try { onPick((await createTag(option.name, nextTagColor(tags))).id); }
      catch (reason) { choosing.current = false; setBusy(false); setError(String(reason)); return; }
    }
    onClose(true);
  }
  return <Popover anchor={anchor} className="tag-picker" label={t('Tag zuweisen')} onClose={onClose}>
    <label className="tag-picker-search"><Icon name="tag" />
      <input value={query} maxLength={maxTagName} placeholder={tags.length ? t('Tag suchen oder neu …') : t('Ersten Tag anlegen, z. B. Arbeit …')} aria-label={t('Tag suchen oder anlegen')}
        role="combobox" aria-expanded="true" aria-controls="tag-picker-list" aria-activedescendant={options.length ? `tag-option-${shown}` : undefined}
        onChange={event => { setQuery(event.target.value); setActive(0); setError(''); }}
        onKeyDown={event => {
          const digit = /^[0-9]$/.test(event.key) && !query && !event.altKey && !event.ctrlKey;
          if (digit) { event.preventDefault(); void choose(event.key === '0' ? { kind: 'none' } : tags[Number(event.key) - 1] && { kind: 'tag', tag: tags[Number(event.key) - 1] }); }
          else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive((shown + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % Math.max(1, options.length)); }
          else if (event.key === 'Enter') { event.preventDefault(); void choose(options[shown]); }
          else if (event.key === 'Escape' && query) { event.preventDefault(); setQuery(''); }
        }} /></label>
    <div ref={list} className="tag-picker-list" role="listbox" id="tag-picker-list" aria-label={t('Tags')} aria-busy={busy}>
      {options.map((option, index) => {
        const tag = option.kind === 'tag' ? option.tag : null;
        const number = option.kind === 'none' ? 0 : tag ? tags.indexOf(tag) + 1 : -1;
        const selected = option.kind === 'none' ? !value : tag?.id === value;
        return <button key={option.kind === 'tag' ? option.tag.id : option.kind} id={`tag-option-${index}`} type="button" disabled={busy} role="option" tabIndex={-1} aria-selected={index === shown}
          className={`tag-option is-${option.kind}${selected ? ' is-current' : ''}${tag && !query && index > 0 && (() => { const before = options[index - 1]; return before.kind === 'tag' && kindOfTag(before.tag.id, activityIds) !== kindOfTag(tag.id, activityIds); })() ? ' is-kind-start' : ''}`} data-kind-label={tag ? tagKindLabel(kindOfTag(tag.id, activityIds)) : undefined} style={{ '--tag': tag?.color ?? (option.kind === 'create' ? nextTagColor(tags) : undefined) } as CSSProperties}
          onPointerMove={() => setActive(index)} onClick={() => void choose(option)}>
          {option.kind === 'none' ? <span className="tag-dot is-empty" /> : option.kind === 'create' ? <Icon name="tag" /> : <span className="tag-dot" />}
          <span className="tag-option-name">{option.kind === 'none' ? t('Kein Tag') : option.kind === 'create' ? <>{t('Neuer Tag')} <strong>„{option.name}“</strong></> : tag!.name}</span>
          {selected && <Icon name="check" />}
          {number >= 0 && number <= 9 && !query && <kbd>{number}</kbd>}
        </button>;
      })}
    </div>
    {error && <p className="tag-picker-error" role="alert">{error}</p>}
    <div className="tag-picker-foot"><span>{t('↑ ↓ · Enter · 0–9')}</span>{manageTags.available() && <button type="button" onClick={() => manageTags()}>{t('Verwalten …')}</button>}</div>
  </Popover>;
}
