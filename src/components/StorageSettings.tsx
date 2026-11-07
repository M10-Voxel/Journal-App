import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage } from '../i18n';
import { readVaultPreferences } from '../vaultPreferences';
import { Icon } from './Icon';

export function StorageSettings({ beforeChange, onBusy }: { beforeChange: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const en = useLanguage() === 'en';
  const [path, setPath] = useState(''), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [choice, setChoice] = useState<{ path: string; mode: string } | null>(null);
  useEffect(() => { void invoke<{ path: string; error: string | null }>('vault_status').then(status => {
    setPath(status.path); if (status.error) setMessage(status.error);
  }).catch(e => setMessage(String(e))); }, []);
  async function choose(mode: string) {
    setMessage(''); setBusy(true); onBusy(true);
    try {
      const selected = await invoke<{ path: string } | null>('vault_choose', { mode });
      if (selected) setChoice({ ...selected, mode });
    } catch (e) { setMessage(String(e)); }
    finally { setBusy(false); onBusy(false); }
  }
  async function activate() {
    if (!choice) return;
    setBusy(true); onBusy(true); setMessage('');
    try {
      await beforeChange();
      await invoke('vault_save_preferences', { preferences: readVaultPreferences(localStorage) });
      await invoke('vault_activate', choice);
    } catch (e) { setMessage(String(e)); setBusy(false); onBusy(false); }
  }
  return <section className="settings-section system-settings" aria-busy={busy}>
    <h3>{en ? 'Journal vault' : 'Journal-Vault'}</h3>
    <p className="settings-hint">{en ? 'A folder containing your days, calendar, notes, activities, tags, images and mail data.' : 'Ein Ordner für Tage, Kalender, Notizen, Aktivitäten, Tags, Bilder und Mail-Daten.'}</p>
    <label className="system-path">{en ? 'Current folder' : 'Aktueller Ordner'}<output data-vault-path>{path || '…'}</output></label>
    <div className="system-actions">
      <button type="button" disabled={busy} data-vault-open onClick={() => void choose('open')}><Icon name="journal" />{en ? 'Open vault' : 'Vault öffnen'}</button>
      <button type="button" disabled={busy} data-vault-copy onClick={() => void choose('copy')}><Icon name="copy" />{en ? 'Copy current data to…' : 'Aktuellen Stand übernehmen…'}</button>
      <button type="button" disabled={busy} data-vault-empty onClick={() => void choose('empty')}>{en ? 'Create empty vault' : 'Leeren Vault anlegen'}</button>
    </div>
    <p className="settings-hint">{en ? 'Use an empty folder for a new vault. Switching restarts Journal; the previous folder is kept. Design, Google Drive login and the mail recognition model stay on this device. Mail credentials copied to another device must be entered again.' : 'Für einen neuen Vault einen leeren Ordner wählen. Beim Wechsel startet Journal neu; der bisherige Ordner bleibt erhalten. Design, Google-Drive-Anmeldung und das Modell zur Mail-Erkennung bleiben auf diesem Gerät. Mail-Zugangsdaten müssen auf einem anderen Gerät erneut eingegeben werden.'}</p>
    {choice && <div className="system-confirm" role="group" aria-label={en ? 'Confirm vault change' : 'Vault-Wechsel bestätigen'}>
      <strong>{choice.mode === 'copy' ? (en ? 'Copy data and switch?' : 'Daten übernehmen und wechseln?') : (en ? 'Switch vault?' : 'Vault wechseln?')}</strong>
      <p className="system-target">{choice.path}</p>
      <div className="system-actions"><button type="button" disabled={busy} data-vault-confirm onClick={() => void activate()}>{en ? 'Save and restart' : 'Speichern und neu starten'}</button>
        <button type="button" disabled={busy} onClick={() => setChoice(null)}>{en ? 'Cancel' : 'Abbrechen'}</button></div>
    </div>}
    {busy && <p role="status">{en ? 'Preparing vault…' : 'Vault wird vorbereitet…'}</p>}
    {message && <p role="alert" className="system-message">{message}</p>}
  </section>;
}
