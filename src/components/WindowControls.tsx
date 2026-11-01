import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';

export function WindowControls({ onError }: { onError: (message: string) => void }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    const window = getCurrentWindow();
    let active = true;
    const refresh = () => { void window.isMaximized().then(value => { if (active) setMaximized(Boolean(value)); }, () => {}); };
    refresh();
    const stop = window.onResized(refresh);
    return () => { active = false; void stop.then(unlisten => unlisten()); };
  }, []);
  const run = (action: () => Promise<void>) => { void action().catch(reason => onError(`Fensteraktion fehlgeschlagen: ${String(reason)}`)); };
  return <div className="window-controls" role="group" aria-label="Fenstersteuerung">
    <button type="button" aria-label="Minimieren" title="Minimieren" onClick={() => run(() => getCurrentWindow().minimize())}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 9h10" /></svg>
    </button>
    <button type="button" aria-label={maximized ? 'Wiederherstellen' : 'Maximieren'} title={maximized ? 'Wiederherstellen' : 'Maximieren'} onClick={() => run(async () => { const window = getCurrentWindow(); await window.toggleMaximize(); setMaximized(Boolean(await window.isMaximized())); })}>
      <svg viewBox="0 0 16 16" aria-hidden="true">{maximized ? <><path d="M5.5 5.5v-3h8v8h-3" /><rect x="2.5" y="5.5" width="8" height="8" /></> : <rect x="3" y="3" width="10" height="10" />}</svg>
    </button>
    <button type="button" className="window-close" aria-label="Schließen" title="Schließen" onClick={() => run(() => getCurrentWindow().close())}>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m3.5 3.5 9 9m0-9-9 9" /></svg>
    </button>
  </div>;
}
