import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../i18n';
import { usePopupLook } from '../popupLook';
import type { PopupLook } from '../popupLook';
import { Icon } from './Icon';
import { useDismissLayer } from './useDismissLayer';
import { inDesktopWidget, popupViewport } from './WidgetPopupSurface';
import './contextMenu.css';
import type { IconName } from './Icon';

/**
 * The right-click menus (notebook, pinboard, the desk's windows …): one menu open at a time, rendered once by
 * `ContextMenuHost`, in the build of the popup look (not only its colours):
 * - Normal · Karte: a rounded card, icons and keys;
 * - Normal · Glas: frosted glass, pill rows that glow;
 * - Journal · Karteikarte: an index card – the title over the red rule, ruled lines, a tick box per row;
 * - Journal · Notizblock: a sheet on a spiral binding, the title on a tab, rows like a handwritten list;
 * - Nebula · Terminal: a prompt bar, every row a command with its description and keys in brackets;
 * - Nebula · Holo-Papier: a window menu – title bar, check column, underlined letters (pressed: run), etched separators.
 * Arrow keys move (→ opens a submenu, ← closes it), Enter runs, a letter jumps to its row, Escape closes. The menu key
 * or Shift+F10 opens it at the focused element. Inside text (inputs, editors) the menu is left to the editor.
 */
export interface MenuItem {
  id: string; label: string; icon?: IconName; keys?: string;
  /** The terminal's command name (Nebula · Terminal); the id by default. */
  command?: string;
  /** What the row does, for the looks that colour it (Holo-Papier's foils): creating/confirming, or removing. */
  positive?: boolean; danger?: boolean; disabled?: boolean; checked?: boolean;
  /** A colour swatch in place of the icon: a class giving it `--paper` (the board's paper colours) or `--swatch`. */
  swatch?: string;
  /** Indented rows in a submenu (a folder tree). */
  depth?: number;
  run?: () => void;
  /** A submenu (→ or pointing at the row). */
  items?: MenuEntry[];
}
export type MenuEntry = MenuItem | '-';
export interface MenuSpec { title: string; command: string; items: MenuEntry[] }
type Owner = HTMLElement | SVGElement;
interface Opened extends MenuSpec { x: number; y: number; byKey: boolean; owner: Owner | null; seq: number }

let opened: Opened | null = null, seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(listener => listener());
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function openContextMenu(spec: MenuSpec, at: { x: number; y: number }, options: { byKey?: boolean; owner?: Owner | null } = {}) {
  opened = { ...spec, items: tidy(spec.items), ...at, byKey: !!options.byKey, owner: options.owner ?? null, seq: ++seq };
  emit();
}
export function closeContextMenu() { if (!opened) return; opened = null; emit(); }
/** Separators only between rows (none doubled, none at an end). */
function tidy(items: MenuEntry[]): MenuEntry[] {
  const out: MenuEntry[] = [];
  for (const item of items) if (item !== '-' || (out.length && out[out.length - 1] !== '-')) out.push(item);
  while (out[out.length - 1] === '-') out.pop();
  return out;
}
const typing = (element: Element) => element.closest('input, textarea, select, [contenteditable="true"], .cm-editor, .entry-edit');

/**
 * An element's onContextMenu: the spec is built when the menu opens (null: no menu here, the event goes on). A menu
 * opened from the keyboard sits at the element, one by the pointer at the pointer.
 */
export function contextMenu(spec: (event: ReactMouseEvent<Element>) => MenuSpec | null) {
  return (event: ReactMouseEvent<Element>) => {
    if (event.defaultPrevented || typing(event.target as Element)) return;
    const made = spec(event);
    if (!made) return;
    event.preventDefault(); event.stopPropagation();
    // The menu key and Shift+F10 fire it with the primary button; the right button is the pointer.
    const byKey = event.button !== 2;
    const owner = event.currentTarget as Owner, rect = owner.getBoundingClientRect();
    openContextMenu(made, byKey ? { x: rect.left + 12, y: rect.top + Math.min(rect.height, 30) } : { x: event.clientX, y: event.clientY }, { byKey, owner });
  };
}
/** The same menu from a button (the pinboard's ⋯): under the button, keyboard-ready. */
export function openMenuAt(element: HTMLElement, spec: MenuSpec, byKey = false) {
  const rect = element.getBoundingClientRect();
  openContextMenu(spec, { x: rect.left, y: rect.bottom + 4 }, { byKey, owner: element });
}

export function ContextMenuHost() {
  const open = useSyncExternalStore(subscribe, () => opened, () => null);
  const look = usePopupLook();
  useLanguage();
  useDismissLayer({element:()=>document.querySelector<HTMLElement>('.ctx-menu'),inside:target=>!!target.closest('.ctx-menu'),onDismiss:closeContextMenu},!!open);
  useEffect(() => {
    if (!open) return;
    const scroll = (event: Event) => { if (!(event.target as Element).closest?.('.ctx-menu')) closeContextMenu(); };
    window.addEventListener('blur', closeContextMenu);
    if (!inDesktopWidget()) window.addEventListener('resize', closeContextMenu);
    document.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('blur', closeContextMenu);
      window.removeEventListener('resize', closeContextMenu);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [open]);
  if (!open) return null;
  const back = () => { const owner = open.owner; closeContextMenu(); if (owner?.isConnected) owner.focus({ preventScroll: true }); };
  return createPortal(<MenuPanel key={open.seq} look={look} spec={open} x={open.x} y={open.y} depth={0} byKey={open.byKey} onBack={back} />, document.body);
}

/** Underlined letters (Holo-Papier) and jump letters: the first letter of each label not taken yet. */
function letters(items: MenuEntry[]) {
  const taken = new Set<string>(), out = new Map<string, number>();
  for (const item of items) {
    if (item === '-' || item.disabled) continue;
    const at = [...item.label].findIndex(char => /\p{L}|\d/u.test(char) && !taken.has(char.toLowerCase()));
    if (at >= 0) { taken.add(item.label[at].toLowerCase()); out.set(item.id, at); }
  }
  return out;
}

function MenuPanel({ look, spec, x, y, depth, byKey, onBack, side, onHold }: {
  look: PopupLook; spec: MenuSpec; x: number; y: number; depth: number; byKey: boolean;
  /** Escape / ← : the top menu closes (the focus back to its element), a submenu gives the focus back to its row. */
  onBack: () => void;
  /** A submenu beside its row: x, y are the row's left top, `side` its right edge. */
  side?: number;
  /** The pointer reached this submenu: its row's menu keeps it open. */
  onHold?: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const [sub, setSub] = useState<{ id: string; x: number; y: number; side: number; byKey: boolean } | null>(null);
  const hover = useRef(0);
  const widgetOrigin = useRef(document.querySelector('.desktop-widget')?.getBoundingClientRect());
  const marks = letters(spec.items);
  useLayoutEffect(() => {
    const position = () => {
    const panel = ref.current; if (!panel) return;
    const width = panel.offsetWidth, height = panel.offsetHeight, margin = 6;
    const bounds = popupViewport(), right = bounds.left + bounds.width, bottom = bounds.top + bounds.height;
    // Native canvas resizing changes viewport coordinates, while the click stays on the same screen point.
    const widget = document.querySelector('.desktop-widget')?.getBoundingClientRect();
    const dx = depth === 0 && inDesktopWidget() ? (widget?.left ?? 0) - (widgetOrigin.current?.left ?? 0) : 0;
    const dy = depth === 0 && inDesktopWidget() ? (widget?.top ?? 0) - (widgetOrigin.current?.top ?? 0) : 0;
    const px = x + dx, py = y + dy;
    let left = side !== undefined ? side - 2 : px, top = py;
    if (left + width > right - margin) left = side !== undefined ? px - width + 2 : px - width;
    if (top + height > bottom - margin) top = side !== undefined ? bottom - margin - height : py - height;
    const next = { left: Math.max(bounds.left + margin, Math.min(right - margin - width, left)), top: Math.max(bounds.top + margin, top) };
    setPlace(old => old?.left === next.left && old?.top === next.top ? old : next);
    };
    position();
    window.addEventListener('widget:popup-geometry', position);
    return () => window.removeEventListener('widget:popup-geometry', position);
  }, [x, y, side]);
  useEffect(() => {
    // From the keyboard the first row takes the focus; by the pointer the menu itself (arrows still move).
    const panel = ref.current;
    if (byKey) panel?.querySelector<HTMLElement>('.ctx-item:not(:disabled)')?.focus({ preventScroll: true });
    else panel?.focus({ preventScroll: true });
  }, []);
  useEffect(() => () => clearTimeout(hover.current), []);
  const rows = () => [...ref.current!.querySelectorAll<HTMLButtonElement>(':scope > .ctx-list > .ctx-item:not(:disabled)')];
  const openSub = (item: MenuItem, element: HTMLElement, keyboard: boolean) => {
    const rect = element.getBoundingClientRect();
    setSub({ id: item.id, x: rect.left, y: rect.top - 4, side: rect.right, byKey: keyboard });
  };
  const run = (item: MenuItem, element: HTMLElement, keyboard: boolean) => {
    if (item.disabled) return;
    if (item.items) { openSub(item, element, keyboard); return; }
    closeContextMenu();
    item.run?.();
  };
  function onKey(event: ReactKeyboardEvent<HTMLDivElement>) {
    if ((event.target as Element).closest('.ctx-menu') !== ref.current) return;
    event.stopPropagation();
    const list = rows(), index = list.indexOf(document.activeElement as HTMLButtonElement);
    const step = ({ ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity } as Record<string, number>)[event.key];
    if (step !== undefined) {
      event.preventDefault();
      const next = step === -Infinity ? 0 : step === Infinity ? list.length - 1 : index < 0 ? (step > 0 ? 0 : list.length - 1) : (index + step + list.length) % list.length;
      list[next]?.focus();
      return;
    }
    const item = index >= 0 ? spec.items.find(entry => entry !== '-' && entry.id === list[index].dataset.item) as MenuItem | undefined : undefined;
    if (event.key === 'ArrowRight' && item?.items) { event.preventDefault(); openSub(item, list[index], true); return; }
    if (event.key === 'Escape' || (event.key === 'ArrowLeft' && depth > 0)) { event.preventDefault(); onBack(); return; }
    if (event.key === 'Tab') { event.preventDefault(); closeContextMenu(); return; }
    if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey && /\S/.test(event.key)) {
      const wanted = event.key.toLowerCase();
      // Holo-Papier: the underlined letter runs its row; elsewhere the letter jumps to the next row starting with it.
      if (look === 'nebula-b') {
        const hit = spec.items.find(entry => entry !== '-' && marks.has(entry.id) && entry.label[marks.get(entry.id)!].toLowerCase() === wanted) as MenuItem | undefined;
        const row = hit && list.find(button => button.dataset.item === hit.id);
        if (hit && row) { event.preventDefault(); row.focus(); run(hit, row, true); }
        return;
      }
      const order = list.map((_, at) => list[(Math.max(index, -1) + 1 + at) % list.length]);
      const row = order.find(button => (button.dataset.label ?? '').toLowerCase().startsWith(wanted));
      if (row) { event.preventDefault(); row.focus(); }
    }
  }

  const head = depth > 0 ? null
    : look === 'classic-b' ? <div className="ctx-head is-glass">{spec.title}</div>
    : look === 'journal-a' ? <div className="ctx-head is-card">{spec.title}</div>
    : look === 'journal-b' ? <div className="ctx-head is-pad"><span className="ctx-rings" aria-hidden="true" /><span className="ctx-tab">{spec.title}</span></div>
    : look === 'nebula-a' ? <div className="ctx-head is-prompt"><b>[journal@~]$</b> ./{spec.command}.sh --menu</div>
    : look === 'nebula-b' ? <div className="ctx-head is-window"><span>{spec.title}.exe</span></div>
    : null;
  const label = (item: MenuItem) => {
    if (look !== 'nebula-b' || !marks.has(item.id)) return item.label;
    const at = marks.get(item.id)!, chars = [...item.label];
    return <>{chars.slice(0, at).join('')}<u>{chars[at]}</u>{chars.slice(at + 1).join('')}</>;
  };
  const mark = (item: MenuItem) => item.swatch ? <i className={`ctx-swatch ${item.swatch}`} aria-hidden="true" />
    : look === 'journal-a' || look === 'nebula-b' ? <span className="ctx-check">{item.checked ? '✓' : ''}</span>
    : item.icon ? <Icon name={item.icon} /> : <span className="ctx-check">{item.checked ? '✓' : ''}</span>;
  const subItem = sub ? spec.items.find(entry => entry !== '-' && entry.id === sub.id) as MenuItem | undefined : undefined;

  return <>
    <div ref={ref} className={`ctx-menu is-${look}${depth ? ' is-sub' : ''}`} role="menu" aria-label={spec.title} tabIndex={-1} data-ctx-depth={depth}
      style={{ left: place?.left ?? -9999, top: place?.top ?? 0 }}
      onKeyDown={onKey} onContextMenu={event => event.preventDefault()} onPointerDown={event => event.stopPropagation()} onPointerEnter={onHold}>
      {head}
      <div className="ctx-list">
        {spec.items.map((item, at) => item === '-' ? <span key={`-${at}`} className="ctx-separator" role="separator" />
          : <button key={item.id} type="button" role="menuitem" data-item={item.id} data-label={item.label}
            className={`ctx-item${item.danger ? ' is-danger' : ''}${item.positive ? ' is-positive' : ''}${item.checked ? ' is-checked' : ''}${item.items ? ' has-sub' : ''}${sub?.id === item.id ? ' is-open' : ''}`}
            style={item.depth ? { '--depth': item.depth } as CSSProperties : undefined}
            disabled={item.disabled} aria-haspopup={item.items ? 'menu' : undefined} aria-expanded={item.items ? sub?.id === item.id : undefined}
            aria-checked={item.checked} title={item.keys ? `${item.label} · ${item.keys}` : undefined}
            onPointerEnter={event => {
              clearTimeout(hover.current);
              const element = event.currentTarget;
              if (item.items && !item.disabled) hover.current = window.setTimeout(() => openSub(item, element, false), 140);
              else if (sub) hover.current = window.setTimeout(() => setSub(null), 200);
            }}
            onClick={event => run(item, event.currentTarget, event.detail === 0)}>
            {look === 'nebula-a'
              ? <><span className="ctx-command">{item.command ?? item.id}</span><span className="ctx-label">{item.label}</span></>
              : <>{mark(item)}<span className="ctx-label">{label(item)}</span></>}
            {item.keys && <kbd>{item.keys}</kbd>}
            {item.items && <span className="ctx-arrow" aria-hidden="true">{look === 'nebula-a' ? '→' : '▸'}</span>}
          </button>)}
      </div>
    </div>
    {sub && subItem?.items && <MenuPanel key={sub.id} look={look} spec={{ title: subItem.label, command: spec.command, items: tidy(subItem.items) }} x={sub.x} y={sub.y} side={sub.side} depth={depth + 1} byKey={sub.byKey} onHold={() => clearTimeout(hover.current)}
      onBack={() => { const row = ref.current?.querySelector<HTMLElement>(`[data-item="${CSS.escape(sub.id)}"]`); setSub(null); row?.focus(); }} />}
  </>;
}
