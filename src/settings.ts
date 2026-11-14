import type { ActionLayout } from './components/EntryActionDock';
import { emit } from '@tauri-apps/api/event';
import { setLanguage } from './i18n';
import type { Language } from './i18n';
import { hasFixedPalette, isLayout, isLook, legacyTheme, popupStyleFor, storedDesign, takesPixel } from './designs';
import type { Layout, Look, PopupStyle } from './designs';
import { applyColors, colorThemeIds, defaultColorSettings, journalColorThemes, normalizeColorSettings } from './colors';
import type { ColorSettings, ColorTheme } from './colors';
import { applyScale, isUiScale } from './uiScale';
import type { UiScale } from './uiScale';

// Device-local UI preferences live in localStorage. ThemeSync also mirrors language
// to native preferences so the tray and reminders use it before a webview opens.
// The design is a layout (what is where: the normal window, the journal's book, Nebula's desk) and a look (type, colours,
// shapes: normal, journal, Nebula), chosen separately (designs.ts). The pixel look (`pixel`) can be laid over the looks
// that take it; Nebula has its own type and fixed colours.
/** In the journal style: one page at a time, or both at once (`spread`, the board then lies over both pages). */
export type BookPaging = 'page' | 'spread';
/**
 * The look of the popups (planner, calendar entries, pickers): `a` and `b` per look, the journal look also `c` and `d`
 * (designs.ts `popupVariants`; settings.css and popup-styles.css name them: Karte/Glas, Karteikarte/Sticker/Sticker-Bogen/
 * Papierschnipsel, Terminal/Holo-Papier).
 */
export type { PopupStyle };
/**
 * Swiping an entry's dot (the `swipe` action layout) is kept for touch screens (the Android version) but not offered on
 * the desktop. The UI checks still exercise it through `window.__journalSwipeLayout`.
 */
export const swipeAvailable = () => /android/i.test(navigator.userAgent) || (window as { __journalSwipeLayout?: boolean }).__journalSwipeLayout === true;
/**
 * `previousColorTheme`: the palette chosen before switching to the journal style, restored when leaving it.
 */
export interface Settings extends ColorSettings { actionLayout: ActionLayout; layout: Layout; look: Look; pixel: boolean; popupStyle: PopupStyle; language: Language; uiScale: UiScale; bookPaging: BookPaging; inkPressure: boolean; previousColorTheme?: ColorTheme }
const key = 'journal.settings';
export const defaultSettings: Settings = { actionLayout: 'orbit', layout: 'classic', look: 'classic', pixel: false, popupStyle: 'a', language: 'de', uiScale: 'auto', bookPaging: 'page', inkPressure: true, ...defaultColorSettings };

export function loadSettings(): Settings {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? '{}') as Partial<Settings> & { theme?: string };
    // Before layout and look were chosen apart there was one theme for both; and the pixel style used to be a theme of its own.
    return { actionLayout: stored.actionLayout === 'inline' || (stored.actionLayout === 'swipe' && swipeAvailable()) ? stored.actionLayout : defaultSettings.actionLayout, ...(design => ({ ...design, popupStyle: popupStyleFor(design.look, stored.popupStyle) }))(storedDesign(stored)),
      pixel: stored.pixel === true || stored.theme === 'pixel', language: stored.language === 'en' ? 'en' : 'de', uiScale: isUiScale(stored.uiScale) ? stored.uiScale : 'auto', ...normalizeColorSettings(stored),
      bookPaging: stored.bookPaging === 'spread' ? 'spread' : 'page', inkPressure: stored.inkPressure !== false,
      ...colorThemeIds.includes(stored.previousColorTheme as ColorTheme) ? { previousColorTheme: stored.previousColorTheme } : {} };
  } catch { return defaultSettings; }
}
export function saveSettings(settings: Settings) {
  settings = { ...settings, ...normalizeColorSettings(settings) };
  // `theme` stays in the stored settings for older versions of the app (shared by Drive): the layout's own design.
  try { localStorage.setItem(key, JSON.stringify({ ...settings, theme: legacyTheme(settings.layout) })); } catch { /* storage unavailable: keep it for this session */ }
  applyTheme(settings);
  void applyScale(settings.uiScale, pixelActive(settings));
  applyColors(settings);
  setLanguage(settings.language);
  void emit('journal:theme', { layout: settings.layout, look: settings.look, pixel: settings.pixel, popupStyle: settings.popupStyle }).catch(() => {});
  void emit('journal:scale', { scale: settings.uiScale, pixel: pixelActive(settings) }).catch(() => {});
  void emit('journal:language', settings.language).catch(() => {});
  void emit('journal:colors', { colorTheme: settings.colorTheme, customColors: settings.customColors }).catch(() => {});
}

/** Whether the pixel look shows: Nebula never takes it (the stored choice stays for the other looks). */
export const pixelActive = ({ look, pixel }: Pick<Settings, 'look' | 'pixel'>) => pixel && takesPixel(look);
/** The design of this window's colour settings: a look with a palette of its own cannot be recoloured. */
export const paletteFixed = ({ look }: Pick<Settings, 'look'>) => hasFixedPalette(look);
export type Design = Pick<Settings, 'layout' | 'look' | 'pixel'> & { popupStyle?: PopupStyle };
/** The design on the page: `data-layout` and `data-look` (designs.ts), `data-popups`, and `data-pixel` for the pixel look. */
export function applyTheme({ layout, look, pixel, popupStyle }: Design) {
  const root = document.documentElement;
  appDesign = { layout, look, pixel, popupStyle };
  // A transparent desktop widget leaves the app's design: the plain base with glass popups, its own palette (widgetGlass.css).
  if (glassLook) { root.dataset.layout = 'classic'; root.dataset.look = 'classic'; root.dataset.popups = 'b'; delete root.dataset.pixel; root.dataset.glass = glassLook; return; }
  delete root.dataset.glass;
  root.dataset.layout = isLayout(layout) ? layout : 'classic';
  root.dataset.look = isLook(look) ? look : 'classic';
  root.dataset.popups = popupStyleFor(isLook(look) ? look : 'classic', popupStyle);
  if (pixelActive({ look, pixel })) root.dataset.pixel = ''; else delete root.dataset.pixel;
}
let glassLook: 'light' | 'dark' | null = null;
// The app's design as last heard, to return to when the transparent look is switched off.
let appDesign: Design | null = null;
/** A desktop widget window in the transparent look (null: the app's design again). */
export function setGlassLook(look: 'light' | 'dark' | null) {
  if (look === glassLook) return;
  glassLook = look;
  applyTheme(appDesign ?? loadSettings());
}
/** Choosing the layout: only the structure changes. */
export const withLayout = (settings: Settings, layout: Layout): Settings => layout === settings.layout ? settings : { ...settings, layout };
/**
 * Choosing the look. The journal look brings its lavender palette (only when switching to it, and only if none of its own
 * palettes is chosen; the palette stays free to change afterwards). Leaving it with one of its palettes still chosen
 * brings back the palette chosen before.
 */
export function withLook(current: Settings, look: Look): Settings {
  if (look === current.look) return current;
  // The popup variant stays if the new look has it (the journal look's c and d fall back to a elsewhere).
  const settings = { ...current, popupStyle: popupStyleFor(look, current.popupStyle) };
  const own = journalColorThemes.includes(settings.colorTheme);
  if (look === 'journal') return own ? { ...settings, look, previousColorTheme: settings.colorTheme } : { ...settings, look, colorTheme: 'lavender', previousColorTheme: settings.colorTheme };
  if (settings.look === 'journal' && own) return { ...settings, look, colorTheme: settings.previousColorTheme ?? 'original' };
  return { ...settings, look };
}
/** Choosing both at once (a ready-made design, see `presets`). */
export const withDesign = (settings: Settings, layout: Layout, look: Look): Settings => withLayout(withLook(settings, look), layout);
