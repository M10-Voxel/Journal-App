import { useEffect, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useLanguage, t, dateFormat } from '../i18n';
import { parseDeviceKey } from '../sync/deviceKey';
import { encodeBase64 as encode } from '../base64';
import { forgetDeviceKey, onSyncStatus, rememberDeviceKey, resolveConflicts, runSync, setSyncPrefs, setTypedKey, storedDeviceKey, syncPrefs, syncStatus } from '../sync/driveSync';
import { maxMinutes, minMinutes, syncMoments } from '../sync/driveSchedule';
import type { SyncMoment } from '../sync/driveSchedule';

const momentLabels = (): Record<SyncMoment, string> => ({
  save: t('Nach jeder Speicherung'), interval: t('Regelmäßig'), close: t('Beim Schließen des Fensters (×)'), quit: t('Beim Beenden der App'), manual: t('Nur manuell'),
});
const momentNotes = (): Record<SyncMoment, string> => ({
  save: t('Kurz nach dem Speichern (gesammelt, höchstens alle 30 Sekunden); Änderungen der anderen Geräte kommen alle paar Minuten.'),
  interval: t('Im gewählten Abstand; wenn sich nichts geändert hat, kostet das nur eine kurze Anfrage.'),
  close: t('Wenn du das Fenster schließt (Journal läuft im Hintergrund weiter) und beim Beenden.'),
  quit: t('Beim Beenden über das Symbol im Infobereich, auch beim Herunterfahren von Windows (Windows wartet bis zu 25 Sekunden).'),
  manual: t('Nur mit „Jetzt synchronisieren“.'),
});

export function DriveSettings({beforeSync,onBusy}:{beforeSync:()=>Promise<void>;onBusy:(busy:boolean)=>void}) {
  useLanguage();
  const [client,setClient]=useState(''),[secret,setSecret]=useState(''),[keyText,setKeyText]=useState('');
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [stored,setStored]=useState<string|null|undefined>(undefined),[remember,setRemember]=useState(true);
  const [prefs,setPrefs]=useState(syncPrefs);
  const status=useSyncExternalStore(onSyncStatus,syncStatus,syncStatus);
  let keyHint='';
  if(keyText){try{parseDeviceKey(keyText);keyHint=t("Geräteschlüssel erkannt.");}catch(e){keyHint=String(e instanceof Error?e.message:e);}}
  useEffect(()=>{void invoke<{connected:boolean;clientId:string}>('drive_status').then(s=>{setClient(s.clientId);setConnected(s.connected);}).catch(e=>setMessage(String(e)));void storedDeviceKey().then(setStored);},[]);
  useEffect(()=>{setTypedKey(keyText);return()=>setTypedKey('');},[keyText]);
  async function run(action:()=>Promise<void>) {
    setBusy(true);onBusy(true);setMessage('');
    try {await action();}catch(e){setMessage(String(e instanceof Error?e.message:e));}
    finally {setBusy(false);onBusy(false);}
  }
  // A key typed here and "remember" chosen: kept on this device before the sync runs, for the automatic sync.
  const sync=(mode:'merge'|'upload'|'download')=>run(async()=>{
    await beforeSync();
    if(keyText&&remember){await rememberDeviceKey(keyText);setStored(await storedDeviceKey());setKeyText('');setTypedKey('');}
    await runSync(mode,true);
  });
  const hasKey=Boolean(keyText||stored);
  const choose=(moment:SyncMoment)=>{const next={...prefs,moment};setPrefs(next);setSyncPrefs(next);};
  const time=(value:number)=>dateFormat({hour:'2-digit',minute:'2-digit'}).format(new Date(value));
  const automaticWithoutKey=prefs.moment!=='manual'&&(!stored||!connected);
  return <section className="mail-settings drive-settings">
    <h3>Google Drive</h3>
    <p className="settings-hint">{t("Journal, Kalender, Aktivitäten, Pinnwand, Notizen, Tags, Farbschemata, Desk-Layouts, Einstellungen und Mailkonten zwischen deinen Geräten abgleichen. Mailkonten müssen auf jedem Gerät angemeldet werden. Die Daten werden lokal mit deinem Geräteschlüssel verschlüsselt.")}</p>
    <details className="mail-oauth"><summary>{t("Einmalige Google-Einrichtung")}</summary><p>{t("In Google Cloud die Google Drive API aktivieren, einen OAuth-Client vom Typ Desktop-App erstellen und bei einer App im Testbetrieb dein Konto als Testnutzer eintragen. Auf beiden Geräten dieselbe Client-ID verwenden.")}</p><button className="mail-button" onClick={()=>void invoke('drive_help').catch(e=>setMessage(String(e)))}>Google Cloud Console</button></details>
    <label>Google Client-ID<input className="drive-client" value={client} disabled={busy||connected} onChange={e=>setClient(e.target.value.trim())} autoComplete="off" /></label>
    {!connected&&<label>Client-Secret<input type="password" value={secret} disabled={busy} onChange={e=>setSecret(e.target.value)} autoComplete="off" /></label>}
    <div className="mail-actions">{!connected?<button data-drive="connect" className="mail-button is-primary" disabled={busy||!client} onClick={()=>void run(async()=>{await invoke('drive_connect',{clientId:client,clientSecret:secret});setSecret('');setConnected(true);})}>{t("Mit Google Drive verbinden")}</button>:<button className="mail-button" disabled={busy} onClick={()=>void run(async()=>{await invoke('drive_disconnect');setConnected(false);})}>{t("Verbindung trennen")}</button>}{busy&&!connected&&<button className="mail-button" onClick={()=>void invoke('drive_cancel')}>{t("Anmeldung abbrechen")}</button>}</div>
    {stored ? <div className="drive-key-stored" data-drive-key-stored>
        <p className="settings-hint">{t('Der Geräteschlüssel ist auf diesem Gerät gespeichert (von Windows geschützt).')}</p>
        <div className="mail-actions"><button className="mail-button" disabled={busy} onClick={()=>void navigator.clipboard.writeText(stored).then(()=>setMessage(t("Schlüssel kopiert."))).catch(()=>setMessage(t("Zwischenablage nicht verfügbar.")))}>{t("Schlüssel kopieren")}</button>
          <button className="mail-button" data-drive="forget-key" disabled={busy} onClick={()=>void run(async()=>{await forgetDeviceKey();setStored(null);})}>{t('Schlüssel auf diesem Gerät vergessen')}</button></div>
      </div>
      : <>
        <label>{t("Geräteschlüssel")}<input className="drive-key" type="password" value={keyText} disabled={busy} autoComplete="off" aria-describedby="drive-key-hint" placeholder={t("Von Journal erzeugten Schlüssel einfügen")} onChange={e=>setKeyText(e.target.value)} /></label>
        <p id="drive-key-hint" className="settings-hint" role="status">{keyHint||(t("Auf allen Geräten denselben von Journal erzeugten Schlüssel verwenden, nicht dein Google-Passwort."))}</p>
        <label className="drive-remember"><input type="checkbox" data-drive="remember" checked={remember} disabled={busy} onChange={e=>setRemember(e.target.checked)} />{t('Auf diesem Gerät merken (für die automatische Synchronisierung)')}</label>
        <div className="mail-actions"><button data-drive="generate" className="mail-button" disabled={busy||!!keyText} onClick={()=>setKeyText(encode(crypto.getRandomValues(new Uint8Array(32))))}>{t("Neuen Schlüssel erzeugen")}</button><button className="mail-button" disabled={!keyText||busy} onClick={()=>void navigator.clipboard.writeText(keyText).then(()=>setMessage(t("Schlüssel kopiert."))).catch(()=>setMessage(t("Zwischenablage nicht verfügbar.")))}>{t("Schlüssel kopieren")}</button></div>
        <p className="settings-hint">{t("Diesen Schlüssel sicher aufbewahren und auf jedem Gerät eingeben. Ohne ihn können die verschlüsselten Drive-Daten nicht wiederhergestellt werden.")}</p>
      </>}
    <div className="drive-when">
      <label htmlFor="drive-moment">{t('Wann synchronisieren')}</label>
      <div className="drive-when-controls">
        <select id="drive-moment" data-drive="moment" value={prefs.moment} disabled={busy} onChange={e=>choose(e.target.value as SyncMoment)}>
          {syncMoments.map(moment=><option key={moment} value={moment}>{momentLabels()[moment]}</option>)}
        </select>
        {prefs.moment==='interval'&&<label className="drive-minutes">{t('alle')}<input type="number" data-drive="minutes" min={minMinutes} max={maxMinutes} value={prefs.minutes} disabled={busy}
          onChange={e=>{const next={...prefs,minutes:Number(e.target.value)||prefs.minutes};setPrefs(next);}} onBlur={()=>{setSyncPrefs(prefs);setPrefs(syncPrefs());}} />{t('Minuten')}</label>}
      </div>
      <p className="settings-hint">{momentNotes()[prefs.moment]}{prefs.moment!=='manual'&&` ${t('Außerdem beim Start der App.')}`}</p>
      {automaticWithoutKey&&<p className="settings-hint drive-warning" role="status">{t('Für die automatische Synchronisierung den Geräteschlüssel auf diesem Gerät merken und mit Google Drive verbinden.')}</p>}
    </div>
    <p className="drive-status" role="status" data-drive-status={status.state}>
      {status.state==='syncing'?t('Synchronisiert …'):status.state==='conflict'?t('Widersprüchliche Änderungen – bitte unten auswählen.'):status.state==='error'?t('Fehler: {0}',status.message):status.lastSync?t('Zuletzt synchronisiert um {0}.',time(status.lastSync)):t('In dieser Sitzung noch nicht synchronisiert.')}
      {status.nextRetry&&status.state==='error'?` ${t('Nächster Versuch um {0}.',time(status.nextRetry))}`:''}
    </p>
    <button data-drive="sync" className="mail-button is-primary" disabled={busy||!connected||!hasKey||status.state==='syncing'} onClick={()=>void sync('merge')}>{busy?(t("Wird verarbeitet …")):(t("Jetzt synchronisieren"))}</button>
    <details className="drive-replace"><summary>{t("Einen Stand komplett ersetzen")}</summary>
      <p className="settings-hint">{t("Diese Aktionen ersetzen Daten, statt sie zusammenzuführen. Auf allen Geräten dasselbe Konto und denselben Geräteschlüssel verwenden.")}</p>
      <div className="mail-actions">
        <button data-drive="upload-local" className="mail-button" disabled={busy||!connected||!hasKey} onClick={()=>{if(window.confirm(t("Den Cloud-Stand für diesen Geräteschlüssel komplett durch dieses lokale Journal ersetzen? Nur in der Cloud vorhandene Einträge werden entfernt.")))void sync('upload');}}>{t("Cloud durch lokalen Stand ersetzen")}</button>
        <button data-drive="download-cloud" className="mail-button" disabled={busy||!connected||!hasKey} onClick={()=>{if(window.confirm(t("Das Journal auf diesem Gerät komplett durch den Cloud-Stand ersetzen? Der bisherige lokale Stand wird gesichert.")))void sync('download');}}>{t("Lokalen Stand durch Cloud ersetzen")}</button>
      </div>
    </details>
    {status.conflicts.length>0&&<div role="alert"><p>{t("Widersprüchliche Änderungen gefunden. Wähle, welche Werte bei den betroffenen Feldern gelten sollen. Unabhängige Änderungen werden zusammengeführt.")}</p>{status.conflicts.map(c=><details key={c.path}><summary>{c.path}</summary><pre>{JSON.stringify({local:c.local,cloud:c.remote},null,2)}</pre></details>)}<div className="mail-actions"><button className="mail-button" disabled={busy} onClick={()=>void run(()=>resolveConflicts('local'))}>{t("Lokale Werte übernehmen")}</button><button className="mail-button" disabled={busy} onClick={()=>void run(()=>resolveConflicts('remote'))}>{t("Cloud-Werte übernehmen")}</button></div></div>}
    <p><button className="mail-button" disabled={busy} onClick={()=>void run(async()=>{await beforeSync();await invoke('drive_restore');location.reload();})}>{t("Letzten lokalen Stand vor dem Abgleich wiederherstellen")}</button></p>
    {message&&<p role="status" className="mail-error">{message}</p>}
  </section>;
}
