import { useState } from 'react';
import { boardKey, cardGroups, isOnBoard, layoutBoard, pinToBoard } from '../boardPlacement';
import { patchCards } from '../boardCards';
import type { BoardPlacement, Card } from '../notebook';
import { useLanguage } from '../i18n';
import { Icon } from './Icon';
import { Popover } from './Popover';

/** The three-line action assigns the same card (or its whole connected group) to a period board. */
export function BoardScopePicker({ cards, id, date, positions = {}, source }: { cards: Card[]; id: string; date: string; positions?: Record<string, BoardPlacement>; source?: string }) {
  const en = useLanguage() === 'en';
  const [anchor, setAnchor] = useState<HTMLElement | null>(null), [whole, setWhole] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const label = en ? 'Show on pinboards' : 'Auf Pinnwänden anzeigen';
  const group = anchor ? cardGroups(cards).find(ids => ids.includes(id)) ?? [id] : [id];
  const selected = whole ? group : [id];
  const targets = anchor ? [
    { key: boardKey(date, 'month'), icon: 'month' as const, name: en ? 'Month' : 'Monat', detail: new Intl.DateTimeFormat(en ? 'en-GB' : 'de-DE', { month: 'long', year: 'numeric' }).format(new Date(`${date}T12:00:00`)) },
    { key: boardKey(date, 'year'), icon: 'year' as const, name: en ? 'Year' : 'Jahr', detail: date.slice(0, 4) },
  ] : [];
  async function assign(key: string, show: boolean) {
    setBusy(true); setError('');
    const resolved = Object.fromEntries(layoutBoard(cards, source ?? date, 640).map(({ card, x, y, z }) => [card.id, { boardX: x, y, z, ...(card.w == null ? {} : { w: card.w }), ...(card.h == null ? {} : { h: card.h }) }]));
    try { await patchCards(pinToBoard(cards, selected, key, show, { ...resolved, ...positions }, whole)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <>
    <button type="button" className="board-extra board-assign" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={!!anchor}
      onClick={event => { setWhole(false); setError(''); setAnchor(anchor ? null : event.currentTarget); }}><Icon name="details" /></button>
    {anchor && <Popover anchor={anchor} label={label} className="board-scope-picker" onClose={() => setAnchor(null)}>
      {group.length > 1 && <div className="board-scope-choice" role="group" aria-label={en ? 'Cards to assign' : 'Karten auswählen'}>
        <button type="button" disabled={busy} aria-pressed={!whole} onClick={() => setWhole(false)}>{en ? 'Only this card' : 'Nur diese Karte'}</button>
        <button type="button" disabled={busy} aria-pressed={whole} onClick={() => setWhole(true)}>{en ? 'Entire group' : 'Gesamte Gruppe'}<small>{group.length}</small></button>
      </div>}
      <div className="board-scope-targets">{targets.map(target => {
        const count = cards.filter(card => selected.includes(card.id) && isOnBoard(card, target.key)).length;
        return <label key={target.key} className="board-scope-target">
          <Icon name={target.icon} /><span>{target.name}<small>{target.detail}</small></span>
          <input type="checkbox" data-board-target={target.key} aria-label={`${target.name} · ${target.detail}`} checked={count === selected.length} disabled={busy}
            ref={element => { if (element) element.indeterminate = count > 0 && count < selected.length; }} onChange={event => void assign(target.key, event.target.checked)} />
        </label>;
      })}</div>
      <p className="board-scope-hint">{en ? 'The same content, with a separate layout on each board.' : 'Derselbe Inhalt, mit eigener Anordnung auf jeder Pinnwand.'}</p>
      {error && <p className="board-status" role="alert">{error}</p>}
    </Popover>}
  </>;
}
