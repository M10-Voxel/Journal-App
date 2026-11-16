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
export function useFeatures(): Features {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, currentFeatures);
}
