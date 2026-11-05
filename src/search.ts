// The search over everything written by hand: entries (tasks, events, notes, calendar entries), day titles, the board's
// cards and the notebook. A query is words to find plus filters: `@Typ` (also `@Pinnwand/Zettel`) and `\Tag`.
// Suggestions complete the filter being typed, like the repeat field does (see repeatText.ts).
import type { Tag } from './tags.ts';

export type SearchType = 'task' | 'event' | 'note' | 'calendar' | 'title' | 'board' | 'board-note' | 'board-image' | 'board-link' | 'notebook';
export interface TypeFilter { type: SearchType; de: string; en: string; descriptionDe: string; descriptionEn: string }
/** The `@` filters, in the order suggestions list them; `@Pinnwand` takes all of the board's kinds. */
export const typeFilters: TypeFilter[] = [
  { type: 'task', de: 'Aufgabe', en: 'Task', descriptionDe: 'Aufgaben der Tage', descriptionEn: 'Tasks of the days' },
  { type: 'event', de: 'Ereignis', en: 'Event', descriptionDe: 'Ereignisse der Tage', descriptionEn: 'Events of the days' },
  { type: 'note', de: 'Notiz', en: 'Note', descriptionDe: 'Notizen der Tage', descriptionEn: 'Notes of the days' },
  { type: 'calendar', de: 'Kalender', en: 'Calendar', descriptionDe: 'Nur im Kalender', descriptionEn: 'Calendar only' },
  { type: 'title', de: 'Titel', en: 'Title', descriptionDe: 'Titel der Tage', descriptionEn: 'Day titles' },
  { type: 'board', de: 'Pinnwand', en: 'Board', descriptionDe: 'Alles auf der Pinnwand', descriptionEn: 'Everything on the board' },
  { type: 'board-note', de: 'Pinnwand/Zettel', en: 'Board/Note', descriptionDe: 'Zettel der Pinnwand', descriptionEn: 'Notes on the board' },
  { type: 'board-image', de: 'Pinnwand/Bild', en: 'Board/Image', descriptionDe: 'Bilder der Pinnwand', descriptionEn: 'Images on the board' },
  { type: 'board-link', de: 'Pinnwand/Link', en: 'Board/Link', descriptionDe: 'Links der Pinnwand', descriptionEn: 'Links on the board' },
  { type: 'notebook', de: 'Notizblock', en: 'Notebook', descriptionDe: 'Zettel im Notizblock', descriptionEn: 'Notes in the notebook' },
];

const fold = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** A tag as a filter word: spaces become underscores (`\Neues_Projekt`). */
export const tagWord = (name: string) => name.trim().replace(/\s+/g, '_');

export interface ParsedQuery {
  words: string[];
  /** The words as typed (for the store's search, which compares them itself). */
  rawWords: string[];
  types: SearchType[];
  tags: string[];
  /** The filter at the cursor that is still being typed. */
  partial: { kind: 'type' | 'tag'; word: string; from: number; to: number } | null;
}
export function parseQuery(query: string, cursor = query.length, tags: readonly Tag[] = []): ParsedQuery {
  const words: string[] = [], rawWords: string[] = [], types: SearchType[] = [], tagIds: string[] = [];
  let partial: ParsedQuery['partial'] = null;
  for (const match of query.matchAll(/\S+/g)) {
    const token = match[0], from = match.index!, to = from + token.length;
    const atCursor = cursor >= from && cursor <= to;
    if (token.startsWith('@')) {
      const name = fold(token.slice(1));
      const known = typeFilters.find(filter => fold(filter.de) === name || fold(filter.en) === name);
      if (known) types.push(known.type);
      if (atCursor && !known) partial = { kind: 'type', word: token.slice(1), from, to };
      else if (atCursor && known && cursor === to) partial = { kind: 'type', word: token.slice(1), from, to };
    } else if (token.startsWith('\\')) {
      const name = fold(token.slice(1).replace(/_/g, ' '));
      const known = tags.find(tag => fold(tag.name) === name);
      if (known) tagIds.push(known.id);
      if (atCursor && (!known || cursor === to)) partial = { kind: 'tag', word: token.slice(1), from, to };
    } else { words.push(fold(token)); rawWords.push(token); }
  }
  return { words, rawWords, types, tags: tagIds, partial };
}

export interface Suggestion { insert: string; label: string; description: string; matches: number[]; color?: string; id?: string }
/** What the filter being typed may become: types for `@`, tags for `\`; the start of a name first, then anywhere. */
export function searchSuggestions(parsed: ParsedQuery, tags: readonly Tag[], english = false, limit = 7): Suggestion[] {
  const partial = parsed.partial;
  if (!partial) return [];
  const wanted = fold(partial.word.replace(/_/g, ' '));
  const marks = (label: string) => {
    const folded = fold(label), at = folded.indexOf(wanted);
    return at >= 0 ? Array.from({ length: wanted.length }, (_, index) => at + index) : [];
  };
  const rank = (label: string) => { const folded = fold(label); return folded.startsWith(wanted) ? 0 : folded.includes(wanted) ? 1 : -1; };
  if (partial.kind === 'type') return typeFilters
    .map(filter => ({ filter, label: english ? filter.en : filter.de }))
    .filter(({ label }) => rank(label) >= 0)
    .sort((a, b) => rank(a.label) - rank(b.label))
    .slice(0, limit)
    .map(({ filter, label }) => ({ insert: `@${label}`, label, description: english ? filter.descriptionEn : filter.descriptionDe, matches: marks(label) }));
  return tags.filter(tag => rank(tag.name) >= 0)
    .sort((a, b) => rank(a.name) - rank(b.name))
    .slice(0, limit)
    .map(tag => ({ insert: `\\${tagWord(tag.name)}`, label: tag.name, description: english ? 'Tag' : 'Tag', matches: marks(tag.name), color: tag.color, id: tag.id }));
}
/** The query with the filter at the cursor replaced by a suggestion (and a space after it). */
export function acceptSuggestion(query: string, parsed: ParsedQuery, suggestion: Suggestion): { query: string; cursor: number } {
  const partial = parsed.partial;
  if (!partial) return { query, cursor: query.length };
  const before = query.slice(0, partial.from), after = query.slice(partial.to).replace(/^\s*/, '');
  const next = `${before}${suggestion.insert} ${after}`;
  return { query: next, cursor: before.length + suggestion.insert.length + 1 };
}

/** One thing found, and where it was made (what opening it shows). */
export interface SearchResult {
  key: string; type: SearchType; title: string; snippet: string; date: string | null; tag: string | null;
  target: { kind: 'entry'; date: string; id: string; calendar: boolean } | { kind: 'title'; date: string } | { kind: 'card'; id: string; date: string | null; notebook: boolean };
}
/** The candidates any source supplies, before filtering. */
export type SearchItem = SearchResult;

/** Whether `item` fits the filters: any of the chosen types (`@Pinnwand` covers its kinds), all chosen tags (one per item). */
export function fits(item: SearchItem, parsed: ParsedQuery): boolean {
  if (parsed.types.length) {
    const board = item.type.startsWith('board-');
    if (!parsed.types.some(type => type === item.type || (type === 'board' && board))) return false;
  }
  if (parsed.tags.length && !(item.tag && parsed.tags.includes(item.tag))) return false;
  const haystack = fold(`${item.title} ${item.snippet}`);
  return parsed.words.every(word => haystack.includes(word));
}
/** Where the words are in `text`, for marking them. */
export function highlights(text: string, words: readonly string[]): [number, number][] {
  const folded = fold(text), ranges: [number, number][] = [];
  for (const word of words) {
    if (!word) continue;
    for (let at = folded.indexOf(word); at >= 0; at = folded.indexOf(word, at + word.length)) ranges.push([at, at + word.length]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return ranges.reduce<[number, number][]>((merged, range) => { const last = merged.at(-1); if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]); else merged.push(range); return merged; }, []);
}
/** A short piece of `text` around its first found word. */
export function excerpt(text: string, words: readonly string[], length = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= length) return flat;
  const first = highlights(flat, words)[0]?.[0] ?? 0;
  const start = Math.max(0, Math.min(first - 24, flat.length - length));
  return `${start ? '…' : ''}${flat.slice(start, start + length).trim()}${start + length < flat.length ? '…' : ''}`;
}
/** Filtered and ordered: newest day first, then the kinds in a fixed order. */
export function runSearch(items: readonly SearchItem[], parsed: ParsedQuery, limit = 60): SearchResult[] {
  if (!parsed.words.length && !parsed.types.length && !parsed.tags.length) return [];
  return items.filter(item => fits(item, parsed))
    .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || a.title.localeCompare(b.title))
    .slice(0, limit);
}
