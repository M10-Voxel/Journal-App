import { useSyncExternalStore } from 'react';
import { loadSettings } from './settings';
import type { Features } from './features';

/**
 * The views and modules on (features.ts), for components outside the app's own state: boards and the notebook in windows
 * of their own, the pickers. Saved settings tell this window (`journal:features`, settings.ts) and the others (the
 * storage event of `journal.settings`).
 */
let current: Features | null = null;
const listeners = new Set<() => void>();
const refresh = () => { current = null; listeners.forEach(listener => listener()); };
if (typeof window !== 'undefined') {
  window.addEventListener('journal:features', refresh);
  window.addEventListener('storage', event => { if (event.key === 'journal.settings' || event.key === null) refresh(); });
}
export const currentFeatures = (): Features => current ??= loadSettings().features;
/** One subscribe function for every reader (an inline one would make React subscribe anew on each render). */
const subscribeStore = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function useFeatures(): Features {
  return useSyncExternalStore(subscribeStore, currentFeatures);
}
