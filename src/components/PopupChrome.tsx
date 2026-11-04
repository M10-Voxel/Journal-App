import { t, useLanguage } from '../i18n';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import type { PopupLook } from '../popupLook';

/**
 * The frame a popup look gives the planner, the calendar's card and the small popups (Normal · Karte has none):
 * Glas a grab handle with the title, Karteikarte a heading over a red rule, Notizblock a spiral binding with the title on
 * a tab, Terminal a prompt bar (with ×), Holo-Papier a window title bar (with ×). `PopupTabs` switches views where a
 * popup has several (the planner: date, time, repeat), `PopupKeys` names the keys (Terminal) or shows a status bar
 * (Holo-Papier).
 */
export function PopupHead({ look, title, command, onClose }: { look: PopupLook; title: string; command: string; onClose?: () => void }) {
  useLanguage();
  if (look === 'classic-a') return null;
  const close = onClose && <button type="button" className="chrome-close" aria-label={t('Schließen')} title={t('Schließen · Esc')} onMouseDown={event => event.preventDefault()} onClick={onClose}><Icon name="done" /></button>;
  if (look === 'classic-b') return <div className="chrome-head is-glass" aria-hidden="true"><i /><span>{title}</span></div>;
  if (look === 'journal-a') return <div className="chrome-head is-card"><span>{title}</span></div>;
  if (look === 'journal-b') return <div className="chrome-head is-pad"><span className="chrome-rings" aria-hidden="true" /><span className="chrome-label">{title}</span></div>;
  if (look === 'nebula-a') return <div className="chrome-head is-prompt"><span><b>[journal@~]$</b> ./{command}.sh</span>{close}</div>;
  return <div className="chrome-head is-window"><span>{title}.exe</span>{close}</div>;
}

export function PopupTabs<V extends string>({ look, views, value, onChange }: { look: PopupLook; views: { value: V; label: string; disabled?: boolean }[]; value: V; onChange: (value: V) => void }) {
  if (look === 'classic-a') return null;
  return <div className={`chrome-tabs is-${look}`} role="tablist">
    {views.map(view => <button key={view.value} type="button" role="tab" aria-selected={view.value === value} disabled={view.disabled}
      onMouseDown={event => event.preventDefault()} onClick={() => onChange(view.value)}>{look === 'nebula-a' ? `--${view.label.toLowerCase()}` : view.label}</button>)}
  </div>;
}

export function PopupKeys({ look, keys, status }: { look: PopupLook; keys: [string, string][]; status?: ReactNode }) {
  useLanguage();
  if (look === 'nebula-a') return <div className="chrome-keys is-prompt">{keys.map(([key, label]) => <span key={key}><kbd>{key}</kbd>{label}</span>)}</div>;
  if (look === 'nebula-b') return <div className="chrome-keys is-status">{status ?? t('Bereit')}</div>;
  return null;
}
