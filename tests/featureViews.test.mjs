import test from 'node:test';
import assert from 'node:assert/strict';
import { bookPages, nextPage, pagesOf, previousPage, spreadGroups, spreadPagesOf, spreadStart, turnSpread, startFor } from '../src/book.ts';
import { boardKey, boardOfKey, isOnBoard, isPeriodBoard, pinToBoard, scopedBoardPatch } from '../src/boardPlacement.ts';
import { movePeriodEntry, normalizePeriodData, periodEntries, periodKey, withPeriodEntries, withPeriodValues } from '../src/periodData.ts';
import { cardBoard, cardItem } from '../src/search.ts';
import { mergeThreeWay } from '../src/sync/merge.ts';

const page = (date, kind) => ({ date, page: kind });

test('the book\'s pages follow the view\'s modules', () => {
  assert.deepEqual(bookPages(new Set(['entries', 'rating', 'scales', 'activities', 'board']), 'day'), ['entries', 'data', 'board'], 'The default day.');
  assert.deepEqual(bookPages(new Set(['note', 'evaluation']), 'week'), ['notes', 'activities'], 'The default week.');
  assert.deepEqual(bookPages(new Set(['entries', 'scales', 'note', 'evaluation', 'board']), 'week'), ['entries', 'data', 'notes', 'activities', 'board']);
  assert.deepEqual(bookPages(new Set(['evaluation']), 'month'), ['notes', 'activities'], 'The chart alone still has its page.');
  assert.deepEqual(bookPages(new Set(['note', 'board']), 'day'), ['notes', 'board'], 'A day\'s note.');
  assert.deepEqual(bookPages(new Set(['evaluation']), 'day'), ['entries'], 'Never no page.');
  assert.deepEqual(pagesOf('week', []), ['notes', 'activities'], 'Without pages: the defaults.');
});

test('a week with entries, data, note, evaluation and board turns page by page and spread by spread', () => {
  const kinds = bookPages(new Set(['entries', 'activities', 'note', 'evaluation', 'board']), 'week');
  assert.deepEqual(spreadGroups('week', kinds), [['entries', 'data'], ['notes', 'activities'], ['board']]);
  assert.deepEqual(nextPage(page('2026-11-16', 'board'), 'week', kinds), page('2026-11-23', 'entries'));
  assert.deepEqual(previousPage(page('2026-11-16', 'entries'), 'week', kinds), page('2026-11-09', 'board'));
  assert.deepEqual(turnSpread(page('2026-11-16', 'data'), 'week', 1, kinds), page('2026-11-16', 'notes'));
  assert.deepEqual(turnSpread(page('2026-11-16', 'activities'), 'week', 1, kinds), page('2026-11-16', 'board'));
  assert.deepEqual(turnSpread(page('2026-11-16', 'board'), 'week', 1, kinds), page('2026-11-23', 'entries'));
  assert.deepEqual(turnSpread(page('2026-11-23', 'entries'), 'week', -1, kinds), page('2026-11-16', 'board'));
  assert.deepEqual(spreadStart(page('2026-11-16', 'activities'), 'week', kinds), page('2026-11-16', 'notes'));
  assert.deepEqual(startFor(page('2026-11-16', 'board'), 'week', true, kinds), page('2026-11-16', 'activities'));
  // A page left over lies alone; a page switched off becomes the view's first page.
  const odd = bookPages(new Set(['entries', 'note', 'board']), 'month');
  assert.deepEqual(spreadGroups('month', odd), [['entries', 'notes'], ['board']]);
  assert.deepEqual(spreadPagesOf(page('2026-11-16', 'data'), 'month', odd), [page('2026-11-16', 'entries'), page('2026-11-16', 'notes')]);
  const three = bookPages(new Set(['entries', 'rating', 'note']), 'day');
  assert.deepEqual(spreadGroups('day', three), [['entries', 'data'], ['notes']]);
  // There and back over several weeks.
  let at = page('2026-11-16', 'entries');
  for (let index = 0; index < 9; index++) at = turnSpread(at, 'week', 1, kinds);
  assert.deepEqual(at, page('2026-12-07', 'entries'));
  for (let index = 0; index < 9; index++) at = turnSpread(at, 'week', -1, kinds);
  assert.deepEqual(at, page('2026-11-16', 'entries'));
});

test('weeks and quarters have boards of their own, keyed like months and years', () => {
  assert.equal(boardKey('2026-11-19', 'week'), 'week:2026-11-16', 'A week\'s board is keyed by its Monday.');
  assert.equal(boardKey('2027-01-01', 'week'), 'week:2026-12-28');
  assert.equal(boardKey('2026-11-19', 'quarter'), 'quarter:2026-Q4');
  assert.equal(boardKey('2026-02-28', 'quarter'), 'quarter:2026-Q1');
  assert.equal(boardKey('2026-11-19', 'month'), 'month:2026-11');
  assert.equal(boardKey('2026-11-19'), '2026-11-19');
  for (const key of ['week:2026-11-16', 'month:2026-11', 'quarter:2026-Q4', 'year:2026']) assert(isPeriodBoard(key), key);
  assert(!isPeriodBoard('2026-11-16'));
  assert.deepEqual(boardOfKey('week:2026-11-16'), { period: 'week', date: '2026-11-16' });
  assert.deepEqual(boardOfKey('quarter:2026-Q4'), { period: 'quarter', date: '2026-10-01' });
  assert.equal(boardOfKey('2026-11-16'), null);
  // Pinned to a week's board: its own place there, the card's day stays.
  const card = { id: 'a', kind: 'note', title: 'Zettel', text: '', dates: ['2026-11-18'], order: 1, boardX: 10, y: 20 };
  const patch = pinToBoard([card], ['a'], 'week:2026-11-16', true, { a: { boardX: 40, y: 50 } });
  const pinned = { ...card, ...patch.a };
  assert(isOnBoard(pinned, 'week:2026-11-16'));
  assert.deepEqual(pinned.dates, ['2026-11-18']);
  assert.deepEqual(scopedBoardPatch(pinned, 'quarter:2026-Q4', { y: 90 }), { boards: { ...pinned.boards, 'quarter:2026-Q4': { y: 90 } } }, 'Moving it on a quarter\'s board changes only that place.');
});

test('search opens a card on the smallest board that is on', () => {
  const card = { id: 'a', kind: 'note', title: 'Plan', text: '', dates: [], order: 1, boards: { 'year:2026': { y: 1 }, 'week:2026-11-16': { y: 2 }, 'quarter:2026-Q4': { y: 3 }, 'week:2026-11-09': null } };
  assert.deepEqual(cardBoard(card), { period: 'week', date: '2026-11-16' });
  assert.deepEqual(cardBoard(card, ['month', 'quarter', 'year']), { period: 'quarter', date: '2026-10-01' }, 'A week\'s board switched off is skipped.');
  assert.equal(cardBoard({ ...card, boards: {} , dates: ['2026-11-18'] }, ['month']), null, 'A day\'s board switched off.');
  assert.equal(cardItem({ ...card, boards: {}, notebook: true }, [], 'Ohne Titel', { periods: ['day'], notebook: false }), null, 'Only in the notebook, with the notebook off: not offered.');
  assert.equal(cardItem(card, [card], 'Ohne Titel', { periods: ['year'], notebook: false }).target.period, 'year');
});

test('a period\'s own values and entries are kept by period, merge one by one and leave no empty objects', () => {
  assert.equal(periodKey('week', '2026-11-16'), 'week:2026-11-16');
  let data = normalizePeriodData({});
  assert.equal(data.periods, undefined);
  data = withPeriodValues(data, 'week:2026-11-16', values => ({ ...values, rating: 7, scales: { sleep: 6 } }));
  assert.deepEqual(data.periods, { 'week:2026-11-16': { rating: 7, scales: { sleep: 6 } } });
  assert.equal(data.days['2026-11-16'], undefined, 'Unrelated to the days.');
  data = withPeriodValues(data, 'week:2026-11-16', () => ({}));
  assert.equal('periods' in data, false);
  data = withPeriodEntries(data, 'month:2026-11-01', () => ({ b: { kind: 'note', text: 'Idee', order: 0 }, a: { kind: 'task', text: 'Zweite', order: 1 }, c: { kind: 'task', text: 'Erste', order: 0 } }));
  assert.deepEqual(periodEntries(data, 'month:2026-11-01').map(item => item.id), ['c', 'a', 'b'], 'Tasks before notes, then by order.');
  data = movePeriodEntry(data, 'month:2026-11-01', 'a', -1);
  assert.deepEqual(periodEntries(data, 'month:2026-11-01').map(item => item.text), ['Zweite', 'Erste', 'Idee']);
  assert.equal(movePeriodEntry(data, 'month:2026-11-01', 'b', 1), data, 'Nothing below the last note.');
  const normalized = normalizePeriodData(JSON.parse(JSON.stringify({ ...data, periods: { x: { rating: 'no' }, y: { scales: { s: 3, t: null } } }, entries: { ...data.entries, empty: {} } })));
  assert.deepEqual(normalized.periods, { y: { scales: { s: 3 } } });
  assert.deepEqual(Object.keys(normalized.entries), ['month:2026-11-01']);
  // Two devices: one ticks off an entry, the other adds one; both survive.
  const base = JSON.parse(JSON.stringify(data));
  const local = withPeriodEntries(base, 'month:2026-11-01', entries => ({ ...entries, a: { ...entries.a, done: true } }));
  const remote = withPeriodEntries(base, 'month:2026-11-01', entries => ({ ...entries, d: { kind: 'task', text: 'Neu', order: 2 } }));
  const merged = mergeThreeWay(base, local, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(merged.value.entries['month:2026-11-01'].a.done, true);
  assert.equal(merged.value.entries['month:2026-11-01'].d.text, 'Neu');
});
