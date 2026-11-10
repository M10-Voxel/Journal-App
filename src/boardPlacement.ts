import type { BoardPlacement, Card, Patches } from './notebook';

export type BoardPeriod = 'day' | 'month' | 'year';
export const boardKey = (date: string, period: BoardPeriod = 'day') => period === 'day' ? date : `${period}:${date.slice(0, period === 'month' ? 7 : 4)}`;
const periodBoard = (key: string) => key.startsWith('month:') || key.startsWith('year:');
const layoutKeys = ['boardX', 'x', 'y', 'z', 'w', 'h'] as const;
export const cardWidth = (card: Card) => card.w ?? (card.kind === 'note' ? 232 : card.kind === 'image' ? 236 : 260);
export const isOnBoard = (card: Card, key: string) => periodBoard(key) ? !!card.boards?.[key] : card.dates.includes(key);
export const cardOnBoard = (card: Card, key: string): Card => periodBoard(key) ? { ...card, ...card.boards?.[key] } : card;

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
export function copyCards(cards: Card[], ids: readonly string[], newId: () => string): { from: string; card: Pick<Card, 'id' | 'kind' | 'title' | 'text' | 'url' | 'paper' | 'w' | 'h' | 'pixel' | 'size' | 'tag' | 'links'> }[] {
  const chosen = ids.map(id => cards.find(card => card.id === id)).filter((card): card is Card => !!card && copyableCard(card));
  const made = new Map(chosen.map(card => [card.id, newId()]));
  return chosen.map(card => ({ from: card.id, card: {
    id: made.get(card.id)!, kind: card.kind, title: card.title, text: card.text, url: card.url, paper: card.paper, w: card.w, h: card.h, pixel: card.pixel, size: card.size, tag: card.tag,
    links: (card.links ?? []).filter(other => made.has(other)).map(other => made.get(other)!),
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
