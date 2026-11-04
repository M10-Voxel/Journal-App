import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { EntryText } from './EntryText';
import { Icon } from './Icon';
import { useLanguage } from '../i18n';
import type { Entry } from '../journal';
import './bulletinBoard.css';

// The board under the checklist: notes (small paper slips with Markdown), images (compressed to AVIF, as polaroids)
// and links (index cards with the page's title and preview) pinned anywhere on a cork surface. Cards are dragged by
// their paper, the last one touched lies on top; a note can come off the board as a floating window (board_detach).
// Positions: `x` as a share of the free width (so the board fits any window), `y` in pixels, `z` the stacking order.
type Paper = 'yellow' | 'blue' | 'green' | 'pink';
type Card = { id: string; kind: 'note' | 'image' | 'link'; title: string; text: string; dates: string[]; order: number; url?: string; image?: string; pixel?: boolean; asset?: string; size?: number;
  x?: number; y?: number; z?: number; paper?: Paper;
  /** Chosen size: width of every card, height of a note (images keep their proportions, links their content). */
  w?: number; h?: number };
const papers: Paper[] = ['yellow', 'blue', 'green', 'pink'];
const source = getCurrentWindow().label;
const queue = new Map<string, Promise<unknown>>();
export async function flushBoardData(){await Promise.all([...queue.values()]);}
const defaultWidth = (kind: Card['kind']) => kind === 'note' ? 232 : kind === 'image' ? 236 : 260;
const widthOf = (card: Card) => card.w ?? defaultWidth(card.kind);
const sizes = { minWidth: 160, maxWidth: 640, minHeight: 120, maxHeight: 900 };
/** A slight tilt of its own per card, like pinned paper. */
const tiltOf = (id: string) => ((parseInt(id.replace(/-/g, '').slice(0, 6), 16) % 7) - 3) * .6;

function useCards() {
  const [cards, setCards] = useState<Card[]>([]), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const stop = listen<{ card: Card; source: string }>('board:changed', e => { if (active && e.payload.source !== source) setCards(old => [...old.filter(c => c.id !== e.payload.card.id), e.payload.card]); });
    const refresh = () => invoke<Card[]>('board_list').then(value => { if (active) setCards(value ?? []); }).catch(e => setError(String(e)));
    void refresh();
    const restored = listen('history:restored', () => { void refresh(); });
    return () => { active = false; void stop.then(fn => fn()); void restored.then(fn => fn()); };
  }, []);
  function patch(id: string, changes: Partial<Card>) {
    setCards(old => { const exists = old.some(c => c.id === id); return exists ? old.map(c => c.id === id ? { ...c, ...changes } : c) : [...old, { ...changes, id } as Card]; });
    const pending = (queue.get(id) ?? Promise.resolve()).catch(() => {}).then(() => invoke('board_patch', { id, patch: changes, source }));
    queue.set(id, pending); void pending.catch(e => setError(String(e))); return pending;
  }
  return { cards, patch, error };
}
function usePixelTheme() {
  const [pixel, setPixel] = useState(document.documentElement.dataset.theme === 'pixel');
  useEffect(() => { const observer = new MutationObserver(() => setPixel(document.documentElement.dataset.theme === 'pixel')); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] }); return () => observer.disconnect(); }, []);
  return pixel;
}
function Note({ card, patch }: { card: Card; patch: (id: string, value: Partial<Card>) => unknown }) {
  const focus = useRef<string | null>(null);
  const entry: Entry = { id: card.id, kind: 'note', text: card.text, done: false, cancelled: false, priority: false };
  return <EntryText rich entry={entry} label={card.title} strike={null} focusEntryId={focus} onChange={text => patch(card.id, { text })} />;
}

/** Pixelated images are drawn small (48 cells on the long edge) and stretched in hard pixels. */
const pixelCells = 48;
function useImageUrl(card: Card) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; setFailed(false); if (card.asset) void invoke<string>('board_image_load', { id: card.asset }).then(src => { if (active) setUrl(src); }).catch(() => { if (active) setFailed(true); }); else setUrl(card.image ?? ''); return () => { active = false; }; }, [card.asset, card.image]);
  return { url, failed, setFailed };
}
function Pixelated({ url, label, cells = pixelCells }: { url: string; label: string; cells?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const image = new Image();
    image.onload = () => {
      const c = canvas.current; if (!c) return;
      const scale = Math.min(1, cells / Math.max(image.naturalWidth, image.naturalHeight));
      c.width = Math.max(1, Math.round(image.naturalWidth * scale)); c.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = c.getContext('2d'); if (!context) return;
      context.imageSmoothingEnabled = true; context.drawImage(image, 0, 0, c.width, c.height);
    };
    image.src = url;
  }, [url, cells]);
  return <canvas ref={canvas} aria-label={label} role="img" />;
}
function BoardImage({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const { url, failed, setFailed } = useImageUrl(card);
  const pixelTheme = usePixelTheme(), pixel = !!card.pixel && pixelTheme;
  if (failed) return <p className="board-image-missing" role="status">Bild konnte nicht geladen werden.</p>;
  if (!url) return <div className="board-image is-loading" />;
  return <button type="button" className={`board-image${pixel ? ' is-pixel' : ''}`} aria-label={`${card.title} groß öffnen`} onClick={onOpen}>
    {pixel ? <Pixelated url={url} label={card.title} /> : <img src={url} alt={card.title} loading="lazy" onError={() => setFailed(true)} />}
  </button>;
}
/** The image large, over everything; Escape, a click or the × close it. */
function Lightbox({ card, onClose }: { card: Card; onClose: () => void }) {
  const { url } = useImageUrl(card);
  const pixelTheme = usePixelTheme(), pixel = !!card.pixel && pixelTheme;
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  return createPortal(<div className={`board-lightbox${pixel ? ' is-pixel' : ''}`} role="dialog" aria-modal="true" aria-label={card.title} onClick={onClose}>
    <figure onClick={e => e.stopPropagation()}>
      {url && (pixel ? <Pixelated url={url} label={card.title} cells={pixelCells * 2} /> : <img src={url} alt={card.title} />)}
      <figcaption><span>{card.title}</span>{card.size ? <small>AVIF · {Math.round(card.size / 1024)} KB</small> : null}<button ref={closeRef} type="button" aria-label="Schließen" onClick={onClose}><Icon name="done" /></button></figcaption>
    </figure>
  </div>, document.body);
}
async function compress(file: File): Promise<ArrayBuffer> {
  const worker = new Worker(new URL('../boardImage.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('Bildkomprimierung hat zu lange gedauert.')); }, 120000);
    const done = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = e => { done(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result); };
    worker.onerror = e => { done(); reject(new Error(e.message)); }; worker.postMessage(file);
  });
}
const hostOf = (url?: string) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };

export function BulletinBoard({ date }: { date: string }) {
  const { cards, patch, error } = useCards(); const en = useLanguage() === 'en'; const tr = (de: string, enText: string) => en ? enText : de;
  const pixelTheme = usePixelTheme();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [picker, setPicker] = useState(false), [link, setLink] = useState<string | null>(null), [query, setQuery] = useState('');
  const [open, setOpen] = useState<Card | null>(null);
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
    await patch(id, { kind, title: kind === 'note' ? tr('Neue Notiz', 'New note') : '', text: '', dates: [date], order: Math.max(0, ...cards.map(c => c.order ?? 0)) + 1, z: topZ + 1, paper: papers[visible.length % papers.length], ...freeSpot(kind), ...extra });
    return id;
  }
  async function addLink() {
    const url = new URL(link ?? ''); if (url.protocol !== 'https:') throw new Error(tr('Bitte einen HTTPS-Link eingeben.', 'Please enter an HTTPS link.'));
    const id = await add('link', { title: url.hostname, url: url.href }); setLink(null);
    try {
      const html = await invoke<string>('board_link_preview', { url: url.href }); const doc = new DOMParser().parseFromString(html, 'text/html');
      const meta = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[property="${name}"],meta[name="${name}"]`)?.content;
      const title = meta('og:title') || doc.title || url.hostname; const description = meta('og:description') || meta('description') || '';
      const raw = meta('og:image'); const image = raw ? new URL(raw, url.href) : null;
      await patch(id, { title: title.trim().slice(0, 300), text: description.trim().slice(0, 1000), image: image?.protocol === 'https:' ? image.href : undefined });
    } catch { setMessage(tr('Link gespeichert. Diese Seite liefert keine erreichbare Vorschau.', 'Link saved. A preview is unavailable for this page.')); }
  }
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

  return <section className={`bulletin-board${pixelTheme ? ' is-pixel' : ''}`} aria-label={tr('Pinnwand', 'Pinboard')} onKeyDown={e => e.stopPropagation()}>
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
      const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; void run(async () => {
        if (file.size > 30_000_000) throw new Error(tr('Bitte ein Bild unter 30 MB wählen.', 'Choose an image below 30 MB.'));
        const result = await compress(file); const asset = crypto.randomUUID(); let binary = ''; for (const b of new Uint8Array(result)) binary += String.fromCharCode(b);
        await invoke('board_image_save', { id: asset, data: btoa(binary) }); await add('image', { title: file.name.replace(/\.[^.]+$/, ''), asset, size: result.byteLength });
      });
    }} />
    {link !== null && <form className="board-link-form" onSubmit={e => { e.preventDefault(); void run(addLink); }}><Icon name="jump" /><input autoFocus type="url" required placeholder="https://…" aria-label="URL" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setLink(null); }} /><button disabled={busy}>{tr('Anpinnen', 'Pin')}</button><button type="button" onClick={() => setLink(null)}>{tr('Abbrechen', 'Cancel')}</button></form>}
    {picker && <div className="board-library"><input autoFocus aria-label={tr('Notizen suchen', 'Search notes')} placeholder={tr('Zettel suchen …', 'Search notes …')} value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setPicker(false); }} />
      {cards.filter(c => c.kind === 'note' && !c.dates.includes(date) && (c.title + ' ' + c.text).toLowerCase().includes(query.toLowerCase())).map(c => <button type="button" key={c.id} className={`paper-${c.paper ?? 'yellow'}`} onClick={() => { void run(() => patch(c.id, { dates: [...c.dates, date], z: topZ + 1, ...freeSpot('note') })); setPicker(false); }}><strong>{c.title || tr('Ohne Titel', 'Untitled')}</strong><small>{c.text.slice(0, 80)}</small></button>)}
      <p className="page-hint">{tr('Zettel von anderen Tagen und abgenommene Zettel. Derselbe Zettel – Änderungen erscheinen überall.', 'Notes from other days and taken-down notes. The same note – edits show everywhere.')}</p></div>}
    {(busy || error || message) && <p role="status" className="board-status">{busy ? tr('Wird verarbeitet …', 'Working …') : message || error}</p>}
    <div ref={boardRef} className="board-surface" style={{ height: boardHeight }}>
      {!visible.length && <p className="board-empty">{tr('Noch leer.', 'Still empty.')}<span className="page-hint"> {tr('Pinne einen Zettel, ein Bild oder einen Link an.', 'Pin a note, an image or a link.')}</span></p>}
      {placed.map(({ card, x, y, z }) => <article key={card.id} data-board-id={card.id} tabIndex={0}
        className={`board-card is-${card.kind}${card.kind === 'note' ? ` paper-${card.paper ?? 'yellow'}` : ''}${dragging?.id === card.id ? ' is-moving' : ''}${sizing?.id === card.id ? ' is-sizing' : ''}${card.h ? ' has-height' : ''}`}
        style={{ left: x, top: y, zIndex: 1 + z, width: sizing?.id === card.id ? sizing.w : widthOf(card), height: card.kind === 'note' ? (sizing?.id === card.id ? sizing.h : card.h || undefined) : undefined, '--tilt': `${tiltOf(card.id)}deg` } as CSSProperties}
        aria-label={`${card.kind === 'note' ? tr('Zettel', 'Note') : card.kind === 'image' ? tr('Bild', 'Image') : 'Link'}: ${card.title}`}
        onPointerDown={e => grab(e, card, x, y)}
        onKeyDown={e => {
          if (e.target !== e.currentTarget) return;
          if (e.altKey && e.shiftKey) {
            const sizesBy: Record<string, [number, number]> = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] };
            if (sizesBy[e.key]) { e.preventDefault(); grow(card, x, ...sizesBy[e.key]); }
            return;
          }
          const step = e.shiftKey ? 40 : 8, moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
          if (moves[e.key]) { e.preventDefault(); nudge(card, x, y, ...moves[e.key]); }
        }}>
        <span className="board-pin" aria-hidden="true" />
        <span className="board-resize" aria-hidden="true" title={tr('Größe ändern · Doppelklick: zurücksetzen', 'Resize · double click: reset')}
          onPointerDown={e => resize(e, card, x)} onDoubleClick={e => { e.stopPropagation(); void patch(card.id, { w: defaultWidth(card.kind), h: 0 }); }} />
        <header>
          <input aria-label={tr('Titel', 'Title')} value={card.title} placeholder={tr('Titel', 'Title')} onChange={e => void patch(card.id, { title: e.target.value })} />
          <div className="board-tools">
            {card.kind === 'note' && <button type="button" className="board-paper" aria-label={tr('Papierfarbe', 'Paper colour')} title={tr('Papierfarbe', 'Paper colour')} onClick={() => void patch(card.id, { paper: papers[(papers.indexOf(card.paper ?? 'yellow') + 1) % papers.length] })}><i /></button>}
            {card.kind === 'image' && pixelTheme && <button type="button" className="board-pixel-switch" aria-pressed={!!card.pixel} title={card.pixel ? tr('Normal zeigen', 'Show normal') : tr('Verpixelt zeigen', 'Show pixelated')} onClick={() => void patch(card.id, { pixel: !card.pixel })}><Icon name="month" /></button>}
            {card.kind === 'note' && <button type="button" className="board-detach" title={tr('Als schwebende Notiz öffnen', 'Open floating note')} aria-label={tr('Als schwebende Notiz öffnen', 'Open floating note')} onClick={() => void run(() => invoke('board_detach', { id: card.id }))}><Icon name="pin" /></button>}
            <button type="button" className="board-remove" title={tr('Abnehmen (Zettel bleiben unter „Vorhandene“)', 'Take down (notes stay under “Existing”)')} aria-label={tr('Abnehmen', 'Take down')} onClick={() => void run(() => patch(card.id, { dates: card.dates.filter(d => d !== date) }))}><Icon name="trash" /></button>
          </div>
        </header>
        {card.kind === 'note' ? <div className="board-note"><Note card={card} patch={patch} /></div>
          : card.kind === 'image' ? <><BoardImage card={card} onOpen={() => setOpen(card)} /><div className="board-caption"><small>AVIF · {Math.round((card.size ?? 0) / 1024)} KB</small></div></>
          : <button type="button" className="board-link" onClick={() => void run(() => invoke('board_open_link', { url: card.url }))}>
            {card.image && <img src={card.image} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />}
            <strong>{card.title}</strong>{card.text && <span>{card.text}</span>}<small><Icon name="jump" />{hostOf(card.url)}</small>
          </button>}
      </article>)}
    </div>
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
      <button type="button" aria-label={en ? 'Close' : 'Schließen'} onClick={() => action(async () => { await (queue.get(id) ?? Promise.resolve()); await getCurrentWindow().close(); })}><Icon name="done" /></button>
    </header>
    {card && <div className="board-note"><Note card={card} patch={patch} /></div>}
    {(error || windowError) && <p role="status">{error || windowError}</p>}
  </main>;
}
