import test from 'node:test';
import assert from 'node:assert/strict';
import { syncPatches, copySyncPatches } from '../src/boardSync.ts';

const note = (id, extra = {}) => ({ id, kind: 'note', title: id, text: `Text ${id}`, dates: [], order: 0, ...extra });
const cards = [note('a'), note('b', { copyOf: 'a', copySync: true }), note('c', { copyOf: 'b', copySync: true }), note('d', { copyOf: 'a', copySync: false }), note('e', { links: ['a'] })];

test('content edits propagate both ways through enabled copies, not through ordinary threads or disabled copies', () => {
  for (const id of ['a', 'b', 'c']) {
    const patches = syncPatches(cards, { [id]: { text: 'Shared', tag: null } });
    assert.deepEqual(Object.keys(patches).sort(), ['a', 'b', 'c']);
    assert(Object.values(patches).every(patch => patch.text === 'Shared' && patch.tag === null));
  }
});
test('standalone cards share size but keep their own positions and memberships', () => {
  const patch = { boardX: 99, y: 80, w: 400, h: 300, dates: ['2026-11-10'], folder: 'work', links: ['d'] };
  assert.deepEqual(syncPatches(cards, { b: patch }).a, { w: 400, h: 300 });
  const mixed = syncPatches(cards, { b: { ...patch, title: 'New' } });
  assert.deepEqual(mixed.a, { title: 'New', w: 400, h: 300 });
  assert.deepEqual(mixed.b, { ...patch, title: 'New' });
});
test('standalone period cards share size without overwriting local placement', () => {
  const stored = [note('a', { boards: { 'year:2026': { boardX: 40, y: 70, w: 200 }, 'month:2026-11': null } }), note('b', { copyOf: 'a', copySync: true, boards: { 'month:2026-11': { boardX: 80, y: 90, w: 200 } } })];
  const updated = syncPatches(stored, { b: { boards: { 'month:2026-11': { boardX: 110, y: 120, w: 350 } } } });
  assert.equal(updated.a.boardX, undefined); assert.equal(updated.a.y, undefined);
  assert.deepEqual(updated.a.boards['year:2026'], { boardX: 40, y: 70, w: 350 });
  assert.equal(updated.a.boards['month:2026-11'], null);
  assert.equal(updated.b.boards['month:2026-11'].w, 350);
  assert.deepEqual(syncPatches(stored, { b: { copySync: false, boardX: 22 } }), { b: { copySync: false, boardX: 22 } });
});
test('whole-group translation stays local; internal moves preserve the other group offset', () => {
  const group = [note('a',{boardX:10,y:20,links:['b']}),note('b',{boardX:210,y:120,links:['a']}),note('ca',{boardX:1010,y:520,links:['cb'],copyOf:'a',copySync:true}),note('cb',{boardX:1210,y:620,links:['ca'],copyOf:'b',copySync:true})];
  assert.deepEqual(syncPatches(group,{ca:{boardX:1110,y:620},cb:{boardX:1310,y:720}}),{ca:{boardX:1110,y:620},cb:{boardX:1310,y:720}});
  const internal = syncPatches(group,{b:{boardX:250,y:130}});
  assert.deepEqual(internal.cb,{boardX:1250,y:630});
  assert.equal(internal.ca,undefined);
  assert.deepEqual(syncPatches(group,internal),internal,'Expanding a batch twice must not move cards twice.');
  const on = copySyncPatches(group,['ca','cb'],true);
  assert.deepEqual([on.ca.boardX,on.ca.y,on.cb.boardX,on.cb.y],[1010,520,1210,620]);
  assert.equal(copySyncPatches(cards,['d'],true).d.boardX,undefined);
});
test('internal period moves retain the copied group placement, while period-group translations stay local', () => {
  const group = [note('a',{links:['b'],boards:{'year:2026':{boardX:10,y:20}}}),note('b',{links:['a'],boards:{'year:2026':{boardX:210,y:120}}}),note('ca',{links:['cb'],copyOf:'a',copySync:true,boards:{'month:2026-11':{boardX:1010,y:520}}}),note('cb',{links:['ca'],copyOf:'b',copySync:true,boards:{'month:2026-11':{boardX:1210,y:620}}})];
  const internal = syncPatches(group,{b:{boards:{'year:2026':{boardX:230,y:130}}}});
  assert.deepEqual(internal.cb.boards['month:2026-11'],{boardX:1230,y:630});
  assert.equal(internal.ca,undefined);
  const translate={a:{boards:{'year:2026':{boardX:110,y:220}}},b:{boards:{'year:2026':{boardX:310,y:320}}}};
  assert.deepEqual(syncPatches(group,translate),translate);
  const off = group.map(card=>({...card,copySync:false,boards:card.id==='b'?{'year:2026':{boardX:230,y:130}}:card.boards}));
  const enabled = copySyncPatches(off,['ca','cb'],true,640,'month:2026-11');
  assert.deepEqual(enabled.ca.boards['month:2026-11'],{boardX:1010,y:520});
  assert.deepEqual(enabled.cb.boards['month:2026-11'],{boardX:1230,y:630});
  const expanded = syncPatches(off,enabled);
  assert.equal(expanded.b.boardX,undefined,'Enabling a group does not replace the original group origin.');
});
test('enabling takes current source content; disabling keeps content and splits the copy chain', () => {
  const on = copySyncPatches(cards, ['d'], true);
  assert.equal(on.d.text, 'Text a'); assert.equal(on.d.copySync, true);
  assert.deepEqual(copySyncPatches(cards, ['b'], false), { b: { copySync: false } });
  const split = syncPatches(cards, { b: { copySync: false }, a: { text: 'Changed' } });
  assert.equal(split.c, undefined);
  assert.equal(split.b.text, undefined);
});
test('missing sources, legacy cards and cyclic copy links are harmless', () => {
  assert.deepEqual(copySyncPatches([note('x', { copyOf: 'missing' })], ['x'], true), {});
  const patch = { a: { text: 'Independent' } };
  assert.deepEqual(syncPatches([note('a'), note('b')], patch), patch);
  const cycle = [note('a', { copyOf: 'b', copySync: true }), note('b', { copyOf: 'a', copySync: true })];
  assert.deepEqual(syncPatches(cycle, patch), { a: patch.a, b: patch.a });
});

test('handwriting and the text/drawing mode travel through enabled copies like text', () => {
  const ink = { v: 1, strokes: [{ size: 3, pressure: true, points: 'AAAAAAAA' }] };
  const patches = syncPatches(cards, { b: { mode: 'ink', ink } });
  assert.deepEqual(Object.keys(patches).sort(), ['a', 'b', 'c']);
  assert(Object.values(patches).every(patch => patch.mode === 'ink' && patch.ink === ink));
});

test('the background of a drawing travels through enabled copies', () => {
  const patches = syncPatches(cards, { b: { inkPaper: { kind: 'lines', step: 24 } } });
  assert.deepEqual(Object.keys(patches).sort(), ['a', 'b', 'c']);
  assert(Object.values(patches).every(patch => patch.inkPaper?.kind === 'lines'));
});
