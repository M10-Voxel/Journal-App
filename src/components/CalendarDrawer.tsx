import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { useSidebarWidth } from './useSidebarWidth';
import { t, useLanguage } from '../i18n';
import { Icon } from './Icon';

/** Whether a sheet (the calendar, the notebook) is out, remembered on the device. `animated` stays off for the state at start. */
export function useDrawer(key: string) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return false; } });
  const [animated, setAnimated] = useState(false);
  const change = (next: boolean | ((open: boolean) => boolean)) => setOpen(current => {
    const value = typeof next === 'function' ? next(current) : next;
    try { localStorage.setItem(key, value ? '1' : '0'); } catch { /* keep it for this session */ }
    return value;
  });
  return { open, animated, setOpen: (next: boolean | ((open: boolean) => boolean)) => { setAnimated(true); change(next); } };
}
export const calendarDrawerKey = 'journal.calendarDrawer', notebookDrawerKey = 'journal.notebookDrawer';

/**
 * A sheet of paper pulled out at the book's left edge (its tab: CalendarTab, NotebookTab): the calendar or the notebook
 * (`kind`). As an `overlay` it lies over the left page of the book (inside JournalBook), otherwise it lies
 * down left of the book, which moves aside. Its width is dragged at its edge like the sidebar's (`resizable`; over a
 * spread it covers the left page). Both sheets behave alike, so the book beside them does too. With both out on a spread
 * the notebook lies on the right page (`right`).
 */
export function CalendarDrawer({ open, animated, width, resizer, resizable = true, overlay = false, kind = 'calendar', right = false, label, disabled, onClose, children }: {
  open: boolean; animated: boolean; width: number; resizer?: ReturnType<typeof useSidebarWidth>['handle']; resizable?: boolean; overlay?: boolean; kind?: 'calendar' | 'notebook';
  /** On the right page instead (the notebook while the calendar is out too). */
  right?: boolean; label?: string; disabled?: boolean; onClose: () => void; children: ReactNode;
}) {
  useLanguage();
  const name = 'calendar-drawer';
  return <aside className={`${name} is-${kind}${right ? ' is-right' : ''}${overlay ? ' is-overlay' : ''}${open ? ' is-open' : ''}${animated ? ' is-animated' : ''}`} style={{ '--drawer-width': `${width}px` } as CSSProperties}
    aria-label={label ?? t('Kalender und Navigation')} aria-hidden={!open || undefined} inert={!open || disabled}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('input, textarea, select, [contenteditable="true"], [role="dialog"]')) { event.preventDefault(); onClose(); } }}>
    <div className={`${name}-sheet`}>
      {open && children}
    </div>
    {open && resizable && resizer && <div className="sidebar-resizer" {...resizer} />}
  </aside>;
}

/** The cloth tab on the book's left edge that pulls the calendar out (Ctrl+K) and puts it back. */
export function CalendarTab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  useLanguage();
  return <button type="button" className={`calendar-tab${open ? ' is-open' : ''}`} aria-expanded={open} aria-keyshortcuts="Control+K"
    title={open ? t('Kalender zurücklegen · Strg K') : t('Kalender herausziehen · Strg K')} onClick={onToggle}>
    <Icon name="calendar" /><span>{t('Kalender')}</span>
  </button>;
}
/** The same kind of tab below it for the notebook (Ctrl+Shift+N). */
export function NotebookTab({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  useLanguage();
  return <button type="button" className={`notebook-tab${open ? ' is-open' : ''}`} aria-expanded={open} aria-keyshortcuts="Control+Shift+N"
    title={open ? t('Notizen zurücklegen · Strg ⇧ N') : t('Notizen herausziehen · Strg ⇧ N')} onClick={onToggle}>
    <Icon name="note" /><span>{t('Notizen')}</span>
  </button>;
}
