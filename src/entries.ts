import type { Entry, EntryKind } from './journal';

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
  const siblings = entries.filter(entry => entry.kind === source.kind && entry.priority === source.priority);
  const target = siblings[siblings.indexOf(source) + offset];
  return target ? moveEntry(entries, id, target.id, offset === -1 ? 'before' : 'after') : entries;
}
