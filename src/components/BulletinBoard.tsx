import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties, FocusEvent as ReactFocusEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { BoardScopePicker } from './BoardScopePicker';
import { useFeatures } from '../featureStore';
import { NoteModeButton, inkKey } from './InkCanvas';
import { contextMenu } from './ContextMenu';
import type { MenuEntry, MenuItem, MenuSpec } from './ContextMenu';
import { useLanguage, t } from '../i18n';
import { BoardImage, Lightbox, Note, connectCards, disconnectCards, patchCards, removeCard, removeCards, hostOf, httpsLink, linkPreview, nextOrder, source, storeImage, useCards, useFolders, usePixelTheme, waitForCard } from '../boardCards';
import type { Card, Paper } from '../boardCards';
import type { BoardPlacement } from '../notebook';
import type { Tag } from '../tags';
import { folderPath, pageDirections, reversePagePatches, threadKind, threads } from '../notebook';
import { resizeBoardView } from '../boardViewport';
import { TagPicker } from './TagPicker';
import { isShown, tagOf } from '../tags';
import { useHiddenTags, useTags } from '../tagStore';
import type { TagScope } from '../tagStore';
import { boardKey, cardGroups, cardWidth, copyCards, copyLayout, copyableCard, groupFrames, layoutBoard, libraryNotes, scopedBoardPatch } from '../boardPlacement';
import type { BoardPeriod, BoardBox } from '../boardPlacement';
import { copySyncPatches, copySyncStates } from '../boardSync';
import './bulletinBoard.css';

// The board under the checklist: notes (small paper slips with Markdown), images (compressed to AVIF, as polaroids)
// and links (index cards with the page's title and preview) pinned anywhere on a cork surface. Cards are dragged by
// their paper, the last one touched lies on top; a note can come off the board as a floating window (board_detach).
// Positions: `x` as a share of the free width (so the board fits any window), `y` in pixels, `z` the stacking order.
// A card's pin is a handle: drawn to another card it ties both with a thread (an image or link becomes an attachment of
// the note, two notes pages of each other in the notebook). Threads hang from pin to pin and follow the cards.
const papers: Paper[] = ['yellow', 'blue', 'green', 'pink'];
const defaultWidth = (kind: Card['kind']) => kind === 'note' ? 232 : kind === 'image' ? 236 : 260;
const widthOf = cardWidth;
// Only a lower bound: a note (and a drawing on it) can grow as large as wanted.
const sizes = { minWidth: 160, minHeight: 120 };
/** A slight tilt of its own per card, like pinned paper. */
const tiltOf = (id: string) => (((parseInt(id.replace(/-/g, '').slice(0, 6), 16) || 0) % 7) - 3) * .6;
type Point = { x: number; y: number };
/** A thread hangs a little between its pins (the pixel look draws it in steps on a 4 px grid). */
function threadPath(a: Point, b: Point, pixel: boolean, taut = false) {
  const sag = taut ? 0 : Math.min(90, 12 + Math.hypot(b.x - a.x, b.y - a.y) * .16);
  const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + sag * 2 };
  if (!pixel) return `M${a.x.toFixed(1)} ${a.y.toFixed(1)}Q${c.x.toFixed(1)} ${c.y.toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  const grid = (v: number) => Math.round(v / 4) * 4, steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) / 14));
  let path = `M${grid(a.x)} ${grid(a.y)}`;
  for (let i = 1; i <= steps; i++) {
    const s = i / steps, x = (1 - s) ** 2 * a.x + 2 * (1 - s) * s * c.x + s * s * b.x, y = (1 - s) ** 2 * a.y + 2 * (1 - s) * s * c.y + s * s * b.y;
    path += `H${grid(x)}V${grid(y)}`;
  }
  return path;
}
function threadArrow(a:Point,b:Point){
  const length=Math.hypot(b.x-a.x,b.y-a.y)||1,dx=(b.x-a.x)/length,dy=(b.y-a.y)/length;
  const x=(a.x+b.x)/2,y=(a.y+b.y)/2+Math.min(90,12+length*.16);
  return `M${x-dx*6-dy*3.5} ${y-dy*6+dx*3.5}L${x} ${y}L${x-dx*6+dy*3.5} ${y-dy*6-dx*3.5}`;
}

function GroupName({ value, label, placeholder, onSave }: { value: string; label: string; placeholder: string; onSave: (value: string) => void }) {
  const [draft, setDraft] = useState(value), cancelled = useRef(false);
  useEffect(() => { setDraft(value); }, [value]);
  return <input className="board-group-name" aria-label={label} placeholder={placeholder} value={draft} maxLength={80}
    onChange={event => setDraft(event.target.value)} onBlur={() => {
      if (cancelled.current) { cancelled.current = false; return; }
      const name = draft.trim(); setDraft(name); if (name !== value) onSave(name);
    }} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancelled.current = true; setDraft(value); event.currentTarget.blur(); }
    }} />;
}

/** An object whose functions always call the latest ones given (a stable identity for memoized children). */
function useStable<T extends object>(value: T): T {
  const ref = useRef(value); ref.current = value;
  return useMemo(() => new Proxy({} as T, { get: (_, name) => (...args: unknown[]) => (ref.current as Record<string | symbol, (...args: unknown[]) => unknown>)[name](...args) }), []);
}

/** The switch that keeps copies in sync with their original (a card's, or a group's). */
function SyncToggle({ enabled, group = false, busy, onToggle }: { enabled: boolean; group?: boolean; busy: boolean; onToggle: () => void }) {
  const label = group ? t("Gruppe synchronisieren") : t("Notiz synchronisieren");
  return <button type="button" className={`board-copy-sync${enabled ? ' is-on' : ''}`} role="switch" aria-checked={enabled} aria-label={label} disabled={busy}
    title={t("Inhalt, Stil und Größe synchronisieren; bei Gruppen auch die Anordnung untereinander. Die Position der Karte oder Gruppe bleibt auf jeder Pinnwand unabhängig.")}
    onPointerDown={event => event.stopPropagation()} onClick={onToggle}><Icon name="repeat" /><span>{group ? '' : 'Sync'}</span><i aria-hidden="true" /></button>;
}

/** What a card asks of its board (BulletinBoard keeps them current; the object itself stays the same). */
interface CardActions {
  grab(event: ReactPointerEvent<HTMLElement>, card: Card, x: number, y: number): void;
  menu(card: Card, x: number): MenuSpec;
  edit(id: string): void;
  blur(event: ReactFocusEvent<HTMLElement>, id: string): void;
  key(event: ReactKeyboardEvent<HTMLElement>, card: Card, x: number, y: number): void;
  thread(event: ReactPointerEvent<HTMLElement>, card: Card): void;
  resize(event: ReactPointerEvent<HTMLElement>, card: Card, x: number): void;
  patch(id: string, changes: Partial<Card>): Promise<unknown> | void;
  tag(id: string, anchor: HTMLElement): void;
  run(action: () => Promise<unknown>, quiet?: boolean): void;
  open(card: Card): void;
  takeDown(card: Card): void;
  toggleSync(ids: string[]): void;
  positions(): Record<string, BoardPlacement>;
}
/**
 * A card on the board. Memoized: while one card is dragged (or the board panned), the others keep their rendering. Its
 * saved place is `x`/`y`; a drag moves it by `dx`/`dy` (`translate`, so the browser only moves its picture).
 */
const BoardCard = memo(function BoardCard({ card, x, y, z, dx, dy, w, h, moving, sizing, target, source, grouped, sync, tag, tagOpen, pixel, busy, date, boardKey: key, actions }: {
  card: Card; x: number; y: number; z: number; dx: number; dy: number; w: number; h: number | undefined; moving: boolean; sizing: boolean; target: boolean; source: boolean; grouped: boolean;
  sync: 'on' | 'off' | null; tag: Tag | null; tagOpen: boolean; pixel: boolean; busy: boolean; date: string; boardKey: string; actions: CardActions;
}) {
  const shownX = x + dx, shownY = y + dy, dragged = dx !== 0 || dy !== 0;
  return <article data-board-id={card.id} tabIndex={0}
    className={`board-card is-${card.kind}${card.kind === 'note' ? ` paper-${card.paper ?? 'yellow'}` : ''}${moving ? ' is-moving' : ''}${dragged ? ' is-dragged' : ''}${sizing ? ' is-sizing' : ''}${card.h ? ' has-height' : ''}${target ? ' is-link-target' : ''}${source ? ' is-link-source' : ''}`}
    style={{ left: x, top: y, zIndex: 1 + z, width: w, height: h, '--tilt': `${tiltOf(card.id)}deg`, ...dragged ? { translate: `${dx}px ${dy}px` } : {} } as CSSProperties}
    aria-label={`${card.kind === 'note' ? t("Zettel") : card.kind === 'image' ? t("Bild") : 'Link'}: ${card.title}`}
    onPointerDown={e => actions.grab(e, card, shownX, shownY)} onContextMenu={contextMenu(() => actions.menu(card, shownX))}
    onFocus={e => { if (e.target !== e.currentTarget && e.target.closest('input, textarea, [contenteditable="true"]')) actions.edit(card.id); }}
    onBlur={e => actions.blur(e, card.id)}
    onKeyDown={e => actions.key(e, card, shownX, shownY)}>
    {!grouped && sync && <SyncToggle enabled={sync === 'on'} busy={busy} onToggle={() => actions.toggleSync([card.id])} />}
    <span className="board-pin" aria-hidden="true" title={t("Zu einer anderen Karte ziehen: verbinden · Alt L")} onPointerDown={e => actions.thread(e, card)} />
    <span className="board-resize" aria-hidden="true" title={t("Größe ändern · Doppelklick: zurücksetzen")}
      onPointerDown={e => actions.resize(e, card, shownX)} onDoubleClick={e => { e.stopPropagation(); void actions.patch(card.id, { w: defaultWidth(card.kind), h: 0 }); }} />
    <header>
      <input aria-label={t("Titel")} value={card.title} placeholder={t("Titel")} onChange={e => void actions.patch(card.id, { title: e.target.value })} />
      {/* The tools (and the tag) lie over the title's end while the card is pointed at, so the title keeps its width. */}
      <div className="board-tools">
        {card.kind === 'note' && <button type="button" className={`board-tag${tag ? ' is-set' : ''}`} style={tag ? { '--tag': tag.color } as CSSProperties : undefined} aria-label={tag ? t("Tag {0} ändern").replace('{0}', tag.name) : t("Tag zuweisen")}
          title={tag ? tag.name : t("Tag zuweisen")} aria-haspopup="dialog" aria-expanded={tagOpen} onClick={e => actions.tag(card.id, e.currentTarget)}><span className={`tag-dot${tag ? '' : ' is-empty'}`} /></button>}
        {card.kind === 'note' && <NoteModeButton card={card} patch={actions.patch} />}
        {card.kind === 'note' && <button type="button" className="board-paper" aria-label={t("Papierfarbe")} title={t("Papierfarbe")} onClick={() => void actions.patch(card.id, { paper: papers[(papers.indexOf(card.paper ?? 'yellow') + 1) % papers.length] })}><i /></button>}
        {card.kind === 'image' && pixel && <button type="button" className="board-pixel-switch" aria-pressed={!!card.pixel} title={card.pixel ? t("Normal zeigen") : t("Verpixelt zeigen")} onClick={() => void actions.patch(card.id, { pixel: !card.pixel })}><Icon name="month" /></button>}
        {card.kind === 'note' && <button type="button" className="board-detach" title={t("Als schwebende Notiz öffnen")} aria-label={t("Als schwebende Notiz öffnen")} onClick={() => actions.run(() => invoke('board_detach', { id: card.id }))}><Icon name="pin" /></button>}
        <BoardScopePicker id={card.id} date={date} source={key} positions={actions.positions} />
        <button type="button" className="board-remove" title={t("Karte und Notiz löschen")} aria-label={t("Löschen")} onClick={() => actions.takeDown(card)}><Icon name="trash" /></button>
      </div>
    </header>
    {card.kind === 'note' ? <div className={`board-note${card.mode === 'ink' ? ' is-ink' : ''}`}><Note card={card} patch={actions.patch} /></div>
      : card.kind === 'image' ? <><BoardImage card={card} onOpen={() => actions.open(card)} /><div className="board-caption"><small>AVIF · {Math.round((card.size ?? 0) / 1024)} KB</small></div></>
      : <button type="button" className="board-link" onClick={() => actions.run(() => invoke('board_open_link', { url: card.url }))}>
        {card.image && <img src={card.image} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />}
        <strong>{card.title}</strong>{card.text && <span>{card.text}</span>}<small><Icon name="jump" />{hostOf(card.url)}</small>
      </button>}
  </article>;
});

/** A board in a frame of its own size (a Nebula window with a set height, a desktop widget): it does not grow with its
 *  cards and resizing the frame zooms the view. In a widget (`.board-framed`, nothing around it to scroll) the plain wheel
 *  also moves the board. */
const framed = '.nebula-panel-body.has-height, .board-framed';

/**
 * `tagScope`: whose tag filter hides notes (the journal's, or a widget's). `toolsSlot`: elsewhere for adding (a desktop
 * widget's header); the board then has no head of its own, only a "+" there that opens the same menu as a right click.
 */
export const BulletinBoard = memo(function BulletinBoard({ date, period = 'day', tagScope = 'journal', toolsSlot }: { date: string; period?: BoardPeriod; tagScope?: TagScope; toolsSlot?: Element | null }) {
  const threadMaskId = `board-threads-${useId().replace(/:/g, '')}`;
  const { cards, patch: savePatch, error } = useCards(); const language = useLanguage();
  const key = boardKey(date, period);
  // The notebook switched off (Einstellungen → Funktionen): cards do not offer to open there.
  const withNotebook = useFeatures().notebook;
  const patch = (id: string, changes: Partial<Card>) => savePatch(id, scopedBoardPatch(cards.find(card => card.id === id), key, changes));
  const pixelTheme = usePixelTheme();
  const { folders } = useFolders();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [picker, setPicker] = useState(false), [link, setLink] = useState<string | null>(null), [query, setQuery] = useState('');
  const [processing, setProcessing] = useState(false);
  const [open, setOpen] = useState<Card | null>(null);
  // A thread being drawn from a pin (to the pointer, or by keys to the card picked with the arrows), and an open thread's menu.
  const [linking, setLinking] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null);
  const [picking, setPicking] = useState<{ from: string; index: number } | null>(null);
  // The card whose note or title is being edited: threads do not run over it.
  const [editing, setEditing] = useState<string | null>(null);
  // A note's tag: the picker open for a card.
  const allTags = useTags();
  const [tagging, setTagging] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [threadMenu, setThreadMenu] = useState<{ a: string; b: string; anchor: HTMLElement } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const [groupDragging, setGroupDragging] = useState<{ ids: string[]; dx: number; dy: number } | null>(null);
  const [sizing, setSizing] = useState<{ id: string; w: number; h?: number } | null>(null);
  const [width, setWidth] = useState(640), [heights, setHeights] = useState<Record<string, number>>({});
  const viewportRef = useRef<HTMLDivElement>(null), canvasWidth = useRef(0);
  const viewportSize = useRef({ width: 0, height: 0 });
  const resizeReference = useRef({ width: 0, height: 0, scale: 1 });
  const growingHeight = useRef(0);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState(false);
  const [viewportHeight, setViewportHeight] = useState(380);
  const cardDragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => cardDragCleanup.current?.(), []);
  const scale = zoom;
  const camera = useRef({ zoom, scale, pan }); camera.current = { zoom, scale, pan };
  // Panning and zooming change the view at most once per frame (wheels and pointers send more events than frames); the
  // newest view wins. `camera` follows at once, so the next event builds on it.
  const viewFrame = useRef(0), pendingView = useRef<{ pan: Point; zoom?: number } | null>(null);
  const moveView = (next: Point, nextZoom?: number) => {
    camera.current = { ...camera.current, pan: next, ...nextZoom == null ? {} : { zoom: nextZoom, scale: nextZoom } };
    pendingView.current = { pan: next, zoom: nextZoom ?? pendingView.current?.zoom };
    if (viewFrame.current) return;
    viewFrame.current = requestAnimationFrame(() => {
      viewFrame.current = 0;
      const view = pendingView.current; pendingView.current = null;
      if (!view) return;
      setPan(view.pan); if (view.zoom != null) setZoom(view.zoom);
    });
  };
  useEffect(() => () => cancelAnimationFrame(viewFrame.current), []);
  useEffect(() => {
    const viewport = viewportRef.current; if (!viewport) return;
    // Over the board the page scrolls on as usual; Ctrl+wheel zooms the board, Shift+wheel moves it sideways.
    const wheel = (event: WheelEvent) => {
      if (event.shiftKey && !event.ctrlKey) {
        event.preventDefault(); event.stopPropagation();
        const current = camera.current, delta = event.deltaX || event.deltaY;
        moveView({ x: current.pan.x - delta, y: current.pan.y });
        return;
      }
      if (!event.ctrlKey) {
        if (!viewport.closest('.board-framed')) return;
        event.preventDefault(); event.stopPropagation();
        const current = camera.current;
        moveView({ x: current.pan.x - event.deltaX, y: current.pan.y - event.deltaY });
        return;
      }
      event.preventDefault(); event.stopPropagation();
      const current = camera.current, next = Math.max(.02, Math.min(8, current.zoom * Math.exp(-event.deltaY * .002)));
      const rect = viewport.getBoundingClientRect(), ratio = viewport.clientWidth / rect.width;
      const point = { x: (event.clientX - rect.left) * ratio, y: (event.clientY - rect.top) * ratio };
      moveView({ x: point.x - (point.x - current.pan.x) * next / current.zoom, y: point.y - (point.y - current.pan.y) * next / current.zoom }, next);
      resizeReference.current = { ...viewportSize.current, scale: next };
    };
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, []);
  function startPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as Element).closest('.board-card,.board-group-frame,.board-thread-hit,button,input,textarea,a,[contenteditable=true]')) return;
    event.preventDefault(); event.stopPropagation();
    const element = event.currentTarget, origin = { ...pan }, x = event.clientX, y = event.clientY;
    const ratio = element.clientWidth / element.getBoundingClientRect().width;
    const started = performance.now(); let moved = false;
    element.setPointerCapture(event.pointerId); setPanning(true);
    const move = (e: PointerEvent) => { if (e.pointerId === event.pointerId) { if (Math.hypot(e.clientX - x, e.clientY - y) > 5) moved = true; if (moved) moveView({ x: origin.x + (e.clientX - x) * ratio, y: origin.y + (e.clientY - y) * ratio }); } };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      if (e.type === 'pointerup' && !moved && performance.now() - started < 400) {
        const active = document.activeElement;
        if (active instanceof HTMLElement && boardRef.current?.contains(active)) active.blur();
        setEditing(null); setPicking(null);
      }
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end); element.removeEventListener('lostpointercapture', end); setPanning(false);
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end); element.addEventListener('lostpointercapture', end);
  }
  const upload = useRef<HTMLInputElement>(null), boardRef = useRef<HTMLDivElement>(null);
  // A note whose tag is hidden in the journal (its tag filter) is left off the board, with its threads.
  const [hiddenTags] = useHiddenTags(tagScope);
  const laidOut = useMemo(()=>layoutBoard(cards, key, width),[cards,key,width]);
  const layout = useMemo(() => laidOut.filter(item => !item.card.tag || isShown(hiddenTags, item.card.tag)), [laidOut, hiddenTags]);
  const hiddenByTag = laidOut.length - layout.length;
  const visible = useMemo(() => layout.map(item => item.card), [layout]);
  const topZ = useMemo(() => visible.reduce((z, card) => Math.max(z, card.z ?? 0), 0), [visible]);
  // Cards pinned before positions existed (or new ones) are laid out in a loose grid.
  const placed = useMemo(() => layout.map(({ card, x: savedX, y: savedY }) => {
    const inGroup = groupDragging?.ids.indexOf(card.id) ?? -1;
    const x = dragging?.id === card.id ? dragging.x : savedX + (inGroup >= 0 ? groupDragging!.dx : 0);
    const y = dragging?.id === card.id ? dragging.y : savedY + (inGroup >= 0 ? groupDragging!.dy : 0);
    return { card, x, y, z: dragging?.id === card.id ? topZ + 1 : inGroup >= 0 ? topZ + 1 + inGroup : card.z ?? 0 };
  }), [layout, dragging, groupDragging, topZ]);
  const boardHeight = Math.max(380, ...placed.map(p => p.y + (heights[p.card.id] ?? 220) + 36));
  // Reconnect only when the mounted cards change. Text edits and dragging keep the same observers.
  const measuredIds = JSON.stringify(visible.map(card => card.id));
  useLayoutEffect(() => {
    const board = boardRef.current; if (!board) return;
    const measure = (entries?: ResizeObserverEntry[]) => {
      const viewport = viewportRef.current!;
      const size = { width: viewport.clientWidth, height: viewport.clientHeight };
      if (size.width <= 0 || size.height <= 0) return;
      if (!canvasWidth.current) { canvasWidth.current = size.width; setWidth(size.width); }
      const previous = viewportSize.current, view = camera.current;
      if (!previous.width) resizeReference.current = { ...size, scale: view.scale };
      else if (size.width !== previous.width || size.height !== previous.height) {
        // Only a window with a set height is resized by hand; otherwise the board's own height follows its cards, and
        // that growth must neither zoom nor shift the view (nor undo a drag by zooming out).
        if (size.width === previous.width && (!viewport.closest(framed) || Math.abs(size.height - growingHeight.current) < 2)) {
          resizeReference.current = { ...size, scale: view.scale };
          growingHeight.current = 0;
        } else {
          const next = resizeBoardView(view, previous, size, resizeReference.current);
          camera.current = { zoom: next.scale, ...next };
          setZoom(next.scale); setPan(next.pan);
        }
      }
      viewportSize.current = size;
      // Observer entries already contain untransformed border sizes. Reading every card's offsetHeight here
      // forced layout again during window resizing, including cards whose size had not changed.
      const changed: Record<string, number> = {};
      if (entries) {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (el.dataset.boardId) changed[el.dataset.boardId] = Math.round(entry.borderBoxSize[0]?.blockSize ?? el.offsetHeight);
        }
      } else board.querySelectorAll<HTMLElement>('.board-card').forEach(el => { changed[el.dataset.boardId!] = el.offsetHeight; });
      setHeights(old => Object.entries(changed).every(([id, height]) => old[id] === height) && (entries || Object.keys(old).length === Object.keys(changed).length) ? old : entries ? { ...old, ...changed } : changed);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(board); if (viewportRef.current) observer.observe(viewportRef.current);
    board.querySelectorAll('.board-card').forEach(el => observer.observe(el, { box: 'border-box' }));
    return () => observer.disconnect();
  }, [measuredIds]);

  async function run(action: () => Promise<unknown>, quiet = false) { setBusy(true); setProcessing(!quiet); if (!quiet) setMessage(''); try { await action(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); setProcessing(false); } }
  // A new card lands in the middle of what is on screen (the board can be panned and zoomed), moved aside to the nearest
  // free place if something lies there.
  function freeSpot(kind: Card['kind']) {
    const w = kind === 'note' ? 232 : kind === 'image' ? 236 : 260, h = kind === 'note' ? 160 : 200;
    const { zoom: scale, pan } = camera.current, size = viewportSize.current;
    const centre = size.width > 0 && scale > 0 ? { x: (size.width / 2 - pan.x) / scale, y: (size.height / 2 - pan.y) / scale } : { x: width / 2, y: 18 + h / 2 };
    const free = (x: number, y: number) => !placed.some(p => x < p.x + widthOf(p.card) + 12 && x + w + 12 > p.x && y < p.y + (heights[p.card.id] ?? 220) + 12 && y + h + 12 > p.y);
    const at = (x: number, y: number) => ({ x: Math.max(0, Math.min(1, (x - 8) / Math.max(1, width - w - 16))), boardX: Math.round(x), y: Math.round(y) });
    const startX = centre.x - w / 2, startY = centre.y - h / 2;
    // Rings around the middle, in steps of a card's width and height.
    for (let ring = 0; ring < 12; ring++) for (let dy = -ring; dy <= ring; dy++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
      const x = startX + dx * (w + 16) * .5, y = startY + dy * (h + 16) * .5;
      if (free(x, y)) return at(x, y);
    }
    return at(startX, startY);
  }
  /** Independent copies of notes (and links) of the library on this board: one card, or all cards tied to it as a group. */
  async function copyHere(ids: string[]) {
    const copies = copyCards(cards, ids, () => crypto.randomUUID());
    if (!copies.length) return;
    const spot = freeSpot('note'), sourceLayout = copyLayout(cards, ids, width);
    const changes: Record<string, Partial<Card>> = {};
    let index = 0;
    for (const { from, card } of copies) {
      const layout = sourceLayout[from];
      changes[card.id] = scopedBoardPatch(undefined, key, { ...card, copyOf: from, copySync: false, ...layout, ...(copies.length === 1 ? spot : {}), dates: period === 'day' ? [date] : [], created: date, order: nextOrder(cards) + index, z: topZ + 1 + index });
      index++;
    }
    // Create the group and its threads together, as one undo step.
    await patchCards(changes);
  }
  async function add(kind: Card['kind'], extra: Partial<Card> = {}) {
    const id = crypto.randomUUID();
    await patch(id, { kind, title: kind === 'note' ? t("Neue Notiz") : '', text: '', dates: period === 'day' ? [date] : [], created: date, order: nextOrder(cards), z: topZ + 1, paper: papers[visible.length % papers.length], ...freeSpot(kind), ...extra });
    return id;
  }
  /** A new note that starts as a drawing. */
  const sketch = (): Partial<Card> => ({ mode: 'ink', title: t("Skizze"), h: 260, w: 300 });
  async function addLink() {
    const url = httpsLink(link ?? '');
    const id = await add('link', { title: url.hostname, url: url.href }); setLink(null);
    try { await patch(id, await linkPreview(url)); }
    catch { setMessage(t("Link gespeichert. Diese Seite liefert keine erreichbare Vorschau.")); }
  }

  // Threads: where a card's pin is (the top middle of the card, turned with it).
  const nebula = document.documentElement.dataset.look === 'nebula';
  const pins = useMemo(() => new Map(placed.map(at => {
    const id = at.card.id;
    const w = sizing?.id === id ? sizing.w : widthOf(at.card), h = heights[id] ?? 200, tilt = nebula || at.card.kind === 'note' ? 0 : tiltOf(id) * Math.PI / 180;
    return [id, { x: at.x + w / 2 + h / 2 * Math.sin(tilt), y: at.y + h / 2 - h / 2 * Math.cos(tilt) + 1 }];
  })), [placed, sizing, heights, nebula]);
  const pinOf = (id: string): Point | null => pins.get(id) ?? null;
  const cardsById = useMemo(() => new Map(cards.map(card => [card.id, card])), [cards]);
  const shown = useMemo(() => new Set(visible.map(c => c.id)), [visible]);
  const allThreads=useMemo(()=>threads(cards),[cards]);
  const boardThreads = useMemo(() => allThreads.filter(([a, b]) => shown.has(a) && shown.has(b)), [allThreads, shown]);
  const directed=useMemo(()=>new Map(pageDirections(cards).map(edge=>[[...edge].sort().join(':'),edge])),[cards]);
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const titleOf = (card?: Card) => card?.title || (card?.kind === 'note' ? t("Ohne Titel") : card?.kind === 'image' ? t("Bild") : 'Link');
  /** Ties two cards and says what came of it (an attachment or another page in the notebook). */
  function tie(a: string, b: string) {
    const first = cards.find(c => c.id === a), second = cards.find(c => c.id === b);
    if (!first || !second) return;
    const kind = threadKind(first, second);
    const done = connectCards(a, b);
    if (!done) { setMessage(t("Schon verbunden.")); return; }
    setMessage(kind === 'page' ? t("Verbunden · Seite: Die Zettel sind im Notizblock Seiten voneinander.")
      : kind === 'bundle' ? t("Verbunden · Bündel: Ein Faden vom Bündel zu einem Zettel hängt alles daran.")
      : t("Verbunden · Anhang: Im Notizblock hängt es am Zettel (mit allem, was daran verbunden ist)."));
    void done.catch(e => setMessage(String(e)));
  }
  // Drawing from a pin: a taut thread follows the pointer; let go on a card, they are tied.
  function startThread(event: ReactPointerEvent<HTMLElement>, card: Card) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const element = event.currentTarget, surface = boardRef.current!.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    const at = (e: PointerEvent | ReactPointerEvent) => ({ x: (e.clientX - surface.left) / scale, y: (e.clientY - surface.top) / scale });
    const target = (e: PointerEvent) => { const id = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('.board-card')?.dataset.boardId; return id && id !== card.id ? id : null; };
    setLinking({ from: card.id, ...at(event), over: null });
    const move = (e: PointerEvent) => setLinking({ from: card.id, ...at(e), over: target(e) });
    const end = (e: PointerEvent) => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end);
      setLinking(null);
      const over = e.type === 'pointerup' ? target(e) : null;
      if (over) tie(card.id, over);
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end);
  }
  // By keys: Alt+L on a card, then the arrows pick the other card, Enter ties, Escape stops.
  const others = (id: string) => placed.filter(p => p.card.id !== id).map(p => p.card);
  const pickedOf = (pick: { from: string; index: number }) => { const list = others(pick.from); return list.length ? list[((pick.index % list.length) + list.length) % list.length] : null; };
  const picked = picking ? pickedOf(picking) : null;
  function pickKey(event: ReactKeyboardEvent<HTMLElement>, card: Card): boolean {
    if (event.altKey && !event.ctrlKey && !event.shiftKey && !event.metaKey && event.code === 'KeyL') {
      event.preventDefault();
      if (!others(card.id).length) { setMessage(t("Für einen Faden braucht es eine zweite Karte.")); return true; }
      setPicking({ from: card.id, index: 0 });
      setMessage(t("Faden: Karte mit den Pfeiltasten wählen, Enter verbindet, Esc bricht ab."));
      return true;
    }
    if (picking?.from !== card.id) return false;
    const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (event.key in steps) { event.preventDefault(); setPicking({ ...picking, index: picking.index + steps[event.key] }); }
    else if (event.key === 'Enter') { event.preventDefault(); const target = pickedOf(picking); setPicking(null); if (target) tie(card.id, target.id); }
    else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setPicking(null); setMessage(''); }
    return true;
  }
  const drawing = linking ? { from: pinOf(linking.from), to: linking.over ? pinOf(linking.over) ?? linking : linking } : picking && picked ? { from: pinOf(picking.from), to: pinOf(picked.id) } : null;
  const target = linking?.over ?? picked?.id ?? null;
  const threadShapes = useMemo(() => boardThreads.flatMap(([a, b]) => {
    const direction = directed.get([a, b].join(':'));
    const from = pinOf(direction?.[0] ?? a), to = pinOf(direction?.[1] ?? b); if (!from || !to) return [];
    const label = direction ? `${t("Faden")}: ${titleOf(cardsById.get(direction[0]))} → ${titleOf(cardsById.get(direction[1]))}` : `${t("Faden")}: ${titleOf(cardsById.get(a))} – ${titleOf(cardsById.get(b))}`;
    return [{ a, b, from, to, path: threadPath(from, to, pixelTheme), arrow: direction ? threadArrow(from, to) : null, label }];
  }), [boardThreads, directed, pins, cardsById, pixelTheme, language]);
  // Dragging a card by its paper (not by its text, buttons or image); it comes to the top and stays where it is let go.
  function grab(event: ReactPointerEvent<HTMLElement>, card: Card, x: number, y: number, groupIds?: string[]) {
    // The drawing area belongs to the pen and the mouse; a finger on it still moves the card.
    if (event.button !== 0 || (event.target as Element).closest('input, textarea, button, a, [contenteditable="true"], .cm-editor, .entry-text, .board-image') || (event.pointerType !== 'touch' && (event.target as Element).closest('.ink-canvas'))) return;
    event.preventDefault();
    if (groupIds) { event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); }
    const element = event.currentTarget, viewport = viewportRef.current!;
    element.setPointerCapture(event.pointerId);
    cardDragCleanup.current?.();
    const point = { x: event.clientX, y: event.clientY };
    const worldPoint = () => {
      const box = viewport.getBoundingClientRect(), ratio = viewport.clientWidth / box.width, view = camera.current;
      return { x: ((point.x - box.left) * ratio - view.pan.x) / view.scale, y: ((point.y - box.top) * ratio - view.pan.y) / view.scale };
    };
    const initial = worldPoint(), offset = { x: initial.x - x, y: initial.y - y };
    const start = { px: event.clientX, py: event.clientY };
    const members = groupIds ? laidOut.filter(item => groupIds.includes(item.card.id)) : [];
    // `pending`: the pointer moved since the last frame; the card follows once per frame, not per pointer event.
    let last = { x, y }, moved = false, shown = false, pending = false;
    let frame = 0, previousFrame = performance.now();
    const update = () => {
      const at = worldPoint();
      const next = { x: at.x - offset.x, y: at.y - offset.y };
      // Nothing to show while the card stays where it is.
      if (shown && next.x === last.x && next.y === last.y) return;
      shown = true; last = next;
      if (groupIds) setGroupDragging({ ids: groupIds, dx: last.x - x, dy: last.y - y });
      else setDragging({ id: card.id, ...last });
      // Ordinary boards grow with the card. A deliberately sized window keeps its
      // frame and reveals more world space by panning at its edge instead.
      if (!viewport.closest(framed)) {
        const view = camera.current;
        setViewportHeight(current => {
          const bottom = groupIds ? Math.max(...members.map(item => item.y + last.y - y + (heights[item.card.id] ?? 220))) : last.y + (heights[card.id] ?? element.offsetHeight);
          const next = Math.max(current, view.pan.y + (bottom + 36) * view.scale);
          if (next > current) growingHeight.current = next;
          return next;
        });
      }
    };
    const animate = (now: number) => {
      const seconds = Math.min(.05, (now - previousFrame) / 1000); previousFrame = now;
      if (moved) {
        const box = viewport.getBoundingClientRect(), ratio = viewport.clientWidth / box.width;
        const speed = (value: number, min: number, max: number) => value < min ? Math.min(700, (min - value) * 5 + 100) : value > max ? -Math.min(700, (value - max) * 5 + 100) : 0;
        const dx = speed(point.x, box.left, box.right) * ratio * seconds;
        const dy = point.y < box.top || viewport.closest(framed) ? speed(point.y, box.top, box.bottom) * ratio * seconds : 0;
        if (dx || dy) moveView({ x: camera.current.pan.x + dx, y: camera.current.pan.y + dy });
        if (dx || dy || pending) { pending = false; update(); }
      }
      frame = requestAnimationFrame(animate);
    };
    const move = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      point.x = e.clientX; point.y = e.clientY;
      moved ||= Math.hypot(e.clientX - start.px, e.clientY - start.py) > 3;
      pending = true;
    };
    const cleanup = () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', end); window.removeEventListener('pointercancel', end);
      cardDragCleanup.current = null;
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== event.pointerId) return;
      if (moved && e.type === 'pointerup') { point.x = e.clientX; point.y = e.clientY; update(); }
      cleanup();
      setDragging(null);
      setGroupDragging(null);
      if (e.type === 'pointerup') {
        if (groupIds && moved) void run(() => patchCards(Object.fromEntries(members.map((item, index) => [item.card.id, scopedBoardPatch(cards.find(card => card.id === item.card.id), key, { boardX: item.x + Math.round(last.x - x), y: item.y + Math.round(last.y - y), z: topZ + 1 + index })]))), true);
        else if (!groupIds) void patch(card.id, moved ? { boardX: Math.round(last.x), y: Math.round(last.y), z: topZ + 1 } : { z: topZ + 1 });
      }
    };
    cardDragCleanup.current = cleanup;
    frame = requestAnimationFrame(animate);
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
  }
  // The corner sets the size (a note's height as well); a double click there resets it.
  function resize(event: ReactPointerEvent<HTMLElement>, card: Card, x: number) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const element = event.currentTarget, article = element.closest<HTMLElement>('.board-card')!;
    element.setPointerCapture(event.pointerId);
    const start = { px: event.clientX, py: event.clientY, w: article.offsetWidth, h: article.offsetHeight };
    let last: { w: number; h?: number } = { w: start.w, h: card.kind === 'note' ? start.h : undefined };
    const move = (e: PointerEvent) => {
      const w = Math.round(Math.max(sizes.minWidth, start.w + (e.clientX - start.px) / scale));
      last = { w, h: card.kind === 'note' ? Math.round(Math.max(sizes.minHeight, start.h + (e.clientY - start.py) / scale)) : undefined };
      setSizing({ id: card.id, ...last });
    };
    const end = () => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end);
      setSizing(null);
      void patch(card.id, { w: last.w, ...last.h ? { h: last.h } : {}, boardX: x, z: topZ + 1 });
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end);
  }
  function grow(card: Card, x: number, dw: number, dh: number) {
    const w = Math.max(sizes.minWidth, widthOf(card) + dw);
    const h = card.kind === 'note' && dh ? Math.max(sizes.minHeight, (card.h ?? heights[card.id] ?? 200) + dh) : card.h;
    void patch(card.id, { w, ...h ? { h } : {}, boardX: x });
  }
  // Arrow keys move the focused card (Shift: further).
  function nudge(card: Card, x: number, y: number, dx: number, dy: number) {
    void patch(card.id, { boardX: Math.round(x + dx), y: Math.round(y + dy), z: topZ + 1 });
  }

  // Right-click menus (ContextMenu.tsx): a card (also from its ⋯ button), the free cork (a new note right there), a thread.
  const startPicking = (card: Card) => {
    if (!others(card.id).length) { setMessage(t("Für einen Faden braucht es eine zweite Karte.")); return; }
    boardRef.current?.querySelector<HTMLElement>(`[data-board-id="${CSS.escape(card.id)}"]`)?.focus({ preventScroll: true });
    setPicking({ from: card.id, index: 0 });
    setMessage(t("Faden: Karte mit den Pfeiltasten wählen, Enter verbindet, Esc bricht ab."));
  };
  const takeDown = (card: Card) => void run(() => removeCard(card.id),true);
  const paperNames: [Paper, string][] = [['yellow', t("Gelb")], ['blue', t("Blau")], ['green', t("Grün")], ['pink', t("Rosa")]];
  function cardMenu(card: Card, x: number): MenuSpec {
    const tied = (card.links ?? []).map(id => cards.find(other => other.id === id)).filter((other): other is Card => !!other);
    const kindItems: MenuEntry[] = card.kind === 'note' ? [
      ...withNotebook ? [{ id: 'notebook', command: 'notes --open', label: t("Im Notizblock öffnen"), icon: 'note', run: () => window.dispatchEvent(new CustomEvent('journal:show-note', { detail: card.id })) } as MenuEntry] : [],
      { id: 'float', command: 'detach', label: t("Als schwebende Notiz öffnen"), icon: 'pin', run: () => void run(() => invoke('board_detach', { id: card.id })) },
      { id: 'mode', command: card.mode === 'ink' ? 'mode text' : 'mode ink', label: card.mode === 'ink' ? t("Als Text schreiben") : t("Handschriftlich schreiben"), icon: 'pencil', run: () => void patch(card.id, { mode: card.mode === 'ink' ? 'text' : 'ink' }) },
      { id: 'paper', command: 'color', label: t("Papierfarbe"), icon: 'pipette', items: paperNames.map(([paper, name]) => ({ id: `paper-${paper}`, command: paper, label: name, swatch: `paper-${paper}`, checked: (card.paper ?? 'yellow') === paper, run: () => void patch(card.id, { paper }) })) },
    ] : card.kind === 'image' ? [
      { id: 'open', command: 'open', label: t("Vergrößern"), icon: 'search', run: () => setOpen(card) },
      ...(pixelTheme ? [{ id: 'pixel', command: 'pixelate', label: t("Verpixelt zeigen"), icon: 'month', checked: !!card.pixel, run: () => void patch(card.id, { pixel: !card.pixel }) } as MenuItem] : []),
    ] : [
      { id: 'open', command: 'open', label: t("Link öffnen"), icon: 'jump', run: () => void run(() => invoke('board_open_link', { url: card.url })) },
      { id: 'copy', command: 'copy', label: t("Link kopieren"), icon: 'copy', run: () => void navigator.clipboard?.writeText(card.url ?? '') },
    ];
    return { title: titleOf(card), command: card.kind, items: [
      ...kindItems,
      '-',
      { id: 'tie', command: 'tie', positive: true, label: t("Verbinden mit …"), icon: 'jump', keys: 'Alt L', disabled: !others(card.id).length, run: () => startPicking(card) },
      ...(tied.length ? [{ id: 'untie', command: 'untie', label: t("Faden lösen"), icon: 'cancel', items: tied.map(other => ({ id: `untie-${other.id}`, command: other.kind, label: titleOf(other), icon: other.kind === 'note' ? 'note' : other.kind === 'image' ? 'layout' : 'jump', run: () => void run(() => disconnectCards(card.id, other.id)) })) } as MenuItem] : []),
      { id: 'front', command: 'raise', label: t("Nach vorne holen"), icon: 'up', disabled: (card.z ?? 0) >= topZ && visible.filter(other => (other.z ?? 0) === topZ).length === 1, run: () => void patch(card.id, { z: topZ + 1 }) },
      { id: 'size', command: 'resize --reset', label: t("Größe zurücksetzen"), icon: 'layout', disabled: !card.w && !card.h, run: () => void patch(card.id, { w: defaultWidth(card.kind), h: 0, boardX: x }) },
      '-',
      { id: 'remove', command: 'rm', label: t("Notiz und Pinnwand-Eintrag löschen"), icon: 'trash', danger: true, keys: undefined, run: () => takeDown(card) },
    ] };
  }
  const surfaceMenu = contextMenu(event => {
    if ((event.target as Element).closest('.board-card, .board-group-frame, .board-thread-hit')) return null;
    const viewport = viewportRef.current!, box = viewport.getBoundingClientRect(), ratio = viewport.clientWidth / box.width;
    const byPointer = event.button === 2;
    const here = byPointer ? { boardX: Math.round(((event.clientX - box.left) * ratio - pan.x) / scale), y: Math.round(((event.clientY - box.top) * ratio - pan.y) / scale) } : {};
    return { title: t("Pinnwand"), command: 'board', items: [
      { id: 'note', command: 'touch', positive: true, label: byPointer ? t("Neuer Zettel hier") : t("Neuer Zettel"), icon: 'pencil', disabled: busy, run: () => void run(() => add('note', here)) },
      { id: 'sketch', command: 'sketch', positive: true, label: byPointer ? t("Neue Skizze hier") : t("Neue Skizze"), icon: 'pencil', disabled: busy, run: () => void run(() => add('note', { ...here, ...sketch() })) },
      { id: 'image', command: 'upload', positive: true, label: t("Bild hochladen …"), icon: 'layout', disabled: busy, run: () => upload.current?.click() },
      { id: 'link', command: 'link', positive: true, label: t("Link anpinnen …"), icon: 'jump', disabled: busy, run: () => setLink('') },
      { id: 'existing', command: 'ls', label: t("Vorhandene Zettel …"), icon: 'search', run: () => setPicker(true) },
      '-',
      { id: 'view', command: 'zoom --reset', label: t("Ansicht zurücksetzen"), icon: 'month', disabled: zoom === 1 && !pan.x && !pan.y, run: () => { setZoom(1); setPan({ x: 0, y: 0 }); resizeReference.current = { ...viewportSize.current, scale: 1 }; } },
    ] };
  });
  const threadItems = (a: string, b: string): MenuSpec => {
    const first = cards.find(c => c.id === a), second = cards.find(c => c.id === b), kind = first && second ? threadKind(first, second) : null;
    const edge=directed.get([a,b].sort().join(':'));
    return { title: edge ? `${titleOf(cards.find(c=>c.id===edge[0]))} → ${titleOf(cards.find(c=>c.id===edge[1]))}` : `${titleOf(first)} ↔ ${titleOf(second)}`, command: 'thread', items: [
      ...(kind === 'page' ? [{ id:'reverse',command:'reverse',label:t("Richtung umkehren"),icon:'transfer',run:()=>void run(()=>patchCards(reversePagePatches(cards,a,b)),true) } as MenuItem] : []),
      '-',
      { id: 'cut', command: 'untie', label: t("Lösen"), icon: 'cancel', danger: true, run: () => void run(() => disconnectCards(a, b)) },
    ] };
  };

  const boardTitle = ({ day: t("Pinnwand"), week: t("Wochenpinnwand"), month: t("Monatspinnwand"), quarter: t("Quartalspinnwand"), year: t("Jahrespinnwand") })[period];
  const positions = Object.fromEntries(placed.map(({ card, x, y, z }) => [card.id, { boardX: x, y, z, w: widthOf(card), h: sizing?.id === card.id ? sizing.h : card.h }]));
  const boxes: Record<string, BoardBox> = useMemo(() => Object.fromEntries(placed.map(({ card, x, y }) => {
    const w = sizing?.id === card.id ? sizing.w : widthOf(card), h = sizing?.id === card.id ? sizing.h ?? heights[card.id] ?? 220 : heights[card.id] ?? 220;
    const angle = nebula || card.kind === 'note' ? 0 : tiltOf(card.id) * Math.PI / 180;
    const rotatedW = Math.abs(w * Math.cos(angle)) + Math.abs(h * Math.sin(angle)), rotatedH = Math.abs(h * Math.cos(angle)) + Math.abs(w * Math.sin(angle));
    return [card.id, { left: x + (w - rotatedW) / 2, top: y + (h - rotatedH) / 2, width: rotatedW, height: rotatedH }];
  })), [placed, sizing, heights, nebula]);
  const connectedGroups = useMemo(()=>cardGroups(cards),[cards]);
  const savedAt = useMemo(() => new Map(layout.map(item => [item.card.id, { x: item.x, y: item.y }])), [layout]);
  // Whether a card's copies are kept in sync with their original (per card; groups ask syncToggle).
  const syncOf = useMemo(() => copySyncStates(cards), [cards]);
  const groupByCard=useMemo(()=>new Map(connectedGroups.flatMap(group=>group.map(id=>[id,group] as const))),[connectedGroups]);
  const groups = useMemo(() => groupFrames(connectedGroups, boxes), [connectedGroups, boxes]);
  const membersOf = (ids: string[]) => connectedGroups.find(group => group.includes(ids[0])) ?? ids;
  const takeDownGroup = (ids: string[]) => void run(() => removeCards(membersOf(ids)), true);
  const nameGroup = (ids: string[], groupName: string) => void run(() => patchCards(Object.fromEntries(membersOf(ids).map(id => [id, { groupName }]))), true);
  const moveGroup = (ids: string[], dx: number, dy: number) => void run(() => patchCards(Object.fromEntries(laidOut.filter(item => membersOf(ids).includes(item.card.id)).map((item, index) => [item.card.id,
    scopedBoardPatch(cards.find(card => card.id === item.card.id), key, { boardX: item.x + dx, y: item.y + dy, z: topZ + 1 + index })]))), true);
  const groupMenu = (ids: string[]): MenuSpec => ({ title: t("Gruppe"), command: 'group', items: [
    { id: 'delete', command: 'rm', label: t("Alle Karten der Gruppe dauerhaft löschen"), icon: 'trash', danger: true, run: () => void run(() => removeCards(membersOf(ids)), true) },
  ] });
  const copiesOf = (ids: string[]) => {
    const selected = new Set(ids);
    return cards.filter(card => !!card.copyOf && (selected.has(card.id) || selected.has(card.copyOf)) && cards.some(source => source.id === card.copyOf));
  };
  const toggleSync = (ids: string[]) => {
    const copies = copiesOf(ids); if (!copies.length) return;
    const enabled = copies.every(card => card.copySync);
    void run(() => patchCards(copySyncPatches(cards, copies.map(card => card.id), !enabled, width, key)), true);
  };
  function syncToggle(ids: string[], group = false) {
    const copies = copiesOf(ids);
    if (!copies.length) return null;
    return <SyncToggle enabled={copies.every(card => card.copySync)} group={group} busy={busy} onToggle={() => toggleSync(ids)} />;
  }
  const groupedIds = new Set(groups.flatMap(group => group.ids));
  const cardActions = useStable<CardActions>({
    grab: (event, card, x, y) => grab(event, card, x, y),
    menu: (card, x) => cardMenu(card, x),
    edit: id => setEditing(id),
    blur: (event, id) => {
      if (event.currentTarget.contains(event.relatedTarget as Node)) return;
      setEditing(current => current === id ? null : current);
      if (picking?.from === id) setPicking(null);
    },
    key: (e, card, x, y) => {
      if (e.target !== e.currentTarget) return;
      if (pickKey(e, card)) return;
      if (card.kind === 'note' && card.mode === 'ink' && inkKey(e)) return;
      if (e.altKey && e.shiftKey) {
        const sizesBy: Record<string, [number, number]> = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
        if (sizesBy[e.key]) { e.preventDefault(); grow(card, x, ...sizesBy[e.key]); }
        return;
      }
      const step = e.shiftKey ? 40 : 8, moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (moves[e.key]) { e.preventDefault(); nudge(card, x, y, ...moves[e.key]); }
    },
    thread: (event, card) => startThread(event, card),
    resize: (event, card, x) => resize(event, card, x),
    patch: (id, changes) => patch(id, changes),
    tag: (id, anchor) => setTagging({ id, anchor }),
    run: (action, quiet) => void run(action, quiet),
    open: card => setOpen(card),
    takeDown: card => takeDown(card),
    toggleSync: ids => toggleSync(ids),
    positions: () => positions,
  });
  // Pan/zoom transforms the world without rebuilding its unchanged SVG geometry.
  const threadActions = useStable({ items: threadItems });
  const threadLayers = useMemo(() => <>
      {(boardThreads.length > 0 || drawing) && <svg className="board-threads" width={width} height={boardHeight} style={{ zIndex: topZ + 4 }} aria-label={t("Fäden")}>
        <defs>
          <clipPath id={threadMaskId} clipPathUnits="userSpaceOnUse">
            {placed.filter(({ card }) => card.id !== editing).map(({ card, x, y }) => {
              const w = sizing?.id === card.id ? sizing.w : widthOf(card);
              const h = sizing?.id === card.id ? sizing.h ?? heights[card.id] ?? 220 : heights[card.id] ?? 220;
              const angle = nebula || card.kind === 'note' ? 0 : tiltOf(card.id);
              return <rect key={card.id} data-thread-card={card.id} x={x} y={y} width={w} height={h}
                transform={angle ? `rotate(${angle} ${x + w / 2} ${y + h / 2})` : undefined} />;
            })}
          </clipPath>
        </defs>
        {threadShapes.map(({ a, b, from, to, path, arrow, label }) => {
          const openMenu = (element: Element) => setThreadMenu({ a, b, anchor: element as HTMLElement });
          const faded = { clipPath: `url(#${threadMaskId})`, opacity: .2 };
          return <g key={`${a}:${b}`} className={`board-thread-group${threadMenu?.a === a && threadMenu.b === b ? ' is-open' : ''}`} data-thread={`${a}:${b}`}>
            <path className="board-thread" d={path} {...faded} />
            {arrow && <path className="board-thread-direction" d={arrow} {...faded} aria-hidden="true" />}
            <circle className="board-thread-knot" cx={from.x} cy={from.y} r={2.4} {...faded} /><circle className="board-thread-knot" cx={to.x} cy={to.y} r={2.4} {...faded} />
            <path className="board-thread-hit" d={path} style={editing ? { pointerEvents: 'none' } : undefined} tabIndex={0} role="button" aria-label={label} onClick={e => openMenu(e.currentTarget)}
              onPointerEnter={() => setActiveThread(`${a}:${b}`)} onPointerLeave={() => setActiveThread(current => current === `${a}:${b}` ? null : current)}
              onFocus={() => setActiveThread(`${a}:${b}`)} onBlur={() => setActiveThread(current => current === `${a}:${b}` ? null : current)}
              onContextMenu={contextMenu(() => threadActions.items(a, b))}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(e.currentTarget); } }}><title>{label}</title></path>
          </g>;
        })}
        {drawing?.from && drawing.to && <path className="board-thread is-drawing" d={threadPath(drawing.from, drawing.to, pixelTheme, true)} clipPath={`url(#${threadMaskId})`} opacity={.2} />}
      </svg>}
      {(boardThreads.length > 0 || drawing) && <svg className="board-threads is-under" width={width} height={boardHeight} style={{ zIndex: 0 }} aria-hidden="true">
        {threadShapes.map(({ a, b, from, to, path, arrow }) => <g key={`${a}:${b}`} className={`board-thread-under${activeThread === `${a}:${b}` || (threadMenu?.a === a && threadMenu.b === b) ? ' is-active' : ''}`}>
          <path className="board-thread" d={path} />
          {arrow && <path className="board-thread-direction" d={arrow} />}
          <circle className="board-thread-knot" cx={from.x} cy={from.y} r={2.4} /><circle className="board-thread-knot" cx={to.x} cy={to.y} r={2.4} />
        </g>)}
        {drawing?.from && drawing.to && <path className="board-thread is-drawing" d={threadPath(drawing.from, drawing.to, pixelTheme, true)} />}
      </svg>}
  </>, [boardThreads, drawing, width, boardHeight, topZ, threadMaskId, placed, editing, sizing,
    heights, nebula, threadShapes, threadMenu, activeThread, pixelTheme, language, threadActions]);
  return <section className={`bulletin-board${pixelTheme ? ' is-pixel' : ''}`} data-board-key={key} aria-label={boardTitle} onKeyDown={e => { if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyN')) e.stopPropagation(); }}>
    {toolsSlot ? createPortal(<button type="button" className="board-add-menu" disabled={busy} aria-label={t("Anpinnen")} title={t("Zettel, Bild oder Link anpinnen · Rechtsklick auf die Fläche")} onClick={surfaceMenu}><span aria-hidden="true">+</span></button>, toolsSlot)
    : <div className="board-head">
      <div><h3>{boardTitle}</h3><p className="page-hint">{t("Zettel, Bilder und Links – frei anpinnen und verschieben.")}</p></div>
      <div className="board-actions" role="toolbar" aria-label={t("Hinzufügen")}>
        <button type="button" className="is-create" disabled={busy} onClick={() => void run(() => add('note'))} title={t("Neuer Zettel")}><Icon name="pencil" /><span>{t("Zettel")}</span></button>
        <button type="button" className="is-create" disabled={busy} onClick={() => void run(() => add('note', sketch()))} title={t("Neuer Zettel zum handschriftlichen Schreiben")}><Icon name="pencil" /><span>{t("Skizze")}</span></button>
        <button type="button" className="is-create" disabled={busy} onClick={() => upload.current?.click()} title={t("Bild hochladen (wird als AVIF komprimiert)")}><Icon name="layout" /><span>{t("Bild")}</span></button>
        <button type="button" className="is-create" disabled={busy} aria-expanded={link !== null} onClick={() => setLink(link === null ? '' : null)} title={t("Link anpinnen")}><Icon name="jump" /><span>{t("Link")}</span></button>
        <button type="button" disabled={busy} aria-expanded={picker} onClick={() => setPicker(!picker)} title={t("Zettel von anderen Tagen")}><Icon name="search" /><span>{t("Vorhandene")}</span></button>
      </div>
    </div>}
    <input ref={upload} type="file" accept="image/*" hidden onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; void run(async () => { await add('image', await storeImage(file)); });
    }} />
    {link !== null && <form className="board-link-form" onSubmit={e => { e.preventDefault(); void run(addLink); }}><Icon name="jump" /><input autoFocus type="url" required placeholder="https://…" aria-label="URL" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setLink(null); }} /><button disabled={busy}>{t("Anpinnen")}</button><button type="button" onClick={() => setLink(null)}>{t("Abbrechen")}</button></form>}
    {picker && <div className="board-library"><input autoFocus aria-label={t("Notizen suchen")} placeholder={t("Zettel suchen …")} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setPicker(false); }} />
      {libraryNotes(cards, key, query).map(c => {
        // Notes of the notebook carry their folder's path.
        const path = folderPath(folders, c.folder);
        const group = (groupByCard.get(c.id) ?? [c.id]).filter(id => { const other = cardsById.get(id); return other && copyableCard(other); });
        // Clicking the note makes an independent copy; the one extra action copies its whole group.
        return <div key={c.id} className={`board-library-row paper-${c.paper ?? 'yellow'}`}>
          <button type="button" className="board-library-pick" title={t("Als eigene Kopie anpinnen")} onClick={() => { void run(() => copyHere([c.id])); setPicker(false); }}>
            <strong>{c.title || t("Ohne Titel")}</strong>{path.length > 0 && <span className="board-library-path"><Icon name="layout" />{path.join(' / ')}</span>}<small>{c.text.slice(0, 80)}</small></button>
          {group.length > 1 && <span className="board-library-copy">
            <button type="button" title={t("Alle verbundenen Karten als Kopien anpinnen (Bilder bleiben beim Original)")} onClick={() => { void run(() => copyHere(group)); setPicker(false); }}><Icon name="copy" />{t("Gruppe kopieren")} ({group.length})</button>
          </span>}
        </div>;
      })}
      <p className="page-hint">{t("Anklicken erstellt eine eigene Kopie. Die Synchronisierung mit dem Original lässt sich danach einschalten.")}</p></div>}
    {hiddenByTag > 0 && <p className="board-hidden-hint" role="note"><span className="tag-dot is-empty" />{hiddenByTag === 1 ? t("1 Zettel ausgeblendet (Tag-Filter)") : t("{0} Zettel ausgeblendet (Tag-Filter)").replace('{0}', String(hiddenByTag))}</p>}
    {(processing || error || message) && <p role="status" className="board-status">{processing ? t("Wird verarbeitet …") : message || error}</p>}
    <div ref={viewportRef} className={`board-viewport board-surface${panning ? ' is-panning' : ''}${linking ? ' is-linking' : ''}`} onPointerDown={startPan} onContextMenu={surfaceMenu}
      style={{ height: Math.max(viewportHeight, Math.ceil(pan.y + boardHeight * scale)), '--board-scale': scale, '--board-pan-x': `${pan.x}px`, '--board-pan-y': `${pan.y}px` } as CSSProperties}>
    <div ref={boardRef} className={`board-world${linking ? ' is-linking' : ''}`} style={{ height: boardHeight, width, transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})` }}>
      {!visible.length && <p className="board-empty">{t("Noch leer.")}<span className="page-hint"> {t("Pinne einen Zettel, ein Bild oder einen Link an.")}</span></p>}
      {groups.map(group => <div key={group.ids.slice().sort().join(':')} className={`board-group-frame${groupDragging?.ids.includes(group.ids[0]) ? ' is-moving' : ''}`} data-board-group={group.ids.join(',')}
        role="group" tabIndex={0} aria-label={t("Gruppe")} style={{ left: group.left, top: group.top, width: group.width, height: group.height }}
        onContextMenu={contextMenu(() => groupMenu(group.ids))}
        onPointerDown={event => { const first = placed.find(item => item.card.id === group.ids[0]); if (first && !busy) grab(event, first.card, first.x, first.y, membersOf(group.ids).filter(id => laidOut.some(item => item.card.id === id))); }}
        onKeyDown={event => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'Escape' && groupDragging) { event.preventDefault(); cardDragCleanup.current?.(); setGroupDragging(null); return; }
          if (busy) return;
          const step = event.shiftKey ? 40 : 8, moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (moves[event.key]) { event.preventDefault(); moveGroup(group.ids, ...moves[event.key]); }
          else if (event.key === 'Delete') { event.preventDefault(); takeDownGroup(group.ids); }
        }}>
        {['top', 'right', 'bottom', 'left'].map(edge => <span key={edge} className={`board-group-edge is-${edge}`} aria-hidden="true" />)}
        <GroupName value={membersOf(group.ids).map(id => cards.find(card => card.id === id)?.groupName).find(Boolean) ?? ''} label={t("Gruppenname")} placeholder={t("Gruppe benennen …")} onSave={value => nameGroup(group.ids, value)} />
        <div className="board-group-actions">{syncToggle(group.ids, true)}<button type="button" className="board-group-remove" disabled={busy} aria-label={t("Gruppe löschen")} title={t("Gruppe und ihre Notizen löschen")} onClick={() => takeDownGroup(group.ids)}><Icon name="trash" /></button></div>
      </div>)}
      {placed.map(({ card, x, y, z }) => {
        const own = savedAt.get(card.id) ?? { x, y };
        return <BoardCard key={card.id} card={card} x={own.x} y={own.y} z={z} dx={x - own.x} dy={y - own.y}
          w={sizing?.id === card.id ? sizing.w : widthOf(card)} h={card.kind === 'note' ? (sizing?.id === card.id ? sizing.h : card.h || undefined) : undefined}
          moving={dragging?.id === card.id} sizing={sizing?.id === card.id} target={target === card.id} source={linking?.from === card.id || picking?.from === card.id}
          grouped={groupedIds.has(card.id)} sync={syncOf.get(card.id) ?? null} tag={card.kind === 'note' ? tagOf(allTags, card.tag) : null} tagOpen={tagging?.id === card.id}
          pixel={pixelTheme} busy={busy} date={date} boardKey={key} actions={cardActions} />;
      })}
      {/* Threads hang from pin to pin. Under the cards they are drawn in full; over the cards a second time, clipped to the
          cards' surfaces at a fifth of their strength: the cards fade every thread that crosses them (also unrelated ones),
          the card being edited hides them. (One luminance mask over the whole board did the same, but every move redrew it.)
          Only the line itself takes the pointer (a click opens its menu). */}
      {threadLayers}
    </div>
    </div>
    {tagging && <TagPicker anchor={tagging.anchor} value={cards.find(c => c.id === tagging.id)?.tag ?? null} onPick={id => void run(() => patch(tagging.id, { tag: id }))} onClose={() => setTagging(null)} />}
    {threadMenu && <Popover anchor={threadMenu.anchor} className="board-thread-menu" label={t("Faden")} onClose={() => setThreadMenu(null)}>
      {(() => { const first = cards.find(c => c.id === threadMenu.a), second = cards.find(c => c.id === threadMenu.b); const kind = first && second ? threadKind(first, second) : null;
        const edge=directed.get([threadMenu.a,threadMenu.b].sort().join(':'));
        return <><p>{edge?`${titleOf(cards.find(c=>c.id===edge[0]))} → ${titleOf(cards.find(c=>c.id===edge[1]))}`:`${titleOf(first)} ↔ ${titleOf(second)}`}<small>{kind === 'page' ? t("Reihenfolge im Notizblock") : kind === 'bundle' ? t("Bündel: hängt gemeinsam an einem Zettel") : t("Anhang im Notizblock")}</small></p>
          {kind === 'page' && <button type="button" className="board-thread-reverse" onClick={() => void run(() => patchCards(reversePagePatches(cards,threadMenu.a,threadMenu.b)),true)}><Icon name="transfer" />{t("Richtung umkehren")}</button>}</>; })()}
      <button type="button" className="board-thread-cut" onClick={() => { const { a, b } = threadMenu; setThreadMenu(null); void run(() => disconnectCards(a, b)); }}><Icon name="cancel" />{t("Lösen")}</button>
    </Popover>}
    {open && <Lightbox card={open} onClose={() => setOpen(null)} />}
  </section>;
});

export function FloatingNote() {
  const { cards, patch, error } = useCards(); useLanguage(); const [pinned, setPinned] = useState(true), [windowError, setWindowError] = useState('');
  const id = source.slice('board-'.length), card = cards.find(c => c.id === id);
  const action = (fn: () => Promise<unknown>) => void fn().catch(e => setWindowError(String(e)));
  // The whole paper moves the window, except where one types or presses (a strip at the pin, the margins, the header).
  const drag = (e: ReactPointerEvent<HTMLElement>) => { if (e.button === 0 && !(e.target as HTMLElement).closest('button, input, textarea, [contenteditable="true"], .cm-editor, .entry-text, .ink-canvas, .ink-toolbar')) { e.preventDefault(); action(() => getCurrentWindow().startDragging()); } };
  return <main className={`floating-note paper-${card?.paper ?? 'yellow'}`} onKeyDown={e => e.stopPropagation()} onPointerDown={drag}>
    <div className="floating-note-handle" data-tauri-drag-region title={t("Ziehen zum Verschieben")}><span className="board-pin" aria-hidden="true" /></div>
    <header>
      <input aria-label={t("Notiztitel")} value={card?.title ?? ''} onChange={e => void patch(id, { title: e.target.value })} disabled={!card} />
      {card && <NoteModeButton card={card} patch={patch} />}
      <button type="button" aria-pressed={pinned} title={t("Immer im Vordergrund")} onClick={() => action(async () => { await getCurrentWindow().setAlwaysOnTop(!pinned); setPinned(!pinned); })}><Icon name="pin" /></button>
      <button type="button" aria-label={t("Schließen")} onClick={() => action(async () => { await waitForCard(id); await getCurrentWindow().close(); })}><Icon name="done" /></button>
    </header>
    {card && <div className={`board-note${card.mode === 'ink' ? ' is-ink' : ''}`}><Note card={card} patch={patch} /></div>}
    {(error || windowError) && <p role="status">{error || windowError}</p>}
  </main>;
}
