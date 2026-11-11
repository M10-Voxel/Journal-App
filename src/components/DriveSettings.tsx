import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { mergeThreeWay } from '../sync/merge';
import type { Json, MergeResult } from '../sync/merge';
import { useLanguage } from '../i18n';
import { parseDeviceKey } from '../sync/deviceKey';
import { upgradeSnapshot, databaseSnapshot, syncPreferences } from '../sync/snapshot';
import { flushPeriodData } from '../periodStore';
import { flushBoardData } from '../boardCards';
import { encodeBase64 as encode } from '../base64';
import { decrypt, encrypt, encryptionKey } from '../sync/crypto';
const empty:Json={schema:13,tables:{days:{},entries:{},tags:{},series:{}},settings:{},images:{},mailAccounts:{}};
type Remote={id:string|null;etag:string|null;data:string|null};
type Pending={local:Json;remote:Remote;result:MergeResult;key:CryptoKey;vault:string};

export function DriveSettings({beforeSync,onBusy}:{beforeSync:()=>Promise<void>;onBusy:(busy:boolean)=>void}) {
  const language=useLanguage();
  const en=language==='en';
  const [client,setClient]=useState(''),[secret,setSecret]=useState(''),[keyText,setKeyText]=useState('');
  const [connected,setConnected]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const [pending,setPending]=useState<Pending|null>(null);
  let keyHint='';
  if(keyText){try{parseDeviceKey(keyText,en);keyHint=en?'Device key recognised.':'Geräteschlüssel erkannt.';}catch(e){keyHint=String(e instanceof Error?e.message:e);}}
  useEffect(()=>{void invoke<{connected:boolean;clientId:string}>('drive_status').then(s=>{setClient(s.clientId);setConnected(s.connected);}).catch(e=>setMessage(String(e)));},[]);
  async function run(action:()=>Promise<void>) {
    setBusy(true);onBusy(true);setMessage('');
    try {await action();}catch(e){setMessage(String(e instanceof Error?e.message:e));}
    finally {setBusy(false);onBusy(false);}
  }
  async function finish(p:Pending,value:Json|undefined,mode:'merge'|'upload'|'download'='merge') {
    if(!value || typeof value!=='object') throw new Error('Ungültiger Abgleich.');
    await flushPeriodData();await flushBoardData();
    const snapshot=upgradeSnapshot(value);
    await invoke('drive_validate',{expected:databaseSnapshot(p.local),snapshot:databaseSnapshot(snapshot)});
    await invoke('mail_drive_validate',{expected:(p.local as Record<string,Json>).mailAccounts,accounts:snapshot.mailAccounts});
    for(const [id,data] of Object.entries(snapshot.images as Record<string,Json>)){
      if(typeof data!=='string')throw new Error('Ungültiges Pinnwandbild');
      await invoke('board_image_save',{id,data});
    }
    if(mode!=='download'){
      const data=await encrypt(snapshot,p.key);
      await invoke('drive_write',{vault:p.vault,id:p.remote.id,etag:p.remote.etag,data});
    }
    if(mode!=='upload'){
      await invoke('drive_apply',{expected:databaseSnapshot(p.local),snapshot:databaseSnapshot(snapshot)});
      await invoke('mail_drive_apply',{expected:(p.local as Record<string,Json>).mailAccounts,accounts:snapshot.mailAccounts});
    }
    if(snapshot.preferences && mode!=='upload'){
      const current=JSON.parse(localStorage.getItem('journal.settings')??'{}');
      localStorage.setItem('journal.settings',JSON.stringify({...current,...syncPreferences(snapshot.preferences)}));
    }
    localStorage.setItem(`journal.drive.base.${p.vault}`,await encrypt({...snapshot,images:{}},p.key));
    setPending(null);
    location.reload();
  }
  async function sync(mode:'merge'|'upload'|'download'='merge') {
    const bytes=new Uint8Array(parseDeviceKey(keyText,en));
    setPending(null);await beforeSync();
    const key=await encryptionKey(bytes);
    const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));
    const vault=Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('');
    await flushPeriodData();await flushBoardData();
    const local=upgradeSnapshot(await invoke<Json>('drive_snapshot'));
    local.mailAccounts=await invoke<Json>('mail_drive_snapshot');
    local.preferences=syncPreferences(JSON.parse(localStorage.getItem('journal.settings')??'{}'));
    const images:Record<string,Json>={};
    for(const card of Object.values(local.settings as Record<string,Json>)){
      if(card&&typeof card==='object'&&!Array.isArray(card)&&typeof card.asset==='string'){
        const image=await invoke<string>('board_image_load',{id:card.asset});images[card.asset]=image.split(',')[1];
      }
    }
    local.images=images;
    const remote=await invoke<Remote>('drive_read',{vault});
    const cloud=remote.data?upgradeSnapshot(await decrypt(remote.data,key)):empty;
    const previous=localStorage.getItem(`journal.drive.base.${vault}`);
    if(mode==='download' && !remote.data) throw new Error(en?'No cloud data found.':'Kein Cloud-Stand vorhanden.');
    if(mode==='merge' && previous && !remote.data) throw new Error('Die bisherige Cloud-Datei fehlt. Zum Schutz vor Datenverlust wurde nichts gelöscht.');
    const base=previous?upgradeSnapshot(await decrypt(previous,key)):empty;
    const result=mode==='merge'?mergeThreeWay(base,local,cloud):{value:mode==='upload'?local:cloud,conflicts:[]};
    const p={local,remote,result,key,vault};
    if(result.conflicts.length){setPending(p);return;}
    await finish(p,result.value,mode);
  }
  async function resolve(side:'local'|'remote') {
    if(!pending)return;
    await beforeSync();
    const value=structuredClone(pending.result.value) as Record<string,Json>;
    for(const conflict of pending.result.conflicts){
      const parts=conflict.path.slice(1).split('/').map(s=>s.replace(/~1/g,'/').replace(/~0/g,'~'));
      let target=value;for(const part of parts.slice(0,-1)){if(!Object.hasOwn(target,part))throw new Error('Ungültiger Konfliktpfad');target=target[part] as Record<string,Json>;}
      const replacement=conflict[side];const last=parts[parts.length-1];
      if(replacement===undefined)delete target[last];else Object.defineProperty(target,last,{value:replacement,writable:true,configurable:true,enumerable:true});
    }
    await finish(pending,value);
  }
  return <section className="mail-settings drive-settings">
    <h3>Google Drive</h3>
    <p className="settings-hint">{en?'Synchronise journal, calendar, activities, board and mail accounts between your devices. Mail accounts must be signed in on each device. Data is encrypted locally with your device key.':'Journal, Kalender, Aktivitäten, Pinnwand und Mailkonten zwischen deinen Geräten abgleichen. Mailkonten müssen auf jedem Gerät angemeldet werden. Die Daten werden lokal mit deinem Geräteschlüssel verschlüsselt.'}</p>
    <details className="mail-oauth"><summary>{en?'One-time Google setup':'Einmalige Google-Einrichtung'}</summary><p>{en?'Enable the Google Drive API in Google Cloud, create a Desktop OAuth client and add your account as a test user if the app is in testing. Use the same client ID on both devices.':'In Google Cloud die Google Drive API aktivieren, einen OAuth-Client vom Typ Desktop-App erstellen und bei einer App im Testbetrieb dein Konto als Testnutzer eintragen. Auf beiden Geräten dieselbe Client-ID verwenden.'}</p><button className="mail-button" onClick={()=>void invoke('drive_help').catch(e=>setMessage(String(e)))}>Google Cloud Console</button></details>
    <label>Google Client-ID<input className="drive-client" value={client} disabled={busy||connected} onChange={e=>setClient(e.target.value.trim())} autoComplete="off" /></label>
    {!connected&&<label>Client-Secret<input type="password" value={secret} disabled={busy} onChange={e=>setSecret(e.target.value)} autoComplete="off" /></label>}
    <div className="mail-actions">{!connected?<button data-drive="connect" className="mail-button is-primary" disabled={busy||!client} onClick={()=>void run(async()=>{await invoke('drive_connect',{clientId:client,clientSecret:secret});setSecret('');setConnected(true);})}>{en?'Connect to Google Drive':'Mit Google Drive verbinden'}</button>:<button className="mail-button" disabled={busy} onClick={()=>void run(async()=>{await invoke('drive_disconnect');setConnected(false);})}>{en?'Disconnect':'Verbindung trennen'}</button>}{busy&&!connected&&<button className="mail-button" onClick={()=>void invoke('drive_cancel')}>{en?'Cancel sign-in':'Anmeldung abbrechen'}</button>}</div>
    <label>{en?'Device key':'Geräteschlüssel'}<input className="drive-key" type="password" value={keyText} disabled={busy} autoComplete="off" aria-describedby="drive-key-hint" placeholder={en?'Paste the key generated by Journal':'Von Journal erzeugten Schlüssel einfügen'} onChange={e=>{setKeyText(e.target.value);setPending(null);}} /></label>
    <p id="drive-key-hint" className="settings-hint" role="status">{keyHint||(en?'Use the same Journal-generated key on all devices, not your Google password.':'Auf allen Geräten denselben von Journal erzeugten Schlüssel verwenden, nicht dein Google-Passwort.')}</p>
    <div className="mail-actions"><button data-drive="generate" className="mail-button" disabled={busy||!!keyText} onClick={()=>setKeyText(encode(crypto.getRandomValues(new Uint8Array(32))))}>{en?'Generate new key':'Neuen Schlüssel erzeugen'}</button><button className="mail-button" disabled={!keyText||busy} onClick={()=>void navigator.clipboard.writeText(keyText).then(()=>setMessage(en?'Key copied.':'Schlüssel kopiert.')).catch(()=>setMessage(en?'Clipboard unavailable.':'Zwischenablage nicht verfügbar.'))}>{en?'Copy key':'Schlüssel kopieren'}</button></div>
    <p className="settings-hint">{en?'Keep this key safe and enter it on every device. It is not stored here. Without it, your encrypted Drive data cannot be recovered.':'Diesen Schlüssel sicher aufbewahren und auf jedem Gerät eingeben. Er wird hier nicht gespeichert. Ohne ihn können die verschlüsselten Drive-Daten nicht wiederhergestellt werden.'}</p>
    <button data-drive="sync" className="mail-button is-primary" disabled={busy||!connected||!keyText} onClick={()=>void run(()=>sync())}>{busy?(en?'Working …':'Wird verarbeitet …'):(en?'Synchronise now':'Jetzt synchronisieren')}</button>
    <details className="drive-replace"><summary>{en?'Replace an entire sync state':'Einen Stand komplett ersetzen'}</summary>
      <p className="settings-hint">{en?'These actions replace data instead of combining it. Use the same account and device key on each device.':'Diese Aktionen ersetzen Daten, statt sie zusammenzuführen. Auf allen Geräten dasselbe Konto und denselben Geräteschlüssel verwenden.'}</p>
      <div className="mail-actions">
        <button data-drive="upload-local" className="mail-button" disabled={busy||!connected||!keyText} onClick={()=>{if(window.confirm(en?'Replace all cloud data for this device key with this local journal? Cloud-only entries will be removed.':'Den Cloud-Stand für diesen Geräteschlüssel komplett durch dieses lokale Journal ersetzen? Nur in der Cloud vorhandene Einträge werden entfernt.'))void run(()=>sync('upload'));}}>{en?'Replace cloud with local state':'Cloud durch lokalen Stand ersetzen'}</button>
        <button data-drive="download-cloud" className="mail-button" disabled={busy||!connected||!keyText} onClick={()=>{if(window.confirm(en?'Replace this device’s journal with the cloud state? A local backup is kept.':'Das Journal auf diesem Gerät komplett durch den Cloud-Stand ersetzen? Der bisherige lokale Stand wird gesichert.'))void run(()=>sync('download'));}}>{en?'Replace local state with cloud':'Lokalen Stand durch Cloud ersetzen'}</button>
      </div>
    </details>
    {pending&&<div role="alert"><p>{en?'Conflicting changes were found. Choose which values to keep for the conflicting fields; independent changes are combined.':'Widersprüchliche Änderungen gefunden. Wähle, welche Werte bei den betroffenen Feldern gelten sollen. Unabhängige Änderungen werden zusammengeführt.'}</p>{pending.result.conflicts.map(c=><details key={c.path}><summary>{c.path}</summary><pre>{JSON.stringify({local:c.local,cloud:c.remote},null,2)}</pre></details>)}<div className="mail-actions"><button className="mail-button" disabled={busy} onClick={()=>void run(()=>resolve('local'))}>{en?'Use local values':'Lokale Werte übernehmen'}</button><button className="mail-button" disabled={busy} onClick={()=>void run(()=>resolve('remote'))}>{en?'Use cloud values':'Cloud-Werte übernehmen'}</button></div></div>}
    <p><button className="mail-button" disabled={busy} onClick={()=>void run(async()=>{await beforeSync();await invoke('drive_restore');location.reload();})}>{en?'Restore last local pre-sync state':'Letzten lokalen Stand vor dem Abgleich wiederherstellen'}</button></p>
    {message&&<p role="status" className="mail-error">{message}</p>}
  </section>;
}
