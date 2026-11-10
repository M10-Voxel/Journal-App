import { useSyncExternalStore } from 'react';
import { t } from './i18n.ts';
import { mailTagDefinitions } from './mailTags.ts';
import type { Tag } from './tags.ts';

/**
 * Tags come from three places: your own, the checklist's activities (each has a tag for its calendar time) and the mail
 * import (Lieferung, Bezahlung, Termine). Lists show them apart from each other, kinds in the order chosen in the settings (own, checklist, mail at first);
 * the tags themselves are sorted only within their kind.
 */
export type TagKind = 'own' | 'activity' | 'mail';
export const tagKinds: readonly TagKind[] = ['own', 'activity', 'mail'];

// The order of the kinds is the user's: the settings move a kind up or down (stored on the device, like the other view
// choices) and every list follows it. `kindOrder()` is the order now; `useTagKindOrder` re-renders when it changes.
const orderKey = 'journal.tagKindOrder';
const orderListeners = new Set<() => void>();
/** A stored order made whole: known kinds once each, in the stored order, then the kinds it lacks in the default order. */
export function normalizeKindOrder(value: unknown): readonly TagKind[] {
  const stored = Array.isArray(value) ? value.filter((kind, index, all): kind is TagKind => tagKinds.includes(kind) && all.indexOf(kind) === index) : [];
  return [...stored, ...tagKinds.filter(kind => !stored.includes(kind))];
}
const readOrder = (): readonly TagKind[] => {
  try { return normalizeKindOrder(JSON.parse(globalThis.localStorage?.getItem(orderKey) ?? 'null')); } catch { return tagKinds; }
};
let order = readOrder();
const sameOrder = (a: readonly TagKind[], b: readonly TagKind[]) => a.every((kind, index) => kind === b[index]);
function changeOrder(next: readonly TagKind[]) {
  if (sameOrder(order, next)) return;
  order = next;
  for (const listener of [...orderListeners]) listener();
}
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === orderKey) changeOrder(readOrder()); });
export const kindOrder = (): readonly TagKind[] => order;
/** Moves a kind one place up or down among the kinds; returns whether it moved. */
export function moveKind(kind: TagKind, step: -1 | 1): boolean {
  const next = [...order], at = next.indexOf(kind), to = at + step;
  if (at < 0 || to < 0 || to >= next.length) return false;
  [next[at], next[to]] = [next[to], next[at]];
  try { globalThis.localStorage?.setItem(orderKey, JSON.stringify(next)); } catch { /* kept for this session */ }
  changeOrder(next);
  return true;
}
export const resetKindOrder = () => { try { globalThis.localStorage?.removeItem(orderKey); } catch { /* ignore */ } changeOrder(tagKinds); };
export function useTagKindOrder(): readonly TagKind[] {
  return useSyncExternalStore(listener => { orderListeners.add(listener); return () => { orderListeners.delete(listener); }; }, kindOrder, kindOrder);
}
export const tagKindLabel = (kind: TagKind) => ({ own: t('Eigene'), activity: t('Checkliste'), mail: t('E-Mail') })[kind];
const mailIds = new Set(Object.values(mailTagDefinitions).map(definition => definition.id));
export const kindOfTag = (id: string, activityIds: ReadonlySet<string>): TagKind => mailIds.has(id) ? 'mail' : activityIds.has(id) ? 'activity' : 'own';

/** The tags by kind in the chosen order of the kinds, each kind in the tags' stored order; kinds without tags are left out. */
export function groupTags(tags: readonly Tag[], activityIds: ReadonlySet<string>): { kind: TagKind; tags: Tag[] }[] {
  return kindOrder().map(kind => ({ kind, tags: tags.filter(tag => kindOfTag(tag.id, activityIds) === kind) })).filter(group => group.tags.length);
}
/** The whole list in display order (own, checklist, mail): numbers 1–9 in pickers and filters follow it. */
export const orderedTags = (tags: readonly Tag[], activityIds: ReadonlySet<string>) => groupTags(tags, activityIds).flatMap(group => group.tags);
/** Moving a tag one place up or down among the tags of its kind; the stored list keeps the kinds together. */
export function moveWithinKind(tags: readonly Tag[], id: string, step: -1 | 1, activityIds: ReadonlySet<string>): Tag[] {
  const groups = groupTags(tags, activityIds);
  const group = groups.find(item => item.tags.some(tag => tag.id === id));
  if (!group) return [...tags];
  const list = [...group.tags], at = list.findIndex(tag => tag.id === id), to = at + step;
  if (to < 0 || to >= list.length) return groups.flatMap(item => item.tags);
  [list[at], list[to]] = [list[to], list[at]];
  return groups.flatMap(item => item === group ? list : item.tags);
}
