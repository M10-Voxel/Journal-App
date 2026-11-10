import type { Card, Patches } from './notebook';
import { cardGroups, copyLayout, isOnBoard, layoutBoard } from './boardPlacement.ts';

const shared = ['title', 'text', 'paper', 'tag', 'url', 'pixel', 'groupName'] as const;
const geometry = ['boardX', 'x', 'y', 'w', 'h'] as const;
const positions = ['boardX', 'x', 'y'] as const;
const changedBoard = (card: Card, patch: Partial<Card>) => Object.entries(patch.boards ?? {}).find(([key, value]) => value && positions.some(field => field in value && value[field] !== card.boards?.[key]?.[field]))?.[0];
function layoutChanges(card: Card | undefined, patch: Partial<Card>) {
  const changed = Object.fromEntries(geometry.filter(field => field in patch).map(field => [field, patch[field]]));
  for (const [key, layout] of Object.entries(patch.boards ?? {})) if (layout) {
    for (const field of geometry) if (field in layout && layout[field] !== card?.boards?.[key]?.[field]) changed[field] = layout[field];
  }
  return changed;
}

/** Explicit opt-in copy edges only; ordinary threads and unrelated cards never share edits. */
export function syncPatches(cards: Card[], patches: Patches): Patches {
  const original = new Map(cards.map(card => [card.id, card]));
  if (!Object.entries(patches).some(([id, patch]) => shared.some(field => field in patch) || Object.keys(layoutChanges(original.get(id), patch)).length)) return patches;
  const byId = new Map(cards.map(card => [card.id, { ...card, ...patches[card.id] }]));
  const groups = cardGroups(cards), groupOf = new Map(groups.flatMap(group => group.map(id => [id, group] as const)));
  const groupAt = (id: string, patch: Partial<Card> = {}) => {
    const card = original.get(id)!, key = changedBoard(card, patch);
    return (groupOf.get(id) ?? []).filter(other => {
      const peer = original.get(other)!;
      if (key) return isOnBoard(peer, key);
      if (card.dates.length) return peer.dates.some(date => card.dates.includes(date));
      const periods = Object.keys(card.boards ?? {}).filter(key => card.boards?.[key]);
      return !periods.length || periods.some(key => isOnBoard(peer, key));
    });
  };
  const point = (card: Card, patch: Partial<Card> = {}) => {
    const board = changedBoard(card, patch);
    const at = board ? { ...card, ...card.boards?.[board] } : card;
    const fallback = copyLayout(cards, [card.id], 640)[card.id];
    return { x: at.boardX ?? fallback?.boardX ?? 8, y: at.y ?? fallback?.y ?? 18 };
  };
  const delta = (id: string) => {
    const card = original.get(id)!, patch = patches[id] ?? {}, change = layoutChanges(card, patch), before = point(card, patch);
    return { x: typeof change.boardX === 'number' ? change.boardX - before.x : 0, y: typeof change.y === 'number' ? change.y - before.y : 0 };
  };
  const edges = new Map<string, Set<string>>();
  for (const card of byId.values()) if (card.copySync && card.copyOf && byId.has(card.copyOf)) {
    for (const [a, b] of [[card.id, card.copyOf], [card.copyOf, card.id]]) {
      if (!edges.has(a)) edges.set(a, new Set());
      edges.get(a)!.add(b);
    }
  }
  const result = Object.fromEntries(Object.entries(patches).map(([id, patch]) => [id, { ...patch }]));
  const components = new Map<string, string[]>();
  for (const [id, patch] of Object.entries(patches)) {
    const content = Object.fromEntries(shared.filter(field => field in patch).map(field => [field, patch[field]]));
    const changedLayout = layoutChanges(original.get(id), patch);
    const layout = Object.fromEntries(['w', 'h'].filter(field => field in changedLayout).map(field => [field, changedLayout[field]]));
    if ((!Object.keys(content).length && !Object.keys(changedLayout).length) || !edges.has(id)) continue;
    let group = components.get(id);
    if (!group) {
      const seen = new Set([id]); group = [id];
      for (let i = 0; i < group.length; i++) for (const other of edges.get(group[i]) ?? []) if (!seen.has(other)) { seen.add(other); group.push(other); }
      for (const member of group) components.set(member, group);
    }
    for (const member of Object.keys(content).length || Object.keys(layout).length ? group : []) {
      result[member] = { ...result[member], ...content, ...layout };
      if (Object.keys(layout).length) {
        const boards = { ...byId.get(member)?.boards, ...result[member].boards };
        for (const [key, placement] of Object.entries(boards)) if (placement) boards[key] = { ...placement, ...layout };
        if (Object.keys(boards).length) result[member].boards = boards;
      }
    }
    // A whole-group translation belongs to this pinboard. Only internal moves reach other groups,
    // as a delta in their own coordinate system; standalone copies never share their position.
    const sourceGroup = groupAt(id, patch), shift = delta(id);
    const movingWholeGroup = sourceGroup.length > 1 && sourceGroup.every(other => {
      const movement = delta(other); return Math.abs(movement.x - shift.x) < .01 && Math.abs(movement.y - shift.y) < .01;
    });
    const enabling = patch.copySync === true && !original.get(id)?.copySync;
    if (sourceGroup.length > 1 && !movingWholeGroup && !enabling && (shift.x || shift.y)) for (const member of group) {
      if (sourceGroup.includes(member) || groupAt(member).length < 2) continue;
      const card = original.get(member)!;
      const before = point(card);
      result[member] = { ...result[member], boardX: before.x + shift.x, y: before.y + shift.y };
      const boards = { ...card.boards, ...result[member].boards };
      for (const [key, placement] of Object.entries(boards)) if (placement) {
        const old = card.boards?.[key];
        boards[key] = { ...placement, boardX: (old?.boardX ?? card.boardX ?? before.x) + shift.x, y: (old?.y ?? card.y ?? before.y) + shift.y };
      }
      if (Object.keys(boards).length) result[member].boards = boards;
    }
  }
  return result;
}

/** Turning on takes the source's current content; turning off keeps the last shared content intact. */
export function copySyncPatches(cards: Card[], ids: string[], enabled: boolean, width = 640, board?: string): Patches {
  const byId = new Map(cards.map(card => [card.id, card])), result: Patches = {};
  for (const id of ids) {
    const card = byId.get(id), source = card?.copyOf ? byId.get(card.copyOf) : undefined;
    if (!source) continue;
    const layout = copyLayout(cards, [source.id], width)[source.id];
    result[id] = enabled ? { copySync: true, title: source.title, text: source.text, paper: source.paper ?? 'yellow', tag: source.tag ?? null, url: source.url ?? '', pixel: source.pixel ?? false, groupName: source.groupName ?? '',
      w: layout.w, h: layout.h ?? 0 } : { copySync: false };
  }
  if (enabled) for (const group of cardGroups(cards)) {
    const selected = group.filter(id => result[id] && byId.get(id)?.copyOf);
    if (selected.length < 2) continue;
    const layouts = Object.fromEntries([...selected, ...selected.map(id => byId.get(id)!.copyOf!)].map(id => [id, copyLayout(cards, [id], width)[id]]));
    if (board) for (const item of layoutBoard(cards, board, width)) if (selected.includes(item.card.id)) layouts[item.card.id] = { boardX: item.x, y: item.y };
    const anchor = selected[0], sourceAnchor = byId.get(anchor)!.copyOf!;
    for (const id of selected) {
      const source = byId.get(id)!.copyOf!;
      const position = { boardX: (layouts[anchor].boardX ?? 0) + (layouts[source].boardX ?? 0) - (layouts[sourceAnchor].boardX ?? 0), y: (layouts[anchor].y ?? 0) + (layouts[source].y ?? 0) - (layouts[sourceAnchor].y ?? 0) };
      const own = byId.get(id)!;
      const target = board && isOnBoard(own, board) ? board : own.dates[0] ?? Object.keys(own.boards ?? {}).find(key => own.boards?.[key]);
      if (target?.startsWith('month:') || target?.startsWith('year:')) result[id].boards = { ...own.boards, [target]: { ...own.boards?.[target], ...position } };
      else Object.assign(result[id], position);
    }
  }
  return result;
}
