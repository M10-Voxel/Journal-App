import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCalendarImport } from '../src/entries.ts';

test('calendar import keeps concurrent daily edits and deletions, and removes moved occurrences', () => {
  const item = (id, extra = {}) => ({ id, kind:'event', text:id, priority:false, done:false, cancelled:false, ...extra });
  const before = { date:'2026-10-30', title:'Old', body:'', revision:1, entries:[item('edited'),item('deleted'),item('moved', { showInJournal:true })] };
  const current = { ...before, title:'Still typing', entries:[item('edited', { text:'Local edit' }), item('moved'), item('new-local')] };
  const refreshed = { ...before, revision:3, entries:[item('edited', { priority:true, showInJournal:false }),item('deleted'),item('new-import')] };
  const merged = mergeCalendarImport(current, before, refreshed);
  assert.equal(merged.title, 'Still typing');
  assert.equal(merged.revision, 3);
  assert.deepEqual(merged.entries.map(entry => entry.id), ['edited','new-local','new-import']);
  assert.equal(merged.entries[0].text, 'Local edit');
  assert.equal(merged.entries[0].priority, true);
  assert.equal(merged.entries[0].showInJournal, false);
});
import { orderEntries, moveEntry, moveEntryByOffset } from '../src/entries.ts';

const entry = (id, kind) => ({ id, kind, text:`Beispiel ${id}`, done:false, cancelled:false, priority:false });
const fixture = () => [entry('t1','task'),entry('n1','note'),entry('e1','event'),entry('t2','task'),entry('e2','event'),entry('n2','note')];
const ids = entries => entries.map(item => item.id);

test('groups old mixed entries without changing relative order, IDs or content', () => {
  const original = fixture();
  const sorted = orderEntries(original);
  assert.deepEqual(ids(sorted), ['e1','e2','t1','t2','n1','n2']);
  assert.deepEqual(ids(original), ['t1','n1','e1','t2','e2','n2']);
  for (const item of sorted) assert.strictEqual(item, original.find(value => value.id === item.id));
});
test('moves before and after another entry in the same category', () => {
  const original = orderEntries(fixture());
  const moved = moveEntry(original, 't2', 't1', 'before');
  assert.deepEqual(ids(moved), ['e1','e2','t2','t1','n1','n2']);
  assert.deepEqual(moveEntry(moved, 't2', 't1', 'after'), original);
});
test('rejects movement into a different category', () => {
  const original = orderEntries(fixture());
  assert.strictEqual(moveEntry(original, 't1', 'e1', 'before'), original);
  assert.strictEqual(moveEntry(original, 'n1', 't2', 'after'), original);
});
test('keyboard moves stop at category boundaries and preserve statuses', () => {
  const original = orderEntries(fixture());
  original[2].done = true;
  original[2].priority = true;
  original[3].priority = true;
  assert.strictEqual(moveEntryByOffset(original, 't1', -1), original);
  assert.strictEqual(moveEntryByOffset(original, 't2', 1), original);
  const moved = moveEntryByOffset(original, 't1', 1);
  assert.deepEqual(ids(moved), ['e1','e2','t2','t1','n1','n2']);
  assert.strictEqual(moved[3], original[2]);
  assert.equal(moved[3].done, true);
  assert.equal(moved[3].priority, true);
});
test('ignores missing IDs, identical targets and unchanged positions', () => {
  const original = orderEntries(fixture());
  assert.strictEqual(moveEntry(original, 'missing', 't1', 'before'), original);
  assert.strictEqual(moveEntry(original, 't1', 't1', 'after'), original);
  assert.strictEqual(moveEntry(original, 't1', 't2', 'before'), original);
  assert.strictEqual(moveEntryByOffset(original, 'missing', 1), original);
});
test('keeps priority entries first in every category with stable order inside each tier', () => {
  const original = [...fixture(), entry('t3','task'), entry('t4','task')];
  for (const item of original) item.priority = ['t2','t3','e2','n2'].includes(item.id);
  const sorted = orderEntries(original);
  assert.deepEqual(ids(sorted), ['e2','e1','t2','t3','t1','t4','n2','n1']);
  for (const item of sorted) assert.strictEqual(item, original.find(value => value.id === item.id));
  assert.deepEqual(ids(orderEntries(sorted)), ids(sorted));
  assert.deepEqual(ids(moveEntry(sorted, 't3', 't2', 'before')), ['e2','e1','t3','t2','t1','t4','n2','n1']);
});
test('drag and keyboard cannot cross the priority boundary', () => {
  const original = fixture();
  original.find(item => item.id === 't2').priority = true;
  const sorted = orderEntries(original);
  assert.strictEqual(moveEntry(sorted, 't1', 't2', 'before'), sorted);
  assert.strictEqual(moveEntry(sorted, 't2', 't1', 'after'), sorted);
  assert.strictEqual(moveEntryByOffset(sorted, 't1', -1), sorted);
  assert.strictEqual(moveEntryByOffset(sorted, 't2', 1), sorted);
});
