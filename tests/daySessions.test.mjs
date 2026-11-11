import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDayOperation, changeOperation, EditConflict } from '../src/dayOperations.ts';
import { DaySessions } from '../src/daySessions.ts';
import { setTagOrder } from '../src/tags.ts';

const entry = (id, extra = {}) => ({ id, kind: 'task', text: id, done: false, cancelled: false, priority: false, ...extra });
const day = (date = '2026-11-11', entries = [entry('a'), entry('b')]) => ({ date, title: '', body: '', revision: 1, entries });
const copy = value => structuredClone(value);

test('widget field edits preserve concurrent edits to other entries, title, tags and fields', () => {
  const original = day();
  const operation = changeOperation(original.entries[0], { text: 'Widget text' });
  const current = { ...original, title: 'App title', entries: [{ ...original.entries[0], done: true, tag: 'work' }, { ...original.entries[1], description: 'App details' }, entry('new')] };
  const result = applyDayOperation(current, operation);
  assert.equal(result.title, 'App title');
  assert.deepEqual(result.entries.find(e => e.id === 'a'), { ...original.entries[0], done: true, tag: 'work', text: 'Widget text' });
  assert.equal(result.entries.find(e => e.id === 'b').description, 'App details');
  assert.ok(result.entries.some(e => e.id === 'new'));
});
test('conflicting text/title edits reject before changing the authoritative day', () => {
  const original = day(), current = { ...original, title: 'App title', entries: [entry('a', { text: 'App text' })] };
  assert.throws(() => applyDayOperation(current, changeOperation(original.entries[0], { text: 'Widget text' })), EditConflict);
  assert.throws(() => applyDayOperation(current, { kind: 'title', before: '', value: 'Widget title' }), EditConflict);
  assert.equal(current.entries[0].text, 'App text');
  assert.equal(applyDayOperation(current, changeOperation(original.entries[0], { text: 'Widget text' }), true).entries[0].text, 'Widget text');
});
test('duplicate create/change/delete requests are idempotent and deletion detects concurrent edits', () => {
  const original = day(), create = { kind: 'create', entry: entry('new'), after: 'a' };
  const created = applyDayOperation(original, create);
  assert.deepEqual(created.entries.map(e => e.id), ['a', 'new', 'b']);
  assert.strictEqual(applyDayOperation(created, create), created);
  const operation = changeOperation(original.entries[0], { done: true });
  const changed = applyDayOperation(original, operation);
  assert.deepEqual(applyDayOperation(changed, operation), changed);
  const remove = { kind: 'remove', id: 'a', before: original.entries[0] };
  assert.throws(() => applyDayOperation(changed, remove), EditConflict);
  const removed = applyDayOperation(original, remove);
  assert.strictEqual(applyDayOperation(removed, remove), removed);
  assert.throws(() => applyDayOperation(removed, operation), EditConflict);
});
test('reordering keeps new entries from the other editor and respects kind/tag/priority groups', () => {
  setTagOrder([{ id: 'other', name: 'Other', color: '#ff0000' }]);
  const original = day('2026-11-11', [entry('a'), entry('new'), entry('b'), entry('other', { tag: 'other' })]);
  const reordered = applyDayOperation(original, { kind: 'move', id: 'b', target: 'a', placement: 'before' });
  assert.deepEqual(reordered.entries.map(e => e.id), ['b', 'a', 'new', 'other']);
  assert.deepEqual(applyDayOperation(reordered, { kind: 'move', id: 'b', target: 'other', placement: 'after' }).entries, reordered.entries);
});

function fixture() {
  let current = day(), fail = false;
  const data = new Map([[current.date, copy(current)], ['2026-11-12', day('2026-11-12')]]), saved = [], published = [];
  const storage = {
    async load(date) { return copy(data.get(date) ?? day(date, [])); },
    async save(value) {
      if (fail) throw new Error('Disk full');
      assert.equal(value.revision, data.get(value.date)?.revision ?? 1);
      const next = { ...copy(value), revision: value.revision + 1 };
      data.set(next.date, next); saved.push(copy(next)); return next;
    },
  };
  const editor = {
    current: () => current,
    replace(value) { current = value; },
    async flush() { if (current && JSON.stringify(current) !== JSON.stringify(data.get(current.date))) current = await storage.save(current); },
    refresh(before, refreshed) { current = { ...refreshed, title: current.title }; },
  };
  const sessions = new DaySessions(editor, storage, value => published.push(copy(value)));
  return { sessions, data, saved, published, storage, editor, current: () => current, setCurrent: value => { current = value; }, setFailure: value => { fail = value; } };
}
test('same-date widget operations edit the main draft and never start a second stale day writer', async () => {
  const f = fixture();
  f.setCurrent({ ...f.current(), title: 'Unsaved main title' });
  await f.sessions.run(() => f.sessions.apply('2026-11-11', changeOperation(f.current().entries[0], { text: 'Widget text' })));
  assert.equal(f.saved.length, 0);
  assert.equal(f.current().title, 'Unsaved main title');
  assert.equal(f.current().entries[0].text, 'Widget text');
  await f.sessions.run(() => f.sessions.flush());
  assert.equal(f.saved.length, 1);
  assert.equal(f.saved[0].title, 'Unsaved main title');
  assert.equal(f.saved[0].entries[0].text, 'Widget text');
});
test('different-date drafts remain independent and the barrier persists both before navigation or undo', async () => {
  const f = fixture();
  f.setCurrent({ ...f.current(), title: 'Today' });
  await f.sessions.run(() => f.sessions.apply('2026-11-12', { kind: 'title', before: '', value: 'Tomorrow' }));
  assert.ok(f.sessions.hasDrafts());
  assert.equal(f.data.get('2026-11-12').title, '');
  await f.sessions.run(() => f.sessions.flush());
  assert.equal(f.data.get('2026-11-11').title, 'Today');
  assert.equal(f.data.get('2026-11-12').title, 'Tomorrow');
  assert.equal(f.sessions.hasDrafts(), false);
  assert.ok(f.published.some(day => day.title === 'Tomorrow' && day.revision === 2));
});
test('queued operations see preceding edits and flush failures retain recoverable drafts', async () => {
  const f = fixture();
  const first = f.sessions.run(() => f.sessions.apply('2026-11-12', { kind: 'title', before: '', value: 'One' }));
  const second = f.sessions.run(() => f.sessions.apply('2026-11-12', { kind: 'title', before: 'One', value: 'Two' }));
  assert.equal(f.sessions.hasDrafts(), true);
  await Promise.all([first, second]);
  f.setFailure(true);
  await assert.rejects(f.sessions.run(() => f.sessions.flush()), /Disk full/);
  assert.equal((await f.sessions.read('2026-11-12')).title, 'Two');
  assert.equal(f.sessions.hasDrafts(), true);
  f.setFailure(false);
  await f.sessions.run(() => f.sessions.flush());
  assert.equal(f.data.get('2026-11-12').title, 'Two');
});
test('linked task actions cover both the main date and a different widget date', async () => {
  const f = fixture();
  await f.sessions.run(() => f.sessions.linked([{date:'2026-11-11',id:'a'},{date:'2026-11-12',id:'b'}], 'done'));
  await f.sessions.run(() => f.sessions.flush());
  assert.equal(f.current().entries[0].done, true);
  assert.equal(f.data.get('2026-11-12').entries[1].done, true);
});
test('calendar refresh merges imported entries with an unsaved widget draft rather than replacing it', async () => {
  const f = fixture();
  await f.sessions.run(() => f.sessions.apply('2026-11-12', changeOperation(entry('a'), { text: 'Typed in widget' })));
  f.data.set('2026-11-12', { ...day('2026-11-12', [entry('a', { time:'10:00' }), entry('b'), entry('imported')]), revision:2 });
  await f.sessions.run(() => f.sessions.reload(['2026-11-12']));
  const draft = await f.sessions.read('2026-11-12');
  assert.equal(draft.entries[0].text, 'Typed in widget');
  assert.equal(draft.entries[0].time, '10:00');
  assert.equal(draft.revision, 2);
  assert.ok(draft.entries.some(e => e.id === 'imported'));
  await f.sessions.run(() => f.sessions.flush());
  assert.equal(f.data.get('2026-11-12').revision, 3);
});
