import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage, t } from '../i18n';
import { readVaultPreferences } from '../vaultPreferences';
import { Icon } from './Icon';

export function StorageSettings({ beforeChange, onBusy }: { beforeChange: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  useLanguage();
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
    <h3>{t("Journal-Vault")}</h3>
    <p className="settings-hint">{t("Ein Ordner für Tage, Kalender, Notizen, Aktivitäten, Tags, Bilder und Mail-Daten.")}</p>
    <label className="system-path">{t("Aktueller Ordner")}<output data-vault-path>{path || '…'}</output></label>
    <div className="system-actions">
      <button type="button" disabled={busy} data-vault-open onClick={() => void choose('open')}><Icon name="journal" />{t("Vault öffnen")}</button>
      <button type="button" disabled={busy} data-vault-copy onClick={() => void choose('copy')}><Icon name="copy" />{t("Aktuellen Stand übernehmen…")}</button>
      <button type="button" disabled={busy} data-vault-empty onClick={() => void choose('empty')}>{t("Leeren Vault anlegen")}</button>
    </div>
    <p className="settings-hint">{t("Für einen neuen Vault einen leeren Ordner wählen. Beim Wechsel startet Journal neu; der bisherige Ordner bleibt erhalten. Design, Google-Drive-Anmeldung und das Modell zur Mail-Erkennung bleiben auf diesem Gerät. Mail-Zugangsdaten müssen auf einem anderen Gerät erneut eingegeben werden.")}</p>
    {choice && <div className="system-confirm" role="group" aria-label={t("Vault-Wechsel bestätigen")}>
      <strong>{choice.mode === 'copy' ? (t("Daten übernehmen und wechseln?")) : (t("Vault wechseln?"))}</strong>
      <p className="system-target">{choice.path}</p>
      <div className="system-actions"><button type="button" disabled={busy} data-vault-confirm onClick={() => void activate()}>{t("Speichern und neu starten")}</button>
        <button type="button" disabled={busy} onClick={() => setChoice(null)}>{t("Abbrechen")}</button></div>
    </div>}
    {busy && <p role="status">{t("Vault wird vorbereitet…")}</p>}
    {message && <p role="alert" className="system-message">{message}</p>}
  </section>;
}
