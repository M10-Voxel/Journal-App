import type { Json } from './merge';
// Explicitly shared presentation settings. Window layouts, widget instances,
// placements, autostart and future device settings must never enter the cloud.
const preferenceKeys = new Set(['actionLayout','theme','pixel','popupStyle','language','uiScale','bookPaging','previousColorTheme','colorTheme','customColors']);
export function syncPreferences(value: Json): Record<string,Json> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([key]) => preferenceKeys.has(key)));
}
export function upgradeSnapshot(value:Json):Record<string,Json>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![11,12,13].includes(value.schema as number))throw new Error('Unbekanntes Synchronisierungsformat. Beide Geräte aktualisieren.');
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
          ? {...(table === 'entries' ? {reminder_before:0} : {}),icon:null,...record} : record]));
    }
    return {...snapshot,tables,...(value.preferences ? {preferences:syncPreferences(value.preferences)} : {})};
  }
  return {...snapshot,...(value.preferences ? {preferences:syncPreferences(value.preferences)} : {})};
}
export function databaseSnapshot(value:Json):Json {
  const copy:Record<string,Json>={...upgradeSnapshot(value),schema:12};delete copy.images;delete copy.preferences;delete copy.mailAccounts;return copy;
}
