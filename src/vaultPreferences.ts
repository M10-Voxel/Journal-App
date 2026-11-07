/** Content-dependent browser state must never leak from one vault into another. */
const keys = new Set([
  'journal.activityTimers.v1', 'journal.calendarClipboard', 'journal.hiddenTags',
  'journal.notebookFolder', 'journal.notebookNote', 'journal.notebookCollapsed', 'journal.notebookSort',
]);
export const vaultPreferenceKey = (key: string) => keys.has(key) || key.startsWith('journal.drive.base.');
export function readVaultPreferences(storage: Storage): Record<string, string> {
  const result: Record<string, string> = {};
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key && vaultPreferenceKey(key)) result[key] = storage.getItem(key)!;
  }
  return result;
}
export function restoreVaultPreferences(storage: Storage, preferences: Record<string, string> | null) {
  const previous = Object.keys(readVaultPreferences(storage));
  for (const key of previous) storage.removeItem(key);
  for (const [key, value] of Object.entries(preferences ?? {})) {
    if (vaultPreferenceKey(key) && typeof value === 'string') storage.setItem(key, value);
  }
}
