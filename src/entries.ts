import type { Day, Entry, EntryKind } from './journal';

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

export function orderEntries(entries: readonly Entry[]): Entry[] {
  return entryKindOrder.flatMap(kind => {
    const siblings = entries.filter(entry => entry.kind === kind);
    return [...siblings.filter(entry => entry.priority), ...siblings.filter(entry => !entry.priority)];
  });
}

export function moveEntry(entries: Entry[], sourceId: string, targetId: string, placement: 'before' | 'after'): Entry[] {
  const source = entries.find(entry => entry.id === sourceId);
  const target = entries.find(entry => entry.id === targetId);
  if (!source || !target || sourceId === targetId || source.kind !== target.kind || source.priority !== target.priority) return entries;
  const next = orderEntries(entries).filter(entry => entry.id !== sourceId);
  const targetIndex = next.findIndex(entry => entry.id === targetId);
  next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, source);
  return next.every((entry, index) => entry === entries[index]) ? entries : next;
}

export function moveEntryByOffset(entries: Entry[], id: string, offset: -1 | 1): Entry[] {
  const source = entries.find(entry => entry.id === id);
  if (!source) return entries;
  const siblings = entries.filter(entry => entry.kind === source.kind && entry.priority === source.priority && entry.showInJournal !== false);
  const target = siblings[siblings.indexOf(source) + offset];
  return target ? moveEntry(entries, id, target.id, offset === -1 ? 'before' : 'after') : entries;
}
