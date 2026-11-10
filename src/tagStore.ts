import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { setTagOrder } from './tags';
import type { Tag } from './tags';

// The tags live in the store (storage.rs) and are the same in every window: each loads them once and hears every
// change (`journal:tags`, sent when they are saved anywhere).
let tags: Tag[] = [];
let loading: Promise<void> | null = null;
let listening = false;
let version = 0;
let writing: Promise<void> = Promise.resolve();
const listeners = new Set<() => void>();
function set(next: Tag[]) {
  tags = next;
  version++;
  setTagOrder(next);
  for (const listener of [...listeners]) listener();
}
function ensure() {
  if (loading) return loading;
  const before = version;
  loading = invoke<Tag[]>('load_tags').then(list => { if (version === before) set(list ?? []); }, error => { loading = null; throw error; });
  if (!listening) {
    listening = true;
    void listen<Tag[]>('journal:tags', event => set(event.payload)).catch(() => { listening = false; });
    void listen('history:restored', () => { loading = null; void ensure().catch(() => {}); });
  }
  return loading;
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function useTags(): Tag[] {
  useEffect(() => { void ensure().catch(() => {}); }, []);
  return useSyncExternalStore(subscribe, () => tags);
}
export const currentTags = () => tags;
/** Resolves once the tags are loaded. */
export const loadTags = () => ensure();
export function saveTags(next: Tag[] | ((current: Tag[]) => Tag[])): Promise<Tag[]> {
  // Evaluate edits against the result of the preceding write. A slow colour write must not
  // overwrite a name change or a tag created while that write was still in flight.
  const save = writing.then(async () => {
    await ensure();
    const saved = await invoke<Tag[]>('save_tags', { tags: typeof next === 'function' ? next(tags) : next });
    set(saved);
    return saved;
  });
  writing = save.then(() => {}, () => {});
  return save;
}
/** A new tag at the end of the list; resolves to it (as stored). */
export async function createTag(name: string, color: string): Promise<Tag> {
  const tag = { id: crypto.randomUUID(), name: name.trim(), color };
  const saved = await saveTags(current => [...current, tag]);
  return saved.find(item => item.id === tag.id) ?? tag;
}

/** Opens the tags in the settings; only the journal window has them (it registers itself). */
let openManager: (() => void) | null = null;
export const manageTags = Object.assign(() => openManager?.(), {
  available: () => openManager !== null,
  register(open: () => void) { openManager = open; return () => { if (openManager === open) openManager = null; }; },
});

/** Which tags a view hides: the journal and the calendar each keep their own choice (on this device). */
export type TagScope = 'journal' | 'calendar';
const hiddenKey = 'journal.hiddenTags';
function readHidden(scope: TagScope): Set<string> {
  try {
    const stored = JSON.parse(localStorage.getItem(hiddenKey) ?? '{}') as Partial<Record<TagScope, unknown>>;
    const list = stored[scope];
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
  } catch { return new Set(); }
}
// One choice per scope for the whole window: every view using it (the journal's entries, its board and notebook) follows
// a change at once; other windows hear of it through the storage event.
const hiddenNow: Partial<Record<TagScope, ReadonlySet<string>>> = {};
const hiddenListeners = new Set<() => void>();
const hiddenOf = (scope: TagScope) => hiddenNow[scope] ??= readHidden(scope);
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== hiddenKey && event.key !== null) return;
  for (const scope of Object.keys(hiddenNow) as TagScope[]) hiddenNow[scope] = readHidden(scope);
  for (const listener of [...hiddenListeners]) listener();
});
const subscribeHidden = (listener: () => void) => { hiddenListeners.add(listener); return () => { hiddenListeners.delete(listener); }; };
export function setHiddenTags(scope: TagScope, next: ReadonlySet<string>) {
  hiddenNow[scope] = new Set(next);
  try {
    const stored = JSON.parse(localStorage.getItem(hiddenKey) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(hiddenKey, JSON.stringify({ ...stored, [scope]: [...next] }));
  } catch { /* storage unavailable: keep it for this session */ }
  for (const listener of [...hiddenListeners]) listener();
}
export function useHiddenTags(scope: TagScope): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const hidden = useSyncExternalStore(subscribeHidden, () => hiddenOf(scope), () => hiddenOf(scope));
  const change = useCallback((next: ReadonlySet<string>) => setHiddenTags(scope, next), [scope]);
  return [hidden, change];
}
