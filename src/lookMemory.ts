// Switching looks keeps what each look had: its palette and its popup variant (settings.ts `withLook`). Without it,
// journal → Nebula → journal came back to lavender and popup variant A, whatever had been chosen before.
import { popupStyleFor, popupVariants } from './designs.ts';
import type { Look, PopupStyle } from './designs.ts';
import { colorThemeBase, journalColorThemes, knownColorTheme } from './colors.ts';
import type { ColorSettings } from './colors.ts';

/** What a look had chosen when it was left, given back when it is chosen again (palette and popup variant). */
export type LookMemory = Partial<Record<Look, { colorTheme?: string; popupStyle?: PopupStyle }>>;
/** The part of the settings a look switch reads and changes. `previousColorTheme`: the normal look's palette, still
 *  written for older versions of the app. */
export type LookChoice = ColorSettings & { look: Look; popupStyle: PopupStyle; previousColorTheme?: string; lookMemory?: LookMemory };

/** The remembered choices that still exist: palettes that are known, popup variants the look has. */
export function normalizeLookMemory(value: unknown, colors: ColorSettings): LookMemory {
  const memory: LookMemory = {};
  if (!value || typeof value !== 'object') return memory;
  for (const look of ['classic', 'journal', 'nebula'] as const) {
    const entry = (value as Record<string, unknown>)[look] as { colorTheme?: unknown; popupStyle?: unknown } | undefined;
    if (!entry || typeof entry !== 'object') continue;
    const kept = { ...knownColorTheme(colors, entry.colorTheme) ? { colorTheme: entry.colorTheme } : {},
      ...popupVariants(look).includes(entry.popupStyle as PopupStyle) ? { popupStyle: entry.popupStyle as PopupStyle } : {} };
    if (Object.keys(kept).length) memory[look] = kept;
  }
  return memory;
}

/**
 * Choosing the look. Each look gets back the palette and popup variant it had when it was left (journal → Nebula →
 * journal returns to the same palette and, say, popup variant C). The first time: the journal look brings its lavender
 * palette unless one of its own is chosen; the normal look takes the palette from before the journal look, or keeps the
 * current one; Nebula never changes the palette (its colours are fixed) and a variant it lacks falls back to `a`.
 */
export function withLook<T extends LookChoice>(current: T, look: Look): T {
  if (look === current.look) return current;
  const memory: LookMemory = { ...current.lookMemory, [current.look]: { ...current.lookMemory?.[current.look], popupStyle: current.popupStyle,
    ...current.look === 'nebula' ? {} : { colorTheme: current.colorTheme } } };
  const remembered = memory[look];
  const popupStyle = popupStyleFor(look, remembered?.popupStyle ?? current.popupStyle);
  if (look === 'nebula') return { ...current, look, popupStyle, lookMemory: memory };
  const own = journalColorThemes.includes(colorThemeBase(current));
  // Leaving the journal look (also by way of Nebula) with one of its palettes: the normal look's palette from before.
  const leavingJournal = own && (current.look === 'journal' || memory.journal?.colorTheme === current.colorTheme);
  const fallback = look === 'journal' ? (own ? current.colorTheme : 'lavender')
    : leavingJournal ? (knownColorTheme(current, current.previousColorTheme) ? current.previousColorTheme : 'original') : current.colorTheme;
  const colorTheme = remembered?.colorTheme !== undefined && knownColorTheme(current, remembered.colorTheme) ? remembered.colorTheme : fallback;
  const previousColorTheme = memory.classic?.colorTheme ?? current.previousColorTheme ?? (look === 'journal' && !own ? current.colorTheme : undefined);
  return { ...current, look, popupStyle, colorTheme, lookMemory: memory, ...previousColorTheme ? { previousColorTheme } : {} };
}
