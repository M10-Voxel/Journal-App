import test from 'node:test';
import assert from 'node:assert/strict';
import { boardKey, cardGroups, cardOnBoard, groupFrames, isOnBoard, layoutBoard, libraryNotes, pinToBoard, scopedBoardPatch } from '../src/boardPlacement.ts';
import { removalIds } from '../src/notebook.ts';

const card = (id, extra = {}) => ({ id, kind: 'note', title: id, text: '**Shared content**', order: 1, dates: ['2026-11-08'], ...extra });
const apply = (cards, patches) => cards.map(card => ({ ...card, ...patches[card.id] }));

test('month and year membership is explicit, and old daily boards keep their contents and layout', () => {
  const cards = [card('a', { boardX: 75, y: 91 }), card('b', { dates: ['2026-12-08'] })];
  assert.equal(boardKey('2026-11-08'), '2026-11-08');
  assert.equal(boardKey('2026-11-30', 'month'), 'month:2026-11');
  assert.equal(boardKey('2026-01-01', 'year'), 'year:2026');
  assert.deepEqual(layoutBoard(cards, '2026-11-08', 640).map(({ card, x, y }) => [card.id, x, y]), [['a', 75, 91]]);
  assert.deepEqual(layoutBoard(cards, 'month:2026-11', 640), []);
  const pinned = apply(cards, pinToBoard(cards, ['a'], 'month:2026-11', true));
  assert.equal(isOnBoard(pinned[0], 'month:2026-11'), true);
  assert.equal(isOnBoard(pinned[0], 'month:2026-12'), false);
  assert.equal(isOnBoard(pinned[0], 'year:2026'), false);
  assert.deepEqual(pinned[0].dates, cards[0].dates);
});

test('connected groups include indirect, mixed-kind and one-sided links without dangling or cyclic duplicates', () => {
  const cards = [card('a', { links: ['b', 'missing'] }), card('b', { kind: 'image', links: ['c', 'a'] }), card('c', { kind: 'link', links: ['a'] }), card('d')];
  assert.deepEqual(cardGroups(cards), [['a', 'b', 'c'], ['d']]);
  assert.deepEqual(cardGroups([card('a'), card('b', { links: ['a', 'b'] })]), [['a', 'b']]);
});

test('group transfer preserves exact absolute coordinates and sizes even when source uses old relative positions', () => {
  const cards = [card('a', { x: .2, y: 82, links: ['b'], w: 280, h: 160 }), card('b', { kind: 'image', x: .8, y: 310, links: ['a'] })];
  const source = layoutBoard(cards, '2026-11-08', 1000);
  const positions = Object.fromEntries(source.map(({ card, x, y, z }) => [card.id, { boardX: x, y, z, w: card.w, h: card.h }]));
  const assigned = apply(cards, pinToBoard(cards, cardGroups(cards)[0], 'year:2026', true, positions));
  const destination = layoutBoard(assigned, 'year:2026', 420);
  assert.deepEqual(destination.map(p => [p.card.id, p.x, p.y, p.card.w, p.card.h]), source.map(p => [p.card.id, p.x, p.y, p.card.w, p.card.h]));
  assert.equal(assigned.length, cards.length);
  assert.deepEqual(assigned.map(c => c.links), cards.map(c => c.links));
});

test('period moves and resizing are isolated while text edits remain shared and other memberships survive', () => {
  let cards = [card('a', { boardX: 52, y: 74 })];
  for (const key of ['month:2026-11', 'year:2026']) cards = apply(cards, pinToBoard(cards, ['a'], key, true));
  const patch = scopedBoardPatch(cards[0], 'month:2026-11', { boardX: -18, y: 270, w: 350, h: 0, z: 9, text: 'New text' });
  cards = apply(cards, { a: patch });
  assert.equal(cards[0].boardX, 52); assert.equal(cards[0].y, 74);
  assert.equal(cardOnBoard(cards[0], 'month:2026-11').boardX, -18);
  assert.equal(cardOnBoard(cards[0], 'month:2026-11').h, 0);
  assert.equal(cardOnBoard(cards[0], 'year:2026').boardX, 52);
  assert.equal(cardOnBoard(cards[0], 'year:2026').text, 'New text');
  assert.deepEqual(pinToBoard(cards, ['a'], 'month:2026-11', true, { a: { boardX: 900 } }), {}, 'Reassigning does not reset an existing layout.');
  assert.deepEqual(scopedBoardPatch(cards[0], '2026-11-08', { boardX: 100 }), { boardX: 100 });
  const creation = scopedBoardPatch(undefined, 'month:2026-12', { kind: 'image', dates: [], boardX: 82, y: 36 });
  assert.deepEqual(creation, { kind: 'image', dates: [], boards: { 'month:2026-12': { boardX: 82, y: 36 } } });
});

test('taking down only selected cards leaves the day, other periods, links and content intact', () => {
  let cards = [card('a', { links: ['b'] }), card('b', { links: ['a'] })];
  for (const key of ['month:2026-11', 'year:2026']) cards = apply(cards, pinToBoard(cards, ['a', 'b'], key, true));
  cards = apply(cards, pinToBoard(cards, ['a'], 'month:2026-11', false));
  assert.equal(isOnBoard(cards[0], 'month:2026-11'), false);
  assert.equal(isOnBoard(cards[1], 'month:2026-11'), true);
  assert(cards.every(c => isOnBoard(c, 'year:2026') && isOnBoard(c, '2026-11-08')));
  assert.deepEqual(cards[0].links, ['b']);
  assert.equal(cards[0].text, '**Shared content**');
});

test('explicit group transfer aligns a member already pinned at another destination position', () => {
  const cards = [card('a', { links: ['b'], boardX: 20, y: 30, boards: { 'year:2026': { boardX: 900, y: 800 } } }), card('b', { links: ['a'], boardX: 230, y: 150 })];
  const moved = apply(cards, pinToBoard(cards, ['a', 'b'], 'year:2026', true, { a: { boardX: 20, y: 30 }, b: { boardX: 230, y: 150 } }, true));
  assert.deepEqual(layoutBoard(moved, 'year:2026', 420).map(p => [p.x, p.y]), [[20, 30], [230, 150]]);
  assert.deepEqual(moved.map(c => [c.boardX, c.y]), [[20, 30], [230, 150]]);
});

test('group rectangles follow all visible cards, updated dimensions and partial groups', () => {
  const groups = [['a', 'b', 'hidden'], ['alone']];
  const boxes = { a: { left: -20, top: 20, width: 200, height: 120 }, b: { left: 300, top: 180, width: 250, height: 180 }, alone: { left: 700, top: 0, width: 100, height: 100 } };
  assert.deepEqual(groupFrames(groups, boxes), [{ ids: ['a', 'b'], left: -34, top: 6, width: 598, height: 368 }]);
  assert.deepEqual(groupFrames(groups, { a: boxes.a }), []);
  assert.equal(groupFrames(groups, { ...boxes, b: { ...boxes.b, height: 400 } })[0].height, 588);
});

test('period-pinned notebook attachments are kept when their former note is deleted', () => {
  const note = card('a', { links: ['b'] });
  const attachment = card('b', { kind: 'image', dates: [], notebook: true, links: ['a'], boards: { 'month:2026-11': { boardX: 40, y: 30 } } });
  assert.deepEqual([...removalIds([note, attachment], 'a')], ['a']);
  assert.deepEqual([...removalIds([note, { ...attachment, boards: { 'month:2026-11': null } }], 'a')], ['a', 'b']);
});

test('copies of notes: new ids, the threads between them kept, images left out', async () => {
  const { copyCards } = await import('../src/boardPlacement.ts');
  const card = (id, kind, extra = {}) => ({ id, kind, title:id.toUpperCase(), text:`text ${id}`, dates:[], order:0, ...extra });
  const cards = [card('a','note',{ links:['b','img','c'], paper:'blue', w:300, groupName:'Project' }), card('b','note',{ links:['a'] }), card('img','image',{ links:['a'], asset:'x' }), card('c','link',{ url:'https://example.org', links:['a'] }), card('z','note')];
  let n = 0;
  const copies = copyCards(cards, ['a','b','img','c'], () => `new-${++n}`);
  assert.deepEqual(copies.map(copy => [copy.from, copy.card.id, copy.card.kind]), [['a','new-1','note'],['b','new-2','note'],['c','new-3','link']]);
  assert.deepEqual(copies.map(copy => copy.card.links), [['new-2','new-3'],['new-1'],['new-1']]);
  assert.equal(copies[0].card.paper, 'blue'); assert.equal(copies[0].card.w, 300); assert.equal(copies[0].card.title, 'A'); assert.equal(copies[2].card.url, 'https://example.org');
  assert.equal('asset' in copies[0].card, false);
  assert.equal(copies[0].card.groupName, 'Project');
  // One note alone: no thread to a card that is not copied.
  assert.deepEqual(copyCards(cards, ['a'], () => 'only').map(copy => copy.card.links), [[]]);
  assert.deepEqual(copyCards(cards, ['img', 'missing'], () => 'nope'), []);
});

test('copy layout preserves group positions and sizes from daily and period boards', async () => {
  const { copyLayout } = await import('../src/boardPlacement.ts');
  const cards = [card('a', { boardX: -40, y: 90, w: 310, h: 270 }), card('b', { boardX: 340, y: 210, w: 180, h: 410 })];
  assert.deepEqual(copyLayout(cards, ['a', 'b'], 500), { a: { boardX: -40, y: 90, z: 0, w: 310, h: 270 }, b: { boardX: 340, y: 210, z: 0, w: 180, h: 410 } });
  const period = cards.map((c, i) => ({ ...c, dates: [], boards: { 'year:2026': { boardX: 120 + i * 400, y: 80 + i * 70, w: 360, h: 320 } } }));
  assert.deepEqual(Object.values(copyLayout(period, ['a', 'b'], 400)).map(p => [p.boardX, p.y, p.w, p.h]), [[120, 80, 360, 320], [520, 150, 360, 320]]);
});

test('"Existing" offers every note once: copies, legacy duplicates and stale copies collapse', () => {
  const cards = [
    card('orig', { title: 'Plan', text: 'A', dates: ['2026-11-01'] }),
    card('copy1', { title: 'Plan', text: 'A', copyOf: 'orig', dates: ['2026-11-02'], order: 5 }),
    card('copy2', { title: 'Plan', text: 'A', copyOf: 'copy1', dates: ['2026-11-03'] }),
    card('old1', { title: 'Liste', text: 'B', dates: ['2026-11-04'] }),
    card('old2', { title: 'Liste', text: 'B', dates: ['2026-11-05'] }),
    card('stale', { title: 'Weg', text: 'C', dates: [] }),
    card('book', { title: 'Heft', text: 'D', dates: [], notebook: true }),
    { id: 'img', kind: 'image', title: 'Bild', text: '', dates: ['2026-11-01'] },
  ];
  assert.deepEqual(libraryNotes(cards, '2026-11-09').map(c => c.id).sort(), ['book', 'old1', 'orig']);
  // A copy already on this board is not offered; its note still is, once.
  assert.deepEqual(libraryNotes(cards, '2026-11-03').map(c => c.id).sort(), ['book', 'old1', 'orig']);
  assert.deepEqual(libraryNotes(cards, '2026-11-01').map(c => c.id).sort(), ['book', 'copy1', 'old1']);
  // The original gone: the latest copy stands for it.
  assert.deepEqual(libraryNotes(cards.filter(c => c.id !== 'orig'), '2026-11-09').map(c => c.id).filter(id => id.startsWith('copy')), ['copy1']);
  assert.deepEqual(libraryNotes(cards, '2026-11-09', 'heft').map(c => c.id), ['book']);
});
