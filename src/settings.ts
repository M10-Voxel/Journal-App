import type { ActionLayout } from './components/EntryActionDock';

// Device-local preferences. They describe how this window looks, not the journal, so they live in localStorage
// instead of the database.
export interface Settings { actionLayout: ActionLayout }
const key = 'journal.settings';
export const defaultSettings: Settings = { actionLayout: 'orbit' };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>;
    return { actionLayout: stored.actionLayout === 'bar' || stored.actionLayout === 'palette' || stored.actionLayout === 'inline' || stored.actionLayout === 'swipe' ? stored.actionLayout : defaultSettings.actionLayout };
  } catch { return defaultSettings; }
}
export function saveSettings(settings: Settings) {
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* storage unavailable: keep it for this session */ }
}
