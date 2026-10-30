import { useEffect, useRef } from 'react';
import type { Settings } from '../settings';
import type { ActionLayout } from './EntryActionDock';

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

export function SettingsDialog({ settings, onChange, onClose }: { settings: Settings; onChange: (settings: Settings) => void; onClose: () => void }) {
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    return () => previous?.focus({ preventScroll: true });
  }, []);
  return <div className="shortcut-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialogRef} className="shortcuts settings" role="dialog" aria-modal="true" aria-label="Einstellungen" tabIndex={-1}
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
      <div className="shortcuts-head"><strong>Einstellungen</strong><span><kbd>Strg</kbd> <kbd>,</kbd></span></div>
      <h3 id="settings-layout">Aktionen am Eintrag</h3>
      <div className="settings-options" role="radiogroup" aria-labelledby="settings-layout" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
        const next = layouts[(layouts.findIndex(layout => layout.value === settings.actionLayout) + step + layouts.length) % layouts.length].value;
        onChange({ ...settings, actionLayout: next });
        requestAnimationFrame(() => dialogRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus());
      }}>
        {layouts.map(layout => <button key={layout.value} type="button" role="radio" className="settings-option" aria-checked={settings.actionLayout === layout.value}
          tabIndex={settings.actionLayout === layout.value ? 0 : -1} data-layout={layout.value} onClick={event => { event.currentTarget.focus(); onChange({ ...settings, actionLayout: layout.value }); }}>
          <Preview layout={layout.value} />
          <strong>{layout.title}</strong>
          <span>{layout.text}</span>
        </button>)}
      </div>
    </div>
  </div>;
}
