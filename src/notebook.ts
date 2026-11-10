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
  /** Directed note-to-note edges. Attachment links stay undirected; missing legacy directions are inferred. */
  pageLinks?: string[];
  /** Independent copy's source. Opt-in sync includes content and geometry; board membership stays local. */
  copyOf?: string;
  copySync?: boolean;
  /** Optional label of the connected group; saved on its members so splits and copies keep a useful label. */
  groupName?: string;
  /** Legacy main-note hint, used only to infer directions for old undirected connections. */
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
  if (first.kind === 'note' && second.kind === 'note' && Object.keys(patches).length) {
    patches[a] = { ...patches[a], pageLinks: [...(first.pageLinks ?? []).filter(id => id !== b), b] };
    patches[b] = { ...patches[b], pageLinks: (second.pageLinks ?? []).filter(id => id !== a) };
  }
  return patches;
}
/** The changes cutting the thread between `a` and `b` (both sides). */
export function disconnectPatches(cards: Card[], a: string, b: string): Patches {
  const patches: Patches = {};
  for (const [self, other] of [[a, b], [b, a]]) {
    const card = cards.find(value => value.id === self);
    if (card && linksOf(card).includes(other)) patches[self] = { links: linksOf(card).filter(id => id !== other), ...(card.pageLinks?.includes(other) ? { pageLinks: card.pageLinks.filter(id => id !== other) } : {}) };
  }
  return patches;
}
/** The changes leaving no thread to a card that is removed for good. */
export function removalPatches(cards: Card[], id: string): Patches {
  const patches: Patches = {};
  for (const card of cards) if (card.id !== id && linksOf(card).includes(id)) patches[card.id] = { links: linksOf(card).filter(other => other !== id), ...(card.pageLinks?.includes(id) ? { pageLinks: card.pageLinks.filter(other => other !== id) } : {}) };
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
function noteGroups(cards: Card[]): Card[][] {
  const notes = cards.filter(card => card.kind === 'note'), byId = new Map(notes.map(card => [card.id, card]));
  const edges = new Map(notes.map(card => [card.id, new Set<string>()]));
  for (const card of notes) for (const id of card.links ?? []) if (byId.has(id)) { edges.get(card.id)!.add(id); edges.get(id)!.add(card.id); }
  const seen = new Set<string>(), groups: Card[][] = [];
  for (const note of notes) if (!seen.has(note.id)) {
    const group = [note]; seen.add(note.id);
    for (let i = 0; i < group.length; i++) for (const id of edges.get(group[i].id)!) if (!seen.has(id)) { seen.add(id); group.push(byId.get(id)!); }
    groups.push(group);
  }
  return groups;
}
function noteGroup(cards: Card[], note: Card): Card[] { return noteGroups(cards).find(group => group.some(card => card.id === note.id)) ?? [note]; }
/** Directions are explicit for new edges. Legacy edges follow the former main note, then stable creation order. */
export function pageDirections(cards: Card[]): [string, string][] {
  const byId = new Map(cards.map(card => [card.id, card]));
  const depth=new Map<string,number>(),pairs=threads(cards);
  const neighbors=new Map(cards.filter(c=>c.kind==='note').map(c=>[c.id,[] as string[]]));
  for(const [a,b]of pairs)if(neighbors.has(a)&&neighbors.has(b)){neighbors.get(a)!.push(b);neighbors.get(b)!.push(a);}
  for(const group of noteGroups(cards)){
    const root=[...group].sort((a,b)=>Number(!!b.primary)-Number(!!a.primary)||byOrder(a,b))[0],queue=[root.id];depth.set(root.id,0);
    for(let i=0;i<queue.length;i++)for(const id of neighbors.get(queue[i])??[])if(!depth.has(id)){depth.set(id,depth.get(queue[i])!+1);queue.push(id);}
  }
  return pairs.flatMap(([a,b]) => {
    const first=byId.get(a)!,second=byId.get(b)!;
    if(first.kind!=='note'||second.kind!=='note')return [];
    if(first.pageLinks?.includes(b)&&!second.pageLinks?.includes(a))return [[a,b] as [string,string]];
    if(second.pageLinks?.includes(a)&&!first.pageLinks?.includes(b))return [[b,a] as [string,string]];
    const order=(depth.get(a)??0)-(depth.get(b)??0)||byOrder(first,second);
    return [order<=0?[a,b] as [string,string]:[b,a] as [string,string]];
  });
}
export function reversePagePatches(cards: Card[], a: string, b: string): Patches {
  const edge=pageDirections(cards).find(([from,to])=>from===a&&to===b||from===b&&to===a);
  if(!edge)return {};
  const [from,to]=edge,first=cards.find(card=>card.id===from)!,second=cards.find(card=>card.id===to)!;
  return {[from]:{pageLinks:(first.pageLinks??[]).filter(id=>id!==to)},[to]:{pageLinks:[...(second.pageLinks??[]).filter(id=>id!==from),from]}};
}
function orderedNotes(group:Card[],directions:[string,string][]):Card[]{
  const byId=new Map(group.map(card=>[card.id,card])),out=new Map(group.map(card=>[card.id,[] as string[]])),incoming=new Map(group.map(card=>[card.id,0]));
  for(const [from,to]of directions)if(byId.has(from)&&byId.has(to)){out.get(from)!.push(to);incoming.set(to,incoming.get(to)!+1);}
  const remaining=new Set(byId.keys()),result:Card[]=[];
  while(remaining.size){
    const available=[...remaining].filter(id=>incoming.get(id)===0);
    const next=(available.length?available:[...remaining]).map(id=>byId.get(id)!).sort(byOrder)[0];
    result.push(next);remaining.delete(next.id);for(const id of out.get(next.id)!)incoming.set(id,incoming.get(id)!-1);
  }
  return result;
}
/** Every connected notebook group appears once, owned by its first note in directed order. */
export function noteOwners(cards: Card[]): Map<string, string> {
  const owners = new Map<string, string>();
  const directions=pageDirections(cards);
  for (const group of noteGroups(cards)) {
    const main = orderedNotes(group,directions)[0];
    for (const card of group) owners.set(card.id, main.id);
  }
  return owners;
}
/** The complete notebook, in directed order and without duplicates (also for legacy edges and cycles). */
export function pagesOf(cards: Card[], note: Card): Card[] {
  return orderedNotes(noteGroup(cards,note),pageDirections(cards));
}
/** Resolve all books once for the sidebar instead of traversing every thread again for every row. */
export function notebookGroups(cards:Card[]):Card[][]{
  const directions=pageDirections(cards);
  return noteGroups(cards).map(group=>orderedNotes(group,directions));
}

/** Notes in a folder choice: all, those outside every folder (folders that are gone count as none), or one folder with its subfolders. */
/** The notes of a choice: all, those outside every folder, or a folder's own (its subfolders' are not shown). */
export function notesIn(cards: Card[], folders: Folder[], choice: 'all' | 'none' | string, query = ''): Card[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const known = new Set(folders.map(folder => folder.id));
  const owners = noteOwners(cards);
  const activeOwners=new Set(cards.filter(card=>card.kind==='note'&&(card.notebook||card.dates.length||Object.values(card.boards??{}).some(Boolean))).map(card=>owners.get(card.id)));
  const matched = words.length ? new Set(cards.filter(card => card.kind === 'note' && words.every(word => `${card.title} ${card.text}`.toLowerCase().includes(word))).map(card => owners.get(card.id))) : null;
  return cards.filter(card => card.kind === 'note' && owners.get(card.id) === card.id && activeOwners.has(card.id))
    .filter(card => words.length ? true : choice === 'all' || (choice === 'none' ? !card.folder || !known.has(card.folder) : card.folder === choice))
    .filter(card => !matched || matched.has(card.id))
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
