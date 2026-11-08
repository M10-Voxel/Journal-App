import { useEffect, useRef, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import { check } from '@tauri-apps/plugin-updater';
import type { Update } from '@tauri-apps/plugin-updater';
import { useLanguage } from '../i18n';
import { readVaultPreferences } from '../vaultPreferences';
import { startupUpdate } from '../startupUpdate';
import { Icon } from './Icon';

export function UpdateSettings({ beforeChange, onBusy }: { beforeChange: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const en = useLanguage() === 'en';
  const [version, setVersion] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [available, setAvailable] = useState<Update | null>(null), [downloaded, setDownloaded] = useState(false);
  const [progress, setProgress] = useState<{ bytes: number; total?: number } | null>(null);
  const resource = useRef<Update | null>(null);
  const mounted = useRef(true), requested = useRef(false), finding = useRef<Promise<void> | null>(null);
  useEffect(() => {
    mounted.current = true;
    void getVersion().then(value => { if (mounted.current) setVersion(value); }).catch(() => {});
    // Opening Updates from the startup notice immediately shows the download controls.
    void startupUpdate().then(update => { if (update && mounted.current && !requested.current) void run(find); });
    return () => { mounted.current = false; if (resource.current) void resource.current.close().catch(() => {}); };
  }, []);
  async function run(action: () => Promise<void>) {
    requested.current = true;
    setBusy(true); onBusy(true); setMessage('');
    try { await action(); }
    catch (e) {
      const reason = String(e);
      setMessage(/404|release manifest|update endpoint|release json/i.test(reason)
        ? (en ? `The update source is unavailable or no update has been published yet. Check the connection and GitHub release files. ${reason}` : `Die Updatequelle ist nicht erreichbar oder es wurde noch kein Update veröffentlicht. Verbindung und GitHub-Release-Dateien prüfen. ${reason}`)
        : `${en ? 'Update failed: ' : 'Update fehlgeschlagen: '}${reason}`);
    } finally { setBusy(false); onBusy(false); }
  }
  async function find() {
    if (finding.current) return finding.current;
    const request = findAvailable();
    finding.current = request;
    try { await request; } finally { finding.current = null; }
  }
  async function findAvailable() {
    if (resource.current) await resource.current.close();
    if (!mounted.current) return;
    resource.current = null; setAvailable(null); setDownloaded(false); setProgress(null);
    const update = await check({ timeout: 20_000 });
    if (!mounted.current) { await update?.close(); return; }
    resource.current = update; setAvailable(update);
    if (!update) setMessage(en ? 'You are up to date.' : 'Du verwendest die aktuelle Version.');
  }
  async function download() {
    const update = resource.current;
    if (!update) return;
    let bytes = 0, total: number | undefined;
    await update.download(event => {
      if (event.event === 'Started') total = event.data.contentLength;
      if (event.event === 'Progress') bytes += event.data.chunkLength;
      setProgress({ bytes, total });
    }, { timeout: 600_000 });
    setDownloaded(true);
    setMessage(en ? 'Download verified. Ready to install.' : 'Download geprüft. Bereit zur Installation.');
  }
  async function install() {
    if (!resource.current || !downloaded) return;
    await beforeChange();
    await invoke('vault_save_preferences', { preferences: readVaultPreferences(localStorage) });
    await resource.current.install({ restartAfterInstall: true });
  }
  return <section className="settings-section system-settings" aria-busy={busy}>
    <h3>{en ? 'App updates' : 'App-Updates'}</h3>
    <p className="settings-hint">{en ? 'Installed version' : 'Installierte Version'}: <strong data-app-version>{version || '…'}</strong></p>
    <p className="settings-hint">{en ? 'Journal checks once on startup and notifies you when an update is available. Downloading and installing only start when you choose them.' : 'Journal sucht bei jedem Start einmal nach Updates und meldet verfügbare Versionen. Herunterladen und Installieren startest du selbst.'}</p>
    <p className="settings-hint">{en ? 'Updates are downloaded from this project’s GitHub releases and verified with a cryptographic signature before installation. Your vault and connections are preserved.' : 'Updates werden aus den GitHub-Releases dieses Projekts heruntergeladen und vor der Installation anhand einer kryptografischen Signatur geprüft. Dein Vault und deine Verbindungen bleiben erhalten.'}</p>
    <div className="system-actions"><button type="button" disabled={busy} data-update-check onClick={() => void run(find)}><Icon name="repeat" />{en ? 'Check for updates' : 'Nach Updates suchen'}</button></div>
    {available && <div className="system-confirm">
      <strong data-update-version>{en ? 'Available version' : 'Verfügbare Version'}: {available.version}</strong>
      {available.body && <p className="system-release-notes">{available.body}</p>}
      <div className="system-actions">{downloaded
        ? <button type="button" disabled={busy} data-update-install onClick={() => void run(install)}>{en ? 'Install and restart' : 'Installieren und neu starten'}</button>
        : <button type="button" disabled={busy} data-update-download onClick={() => void run(download)}><Icon name="down" />{en ? 'Download update' : 'Update herunterladen'}</button>}</div>
    </div>}
    {progress && !downloaded && <><progress aria-label={en ? 'Download progress' : 'Download-Fortschritt'} max={progress.total || 1} value={progress.total ? progress.bytes : undefined} /><p className="system-message">{(progress.bytes / 1048576).toFixed(1)} MB{progress.total ? ` / ${(progress.total / 1048576).toFixed(1)} MB` : ''}</p></>}
    <p role="status" className="system-message">{busy && !progress ? (en ? 'Please wait…' : 'Bitte warten…') : message}</p>
  </section>;
}
