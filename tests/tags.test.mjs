import test from 'node:test';
import assert from 'node:assert/strict';
import { orderEntries, moveEntry, moveEntryByOffset, sameGroup } from '../src/entries.ts';
import { filterKey, filterTagDays, isShown, matchTags, nextTagColor, setTagOrder, tagRank, tagSwatches, untagged } from '../src/tags.ts';
import { hexOf, hsvaOf } from '../src/colorSpace.ts';

const tags = [{ id:'work', name:'Arbeit', color:'#569eff' }, { id:'uni', name:'Uni', color:'#76d982' }, { id:'home', name:'Privat', color:'#e6a85c' }];
const entry = (id, kind, tag = null, extra = {}) => ({ id, kind, text:id, done:false, cancelled:false, priority:false, tag, ...extra });

test('entries are grouped by tag within their kind: untagged first, then the tags in their order, priority first inside', () => {
  setTagOrder(tags);
  const ordered = orderEntries([entry('u1', 'task', 'uni'), entry('t1', 'task'), entry('w1', 'task', 'work'), entry('e1', 'event', 'uni'), entry('w2', 'task', 'work', { priority:true }), entry('u2', 'task', 'uni'), entry('x', 'task', 'gone')]);
  assert.deepEqual(ordered.map(item => item.id), ['e1', 't1', 'x', 'w2', 'w1', 'u1', 'u2'], 'A tag that no longer exists counts as none.');
  setTagOrder([tags[1], tags[0], tags[2]]);
  assert.deepEqual(orderEntries(ordered).filter(item => item.kind === 'task').map(item => item.id), ['t1', 'x', 'u1', 'u2', 'w2', 'w1'], 'Reordering the tags reorders the groups.');
  setTagOrder(tags);
});

test('entries move only within their tag group, and hidden ones are stepped over', () => {
  setTagOrder(tags);
  const list = orderEntries([entry('w1', 'task', 'work'), entry('w2', 'task', 'work'), entry('w3', 'task', 'work'), entry('u1', 'task', 'uni')]);
  assert.equal(moveEntry(list, 'u1', 'w1', 'before'), list, 'Not into another tag.');
  assert.deepEqual(moveEntry(list, 'w3', 'w1', 'before').map(item => item.id), ['w3', 'w1', 'w2', 'u1']);
  assert.equal(moveEntryByOffset(list, 'w3', 1), list, 'The last of a group stays.');
  assert.deepEqual(moveEntryByOffset(list, 'w3', -1, item => item.id !== 'w2').map(item => item.id), ['w3', 'w1', 'w2', 'u1'], 'A hidden neighbour is passed.');
  assert(sameGroup(entry('a', 'task', 'gone'), entry('b', 'task')), 'Unknown and missing tags are the same group.');
});

test('filters hide tags by id and untagged entries by their own key', () => {
  setTagOrder(tags);
  const hidden = new Set(['uni', untagged]);
  assert.equal(isShown(hidden, 'work'), true);
  assert.equal(isShown(hidden, 'uni'), false);
  assert.equal(isShown(hidden, null), false);
  assert.equal(filterKey('gone'), untagged, 'An unknown tag counts as untagged.');
  assert.equal(tagRank('home'), 3);
  const day = {date:'2026-11-01',title:'Tag',entries:[entry('w','task','work'),entry('u','event','uni'),entry('n','note')]};
  const visible = filterTagDays(new Map([[day.date,day]]),hidden);
  assert.deepEqual(visible.get(day.date).entries.map(item=>item.id),['w'],'Summaries and compact calendar markers share the same filter.');
  assert.equal(day.entries.length,3,'Filtering never removes stored entries.');
});

test('tags are found by the start of their name first, and a typed new name is recognised', () => {
  const found = matchTags([...tags, { id:'n', name:'Kunst', color:'#fff' }], 'un');
  assert.deepEqual(found.matches.map(tag => tag.name), ['Uni', 'Kunst']);
  assert.equal(found.exact, null);
  assert.equal(matchTags(tags, ' privat ').exact?.id, 'home');
  assert.equal(nextTagColor(tags), tagSwatches[3], 'New tags get a colour not in use yet.');
});

test('the colour picker converts losslessly between hex and hue, saturation, brightness', () => {
  for (const hex of ['#569eff', '#000000', '#ffffff', '#ff5555', '#76d98280']) assert.equal(hexOf(hsvaOf(hex), hex.length === 9), hex);
  assert.equal(hsvaOf('#808080', 200).h, 200, 'Grey keeps the hue the picker was at.');
  assert.equal(hexOf({ h:0, s:1, v:1, a:.5 }, false), '#ff0000', 'Without opacity the alpha is left out.');
});
