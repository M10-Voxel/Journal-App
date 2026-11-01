import { t, useLanguage } from '../i18n';
import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { mailApi } from '../mailApi';
import type { MailModelStatus } from '../mailApi';

export function MailModelSetup() {
  useLanguage();
  const [status, setStatus] = useState<MailModelStatus | null>(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const reload = () => { void mailApi.modelStatus().then(value => { if (active) setStatus(value); }).catch(error => { if (active) setError(String(error)); }); };
    const stop = listen('mail:ml', reload); reload();
    return () => { active = false; void stop.then(fn => fn()); };
  }, []);
  const run = async (action: () => Promise<void>) => {
    setError('');
    try { await action(); setStatus(await mailApi.modelStatus()); } catch (error) { setError(String(error)); setStatus(await mailApi.modelStatus().catch(() => null)); }
  };
  const amount = (bytes: number) => `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 0 })} MB`;
  return <div className="mail-model" aria-label={t("Lokale Mailauswertung")}>
    <strong>{t("Kontextbezogene Mailauswertung")}</strong>
    <p>{t("Ein spezialisiertes ML-Modell erkennt Termine, Datum und Uhrzeit im Zusammenhang – auch über mehrere Zeilen. Es arbeitet ausschließlich mit Mailtexten, lokal auf diesem PC. Erkannte Termine werden automatisch eingetragen; ein Hinweis bestätigt die Übernahme.")}</p>
    {status?.installed ? <>
      <label className="mail-check"><input type="checkbox" checked={status.enabled} disabled={status.installing} onChange={event => void run(() => mailApi.enableModel(event.target.checked))} />{t("Lokale ML-Mailauswertung aktiv")}</label>
      <p className="mail-storage">{status.enabled ? t("Modell bereit · keine Übertragung der Mailtexte an einen Analysedienst.") : t("Pausiert: Freie Mailtexte warten auf die erneute Aktivierung. ICS-Anhänge können weiterhin verarbeitet werden.")}</p>
    </> : <>
      <p className="mail-storage">{t("Einmalige Einrichtung: ca. 1,3 GB für Modell und Laufzeit. Danach offline nutzbar. Der Speicherbedarf steigt nur während der Mailauswertung; das Modell wird nach Inaktivität entladen.")}</p>
      <div className="mail-actions"><button className="mail-button is-primary" type="button" disabled={status?.installing} onClick={() => void run(() => mailApi.installModel())}>{t("Modell herunterladen und aktivieren")}</button>
        <button className="mail-button" type="button" disabled={status?.installing} onClick={() => void run(() => mailApi.installModel(true))}>{t("Vorhandenen Modellordner verwenden")}</button></div>
    </>}
    {status?.installing && <div className="mail-model-progress" role="status"><progress max={status.total || 1} value={status.downloaded} /><span>{t("Einrichtung läuft · ")}{amount(status.downloaded)}{status.total ? t(" von {0}", amount(status.total)) : ''}</span></div>}
    {(error || status?.error) && <p className="mail-error" role="alert">{error || status?.error}</p>}
  </div>;
}
