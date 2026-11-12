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
/**
 * The base design: the normal app, the journal (a book) or Nebula (a Y2K desktop of terminals and posters). The pixel
 * look (`pixel`) can be laid over the first two; Nebula has its own type and fixed colours.
 */
export type Theme = 'classic' | 'journal' | 'nebula';
export const themes: readonly Theme[] = ['classic', 'journal', 'nebula'];
const isTheme = (value: unknown): value is Theme => themes.includes(value as Theme);
/** In the journal style: one page at a time, or both at once (`spread`, the board then lies over both pages). */
export type BookPaging = 'page' | 'spread';
/**
 * The look of the popups (planner, calendar entries, pickers): two variants per design, `a` and `b` (settings.css and
 * popup-styles.css name them: Karte/Glas, Karteikarte/Notizblock, Terminal/Holo-Papier).
 */
export type PopupStyle = 'a' | 'b';
/**
 * Swiping an entry's dot (the `swipe` action layout) is kept for touch screens (the Android version) but not offered on
 * the desktop. The UI checks still exercise it through `window.__journalSwipeLayout`.
 */
export const swipeAvailable = () => /android/i.test(navigator.userAgent) || (window as { __journalSwipeLayout?: boolean }).__journalSwipeLayout === true;
/**
 * `previousColorTheme`: the palette chosen before switching to the journal style, restored when leaving it.
 */
export interface Settings extends ColorSettings { actionLayout: ActionLayout; theme: Theme; pixel: boolean; popupStyle: PopupStyle; language: Language; uiScale: UiScale; bookPaging: BookPaging; inkPressure: boolean; previousColorTheme?: ColorTheme }
const key = 'journal.settings';
export const defaultSettings: Settings = { actionLayout: 'orbit', theme: 'classic', pixel: false, popupStyle: 'a', language: 'de', uiScale: 'auto', bookPaging: 'page', inkPressure: true, ...defaultColorSettings };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Omit<Settings, 'theme'>> & { theme?: string };
    // The pixel style used to be a theme of its own; it is the normal design with the pixel look now.
    return { actionLayout: stored.actionLayout === 'inline' || (stored.actionLayout === 'swipe' && swipeAvailable()) ? stored.actionLayout : defaultSettings.actionLayout, popupStyle: stored.popupStyle === 'b' ? 'b' : 'a', theme: isTheme(stored.theme) ? stored.theme : 'classic',
      pixel: stored.pixel === true || stored.theme === 'pixel', language: stored.language === 'en' ? 'en' : 'de', uiScale: isUiScale(stored.uiScale) ? stored.uiScale : 'auto', ...normalizeColorSettings(stored),
      bookPaging: stored.bookPaging === 'spread' ? 'spread' : 'page', inkPressure: stored.inkPressure !== false,
      ...colorThemeIds.includes(stored.previousColorTheme as ColorTheme) ? { previousColorTheme: stored.previousColorTheme } : {} };
  } catch { return defaultSettings; }
}
export function saveSettings(settings: Settings) {
  settings = { ...settings, ...normalizeColorSettings(settings) };
  try { localStorage.setItem(key, JSON.stringify(settings)); } catch { /* storage unavailable: keep it for this session */ }
  applyTheme(settings);
  void applyScale(settings.uiScale, pixelActive(settings));
  applyColors(settings);
  setLanguage(settings.language);
  void emit('journal:theme', { theme: settings.theme, pixel: settings.pixel, popupStyle: settings.popupStyle }).catch(() => {});
  void emit('journal:scale', { scale: settings.uiScale, pixel: pixelActive(settings) }).catch(() => {});
  void emit('journal:language', settings.language).catch(() => {});
  void emit('journal:colors', { colorTheme: settings.colorTheme, customColors: settings.customColors }).catch(() => {});
}

/** Whether the pixel look shows: Nebula never takes it (the stored choice stays for the other designs). */
export const pixelActive = ({ theme, pixel }: Pick<Settings, 'theme' | 'pixel'>) => pixel && theme !== 'nebula';
/** The design on the page: `data-theme` is the base design, `data-pixel` the pixel look over it. */
export function applyTheme({ theme, pixel, popupStyle }: Pick<Settings, 'theme' | 'pixel'> & { popupStyle?: PopupStyle }) {
  const root = document.documentElement;
  appDesign = { theme, pixel, popupStyle };
  // A transparent desktop widget leaves the app's design: the plain base with glass popups, its own palette (widgetGlass.css).
  if (glassLook) { root.dataset.theme = 'classic'; root.dataset.popups = 'b'; delete root.dataset.pixel; root.dataset.glass = glassLook; return; }
  delete root.dataset.glass;
  root.dataset.theme = isTheme(theme) ? theme : 'classic';
  root.dataset.popups = popupStyle === 'b' ? 'b' : 'a';
  if (pixelActive({ theme, pixel })) root.dataset.pixel = ''; else delete root.dataset.pixel;
}
let glassLook: 'light' | 'dark' | null = null;
// The app's design as last heard, to return to when the transparent look is switched off.
let appDesign: (Pick<Settings, 'theme' | 'pixel'> & { popupStyle?: PopupStyle }) | null = null;
/** A desktop widget window in the transparent look (null: the app's design again). */
export function setGlassLook(look: 'light' | 'dark' | null) {
  if (look === glassLook) return;
  glassLook = look;
  applyTheme(appDesign ?? loadSettings());
}
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
