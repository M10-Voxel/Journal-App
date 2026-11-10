import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { maxTagName, nextTagColor, tagSwatches } from '../tags';
import type { Tag } from '../tags';
import { saveTags, useTags } from '../tagStore';
import { ColorButton } from './ColorPicker';
import { Icon } from './Icon';
import { groupTags, moveKind, moveWithinKind, orderedTags, resetKindOrder, tagKindLabel, tagKinds, useTagKindOrder } from '../tagKinds';
import { useActivityTagIds } from '../tagGroups';

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
  // Tags move only among those of their kind (own, checklist, mail); the stored list keeps the kinds together.
  const move = (index: number, step: -1 | 1) => {
    const id = shown[index].id;
    void store(current => moveWithinKind(current, id, step, activityIds))
      .then(() => requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-tag-id="${id}"] ${step < 0 ? '.tag-up' : '.tag-down'}`)?.focus()));
  };
  const newColor = color ?? nextTagColor(tags);
  async function add() {
    const value = name.trim();
    if (!value) return;
    const tag = { id: crypto.randomUUID(), name: value, color: newColor };
    if (await store(current => [...current, tag])) { setName(''); setColor(null); }
  }

  return <div className="tag-settings">
    <h3 id="settings-tags-title">{t('Tags')}</h3>
    <p className="settings-hint">{t('Tags wie Arbeit, Privat oder Uni gruppieren Einträge im Journal und färben sie im Kalender. Zuweisen mit ')}<kbd>Alt</kbd> <kbd>G</kbd>{t(' am Eintrag oder im Kalender-Popup; ein- und ausblenden über das Tag-Symbol in der Leiste.')}</p>
    <div ref={listRef} className="tag-list" role="list" aria-labelledby="settings-tags-title">
      {groups.map(group => <div key={group.kind} className={`tag-group is-${group.kind}`} role="group" aria-label={tagKindLabel(group.kind)}>
      <h4 className="tag-group-label">{tagKindLabel(group.kind)}
        {/* The kinds sit in this order in every list; the numbers 1–9 follow it. */}
        <span className="tag-group-move">
          <button type="button" className="cal-icon-button" aria-label={t('{0} nach oben', tagKindLabel(group.kind))} data-tip={t('Nach oben')} disabled={kindOrder.indexOf(group.kind) === 0} onClick={() => moveKind(group.kind, -1)}><Icon name="up" /></button>
          <button type="button" className="cal-icon-button" aria-label={t('{0} nach unten', tagKindLabel(group.kind))} data-tip={t('Nach unten')} disabled={kindOrder.indexOf(group.kind) === kindOrder.length - 1} onClick={() => moveKind(group.kind, 1)}><Icon name="down" /></button>
        </span></h4>
      {group.tags.map((tag, place) => { const index = shown.indexOf(tag); return <div key={tag.id} className="tag-row" role="listitem" style={{ '--tag': tag.color } as CSSProperties} data-tag-row={tag.name} data-tag-id={tag.id}>
        <ColorButton value={tag.color} label={tag.name} swatches={tagSwatches} onChange={value => recolor(tag.id, value)} />
        <NameField tag={tag} onRename={value => store(current => current.map(other => other.id === tag.id ? { ...other, name: value } : other))} />
        <span className="tag-row-sample" aria-hidden="true"><i />{tag.name}</span>
        <kbd className="tag-row-key" title={t('Taste in Auswahl und Filter')}>{index < 9 ? index + 1 : ''}</kbd>
        <button type="button" className="cal-icon-button tag-up" aria-label={t('{0} nach oben', tag.name)} data-tip={t('Nach oben')} disabled={place === 0} onClick={() => move(index, -1)}><Icon name="up" /></button>
        <button type="button" className="cal-icon-button tag-down" aria-label={t('{0} nach unten', tag.name)} data-tip={t('Nach unten')} disabled={place === group.tags.length - 1} onClick={() => move(index, 1)}><Icon name="down" /></button>
        {removing === tag.id
          ? <button type="button" className="tag-remove is-asking" data-autofocus onBlur={() => setRemoving(null)} onClick={() => { setRemoving(null); void store(current => current.filter(other => other.id !== tag.id)); }}>{t('Löschen?')}</button>
          : <button type="button" className="cal-icon-button tag-remove" aria-label={t('{0} löschen', tag.name)} data-tip={t('Löschen · Einträge behalten, ohne Tag')} onClick={event => { const row = event.currentTarget.closest('.tag-row'); setRemoving(tag.id); requestAnimationFrame(() => row?.querySelector<HTMLButtonElement>('.tag-remove')?.focus()); }}><Icon name="trash" /></button>}
      </div>; })}
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
  </div>;
}
