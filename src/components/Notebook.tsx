import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t, useLanguage } from '../i18n';
import { formatDate, formatShortDate, localDate } from '../dates';
import { BoardImage, Lightbox, Note, connectCards, disconnectCards, hostOf, httpsLink, linkPreview, nextOrder, patchCards, removeCard, removeCards, storeImage, useCards, useFolders } from '../boardCards';
import { BoardScopePicker } from './BoardScopePicker';
import type { Card, Folder } from '../boardCards';
import { attachmentsOf, canMoveFolder, flatTree, folderPath, nextFolderOrder, noteSorts, notesIn, onDayPatch, pagesOf, sortNotes, visibleTree } from '../notebook';
import type { NoteSort } from '../notebook';
import { Icon } from './Icon';
import { Popover } from './Popover';
import { contextMenu } from './ContextMenu';
import type { MenuEntry, MenuItem } from './ContextMenu';
import './bulletinBoard.css';
import './notebook.css';

/**
 * The notebook ("Notizen"): every note of the board in folders and subfolders, with its attachments. On the left the
 * folder tree (all notes, notes outside every folder, then the folders) and the notes of the chosen folder; on the right
 * the note: its title, the board's editor, the switch that shows it on the day it was made, and its attachments (images
 * and links tied to it by a thread). Notes tied to it are further pages (arrows, dots, Page Up / Page Down); without
 * them it is one page that scrolls. Each design dresses it its own way (notebook.css).
 */
type Choice = 'all' | 'none' | string;
const choiceKey = 'journal.notebookFolder', noteKey = 'journal.notebookNote', collapsedKey = 'journal.notebookCollapsed', sortKey = 'journal.notebookSort';
const read = (key: string) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* this session */ } };
const readCollapsed = () => { try { const value: unknown = JSON.parse(read(collapsedKey) ?? '[]'); return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []); } catch { return new Set<string>(); } };
const noteType = 'application/x-journal-note', folderType = 'application/x-journal-folder';

export function Notebook({ onClose, onOpenDay }: { onClose?: () => void; onOpenDay?: (date: string) => void }) {
  useLanguage();
  const { cards, patch, error } = useCards();
  const { folders, save, remove, error: folderError } = useFolders();
  const [choice, setChoiceState] = useState<Choice>(() => read(choiceKey) ?? 'all');
  const [selected, setSelectedState] = useState<string | null>(() => read(noteKey));
  const [pageIndex, setPageIndex] = useState(0);
  const [query, setQuery] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [sort, setSortState] = useState<NoteSort>(() => noteSorts.find(value => value === read(sortKey)) ?? 'created');
  const setSort = (value: NoteSort) => { setSortState(value); write(sortKey, value); };
  const [dropOn, setDropOn] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<Card | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const upload = useRef<HTMLInputElement>(null), titleRef = useRef<HTMLInputElement>(null), focusTitle = useRef(false);
  const today = localDate();

  const known = new Set(folders.map(folder => folder.id));
  const shownChoice: Choice = choice === 'all' || choice === 'none' || known.has(choice) ? choice : 'all';
  const setChoice = (value: Choice) => { setChoiceState(value); write(choiceKey, value); };
  const select = (id: string | null) => { setSelectedState(id); setPageIndex(0); write(noteKey, id ?? ''); };
  // A search result opens its note here (all notes shown, so it is in the list).
  useEffect(() => {
    const open = (event: Event) => { const id = (event as CustomEvent<string>).detail; setChoice('all'); setQuery(''); select(id); };
    window.addEventListener('journal:open-note', open);
    return () => window.removeEventListener('journal:open-note', open);
  }, []);
  const notes = sortNotes(notesIn(cards, folders, shownChoice, query), sort);
  const current = notes.find(card => card.id === selected) ?? notes[0] ?? null;
  const currentId = current?.id ?? null;
  const pages = current ? pagesOf(cards, current) : [];
  const index = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page = pages[index] ?? null;
  const attachments = page ? attachmentsOf(cards, page) : [];
  const tree = flatTree(folders);
  const visibleRows = visibleTree(folders, collapsed);
  const counts = (id: string) => cards.filter(card => card.kind === 'note' && card.folder === id).length;

  useEffect(() => { if (focusTitle.current && page) { focusTitle.current = false; titleRef.current?.focus(); titleRef.current?.select(); } }, [page?.id]);
  useEffect(() => { setPageIndex(0); }, [current?.id]);
  useEffect(() => { setLink(null); setMessage(''); }, [page?.id]);

  async function run(action: () => Promise<unknown>) { setBusy(true); setMessage(''); try { await action(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } }
  const base = (kind: Card['kind']): Partial<Card> => ({ kind, text: '', dates: [], created: today, notebook: true, order: nextOrder(cards) });
  function newNote(into?: string | null) {
    const id = crypto.randomUUID();
    const folder = into !== undefined ? into : shownChoice === 'all' || shownChoice === 'none' ? null : shownChoice;
    if (into !== undefined) setChoice(into ?? 'none');
    void run(() => patch(id, { ...base('note'), title: t('Neue Notiz'), paper: 'yellow', folder, onDay: false }));
    setQuery(''); focusTitle.current = true; select(id);
  }
  function newFolder(parent: string | null) {
    const folder: Folder = { id: crypto.randomUUID(), name: t('Neuer Ordner'), parent, order: nextFolderOrder(folders, parent) };
    if (parent) setCollapsed(old => { const next = new Set(old); next.delete(parent); write(collapsedKey, JSON.stringify([...next])); return next; });
    void run(() => save(folder));
    setRenaming({ id: folder.id, name: folder.name });
  }
  function rename() {
    if (!renaming) return;
    const folder = folders.find(f => f.id === renaming.id), name = renaming.name.trim();
    setRenaming(null);
    if (folder && name && name !== folder.name) void run(() => save({ ...folder, name }));
  }
  function toggle(id: string) {
    setCollapsed(old => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); write(collapsedKey, JSON.stringify([...next])); return next; });
  }
  function moveFolder(id: string, parent: string | null) {
    const folder = folders.find(f => f.id === id);
    if (!folder || folder.parent === parent || !canMoveFolder(folders, id, parent)) return;
    void run(() => save({ ...folder, parent, order: nextFolderOrder(folders, parent) }));
  }
  const moveNote = (id: string, folder: string | null) => void run(() => patch(id, { folder }));
  // Several notes at once: Ctrl+click adds or takes one, Shift+click the run from the last one clicked. Dragged or moved,
  // the chosen ones go together.
  const [chosen, setChosen] = useState<string[]>([]);
  const anchor = useRef<string | null>(null);
  const hoverNote = useRef<string | null>(null);
  const moveNotes = (ids: string[], folder: string | null) => void run(async () => { await patchCards(Object.fromEntries(ids.map(id => [id, { folder }]))); setChosen([]); });
  const noteIds = notes.map(note => note.id).join(',');
  useEffect(() => { setChosen(old => old.filter(id => notes.some(note => note.id === id))); if (anchor.current && !notes.some(note => note.id === anchor.current)) anchor.current = null; }, [noteIds]);
  useEffect(() => { setChosen([]); anchor.current = null; }, [shownChoice, query]);
  const clickNote = (event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }, id: string) => {
    if (event.shiftKey && (anchor.current || currentId)) {
      const ids = notes.map(note => note.id), from = ids.indexOf(anchor.current ?? currentId!), to = ids.indexOf(id);
      if (from >= 0 && to >= 0) { anchor.current ??= currentId; setChosen(ids.slice(Math.min(from, to), Math.max(from, to) + 1)); return; }
    }
    if (event.ctrlKey || event.metaKey) {
      setChosen(current => { const base = current.length ? current : current.concat(currentId ? [currentId] : []); return base.includes(id) ? base.filter(other => other !== id) : [...base, id]; });
      anchor.current = id;
      return;
    }
    if (!chosen.includes(id)) setChosen([]); anchor.current = id; select(id);
  };
  // Dropping a note (or a folder) on a folder row puts it there; on "Ohne Ordner" out of every folder.
  const dropHandlers = (target: string | null) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(noteType) || e.dataTransfer.types.includes(folderType)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropOn(target ?? 'none'); } },
    onDragLeave: () => setDropOn(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault(); setDropOn(null);
      const note = e.dataTransfer.getData(noteType), folder = e.dataTransfer.getData(folderType);
      if (note) { const ids = note.split(','); if (ids.length > 1 || chosen.includes(note)) moveNotes(ids, target); else moveNote(note, target); } else if (folder) moveFolder(folder, target);
    },
  });

  async function attach(fields: Partial<Card>) {
    if (!page) return;
    const id = crypto.randomUUID();
    await patch(id, { ...base(fields.kind!), ...fields });
    await connectCards(page.id, id);
    return id;
  }
  async function addLink() {
    const url = httpsLink(link ?? ''); setLink(null);
    const id = await attach({ kind: 'link', title: url.hostname, url: url.href });
    if (!id) return;
    try { await patch(id, await linkPreview(url)); } catch { setMessage(t('Link gespeichert. Diese Seite liefert keine erreichbare Vorschau.')); }
  }
  /** Taking an attachment off the note; one made here and tied to nothing else goes for good. */
  async function detach(card: Card) {
    if (!page) return;
    if (card.notebook && !card.dates.length && !(card.links ?? []).some(id => id !== page.id)) await removeCard(card.id);
    else await disconnectCards(page.id, card.id);
  }
  const openDay = (note: Card) => {
    if (!note.dates.length) return;
    if (onOpenDay) onOpenDay(note.dates[0]);
    else void invoke('show_day', { date: note.dates[0], entry: null });
  };
  async function deleteNotes(ids: string[]) {
    if (busy || !ids.length) return;
    const note = cards.find(card => card.id === ids[0]);
    const question = ids.length > 1 ? t('{0} ausgewählte Zettel endgültig löschen? Sie verschwinden auch von der Pinnwand.', ids.length)
      : t('„{0}“ endgültig löschen? Der Zettel verschwindet auch von der Pinnwand.', note?.title || t('Ohne Titel'));
    if (!window.confirm(question)) return;
    await removeCards(ids);
    setChosen([]); anchor.current = null; hoverNote.current = null;
    if (currentId && ids.includes(currentId)) select(null);
  }
  const deleteNote = (note: Card) => deleteNotes([note.id]);

  function onKey(event: KeyboardEvent<HTMLElement>) {
    // The window's own keys still reach the app: this notebook (Ctrl+Shift+N), the calendar, settings, help, Escape.
    const own = event.key === 'Escape' || event.key === 'F1' || (event.ctrlKey && (event.code === 'KeyK' || event.key === ',' || (event.shiftKey && event.code === 'KeyN')));
    const typing = (event.target as Element).closest('input, textarea, select, [contenteditable="true"], .cm-editor');
    if (pages.length > 1 && (event.key === 'PageDown' || event.key === 'PageUp') && (event.ctrlKey || !typing)) {
      event.preventDefault(); event.stopPropagation();
      setPageIndex(Math.max(0, Math.min(pages.length - 1, index + (event.key === 'PageDown' ? 1 : -1))));
      return;
    }
    if (!own) event.stopPropagation();
  }

  useEffect(() => {
    const key = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Delete' || event.repeat || event.ctrlKey || event.altKey || event.metaKey || busy) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], .cm-editor, [role="dialog"]')) return;
      if (!hoverNote.current && !target?.closest('.notebook')) return;
      const ids = chosen.length ? chosen : hoverNote.current ? [hoverNote.current] : page ? [page.id] : [];
      if (!ids.length) return;
      event.preventDefault(); event.stopPropagation();
      void run(() => deleteNotes(ids));
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [chosen, page?.id, busy, cards]);

  const noteTitle = (card: Card) => card.title || t('Ohne Titel');

  // Right-click menus (ContextMenu.tsx): the folders, the notes (one or the chosen ones), the attachments, the empty side.
  const folderChoices = (current: string | null | undefined, pick: (folder: string | null) => void, allowed: (folder: string | null) => boolean = () => true): MenuEntry[] => [
    { id: 'to-none', command: '/', label: t('Ohne Ordner'), icon: 'note', checked: current === null, disabled: !allowed(null), run: () => pick(null) },
    ...(tree.length ? ['-' as const] : []),
    ...tree.map(({ folder, depth }): MenuItem => ({ id: `to-${folder.id}`, command: folderPath(folders, folder.id).join('/'), label: folder.name, icon: 'layout', depth, checked: current === folder.id, disabled: !allowed(folder.id), run: () => pick(folder.id) })),
  ];
  const sortMenu: MenuItem = { id: 'sort', command: 'sort', label: t('Sortieren'), icon: 'transfer', items: noteSorts.map(value => ({ id: `sort-${value}`, command: `--${value}`,
    label: ({ title: t('Nach Titel, A–Z'), created: t('Neueste zuerst, nach Erstelldatum'), updated: t('Zuletzt bearbeitete zuerst') })[value], checked: sort === value, run: () => setSort(value) })) };
  const sideMenu = contextMenu(() => ({ title: t('Notizen'), command: 'notes', items: [
    { id: 'new-note', command: 'touch', positive: true, label: t('Neuer Zettel'), icon: 'pencil', disabled: busy, run: () => newNote() },
    { id: 'new-folder', command: 'mkdir', positive: true, label: t('Neuer Ordner'), icon: 'layout', disabled: busy, run: () => newFolder(null) },
    '-', sortMenu,
  ] }));
  const specialMenu = (which: 'all' | 'none') => contextMenu(() => ({ title: which === 'all' ? t('Alle Zettel') : t('Ohne Ordner'), command: 'folder', items: [
    { id: 'open', command: 'cd', label: t('Öffnen'), icon: 'right', disabled: shownChoice === which, run: () => setChoice(which) },
    { id: 'new-note', command: 'touch', positive: true, label: which === 'none' ? t('Neuer Zettel hier') : t('Neuer Zettel'), icon: 'pencil', disabled: busy, run: () => newNote(which === 'none' ? null : undefined) },
    { id: 'new-folder', command: 'mkdir', positive: true, label: t('Neuer Ordner'), icon: 'layout', disabled: busy, run: () => newFolder(null) },
  ] }));
  const folderMenu = (folder: Folder, hasChildren: boolean, open: boolean) => contextMenu(() => ({ title: folder.name, command: 'folder', items: [
    { id: 'open', command: 'cd', label: t('Öffnen'), icon: 'right', disabled: shownChoice === folder.id, run: () => setChoice(folder.id) },
    { id: 'new-note', command: 'touch', positive: true, label: t('Neuer Zettel hier'), icon: 'pencil', disabled: busy, run: () => newNote(folder.id) },
    { id: 'new-folder', command: 'mkdir', positive: true, label: t('Unterordner'), icon: 'layout', disabled: busy, run: () => newFolder(folder.id) },
    '-',
    { id: 'rename', command: 'rename', label: t('Umbenennen'), icon: 'pencil', keys: 'F2', run: () => setRenaming({ id: folder.id, name: folder.name }) },
    { id: 'move', command: 'mv', label: t('Verschieben nach'), icon: 'transfer', items: folderChoices(folder.parent, parent => moveFolder(folder.id, parent), parent => parent !== folder.id && canMoveFolder(folders, folder.id, parent)) },
    ...(hasChildren ? [{ id: 'fold', command: open ? 'fold' : 'unfold', label: open ? t('Einklappen') : t('Ausklappen'), icon: open ? 'up' : 'down', keys: open ? '←' : '→', run: () => toggle(folder.id) } as MenuItem] : []),
    '-',
    { id: 'delete', command: 'rm -r', label: t('Löschen (Inhalt rückt nach oben)'), icon: 'trash', danger: true, disabled: busy, run: () => void run(() => remove(folder.id)) },
  ] }));
  const paperNames = (): [NonNullable<Card['paper']>, string][] => [['yellow', t('Gelb')], ['blue', t('Blau')], ['green', t('Grün')], ['pink', t('Rosa')]];
  const noteMenu = (note: Card) => contextMenu(() => {
    if (chosen.length > 1 && chosen.includes(note.id)) return { title: t('{0} Zettel', chosen.length), command: 'notes', items: [
      { id: 'move', command: 'mv', label: t('Alle verschieben nach'), icon: 'transfer', items: folderChoices(undefined, folder => moveNotes(chosen, folder)) },
      { id: 'open-day', command: 'day', label: t('Tag mit dieser Notiz öffnen'), icon: 'calendar', disabled: !note.dates.length, run: () => openDay(note) },
      { id: 'delete-all', command: 'rm --selected', label: t('Alle ausgewählten Zettel löschen'), icon: 'trash', keys: t('Entf'), danger: true, disabled: busy, run: () => void run(() => deleteNotes(chosen)) },
      { id: 'unchoose', command: 'select --none', label: t('Auswahl aufheben'), icon: 'cancel', keys: 'Esc', run: () => setChosen([]) },
    ] };
    const on = note.dates.length > 0, isChosen = chosen.includes(note.id);
    return { title: noteTitle(note), command: 'note', items: [
      { id: 'open', command: 'cat', label: t('Öffnen'), icon: 'right', disabled: note.id === currentId && !chosen.length, run: () => { setChosen([]); anchor.current = note.id; select(note.id); } },
      { id: 'choose', command: isChosen ? 'select -' : 'select +', label: isChosen ? t('Aus der Auswahl nehmen') : t('Zur Auswahl hinzufügen'), icon: 'check', keys: t('Strg Klick'), run: () => clickNote({ ctrlKey: true, metaKey: false, shiftKey: false }, note.id) },
      '-',
      { id: 'move', command: 'mv', label: t('Verschieben nach'), icon: 'transfer', items: folderChoices(note.folder && known.has(note.folder) ? note.folder : null, folder => moveNote(note.id, folder)) },
      { id: 'paper', command: 'color', label: t('Papierfarbe'), icon: 'pipette', items: paperNames().map(([paper, name]) => ({ id: `paper-${paper}`, command: paper, label: name, swatch: `paper-${paper}`, checked: (note.paper ?? 'yellow') === paper, run: () => void patch(note.id, { paper }) })) },
      { id: 'open-day', command: 'day', label: t('Tag mit dieser Notiz öffnen'), icon: 'calendar', disabled: !note.dates.length, run: () => openDay(note) },
      { id: 'on-day', command: 'pin --day', label: t('Auf dem Tag zeigen'), icon: 'calendar', checked: on, run: () => void run(() => patch(note.id, onDayPatch(note, !on, today))) },
      '-',
      { id: 'delete', command: 'rm', label: t('Zettel endgültig löschen'), icon: 'trash', danger: true, disabled: busy, run: () => void run(() => deleteNote(note)) },
    ] };
  });
  const attachmentMenu = (card: Card) => contextMenu(() => ({ title: card.kind === 'image' ? card.title || t('Bild') : hostOf(card.url), command: 'attachment', items: [
    card.kind === 'image'
      ? { id: 'open', command: 'open', label: t('Vergrößern'), icon: 'search', run: () => setLightbox(card) }
      : { id: 'open', command: 'open', label: t('Link öffnen'), icon: 'jump', run: () => void run(() => invoke('board_open_link', { url: card.url })) },
    ...(card.kind === 'link' ? [{ id: 'copy', command: 'copy', label: t('Link kopieren'), icon: 'copy', run: () => void navigator.clipboard?.writeText(card.url ?? '') } as MenuItem] : []),
    '-',
    { id: 'detach', command: 'unlink', label: t('Vom Zettel lösen'), icon: 'cancel', danger: true, disabled: busy, run: () => void run(() => detach(card)) },
  ] }));
  const branch = (lines: boolean[], last: boolean) => `${lines.map(line => line ? '│   ' : '    ').join('')}${last ? '└── ' : '├── '}`;
  const created = page ? page.created ?? page.dates[0] ?? today : today;
  const onDay = page ? page.dates.length > 0 : false;
  const status = busy ? t('Wird verarbeitet …') : message || error || folderError;

  return <section className="notebook" aria-label={t('Notizen')} onKeyDown={onKey}>
    <header className="notebook-head">
      <h2><Icon name="note" />{t('Notizen')}</h2>
      <span className="notebook-head-count">{t('{0} Zettel', cards.filter(card => card.kind === 'note').length)}</span>
      <span className="notebook-head-space" />
      <button type="button" className="notebook-new" disabled={busy} onClick={() => newNote()} title={t('Neuer Zettel im gewählten Ordner')}><Icon name="pencil" /><span>{t('Neuer Zettel')}</span></button>
      {onClose && <button type="button" className="notebook-close" aria-label={t('Notizen schließen')} title={t('Notizen schließen · Strg ⇧ N')} onClick={onClose}><Icon name="done" /></button>}
    </header>
    <div className="notebook-body">
      <aside className="notebook-side" aria-label={t('Ordner und Zettel')} onContextMenu={sideMenu}>
        <label className="notebook-search"><Icon name="search" /><input value={query} placeholder={t('Zettel suchen …')} aria-label={t('Zettel suchen')} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }} /></label>
        <nav className="notebook-tree" aria-label={t('Ordner')}>
          <div className="notebook-tree-head"><span>{t('Ordner')}</span><button type="button" className="notebook-add-folder" disabled={busy} title={t('Neuer Ordner')} aria-label={t("Neuer Ordner")} onClick={() => newFolder(null)}><b aria-hidden="true">+</b></button></div>
          <ul role="tree" aria-label={t('Ordner')}>
            <li role="treeitem" aria-selected={shownChoice === 'all'} className={`notebook-folder is-all${shownChoice === 'all' ? ' is-current' : ''}`} data-folder="all" onContextMenu={specialMenu('all')}>
              <button type="button" className="notebook-folder-name" onClick={() => setChoice('all')}><span className="notebook-branch" aria-hidden="true">.</span><Icon name="journal" /><span>{t('Alle Zettel')}</span><small>{cards.filter(card => card.kind === 'note').length}</small></button>
            </li>
            <li role="treeitem" aria-selected={shownChoice === 'none'} className={`notebook-folder is-none${shownChoice === 'none' ? ' is-current' : ''}${dropOn === 'none' ? ' is-drop' : ''}`} data-folder="none" {...dropHandlers(null)} onContextMenu={specialMenu('none')}>
              <button type="button" className="notebook-folder-name" onClick={() => setChoice('none')}><span className="notebook-branch" aria-hidden="true">{tree.length ? '├── ' : '└── '}</span><Icon name="note" /><span>{t('Ohne Ordner')}</span><small>{cards.filter(card => card.kind === 'note' && (!card.folder || !known.has(card.folder))).length}</small></button>
            </li>
            {visibleRows.map(({ folder, depth, last, lines }) => {
              const hasChildren = folders.some(f => f.parent === folder.id), open = !collapsed.has(folder.id);
              return <li key={folder.id} role="treeitem" aria-selected={shownChoice === folder.id} aria-expanded={hasChildren ? open : undefined} style={{ '--depth': depth } as CSSProperties}
                className={`notebook-folder${shownChoice === folder.id ? ' is-current' : ''}${dropOn === folder.id ? ' is-drop' : ''}`} data-folder={folder.id}
                draggable={renaming?.id !== folder.id} onDragStart={e => { e.dataTransfer.setData(folderType, folder.id); e.dataTransfer.effectAllowed = 'move'; }} {...dropHandlers(folder.id)}
                onContextMenu={folderMenu(folder, hasChildren, open)}>
                {renaming?.id === folder.id
                  ? <input className="notebook-rename" autoFocus aria-label={t('Ordnername')} value={renaming.name} onChange={e => setRenaming({ id: folder.id, name: e.target.value })} onFocus={e => e.currentTarget.select()}
                    onBlur={rename} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); rename(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setRenaming(null); } }} />
                  : <button type="button" className="notebook-folder-name" onClick={() => setChoice(folder.id)} onDoubleClick={() => setRenaming({ id: folder.id, name: folder.name })}
                    onKeyDown={e => { if (e.key === 'F2') { e.preventDefault(); setRenaming({ id: folder.id, name: folder.name }); } else if (hasChildren && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && (e.key === 'ArrowRight') !== open) { e.preventDefault(); toggle(folder.id); } }}>
                    <span className="notebook-branch" aria-hidden="true">{branch(lines, last)}</span>
                    <span className={`notebook-twisty${hasChildren ? '' : ' is-leaf'}`} aria-hidden="true" onClick={e => { if (hasChildren) { e.stopPropagation(); toggle(folder.id); } }}>{hasChildren ? (open ? '▾' : '▸') : ''}</span>
                    <Icon name="layout" /><span className="notebook-folder-label">{folder.name}</span><small>{counts(folder.id)}</small></button>}
                <span className="notebook-folder-tools">
                  <button type="button" title={t('Unterordner')} aria-label={t('Unterordner in „{0}“', folder.name)} onClick={() => newFolder(folder.id)}><b aria-hidden="true">+</b></button>
                  <button type="button" title={t('Umbenennen · F2')} aria-label={t('„{0}“ umbenennen', folder.name)} onClick={() => setRenaming({ id: folder.id, name: folder.name })}><Icon name="pencil" /></button>
                  <button type="button" title={t('Löschen (Inhalt rückt nach oben)')} aria-label={t('„{0}“ löschen', folder.name)} onClick={() => void run(() => remove(folder.id))}><Icon name="trash" /></button>
                </span>
              </li>;
            })}
          </ul>
        </nav>
        <div className="notebook-notes" role="list" aria-label={query ? t('Suchergebnisse') : t('Zettel')} onKeyDown={e => { if (e.key === 'Escape' && chosen.length) { e.preventDefault(); e.stopPropagation(); setChosen([]); } }}>
          <div className="notebook-tree-head"><span>{query ? t('Suchergebnisse') : t('Zettel')}</span><small>{notes.length}</small></div>
          {chosen.length > 1 && <div className="notebook-chosen" role="group" aria-label={t('Ausgewählte Zettel')}>
            <span>{t('{0} ausgewählt', chosen.length)}</span>
            <FolderPick value={null} tree={tree} label={t('Verschieben nach …')} onPick={folder => moveNotes(chosen, folder)} />
            <button type="button" className="notebook-chosen-delete notebook-chosen-clear" disabled={busy} aria-label={t('Alle ausgewählten Zettel löschen')} title={t('Alle ausgewählten Zettel löschen · Entf')} onClick={() => void run(() => deleteNotes(chosen))}><Icon name="trash" /></button>
            <button type="button" className="notebook-chosen-clear" aria-label={t('Auswahl aufheben')} title={t('Auswahl aufheben · Esc')} onClick={() => setChosen([])}><Icon name="done" /></button>
          </div>}
          {/* Sorting: by title, or newest first by when a note was made or last edited (remembered on the device). */}
          <div className="notebook-sort" role="radiogroup" aria-label={t('Sortieren')}>
            {noteSorts.map(value => <button type="button" key={value} role="radio" aria-checked={sort === value} data-sort={value} onClick={() => setSort(value)}
              title={({ title: t('Nach Titel, A–Z'), created: t('Neueste zuerst, nach Erstelldatum'), updated: t('Zuletzt bearbeitete zuerst') })[value]}>
              {({ title: t('Titel'), created: t('Erstellt'), updated: t('Bearbeitet') })[value]}</button>)}
          </div>
          {notes.map(note => {
            const path = shownChoice === 'all' || query ? folderPath(folders, note.folder).join(' / ') : '';
            return <button type="button" role="listitem" key={note.id} data-note-id={note.id} className={`notebook-note paper-${note.paper ?? 'yellow'}${note.id === current?.id ? ' is-current' : ''}${chosen.includes(note.id) ? ' is-chosen' : ''}`}
              aria-current={note.id === current?.id || undefined} aria-pressed={chosen.length ? chosen.includes(note.id) : undefined} draggable
              onDragStart={e => { e.dataTransfer.setData(noteType, chosen.includes(note.id) && chosen.length > 1 ? chosen.join(',') : note.id); e.dataTransfer.effectAllowed = 'move'; }}
              onPointerEnter={() => { hoverNote.current = note.id; }} onPointerLeave={() => { hoverNote.current = null; }} onClick={e => clickNote(e, note.id)} onContextMenu={noteMenu(note)}>
              <strong>{noteTitle(note)}</strong>
              <small>{note.text.replace(/[#*_`>|[\]-]+/g, ' ').trim().slice(0, 70) || t('leer')}</small>
              <span className="notebook-note-meta">{path && <span>{path}</span>}{(note.links ?? []).length > 0 && <span title={t('Verbunden')}><Icon name="jump" />{(note.links ?? []).length}</span>}{note.dates.length > 0 && <span title={t('Auf dem Tag')}><Icon name="calendar" /></span>}</span>
            </button>;
          })}
          {!notes.length && <p className="notebook-empty">{query ? t('Kein Zettel passt.') : t('Hier liegt noch kein Zettel.')}</p>}
        </div>
      </aside>

      {page ? <article className={`notebook-page paper-${page.paper ?? 'yellow'}${pages.length > 1 ? ' has-pages' : ''}`} aria-label={t('Zettel: {0}', noteTitle(page))} data-page-id={page.id} key={page.id} onContextMenu={noteMenu(page)}>
        <header className="notebook-page-head">
          <input ref={titleRef} className="notebook-title" aria-label={t('Titel')} placeholder={t('Titel')} value={page.title} onChange={e => void patch(page.id, { title: e.target.value })} />
          <div className="notebook-page-tools">
            <BoardScopePicker cards={cards} id={page.id} date={page.created ?? page.dates[0] ?? today} />
            <FolderPick value={page.folder && known.has(page.folder) ? page.folder : null} tree={tree} onPick={folder => moveNote(page.id, folder)} />
            <button type="button" className="notebook-delete" title={t('Zettel endgültig löschen')} aria-label={t('Zettel endgültig löschen')} onClick={() => void run(() => deleteNote(page))}><Icon name="trash" /></button>
            {chosen.length > 1 && <button type="button" className="notebook-delete" disabled={busy} title={t('Alle ausgewählten Zettel löschen')} aria-label={t('Alle ausgewählten Zettel löschen')} onClick={() => void run(() => deleteNotes(chosen))}><Icon name="trash" /><span>{chosen.length}</span></button>}
          </div>
        </header>
        <div className="notebook-day">
          <button type="button" role="switch" className="switch" aria-checked={onDay} aria-labelledby="notebook-on-day" onClick={() => void run(() => patch(page.id, onDayPatch(page, !onDay, today)))}><span /></button>
          <label id="notebook-on-day">{t('Auf dem Tag zeigen')}</label>
          {onDay ? <button type="button" className="notebook-day-link" onClick={() => openDay(page)} title={t('Tag mit dieser Notiz öffnen')}>{page.dates.length > 1 ? t('auf {0} Tagen', page.dates.length) : formatDate(page.dates[0])}</button> : <small>{formatDate(created)}</small>}
        </div>
        <div className="notebook-text board-note"><Note card={page} patch={patch} label={noteTitle(page)} /></div>
        <section className="notebook-attachments" aria-label={t('Anhänge')}>
          <div className="notebook-attachments-head">
            <h3>{t('Anhänge')}{attachments.length > 0 && <small>{attachments.length}</small>}</h3>
            <div className="notebook-attach-actions">
              <button type="button" disabled={busy} onClick={() => upload.current?.click()} title={t('Bild anhängen (wird als AVIF komprimiert)')}><Icon name="layout" /><span>{t('Bild')}</span></button>
              <button type="button" disabled={busy} aria-expanded={link !== null} onClick={() => setLink(link === null ? '' : null)} title={t('Link anhängen')}><Icon name="jump" /><span>Link</span></button>
            </div>
          </div>
          <input ref={upload} type="file" accept="image/*" hidden onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void run(async () => attach({ kind: 'image', ...await storeImage(file) })); }} />
          {link !== null && <form className="board-link-form notebook-link-form" onSubmit={e => { e.preventDefault(); void run(addLink); }}><Icon name="jump" />
            <input autoFocus type="url" required placeholder="https://…" aria-label="URL" value={link} onChange={e => setLink(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setLink(null); } }} />
            <button disabled={busy}>{t('Anhängen')}</button><button type="button" onClick={() => setLink(null)}>{t('Abbrechen')}</button></form>}
          {attachments.length ? <ul className="notebook-strip">
            {attachments.map(card => <li key={card.id} className={`notebook-attachment is-${card.kind}`} data-attachment-id={card.id} onContextMenu={attachmentMenu(card)}>
              {card.kind === 'image' ? <BoardImage card={card} onOpen={() => setLightbox(card)} />
                : <button type="button" className="notebook-link" onClick={() => void run(() => invoke('board_open_link', { url: card.url }))}>
                  {card.image && <img src={card.image} alt="" loading="lazy" onError={e => { e.currentTarget.style.display = 'none'; }} />}
                  <strong>{card.title || hostOf(card.url)}</strong>{card.text && <span>{card.text}</span>}<small><Icon name="jump" />{hostOf(card.url)}</small></button>}
              <span className="notebook-attachment-foot"><small>{card.kind === 'image' ? card.title || t('Bild') : hostOf(card.url)}</small>
                <button type="button" title={t('Vom Zettel lösen')} aria-label={t('„{0}“ vom Zettel lösen', card.title || t('Anhang'))} onClick={() => void run(() => detach(card))}><Icon name="cancel" /></button></span>
            </li>)}
          </ul> : <p className="notebook-empty">{t('Keine Anhänge. Auf der Pinnwand: Bild oder Link mit einem Faden an den Zettel binden.')}</p>}
        </section>
        {pages.length > 1 && <nav className="notebook-pager" aria-label={t('Seiten')}>
          <button type="button" className="notebook-turn is-prev" disabled={index === 0} aria-label={t('Vorige Seite')} title={t('Vorige Seite · Bild↑')} onClick={() => setPageIndex(index - 1)}><Icon name="left" /></button>
          <span className="notebook-dots">{pages.map((value, at) => <button type="button" key={value.id} aria-current={at === index || undefined} aria-label={t('Seite {0}: {1}', at + 1, noteTitle(value))} title={noteTitle(value)} onClick={() => setPageIndex(at)} />)}</span>
          <span className="notebook-page-number">{t('Seite {0} von {1}', index + 1, pages.length)}</span>
          <button type="button" className="notebook-turn is-next" disabled={index === pages.length - 1} aria-label={t('Nächste Seite')} title={t('Nächste Seite · Bild↓')} onClick={() => setPageIndex(index + 1)}><Icon name="right" /></button>
        </nav>}
        {status && <p className="notebook-status" role="status">{status}</p>}
        <footer className="notebook-page-foot" aria-hidden="true">{t('Erstellt {0}', formatShortDate(created))}{folderPath(folders, page.folder).length > 0 && ` · ${folderPath(folders, page.folder).join(' / ')}`}</footer>
      </article>
        : <div className="notebook-page is-empty">
          <p>{t('Noch kein Zettel. Lege einen an – er erscheint nicht auf der Tagesnotiz, bis du es einschaltest.')}</p>
          <button type="button" className="notebook-new" onClick={() => newNote()}><Icon name="pencil" /><span>{t('Neuer Zettel')}</span></button>
          {status && <p className="notebook-status" role="status">{status}</p>}
        </div>}
    </div>
    {lightbox && <Lightbox card={lightbox} onClose={() => setLightbox(null)} />}
  </section>;
}

/**
 * Choosing a note's folder: a button with the folder's name that opens the list in the popup look of the design
 * (instead of the system's dropdown, which no style reaches). ↑ ↓ and Enter, or a click; subfolders indented.
 */
function FolderPick({ value, tree, onPick, label }: { value: string | null; tree: { folder: Folder; depth: number }[]; onPick: (folder: string | null) => void; label?: string }) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const options = [{ id: null as string | null, name: t('Ohne Ordner'), depth: 0 }, ...tree.map(({ folder, depth }) => ({ id: folder.id as string | null, name: folder.name, depth }))];
  const current = options.find(option => option.id === value) ?? options[0];
  const [active, setActive] = useState(0);
  const choose = (id: string | null) => { setOpen(false); button.current?.focus(); if (id !== value || label) onPick(id); };
  return <>
    <button ref={button} type="button" className="notebook-folder-pick" aria-haspopup="listbox" aria-expanded={open} aria-label={t('Ordner: {0}', current.name)} title={t('Ordner')}
      onClick={() => { setActive(Math.max(0, options.indexOf(current))); setOpen(value => !value); }}>
      <Icon name="layout" /><span>{label ?? current.name}</span><Icon name="down" />
    </button>
    {open && <Popover anchor={button.current} className="folder-pick" label={t('Ordner')} onClose={byKey => { setOpen(false); if (byKey) button.current?.focus(); }}>
      <div className="folder-pick-list" role="listbox" aria-label={t('Ordner')} tabIndex={-1} data-autofocus
        onKeyDown={event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setActive(index => (index + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length); }
          else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(options[active].id); }
        }}>
        {options.map((option, index) => <button key={option.id ?? '-'} type="button" role="option" tabIndex={-1} aria-selected={index === active}
          className={`folder-pick-option${option.id === value ? ' is-current' : ''}${option.id === null ? ' is-none' : ''}`} style={{ '--depth': option.depth } as CSSProperties}
          onPointerMove={() => setActive(index)} onClick={() => choose(option.id)}>
          <Icon name={option.id === null ? 'note' : 'layout'} /><span>{option.name}</span>{option.id === value && <Icon name="check" />}
        </button>)}
      </div>
    </Popover>}
  </>;
}
