import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, KeyboardEvent } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { t, useLanguage } from '../i18n';
import { formatDate, formatShortDate, localDate } from '../dates';
import { BoardImage, Lightbox, Note, connectCards, disconnectCards, hostOf, httpsLink, linkPreview, nextOrder, removeCard, storeImage, useCards, useFolders } from '../boardCards';
import type { Card, Folder } from '../boardCards';
import { attachmentsOf, canMoveFolder, flatTree, folderPath, folderWithin, nextFolderOrder, noteSorts, notesIn, onDayPatch, pagesOf, sortNotes, visibleTree } from '../notebook';
import type { NoteSort } from '../notebook';
import { Icon } from './Icon';
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

export function Notebook({ onClose }: { onClose?: () => void }) {
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
  const notes = sortNotes(notesIn(cards, folders, shownChoice, query), sort);
  const current = notes.find(card => card.id === selected) ?? notes[0] ?? null;
  const pages = current ? pagesOf(cards, current) : [];
  const index = Math.min(pageIndex, Math.max(0, pages.length - 1));
  const page = pages[index] ?? null;
  const attachments = page ? attachmentsOf(cards, page) : [];
  const tree = flatTree(folders);
  const visibleRows = visibleTree(folders, collapsed);
  const counts = (id: string) => { const inside = folderWithin(folders, id); return cards.filter(card => card.kind === 'note' && inside.has(card.folder ?? '')).length; };

  useEffect(() => { if (focusTitle.current && page) { focusTitle.current = false; titleRef.current?.focus(); titleRef.current?.select(); } }, [page?.id]);
  useEffect(() => { setPageIndex(0); }, [current?.id]);
  useEffect(() => { setLink(null); setMessage(''); }, [page?.id]);

  async function run(action: () => Promise<unknown>) { setBusy(true); setMessage(''); try { await action(); } catch (e) { setMessage(String(e)); } finally { setBusy(false); } }
  const base = (kind: Card['kind']): Partial<Card> => ({ kind, text: '', dates: [], created: today, notebook: true, order: nextOrder(cards) });
  function newNote() {
    const id = crypto.randomUUID();
    const folder = shownChoice === 'all' || shownChoice === 'none' ? null : shownChoice;
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
  // Dropping a note (or a folder) on a folder row puts it there; on "Ohne Ordner" out of every folder.
  const dropHandlers = (target: string | null) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(noteType) || e.dataTransfer.types.includes(folderType)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDropOn(target ?? 'none'); } },
    onDragLeave: () => setDropOn(null),
    onDrop: (e: DragEvent) => {
      e.preventDefault(); setDropOn(null);
      const note = e.dataTransfer.getData(noteType), folder = e.dataTransfer.getData(folderType);
      if (note) moveNote(note, target); else if (folder) moveFolder(folder, target);
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
  async function deleteNote(note: Card) {
    if (!window.confirm(t('„{0}“ endgültig löschen? Der Zettel verschwindet auch von der Pinnwand.', note.title || t('Ohne Titel')))) return;
    await removeCard(note.id);
    select(null);
  }

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

  const noteTitle = (card: Card) => card.title || t('Ohne Titel');
  const branch = (lines: boolean[], last: boolean) => `${lines.map(line => line ? '│   ' : '    ').join('')}${last ? '└── ' : '├── '}`;
  const created = page ? page.created ?? page.dates[0] ?? today : today;
  const onDay = page ? page.dates.length > 0 : false;
  const status = busy ? t('Wird verarbeitet …') : message || error || folderError;

  return <section className="notebook" aria-label={t('Notizen')} onKeyDown={onKey}>
    <header className="notebook-head">
      <h2><Icon name="note" />{t('Notizen')}</h2>
      <span className="notebook-head-count">{t('{0} Zettel', cards.filter(card => card.kind === 'note').length)}</span>
      <span className="notebook-head-space" />
      <button type="button" className="notebook-new" disabled={busy} onClick={newNote} title={t('Neuer Zettel im gewählten Ordner')}><Icon name="pencil" /><span>{t('Neuer Zettel')}</span></button>
      {onClose && <button type="button" className="notebook-close" aria-label={t('Notizen schließen')} title={t('Notizen schließen · Strg ⇧ N')} onClick={onClose}><Icon name="done" /></button>}
    </header>
    <div className="notebook-body">
      <aside className="notebook-side" aria-label={t('Ordner und Zettel')}>
        <label className="notebook-search"><Icon name="search" /><input value={query} placeholder={t('Zettel suchen …')} aria-label={t('Zettel suchen')} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Escape' && query) { e.preventDefault(); e.stopPropagation(); setQuery(''); } }} /></label>
        <nav className="notebook-tree" aria-label={t('Ordner')}>
          <div className="notebook-tree-head"><span>{t('Ordner')}</span><button type="button" className="notebook-add-folder" disabled={busy} title={t('Neuer Ordner')} aria-label={t("Neuer Ordner")} onClick={() => newFolder(null)}><b aria-hidden="true">+</b></button></div>
          <ul role="tree" aria-label={t('Ordner')}>
            <li role="treeitem" aria-selected={shownChoice === 'all'} className={`notebook-folder is-all${shownChoice === 'all' ? ' is-current' : ''}`} data-folder="all">
              <button type="button" className="notebook-folder-name" onClick={() => setChoice('all')}><span className="notebook-branch" aria-hidden="true">.</span><Icon name="journal" /><span>{t('Alle Zettel')}</span><small>{cards.filter(card => card.kind === 'note').length}</small></button>
            </li>
            <li role="treeitem" aria-selected={shownChoice === 'none'} className={`notebook-folder is-none${shownChoice === 'none' ? ' is-current' : ''}${dropOn === 'none' ? ' is-drop' : ''}`} data-folder="none" {...dropHandlers(null)}>
              <button type="button" className="notebook-folder-name" onClick={() => setChoice('none')}><span className="notebook-branch" aria-hidden="true">{tree.length ? '├── ' : '└── '}</span><Icon name="note" /><span>{t('Ohne Ordner')}</span><small>{cards.filter(card => card.kind === 'note' && (!card.folder || !known.has(card.folder))).length}</small></button>
            </li>
            {visibleRows.map(({ folder, depth, last, lines }) => {
              const hasChildren = folders.some(f => f.parent === folder.id), open = !collapsed.has(folder.id);
              return <li key={folder.id} role="treeitem" aria-selected={shownChoice === folder.id} aria-expanded={hasChildren ? open : undefined} style={{ '--depth': depth } as CSSProperties}
                className={`notebook-folder${shownChoice === folder.id ? ' is-current' : ''}${dropOn === folder.id ? ' is-drop' : ''}`} data-folder={folder.id}
                draggable={renaming?.id !== folder.id} onDragStart={e => { e.dataTransfer.setData(folderType, folder.id); e.dataTransfer.effectAllowed = 'move'; }} {...dropHandlers(folder.id)}>
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
        <div className="notebook-notes" role="list" aria-label={query ? t('Suchergebnisse') : t('Zettel')}>
          <div className="notebook-tree-head"><span>{query ? t('Suchergebnisse') : t('Zettel')}</span><small>{notes.length}</small></div>
          {/* Sorting: by title, or newest first by when a note was made or last edited (remembered on the device). */}
          <div className="notebook-sort" role="radiogroup" aria-label={t('Sortieren')}>
            {noteSorts.map(value => <button type="button" key={value} role="radio" aria-checked={sort === value} data-sort={value} onClick={() => setSort(value)}
              title={({ title: t('Nach Titel, A–Z'), created: t('Neueste zuerst, nach Erstelldatum'), updated: t('Zuletzt bearbeitete zuerst') })[value]}>
              {({ title: t('Titel'), created: t('Erstellt'), updated: t('Bearbeitet') })[value]}</button>)}
          </div>
          {notes.map(note => {
            const path = shownChoice === 'all' || query ? folderPath(folders, note.folder).join(' / ') : '';
            return <button type="button" role="listitem" key={note.id} data-note-id={note.id} className={`notebook-note paper-${note.paper ?? 'yellow'}${note.id === current?.id ? ' is-current' : ''}`}
              aria-current={note.id === current?.id || undefined} draggable onDragStart={e => { e.dataTransfer.setData(noteType, note.id); e.dataTransfer.effectAllowed = 'move'; }} onClick={() => select(note.id)}>
              <strong>{noteTitle(note)}</strong>
              <small>{note.text.replace(/[#*_`>|[\]-]+/g, ' ').trim().slice(0, 70) || t('leer')}</small>
              <span className="notebook-note-meta">{path && <span>{path}</span>}{(note.links ?? []).length > 0 && <span title={t('Verbunden')}><Icon name="jump" />{(note.links ?? []).length}</span>}{note.dates.length > 0 && <span title={t('Auf dem Tag')}><Icon name="calendar" /></span>}</span>
            </button>;
          })}
          {!notes.length && <p className="notebook-empty">{query ? t('Kein Zettel passt.') : t('Hier liegt noch kein Zettel.')}</p>}
        </div>
      </aside>

      {page ? <article className={`notebook-page paper-${page.paper ?? 'yellow'}${pages.length > 1 ? ' has-pages' : ''}`} aria-label={t('Zettel: {0}', noteTitle(page))} data-page-id={page.id} key={page.id}>
        <header className="notebook-page-head">
          <input ref={titleRef} className="notebook-title" aria-label={t('Titel')} placeholder={t('Titel')} value={page.title} onChange={e => void patch(page.id, { title: e.target.value })} />
          <div className="notebook-page-tools">
            <label className="notebook-folder-pick" title={t('Ordner')}><Icon name="layout" />
              <select aria-label={t('Ordner')} value={page.folder && known.has(page.folder) ? page.folder : ''} onChange={e => moveNote(page.id, e.target.value || null)}>
                <option value="">{t('Ohne Ordner')}</option>
                {tree.map(({ folder, depth }) => <option key={folder.id} value={folder.id}>{`${'  '.repeat(depth)}${folder.name}`}</option>)}
              </select>
            </label>
            <button type="button" className="notebook-delete" title={t('Zettel endgültig löschen')} aria-label={t('Zettel endgültig löschen')} onClick={() => void run(() => deleteNote(page))}><Icon name="trash" /></button>
          </div>
        </header>
        <div className="notebook-day">
          <button type="button" role="switch" className="switch" aria-checked={onDay} aria-labelledby="notebook-on-day" onClick={() => void run(() => patch(page.id, onDayPatch(page, !onDay, today)))}><span /></button>
          <label id="notebook-on-day">{t('Auf dem Tag zeigen')}</label>
          <small>{page.dates.length > 1 ? t('auf {0} Tagen', page.dates.length) : formatDate(onDay ? page.dates[0] : created)}</small>
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
            {attachments.map(card => <li key={card.id} className={`notebook-attachment is-${card.kind}`} data-attachment-id={card.id}>
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
          <button type="button" className="notebook-new" onClick={newNote}><Icon name="pencil" /><span>{t('Neuer Zettel')}</span></button>
          {status && <p className="notebook-status" role="status">{status}</p>}
        </div>}
    </div>
    {lightbox && <Lightbox card={lightbox} onClose={() => setLightbox(null)} />}
  </section>;
}
