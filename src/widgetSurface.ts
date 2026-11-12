import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { dismissLayers } from './components/useDismissLayer';
import { moveWidgetRect } from './widgetPopupGeometry';
import type { PopupRect } from './widgetPopupGeometry';
import { setWidgetScreenWidth } from './widgetDisplay';

export interface SurfaceGeometry {
  widget: PopupRect; bounds: PopupRect; scale: number; monitorWidth: number; minWidth: number; minHeight: number;
}
let geometry: SurfaceGeometry | null = null;
const subscribers = new Set<() => void>();
export const subscribeWidgetSurface = (fn: () => void) => { subscribers.add(fn); return () => { subscribers.delete(fn); }; };
export const getWidgetSurface = () => geometry;
export const inDesktopWidget = () => document.documentElement.classList.contains('is-desktop-widget');
export const popupViewport = (): PopupRect => geometry?.bounds ?? { left: 0, top: 0, width: innerWidth, height: innerHeight };
const viewport = () => ({ width: innerWidth, height: innerHeight, scale: devicePixelRatio });
const nextTurn = () => new Promise<void>(resolve => setTimeout(resolve, 0));
function applyGeometry(next: SurfaceGeometry | null) {
  if (JSON.stringify(geometry) === JSON.stringify(next)) return;
  geometry = next;
  const root = document.documentElement;
  root.classList.toggle('widget-popup-canvas', !!next);
  for (const key of ['left', 'top', 'width', 'height'] as const) {
    if (next) root.style.setProperty(`--widget-${key}`, `${next.widget[key]}px`);
    else root.style.removeProperty(`--widget-${key}`);
  }
  if (next) setWidgetScreenWidth(next.monitorWidth);
  for (const fn of subscribers) fn();
  window.dispatchEvent(new Event('widget:popup-geometry'));
}

let initialization: Promise<void> | null = null;
export function ensureWidgetSurface(): Promise<void> {
  return initialization ??= (async () => {
    const next = await invoke<SurfaceGeometry | null>('desktop_widget_surface', { active: false, viewport: viewport(), rects: [] });
    applyGeometry(next ?? null);
    // The native canvas is prepared while the widget is still hidden. No resize is needed for subsequent popups.
    // A hidden WebView may suspend animation frames; readiness must not depend on one.
    await nextTurn();
    if (next && next.scale !== devicePixelRatio) {
      applyGeometry(await invoke<SurfaceGeometry>('desktop_widget_surface', { active: false, viewport: viewport(), rects: [] }));
    }
  })();
}

let pending: { rect: PopupRect; scale: number; finish: boolean; revision: number } | null = null;
let revision = 0;
const requestSync = () => window.dispatchEvent(new Event('widget:surface-request'));

/** Pointer capture keeps native window bounds fixed, including while the widget itself is moved or resized. */
export function startWidgetGesture(event: ReactPointerEvent<HTMLElement>, edge = '') {
  if (event.button !== 0 || !geometry) return;
  event.preventDefault();
  const target = event.currentTarget, id = event.pointerId, start = geometry;
  const x = event.clientX * devicePixelRatio, y = event.clientY * devicePixelRatio;
  const physical = Object.fromEntries(Object.entries(start.widget).map(([key, value]) => [key, value * start.scale])) as unknown as PopupRect;
  target.setPointerCapture(id);
  const update = (pointer: PointerEvent, finish: boolean) => {
    if (pointer.pointerId !== id) return;
    const rect = moveWidgetRect(physical, pointer.clientX * devicePixelRatio - x, pointer.clientY * devicePixelRatio - y, edge, start.minWidth * start.scale, start.minHeight * start.scale);
    const css = Object.fromEntries(Object.entries(rect).map(([key, value]) => [key, value / devicePixelRatio])) as unknown as PopupRect;
    pending = { rect: css, scale: devicePixelRatio, finish, revision: ++revision };
    applyGeometry({ ...geometry!, widget: css });
    requestSync();
  };
  const move = (pointer: PointerEvent) => update(pointer, false);
  const end = (pointer: PointerEvent) => {
    if (pointer.pointerId !== id) return;
    if (pointer.type === 'pointerup') update(pointer, true);
    else { pending = { rect: geometry!.widget, scale: devicePixelRatio, finish: true, revision: ++revision }; requestSync(); }
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    window.removeEventListener('lostpointercapture', end);
    if (target.hasPointerCapture(id)) target.releasePointerCapture(id);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  window.addEventListener('lostpointercapture', end);
}

export function connectWidgetSurface() {
  let stopped = false, syncing = false, again = false, scheduled = 0, lastKey = '', focused: HTMLElement | null = null;
  const watched = new Set<Element>();
  const selectors = '.widget-floating-popup,.popover,.ctx-menu,.cal-composer,.cal-drag-preview,.cal-drop-outline,.cal-drag-label';
  const nodes = () => [...document.querySelectorAll<HTMLElement>(selectors)];
  const resize = new ResizeObserver(() => schedule());
  async function sync() {
    if (syncing || stopped) return;
    syncing = true;
    try {
      await ensureWidgetSurface();
      do {
        again = false;
        const panels = nodes();
        for (const node of watched) if (!panels.includes(node as HTMLElement)) { resize.unobserve(node); watched.delete(node); }
        for (const panel of panels) if (!watched.has(panel)) { watched.add(panel); resize.observe(panel); }
        const rects = panels.map(panel => {
          const r = panel.getBoundingClientRect(), orbit = panel.classList.contains('is-orbit');
          // While a popup still plays its opening animation (scaled), its box on screen is smaller than where it ends
          // up; a fixed popup's layout box (offset*, untransformed) is its final place, so both together are measured.
          let left = r.left, top = r.top, right = r.right, bottom = r.bottom;
          if (getComputedStyle(panel).position === 'fixed') {
            left = Math.min(left, panel.offsetLeft); top = Math.min(top, panel.offsetTop);
            right = Math.max(right, panel.offsetLeft + panel.offsetWidth); bottom = Math.max(bottom, panel.offsetTop + panel.offsetHeight);
          }
          // Room around it for its tooltips and shadow (and the orbit's satellites).
          const mx = orbit ? 66 : 56, my = orbit ? 76 : 40;
          return { left: left - mx, top: top - my, width: right - left + mx * 2, height: bottom - top + my * 2 };
        });
        const widget = pending ? Object.fromEntries(Object.entries(pending.rect).map(([key, value]) => [key, value * pending!.scale / devicePixelRatio])) as unknown as PopupRect : null;
        const request = { active: !!panels.length, viewport: viewport(), rects, widget, finish: pending?.finish ?? false };
        const sentRevision = pending?.revision ?? revision, key = JSON.stringify(request);
        if (key !== lastKey) {
          const next = await invoke<SurfaceGeometry | null>('desktop_widget_surface', request);
          lastKey = key;
          // Never overwrite a newer drag position or a new zoom with an older asynchronous reply.
          if (sentRevision === revision && request.viewport.scale === devicePixelRatio) {
            if (pending?.revision === sentRevision) pending = null;
            if (next) applyGeometry(next);
          } else again = true;
        }
        const current = nodes(), root = document.documentElement;
        root.classList.toggle('widget-popups-ready', !!current.length);
        const top = current.at(-1) ?? null;
        if (top !== focused && !top?.matches('.cal-drag-preview,.cal-drop-outline,.cal-drag-label')) {
          focused = top;
          (top?.querySelector<HTMLElement>('[data-autofocus], [data-primary-action="true"]:not(:disabled), input:not(:disabled), button:not(:disabled):not(.chrome-close)') ?? top)?.focus({ preventScroll: true });
        }
      } while (again && !stopped);
    } catch (reason) { console.error('Widget surface:', reason); }
    finally { syncing = false; if (again && !stopped) schedule(); }
  }
  function schedule() {
    again = true;
    if (!scheduled) scheduled = requestAnimationFrame(() => { scheduled = 0; void sync(); });
  }
  const observer = new MutationObserver(records => {
    if (records.some(record => record.type === 'childList' || (record.target instanceof Element && record.target.closest(selectors)))) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  const dismiss = listen('widget:popups-dismiss', () => dismissLayers());
  const changed = listen('widget:surface-changed', () => { pending = null; revision++; lastKey = ''; schedule(); });
  for (const event of ['resize', 'widget:surface-request']) window.addEventListener(event, schedule);
  // An opening animation or transition changes a popup's box without a resize or mutation: measure again when it ends.
  const settled = (event: Event) => { if (event.target instanceof Element && event.target.closest(selectors)) schedule(); };
  for (const event of ['animationend', 'transitionend', 'animationcancel', 'transitioncancel']) document.addEventListener(event, settled, true);
  window.addEventListener('scroll', schedule, true);
  schedule();
  return () => {
    stopped = true; cancelAnimationFrame(scheduled); observer.disconnect(); resize.disconnect();
    for (const event of ['resize', 'widget:surface-request']) window.removeEventListener(event, schedule);
    for (const event of ['animationend', 'transitionend', 'animationcancel', 'transitioncancel']) document.removeEventListener(event, settled, true);
    window.removeEventListener('scroll', schedule, true);
    void dismiss.then(stop => stop()); void changed.then(stop => stop());
  };
}
