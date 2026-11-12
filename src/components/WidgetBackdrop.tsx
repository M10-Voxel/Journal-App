import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { getWidgetSurface, subscribeWidgetSurface } from '../widgetSurface';

/**
 * The transparent widget's constant frosted background: the wallpaper of the monitor the widget lies on, laid exactly
 * where it lies on that monitor, blurred by the page (`--glass-blur`) and lightly tinted (widgetGlass.css). Each monitor
 * may show a picture of its own (wallpaper.rs reads them per monitor); moved to another monitor, the widget takes that
 * one. Windows can only frost a whole window at one fixed strength; this way the strength is free and the corners follow
 * the rounding. Widgets lie on the desktop below every window, so only the wallpaper is ever behind them.
 * The pictures are checked again on focus, when the canvas changes and every minute.
 */
type Position = 'fill' | 'fit' | 'stretch' | 'center' | 'tile' | 'span';
interface Monitor { x: number; y: number; width: number; height: number; modified: number }
interface Wallpapers { position: Position; monitors: Monitor[] }
interface Rect { left: number; top: number; width: number; height: number }

let info: Wallpapers | null = null, checking: Promise<void> | null = null;
// What the widgets read: replaced on every change (a new picture as well), so React notices it.
let snapshot: { info: Wallpapers | null; pictures: number } = { info: null, pictures: 0 };
const pictures = new Map<string, Promise<string | null>>(), urls = new Map<string, string>();
const listeners = new Set<() => void>();
const notify = () => { snapshot = { info, pictures: urls.size }; listeners.forEach(listener => listener()); };
const keyOf = (index: number, monitor: Monitor) => `${index}|${monitor.x},${monitor.y},${monitor.width},${monitor.height}|${monitor.modified}`;
const kind = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
  : bytes[0] === 0x42 && bytes[1] === 0x4d ? 'image/bmp' : bytes[0] === 0x3c ? 'image/svg+xml' : bytes[0] === 0x52 && bytes[8] === 0x57 ? 'image/webp' : '';

function check() {
  return checking ??= (async () => {
    try {
      const next = await invoke<Wallpapers>('desktop_wallpaper_info');
      const keys = new Set(next.monitors.map((monitor, index) => keyOf(index, monitor)));
      // Pictures that changed (or whose monitor did) are let go.
      for (const [key, url] of urls) if (!keys.has(key)) { URL.revokeObjectURL(url); urls.delete(key); pictures.delete(key); }
      info = next;
    } catch { info = null; }
    finally { checking = null; notify(); }
  })();
}
/** The picture of one monitor, loaded once per change. */
function picture(index: number, monitor: Monitor) {
  const key = keyOf(index, monitor);
  if (!pictures.has(key)) pictures.set(key, (async () => {
    try {
      const bytes = new Uint8Array(await invoke<ArrayBuffer>('desktop_wallpaper', { monitor: index }));
      const url = URL.createObjectURL(new Blob([bytes], { type: kind(bytes) }));
      urls.set(key, url); notify(); return url;
    } catch { pictures.delete(key); return null; }
  })());
  return urls.get(key) ?? null;
}
function useWallpapers(active: boolean) {
  useEffect(() => {
    if (!active) return;
    void check();
    const timer = globalThis.setInterval(() => void check(), 60000);
    // Also when the canvas changes (moved to another monitor, monitors added or rearranged).
    globalThis.addEventListener('focus', check); globalThis.addEventListener('widget:popup-geometry', check);
    return () => { globalThis.clearInterval(timer); globalThis.removeEventListener('focus', check); globalThis.removeEventListener('widget:popup-geometry', check); };
  }, [active]);
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => snapshot).info;
}

/** The canvas window's origin on the desktop (physical pixels); read again when the canvas changes. */
function useOrigin(active: boolean) {
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const read = () => void getCurrentWindow().outerPosition().then(position => { if (!stopped) setOrigin(position ? { x: position.x, y: position.y } : { x: 0, y: 0 }); }, () => { if (!stopped) setOrigin({ x: 0, y: 0 }); });
    read();
    window.addEventListener('widget:popup-geometry', read);
    return () => { stopped = true; window.removeEventListener('widget:popup-geometry', read); };
  }, [active]);
  return origin;
}

/** How Windows lays the picture on its area. */
function fit(position: Position): CSSProperties {
  switch (position) {
    case 'tile': return { backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'left top' };
    case 'fit': return { backgroundSize: 'contain', backgroundPosition: 'center' };
    case 'stretch': return { backgroundSize: '100% 100%' };
    case 'center': return { backgroundSize: 'auto', backgroundPosition: 'center' };
    default: return { backgroundSize: 'cover', backgroundPosition: 'center' };
  }
}

/**
 * The monitor under the widget's middle (or the nearest) and the area its picture covers, both in physical desktop
 * pixels. Spanned across monitors, one picture covers all of them together.
 */
export function wallpaperFor(wallpapers: Wallpapers, centre: { x: number; y: number }): { index: number; area: { x: number; y: number; width: number; height: number } } | null {
  const list = wallpapers.monitors;
  if (!list.length) return null;
  const distance = (m: Monitor) => Math.hypot(Math.max(m.x - centre.x, 0, centre.x - (m.x + m.width)), Math.max(m.y - centre.y, 0, centre.y - (m.y + m.height)));
  const index = list.reduce((best, monitor, at) => distance(monitor) < distance(list[best]) ? at : best, 0);
  if (wallpapers.position !== 'span') return { index, area: list[index] };
  const left = Math.min(...list.map(m => m.x)), top = Math.min(...list.map(m => m.y));
  return { index, area: { x: left, y: top, width: Math.max(...list.map(m => m.x + m.width)) - left, height: Math.max(...list.map(m => m.y + m.height)) - top } };
}

export function WidgetBackdrop({ active, blur }: { active: boolean; blur: number }) {
  const wallpapers = useWallpapers(active), origin = useOrigin(active);
  const surface = useSyncExternalStore(subscribeWidgetSurface, getWidgetSurface);
  if (!active || !wallpapers || !origin) return null;
  // The widget's place on the desktop: the canvas origin plus its rectangle in the canvas (CSS pixels × scale).
  const scale = surface?.scale ?? devicePixelRatio;
  const widget: Rect = surface?.widget ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const chosen = wallpaperFor(wallpapers, { x: origin.x + (widget.left + widget.width / 2) * scale, y: origin.y + (widget.top + widget.height / 2) * scale });
  if (!chosen) return null;
  const url = picture(chosen.index, wallpapers.monitors[chosen.index]);
  if (!url) return null;
  const area = chosen.area;
  // The widget moves within the canvas by --widget-left/--widget-top (also while dragged); the picture stays put.
  // The blur continues the picture's edge pixels (edgeMode duplicate), so a widget at the screen's edge has no dark rim.
  return <span className="desktop-widget-backdrop" aria-hidden="true" data-monitor={chosen.index}>
    <svg width="0" height="0"><filter id="widget-backdrop-blur" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation={blur} edgeMode="duplicate" /></filter></svg>
    <i style={{ ...fit(wallpapers.position), backgroundImage: `url("${url}")`, width: area.width / scale, height: area.height / scale, filter: 'url(#widget-backdrop-blur)',
      left: `calc(${(area.x - origin.x) / scale}px - var(--widget-left, 0px))`, top: `calc(${(area.y - origin.y) / scale}px - var(--widget-top, 0px))` }} />
  </span>;
}
