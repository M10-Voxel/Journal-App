import type { ActionLayout } from './components/EntryActionDock';
import { emit } from '@tauri-apps/api/event';
import { setLanguage } from './i18n';
import type { Language } from './i18n';
import { applyColors, colorThemeIds, defaultColorSettings, journalColorThemes, normalizeColorSettings } from './colors';
import type { ColorSettings, ColorTheme } from './colors';
import { applyScale, isUiScale } from './uiScale';
import type { UiScale } from './uiScale';

// Device-local UI preferences live in localStorage. ThemeSync also mirrors language
// to native preferences so the tray and reminders use it before a webview opens.
/** The base design: the normal app or the journal (a book). The pixel look (`pixel`) can be laid over either. */
export type Theme = 'classic' | 'journal';
export const themes: readonly Theme[] = ['classic', 'journal'];
const isTheme = (value: unknown): value is Theme => themes.includes(value as Theme);
/** In the journal style: one page at a time, or both at once (`spread`, the board then lies over both pages). */
export type BookPaging = 'page' | 'spread';
/**
 * `previousColorTheme`: the palette chosen before switching to the journal style, restored when leaving it.
 */
export interface Settings extends ColorSettings { actionLayout: ActionLayout; theme: Theme; pixel: boolean; language: Language; uiScale: UiScale; bookPaging: BookPaging; previousColorTheme?: ColorTheme }
const key = 'journal.settings';
export const defaultSettings: Settings = { actionLayout: 'orbit', theme: 'classic', pixel: false, language: 'de', uiScale: 'auto', bookPaging: 'page', ...defaultColorSettings };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Omit<Settings, 'theme'>> & { theme?: string };
    // The pixel style used to be a theme of its own; it is the normal design with the pixel look now.
    return { actionLayout: stored.actionLayout === 'inline' || stored.actionLayout === 'swipe' ? stored.actionLayout : defaultSettings.actionLayout, theme: isTheme(stored.theme) ? stored.theme : 'classic',
      pixel: stored.pixel === true || stored.theme === 'pixel', language: stored.language === 'en' ? 'en' : 'de', uiScale: isUiScale(stored.uiScale) ? stored.uiScale : 'auto', ...normalizeColorSettings(stored),
      bookPaging: stored.bookPaging === 'spread' ? 'spread' : 'page',
      ...colorThemeIds.includes(stored.previousColorTheme as ColorTheme) ? { previousColorTheme: stored.previousColorTheme } : {} };
  } catch { return defaultSettings; }
}
export function saveSettings(settings: Settings) {
  settings = { ...settings, ...normalizeColorSettings(settings) };
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* storage unavailable: keep it for this session */ }
  applyTheme(settings);
  void applyScale(settings.uiScale, settings.pixel);
  applyColors(settings);
  setLanguage(settings.language);
  void emit('journal:theme', { theme: settings.theme, pixel: settings.pixel }).catch(() => {});
  void emit('journal:scale', { scale: settings.uiScale, pixel: settings.pixel }).catch(() => {});
  void emit('journal:language', settings.language).catch(() => {});
  void emit('journal:colors', { colorTheme: settings.colorTheme, customColors: settings.customColors }).catch(() => {});
}

/** The design on the page: `data-theme` is the base design, `data-pixel` the pixel look over it. */
export function applyTheme({ theme, pixel }: Pick<Settings, 'theme' | 'pixel'>) {
  const root = document.documentElement;
  root.dataset.theme = isTheme(theme) ? theme : 'classic';
  if (pixel) root.dataset.pixel = ''; else delete root.dataset.pixel;
}
/** Whether the pixel look is on in this window. */
export const pixelOn = () => document.documentElement.dataset.pixel !== undefined;

/**
 * Choosing a style. The journal style brings its paper palette (only when switching to it, and only if none of its own
 * palettes is chosen; the palette stays free to change afterwards). Leaving it with one of its palettes still chosen
 * brings back the palette chosen before.
 */
export function withTheme(settings: Settings, theme: Theme): Settings {
  if (theme === settings.theme) return settings;
  const own = journalColorThemes.includes(settings.colorTheme);
  if (theme === 'journal') return own ? { ...settings, theme, previousColorTheme: settings.colorTheme } : { ...settings, theme, colorTheme: 'paper', previousColorTheme: settings.colorTheme };
  if (settings.theme === 'journal' && own) return { ...settings, theme, colorTheme: settings.previousColorTheme ?? 'original' };
  return { ...settings, theme };
}
