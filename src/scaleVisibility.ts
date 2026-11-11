import { useCallback, useSyncExternalStore } from 'react';

/**
 * Which lines the overviews' chart hides (on this device, like the hidden tags in tagStore.ts): `rating` for the daily
 * rating, else a day value's id. Every chart in the window follows a change at once; other windows hear of it through
 * the storage event.
 */
const hiddenKey = 'journal.hiddenScales';
function readHidden(): ReadonlySet<string> {
  try {
    const list = JSON.parse(localStorage.getItem(hiddenKey) ?? '[]') as unknown;
    return new Set(Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []);
  } catch { return new Set(); }
}
let hiddenNow: ReadonlySet<string> | null = null;
const listeners = new Set<() => void>();
const current = () => hiddenNow ??= readHidden();
if (typeof window !== 'undefined') window.addEventListener('storage', event => {
  if (event.key !== hiddenKey && event.key !== null) return;
  hiddenNow = readHidden();
  for (const listener of [...listeners]) listener();
});
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setHiddenScales(next: ReadonlySet<string>) {
  hiddenNow = new Set(next);
  try { localStorage.setItem(hiddenKey, JSON.stringify([...next])); } catch { /* storage unavailable: keep it for this session */ }
  for (const listener of [...listeners]) listener();
}
export function useHiddenScales(): [ReadonlySet<string>, (next: ReadonlySet<string>) => void] {
  const hidden = useSyncExternalStore(subscribe, current, current);
  return [hidden, useCallback((next: ReadonlySet<string>) => setHiddenScales(next), [])];
}
