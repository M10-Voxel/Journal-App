import type { Json } from './merge';
export function upgradeSnapshot(value:Json):Record<string,Json>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![11,12,13].includes(value.schema as number))throw new Error('Unbekanntes Synchronisierungsformat. Beide Geräte aktualisieren.');
  return {...value,schema:13,settings:value.settings??{},images:value.images??{},mailAccounts:value.mailAccounts??{}};
}
export function databaseSnapshot(value:Json):Json {
  const copy:Record<string,Json>={...upgradeSnapshot(value),schema:12};delete copy.images;delete copy.preferences;delete copy.mailAccounts;return copy;
}
