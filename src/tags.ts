/** A tag like "Arbeit", "Privat" or "Uni": entries carry one, are coloured by it and grouped under it (see storage.rs). */
import type { CalendarDay } from './journal';

/** `icon`: a Lucide name (see entryIcons.ts); shown in place of the name at the entries. */
export interface Tag { id: string; name: string; color: string; icon?: string | null }

/** Colours offered for new tags, in turn: apart from each other and readable on the dark surfaces of every theme. */
export const tagSwatches = ['#569eff', '#76d982', '#e6a85c', '#c69bff', '#ff7a90', '#4fd1c5', '#e2d36b', '#ff9f5a', '#8fa3ff', '#a8a8a8'] as const;
export const nextTagColor = (tags: readonly Tag[]): string => tagSwatches.find(color => !tags.some(tag => tag.color === color)) ?? tagSwatches[tags.length % tagSwatches.length];
export const maxTagName = 40;

// The order of the tags as they are listed; entries are grouped in it. Set by the tag store whenever the list changes.
let rank = new Map<string, number>();
export function setTagOrder(tags: readonly Tag[]) { rank = new Map(tags.map((tag, index) => [tag.id, index])); }
/** Untagged entries come first, then the tags in their order. A tag not (or no longer) known counts as none. */
export const tagRank = (id: string | null | undefined): number => id && rank.has(id) ? rank.get(id)! + 1 : 0;
export const tagOf = (tags: readonly Tag[], id: string | null | undefined): Tag | null => id ? tags.find(tag => tag.id === id) ?? null : null;

/** Hidden tags are kept per view; this key stands for the entries without a tag. */
export const untagged = '-';
export const filterKey = (id: string | null | undefined) => id && rank.has(id) ? id : untagged;
export const isShown = (hidden: ReadonlySet<string>, id: string | null | undefined) => !hidden.has(filterKey(id));

/** Keep hidden entries out of summaries, tooltips and compact-month markers as well as calendar blocks. */
export function filterTagDays(days: Map<string, CalendarDay>, hidden: ReadonlySet<string>): Map<string, CalendarDay> {
  return new Map([...days].map(([date, day]) => [date, { ...day, entries: day.entries.filter(entry => isShown(hidden, entry.tag)) }]));
}

/** "Arbeit" from "arb" (start first, then anywhere), and whether a typed name is a new one. */
export function matchTags(tags: readonly Tag[], query: string): { matches: Tag[]; exact: Tag | null } {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return { matches: [...tags], exact: null };
  const starts = tags.filter(tag => tag.name.toLowerCase().startsWith(wanted));
  const inside = tags.filter(tag => !starts.includes(tag) && tag.name.toLowerCase().includes(wanted));
  return { matches: [...starts, ...inside], exact: tags.find(tag => tag.name.toLowerCase() === wanted) ?? null };
}
