import { t } from './i18n.ts';
import { mailTagDefinitions } from './mailTags.ts';
import type { Tag } from './tags.ts';

/**
 * Tags come from three places: your own, the checklist's activities (each has a tag for its calendar time) and the mail
 * import (Lieferung, Bezahlung, Termine). Lists show them in that order, apart from each other; the settings sort them
 * only within their kind.
 */
export type TagKind = 'own' | 'activity' | 'mail';
export const tagKinds: readonly TagKind[] = ['own', 'activity', 'mail'];
export const tagKindLabel = (kind: TagKind) => ({ own: t('Eigene'), activity: t('Checkliste'), mail: t('E-Mail') })[kind];
const mailIds = new Set(Object.values(mailTagDefinitions).map(definition => definition.id));
export const kindOfTag = (id: string, activityIds: ReadonlySet<string>): TagKind => mailIds.has(id) ? 'mail' : activityIds.has(id) ? 'activity' : 'own';

/** The tags by kind, each kind in the tags' stored order; kinds without tags are left out. */
export function groupTags(tags: readonly Tag[], activityIds: ReadonlySet<string>): { kind: TagKind; tags: Tag[] }[] {
  return tagKinds.map(kind => ({ kind, tags: tags.filter(tag => kindOfTag(tag.id, activityIds) === kind) })).filter(group => group.tags.length);
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
