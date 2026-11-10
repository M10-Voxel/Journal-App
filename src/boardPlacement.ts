import type { BoardPlacement, Card, Patches } from './notebook';
import { pageDirections } from './notebook.ts';

export type BoardPeriod = 'day' | 'month' | 'year';
export const boardKey = (date: string, period: BoardPeriod = 'day') => period === 'day' ? date : `${period}:${date.slice(0, period === 'month' ? 7 : 4)}`;
const periodBoard = (key: string) => key.startsWith('month:') || key.startsWith('year:');
const layoutKeys = ['boardX', 'x', 'y', 'z', 'w', 'h'] as const;
export const cardWidth = (card: Card) => card.w ?? (card.kind === 'note' ? 232 : card.kind === 'image' ? 236 : 260);
export const isOnBoard = (card: Card, key: string) => periodBoard(key) ? !!card.boards?.[key] : card.dates.includes(key);
export const cardOnBoard = (card: Card, key: string): Card => periodBoard(key) ? { ...card, ...card.boards?.[key] } : card;

/**
 * The notes "Existing" offers for a board, each only once:
 * - A note and its copies (copyOf, followed to the first original still there) are one entry; cards already on this
 *   board are not offered (another copy of the same note can still be pinned here).
 * - Old copies without a recorded origin count as the same note when title and text match.
 * - Copies taken off every board and never in the notebook are not offered (the notebook hides them as well).
 * The entry shown is the original when it can be offered, else the most recently ordered copy.
 */
export function libraryNotes(cards: Card[], key: string, query = ''): Card[] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const rootOf = (card: Card) => {
    let root = card;
    for (const seen = new Set<string>(); root.copyOf && byId.has(root.copyOf) && !seen.has(root.id);) { seen.add(root.id); root = byId.get(root.copyOf)!; }
    return root.id;
  };
  const active = (card: Card) => !!card.notebook || card.dates.length > 0 || Object.values(card.boards ?? {}).some(Boolean);
  const notes = cards.filter(card => card.kind === 'note');
  const family = (card: Card) => card.copyOf || notes.some(other => other.copyOf === card.id) ? `copy:${rootOf(card)}` : `same:${card.title.trim()}\u0000${card.text.trim()}`;
  const words = query.trim().toLowerCase();
  const chosen = new Map<string, Card>();
  for (const card of notes) {
    const name = family(card);
    if (isOnBoard(card, key) || !active(card) || !`${card.title} ${card.text}`.toLowerCase().includes(words)) continue;
    const kept = chosen.get(name);
    const original = (other: Card) => !other.copyOf || !byId.has(other.copyOf);
    if (!kept || (original(card) && !original(kept)) || (original(card) === original(kept) && (card.order ?? 0) > (kept.order ?? 0))) chosen.set(name, card);
  }
  return [...chosen.values()];
}

/** Period layout edits stay on this board; title, text and threads still belong to the same card. */
export function scopedBoardPatch(card: Card | undefined, key: string, changes: Partial<Card>): Partial<Card> {
  if (!periodBoard(key)) return changes;
  const patch = { ...changes }, layout: BoardPlacement = {};
  for (const field of layoutKeys) if (field in patch) { layout[field] = patch[field]; delete patch[field]; }
  if (Object.keys(layout).length) patch.boards = { ...card?.boards, ...patch.boards, [key]: { ...card?.boards?.[key], ...patch.boards?.[key], ...layout } };
  return patch;
}

/** Resolve old relative positions before transferring cards to a board with another width. */
export function layoutBoard(cards: Card[], key: string, width: number) {
  const columns = Math.max(1, Math.floor((width + 24) / 264));
  return cards.filter(card => isOnBoard(card, key)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)).map((stored, index) => {
    const card = cardOnBoard(stored, key), free = Math.max(0, width - cardWidth(card) - 16);
    return { card, x: card.boardX ?? Math.round(8 + (card.x ?? (columns > 1 ? (index % columns) / (columns - 1) : 0)) * free), y: card.y ?? 18 + Math.floor(index / columns) * 250, z: card.z ?? 0 };
  });
}

/** Connected components, including indirect or old one-sided threads; missing cards and cycles are harmless. */
export function cardGroups(cards: Card[]): string[][] {
  const adjacency = new Map(cards.map(card => [card.id, new Set<string>()]));
  for (const card of cards) for (const other of card.links ?? []) if (other !== card.id && adjacency.has(other)) { adjacency.get(card.id)!.add(other); adjacency.get(other)!.add(card.id); }
  const seen = new Set<string>(), groups: string[][] = [];
  for (const card of cards) {
    if (seen.has(card.id)) continue;
    const group = [card.id]; seen.add(card.id);
    for (let i = 0; i < group.length; i++) for (const id of adjacency.get(group[i])!) if (!seen.has(id)) { seen.add(id); group.push(id); }
    groups.push(group);
  }
  return groups;
}

/**
 * Independent copies of the cards `ids` (and the threads between them): new ids, the same title, text, paper and size.
 * Notes and links are copied; an image keeps its file under its own card, so images are left out (and the threads to
 * them). Returns the copies in the order of `ids` with the id each one was made from, or none if nothing can be copied.
 */
export const copyableCard = (card: Card) => card.kind !== 'image';
/** The first selected card identifies the source board; use its scoped layout, resolving legacy positions once. */
export function copyLayout(cards: Card[], ids: readonly string[], width: number): Record<string, BoardPlacement> {
  const first = cards.find(card => card.id === ids[0]);
  const source = first?.dates[0] ?? Object.keys(first?.boards ?? {}).find(key => first?.boards?.[key]);
  const wanted = new Set(ids);
  const sourceCards = cards.filter(card => !source || isOnBoard(card, source) || wanted.has(card.id));
  const resolved = layoutBoard(sourceCards.map(card => ({ ...(source ? cardOnBoard(card, source) : card), dates: ['copy-source'] })), 'copy-source', width);
  return Object.fromEntries(resolved.filter(({ card }) => wanted.has(card.id)).map(({ card, x, y, z }) => [card.id, { boardX: x, y, z, w: cardWidth(card), h: card.h }]));
}
export function copyCards(cards: Card[], ids: readonly string[], newId: () => string): { from: string; card: Pick<Card, 'id' | 'kind' | 'title' | 'text' | 'url' | 'paper' | 'w' | 'h' | 'pixel' | 'size' | 'tag' | 'links' | 'groupName' | 'pageLinks'> }[] {
  const chosen = ids.map(id => cards.find(card => card.id === id)).filter((card): card is Card => !!card && copyableCard(card));
  const made = new Map(chosen.map(card => [card.id, newId()]));
  const directions=pageDirections(cards);
  return chosen.map(card => ({ from: card.id, card: {
    id: made.get(card.id)!, kind: card.kind, title: card.title, text: card.text, url: card.url, paper: card.paper, w: card.w, h: card.h, pixel: card.pixel, size: card.size, tag: card.tag, groupName: card.groupName,
    links: (card.links ?? []).filter(other => made.has(other)).map(other => made.get(other)!),
    pageLinks: directions.filter(([from,to])=>from===card.id&&made.has(to)).map(([,to])=>made.get(to)!),
  } }));
}

/** Add references, not copies. Explicit group transfers also align any members already on the destination. */
export function pinToBoard(cards: Card[], ids: readonly string[], key: string, show: boolean, positions: Record<string, BoardPlacement> = {}, replacePositions = false): Patches {
  const wanted = new Set(ids), patches: Patches = {};
  for (const card of cards) {
    if (!wanted.has(card.id) || isOnBoard(card, key) === show && !(show && replacePositions && periodBoard(key))) continue;
    if (periodBoard(key)) {
      const fallback: BoardPlacement = {};
      for (const field of layoutKeys) if (card[field] !== undefined) fallback[field] = card[field];
      patches[card.id] = { boards: { ...card.boards, [key]: show ? { ...fallback, ...positions[card.id] } : null } };
    } else patches[card.id] = { dates: show ? [...card.dates, key] : card.dates.filter(date => date !== key), ...!show && card.onDay && card.dates.length === 1 ? { onDay: false } : {} };
  }
  return patches;
}

export type BoardBox = { left: number; top: number; width: number; height: number };
export function groupFrames(groups: string[][], boxes: Record<string, BoardBox>, padding = 14) {
  return groups.flatMap(group => {
    const ids = group.filter(id => boxes[id]); if (ids.length < 2) return [];
    const left = Math.min(...ids.map(id => boxes[id].left)) - padding, top = Math.min(...ids.map(id => boxes[id].top)) - padding;
    const right = Math.max(...ids.map(id => boxes[id].left + boxes[id].width)) + padding, bottom = Math.max(...ids.map(id => boxes[id].top + boxes[id].height)) + padding;
    return [{ ids, left, top, width: right - left, height: bottom - top }];
  });
}
