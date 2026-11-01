import type { ActionLayout } from './components/EntryActionDock';
import { emit } from '@tauri-apps/api/event';
import { setLanguage } from './i18n';
import type { Language } from './i18n';
import { applyColors, defaultColorSettings, normalizeColorSettings } from './colors';
import type { ColorSettings } from './colors';

// Device-local UI preferences live in localStorage. ThemeSync also mirrors language
// to native preferences so the tray and reminders use it before a webview opens.
export type Theme = 'classic' | 'pixel';
export interface Settings extends ColorSettings { actionLayout: ActionLayout; theme: Theme; language: Language }
const key = 'journal.settings';
export const defaultSettings: Settings = { actionLayout: 'orbit', theme: 'classic', language: 'de', ...defaultColorSettings };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings>;
    return { actionLayout: stored.actionLayout === 'inline' || stored.actionLayout === 'swipe' ? stored.actionLayout : defaultSettings.actionLayout, theme: stored.theme === 'pixel' ? 'pixel' : 'classic', language: stored.language === 'en' ? 'en' : 'de', ...normalizeColorSettings(stored) };
  } catch { return defaultSettings; }
}
export function saveSettings(settings: Settings) {
  settings = { ...settings, ...normalizeColorSettings(settings) };
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* storage unavailable: keep it for this session */ }
  applyTheme(settings.theme);
  applyColors(settings);
  setLanguage(settings.language);
  void emit('journal:theme', settings.theme).catch(() => {});
  void emit('journal:language', settings.language).catch(() => {});
  void emit('journal:colors', { colorTheme: settings.colorTheme, customColors: settings.customColors }).catch(() => {});
}

export function applyTheme(theme: Theme) { document.documentElement.dataset.theme = theme === 'pixel' ? 'pixel' : 'classic'; }
