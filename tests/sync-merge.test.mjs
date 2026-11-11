import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeThreeWay } from '../src/sync/merge.ts';

test('independent offline changes can be combined without relying on key order', () => {
  const base = { title:'Alt', entry:{ text:'Termin', time:'10:00' } };
  const result = mergeThreeWay(base, { entry:{ time:'10:00', text:'Neu' }, title:'Alt' }, { title:'Tag', entry:{ text:'Termin', time:'10:00' } });
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.value, { title:'Tag', entry:{ text:'Neu', time:'10:00' } });
});

test('concurrent edits and delete-versus-edit are reported rather than silently lost', () => {
  const result = mergeThreeWay({ text:'vorher', task:{ done:false }, plan:[1] }, { text:'lokal', plan:[2] }, { text:'fern', task:{ done:true }, plan:[3] });
  assert.deepEqual(result.conflicts.map(c => c.path), ['/text','/task','/plan']);
  assert.equal(result.conflicts[1].local, undefined);
  assert.deepEqual(result.conflicts[2].remote, [3]);
});

test('a one-sided deletion and identical concurrent change are accepted', () => {
  assert.deepEqual(mergeThreeWay({x:1,y:2}, {y:3}, {x:1,y:3}), {value:{y:3},conflicts:[]});
  assert.equal(mergeThreeWay(undefined, {text:'neu'}, undefined).value.text, 'neu');
});

test('new values recorded on the same day merge independently, conflicting values still need a choice', () => {
  const base={days:{}};
  const local={days:{'2026-11-11':{items:{},scales:{sleep:7}}}};
  const remote={days:{'2026-11-11':{items:{},rating:8,scales:{stress:3}}}};
  const result=mergeThreeWay(base,local,remote);
  assert.deepEqual(result.conflicts,[]);
  assert.deepEqual(result.value.days['2026-11-11'],{items:{},rating:8,scales:{sleep:7,stress:3}});
  remote.days['2026-11-11'].scales.sleep=2;
  assert.deepEqual(mergeThreeWay(base,local,remote).conflicts.map(c=>c.path),['/days/2026-11-11/scales/sleep']);
});
