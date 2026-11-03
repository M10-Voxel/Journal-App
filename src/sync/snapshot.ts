import type { Json } from './merge';
export function upgradeSnapshot(value:Json):Record<string,Json>{
  if(!value||typeof value!=='object'||Array.isArray(value)||![11,12].includes(value.schema as number))throw new Error('Unbekanntes Synchronisierungsformat. Beide Geräte aktualisieren.');
  return {...value,schema:12,settings:value.settings??{},images:value.images??{}};
}
export function databaseSnapshot(value:Json):Json {
  const copy={...upgradeSnapshot(value)};delete copy.images;delete copy.preferences;return copy;
}
