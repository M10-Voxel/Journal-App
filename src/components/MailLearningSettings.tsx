import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useLanguage } from '../i18n';
import { mailApi } from '../mailApi';
import type { MailLearningStatus } from '../mailApi';

export function MailLearningSettings() {
  const en = useLanguage() === 'en';
  const [status, setStatus] = useState<MailLearningStatus | null>(null);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const transfer = async (kind: 'export' | 'import') => {
    if (kind === 'import' && status && status.accepted + status.rejected > 0 && !window.confirm(en ? 'Replace personal training? Export your current training first if you want to keep it.' : 'Persönliches Training ersetzen? Exportiere deinen aktuellen Stand vorher, wenn du ihn behalten möchtest.')) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const done = await (kind === 'export' ? mailApi.exportLearning() : mailApi.importLearning());
      if (done) {
        setStatus(await mailApi.learningStatus());
        setMessage(kind === 'export' ? (en ? 'Training exported. You can share this file.' : 'Training exportiert. Du kannst die Datei weitergeben.') : (en ? 'Training imported. You can continue training it with your decisions.' : 'Training importiert. Du kannst es mit deinen Entscheidungen weitertrainieren.'));
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
  return <div className="mail-model" aria-label={en ? 'Personal training' : 'Persönliches Training'}>
    <strong>{en ? 'Learn from your decisions' : 'Aus deinen Entscheidungen lernen'}</strong>
    <p>{en ? 'Accept or reject suggestions below to train your personal relevance model. It learns from sender, subject and event context. Suggestions rated low stay available for review and are not added automatically.' : 'Mit Übernehmen und Ablehnen trainierst du dein persönliches Relevanzmodell. Es lernt aus Absender, Betreff und Terminkontext. Niedrig bewertete Vorschläge bleiben zur Prüfung sichtbar und werden nicht automatisch übernommen.'}</p>
    {status && <p className="mail-storage" role="status">{en ? `${status.accepted} accepted · ${status.rejected} rejected. ` : `${status.accepted} angenommen · ${status.rejected} abgelehnt. `}{status.ready ? (en ? 'Personal assessment active.' : 'Persönliche Bewertung aktiv.') : (en ? 'Assessment starts after at least 6 decisions, including 2 of each kind.' : 'Die Bewertung startet ab 6 Entscheidungen, davon mindestens 2 Annahmen und 2 Ablehnungen.')}</p>}
    <p className="mail-storage">{en ? 'Training is stored locally. Export a file to share your learned filter, then import it on another device. It contains learned weights and decision counts, without mail contents, account details or individual examples. Import replaces your current training; you can continue training afterwards.' : 'Das Training wird lokal gespeichert. Exportiere eine Datei zum Weitergeben und importiere sie auf einem anderen Gerät. Sie enthält gelernte Gewichte und Entscheidungszahlen, ohne Mailinhalte, Kontodaten oder einzelne Beispiele. Ein Import ersetzt dein bisheriges Training; danach kannst du weitertrainieren.'}</p>
    <div className="mail-actions">
      <button type="button" className="mail-button" disabled={busy || !status || status.accepted + status.rejected === 0} onClick={() => void transfer('export')}>{en ? 'Export training' : 'Training exportieren'}</button>
      <button type="button" className="mail-button" disabled={busy || !status} onClick={() => void transfer('import')}>{en ? 'Import training' : 'Training importieren'}</button>
    <button type="button" className="mail-button" disabled={busy || !status || status.accepted + status.rejected === 0} onClick={() => {
      setBusy(true); setError(''); setMessage('');
      void mailApi.resetLearning().then(() => mailApi.learningStatus()).then(setStatus).catch(reason => setError(String(reason))).finally(() => setBusy(false));
    }}>{en ? 'Reset personal training' : 'Persönliches Training zurücksetzen'}</button>
    </div>
    {message && <p role="status" className="mail-success">{message}</p>}
    {error && <p role="alert" className="mail-error">{error}</p>}
  </div>;
}
