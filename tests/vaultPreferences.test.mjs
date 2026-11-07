import test from 'node:test';
import assert from 'node:assert/strict';
import { readVaultPreferences, restoreVaultPreferences } from '../src/vaultPreferences.ts';
const storage = values => {
  const map = new Map(Object.entries(values));
  return { get length() { return map.size; }, key: i => [...map.keys()][i], getItem: k => map.get(k) ?? null, setItem: (k,v) => map.set(k,v), removeItem: k => map.delete(k) };
};
test('vault changes isolate timers, notebook choices and Drive merge bases while retaining device design', () => {
  const local = storage({ 'journal.settings':'theme', 'journal.nebulaLayout.v1':'layout', 'journal.activityTimers.v1':'timers-a', 'journal.drive.base.a':'encrypted-base-a', 'journal.notebookNote':'note-a' });
  const old = readVaultPreferences(local);
  restoreVaultPreferences(local, { 'journal.notebookNote':'note-b', 'journal.settings':'untrusted-theme' });
  assert.equal(local.getItem('journal.activityTimers.v1'), null);
  assert.equal(local.getItem('journal.drive.base.a'), null);
  assert.equal(local.getItem('journal.notebookNote'), 'note-b');
  assert.equal(local.getItem('journal.settings'), 'theme');
  assert.equal(local.getItem('journal.nebulaLayout.v1'), 'layout');
  restoreVaultPreferences(local, old);
  assert.equal(local.getItem('journal.activityTimers.v1'), 'timers-a');
  assert.equal(local.getItem('journal.drive.base.a'), 'encrypted-base-a');
});
