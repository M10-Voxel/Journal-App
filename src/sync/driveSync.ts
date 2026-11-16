// The Google Drive sync: one place for the button in the settings and the automatic sync (driveSchedule.ts says when).
// It runs only in the journal window (App.tsx starts it). A sync reads this device's data, merges it three ways with the
// cloud and the last common state, writes the cloud only when it differs and applies here only what came from elsewhere –
// so an automatic sync while writing touches nothing on this device unless another device changed something.
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { t } from '../i18n';
import { encodeBase64 } from '../base64';
import { mergeThreeWay } from './merge';
import type { Conflict, Json, MergeResult } from './merge';
import { parseDeviceKey } from './deviceKey';
import { databaseSnapshot, readSyncedPreferences, syncedStorageKeys, upgradeSnapshot, writeSyncedPreferences } from './snapshot';
import { decrypt, encrypt, encryptionKey } from './crypto';
import { automatic, fingerprint, isBusy, isRateLimit, normalizeSyncPrefs, remotePoll, retryDelay, saveDue, syncsOnClose } from './driveSchedule';
import type { SyncPrefs } from './driveSchedule';
import { flushPeriodData } from '../periodStore';
import { flushBoardData } from '../boardCards';

export type SyncMode = 'merge' | 'upload' | 'download';
type Remote = { id: string | null; etag: string | null; data: string | null };
type Pending = { local: Record<string, Json>; remote: Remote; result: MergeResult; key: CryptoKey; vault: string };
/** What the settings show: idle, running, waiting for conflicts to be resolved, or the last error. */
export interface SyncStatus { state: 'idle' | 'syncing' | 'conflict' | 'error'; lastSync: number | null; message: string; conflicts: Conflict[]; nextRetry: number | null }

const prefsKey = 'journal.driveSync';
const empty: Json = { schema: 13, tables: { days: {}, entries: {}, tags: {}, series: {} }, settings: {}, images: {}, mailAccounts: {} };
const stateKey = (vault: string) => `journal.drive.state.${vault}`;
const baseKey = (vault: string) => `journal.drive.base.${vault}`;

let status: SyncStatus = { state: 'idle', lastSync: null, message: '', conflicts: [], nextRetry: null };
let pending: Pending | null = null;
const listeners = new Set<() => void>();
const setStatus = (change: Partial<SyncStatus>) => { status = { ...status, ...change }; for (const listener of [...listeners]) listener(); };
export const syncStatus = () => status;
export function onSyncStatus(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function loadSyncPrefs(): SyncPrefs { try { return normalizeSyncPrefs(JSON.parse(localStorage.getItem(prefsKey) ?? 'null')); } catch { return normalizeSyncPrefs(null); } }
let prefs = loadSyncPrefs();
export const syncPrefs = () => prefs;

// The device key: typed in the settings for one sync, or kept on this device (Windows-protected, drive.rs) for the
// automatic sync.
let typedKey = '';
let storedKey: string | null | undefined;
export async function storedDeviceKey(): Promise<string | null> {
  if (storedKey === undefined) storedKey = await invoke<string | null>('drive_key_load').catch(() => null);
  return storedKey;
}
export async function rememberDeviceKey(text: string) { const key = encodeBase64(parseDeviceKey(text)); await invoke('drive_key_save', { key }); storedKey = key; schedule(); }
export async function forgetDeviceKey() { await invoke('drive_key_forget'); storedKey = null; schedule(); }
export const setTypedKey = (text: string) => { typedKey = text; };

let hooks: { beforeSync: () => Promise<void>; notify: (message: string) => void } = { beforeSync: async () => {}, notify: () => {} };

/** The vault id and AES key of a device key. */
async function keys(text: string) {
  const bytes = new Uint8Array(parseDeviceKey(text));
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return { key: await encryptionKey(bytes), vault: Array.from(hash, value => value.toString(16).padStart(2, '0')).join('') };
}
type SyncState = { id: string | null; etag: string | null; fingerprint: string };
const readState = (vault: string): SyncState | null => { try { return JSON.parse(localStorage.getItem(stateKey(vault)) ?? 'null') as SyncState | null; } catch { return null; } };
/** What is compared to notice a local change: the database, the mail accounts and the shared preferences. */
const localPrint = (snapshot: Record<string, Json>) => fingerprint({ db: databaseSnapshot(snapshot), mail: snapshot.mailAccounts, preferences: snapshot.preferences });

async function localSnapshot(): Promise<Record<string, Json>> {
  await flushPeriodData(); await flushBoardData();
  const local = upgradeSnapshot(await invoke<Json>('drive_snapshot'));
  local.mailAccounts = (await invoke<Json>('mail_drive_snapshot')) ?? {};
  local.preferences = readSyncedPreferences(localStorage);
  local.images = {};
  return local;
}
/** Board pictures referenced by this device's cards: all of them, or only those the cloud does not have yet. */
async function addImages(local: Record<string, Json>, cloudImages: Record<string, Json> | null) {
  const images: Record<string, Json> = {};
  for (const card of Object.values(local.settings as Record<string, Json>)) {
    if (card && typeof card === 'object' && !Array.isArray(card) && typeof card.asset === 'string' && !(cloudImages && Object.hasOwn(cloudImages, card.asset))) {
      const image = await invoke<string>('board_image_load', { id: card.asset }); images[card.asset] = image.split(',')[1];
    }
  }
  local.images = images;
}
const assets = (snapshot: Record<string, Json>) => new Set(Object.values(snapshot.settings as Record<string, Json>).flatMap(card => card && typeof card === 'object' && !Array.isArray(card) && typeof card.asset === 'string' ? [card.asset] : []));

let running: Promise<'unchanged' | 'synced' | 'conflict'> | null = null;
/**
 * One sync. `interactive`: started by the user (the settings' button) – always a full exchange, conflicts are shown to
 * choose from, the window reloads afterwards when something arrived. Otherwise (automatic): nothing happens when neither
 * this device nor the cloud changed since the last sync, conflicts wait for the user, nothing reloads unless shared
 * preferences changed.
 */
export function runSync(mode: SyncMode = 'merge', interactive = false): Promise<'unchanged' | 'synced' | 'conflict'> {
  if (running) return running.then(() => runSync(mode, interactive));
  running = (async () => {
    setStatus({ state: 'syncing', message: '' });
    try {
      const result = await exchange(mode, interactive);
      failures = 0;
      setStatus({ state: result === 'conflict' ? 'conflict' : 'idle', lastSync: result === 'conflict' ? status.lastSync : Date.now(), nextRetry: null });
      return result;
    } catch (reason) {
      const message = String(reason instanceof Error ? reason.message : reason);
      if (isBusy(message)) { retryAt = Date.now() + 15_000; setStatus({ state: 'idle', nextRetry: retryAt }); }
      else {
        failures++; retryAt = Date.now() + retryDelay(failures, isRateLimit(message));
        setStatus({ state: 'error', message, nextRetry: interactive ? null : retryAt });
        if (!interactive && failures === 3) hooks.notify(t('Automatische Synchronisierung fehlgeschlagen: {0}', message));
      }
      throw reason;
    } finally { running = null; lastRun = Date.now(); schedule(); }
  })();
  return running;
}

async function exchange(mode: SyncMode, interactive: boolean): Promise<'unchanged' | 'synced' | 'conflict'> {
  const text = typedKey || await storedDeviceKey();
  if (!text) throw new Error(t('Kein Geräteschlüssel: in den Einstellungen eingeben oder auf diesem Gerät merken.'));
  const { key, vault } = await keys(text);
  await hooks.beforeSync();
  const local = await localSnapshot();
  const known = readState(vault), print = localPrint(local);
  // Nothing new here and the cloud unchanged since: no download, no upload (one request).
  if (!interactive && mode === 'merge' && known && known.fingerprint === print && known.id) {
    const probe = await invoke<{ id: string | null; etag: string | null }>('drive_probe', { vault, id: known.id });
    if (probe.id === known.id && probe.etag && probe.etag === known.etag) return 'unchanged';
  }
  const remote = await invoke<Remote>('drive_read', { vault });
  const cloud = remote.data ? upgradeSnapshot(await decrypt(remote.data, key)) : empty as Record<string, Json>;
  await addImages(local, mode === 'upload' || !remote.data ? null : cloud.images as Record<string, Json>);
  const previous = localStorage.getItem(baseKey(vault));
  if (mode === 'download' && !remote.data) throw new Error(t('Kein Cloud-Stand vorhanden.'));
  if (mode === 'merge' && previous && !remote.data) throw new Error(t('Die bisherige Cloud-Datei fehlt. Zum Schutz vor Datenverlust wurde nichts gelöscht.'));
  const base = previous ? upgradeSnapshot(await decrypt(previous, key)) : empty;
  const result = mode === 'merge' ? mergeThreeWay(base, local, cloud) : { value: mode === 'upload' ? local : cloud, conflicts: [] };
  const job: Pending = { local, remote, result, key, vault };
  if (result.conflicts.length) {
    pending = job;
    setStatus({ conflicts: result.conflicts });
    if (!interactive) hooks.notify(t('Synchronisierung: widersprüchliche Änderungen. In den Einstellungen unter Google Drive auswählen, welche gelten.'));
    return 'conflict';
  }
  await finish(job, result.value, mode, interactive, remote.data ? cloud : null);
  return 'synced';
}

/** Writes the merged state where it differs: the cloud, this device's database, mail accounts, pictures, preferences. */
async function finish(job: Pending, value: Json | undefined, mode: SyncMode, interactive: boolean, cloud: Record<string, Json> | null) {
  if (!value || typeof value !== 'object') throw new Error(t('Ungültiger Abgleich.'));
  await flushPeriodData(); await flushBoardData();
  const snapshot = upgradeSnapshot(value);
  const { local } = job;
  const sameDatabase = fingerprint(databaseSnapshot(snapshot)) === fingerprint(databaseSnapshot(local));
  const sameMail = fingerprint(snapshot.mailAccounts ?? {}) === fingerprint(local.mailAccounts ?? {});
  const samePreferences = fingerprint(snapshot.preferences ?? {}) === fingerprint(local.preferences ?? {});
  await invoke('drive_validate', { expected: databaseSnapshot(local), snapshot: databaseSnapshot(snapshot) });
  await invoke('mail_drive_validate', { expected: local.mailAccounts, accounts: snapshot.mailAccounts });
  const known = assets(local);
  for (const [id, data] of Object.entries(snapshot.images as Record<string, Json>)) {
    if (typeof data !== 'string') throw new Error(t('Ungültiges Pinnwandbild'));
    if (!known.has(id) || mode === 'download') await invoke('board_image_save', { id, data });
  }
  let written: { id: string | null; etag: string | null } = { id: job.remote.id, etag: job.remote.etag };
  // The cloud is written only when it would change (comparing without pictures: those only ever grow).
  const cloudChanges = !cloud || fingerprint({ ...snapshot, images: Object.keys(snapshot.images as object).sort() }) !== fingerprint({ ...cloud, images: Object.keys(cloud.images as object).sort() });
  if (mode !== 'download' && cloudChanges) {
    written = await invoke<{ id: string | null; etag: string | null }>('drive_write', { vault: job.vault, id: job.remote.id, etag: job.remote.etag, data: await encrypt(snapshot, job.key) });
  }
  const arrives = mode !== 'upload' && !(sameDatabase && sameMail);
  if (arrives) {
    // Writing pauses for the moment it takes; the database refuses if something was saved since the snapshot.
    await emit('editor:paused', true);
    try {
      if (!sameDatabase) await invoke('drive_apply', { expected: databaseSnapshot(local), snapshot: databaseSnapshot(snapshot) });
      if (!sameMail) await invoke('mail_drive_apply', { expected: local.mailAccounts, accounts: snapshot.mailAccounts });
    } finally { await emit('editor:paused', false); }
  }
  const preferencesArrive = mode !== 'upload' && snapshot.preferences && !samePreferences;
  if (preferencesArrive) writeSyncedPreferences(localStorage, snapshot.preferences);
  localStorage.setItem(baseKey(job.vault), await encrypt({ ...snapshot, images: {} }, job.key));
  localStorage.setItem(stateKey(job.vault), JSON.stringify({ id: written.id, etag: written.etag, fingerprint: localPrint({ ...snapshot, preferences: mode === 'upload' ? local.preferences : snapshot.preferences ?? local.preferences }) }));
  pending = null; setStatus({ conflicts: [] });
  // The windows reload their days from the database's events; settings and layouts are read when the page starts.
  if (interactive ? arrives || preferencesArrive : preferencesArrive) reloadWhenIdle(interactive);
}

/** Conflicts resolved by the user: every conflicting field takes this device's or the cloud's value. */
export async function resolveConflicts(side: 'local' | 'remote') {
  if (!pending) return;
  const job = pending;
  await hooks.beforeSync();
  const value = structuredClone(job.result.value) as Record<string, Json>;
  for (const conflict of job.result.conflicts) {
    const parts = conflict.path.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
    let target = value; for (const part of parts.slice(0, -1)) { if (!Object.hasOwn(target, part)) throw new Error(t('Ungültiger Konfliktpfad')); target = target[part] as Record<string, Json>; }
    const replacement = conflict[side], last = parts[parts.length - 1];
    if (replacement === undefined) delete target[last]; else Object.defineProperty(target, last, { value: replacement, writable: true, configurable: true, enumerable: true });
  }
  setStatus({ state: 'syncing' });
  try {
    const cloud = job.remote.data ? upgradeSnapshot(await decrypt(job.remote.data, job.key)) : null;
    await finish(job, value, 'merge', true, cloud);
    setStatus({ state: 'idle', lastSync: Date.now() });
  } catch (reason) { setStatus({ state: 'error', message: String(reason instanceof Error ? reason.message : reason) }); throw reason; }
  finally { lastRun = Date.now(); schedule(); }
}

function reloadWhenIdle(now: boolean) {
  if (now) { location.reload(); return; }
  // Not while someone is typing or pointing: after three quiet seconds.
  let timer = 0;
  const wait = () => { clearTimeout(timer); timer = window.setTimeout(() => { for (const type of events) window.removeEventListener(type, wait); location.reload(); }, 3000); };
  const events = ['keydown', 'pointerdown', 'wheel'] as const;
  for (const type of events) window.addEventListener(type, wait, { passive: true });
  wait();
}

// ── The automatic sync ─────────────────────────────────────────────────────────────────────────────────────────────
let failures = 0, retryAt = 0, lastRun = 0, firstChange = 0, lastChange = 0, lastRemoteCheck = 0, timer = 0, started = false;

/** Something was saved on this device (database events, settings, desk layouts). */
export function markChanged() {
  const now = Date.now();
  if (!firstChange) firstChange = now;
  lastChange = now;
  schedule();
}
function schedule() {
  clearTimeout(timer);
  if (!started || running || pending || !automatic(prefs)) return;
  const now = Date.now();
  let due: number | null = null;
  if (prefs.moment === 'save') {
    due = firstChange ? saveDue(now, firstChange, lastChange, lastRun) : lastRemoteCheck + remotePoll;
  } else if (prefs.moment === 'interval') due = lastRun + prefs.minutes * 60_000;
  if (due === null) return;
  due = Math.max(due, retryAt, now);
  timer = window.setTimeout(() => { void automaticSync(); }, Math.min(due - now, 2 ** 31 - 1));
}
async function automaticSync() {
  if (!(await storedDeviceKey())) return;
  const changedSince = firstChange;
  firstChange = 0;
  lastRemoteCheck = Date.now();
  try { await runSync('merge'); }
  catch { if (changedSince && !firstChange) firstChange = changedSince; }
}

/** Starts the automatic sync in the journal window: the moment chosen, the events that mean "saved", the start sync. */
export function startDriveSync(options: { beforeSync: () => Promise<void>; notify: (message: string) => void }) {
  hooks = options;
  if (started) return () => {};
  started = true;
  void invoke('session_sync_enabled', { enabled: automatic(prefs) }).catch(() => {});
  const stops = ['journal:changed', 'journal:tags', 'period:changed', 'board:changed', 'board:folders', 'board:removed']
    .map(name => listen(name, () => { if (!running) markChanged(); }));
  const local = () => markChanged();
  const storage = (event: StorageEvent) => { if (event.key === 'journal.settings' || syncedStorageKeys.includes(event.key as typeof syncedStorageKeys[number])) markChanged(); };
  // Coming back to the window after a while: a look at the cloud (once every few minutes at most).
  const focus = () => { if (prefs.moment === 'save' && Date.now() - lastRemoteCheck > 2 * 60_000) { lastRemoteCheck = Date.now(); clearTimeout(timer); timer = window.setTimeout(() => void automaticSync(), 1000); } };
  window.addEventListener('journal:local-change', local);
  window.addEventListener('storage', storage);
  window.addEventListener('focus', focus);
  const session = listen('journal:session-end', () => { void syncBeforeEnd().finally(() => void invoke('session_sync_done').catch(() => {})); });
  // The start: this device begins with the others' changes.
  if (automatic(prefs)) { clearTimeout(timer); timer = window.setTimeout(() => { lastRemoteCheck = Date.now(); void automaticSync(); }, 4000); }
  else schedule();
  return () => {
    started = false; clearTimeout(timer);
    for (const stop of [...stops, session]) void stop.then(unlisten => unlisten());
    window.removeEventListener('journal:local-change', local); window.removeEventListener('storage', storage); window.removeEventListener('focus', focus);
  };
}
export function setSyncPrefs(next: SyncPrefs) {
  prefs = normalizeSyncPrefs(next);
  try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* this session */ }
  void invoke('session_sync_enabled', { enabled: automatic(prefs) }).catch(() => {});
  // A newly chosen automatic moment starts with a look at the cloud.
  if (started && automatic(prefs) && !lastRun) { clearTimeout(timer); timer = window.setTimeout(() => void automaticSync(), 2000); }
  else schedule();
}

/** Ending: quitting, Windows ending the session, or (when chosen) closing the window. Waits at most `limit` ms; a sync
 *  that does not finish in time uploads nothing half-done. */
export async function syncBeforeEnd(limit = 20_000) {
  if (!automatic(prefs) || pending || !(await storedDeviceKey())) return;
  await Promise.race([runSync('merge').catch(() => {}), new Promise(resolve => setTimeout(resolve, limit))]);
}
export const syncWhenClosing = () => syncsOnClose(prefs) ? syncBeforeEnd() : Promise.resolve();
