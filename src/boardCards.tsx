import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { EntryText } from './components/EntryText';
import { Icon } from './components/Icon';
import { InkCanvas } from './components/InkCanvas';
import { t } from './i18n';
import type { Entry } from './journal';
import { connectPatches, disconnectPatches, removalIds } from './notebook';
import type { Card, Folder, Patches } from './notebook';
import { encodeBase64 } from './base64';
import { syncPatches } from './boardSync';
export type { Card, Folder, Paper } from './notebook';

// What the pinboard and the notebook share: the cards (one store per window, so a board and a notebook open side by side
// show every edit at once), the folders, images (compressed to AVIF), link previews and the note editor. Other windows
// hear about changes through the backend's events (`board:changed`, `board:removed`, `board:folders`).

export const source = getCurrentWindow().label;
const queue = new Map<string, Promise<unknown>>();
export async function flushBoardData() { while (queue.size) await Promise.all([...queue.values()]); }
export const waitForCard = (id: string) => queue.get(id) ?? Promise.resolve();
function enqueue(keys: string[], action: () => Promise<unknown>) {
  const pending = Promise.all([...new Set(keys.map(key => queue.get(key)).filter(Boolean))].map(task => task!.catch(() => {}))).then(action);
  for (const key of keys) queue.set(key, pending);
  void pending.then(() => { for (const key of keys) if (queue.get(key) === pending) queue.delete(key); }, () => {});
  return pending;
}

type Store<T> = { value: T; error: string; listeners: Set<() => void>; started: boolean };
const cardStore: Store<Card[]> = { value: [], error: '', listeners: new Set(), started: false };
const folderStore: Store<Folder[]> = { value: [], error: '', listeners: new Set(), started: false };
function set<T>(store: Store<T>, change: (value: T) => T) { store.value = change(store.value); for (const listener of [...store.listeners]) listener(); }
function fail<T>(store: Store<T>, error: unknown) { store.error = String(error); set(store, value => Array.isArray(value) ? [...value] as T : value); }

function startCards() {
  if (cardStore.started) return;
  cardStore.started = true;
  const refresh = () => invoke<Card[]>('board_list').then(value => set(cardStore, () => value ?? [])).catch(e => fail(cardStore, e));
  void refresh();
  void listen<{ card: Card; source: string }>('board:changed', e => { if (e.payload.source !== source) set(cardStore, old => [...old.filter(c => c.id !== e.payload.card.id), e.payload.card]); });
  void listen<{ id: string; source: string }>('board:removed', e => { if (e.payload.source !== source) set(cardStore, old => old.filter(c => c.id !== e.payload.id)); });
  void listen('history:restored', () => { void refresh(); void refreshFolders(); });
  void listen('board:reset', () => { void refresh(); void refreshFolders(); });
}
const refreshFolders = () => invoke<Folder[]>('board_folders').then(value => set(folderStore, () => value ?? [])).catch(e => fail(folderStore, e));
function startFolders() {
  if (folderStore.started) return;
  folderStore.started = true;
  void refreshFolders();
  void listen('board:folders', () => { void refreshFolders(); });
}
function subscribe<T>(store: Store<T>, start: () => void) {
  return (listener: () => void) => { start(); store.listeners.add(listener); return () => { store.listeners.delete(listener); }; };
}
const subscribeCards = subscribe(cardStore, startCards), subscribeFolders = subscribe(folderStore, startFolders);
const cardsNow = () => cardStore.value, foldersNow = () => folderStore.value;

/** Changes a card (or makes it): at once here, saved in order per card. */
export function patchCard(id: string, changes: Partial<Card>) {
  const shared = syncPatches(cardStore.value, { [id]: changes });
  if (Object.keys(shared).length > 1) return patchCards(shared);
  // A new card remembers when it was made; a change of title or text when it was last edited (notebook sorting).
  const now = Date.now(), isNew = !cardStore.value.some(c => c.id === id);
  if (isNew && changes.createdAt == null) changes = { ...changes, createdAt: now, updatedAt: now };
  else if ('title' in changes || 'text' in changes || 'ink' in changes) changes = { ...changes, updatedAt: now };
  set(cardStore, old => old.some(c => c.id === id) ? old.map(c => c.id === id ? { ...c, ...changes } : c) : [...old, { ...changes, id } as Card]);
  const pending = enqueue([id, 'folders'], () => invoke('board_patch', { id, patch: changes, source }));
  void pending.catch(e => fail(cardStore, e)); return pending;
}
export function patchCards(patches: Patches) {
  patches = syncPatches(cardStore.value, patches);
  const ids = Object.keys(patches);
  if (!ids.length) return Promise.resolve();
  const known = new Set(cardStore.value.map(card => card.id)), now = Date.now();
  patches = Object.fromEntries(Object.entries(patches).map(([id, patch]) => [id, !known.has(id) ? { createdAt: now, updatedAt: now, ...patch } : 'title' in patch || 'text' in patch || 'ink' in patch ? { ...patch, updatedAt: now } : patch]));
  set(cardStore, old => [...old.map(card => patches[card.id] ? { ...card, ...patches[card.id] } : card), ...ids.filter(id => !known.has(id)).map(id => ({ ...patches[id], id } as Card))]);
  const pending = enqueue([...ids, 'folders'], () => invoke('board_patch_many', { patches, source }));
  void pending.catch(e => fail(cardStore, e)); return pending;
}
/** Ties two cards with a thread (both sides). Returns false when they cannot be tied (or already are). */
export function connectCards(a: string, b: string) { const patches = connectPatches(cardStore.value, a, b); if (!Object.keys(patches).length) return null; return patchCards(patches); }
export function disconnectCards(a: string, b: string) { return patchCards(disconnectPatches(cardStore.value, a, b)); }
/** Removes a card for good; no thread keeps pointing at it. */
export const removeCard = (id: string) => removeCards([id]);
export async function removeCards(ids: string[]) {
  if (!ids.length) return;
  const id = ids[0], selected = new Set(ids);
  const removed = new Set(ids.flatMap(id => [...removalIds(cardStore.value, id, selected)]));
  const affected = cardStore.value.filter(card => removed.has(card.id) || card.links?.some(other => removed.has(other))).map(card => card.id);
  set(cardStore, old => old.filter(card => !removed.has(card.id)).map(card => card.links ? { ...card, links: card.links.filter(other => !removed.has(other)), ...(card.pageLinks?{pageLinks:card.pageLinks.filter(other=>!removed.has(other))}:{}) } : card));
  const pending = enqueue([...affected, id, 'folders'], () => invoke('board_remove', { id, ids, source }));
  void pending.catch(e => fail(cardStore, e)); return pending;
}

export function useCards() {
  const cards = useSyncExternalStore(subscribeCards, cardsNow, cardsNow);
  return { cards, patch: patchCard, error: cardStore.error };
}
export function useFolders() {
  const folders = useSyncExternalStore(subscribeFolders, foldersNow, foldersNow);
  return {
    folders, error: folderStore.error,
    save: async (folder: Folder) => {
      set(folderStore, old => [...old.filter(f => f.id !== folder.id), folder]);
      try { await enqueue(['folders'], () => invoke('board_folder_save', { folder })); } catch (e) { fail(folderStore, e); await refreshFolders(); throw e; }
    },
    remove: async (id: string) => {
      // Like the backend: subfolders and notes move up into the parent.
      const parent = folderStore.value.find(f => f.id === id)?.parent ?? null;
      set(folderStore, old => old.filter(f => f.id !== id).map(f => f.parent === id ? { ...f, parent } : f));
      set(cardStore, old => old.map(c => c.folder === id ? { ...c, folder: parent } : c));
      try { await enqueue(['folders', ...cardStore.value.map(card => card.id)], () => invoke('board_folder_remove', { id })); } catch (e) { fail(folderStore, e); await refreshFolders(); throw e; }
    },
  };
}

export function usePixelTheme() {
  const [pixel, setPixel] = useState(document.documentElement.dataset.pixel !== undefined);
  useEffect(() => { const observer = new MutationObserver(() => setPixel(document.documentElement.dataset.pixel !== undefined)); observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pixel'] }); return () => observer.disconnect(); }, []);
  return pixel;
}
/** A note's text in the journal's rich editor (Markdown with blocks), or its handwriting when it is in drawing mode. */
export function Note({ card, patch, label }: { card: Card; patch: (id: string, value: Partial<Card>) => unknown; label?: string }) {
  const focus = useRef<string | null>(null);
  if (card.mode === 'ink') return <InkCanvas card={card} patch={patch} label={label ?? card.title} />;
  const entry: Entry = { id: card.id, kind: 'note', text: card.text, done: false, cancelled: false, priority: false };
  return <EntryText rich entry={entry} label={label ?? card.title} strike={null} focusEntryId={focus} onChange={text => patch(card.id, { text })} />;
}

/** Pixelated images are drawn small (48 cells on the long edge) and stretched in hard pixels. */
export const pixelCells = 48;
function useImageUrl(card: Card) {
  const [url, setUrl] = useState(''), [failed, setFailed] = useState(false);
  useEffect(() => { let active = true; setFailed(false); if (card.asset) void invoke<string>('board_image_load', { id: card.asset }).then(src => { if (active) setUrl(src); }).catch(() => { if (active) setFailed(true); }); else setUrl(card.image ?? ''); return () => { active = false; }; }, [card.asset, card.image]);
  return { url, failed, setFailed };
}
export function Pixelated({ url, label, cells = pixelCells }: { url: string; label: string; cells?: number }) {
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
export function BoardImage({ card, onOpen }: { card: Card; onOpen: () => void }) {
  const { url, failed, setFailed } = useImageUrl(card);
  const pixelTheme = usePixelTheme(), pixel = !!card.pixel && pixelTheme;
  if (failed) return <p className="board-image-missing" role="status">{t('Bild konnte nicht geladen werden.')}</p>;
  if (!url) return <div className="board-image is-loading" />;
  return <button type="button" className={`board-image${pixel ? ' is-pixel' : ''}`} aria-label={t('{0} groß öffnen', card.title)} onClick={onOpen}>
    {pixel ? <Pixelated url={url} label={card.title} /> : <img src={url} alt={card.title} loading="lazy" onError={() => setFailed(true)} />}
  </button>;
}
/** The image large, over everything; Escape, a click or the × close it. */
export function Lightbox({ card, onClose }: { card: Card; onClose: () => void }) {
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
      <figcaption><span>{card.title}</span>{card.size ? <small>AVIF · {Math.round(card.size / 1024)} KB</small> : null}<button ref={closeRef} type="button" aria-label={t('Schließen')} onClick={onClose}><Icon name="done" /></button></figcaption>
    </figure>
  </div>, document.body);
}

function compress(file: File): Promise<ArrayBuffer> {
  const worker = new Worker(new URL('./boardImage.worker.ts', import.meta.url), { type: 'module' });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { worker.terminate(); reject(new Error(t('Bildkomprimierung hat zu lange gedauert.'))); }, 120000);
    const done = () => { clearTimeout(timer); worker.terminate(); };
    worker.onmessage = e => { done(); if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result); };
    worker.onerror = e => { done(); reject(new Error(e.message)); }; worker.postMessage(file);
  });
}
/** Compresses an image to AVIF and stores it; the card's fields for it. */
export async function storeImage(file: File): Promise<Pick<Card, 'title' | 'asset' | 'size'>> {
  if (file.size > 30_000_000) throw new Error(t('Bitte ein Bild unter 30 MB wählen.'));
  const result = await compress(file); const asset = crypto.randomUUID();
  await invoke('board_image_save', { id: asset, data: encodeBase64(new Uint8Array(result)) });
  return { title: file.name.replace(/\.[^.]+$/, ''), asset, size: result.byteLength };
}
/** The link as typed, if it is an HTTPS link. */
export function httpsLink(input: string): URL {
  let url: URL;
  try { url = new URL(input); } catch { throw new Error(t('Bitte einen HTTPS-Link eingeben.')); }
  if (url.protocol !== 'https:') throw new Error(t('Bitte einen HTTPS-Link eingeben.'));
  return url;
}
/** The page's title, description and preview image (Open Graph, else the page's own title). */
export async function linkPreview(url: URL): Promise<Pick<Card, 'title' | 'text' | 'image'>> {
  const html = await invoke<string>('board_link_preview', { url: url.href }); const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (name: string) => doc.querySelector<HTMLMetaElement>(`meta[property="${name}"],meta[name="${name}"]`)?.content;
  const title = meta('og:title') || doc.title || url.hostname; const description = meta('og:description') || meta('description') || '';
  const raw = meta('og:image'); const image = raw ? new URL(raw, url.href) : null;
  return { title: title.trim().slice(0, 300), text: description.trim().slice(0, 1000), image: image?.protocol === 'https:' ? image.href : undefined };
}
export const hostOf = (url?: string) => { try { return url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { return ''; } };
/** The order for a new card: after all others. */
export const nextOrder = (cards: Card[]) => Math.max(0, ...cards.map(c => c.order ?? 0)) + 1;
