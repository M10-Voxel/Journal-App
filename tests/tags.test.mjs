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

test('tag kinds: own first, then the checklist, then the mail import; moving stays within a kind', async () => {
  const { groupTags, moveWithinKind, orderedTags } = await import('../src/tagKinds.ts');
  const mail = { id:'f4c8191a-2d70-4b01-9d00-000000000001', name:'Lieferung', color:'#e6a85c' };
  const list = [mail, { id:'a1', name:'Sport', color:'#fff' }, { id:'o1', name:'Arbeit', color:'#fff' }, { id:'o2', name:'Uni', color:'#fff' }];
  const activities = new Set(['a1']);
  assert.deepEqual(groupTags(list, activities).map(group => group.kind), ['own', 'activity', 'mail']);
  assert.deepEqual(orderedTags(list, activities).map(tag => tag.id), ['o1', 'o2', 'a1', mail.id]);
  assert.deepEqual(moveWithinKind(list, 'o2', -1, activities).map(tag => tag.id), ['o2', 'o1', 'a1', mail.id]);
  assert.deepEqual(moveWithinKind(list, 'a1', -1, activities).map(tag => tag.id), ['o1', 'o2', 'a1', mail.id], 'A tag never leaves its kind.');
});

test('the order of the tag kinds is the user\'s: whole, once each, default first', async () => {
  const { normalizeKindOrder, groupTags, moveKind, kindOrder, resetKindOrder, orderedTags } = await import('../src/tagKinds.ts');
  assert.deepEqual(normalizeKindOrder(null), ['own', 'activity', 'mail']);
  assert.deepEqual(normalizeKindOrder(['mail', 'own']), ['mail', 'own', 'activity']);
  assert.deepEqual(normalizeKindOrder(['mail', 'mail', 'bogus', 'activity']), ['mail', 'activity', 'own']);
  const tags = [{ id:'o', name:'Own', color:'#111111' }, { id:'a', name:'Act', color:'#222222' }, { id:'m', name:'Mail', color:'#333333' }];
  const activity = new Set(['a']);
  assert.deepEqual(orderedTags(tags, new Set(['a'])).map(tag => tag.id).filter(id => id !== 'm'), ['o', 'a']);
  const mailId = Object.values((await import('../src/mailTags.ts')).mailTagDefinitions)[0].id;
  const all = [...tags.slice(0, 2), { id: mailId, name:'Mail', color:'#333333' }];
  assert.deepEqual(groupTags(all, activity).map(group => group.kind), ['own', 'activity', 'mail']);
  assert.equal(moveKind('mail', -1), true);
  assert.deepEqual(kindOrder(), ['own', 'mail', 'activity']);
  assert.deepEqual(groupTags(all, activity).map(group => group.kind), ['own', 'mail', 'activity']);
  assert.equal(moveKind('own', -1), false);
  assert.equal(moveKind('activity', 1), false);
  resetKindOrder();
  assert.deepEqual(kindOrder(), ['own', 'activity', 'mail']);
});
