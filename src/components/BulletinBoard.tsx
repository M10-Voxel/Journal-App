import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { useLanguage } from '../i18n';
import { BoardImage, Lightbox, Note, connectCards, disconnectCards, hostOf, httpsLink, linkPreview, nextOrder, source, storeImage, useCards, useFolders, usePixelTheme, waitForCard } from '../boardCards';
import type { Card, Paper } from '../boardCards';
import { folderPath, threadKind, threads } from '../notebook';
import './bulletinBoard.css';
export { flushBoardData } from '../boardCards';

// The board under the checklist: notes (small paper slips with Markdown), images (compressed to AVIF, as polaroids)
// and links (index cards with the page's title and preview) pinned anywhere on a cork surface. Cards are dragged by
// their paper, the last one touched lies on top; a note can come off the board as a floating window (board_detach).
// Positions: `x` as a share of the free width (so the board fits any window), `y` in pixels, `z` the stacking order.
// A card's pin is a handle: drawn to another card it ties both with a thread (an image or link becomes an attachment of
// the note, two notes pages of each other in the notebook). Threads hang from pin to pin and follow the cards.
const papers: Paper[] = ['yellow', 'blue', 'green', 'pink'];
const defaultWidth = (kind: Card['kind']) => kind === 'note' ? 232 : kind === 'image' ? 236 : 260;
const widthOf = (card: Card) => card.w ?? defaultWidth(card.kind);
const sizes = { minWidth: 160, maxWidth: 640, minHeight: 120, maxHeight: 900 };
/** A slight tilt of its own per card, like pinned paper. */
const tiltOf = (id: string) => ((parseInt(id.replace(/-/g, '').slice(0, 6), 16) % 7) - 3) * .6;
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

export function BulletinBoard({ date }: { date: string }) {
  const { cards, patch, error } = useCards(); const en = useLanguage() === 'en'; const tr = (de: string, enText: string) => en ? enText : de;
  const pixelTheme = usePixelTheme();
  const { folders } = useFolders();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [picker, setPicker] = useState(false), [link, setLink] = useState<string | null>(null), [query, setQuery] = useState('');
  const [open, setOpen] = useState<Card | null>(null);
  // A thread being drawn from a pin (to the pointer, or by keys to the card picked with the arrows), and an open thread's menu.
  const [linking, setLinking] = useState<{ from: string; x: number; y: number; over: string | null } | null>(null);
  const [picking, setPicking] = useState<{ from: string; index: number } | null>(null);
  const [threadMenu, setThreadMenu] = useState<{ a: string; b: string; anchor: HTMLElement } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; x: number; y: number } | null>(null);
  const [sizing, setSizing] = useState<{ id: string; w: number; h?: number } | null>(null);
  const [width, setWidth] = useState(640), [heights, setHeights] = useState<Record<string, number>>({});
  const upload = useRef<HTMLInputElement>(null), boardRef = useRef<HTMLDivElement>(null);
  const visible = cards.filter(c => c.dates?.includes(date)).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const topZ = Math.max(0, ...visible.map(c => c.z ?? 0));
  // Cards pinned before positions existed (or new ones) are laid out in a loose grid.
  const columns = Math.max(1, Math.floor((width + 24) / 264));
  const placed = visible.map((card, index) => {
    const free = Math.max(0, width - widthOf(card) - 16);
    const auto = { x: columns > 1 ? (index % columns) / (columns - 1) : 0, y: 18 + Math.floor(index / columns) * 250 };
    const x = dragging?.id === card.id ? dragging.x : Math.round(8 + (card.x ?? auto.x) * free);
    const y = dragging?.id === card.id ? dragging.y : card.y ?? auto.y;
    return { card, x, y, z: dragging?.id === card.id ? topZ + 1 : card.z ?? 0 };
  });
  const boardHeight = Math.max(380, ...placed.map(p => p.y + (heights[p.card.id] ?? 220) + 36));
  useLayoutEffect(() => {
    const board = boardRef.current; if (!board) return;
    const measure = () => {
      setWidth(board.clientWidth);
      const next: Record<string, number> = {};
      board.querySelectorAll<HTMLElement>('.board-card').forEach(el => { next[el.dataset.boardId!] = el.offsetHeight; });
      setHeights(old => Object.keys(next).length === Object.keys(old).length && Object.entries(next).every(([k, v]) => old[k] === v) ? old : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(board);
    board.querySelectorAll('.board-card').forEach(el => observer.observe(el));
    return () => observer.disconnect();
  }, [visible.length, cards]);

  async function run(action: () => Promise<unknown>) { setBusy(true); setMessage(''); try { await action(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } }
  // A new card lands in the first free place from the top left.
  function freeSpot(kind: Card['kind']) {
    const w = kind === 'note' ? 232 : kind === 'image' ? 236 : 260;
    for (let row = 0; row < 40; row++) for (let col = 0; col < columns; col++) {
      const share = columns > 1 ? col / (columns - 1) : 0, x = 8 + share * Math.max(0, width - w - 16), y = 18 + row * 120;
      if (!placed.some(p => x < p.x + widthOf(p.card) + 12 && x + w + 12 > p.x && y < p.y + (heights[p.card.id] ?? 220) + 12 && y + 200 > p.y))
        return { x: share, y };
    }
    return { x: 0, y: boardHeight - 20 };
  }
  async function add(kind: Card['kind'], extra: Partial<Card> = {}) {
    const id = crypto.randomUUID();
    await patch(id, { kind, title: kind === 'note' ? tr('Neue Notiz', 'New note') : '', text: '', dates: [date], created: date, order: nextOrder(cards), z: topZ + 1, paper: papers[visible.length % papers.length], ...freeSpot(kind), ...extra });
    return id;
  }
  async function addLink() {
    const url = httpsLink(link ?? '');
    const id = await add('link', { title: url.hostname, url: url.href }); setLink(null);
    try { await patch(id, await linkPreview(url)); }
    catch { setMessage(tr('Link gespeichert. Diese Seite liefert keine erreichbare Vorschau.', 'Link saved. A preview is unavailable for this page.')); }
  }

  // Threads: where a card's pin is (the top middle of the card, turned with it).
  const nebula = document.documentElement.dataset.theme === 'nebula';
  const pinOf = (id: string): Point | null => {
    const at = placed.find(p => p.card.id === id); if (!at) return null;
    const w = sizing?.id === id ? sizing.w : widthOf(at.card), h = heights[id] ?? 200, tilt = nebula || at.card.kind === 'note' ? 0 : tiltOf(id) * Math.PI / 180;
    return { x: at.x + w / 2 + h / 2 * Math.sin(tilt), y: at.y + h / 2 - h / 2 * Math.cos(tilt) + 1 };
  };
  const shown = new Set(visible.map(c => c.id));
  const boardThreads = threads(cards).filter(([a, b]) => shown.has(a) && shown.has(b));
  const titleOf = (card?: Card) => card?.title || (card?.kind === 'note' ? tr('Ohne Titel', 'Untitled') : card?.kind === 'image' ? tr('Bild', 'Image') : 'Link');
  /** Ties two cards and says what came of it (an attachment or another page in the notebook). */
  function tie(a: string, b: string) {
    const first = cards.find(c => c.id === a), second = cards.find(c => c.id === b);
    if (!first || !second) return;
    const kind = threadKind(first, second);
    if (!kind) { setMessage(tr('Bilder und Links lassen sich nur mit einem Zettel verbinden.', 'Images and links can only be tied to a note.')); return; }
    const done = connectCards(a, b);
    if (!done) { setMessage(tr('Schon verbunden.', 'Already tied.')); return; }
    setMessage(kind === 'page' ? tr('Verbunden · Seite: Die Zettel sind im Notizblock Seiten voneinander.', 'Tied · Page: the notes are pages of each other in the notebook.')
      : tr('Verbunden · Anhang: Im Notizblock hängt es am Zettel.', 'Tied · Attachment: it hangs on the note in the notebook.'));
    void done.catch(e => setMessage(String(e)));
  }
  // Drawing from a pin: a taut thread follows the pointer; let go on a card, they are tied.
  function startThread(event: ReactPointerEvent<HTMLElement>, card: Card) {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    const element = event.currentTarget, surface = boardRef.current!.getBoundingClientRect();
    element.setPointerCapture(event.pointerId);
    const at = (e: PointerEvent | ReactPointerEvent) => ({ x: e.clientX - surface.left, y: e.clientY - surface.top });
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
      if (!others(card.id).length) { setMessage(tr('Für einen Faden braucht es eine zweite Karte.', 'A thread needs a second card.')); return true; }
      setPicking({ from: card.id, index: 0 });
      setMessage(tr('Faden: Karte mit den Pfeiltasten wählen, Enter verbindet, Esc bricht ab.', 'Thread: pick a card with the arrow keys, Enter ties, Esc cancels.'));
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
  // Dragging a card by its paper (not by its text, buttons or image); it comes to the top and stays where it is let go.
  function grab(event: ReactPointerEvent<HTMLElement>, card: Card, x: number, y: number) {
    if (event.button !== 0 || (event.target as Element).closest('input, textarea, button, a, [contenteditable="true"], .cm-editor, .entry-text, .board-image')) return;
    event.preventDefault();
    const element = event.currentTarget; element.setPointerCapture(event.pointerId);
    const start = { px: event.clientX, py: event.clientY, x, y };
    let last = { x, y }, moved = false;
    const move = (e: PointerEvent) => {
      const free = Math.max(0, width - widthOf(card) - 16);
      last = { x: Math.max(8, Math.min(8 + free, start.x + e.clientX - start.px)), y: Math.max(4, start.y + e.clientY - start.py) };
      moved ||= Math.hypot(e.clientX - start.px, e.clientY - start.py) > 3;
      setDragging({ id: card.id, ...last });
    };
    const end = () => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end);
      setDragging(null);
      const free = Math.max(1, width - widthOf(card) - 16);
      void patch(card.id, moved ? { x: Math.max(0, Math.min(1, (last.x - 8) / free)), y: Math.round(last.y), z: topZ + 1 } : { z: topZ + 1 });
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end);
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
      const w = Math.round(Math.max(sizes.minWidth, Math.min(sizes.maxWidth, width - x - 8, start.w + e.clientX - start.px)));
      last = { w, h: card.kind === 'note' ? Math.round(Math.max(sizes.minHeight, Math.min(sizes.maxHeight, start.h + e.clientY - start.py))) : undefined };
      setSizing({ id: card.id, ...last });
    };
    const end = () => {
      element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end);
      setSizing(null);
      const free = Math.max(1, width - last.w - 16);
      void patch(card.id, { w: last.w, ...last.h ? { h: last.h } : {}, x: Math.max(0, Math.min(1, (x - 8) / free)), z: topZ + 1 });
    };
    element.addEventListener('pointermove', move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end);
  }
  function grow(card: Card, x: number, dw: number, dh: number) {
    const w = Math.max(sizes.minWidth, Math.min(sizes.maxWidth, width - 16, widthOf(card) + dw));
    const h = card.kind === 'note' && dh ? Math.max(sizes.minHeight, Math.min(sizes.maxHeight, (card.h ?? heights[card.id] ?? 200) + dh)) : card.h;
    const free = Math.max(1, width - w - 16);
    void patch(card.id, { w, ...h ? { h } : {}, x: Math.max(0, Math.min(1, (Math.min(x, width - w - 8) - 8) / free)) });
  }
  // Arrow keys move the focused card (Shift: further).
  function nudge(card: Card, x: number, y: number, dx: number, dy: number) {
    const free = Math.max(1, width - widthOf(card) - 16);
    void patch(card.id, { x: Math.max(0, Math.min(1, (x + dx - 8) / free)), y: Math.max(4, Math.round(y + dy)), z: topZ + 1 });
  }

  return <section className={`bulletin-board${pixelTheme ? ' is-pixel' : ''}`} aria-label={tr('Pinnwand', 'Pinboard')} onKeyDown={e => { if (!(e.ctrlKey && e.shiftKey && e.code === 'KeyN')) e.stopPropagation(); }}>
    <div className="board-head">
      <div><h3>{tr('Pinnwand', 'Pinboard')}</h3><p className="page-hint">{tr('Zettel, Bilder und Links – frei anpinnen und verschieben.', 'Notes, images and links – pin and move them freely.')}</p></div>
      <div className="board-actions" role="toolbar" aria-label={tr('Hinzufügen', 'Add')}>
        <button type="button" disabled={busy} onClick={() => void run(() => add('note'))} title={tr('Neuer Zettel', 'New note')}><Icon name="pencil" /><span>{tr('Zettel', 'Note')}</span></button>
        <button type="button" disabled={busy} onClick={() => upload.current?.click()} title={tr('Bild hochladen (wird als AVIF komprimiert)', 'Upload image (compressed to AVIF)')}><Icon name="layout" /><span>{tr('Bild', 'Image')}</span></button>
        <button type="button" disabled={busy} aria-expanded={link !== null} onClick={() => setLink(link === null ? '' : null)} title={tr('Link anpinnen', 'Pin a link')}><Icon name="jump" /><span>{tr('Link', 'Link')}</span></button>
        <button type="button" disabled={busy} aria-expanded={picker} onClick={() => setPicker(!picker)} title={tr('Zettel von anderen Tagen', 'Notes from other days')}><Icon name="search" /><span>{tr('Vorhandene', 'Existing')}</span></button>
      </div>
    </div>
    <input ref={upload} type="file" accept="image/*" hidden onChange={e => {
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; void run(async () => { await add('image', await storeImage(file)); });
    }} />
    {link !== null && <form className="board-link-form" onSubmit={e => { e.preventDefault(); void run(addLink); }}><Icon name="jump" /><input autoFocus type="url" required placeholder="https://…" aria-label="URL" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setLink(null); }} /><button disabled={busy}>{tr('Anpinnen', 'Pin')}</button><button type="button" onClick={() => setLink(null)}>{tr('Abbrechen', 'Cancel')}</button></form>}
    {picker && <div className="board-library"><input autoFocus aria-label={tr('Notizen suchen', 'Search notes')} placeholder={tr('Zettel suchen …', 'Search notes …')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setPicker(false); }} />
      {cards.filter(c => c.kind === 'note' && !c.dates.includes(date) && (c.title + ' ' + c.text).toLowerCase().includes(query.toLowerCase())).map(c => {
        // Notes of the notebook carry their folder's path.
        const path = folderPath(folders, c.folder);
        return <button type="button" key={c.id} className={`paper-${c.paper ?? 'yellow'}`} onClick={() => { void run(() => patch(c.id, { dates: [...c.dates, date], z: topZ + 1, ...freeSpot('note') })); setPicker(false); }}>
          <strong>{c.title || tr('Ohne Titel', 'Untitled')}</strong>{path.length > 0 && <span className="board-library-path"><Icon name="layout" />{path.join(' / ')}</span>}<small>{c.text.slice(0, 80)}</small></button>;
      })}
      <p className="page-hint">{tr('Zettel von anderen Tagen und abgenommene Zettel. Derselbe Zettel – Änderungen erscheinen überall.', 'Notes from other days and taken-down notes. The same note – edits show everywhere.')}</p></div>}
    {(busy || error || message) && <p role="status" className="board-status">{busy ? tr('Wird verarbeitet …', 'Working …') : message || error}</p>}
    <div ref={boardRef} className={`board-surface${linking ? ' is-linking' : ''}`} style={{ height: boardHeight }}>
      {!visible.length && <p className="board-empty">{tr('Noch leer.', 'Still empty.')}<span className="page-hint"> {tr('Pinne einen Zettel, ein Bild oder einen Link an.', 'Pin a note, an image or a link.')}</span></p>}
      {placed.map(({ card, x, y, z }) => <article key={card.id} data-board-id={card.id} tabIndex={0}
        className={`board-card is-${card.kind}${card.kind === 'note' ? ` paper-${card.paper ?? 'yellow'}` : ''}${dragging?.id === card.id ? ' is-moving' : ''}${sizing?.id === card.id ? ' is-sizing' : ''}${card.h ? ' has-height' : ''}${target === card.id ? ' is-link-target' : ''}${linking?.from === card.id || picking?.from === card.id ? ' is-link-source' : ''}`}
        style={{ left: x, top: y, zIndex: 1 + z, width: sizing?.id === card.id ? sizing.w : widthOf(card), height: card.kind === 'note' ? (sizing?.id === card.id ? sizing.h : card.h || undefined) : undefined, '--tilt': `${tiltOf(card.id)}deg` } as CSSProperties}
        aria-label={`${card.kind === 'note' ? tr('Zettel', 'Note') : card.kind === 'image' ? tr('Bild', 'Image') : 'Link'}: ${card.title}`}
        onPointerDown={e => grab(e, card, x, y)}
        onBlur={e => { if (picking?.from === card.id && !e.currentTarget.contains(e.relatedTarget as Node)) setPicking(null); }}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (pickKey(e, card)) return;
          if (e.altKey && e.shiftKey) {
            const sizesBy: Record<string, [number, number]> = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
            if (sizesBy[e.key]) { e.preventDefault(); grow(card, x, ...sizesBy[e.key]); }
            return;
          }
          const step = e.shiftKey ? 40 : 8, moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (moves[e.key]) { e.preventDefault(); nudge(card, x, y, ...moves[e.key]); }
        }}>
        <span className="board-pin" aria-hidden="true" title={tr('Zu einer anderen Karte ziehen: verbinden · Alt L', 'Drag to another card: tie · Alt L')} onPointerDown={e => startThread(e, card)} />
        <span className="board-resize" aria-hidden="true" title={tr('Größe ändern · Doppelklick: zurücksetzen', 'Resize · double click: reset')}
          onPointerDown={e => resize(e, card, x)} onDoubleClick={e => { e.stopPropagation(); void patch(card.id, { w: defaultWidth(card.kind), h: 0 }); }} />
        <header>
          <input aria-label={tr('Titel', 'Title')} value={card.title} placeholder={tr('Titel', 'Title')} onChange={e => void patch(card.id, { title: e.target.value })} />
          <div className="board-tools">
            {card.kind === 'note' && <button type="button" className="board-paper" aria-label={tr('Papierfarbe', 'Paper colour')} title={tr('Papierfarbe', 'Paper colour')} onClick={() => void patch(card.id, { paper: papers[(papers.indexOf(card.paper ?? 'yellow') + 1) % papers.length] })}><i /></button>}
            {card.kind === 'image' && pixelTheme && <button type="button" className="board-pixel-switch" aria-pressed={!!card.pixel} title={card.pixel ? tr('Normal zeigen', 'Show normal') : tr('Verpixelt zeigen', 'Show pixelated')} onClick={() => void patch(card.id, { pixel: !card.pixel })}><Icon name="month" /></button>}
            {card.kind === 'note' && <button type="button" className="board-detach" title={tr('Als schwebende Notiz öffnen', 'Open floating note')} aria-label={tr('Als schwebende Notiz öffnen', 'Open floating note')} onClick={() => void run(() => invoke('board_detach', { id: card.id }))}><Icon name="pin" /></button>}
            <button type="button" className="board-remove" title={tr('Abnehmen (Zettel bleiben unter „Vorhandene“)', 'Take down (notes stay under “Existing”)')} aria-label={tr('Abnehmen', 'Take down')} onClick={() => { const dates = card.dates.filter(d => d !== date); void run(() => patch(card.id, { dates, ...card.onDay && !dates.length ? { onDay: false } : {} })); }}><Icon name="trash" /></button>
          </div>
        </header>
        {card.kind === 'note' ? <div className="board-note"><Note card={card} patch={patch} /></div>
          : card.kind === 'image' ? <><BoardImage card={card} onOpen={() => setOpen(card)} /><div className="board-caption"><small>AVIF · {Math.round((card.size ?? 0) / 1024)} KB</small></div></>
          : <button type="button" className="board-link" onClick={() => void run(() => invoke('board_open_link', { url: card.url }))}>
            {card.image && <img src={card.image} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            <strong>{card.title}</strong>{card.text && <span>{card.text}</span>}<small><Icon name="jump" />{hostOf(card.url)}</small>
          </button>}
      </article>)}
      {/* Threads hang over the cards from pin to pin; only the line itself takes the pointer (a click opens its menu). */}
      {(boardThreads.length > 0 || drawing) && <svg className="board-threads" width={width} height={boardHeight} style={{ zIndex: topZ + 4 }} aria-label={tr('Fäden', 'Threads')}>
        {boardThreads.map(([a, b]) => {
          const from = pinOf(a), to = pinOf(b); if (!from || !to) return null;
          const path = threadPath(from, to, pixelTheme), first = cards.find(c => c.id === a), second = cards.find(c => c.id === b);
          const label = `${tr('Faden', 'Thread')}: ${titleOf(first)} – ${titleOf(second)}`;
          const openMenu = (element: Element) => setThreadMenu({ a, b, anchor: element as HTMLElement });
          return <g key={`${a}:${b}`} className={`board-thread-group${threadMenu?.a === a && threadMenu.b === b ? ' is-open' : ''}`} data-thread={`${a}:${b}`}>
            <path className="board-thread" d={path} />
            <circle className="board-thread-knot" cx={from.x} cy={from.y} r={2.4} /><circle className="board-thread-knot" cx={to.x} cy={to.y} r={2.4} />
            <path className="board-thread-hit" d={path} tabIndex={0} role="button" aria-label={label} onClick={e => openMenu(e.currentTarget)}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMenu(e.currentTarget); } }}><title>{label}</title></path>
          </g>;
        })}
        {drawing?.from && drawing.to && <path className="board-thread is-drawing" d={threadPath(drawing.from, drawing.to, pixelTheme, true)} />}
      </svg>}
    </div>
    {threadMenu && <Popover anchor={threadMenu.anchor} className="board-thread-menu" label={tr('Faden', 'Thread')} onClose={() => setThreadMenu(null)}>
      {(() => { const first = cards.find(c => c.id === threadMenu.a), second = cards.find(c => c.id === threadMenu.b); const kind = first && second ? threadKind(first, second) : null;
        return <p>{titleOf(first)} ↔ {titleOf(second)}<small>{kind === 'page' ? tr('Seite im Notizblock', 'Page in the notebook') : tr('Anhang im Notizblock', 'Attachment in the notebook')}</small></p>; })()}
      <button type="button" className="board-thread-cut" onClick={() => { const { a, b } = threadMenu; setThreadMenu(null); void run(() => disconnectCards(a, b)); }}><Icon name="cancel" />{tr('Lösen', 'Untie')}</button>
    </Popover>}
    {open && <Lightbox card={open} onClose={() => setOpen(null)} />}
  </section>;
}

export function FloatingNote() {
  const { cards, patch, error } = useCards(); const en = useLanguage() === 'en'; const [pinned, setPinned] = useState(true), [windowError, setWindowError] = useState('');
  const id = source.slice('board-'.length), card = cards.find(c => c.id === id);
  const action = (fn: () => Promise<unknown>) => void fn().catch(e => setWindowError(String(e)));
  // The whole paper moves the window, except where one types or presses (a strip at the pin, the margins, the header).
  const drag = (e: ReactPointerEvent<HTMLElement>) => { if (e.button === 0 && !(e.target as HTMLElement).closest('button, input, textarea, [contenteditable="true"], .cm-editor, .entry-text')) { e.preventDefault(); action(() => getCurrentWindow().startDragging()); } };
  return <main className={`floating-note paper-${card?.paper ?? 'yellow'}`} onKeyDown={e => e.stopPropagation()} onPointerDown={drag}>
    <div className="floating-note-handle" data-tauri-drag-region title={en ? 'Drag to move' : 'Ziehen zum Verschieben'}><span className="board-pin" aria-hidden="true" /></div>
    <header>
      <input aria-label={en ? 'Note title' : 'Notiztitel'} value={card?.title ?? ''} onChange={e => void patch(id, { title: e.target.value })} disabled={!card} />
      <button type="button" aria-pressed={pinned} title={en ? 'Always on top' : 'Immer im Vordergrund'} onClick={() => action(async () => { await getCurrentWindow().setAlwaysOnTop(!pinned); setPinned(!pinned); })}><Icon name="pin" /></button>
      <button type="button" aria-label={en ? 'Close' : 'Schließen'} onClick={() => action(async () => { await waitForCard(id); await getCurrentWindow().close(); })}><Icon name="done" /></button>
    </header>
    {card && <div className="board-note"><Note card={card} patch={patch} /></div>}
    {(error || windowError) && <p role="status">{error || windowError}</p>}
  </main>;
}
