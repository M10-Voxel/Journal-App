// The app's design has four independent axes, each set on the page as an attribute of <html> (settings.ts, applyTheme):
//
//   layout   `data-layout`  what is where: the structure of the window. A layout is a component tree (main.tsx picks it)
//                           and its own CSS, written under `[data-layout='…']`.
//   look     `data-look`    how things look: type, colours, shapes, shadows, paper. Rules on the app's ordinary parts
//                           (entries, calendar, pickers, board cards …) are written under `[data-look='…']` and work in
//                           every layout.
//   popups   `data-popups`  the variant of the popups (planner, entry editor, pickers), per look (settings.css).
//   pixel    `data-pixel`   the pixel type and square steps over the classic and journal looks.
//
// To add a layout: add its id and info here, render it in main.tsx (`layout === 'yours'`), write its CSS under
// `[data-layout='yours']` (see docs/design-axes.md for what belongs where) and give it a sample in settings.css.
// To add a look: add its id and info, write `[data-look='yours']` rules (a palette and type block first), a sample.

export type Layout = 'classic' | 'book' | 'desk';
export type Look = 'classic' | 'journal' | 'nebula';

export const layouts: readonly Layout[] = ['classic', 'book', 'desk'];
export const looks: readonly Look[] = ['classic', 'journal', 'nebula'];
export const isLayout = (value: unknown): value is Layout => layouts.includes(value as Layout);
export const isLook = (value: unknown): value is Look => looks.includes(value as Look);

/** The ready-made designs of old: a layout with the look it was made for. */
export interface Preset { id: 'classic' | 'journal' | 'nebula'; layout: Layout; look: Look }
export const presets: readonly Preset[] = [
  { id: 'classic', layout: 'classic', look: 'classic' },
  { id: 'journal', layout: 'book', look: 'journal' },
  { id: 'nebula', layout: 'desk', look: 'nebula' },
];
/** The preset a pair is (null for a mix). */
export const presetOf = (layout: Layout, look: Look) => presets.find(preset => preset.layout === layout && preset.look === look)?.id ?? null;
export const isPresetId = (value: unknown): value is Preset['id'] => presets.some(preset => preset.id === value);
/**
 * The design stored settings hold. Older versions of the app (and settings shared by Drive from them) know only `theme`;
 * a `theme` that is not the one this version wrote beside its layout was set by one of them and wins.
 */
export function storedDesign(stored: { theme?: unknown; layout?: unknown; look?: unknown }): { layout: Layout; look: Look } {
  const old = fromTheme(stored.theme);
  if (isPresetId(stored.theme) && (!isLayout(stored.layout) || legacyTheme(stored.layout) !== stored.theme)) return old;
  return { layout: isLayout(stored.layout) ? stored.layout : old.layout, look: isLook(stored.look) ? stored.look : old.look };
}
/** What stored settings of before the split hold: one `theme`, which was layout and look at once (`pixel` was a theme once). */
export function fromTheme(theme: unknown): { layout: Layout; look: Look } {
  const preset = presets.find(item => item.id === theme);
  return preset ? { layout: preset.layout, look: preset.look } : { layout: 'classic', look: 'classic' };
}
/** The single theme an older version of the app reads (it keeps working on settings shared by Drive): the layout's preset. */
export const legacyTheme = (layout: Layout): Preset['id'] => presets.find(preset => preset.layout === layout)?.id ?? 'classic';

/** Whether the pixel look shows: some looks (Nebula) bring their own type and never take it. */
export const takesPixel = (look: Look) => look !== 'nebula';
/** The palette of the look cannot be changed (Nebula declares its colours itself). */
export const hasFixedPalette = (look: Look) => look === 'nebula';
/** The look a layout is made for: what a layout shows first, and what the search and other parts use when they need one name. */
export const nativeLook = (layout: Layout): Look => presets.find(preset => preset.layout === layout)?.look ?? 'classic';
