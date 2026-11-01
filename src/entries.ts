import type { Day, Entry, EntryKind } from './journal';
import { tagRank } from './tags.ts';

/** Merge an import into a daily note while keeping local typing and deletions made during its IPC request. */
export function mergeCalendarImport(current: Day, before: Day | undefined, refreshed: Day): Day {
  const originals = new Map(before?.entries.map(entry => [entry.id, entry]) ?? []);
  const incoming = new Map(refreshed.entries.map(entry => [entry.id, entry]));
  const kept: Entry[] = [];
  for (const entry of current.entries) {
    const original = originals.get(entry.id), next = incoming.get(entry.id);
    incoming.delete(entry.id);
    if (!original) { kept.push(entry); continue; }
    const edits = Object.fromEntries(Object.entries(entry).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(original[key as keyof Entry])));
    if (Object.keys(edits).length === 0) { if (next) kept.push(next); continue; }
    kept.push({ ...(next ?? entry), ...edits });
  }
  for (const [id, entry] of incoming) if (!originals.has(id)) kept.push(entry);
  return { ...current, revision: refreshed.revision, entries: orderEntries(kept) };
}

export const entryKindOrder: readonly EntryKind[] = ['event', 'task', 'note'];

/** By kind, within a kind by tag (untagged first, then the tags in their order), within a tag priority first. */
export function orderEntries(entries: readonly Entry[]): Entry[] {
  return entryKindOrder.flatMap(kind => {
    const siblings = entries.filter(entry => entry.kind === kind);
    const ranks = [...new Set(siblings.map(entry => tagRank(entry.tag)))].sort((a, b) => a - b);
    return ranks.flatMap(rank => {
      const group = siblings.filter(entry => tagRank(entry.tag) === rank);
      return [...group.filter(entry => entry.priority), ...group.filter(entry => !entry.priority)];
    });
  });
}
/** Entries move only among their own: the same kind, tag and priority. */
export const sameGroup = (a: Entry, b: Entry) => a.kind === b.kind && a.priority === b.priority && tagRank(a.tag) === tagRank(b.tag);

export function moveEntry(entries: Entry[], sourceId: string, targetId: string, placement: 'before' | 'after'): Entry[] {
  const source = entries.find(entry => entry.id === sourceId);
  const target = entries.find(entry => entry.id === targetId);
  if (!source || !target || sourceId === targetId || !sameGroup(source, target)) return entries;
  const next = orderEntries(entries).filter(entry => entry.id !== sourceId);
  const targetIndex = next.findIndex(entry => entry.id === targetId);
  next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, source);
  return next.every((entry, index) => entry === entries[index]) ? entries : next;
}

/** `shown`: the entries the journal lists (those hidden by a filter are stepped over). */
export function moveEntryByOffset(entries: Entry[], id: string, offset: -1 | 1, shown: (entry: Entry) => boolean = entry => entry.showInJournal !== false): Entry[] {
  const source = entries.find(entry => entry.id === id);
  if (!source) return entries;
  const siblings = entries.filter(entry => sameGroup(entry, source) && shown(entry));
  const target = siblings[siblings.indexOf(source) + offset];
  return target ? moveEntry(entries, id, target.id, offset === -1 ? 'before' : 'after') : entries;
}
