import { useCallback, useSyncExternalStore } from 'react';

/**
 * What a desktop widget shows in its header besides the navigation, per widget on this device (like its calendar view
 * and tag filter, so a duplicate copies it; see copyWidgetPreferences). The settings window and the widget hear each
 * other's changes through the storage event.
 */
/** `glass`: the transparent look (see widgetGlass.css), `glassText` its type: light for dark wallpapers, dark for light ones. */
export type GlassText = 'light' | 'dark';
export interface WidgetChrome { openButton: boolean; glass: boolean; glassText: GlassText; glassBlur: number; glassRadius: number }
/** The sliders' ranges in px: how strongly the wallpaper behind the widget is blurred (0: none, fully clear), the rounding of every curve. */
export const glassBlurRange = [0, 40] as const, glassRadiusRange = [0, 24] as const;
const clamp = (value: unknown, [min, max]: readonly [number, number], fallback: number) => typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
const key = 'journal.widget-chrome';
const defaults: WidgetChrome = { openButton: true, glass: false, glassText: 'light', glassBlur: 0, glassRadius: 12 };

function readAll(): Record<string, Partial<WidgetChrome>> {
  try { const stored = JSON.parse(localStorage.getItem(key) ?? '{}'); return stored && typeof stored === 'object' ? stored : {}; }
  catch { return {}; }
}
const cache = new Map<string, WidgetChrome>();
export function widgetChrome(id: string): WidgetChrome {
  let value = cache.get(id);
  if (!value) { const stored = readAll()[id] ?? {}; value = { openButton: stored.openButton !== false, glass: stored.glass === true, glassText: stored.glassText === 'dark' ? 'dark' : 'light',
    glassBlur: clamp(stored.glassBlur, glassBlurRange, defaults.glassBlur), glassRadius: clamp(stored.glassRadius, glassRadiusRange, defaults.glassRadius) }; cache.set(id, value); }
  return value;
}
const listeners = new Set<() => void>();
const notify = () => { for (const listener of [...listeners]) listener(); };
if (typeof window !== 'undefined') window.addEventListener('storage', event => { if (event.key === key || event.key === null) { cache.clear(); notify(); } });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };

export function setWidgetChrome(id: string, patch: Partial<WidgetChrome>) {
  const next = { ...widgetChrome(id), ...patch };
  cache.set(id, next);
  try { localStorage.setItem(key, JSON.stringify({ ...readAll(), [id]: next })); } catch { /* keep it for this session */ }
  notify();
}
/** Copies a widget's header choices to its duplicate (only before the duplicate has its own). */
export function copyWidgetChrome(source: string, target: string) {
  const all = readAll();
  if (all[source] && !all[target]) { try { localStorage.setItem(key, JSON.stringify({ ...all, [target]: all[source] })); } catch { /* defaults then */ } cache.delete(target); }
}
export function useWidgetChrome(id: string): [WidgetChrome, (patch: Partial<WidgetChrome>) => void] {
  const value = useSyncExternalStore(subscribe, () => widgetChrome(id), () => defaults);
  return [value, useCallback((patch: Partial<WidgetChrome>) => setWidgetChrome(id, patch), [id])];
}
