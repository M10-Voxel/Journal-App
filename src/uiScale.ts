import { getCurrentWebview } from '@tauri-apps/api/webview';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';
import { widgetScreenWidth } from './widgetDisplay';
import { isDesktopWidgetLabel } from './widgetIdentity';

/** How large the interface is drawn: chosen, or by the screen (`auto`). */
export type UiScale = 'auto' | `${number}`;
export const isUiScale = (value: unknown): value is UiScale => value === 'auto' || (typeof value === 'string' && /^\d+$/.test(value) && Number(value) >= 75 && Number(value) <= 200);

/**
 * For `auto`: by the width the screen offers in Windows' own scaling. Full HD stays as it is; a wide or 4K screen at
 * 100–150 % gets larger text, so it reads like on a laptop. The pixel faces have small letters and get a little more.
 */
export function autoFactor(logicalWidth: number, pixel: boolean): number {
  const base = logicalWidth >= 3200 ? 1.4 : logicalWidth >= 2500 ? 1.25 : logicalWidth >= 1900 ? 1.1 : 1;
  return Math.round(base * (pixel ? 1.1 : 1) * 100) / 100;
}
export function factorOf(scale: UiScale, logicalWidth: number, pixel: boolean): number {
  return scale === 'auto' ? autoFactor(logicalWidth, pixel) : Number(scale) / 100;
}

let applied = 0;
let wanted: { scale: UiScale; pixel: boolean } = { scale: 'auto', pixel: false };
/** The screen's width in Windows' scaling (logical pixels). */
export async function screenWidth(): Promise<number> {
  if (isDesktopWidgetLabel(getCurrentWindow().label) && widgetScreenWidth() !== null) return widgetScreenWidth()!;
  try {
    const monitor = await currentMonitor();
    if (monitor) return monitor.size.width / monitor.scaleFactor;
  } catch { /* outside Tauri (UI checks): the browser's screen */ }
  return window.screen.width;
}
/** Zooms this window's webview (every coordinate stays in CSS pixels, so dragging in the calendar keeps working). */
export async function applyScale(scale: UiScale, pixel: boolean) {
  wanted = { scale, pixel };
  // The reminder popup measures itself for its window; it stays as it is.
  if (getCurrentWindow().label === 'reminder') return;
  const factor = factorOf(scale, await screenWidth(), pixel);
  document.documentElement.dataset.scale = String(factor);
  if (factor === applied) return;
  applied = factor;
  try { await getCurrentWebview().setZoom(factor); } catch { /* not in Tauri */ }
}
/** Moved to another screen (or its scaling changed): `auto` measures again. */
export function followScreen(): () => void {
  let timer = 0;
  const again = () => { window.clearTimeout(timer); timer = window.setTimeout(() => { if (wanted.scale === 'auto') void applyScale(wanted.scale, wanted.pixel); }, 300); };
  const stops = [getCurrentWindow().onScaleChanged(again), getCurrentWindow().onMoved(again)].map(promise => promise.catch(() => () => {}));
  window.addEventListener('widget:monitor', again);
  return () => { window.clearTimeout(timer); window.removeEventListener('widget:monitor', again); for (const stop of stops) void stop.then(unlisten => unlisten()); };
}
