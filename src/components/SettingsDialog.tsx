import { useEffect, useRef, useState } from 'react';
import type { Settings } from '../settings';
import type { ActionLayout } from './EntryActionDock';
import type { CalendarImport } from '../journal';
import { MailSettings } from './MailSettings';
import { Icon } from './Icon';

const layouts: { value: ActionLayout; title: string; text: string }[] = [
  { value: 'orbit', title: 'Orbit', text: 'Aktionen kreisen um den Punkt, Planen sitzt am Zeilenende.' },
  { value: 'inline', title: 'Eingebettet', text: 'Eine Zeile Wörter im Text, ohne Fenster.' },
  { value: 'swipe', title: 'Wischen', text: 'Punkt zur Seite ziehen: rechts erledigen, links planen oder löschen. Antippen schaltet weiter.' },
];

// Small previews of the layouts, drawn like the real thing: the entry's dot, a text line and its actions.
function Preview({ layout }: { layout: ActionLayout }) {
  return <svg className="settings-preview" viewBox="0 0 120 64" aria-hidden="true">
    <rect x="44" y="18" width="62" height="4" rx="2" className="preview-text" />
    {layout === 'swipe' ? <>
      <rect x="2" y="10" width="34" height="20" rx="4" className="preview-lane" />
      <path d="M8 20h10m-3-3 3 3-3 3" className="preview-thread" />
      <rect x="30" y="10" width="88" height="20" rx="4" className="preview-row" />
      <rect x="52" y="18" width="54" height="4" rx="2" className="preview-text" />
      <circle cx="40" cy="20" r="3.5" className="preview-dot" />
      <path d="M40 42h-14m4-4-4 4 4 4M40 42h14m-4-4 4 4-4 4" className="preview-thread" />
    </> : layout === 'inline' ? <>
      <path d="M24 26v13.5h12" className="preview-thread" />
      {[40, 58, 76, 94].map((x, index) => <rect key={x} x={x} y="38" width={index === 0 ? 14 : 12} height="3" rx="1.5" className={index === 1 ? 'preview-satellite' : 'preview-text'} />)}
      <rect x="44" y="50" width="48" height="4" rx="2" className="preview-text" />
    </> : <>
      <circle cx="24" cy="20" r="14" className="preview-orbit" />
      {[270, 315, 45, 90, 135, 180, 225].map(angle => <circle key={angle} cx={24 + 14 * Math.cos(angle * Math.PI / 180)} cy={20 + 14 * Math.sin(angle * Math.PI / 180)} r="4" className="preview-satellite" />)}
      <rect x="82" y="30" width="24" height="9" rx="4.5" className="preview-pill" />
    </>}
    <circle cx="24" cy="20" r="3.5" className="preview-dot" />
  </svg>;
}

export function SettingsDialog({ settings, onChange, onClose, onImport, mailStatus }: { settings: Settings; onChange: (settings: Settings) => void; onClose: () => void; onImport: (entries: CalendarImport[]) => Promise<void>; mailStatus: { count: number; error: string } }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState('appearance');
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('.settings-option[aria-checked="true"]')?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="shortcut-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="shortcuts settings dialog-panes" role="dialog" aria-modal="true" aria-label="Einstellungen" tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <div className="settings-head">
        <Icon name="settings" /><strong>Einstellungen</strong>
        <span className="settings-keys"><kbd>Strg</kbd> <kbd>,</kbd></span>
        <button type="button" className="settings-close" aria-label="Einstellungen schließen" title="Schließen · Esc" onClick={onClose}><Icon name="done" /></button>
      </div>
      <div className="settings-body">
      <div className="settings-tabs" role="tablist" aria-label="Einstellungsbereich" aria-orientation="vertical" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const next = event.key === 'Home' ? 'appearance' : event.key === 'End' ? 'mail' : tab === 'appearance' ? 'mail' : 'appearance';
        setTab(next); dialogRef.current?.querySelector<HTMLButtonElement>(`#settings-${next}-tab`)?.focus();
      }}>
        <button id="settings-appearance-tab" type="button" role="tab" tabIndex={tab === 'appearance' ? 0 : -1} aria-selected={tab === 'appearance'} aria-controls="settings-appearance" onClick={event => { event.currentTarget.focus(); setTab('appearance'); }}><Icon name="layout" />Darstellung</button>
        <button id="settings-mail-tab" type="button" role="tab" tabIndex={tab === 'mail' ? 0 : -1} aria-selected={tab === 'mail'} aria-controls="settings-mail" onClick={event => { event.currentTarget.focus(); setTab('mail'); }}><Icon name="mail" />E-Mail-Konten{mailStatus.count > 0 && <span className="mail-badge">{mailStatus.count}</span>}</button>
      </div>
      {tab === 'appearance' ? <div className="settings-panel" role="tabpanel" id="settings-appearance" aria-labelledby="settings-appearance-tab">
      <h3 id="settings-theme">Theme</h3>
      <p className="settings-hint">Gleiche Farben und Bedienung, ein anderer Stil.</p>
      <div className="theme-options" role="radiogroup" aria-labelledby="settings-theme" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const theme = settings.theme === 'pixel' ? 'classic' : 'pixel';
        onChange({ ...settings, theme });
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>(`[data-theme-choice="${theme}"]`)?.focus());
      }}>
        {(['classic', 'pixel'] as const).map(theme => <button key={theme} type="button" role="radio" aria-checked={settings.theme === theme} tabIndex={settings.theme === theme ? 0 : -1} data-theme-choice={theme}
          onClick={() => onChange({ ...settings, theme })}>
          <span className={`theme-sample is-${theme}`} aria-hidden="true"><span>Aa</span><i /><i /><i /></span>
          <strong>{theme === 'classic' ? 'Klassisch' : 'Pixel'}</strong>
          <small>{theme === 'classic' ? 'IBM Plex Sans · Lilex' : 'Pixelify Sans · VT323'}</small>
        </button>)}
      </div>
      <h3 id="settings-layout">Aktionen am Eintrag</h3>
      <p className="settings-hint">Wie sich die Aktionen eines Eintrags zeigen, wenn man auf seinen Punkt klickt. <kbd>←</kbd> <kbd>→</kbd> wählt.</p>
      <div className="settings-options" role="radiogroup" aria-labelledby="settings-layout" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const next = layouts[(layouts.findIndex(layout => layout.value === settings.actionLayout) + step + layouts.length) % layouts.length].value;
        onChange({ ...settings, actionLayout: next });
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('.settings-option[aria-checked="true"]')?.focus());
      }}>
        {layouts.map(layout => <button key={layout.value} type="button" role="radio" className="settings-option" aria-checked={settings.actionLayout === layout.value}
          tabIndex={settings.actionLayout === layout.value ? 0 : -1} data-layout={layout.value} onClick={event => { event.currentTarget.focus(); onChange({ ...settings, actionLayout: layout.value }); }}>
          <Preview layout={layout.value} />
          <strong>{layout.title}</strong>
          <span>{layout.text}</span>
        </button>)}
      </div>
      </div> : <div className="settings-panel" role="tabpanel" id="settings-mail" aria-labelledby="settings-mail-tab"><MailSettings onImport={onImport} importError={mailStatus.error} /></div>}
      </div>
    </div>
  </div>;
}
