import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEntries, moveEntry, moveEntryByOffset } from '../src/entries.ts';

const entry = (id, kind) => ({ id, kind, text:`Beispiel ${id}`, done:false, cancelled:false });
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
  assert.strictEqual(moveEntryByOffset(original, 't1', -1), original);
  assert.strictEqual(moveEntryByOffset(original, 't2', 1), original);
  const moved = moveEntryByOffset(original, 't1', 1);
  assert.deepEqual(ids(moved), ['e1','e2','t2','t1','n1','n2']);
  assert.strictEqual(moved[3], original[2]);
  assert.equal(moved[3].done, true);
});
test('ignores missing IDs, identical targets and unchanged positions', () => {
  const original = orderEntries(fixture());
  assert.strictEqual(moveEntry(original, 'missing', 't1', 'before'), original);
  assert.strictEqual(moveEntry(original, 't1', 't1', 'after'), original);
  assert.strictEqual(moveEntry(original, 't1', 't2', 'before'), original);
  assert.strictEqual(moveEntryByOffset(original, 'missing', 1), original);
});
