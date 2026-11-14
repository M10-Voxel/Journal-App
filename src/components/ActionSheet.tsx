import { t, useLanguage } from '../i18n';
import { useState } from 'react';
import type { FocusEvent, ReactNode } from 'react';
import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { PopupLook } from '../popupLook';

/** The groups an entry's actions fall in, in this order. */
export type SheetGroup = 'status' | 'entry' | 'plan' | 'order' | 'remove';
export const sheetGroups = (): { id: SheetGroup; title: string }[] => [
  { id: 'status', title: t('Status') }, { id: 'entry', title: t('Eintrag') }, { id: 'plan', title: t('Planen') }, { id: 'order', title: t('Ordnen') }, { id: 'remove', title: t('Löschen') },
];
export interface SheetItem {
  id: string; label: string; short: string; icon: IconName; group: SheetGroup;
  /** Terminal command and key hint (Alt D …). */
  command: string; keys?: string;
  disabled?: boolean; current?: boolean; primary?: boolean;
  /** Hover/focus previews on the entry itself (see EntryActionDock's `previewing`). */
  preview?: { onPointerMove: () => void; onPointerLeave: () => void; onFocus: (event: FocusEvent<HTMLButtonElement>) => void; onBlur: () => void };
  run: () => void;
}

/**
 * An entry's actions in the popup look's own build (all looks but Normal · Karte, which keeps the orbit):
 * - Glas: a frosted strip of tiles, icon over word, the groups apart;
 * - Karteikarte: an index card – the entry on top, the actions as a ticked list in columns by group;
 * - Sticker: a cut-out sticker, the actions a grid of small icon stickers with their word („erledigt“, „morgen“ …);
 * - Sticker-Bogen: a sheet of paper, every action its own sticker (a little tilted, „Wort klein-Zusatz“), the groups
 *   apart by dashed cut lines;
 * - Papierschnipsel: torn paper under washi tape, the actions a handwritten list, an ink scribble around the choice;
 * - Terminal: a prompt to type a command (filtered as typed, Enter runs) over the list of commands;
 * - Holo-Papier: a small window – title bar, menu of groups, big toolbar buttons and a status bar describing the action.
 * Arrow keys move between all buttons (EntryActionDock), Escape closes.
 */
export function ActionSheet({ look, title, items, onClose }: { look: PopupLook; title: string; items: SheetItem[]; onClose: () => void }) {
  useLanguage();
  const [tab, setTab] = useState<SheetGroup | null>(null);
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState<SheetItem | null>(null);
  const groups = sheetGroups().map(group => ({ ...group, items: items.filter(item => item.group === group.id) })).filter(group => group.items.length);
  const run = (item: SheetItem) => { if (!item.current && !item.disabled) item.run(); };
  const button = (item: SheetItem, content: ReactNode, className = '') => <button key={item.id} type="button" className={`sheet-action sheet-${item.id}${className}`} disabled={item.disabled}
    aria-pressed={item.current ?? undefined} aria-label={item.label} data-primary-action={item.primary ? 'true' : undefined} title={item.keys ? `${item.label} · ${item.keys}` : item.label}
    {...(item.preview && !item.current ? item.preview : {})}
    onPointerEnter={() => setHint(item)} onFocusCapture={() => setHint(item)} onClick={() => run(item)}>{content}</button>;

  if (look === 'classic-b') return <div className="entry-dock sheet sheet-glass">
    {groups.map(group => <div className="sheet-group" key={group.id} role="group" aria-label={group.title}>
      {group.items.map(item => button(item, <><Icon name={item.icon} /><span>{item.short}</span></>))}
    </div>)}
  </div>;

  if (look === 'journal-a') return <div className="entry-dock sheet sheet-card">
    <header className="sheet-card-head"><span>{title}</span></header>
    <div className="sheet-columns">
      {groups.map(group => <section key={group.id} aria-label={group.title}>
        <h4>{group.title}</h4>
        {group.items.map(item => button(item, <><span className="sheet-box" aria-hidden="true">{item.current ? '✓' : ''}</span><span>{item.label.replace(/ …$/, '')}</span></>))}
      </section>)}
    </div>
  </div>;

  if (look === 'journal-b') return <div className="entry-dock sheet sheet-stickers">
    <header className="sheet-sticker-head"><span>{title || t('Eintrag')}</span></header>
    {groups.map(group => <div className={`sheet-group is-${group.id}`} key={group.id} role="group" aria-label={group.title}>
      {group.items.map(item => button(item, <><span className="sheet-badge" aria-hidden="true"><Icon name={item.icon} /></span><span>{item.short}</span></>))}
    </div>)}
  </div>;

  if (look === 'journal-c') {
    let index = 0;
    return <div className="entry-dock sheet sheet-sheet">
      <header className="sheet-sheet-head"><b>{title || t('Eintrag')}</b><small>{t('Sticker-Bogen')}</small></header>
      {groups.map(group => <section key={group.id} className={`sheet-group is-${group.id}`} aria-label={group.title}>
        <h4>{group.title}</h4>
        <div className="sheet-sheet-row">
          {group.items.map(item => button(item, <><Icon name={item.icon} /><b>{item.short}</b>{item.keys && <small>{item.keys.toLowerCase()}</small>}</>, ` tilt-${index++ % 4}`))}
        </div>
      </section>)}
    </div>;
  }

  if (look === 'journal-d') return <div className="entry-dock sheet sheet-scrap">
    <span className="sheet-scrap-tape" aria-hidden="true" />
    <header className="sheet-scrap-head">{title || t('Eintrag')}</header>
    {groups.map(group => <section key={group.id} className={`sheet-group is-${group.id}`} aria-label={group.title}>
      <h4>{group.title}</h4>
      {group.items.map(item => button(item, <><span className="sheet-word"><Scribble className="sheet-scribble" />{item.label.replace(/ …$/, '')}</span>{item.keys && <kbd>{item.keys}</kbd>}</>))}
    </section>)}
  </div>;

  if (look === 'nebula-a') {
    const wanted = query.trim().toLowerCase();
    const shown = wanted ? items.filter(item => !item.disabled && (item.command.startsWith(wanted) || item.label.toLowerCase().includes(wanted))) : items;
    return <div className="entry-dock sheet sheet-terminal">
      <label className="sheet-prompt"><span aria-hidden="true">{'>'}</span>
        <input value={query} data-primary-action="true" spellCheck={false} autoComplete="off" placeholder={t('befehl eingeben …')} aria-label={t('Befehl')}
          onChange={event => setQuery(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && shown[0]) { event.preventDefault(); run(shown.find(item => !item.current) ?? shown[0]); }
            else if (event.key === 'ArrowDown') { event.preventDefault(); event.currentTarget.closest('.sheet')?.querySelector<HTMLButtonElement>('.sheet-action:not(:disabled)')?.focus(); }
            else if (event.key === 'Escape' && query) { event.preventDefault(); event.stopPropagation(); setQuery(''); }
          }} /></label>
      <div className="sheet-commands" role="list">
        {shown.map(item => button(item, <><span className="sheet-command">{item.command}</span><span className="sheet-desc">{item.label.replace(/ …$/, '')}{item.current ? ` ${t('(aktuell)')}` : ''}</span>{item.keys && <kbd>{item.keys}</kbd>}</>))}
        {!shown.length && <p className="sheet-empty">{t('kein befehl: {0}', query)}</p>}
      </div>
    </div>;
  }

  // nebula-b: a compact window. Its menu doubles as a filter (the active group again shows all). The full toolbar has
  // two rows of about the same width: status, planning and deleting; the entry's kind and details, moving.
  const rowOf: Record<SheetGroup, number> = { status: 0, plan: 0, remove: 0, entry: 1, order: 1 };
  const toolbarRows = tab ? [groups.filter(group => group.id === tab)]
    : [0, 1].map(row => groups.filter(group => rowOf[group.id] === row)).filter(row => row.length);
  return <div className="entry-dock sheet sheet-window">
    <div className="sheet-titlebar"><span className="sheet-title">{title || t('Eintrag')}.exe</span>
      <button type="button" className="sheet-close" aria-label={t('Schließen')} onClick={onClose}><Icon name="done" /></button></div>
    <div className="sheet-menubar" role="tablist" aria-label={t('Bereiche')}>
      {groups.map(group => <button key={group.id} type="button" role="tab" aria-selected={tab === group.id}
        title={tab === group.id ? t('Alle anzeigen') : group.title}
        onClick={() => setTab(current => current === group.id ? null : group.id)}>
        <u>{group.title[0]}</u>{group.title.slice(1)}
      </button>)}
    </div>
    <div className={`sheet-toolbar${tab ? ' is-filtered' : ''}`}>
      {toolbarRows.map((row, index) => <div className="sheet-toolbar-row" key={index}>
        {row.map(group => <div className="sheet-group" key={group.id} role="group" aria-label={group.title}>
          {group.items.map(item => button(item, <><Icon name={item.icon} /><span>{item.short}</span></>))}
        </div>)}
      </div>)}
    </div>
    <div className="sheet-statusbar" aria-live="polite">{hint ? <>{hint.label}{hint.keys && <kbd>{hint.keys}</kbd>}</> : t('Bereit')}</div>
  </div>;
}

/** An ink scribble drawn around a word (Papierschnipsel): the choice, and the row pointed at. */
export function Scribble({ className }: { className?: string }) {
  return <svg className={`scribble${className ? ` ${className}` : ''}`} viewBox="0 0 120 40" preserveAspectRatio="none" aria-hidden="true">
    <path d="M14 22 C 10 8, 60 3, 104 9 C 120 12, 118 32, 92 35 C 60 39, 16 37, 8 26 C 3 18, 30 6, 62 6" />
  </svg>;
}
