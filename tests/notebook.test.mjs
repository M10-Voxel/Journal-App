import test from 'node:test';
import assert from 'node:assert/strict';
import { attachmentsOf, canMoveFolder, connectPatches, disconnectPatches, flatTree, folderPath, folderWithin, nextFolderOrder, notesIn, onDayPatch, pagesOf, removalIds, removalPatches, threadKind, threads, visibleTree } from '../src/notebook.ts';

const folder = (id, name, parent = null, order = 1) => ({ id, name, parent, order });
const card = (id, kind, extra = {}) => ({ id, kind, title: id, text: '', dates: [], order: 1, ...extra });
const apply = (cards, patches) => cards.map(value => patches[value.id] ? { ...value, ...patches[value.id] } : value);

const folders = [folder('top', 'Projekte'), folder('garden', 'Garten', 'top', 2), folder('beds', 'Beete', 'garden'), folder('shop', 'Einkauf', 'top', 1), folder('home', 'Zuhause', null, 2)];

test('a folder knows its path, what lies inside it, and where it may move', () => {
  assert.deepEqual(folderPath(folders, 'beds'), ['Projekte', 'Garten', 'Beete']);
  assert.deepEqual(folderPath(folders, null), []);
  assert.deepEqual([...folderWithin(folders, 'top')].sort(), ['beds', 'garden', 'shop', 'top']);
  // Never into itself or one of its own subfolders; anywhere else (and to the top) is fine.
  assert.equal(canMoveFolder(folders, 'top', 'beds'), false);
  assert.equal(canMoveFolder(folders, 'garden', 'garden'), false);
  assert.equal(canMoveFolder(folders, 'garden', 'home'), true);
  assert.equal(canMoveFolder(folders, 'beds', null), true);
  assert.equal(nextFolderOrder(folders, 'top'), 3);
  assert.equal(nextFolderOrder(folders, 'beds'), 1);
});

test('the tree runs in order with its depth and tree lines, and a folder whose parent is gone stays visible', () => {
  const rows = flatTree([...folders, folder('orphan', 'Waise', 'gone', 3)]);
  assert.deepEqual(rows.map(row => `${'  '.repeat(row.depth)}${row.folder.name}${row.last ? ' (last)' : ''}`),
    ['Projekte', '  Einkauf', '  Garten (last)', '    Beete (last)', 'Zuhause', 'Waise (last)']);
  // Beete: below Projekte (more follows at the top) and below Garten (the last one).
  assert.deepEqual(rows[3].lines, [true, false]);
  // A cycle (from an old sync) does not loop, and its folders still show.
  assert.deepEqual(flatTree([folder('a', 'A', 'b'), folder('b', 'B', 'a')]).map(row => row.folder.id + row.depth), ['a0', 'b1']);
  assert.deepEqual(folderPath([folder('a', 'A', 'b'), folder('b', 'B', 'a')], 'a'), ['B', 'A']);
  assert.deepEqual(visibleTree([folder('a', 'A', 'b'), folder('b', 'B', 'a')], new Set()).map(row => row.folder.id), ['a', 'b']);
  assert.deepEqual(visibleTree([folder('a', 'A', 'b'), folder('b', 'B', 'a')], new Set(['a'])).map(row => row.folder.id), ['a']);
  assert.deepEqual(visibleTree(folders, new Set(['garden'])).map(row => row.folder.id), ['top', 'shop', 'garden', 'home']);
});

test('deleting a note keeps shared attachments and cards belonging to a day', () => {
  const cards = [card('note', 'note', { links: ['private', 'shared', 'daily', 'page'] }),
    card('private', 'image', { notebook: true, links: ['note'] }),
    card('shared', 'image', { notebook: true, links: ['note', 'page'] }),
    card('daily', 'link', { notebook: true, dates: ['2026-11-04'], links: ['note'] }),
    card('page', 'note', { notebook: true, links: ['note'] })];
  assert.deepEqual([...removalIds(cards, 'note')], ['note', 'private']);
  assert.deepEqual([...removalIds(cards, 'daily')], ['daily']);
});

test('threads tie both cards: an image or link to a note is an attachment, two notes are pages', () => {
  let cards = [card('n1', 'note'), card('n2', 'note'), card('img', 'image'), card('url', 'link')];
  assert.equal(threadKind(cards[0], cards[2]), 'attachment');
  assert.equal(threadKind(cards[0], cards[1]), 'page');
  assert.equal(threadKind(cards[2], cards[3]), null);
  // Two images (or an image and a link) cannot be tied, nor a card to itself.
  assert.deepEqual(connectPatches(cards, 'img', 'url'), {});
  assert.deepEqual(connectPatches(cards, 'n1', 'n1'), {});
  cards = apply(cards, connectPatches(cards, 'n1', 'img'));
  cards = apply(cards, connectPatches(cards, 'url', 'n1'));
  cards = apply(cards, connectPatches(cards, 'n1', 'n2'));
  assert.deepEqual(cards.find(c => c.id === 'n1').links, ['img', 'url', 'n2']);
  assert.deepEqual(cards.find(c => c.id === 'img').links, ['n1']);
  assert.deepEqual(cards.find(c => c.id === 'n2').links, ['n1']);
  // Tying again changes nothing.
  assert.deepEqual(connectPatches(cards, 'img', 'n1'), {});
  assert.deepEqual(attachmentsOf(cards, cards[0]).map(c => c.id), ['img', 'url']);
  assert.deepEqual(pagesOf(cards, cards[0]).map(c => c.id), ['n1', 'n2']);
  assert.deepEqual(pagesOf(cards, cards[1]).map(c => c.id), ['n2', 'n1']);
  assert.deepEqual(threads(cards), [['img', 'n1'], ['n1', 'url'], ['n1', 'n2']]);
  // Untying cuts both sides, from either end.
  cards = apply(cards, disconnectPatches(cards, 'img', 'n1'));
  assert.deepEqual(cards.find(c => c.id === 'n1').links, ['url', 'n2']);
  assert.deepEqual(cards.find(c => c.id === 'img').links, []);
  // A card removed for good leaves no thread behind.
  const patches = removalPatches(cards, 'n1');
  assert.deepEqual(Object.keys(patches).sort(), ['n2', 'url']);
  cards = apply(cards, patches).filter(c => c.id !== 'n1');
  assert.deepEqual(threads(cards), []);
  // Without threads a note has one page and nothing attached.
  assert.deepEqual(pagesOf(cards, cards.find(c => c.id === 'n2')).map(c => c.id), ['n2']);
});

test('notes by folder, outside every folder, and by search; the day switch', () => {
  const cards = [card('a', 'note', { folder: 'beds', order: 1, text: 'Tomaten säen' }), card('b', 'note', { folder: 'shop', order: 3 }), card('c', 'note', { order: 2 }),
    card('d', 'note', { folder: 'gone', order: 4 }), card('img', 'image')];
  assert.deepEqual(notesIn(cards, folders, 'all').map(c => c.id), ['d', 'b', 'c', 'a']);
  assert.deepEqual(notesIn(cards, folders, 'none').map(c => c.id), ['d', 'c']);
  assert.deepEqual(notesIn(cards, folders, 'garden').map(c => c.id), ['a']);
  assert.deepEqual(notesIn(cards, folders, 'top').map(c => c.id), ['b', 'a']);
  // Searching looks through every note, title and text.
  assert.deepEqual(notesIn(cards, folders, 'shop', 'tomaten').map(c => c.id), ['a']);
  // Made in the notebook it is on no day; switched on it lies on the day it was made, off on none.
  const made = card('n', 'note', { created: '2026-11-04', notebook: true });
  assert.deepEqual(onDayPatch(made, true, '2026-11-09'), { onDay: true, created: '2026-11-04', dates: ['2026-11-04'] });
  assert.deepEqual(onDayPatch({ ...made, dates: ['2026-11-04'] }, false, '2026-11-09'), { onDay: false, created: '2026-11-04', dates: [] });
  // A note from a day's board keeps its days and knows the first as the day it was made.
  assert.deepEqual(onDayPatch(card('old', 'note', { dates: ['2026-10-01', '2026-10-02'] }), true, '2026-11-09').dates, ['2026-10-01', '2026-10-02']);
});
