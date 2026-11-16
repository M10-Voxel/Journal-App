// When the automatic Google Drive sync runs (driveSync.ts) – kept apart from the network so it can be tested. The plan
// keeps Drive's request limits far away: a sync with nothing new costs no request at all (local data unchanged) or one
// (the cloud file's version), saving starts one only after a quiet moment and never more often than every half minute,
// and failures wait longer each time.

/** When the device syncs by itself (stored on this device only, `journal.driveSync`):
 *  `save` after changes are saved (and a look at the cloud every few minutes), `interval` every few minutes, `close` when
 *  the window is closed (×) or the app ends, `quit` only when the app ends (also when Windows shuts down), `manual` never.
 *  Every automatic choice also syncs once when the app starts, so this device begins with the others' changes. */
export type SyncMoment = 'save' | 'interval' | 'close' | 'quit' | 'manual';
export interface SyncPrefs { moment: SyncMoment; minutes: number }
export const syncMoments: readonly SyncMoment[] = ['save', 'interval', 'close', 'quit', 'manual'];
export const defaultSyncPrefs: SyncPrefs = { moment: 'manual', minutes: 15 };
/** The interval's bounds: at least two minutes (Drive's limits, and a sync is not free), at most a day. */
export const minMinutes = 2, maxMinutes = 1440;

export function normalizeSyncPrefs(value: unknown): SyncPrefs {
  const stored = value && typeof value === 'object' ? value as Partial<SyncPrefs> : {};
  const moment = syncMoments.includes(stored.moment as SyncMoment) ? stored.moment as SyncMoment : defaultSyncPrefs.moment;
  const minutes = typeof stored.minutes === 'number' && Number.isFinite(stored.minutes) ? Math.round(Math.min(maxMinutes, Math.max(minMinutes, stored.minutes))) : defaultSyncPrefs.minutes;
  return { moment, minutes };
}
export const automatic = (prefs: SyncPrefs) => prefs.moment !== 'manual';
/** Whether closing the window (×) syncs; quitting the app (and Windows ending the session) syncs for every automatic choice. */
export const syncsOnClose = (prefs: SyncPrefs) => prefs.moment === 'close';

/** After a save: wait for this quiet time, but never longer than `saveMaxWait` after the first unsynced change. */
export const saveQuiet = 20_000, saveMaxWait = 120_000;
/** Never two syncs closer than this (except one the user starts). */
export const minGap = 30_000;
/** With `save`, the others' changes are looked for this often (one request when nothing changed). */
export const remotePoll = 5 * 60_000;

/**
 * When the next sync may run after `failures` failed ones in a row: one minute, doubling up to an hour; Google's request
 * limit waits at least five minutes. Busy states (a save in progress, local data changed during the sync) retry soon
 * without counting as a failure.
 */
export function retryDelay(failures: number, rateLimited: boolean): number {
  const delay = Math.min(60, 2 ** Math.max(0, failures - 1)) * 60_000;
  return rateLimited ? Math.max(delay, 5 * 60_000) : delay;
}
export const isRateLimit = (message: string) => /HTTP 429|Anfragelimit|rateLimit|RATE_LIMIT/i.test(message);
export const isBusy = (message: string) => /arbeitet bereits|während der Synchronisierung geändert|Lokale Änderungen konnten nicht gespeichert/i.test(message);

/** The moment a save-triggered sync runs: after the quiet time, at most `saveMaxWait` after the first change, and not
 *  before `minGap` after the last sync. */
export function saveDue(now: number, firstChange: number, lastChange: number, lastRun: number): number {
  return Math.max(Math.min(lastChange + saveQuiet, firstChange + saveMaxWait), lastRun + minGap, now);
}

/** A fingerprint of the synced data, independent of key order (Rust and JavaScript order object keys differently). */
export function fingerprint(value: unknown): string {
  const stable = (item: unknown): string => {
    if (Array.isArray(item)) return `[${item.map(stable).join(',')}]`;
    if (item && typeof item === 'object') return `{${Object.keys(item).sort().map(key => `${JSON.stringify(key)}:${stable((item as Record<string, unknown>)[key])}`).join(',')}}`;
    return JSON.stringify(item) ?? 'null';
  };
  // FNV-1a, 2 × 32 bit: enough to notice a change; nothing secret depends on it.
  const text = stable(value);
  let a = 0x811c9dc5, b = 0x01000193 ^ text.length;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}:${text.length}`;
}
