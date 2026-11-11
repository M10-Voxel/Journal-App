import type { Day, Entry } from './journal.ts';
import { moveEntry, orderEntries } from './entries.ts';

export type EntryPatch = Partial<Omit<Entry, 'id' | 'origin' | 'calendarUid'>>;
/** Field operations, never a stale replacement of an entire daily note. */
export type DayOperation =
  | { kind: 'title'; before: string; value: string }
  | { kind: 'change'; id: string; before: EntryPatch; patch: EntryPatch }
  | { kind: 'create'; entry: Entry; after?: string }
  | { kind: 'remove'; id: string; before: Entry }
  | { kind: 'move'; id: string; target: string; placement: 'before' | 'after' };

export class EditConflict extends Error {
  constructor() { super('Dieser Text wurde inzwischen in einem anderen Fenster geändert. Dein Entwurf bleibt erhalten.'); }
}
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
export function changeOperation(entry: Entry, patch: EntryPatch): DayOperation {
  const before = Object.fromEntries(Object.keys(patch).map(key => [key, entry[key as keyof Entry]])) as EntryPatch;
  return { kind: 'change', id: entry.id, before, patch };
}

/** Optimistic replay is only for rendering; the authoritative writer always checks the preceding field values. */
export function applyDayOperation(day: Day, operation: DayOperation, optimistic = false): Day {
  switch (operation.kind) {
    case 'title':
      if (!optimistic && day.title !== operation.before && day.title !== operation.value) throw new EditConflict();
      return day.title === operation.value ? day : { ...day, title: operation.value };
    case 'create': {
      if (day.entries.some(entry => entry.id === operation.entry.id)) return day;
      const entries = [...day.entries], at = entries.findIndex(entry => entry.id === operation.after);
      entries.splice(at < 0 ? entries.length : at + 1, 0, operation.entry);
      return { ...day, entries: orderEntries(entries) };
    }
    case 'change': {
      const entry = day.entries.find(entry => entry.id === operation.id);
      if (!entry) { if (optimistic) return day; throw new EditConflict(); }
      if (!optimistic && Object.keys(operation.patch).some(key => !same(entry[key as keyof Entry], operation.before[key as keyof EntryPatch]) && !same(entry[key as keyof Entry], operation.patch[key as keyof EntryPatch]))) throw new EditConflict();
      const entries = day.entries.map(entry => entry.id === operation.id ? { ...entry, ...operation.patch } : entry);
      return { ...day, entries: orderEntries(entries) };
    }
    case 'remove': {
      const entry = day.entries.find(entry => entry.id === operation.id);
      if (!entry) return day;
      if (!optimistic && !same(entry, operation.before)) throw new EditConflict();
      return { ...day, entries: day.entries.filter(entry => entry.id !== operation.id) };
    }
    case 'move':
      return { ...day, entries: moveEntry(day.entries, operation.id, operation.target, operation.placement) };
  }
}
