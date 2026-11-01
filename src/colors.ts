/** Semantic colours shared by every window. Markdown stores names, never resolved hex values. */
export const colorGroups = [
  { id: 'surfaces', label: 'Flächen und Linien', colors: [
    ['background', 'Hintergrund'], ['surface', 'Panels und Popups'], ['inset', 'Eingabefelder'],
    ['hover', 'Hover'], ['selected', 'Ausgewählte Elemente'], ['focus', 'Tooltip-Fläche'],
    ['border', 'Abgesetzte Flächen'], ['divider', 'Trennlinien'], ['edge', 'Konturen'],
    ['line', 'Kalenderraster'], ['scrollbar', 'Scrollleisten'],
  ] },
  { id: 'text', label: 'Text', colors: [
    ['text', 'Standardtext'], ['strong', 'Überschriften und Fettdruck'], ['muted', 'Sekundärer Text'],
    ['placeholder', 'Hinweise und Platzhalter'], ['disabled', 'Deaktivierter Text'],
  ] },
  { id: 'accents', label: 'Akzente und Status', colors: [
    ['accent', 'Akzentfarbe'], ['priority', 'Priorität'], ['success', 'Erledigt und Erfolg'],
    ['error', 'Fehler und Löschen'], ['cancelled', 'Abgebrochen'],
  ] },
  { id: 'calendar', label: 'Kalender', colors: [
    ['event', 'Ereignisse'], ['event-background', 'Ereignis-Fläche'], ['event-text', 'Ereignis-Text'],
    ['task-background', 'Aufgaben-Fläche'], ['now', 'Heute und aktuelle Uhrzeit'],
    ['saturday', 'Samstag'], ['sunday', 'Sonntag'],
  ] },
  { id: 'markdown', label: 'Markdown-Textfarben', colors: [
    ['md-red', 'Rot'], ['md-orange', 'Orange'], ['md-yellow', 'Gelb'], ['md-green', 'Grün'],
    ['md-cyan', 'Cyan'], ['md-blue', 'Blau'], ['md-purple', 'Lila'], ['md-pink', 'Pink'],
    ['md-highlight-background', 'Markierung: Hintergrund'], ['md-highlight-text', 'Markierung: Text'],
  ] },
] as const;
export type ColorToken = typeof colorGroups[number]['colors'][number][0];
export type Palette = Record<ColorToken, string>;
export type ColorOverrides = Partial<Palette>;
export const colorThemeIds = ['original', 'green', 'summer'] as const;
export type ColorTheme = typeof colorThemeIds[number];
export type CustomColors = Partial<Record<ColorTheme, ColorOverrides>>;
export interface ColorSettings { colorTheme: ColorTheme; customColors: CustomColors }

const original: Palette = {
  background: '#000000', surface: '#292929', inset: '#1f1f1f', hover: '#393939', selected: '#494949', focus: '#494949',
  border: '#141414', divider: '#2e2e2e', edge: '#ffffff12', line: '#ffffff21', scrollbar: '#3d3d3d',
  text: '#bcbcbc', strong: '#e0e0e0', muted: '#999999', placeholder: '#7a7a7a', disabled: '#656565',
  accent: '#569eff', priority: '#e6a85c', success: '#76d982', error: '#ff5555', cancelled: '#ad4075',
  event: '#569eff', 'event-background': '#1d2b40', 'event-text': '#d6e6ff', 'task-background': '#2d2d2d',
  now: '#ff5f57', saturday: '#7fb2ff', sunday: '#e57b7b',
  'md-red': '#df6262', 'md-orange': '#e6a85c', 'md-yellow': '#e2d7b7', 'md-green': '#76d982',
  'md-cyan': '#c2dce9', 'md-blue': '#569eff', 'md-purple': '#c69bff', 'md-pink': '#ad4075',
  'md-highlight-background': '#e6a85c2e', 'md-highlight-text': '#e2d7b7',
};
const green: Palette = {
  background: '#0a120c', surface: '#202e22', inset: '#141f16', hover: '#2c4028', selected: '#3c542d', focus: '#405431',
  border: '#121d14', divider: '#3a4e30', edge: '#aeff0029', line: '#d5edc526', scrollbar: '#526d40',
  text: '#d0d9cf', strong: '#edf3e5', muted: '#a4b5a3', placeholder: '#81957f', disabled: '#657663',
  accent: '#aeff00', priority: '#e5c779', success: '#bce77c', error: '#ef8c86', cancelled: '#c5a4b6',
  event: '#b3e34b', 'event-background': '#293b26', 'event-text': '#d1eca9', 'task-background': '#263029',
  now: '#e5c779', saturday: '#91bbb0', sunday: '#d3ad8b',
  'md-red': '#eca390', 'md-orange': '#dbc18a', 'md-yellow': '#dce8a0', 'md-green': '#aeff00',
  'md-cyan': '#9bd4bc', 'md-blue': '#a1c8dc', 'md-purple': '#c2bbce', 'md-pink': '#d6aaba',
  'md-highlight-background': '#aeff002e', 'md-highlight-text': '#e3ffb0',
};
// Summer sky, shaded stone, foliage and the warm red railings in the reference image.
const summer: Palette = {
  background: '#0c1c26', surface: '#183140', inset: '#102631', hover: '#234451', selected: '#2b5360', focus: '#315562',
  border: '#122936', divider: '#345365', edge: '#80d6ed26', line: '#b4dbe52b', scrollbar: '#4a7788',
  text: '#dbeaf0', strong: '#fff3d5', muted: '#aac3ce', placeholder: '#809fac', disabled: '#617d8b',
  accent: '#50d5ff', priority: '#f1ce85', success: '#a6d575', error: '#ee8e83', cancelled: '#d3a6b7',
  event: '#75bfd2', 'event-background': '#1b3e4c', 'event-text': '#c5edf3', 'task-background': '#203744',
  now: '#f1ce85', saturday: '#8cd9ea', sunday: '#e9b194',
  'md-red': '#ff9f93', 'md-orange': '#f2bd80', 'md-yellow': '#f3de9d', 'md-green': '#b9df8a',
  'md-cyan': '#78e0de', 'md-blue': '#78cfff', 'md-purple': '#bdbdf2', 'md-pink': '#edb5c9',
  'md-highlight-background': '#f1ce8533', 'md-highlight-text': '#ffebba',
};
export const colorThemes: { id: ColorTheme; name: string; description: string; colors: Palette }[] = [
  { id: 'original', name: 'Original', description: 'Schwarz, Graphit und kühles Blau.', colors: original },
  { id: 'green', name: 'Graphit & Limette', description: 'Dunkles Waldgrün, sanfte Grautöne und frische Limette.', colors: green },
  { id: 'summer', name: 'Himmel & Sonne', description: 'Himmelblau, Türkis und Sonnenwärme auf dunklem Marineblau.', colors: summer },
];
export const colorTokens = colorGroups.flatMap(group => group.colors.map(([token]) => token));
export const defaultColorSettings: ColorSettings = { colorTheme: 'original', customColors: {} };
export const isHexColor = (value: unknown): value is string => typeof value === 'string' && /^#[\da-f]{6}(?:[\da-f]{2})?$/i.test(value);

/** Whitelist both tokens and hex values before they reach CSS or other windows. */
export function normalizeColorSettings(value: unknown): ColorSettings {
  const stored = value && typeof value === 'object' ? value as Partial<ColorSettings> : {};
  const customColors: CustomColors = {};
  for (const id of colorThemeIds) {
    const colors = stored.customColors?.[id];
    if (!colors || typeof colors !== 'object') continue;
    const overrides: ColorOverrides = {};
    for (const token of colorTokens) if (isHexColor(colors[token])) overrides[token] = colors[token].toLowerCase();
    if (Object.keys(overrides).length) customColors[id] = overrides;
  }
  return { colorTheme: colorThemeIds.find(id => id === stored.colorTheme) ?? 'original', customColors };
}
export function resolvePalette(settings: ColorSettings): Palette {
  const clean = normalizeColorSettings(settings);
  const base = colorThemes.find(theme => theme.id === clean.colorTheme)!;
  return { ...base.colors, ...clean.customColors[clean.colorTheme] };
}
export function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const rgb = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}
const onColor = (background: string) => contrastRatio('#ffffff', background) > contrastRatio('#06101f', background) ? '#ffffff' : '#06101f';

export function applyColors(settings: ColorSettings) {
  const clean = normalizeColorSettings(settings), palette = resolvePalette(clean);
  const root = document.documentElement;
  root.dataset.colorTheme = clean.colorTheme;
  for (const token of colorTokens) root.style.setProperty(`--${token}`, palette[token]);
  root.style.setProperty('--selection', `color-mix(in srgb, ${palette.accent} 20%, transparent)`);
  for (const token of ['accent', 'success', 'now', 'error'] as const) root.style.setProperty(`--on-${token}`, onColor(palette[token]));
}
