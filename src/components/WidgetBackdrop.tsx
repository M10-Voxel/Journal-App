import { useEffect, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { availableMonitors, getCurrentWindow } from '@tauri-apps/api/window';
import { getWidgetSurface, subscribeWidgetSurface } from '../widgetSurface';

/**
 * The transparent widget's constant frosted background: the desktop wallpaper, laid exactly where it lies on the
 * monitor behind the widget, blurred by the page (`--glass-blur`) and lightly tinted (widgetGlass.css). Windows can only
 * frost a whole window at one fixed strength; this way the strength is free and the corners follow the rounding.
 * The wallpaper is read again when it changes (checked on focus and every minute).
 */
interface WallpaperInfo { path: string; style: string; tile: boolean; modified: number }
interface Wallpaper { key: string; url: string; info: WallpaperInfo }
let wallpaper: Wallpaper | null = null, loading: Promise<void> | null = null;
const listeners = new Set<() => void>();
const kind = (bytes: Uint8Array) => bytes[0] === 0x89 && bytes[1] === 0x50 ? 'image/png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'image/jpeg'
  : bytes[0] === 0x42 && bytes[1] === 0x4d ? 'image/bmp' : bytes[0] === 0x3c ? 'image/svg+xml' : bytes[0] === 0x52 && bytes[8] === 0x57 ? 'image/webp' : '';
function refresh() {
  return loading ??= (async () => {
    try {
      const info = await invoke<WallpaperInfo>('desktop_wallpaper_info');
      const key = `${info.path}|${info.modified}|${info.style}|${info.tile}`;
      if (wallpaper?.key === key) return;
      const bytes = new Uint8Array(await invoke<ArrayBuffer>('desktop_wallpaper'));
      const url = URL.createObjectURL(new Blob([bytes], { type: kind(bytes) }));
      if (wallpaper) URL.revokeObjectURL(wallpaper.url);
      wallpaper = { key, url, info };
    } catch { if (wallpaper) URL.revokeObjectURL(wallpaper.url); wallpaper = null; }
    finally { loading = null; listeners.forEach(listener => listener()); }
  })();
}
function useWallpaper(active: boolean) {
  useEffect(() => {
    if (!active) return;
    void refresh();
    const timer = globalThis.setInterval(() => void refresh(), 60000);
    globalThis.addEventListener('focus', refresh);
    return () => { globalThis.clearInterval(timer); globalThis.removeEventListener('focus', refresh); };
  }, [active]);
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => wallpaper);
}

/** Where the widget's monitor lies in the page (the transparent canvas over all monitors), in CSS pixels. */
interface Area { left: number; top: number; width: number; height: number }
function useMonitor(active: boolean): Area | null {
  const [monitors, setMonitors] = useState<Area[] | null>(null);
  const surface = useSyncExternalStore(subscribeWidgetSurface, getWidgetSurface);
  useEffect(() => {
    if (!active) return;
    let stopped = false;
    const read = async () => {
      try {
        const [list, origin] = await Promise.all([availableMonitors(), getCurrentWindow().outerPosition()]);
        const scale = getWidgetSurface()?.scale ?? devicePixelRatio;
        if (!stopped && list) setMonitors(list.map(m => ({ left: (m.position.x - origin.x) / scale, top: (m.position.y - origin.y) / scale, width: m.size.width / scale, height: m.size.height / scale })));
      } catch { if (!stopped) setMonitors(null); }
    };
    void read();
    const again = () => void read();
    window.addEventListener('widget:popup-geometry', again);
    return () => { stopped = true; window.removeEventListener('widget:popup-geometry', again); };
  }, [active]);
  if (!active) return null;
  const widget = surface?.widget;
  if (!widget || !monitors?.length) return { left: 0, top: 0, width: innerWidth, height: innerHeight };
  const x = widget.left + widget.width / 2, y = widget.top + widget.height / 2;
  return monitors.find(m => x >= m.left && x < m.left + m.width && y >= m.top && y < m.top + m.height) ?? monitors[0];
}

/** How Windows lays the wallpaper on the monitor (Control Panel\Desktop: WallpaperStyle, TileWallpaper). */
function fit(info: WallpaperInfo): CSSProperties {
  if (info.tile) return { backgroundSize: 'auto', backgroundRepeat: 'repeat', backgroundPosition: 'left top' };
  switch (info.style) {
    case '6': return { backgroundSize: 'contain', backgroundPosition: 'center' };
    case '2': return { backgroundSize: '100% 100%' };
    case '0': return { backgroundSize: 'auto', backgroundPosition: 'center' };
    default: return { backgroundSize: 'cover', backgroundPosition: 'center' };
  }
}

export function WidgetBackdrop({ active, blur }: { active: boolean; blur: number }) {
  const image = useWallpaper(active), monitor = useMonitor(active);
  if (!active || !image || !monitor) return null;
  // The widget moves within the canvas by --widget-left/--widget-top (also while dragged); the wallpaper stays put.
  // The blur continues the picture's edge pixels (edgeMode duplicate), so a widget at the screen's edge has no dark rim.
  return <span className="desktop-widget-backdrop" aria-hidden="true">
    <svg width="0" height="0"><filter id="widget-backdrop-blur" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation={blur} edgeMode="duplicate" /></filter></svg>
    <i style={{ ...fit(image.info), backgroundImage: `url("${image.url}")`, width: monitor.width, height: monitor.height, filter: 'url(#widget-backdrop-blur)',
      left: `calc(${monitor.left}px - var(--widget-left, 0px))`, top: `calc(${monitor.top}px - var(--widget-top, 0px))` }} />
  </span>;
}
