import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { applyTheme, loadSettings } from '../settings';
import type { Theme } from '../settings';

/** Share the device's appearance across journal, calendar and reminder windows. */
export function ThemeSync() {
  useEffect(() => {
    const stop = listen<Theme>('journal:theme', event => applyTheme(event.payload));
    const reload = (event: StorageEvent) => { if (event.key === 'journal.settings') applyTheme(loadSettings().theme); };
    window.addEventListener('storage', reload);
    return () => { window.removeEventListener('storage', reload); void stop.then(unlisten => unlisten()); };
  }, []);
  return null;
}
