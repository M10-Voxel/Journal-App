import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLanguage, t } from '../i18n';
import { mailApi } from '../mailApi';
import type { MailLearningStatus } from '../mailApi';

export function MailLearningSettings() {
  useLanguage();
  const [status, setStatus] = useState<MailLearningStatus | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const transfer = async (kind: 'export' | 'import') => {
    if (kind === 'import' && status && status.accepted + status.rejected > 0 && !window.confirm(t("Persönliches Training ersetzen? Exportiere deinen aktuellen Stand vorher, wenn du ihn behalten möchtest."))) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const done = await (kind === 'export' ? mailApi.exportLearning() : mailApi.importLearning());
      if (done) {
        setStatus(await mailApi.learningStatus());
        setMessage(kind === 'export' ? (t("Training exportiert. Du kannst die Datei weitergeben.")) : (t("Training importiert. Du kannst es mit deinen Entscheidungen weitertrainieren.")));
      }
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    let active = true;
    const reload = () => { void mailApi.learningStatus().then(value => { if (active) { setStatus(value); setError(''); } }).catch(reason => { if (active) setError(String(reason)); }); };
    const stop = listen('mail:changed', reload); reload();
    return () => { active = false; void stop.then(fn => fn()); };
  }, []);
  return <div className="mail-model" aria-label={t("Persönliches Training")}>
    <strong>{t("Aus deinen Entscheidungen lernen")}</strong>
    <p>{t("Mit Übernehmen und Ablehnen trainierst du dein persönliches Relevanzmodell. Es lernt aus Absender, Betreff und Terminkontext. Niedrig bewertete Vorschläge bleiben zur Prüfung sichtbar und werden nicht automatisch übernommen.")}</p>
    {status && <p className="mail-storage" role="status">{t("{0} angenommen · {1} abgelehnt. ", status.accepted, status.rejected)}{status.ready ? (t("Persönliche Bewertung aktiv.")) : (t("Die Bewertung startet ab 6 Entscheidungen, davon mindestens 2 Annahmen und 2 Ablehnungen."))}</p>}
    <p className="mail-storage">{t("Das Training wird lokal gespeichert. Exportiere eine Datei zum Weitergeben und importiere sie auf einem anderen Gerät. Sie enthält gelernte Gewichte und Entscheidungszahlen, ohne Mailinhalte, Kontodaten oder einzelne Beispiele. Ein Import ersetzt dein bisheriges Training; danach kannst du weitertrainieren.")}</p>
    <div className="mail-actions">
      <button type="button" className="mail-button" disabled={busy || !status || status.accepted + status.rejected === 0} onClick={() => void transfer('export')}>{t("Training exportieren")}</button>
      <button type="button" className="mail-button" disabled={busy || !status} onClick={() => void transfer('import')}>{t("Training importieren")}</button>
    <button type="button" className="mail-button" disabled={busy || !status || status.accepted + status.rejected === 0} onClick={() => {
      setBusy(true); setError(''); setMessage('');
      void mailApi.resetLearning().then(() => mailApi.learningStatus()).then(setStatus).catch(reason => setError(String(reason))).finally(() => setBusy(false));
    }}>{t("Persönliches Training zurücksetzen")}</button>
    </div>
    {message && <p role="status" className="mail-success">{message}</p>}
    {error && <p role="alert" className="mail-error">{error}</p>}
  </div>;
}
