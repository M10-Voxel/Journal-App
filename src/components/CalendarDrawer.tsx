import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { useSidebarWidth } from './useSidebarWidth';
import { t, useLanguage } from '../i18n';
import { Icon } from './Icon';

const openKey = 'journal.calendarDrawer';
/** Whether the calendar lies next to the book, remembered on the device. `animated` stays off for the state at start. */
export function useCalendarDrawer() {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(openKey) === '1'; } catch { return false; } });
  const [animated, setAnimated] = useState(false);
  const change = (next: boolean | ((open: boolean) => boolean)) => setOpen(current => {
    const value = typeof next === 'function' ? next(current) : next;
    try { localStorage.setItem(openKey, value ? '1' : '0'); } catch { /* keep it for this session */ }
    return value;
  });
  return { open, animated, setOpen: (next: boolean | ((open: boolean) => boolean)) => { setAnimated(true); change(next); } };
}

/**
 * The journal style's calendar: a sheet of paper pulled out at the book's left edge (its tab, CalendarTab). As an
 * `overlay` it lies over the left page of the book (inside JournalBook); otherwise it lies down left of the book, which
 * moves aside. Its width is dragged at its edge like the sidebar's (`resizable`; over a spread it covers the left page).
 */
export function CalendarDrawer({ open, animated, width, resizer, resizable = true, overlay = false, disabled, onClose, children }: {
  open: boolean; animated: boolean; width: number; resizer: ReturnType<typeof useSidebarWidth>['handle']; resizable?: boolean; overlay?: boolean; disabled?: boolean; onClose: () => void; children: ReactNode;
}) {
  useLanguage();
  return <aside className={`calendar-drawer${overlay ? ' is-overlay' : ''}${open ? ' is-open' : ''}${animated ? ' is-animated' : ''}`} style={{ '--drawer-width': `${width}px` } as CSSProperties}
    aria-label={t('Kalender und Navigation')} aria-hidden={!open || undefined} inert={!open || disabled}
    onKeyDown={event => { if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as Element).closest('input, textarea, [contenteditable="true"], [role="dialog"]')) { event.preventDefault(); onClose(); } }}>
    <div className="calendar-drawer-sheet">
      {children}
    </div>
    {open && resizable && <div className="sidebar-resizer" {...resizer} />}
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
