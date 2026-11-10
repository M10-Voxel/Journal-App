// The notebook's logic without the interface (tested in tests/notebook.test.mjs): folders as a tree, and the threads
// between cards. A thread joins two cards symmetrically (each names the other in `links`): an image or a link tied to a
// note is an attachment of that note, two notes tied together are pages of each other, images and links tied to each
// other form a bundle (a bundle tied to a note by one thread hangs on that note as a whole).

export type Paper = 'yellow' | 'blue' | 'green' | 'pink';
export type CardKind = 'note' | 'image' | 'link';
export type BoardPlacement = { boardX?: number; x?: number; y?: number; z?: number; w?: number; h?: number };
export type Card = {
  id: string; kind: CardKind; title: string; text: string; dates: string[]; order: number; url?: string; image?: string; pixel?: boolean; asset?: string; size?: number;
  x?: number; y?: number; z?: number; paper?: Paper;
  /** Absolute board coordinate; older cards keep their relative x until first moved. */
  boardX?: number;
  /** Extra period boards, with a separate layout per board. Null means taken down. */
  boards?: Record<string, BoardPlacement | null>;
  /** Chosen size: width of every card, height of a note (images keep their proportions, links their content). */
  w?: number; h?: number;
  /** The folder of a note (notebook), none for notes outside every folder. */
  folder?: string | null;
  /** The cards tied to this one by a thread (symmetric: the other card names this one too). */
  links?: string[];
  /** The main note of the notes tied together: the notebook shows it as their first page. */
  primary?: boolean;
  /** The tag's ID of a note (see tags.ts); the search finds notes by it. */
  tag?: string | null;
  /** The day the card was made. */
  created?: string;
  /** Made in the notebook (not on a day's board). */
  notebook?: boolean;
  /** A notebook note shown on the day it was made. */
  onDay?: boolean;
  /** When the card was made and when its title or text last changed (ms; set by patchCard, missing on old cards). */
  createdAt?: number; updatedAt?: number;
};
export type Folder = { id: string; name: string; parent: string | null; order: number };
export type Patches = Record<string, Partial<Card>>;

const byOrder = (a: { order: number; id: string }, b: { order: number; id: string }) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id);

/** Folders whose parent is gone count as top level, so nothing is ever lost from the tree. */
export function parentOf(folders: Folder[], folder: Folder): string | null {
  return folder.parent && folders.some(other => other.id === folder.parent) ? folder.parent : null;
}
/** The tree in reading order with each folder's depth and whether it is the last of its siblings (for `tree` lines). */
export function flatTree(folders: Folder[]): { folder: Folder; depth: number; last: boolean; lines: boolean[] }[] {
  const rows: { folder: Folder; depth: number; last: boolean; lines: boolean[] }[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number, lines: boolean[]) => {
    const children = folders.filter(folder => parentOf(folders, folder) === parent).sort(byOrder);
    children.forEach((folder, index) => {
      if (seen.has(folder.id)) return;
      seen.add(folder.id);
      const last = index === children.length - 1;
      rows.push({ folder, depth, last, lines });
      walk(folder.id, depth + 1, [...lines, !last]);
    });
  };
  walk(null, 0, []);
  // Folders caught in a cycle (only an old or merged state can hold one) show at the top instead of vanishing.
  for (const folder of [...folders].sort(byOrder)) {
    if (seen.has(folder.id)) continue;
    seen.add(folder.id);
    rows.push({ folder, depth: 0, last: true, lines: [] });
    walk(folder.id, 1, [false]);
  }
  return rows;
}
/** Follow only the displayed ancestry: even a cyclic state from a merge must remain navigable. */
export function visibleTree(folders: Folder[], collapsed: Set<string>): ReturnType<typeof flatTree> {
  const rows = flatTree(folders);
  return rows.filter((row, index) => {
    for (let at = index - 1, depth = row.depth; at >= 0 && depth > 0; at--) {
      if (rows[at].depth < depth) {
        if (collapsed.has(rows[at].folder.id)) return false;
        depth = rows[at].depth;
      }
    }
    return true;
  });
}
/** The folder's path from the top, e.g. ['Projekte', 'Garten']. */
export function folderPath(folders: Folder[], id: string | null | undefined): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let at = folders.find(folder => folder.id === id);
  while (at && !seen.has(at.id)) { seen.add(at.id); path.unshift(at.name); at = folders.find(folder => folder.id === at!.parent); }
  return path;
}
/** The folder and all folders inside it. */
export function folderWithin(folders: Folder[], id: string): Set<string> {
  const inside = new Set([id]);
  for (let grown = true; grown;) {
    grown = false;
    for (const folder of folders) if (folder.parent && inside.has(folder.parent) && !inside.has(folder.id)) { inside.add(folder.id); grown = true; }
  }
  return inside;
}
/** Whether a folder may move into `parent`: never into itself or one of its own subfolders. */
export function canMoveFolder(folders: Folder[], id: string, parent: string | null): boolean {
  return parent === null || !folderWithin(folders, id).has(parent);
}
/** The folders directly in `parent` (null: at the top), in their order. */
export function childFolders(folders: Folder[], parent: string | null): Folder[] {
  return folders.filter(folder => parentOf(folders, folder) === parent).sort(byOrder);
}
/** The order for a folder put last into `parent`. */
export function nextFolderOrder(folders: Folder[], parent: string | null): number {
  return Math.max(0, ...childFolders(folders, parent).map(folder => folder.order ?? 0)) + 1;
}

/** What a thread between two cards makes: an attachment (image or link to a note), another page (two notes), or a
 *  bundle (images and links among themselves). */
export function threadKind(a: Pick<Card, 'kind'>, b: Pick<Card, 'kind'>): 'attachment' | 'page' | 'bundle' {
  if (a.kind === 'note' && b.kind === 'note') return 'page';
  if (a.kind === 'note' || b.kind === 'note') return 'attachment';
  return 'bundle';
}
const linksOf = (card: Card | undefined) => card?.links ?? [];
/** The changes tying `a` and `b` together (both sides); none when they cannot be or already are. */
export function connectPatches(cards: Card[], a: string, b: string): Patches {
  const first = cards.find(card => card.id === a), second = cards.find(card => card.id === b);
  if (!first || !second || a === b) return {};
  const patches: Patches = {};
  if (!linksOf(first).includes(b)) patches[a] = { links: [...linksOf(first), b] };
  if (!linksOf(second).includes(a)) patches[b] = { links: [...linksOf(second), a] };
  return patches;
}
/** The changes cutting the thread between `a` and `b` (both sides). */
export function disconnectPatches(cards: Card[], a: string, b: string): Patches {
  const patches: Patches = {};
  for (const [self, other] of [[a, b], [b, a]]) {
    const card = cards.find(value => value.id === self);
    if (card && linksOf(card).includes(other)) patches[self] = { links: linksOf(card).filter(id => id !== other) };
  }
  return patches;
}
/** The changes leaving no thread to a card that is removed for good. */
export function removalPatches(cards: Card[], id: string): Patches {
  const patches: Patches = {};
  for (const card of cards) if (card.id !== id && linksOf(card).includes(id)) patches[card.id] = { links: linksOf(card).filter(other => other !== id) };
  return patches;
}
/** Private notebook attachments disappear with their note; shared and day-board cards remain. */
export function removalIds(cards: Card[], id: string, removing = new Set([id])): Set<string> {
  const removed = new Set([id]), note = cards.find(card => card.id === id);
  if (note?.kind === 'note') for (const card of cards) {
    if (card.kind !== 'note' && card.notebook && !card.dates.length && !Object.values(card.boards ?? {}).some(Boolean) && linksOf(note).includes(card.id) && linksOf(card).every(other => removing.has(other))) removed.add(card.id);
  }
  return removed;
}
/** Every thread once, between cards that both exist: [a, b] with a < b. */
export function threads(cards: Card[]): [string, string][] {
  const known = new Set(cards.map(card => card.id)), seen = new Set<string>(), list: [string, string][] = [];
  for (const card of cards) for (const other of linksOf(card)) {
    if (!known.has(other) || other === card.id) continue;
    const pair: [string, string] = card.id < other ? [card.id, other] : [other, card.id];
    const key = pair.join(':');
    if (!seen.has(key)) { seen.add(key); list.push(pair); }
  }
  return list;
}
/** The cards reached from `start` by threads that only pass through cards `through` lets pass (breadth first, without `start`). */
function reach(cards: Card[], start: Card, through: (card: Card) => boolean): Card[] {
  const byId = new Map(cards.map(card => [card.id, card])), seen = new Set([start.id]), found: Card[] = [], queue = [start];
  while (queue.length) {
    for (const id of linksOf(queue.shift())) {
      const card = byId.get(id);
      if (!card || seen.has(id) || !through(card)) continue;
      seen.add(id); found.push(card); queue.push(card);
    }
  }
  return found;
}
/** A note's attachments: the images and links tied to it, and every image and link tied to those (a bundle comes whole). */
export function attachmentsOf(cards: Card[], note: Card): Card[] { return reach(cards, note, card => card.kind !== 'note'); }
/** The notes tied together with this one, directly or through other notes (this one first). */
function noteGroup(cards: Card[], note: Card): Card[] { return [note, ...reach(cards, note, card => card.kind === 'note')]; }
/**
 * A note's pages: every note tied to it, directly or through other notes. The main note of them comes first, else this
 * note. One page without threads (it scrolls, nothing to turn).
 */
export function pagesOf(cards: Card[], note: Card): Card[] {
  const group = noteGroup(cards, note), main = group.find(card => card.primary);
  return main ? [main, ...group.filter(card => card !== main)] : group;
}
/** The changes making `id` the main note of its notes (and no other one there); again on the main note: none is main. */
export function primaryPatches(cards: Card[], id: string): Patches {
  const note = cards.find(card => card.id === id);
  if (note?.kind !== 'note') return {};
  const patches: Patches = {};
  for (const other of noteGroup(cards, note)) if (other !== note && other.primary) patches[other.id] = { primary: false };
  patches[id] = { primary: !note.primary };
  return patches;
}

/** Notes in a folder choice: all, those outside every folder (folders that are gone count as none), or one folder with its subfolders. */
/** The notes of a choice: all, those outside every folder, or a folder's own (its subfolders' are not shown). */
export function notesIn(cards: Card[], folders: Folder[], choice: 'all' | 'none' | string, query = ''): Card[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const known = new Set(folders.map(folder => folder.id));
  return cards.filter(card => card.kind === 'note')
    .filter(card => words.length ? true : choice === 'all' || (choice === 'none' ? !card.folder || !known.has(card.folder) : card.folder === choice))
    .filter(card => words.every(word => `${card.title} ${card.text}`.toLowerCase().includes(word)))
    .sort((a, b) => (b.order ?? 0) - (a.order ?? 0) || a.id.localeCompare(b.id));
}
export type NoteSort = 'title' | 'created' | 'updated';
export const noteSorts: readonly NoteSort[] = ['title', 'created', 'updated'];
/** When a note was made: its time, else its day (old notes), else nothing (their order decides). */
const madeAt = (card: Card) => card.createdAt ?? (card.created ? Date.parse(`${card.created}T00:00:00`) : NaN);
/**
 * Notes in the chosen order: by title (A to Z, untitled last), or newest first by when they were made or last edited.
 * Old notes without times fall back to their day and their order on the board, edits to when they were made.
 */
export function sortNotes(notes: readonly Card[], by: NoteSort): Card[] {
  const newest = (a: number, b: number) => (Number.isNaN(b) ? -Infinity : b) - (Number.isNaN(a) ? -Infinity : a);
  return [...notes].sort((a, b) => {
    if (by === 'title') {
      const x = a.title.trim(), y = b.title.trim();
      if (!x !== !y) return x ? -1 : 1;
      return x.localeCompare(y, undefined, { numeric: true, sensitivity: 'base' }) || (b.order ?? 0) - (a.order ?? 0);
    }
    const time = by === 'updated' ? (card: Card) => card.updatedAt ?? madeAt(card) : madeAt;
    return newest(time(a), time(b)) || (b.order ?? 0) - (a.order ?? 0) || a.id.localeCompare(b.id);
  });
}

/** The switch "show on the day": on puts the note on the day it was made, off takes it off every day. */
export function onDayPatch(card: Card, on: boolean, today: string): Partial<Card> {
  const day = card.created ?? card.dates[0] ?? today;
  return on ? { onDay: true, created: day, dates: card.dates.length ? card.dates : [day] } : { onDay: false, created: day, dates: [] };
}
