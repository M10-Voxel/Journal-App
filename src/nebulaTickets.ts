import { t } from './i18n.ts';
import type { Entry } from './journal.ts';
import { mailTagDefinitions } from './mailTags.ts';
import type { MailTagKind } from './mailTags.ts';
import type { Tag } from './tags.ts';

export type TicketKind = MailTagKind | 'event';
type TicketEntry = Pick<Entry, 'kind' | 'tag' | 'showInJournal' | 'done' | 'cancelled'>;

/** Calendar-only entries also use kind=event internally. Tickets follow the visible entry type. */
export function ticketForEntry(entry: TicketEntry, tags: readonly Tag[], activityTags: ReadonlySet<string>): { tag: string; kind: TicketKind } | null {
  if (entry.done || entry.cancelled || (entry.tag && activityTags.has(entry.tag))) return null;
  const own = tags.find(tag => tag.id === entry.tag);
  for (const [kind, definition] of Object.entries(mailTagDefinitions)) {
    if (entry.tag === definition.id || (own && [definition.de, definition.en].some(name => name.toLowerCase() === own.name.trim().toLowerCase()))) {
      return { tag: own?.name ?? definition.de, kind: kind as MailTagKind };
    }
  }
  return entry.kind === 'event' && entry.showInJournal !== false
    ? { tag: own?.name ?? t('Ereignis'), kind: 'event' } : null;
}
