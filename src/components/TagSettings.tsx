import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { maxTagName, nextTagColor, tagSwatches } from '../tags';
import type { Tag } from '../tags';
import { saveTags, useTags } from '../tagStore';
import { ColorButton } from './ColorPicker';
import { Icon } from './Icon';
import { EntryIcon, IconPicker } from './EntryIcon';
import { groupTags, moveKindTo, moveWithinKindTo, orderedTags, resetKindOrder, tagKindLabel, tagKinds, useTagKindOrder } from '../tagKinds';
import { SortHandle, useSortRows } from './SortHandle';
import { useActivityTagIds } from '../tagGroups';

/** The tags of one kind, sorted by dragging among themselves. */
function TagRows({ group, onMove, children }: { group: Tag[]; onMove: (id: string, to: number) => Promise<boolean>; children: (tag: Tag, place: number, drag: ReturnType<typeof useSortRows>) => ReactNode }) {
  const drag = useSortRows((from, to) => onMove(group[from].id, to));
  return <>{group.map((tag, place) => children(tag, place, drag))}</>;
}

/** A name edited in place: saved on Enter or when leaving the field, Escape takes the change back. */
function NameField({ tag, onRename }: { tag: Tag; onRename: (name: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState(tag.name);
  useEffect(() => setDraft(tag.name), [tag.name]);
  const commit = async () => { const name = draft.trim(); if (!name || name === tag.name || !await onRename(name)) setDraft(tag.name); };
  return <input className="tag-name" value={draft} maxLength={maxTagName} spellCheck={false} aria-label={t('Name des Tags {0}', tag.name)}
    onChange={event => setDraft(event.target.value)} onBlur={() => void commit()}
    onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      else if (event.key === 'Escape' && draft !== tag.name) { event.preventDefault(); event.stopPropagation(); setDraft(tag.name); }
    }} />;
}

export function TagSettings() {
  useLanguage();
  const tags = useTags();
  const [error, setError] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [choosingIcon, setChoosingIcon] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  // Dragging in the colour picker changes the colour continuously; it is shown at once and stored a moment later.
  const [colors, setColors] = useState<Record<string, string>>({});
  const pending = useRef<number | undefined>(undefined);
  const mounted = useRef(true);
  const latest = useRef({ colors });
  latest.current = { colors };
  const listRef = useRef<HTMLDivElement>(null);
  const activityIds = useActivityTagIds();
  const kindOrder = useTagKindOrder();
  const shown = orderedTags(tags, activityIds).map(tag => colors[tag.id] ? { ...tag, color: colors[tag.id] } : tag);
  const groups = groupTags(shown, activityIds);
  async function store(edit: (current: Tag[]) => Tag[]): Promise<boolean> {
    window.clearTimeout(pending.current);
    pending.current = undefined;
    const applied = { ...latest.current.colors };
    try {
      await saveTags(current => edit(current).map(tag => applied[tag.id] ? { ...tag, color: applied[tag.id] } : tag));
      const remaining = { ...latest.current.colors };
      for (const [id, value] of Object.entries(applied)) if (remaining[id] === value) delete remaining[id];
      latest.current.colors = remaining;
      if (mounted.current) { setColors(remaining); setError(''); }
      return true;
    } catch (reason) {
      if (mounted.current) setError(String(reason).includes('Ungültiger Tag') ? t('Jeder Tag braucht einen eigenen Namen (höchstens {0} Zeichen).', maxTagName) : String(reason));
      return false;
    }
  }
  const recolor = (id: string, value: string) => {
    const next = { ...latest.current.colors, [id]: value };
    latest.current.colors = next;
    setColors(next);
    window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => { void store(current => current); }, 250);
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Closing the settings or switching tabs must commit the last drag/hex edit as well.
      if (pending.current !== undefined || Object.keys(latest.current.colors).length) void store(current => current);
    };
  }, []);
  // Tags are dragged (or moved with ↑ ↓ on their grip) only among those of their kind (own, checklist, mail); the stored
  // list keeps the kinds together. The kinds themselves are dragged by their heading.
  const moveTag = (id: string, to: number) => store(current => moveWithinKindTo(current, id, to, activityIds));
  const dragKind = useSortRows((from, to) => { moveKindTo(groups[from].kind, to); });
  const newColor = color ?? nextTagColor(tags);
  async function add() {
    const value = name.trim();
    if (!value) return;
    const tag = { id: crypto.randomUUID(), name: value, color: newColor };
    if (await store(current => [...current, tag])) { setName(''); setColor(null); }
  }

  return <div className="tag-settings">
    <h3 id="settings-tags-title">{t('Tags')}</h3>
    <p className="settings-hint">{t('Tags wie Arbeit, Privat oder Uni gruppieren Einträge im Journal und färben sie im Kalender. Zuweisen mit ')}<kbd>Alt</kbd> <kbd>G</kbd>{t(' am Eintrag oder im Kalender-Popup; ein- und ausblenden über das Tag-Symbol in der Leiste. Mit einem Icon zeigt ein Tag an den Einträgen das Icon statt seines Namens.')}</p>
    <div ref={listRef} className="tag-list" role="list" aria-labelledby="settings-tags-title">
      {groups.map((group, groupIndex) => <div key={group.kind} className={`tag-group is-${group.kind}`} role="group" aria-label={tagKindLabel(group.kind)} data-sort-item={group.kind}>
      {/* The kinds sit in this order in every list; the numbers 1–9 follow it. Drag a kind by its heading. */}
      <h4 className="tag-group-label" onPointerDown={dragKind}><SortHandle name={tagKindLabel(group.kind)} index={groupIndex} count={groups.length} onMove={(_, to) => { moveKindTo(group.kind, to); }} />{tagKindLabel(group.kind)}</h4>
      <TagRows group={group.tags} onMove={moveTag}>{(tag, place, drag) => { const index = shown.indexOf(tag); return <div key={tag.id} className="tag-row" role="listitem" style={{ '--tag': tag.color } as CSSProperties} data-tag-row={tag.name} data-tag-id={tag.id} data-sort-item={tag.id} onPointerDown={drag}>
        <SortHandle name={tag.name} index={place} count={group.tags.length} onMove={(_, to) => moveTag(tag.id, to)} />
        <ColorButton value={tag.color} label={tag.name} swatches={tagSwatches} onChange={value => recolor(tag.id, value)} />
        <button type="button" className={`cal-icon-button tag-icon-button${tag.icon ? ' has-icon' : ''}`} aria-label={tag.icon ? t('Icon von {0} ändern', tag.name) : t('Icon für {0} wählen', tag.name)}
          data-tip={tag.icon ? t('Icon ändern · an Einträgen statt des Namens') : t('Icon wählen · an Einträgen statt des Namens')} aria-haspopup="dialog" aria-expanded={choosingIcon?.id === tag.id}
          onClick={event => setChoosingIcon({ id: tag.id, anchor: event.currentTarget })}>{tag.icon ? <EntryIcon name={tag.icon} /> : <Icon name="icon" />}</button>
        <NameField tag={tag} onRename={value => store(current => current.map(other => other.id === tag.id ? { ...other, name: value } : other))} />
        <span className={`tag-row-sample${tag.icon ? ' has-icon' : ''}`} aria-hidden="true">{tag.icon ? <EntryIcon name={tag.icon} /> : <><i />{tag.name}</>}</span>
        <kbd className="tag-row-key" title={t('Taste in Auswahl und Filter')}>{index < 9 ? index + 1 : ''}</kbd>
        {removing === tag.id
          ? <button type="button" className="tag-remove is-asking" data-autofocus onBlur={() => setRemoving(null)} onClick={() => { setRemoving(null); void store(current => current.filter(other => other.id !== tag.id)); }}>{t('Löschen?')}</button>
          : <button type="button" className="cal-icon-button tag-remove" aria-label={t('{0} löschen', tag.name)} data-tip={t('Löschen · Einträge behalten, ohne Tag')} onClick={event => { const row = event.currentTarget.closest('.tag-row'); setRemoving(tag.id); requestAnimationFrame(() => row?.querySelector<HTMLButtonElement>('.tag-remove')?.focus()); }}><Icon name="trash" /></button>}
      </div>; }}</TagRows>
      </div>)}
      {!tags.length && <p className="tag-empty">{t('Noch keine Tags.')}</p>}
      {kindOrder.some((kind, index) => kind !== tagKinds[index]) && <button type="button" className="tag-kind-reset" onClick={resetKindOrder}>{t('Reihenfolge der Kategorien zurücksetzen')}</button>}
    </div>
    <form className="tag-row is-new" style={{ '--tag': newColor } as CSSProperties} onSubmit={event => { event.preventDefault(); void add(); }}>
      <ColorButton value={newColor} label={t('Neuer Tag')} swatches={tagSwatches} onChange={setColor} />
      <input className="tag-name" value={name} maxLength={maxTagName} placeholder={t('Neuer Tag, z. B. Uni …')} aria-label={t('Name des neuen Tags')} onChange={event => { setName(event.target.value); setError(''); }} />
      <button type="submit" className="tag-add" disabled={!name.trim()}><Icon name="check" />{t('Anlegen')}</button>
    </form>
    {error && <p className="tag-error" role="alert">{error}</p>}
    {choosingIcon && (() => { const tag = tags.find(other => other.id === choosingIcon.id); return tag ? <IconPicker anchor={choosingIcon.anchor} value={tag.icon} color={tag.color}
      onPick={name => void store(current => current.map(other => other.id === tag.id ? { ...other, icon: name } : other))}
      onClose={() => { const anchor = choosingIcon.anchor; setChoosingIcon(null); requestAnimationFrame(() => anchor.isConnected && anchor.focus({ preventScroll: true })); }} /> : null; })()}
  </div>;
}
