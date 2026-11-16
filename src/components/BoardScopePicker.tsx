import { memo, useState } from 'react';
import { boardKey, cardGroups, isOnBoard, layoutBoard, pinToBoard } from '../boardPlacement';
import { patchCards, useCards } from '../boardCards';
import type { BoardPlacement, Card } from '../notebook';
import { useLanguage, t } from '../i18n';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { periodTitle } from './PeriodNotes';
import { useFeatures } from '../featureStore';
import { periodBoards } from '../features';

const boardNames = () => ({ week: t("Woche"), month: t("Monat"), quarter: t("Quartal"), year: t("Jahr") });
type Positions = Record<string, BoardPlacement> | (() => Record<string, BoardPlacement>);

/**
 * The three-line action assigns the same card (or its whole connected group) to a period board. Closed it is only its
 * button: the cards (`cards`, else the board's store) and the positions on the board shown (`positions`, also as a
 * function, read when assigning) are only used while it is open, so a board's cards need not re-render for it.
 */
export const BoardScopePicker = memo(function BoardScopePicker({ cards, id, date, positions, source }: { cards?: Card[]; id: string; date: string; positions?: Positions; source?: string }) {
  useLanguage();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = t("Auf Pinnwänden anzeigen");
  // Only the period boards that are on (Einstellungen → Funktionen); without any the action is not offered.
  const periods = periodBoards(useFeatures());
  if (!periods.length) return null;
  return <>
    <button type="button" className="board-extra board-assign" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={!!anchor}
      onClick={event => setAnchor(anchor ? null : event.currentTarget)}><Icon name="details" /></button>
    {anchor && <ScopePopover anchor={anchor} label={label} cards={cards} id={id} date={date} positions={positions} source={source} periods={periods} onClose={() => setAnchor(null)} />}
  </>;
});

function ScopePopover({ anchor, label, cards: given, id, date, positions = {}, source, periods, onClose }: { anchor: HTMLElement; label: string; cards?: Card[]; id: string; date: string; positions?: Positions; source?: string;
  periods: ReturnType<typeof periodBoards>; onClose: () => void }) {
  const stored = useCards().cards, cards = given ?? stored;
  const [whole, setWhole] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const group = cardGroups(cards).find(ids => ids.includes(id)) ?? [id];
  const selected = whole ? group : [id];
  const targets = periods.map(period => ({ key: boardKey(date, period), icon: period, name: boardNames()[period], detail: periodTitle(date, period) }));
  async function assign(key: string, show: boolean) {
    setBusy(true); setError('');
    const resolved = Object.fromEntries(layoutBoard(cards, source ?? date, 640).map(({ card, x, y, z }) => [card.id, { boardX: x, y, z, ...(card.w == null ? {} : { w: card.w }), ...(card.h == null ? {} : { h: card.h }) }]));
    const shown = typeof positions === 'function' ? positions() : positions;
    try { await patchCards(pinToBoard(cards, selected, key, show, { ...resolved, ...shown }, whole)); }
    catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  }
  return <Popover anchor={anchor} label={label} className="board-scope-picker" onClose={onClose}>
    {group.length > 1 && <div className="board-scope-choice" role="group" aria-label={t("Karten auswählen")}>
      <button type="button" disabled={busy} aria-pressed={!whole} onClick={() => setWhole(false)}>{t("Nur diese Karte")}</button>
      <button type="button" disabled={busy} aria-pressed={whole} onClick={() => setWhole(true)}>{t("Gesamte Gruppe")}<small>{group.length}</small></button>
    </div>}
    <div className="board-scope-targets">{targets.map(target => {
      const count = cards.filter(card => selected.includes(card.id) && isOnBoard(card, target.key)).length;
      return <label key={target.key} className="board-scope-target">
        <Icon name={target.icon} /><span>{target.name}<small>{target.detail}</small></span>
        <input type="checkbox" data-board-target={target.key} aria-label={`${target.name} · ${target.detail}`} checked={count === selected.length} disabled={busy}
          ref={element => { if (element) element.indeterminate = count > 0 && count < selected.length; }} onChange={event => void assign(target.key, event.target.checked)} />
      </label>;
    })}</div>
    <p className="board-scope-hint">{t("Derselbe Inhalt, mit eigener Anordnung auf jeder Pinnwand.")}</p>
    {error && <p className="board-status" role="alert">{error}</p>}
  </Popover>;
}
