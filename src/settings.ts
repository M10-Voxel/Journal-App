import type { ActionLayout } from './components/EntryActionDock';
import { emit } from '@tauri-apps/api/event';

// Device-local preferences. They describe how this window looks, not the journal, so they live in localStorage
// instead of the database.
export type Theme = 'classic' | 'pixel';
export interface Settings { actionLayout: ActionLayout; theme: Theme }
const key = 'journal.settings';
export const defaultSettings: Settings = { actionLayout: 'orbit', theme: 'classic' };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>;
    return { actionLayout: stored.actionLayout === 'inline' || stored.actionLayout === 'swipe' ? stored.actionLayout : defaultSettings.actionLayout, theme: stored.theme === 'pixel' ? 'pixel' : 'classic' };
  } catch { return defaultSettings; }
}
export function saveSettings(settings: Settings) {
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* storage unavailable: keep it for this session */ }
  applyTheme(settings.theme);
  void emit('journal:theme', settings.theme).catch(() => {});
}

export function applyTheme(theme: Theme) { document.documentElement.dataset.theme = theme === 'pixel' ? 'pixel' : 'classic'; }
