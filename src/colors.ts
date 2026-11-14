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
  { id: 'book', label: 'Buch (Journal-Stil)', colors: [
    ['cover', 'Einband und Hintergrund'], ['spine', 'Buchfalz (Schatten in der Mitte)'],
  ] },
] as const;
export type ColorToken = typeof colorGroups[number]['colors'][number][0];
export type Palette = Record<ColorToken, string>;
export type ColorOverrides = Partial<Palette>;
export const colorThemeIds = ['original', 'green', 'summer', 'paper', 'candle', 'lavender', 'lavender-night'] as const;
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
  cover: '#2a2b30', spine: '#000000',
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
  cover: '#2c4027', spine: '#000000',
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
  cover: '#1d3d50', spine: '#000000',
};
// Light paper and ink for the journal style: cream pages, dark brown ink and blue ink as the accent.
const paper: Palette = {
  background: '#f3ecdc', surface: '#f8f3e7', inset: '#ece3cf', hover: '#e9dfc8', selected: '#e0d3b6', focus: '#ddd0b2',
  border: '#e6dcc6', divider: '#d9ccb0', edge: '#5a462a24', line: '#5a462a1f', scrollbar: '#c9b994',
  text: '#2b2620', strong: '#1d1915', muted: '#6b5f4f', placeholder: '#8c806c', disabled: '#a89c86',
  accent: '#2f5d9e', priority: '#a8641a', success: '#3f7a3a', error: '#b03a2e', cancelled: '#8a4a6a',
  event: '#2f5d9e', 'event-background': '#dfe5ee', 'event-text': '#203f6b', 'task-background': '#e8dfcb',
  now: '#b03a2e', saturday: '#3c6aa8', sunday: '#a8473b',
  'md-red': '#b03a2e', 'md-orange': '#8f4c12', 'md-yellow': '#6e560a', 'md-green': '#33652f',
  'md-cyan': '#225c5c', 'md-blue': '#2f5d9e', 'md-purple': '#6a4a9a', 'md-pink': '#a4426e',
  'md-highlight-background': '#f2d36b66', 'md-highlight-text': '#2b2620',
  cover: '#6a4129', spine: '#3b2a1a',
};
// The journal style at night: dark brown pages, warm cream ink and candle gold as the accent.
const candle: Palette = {
  background: '#1c1612', surface: '#28201a', inset: '#211a15', hover: '#352a21', selected: '#433528', focus: '#46382b',
  border: '#17120e', divider: '#3e3127', edge: '#f3e2c21a', line: '#f3e2c21f', scrollbar: '#5c4836',
  text: '#e6d8c0', strong: '#f7ecd8', muted: '#bba98f', placeholder: '#968569', disabled: '#6f604d',
  accent: '#e3ab52', priority: '#e8935a', success: '#9fca7d', error: '#ec8d7d', cancelled: '#cba0b4',
  event: '#d9a95a', 'event-background': '#3b2d1e', 'event-text': '#f3dcb3', 'task-background': '#30261b',
  now: '#f0b85c', saturday: '#9fbfd6', sunday: '#e2a08a',
  'md-red': '#f0958a', 'md-orange': '#eba86d', 'md-yellow': '#e9d08a', 'md-green': '#abd08b',
  'md-cyan': '#93d0c5', 'md-blue': '#9db9e6', 'md-purple': '#c6abe1', 'md-pink': '#e9a6c1',
  'md-highlight-background': '#e3ab5233', 'md-highlight-text': '#f8e2b0',
  cover: '#5a3020', spine: '#000000',
};
// The journal look's own: lavender paper with violet ink, pink and mint stickers (the reference sheet „purpl“).
const lavender: Palette = {
  background: '#e9e4f5', surface: '#f5f2fb', inset: '#ebe6f6', hover: '#ddd4f1', selected: '#d0c4ef', focus: '#d4c9ee',
  border: '#ded6ef', divider: '#c9bde6', edge: '#2b214026', line: '#2b21401f', scrollbar: '#b3a4dc',
  text: '#2b2140', strong: '#1b1330', muted: '#594e74', placeholder: '#7e7399', disabled: '#a59dbe',
  accent: '#6246b8', priority: '#a8476a', success: '#2f7a64', error: '#b33c5c', cancelled: '#8a5a80',
  event: '#6246b8', 'event-background': '#ddd3f5', 'event-text': '#36266e', 'task-background': '#e3dcf2',
  now: '#c8476f', saturday: '#5b4cb8', sunday: '#b04a6e',
  'md-red': '#a8334f', 'md-orange': '#8c4a1c', 'md-yellow': '#6b580b', 'md-green': '#24684f', 'md-cyan': '#22686e',
  'md-blue': '#4750b0', 'md-purple': '#6246b8', 'md-pink': '#9b3672',
  'md-highlight-background': '#e48aa855', 'md-highlight-text': '#2b2140',
  cover: '#cbbfe9', spine: '#5a4a86',
};
// The same sheet at night: deep violet paper, pale lilac ink, the stickers glowing a little.
const lavenderNight: Palette = {
  background: '#1e1830', surface: '#2a2240', inset: '#241d38', hover: '#352b50', selected: '#43375f', focus: '#463a64',
  border: '#1a1529', divider: '#3d3358', edge: '#efe8ff21', line: '#efe8ff1f', scrollbar: '#5c4f80',
  text: '#e6e0f5', strong: '#f7f3ff', muted: '#b9afd0', placeholder: '#8f84aa', disabled: '#665c80',
  accent: '#b3a0ff', priority: '#f0a0bc', success: '#8fdcc5', error: '#f592a9', cancelled: '#c9a3c4',
  event: '#b3a0ff', 'event-background': '#3a2d60', 'event-text': '#e8e0ff', 'task-background': '#2f2747',
  now: '#f0a0bc', saturday: '#aea5f2', sunday: '#f2a5bb',
  'md-red': '#f592a9', 'md-orange': '#f2b386', 'md-yellow': '#efd98f', 'md-green': '#8fdcc5', 'md-cyan': '#8fd6dc',
  'md-blue': '#a5b4ff', 'md-purple': '#c8b0ff', 'md-pink': '#f2a4d2',
  'md-highlight-background': '#b3a0ff40', 'md-highlight-text': '#f7f3ff',
  cover: '#2e2349', spine: '#000000',
};
/** The palettes made for the journal look (lavender first: the look brings it, see settings.ts withLook). */
export const journalColorThemes: readonly ColorTheme[] = ['lavender', 'lavender-night', 'paper', 'candle'];
export const colorThemes: { id: ColorTheme; name: string; description: string; colors: Palette }[] = [
  { id: 'original', name: 'Original', description: 'Schwarz, Graphit und kühles Blau.', colors: original },
  { id: 'green', name: 'Graphit & Limette', description: 'Dunkles Waldgrün, sanfte Grautöne und frische Limette.', colors: green },
  { id: 'summer', name: 'Himmel & Sonne', description: 'Himmelblau, Türkis und Sonnenwärme auf dunklem Marineblau.', colors: summer },
  { id: 'paper', name: 'Papier & Tinte', description: 'Helles Papier, dunkle Tinte und Blau-Tinte als Akzent.', colors: paper },
  { id: 'candle', name: 'Leder & Kerzenlicht', description: 'Dunkle Buchseiten, warme Tinte und Kerzengold – das Journal am Abend.', colors: candle },
  { id: 'lavender', name: 'Lavendel', description: 'Lavendelpapier, violette Tinte, rosa und mintgrüne Sticker.', colors: lavender },
  { id: 'lavender-night', name: 'Lavendel Nacht', description: 'Tiefes Violett, helle Tinte und leuchtende Sticker.', colors: lavenderNight },
];
/** Light palettes (paper) need light form controls and scrollbars. */
export const isLightPalette = (palette: Palette) => contrastRatio(palette.background, '#000000') > contrastRatio(palette.background, '#ffffff');
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
  root.style.colorScheme = isLightPalette(palette) ? 'light' : 'dark';
  for (const token of colorTokens) root.style.setProperty(`--${token}`, palette[token]);
  root.style.setProperty('--selection', `color-mix(in srgb, ${palette.accent} 20%, transparent)`);
  for (const token of ['accent', 'success', 'now', 'error'] as const) root.style.setProperty(`--on-${token}`, onColor(palette[token]));
}
