import { t } from '../i18n.ts';
import type { Json } from './merge';
// Explicitly shared presentation settings and what the user arranges or creates outside the database. OS window
// positions, desktop widget instances, autostart, unsaved colour changes (`colorDrafts`), filters and other view state of
// one device must never enter the cloud.
const preferenceKeys = new Set(['actionLayout','theme','layout','look','pixel','popupStyle','language','uiScale','bookPaging','inkPressure','features','previousColorTheme','lookMemory','colorTheme','customColors','customThemes','ticketBrightness']);
/**
 * Other localStorage entries that are the user's own making: the desk's arrangement per view and its saved layouts
 * (NebulaDesk), and the order of the tag kinds (tagKinds.ts). They travel in `preferences` as `storage:<key>` with their
 * parsed value. The handwriting tools (`journal.ink`) stay per device on purpose (pen and mouse differ).
 */
export const syncedStorageKeys = ['journal.nebulaLayout.v1', 'journal.nebulaLayout.saved', 'journal.tagKindOrder'] as const;
const storagePrefix = 'storage:';
const syncedStorage = new Set<string>(syncedStorageKeys.map(key => storagePrefix + key));
export function syncPreferences(value: Json): Record<string,Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => preferenceKeys.has(key) || syncedStorage.has(key)));
}
type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
/** The preferences to upload: the shared part of `journal.settings` and the synced storage entries. */
export function readSyncedPreferences(storage: StorageLike): Record<string,Json> {
  const preferences = syncPreferences(parseJson(storage.getItem('journal.settings')) ?? {});
  for (const key of syncedStorageKeys) {
    const value = parseJson(storage.getItem(key));
    if (value !== undefined && value !== null) preferences[storagePrefix + key] = value;
  }
  return preferences;
}
/** Settings whose absence means "the default": removed on one device (e.g. the tickets' brightness back to standard),
 *  they go on the others too. Other keys missing from the cloud stay as they are here – an older version of the app
 *  drops keys it does not know, and that must not take, say, the custom palettes away. */
const removableKeys = ['ticketBrightness', 'previousColorTheme'];
/** The merged preferences written back; device settings in `journal.settings` stay untouched. */
export function writeSyncedPreferences(storage: StorageLike, preferences: Json) {
  const shared = syncPreferences(preferences);
  const current = parseJson(storage.getItem('journal.settings'));
  const settings: Record<string,Json> = current && typeof current === 'object' && !Array.isArray(current) ? { ...current } : {};
  for (const key of preferenceKeys) { if (Object.hasOwn(shared, key)) settings[key] = shared[key]; else if (removableKeys.includes(key)) delete settings[key]; }
  storage.setItem('journal.settings', JSON.stringify(settings));
  for (const key of syncedStorageKeys) {
    const value = shared[storagePrefix + key];
    if (value !== undefined && value !== null) storage.setItem(key, JSON.stringify(value));
  }
}
function parseJson(text: string | null): Json | undefined {
  if (text === null) return undefined;
  try { return JSON.parse(text) as Json; } catch { return undefined; }
}
export function upgradeSnapshot(value:Json):Record<string,Json>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![11,12,13].includes(value.schema as number))throw new Error(t("Unbekanntes Synchronisierungsformat. Beide Geräte aktualisieren."));
  const snapshot = {...value,schema:13,settings:value.settings??{},images:value.images??{},mailAccounts:value.mailAccounts??{}};
  // Older clients omit these columns. Give base/local/cloud the same shape
  // before merging, so an omitted optional icon is not interpreted as deletion.
  if (value.tables && typeof value.tables === 'object' && !Array.isArray(value.tables)) {
    const tables = {...value.tables};
    for (const table of ['tags','entries']) {
      const records = tables[table];
      if (!records || typeof records !== 'object' || Array.isArray(records)) continue;
      tables[table] = Object.fromEntries(Object.entries(records).map(([id,record]) => [id,
        record && typeof record === 'object' && !Array.isArray(record)
          ? {...(table === 'entries' ? {reminder_before:0,time_grid:0} : {}),icon:null,...record} : record]));
    }
    return {...snapshot,tables,...(value.preferences ? {preferences:syncPreferences(value.preferences)} : {})};
  }
  return {...snapshot,...(value.preferences ? {preferences:syncPreferences(value.preferences)} : {})};
}
export function databaseSnapshot(value:Json):Json {
  const copy:Record<string,Json>={...upgradeSnapshot(value),schema:12};delete copy.images;delete copy.preferences;delete copy.mailAccounts;return copy;
}
