import test from 'node:test';
import assert from 'node:assert/strict';
import { nextPage, previousPage, spreadOf, shownDate, startFor, showsDate, shiftPeriod, normalizePage, pageNumber, pageKey } from '../src/book.ts';

const page = (date, kind) => ({ date, page: kind });

test('day pages run on across days, months and years', () => {
  assert.deepEqual(nextPage(page('2026-03-04', 'entries'), 'day'), page('2026-03-04', 'data'));
  assert.deepEqual(nextPage(page('2026-03-04', 'data'), 'day'), page('2026-03-04', 'board'));
  assert.deepEqual(nextPage(page('2026-03-04', 'board'), 'day'), page('2026-03-05', 'entries'));
  assert.deepEqual(nextPage(page('2026-12-31', 'board'), 'day'), page('2027-01-01', 'entries'));
  assert.deepEqual(previousPage(page('2026-03-01', 'entries'), 'day'), page('2026-02-28', 'board'));
  assert.deepEqual(previousPage(page('2026-03-04', 'board'), 'day'), page('2026-03-04', 'data'));
  // Back and forth returns to the same page, across a daylight saving change too.
  let at = page('2026-03-28', 'entries');
  for (let index = 0; index < 9; index++) at = nextPage(at, 'day');
  assert.deepEqual(at, page('2026-03-31', 'entries'));
  for (let index = 0; index < 9; index++) at = previousPage(at, 'day');
  assert.deepEqual(at, page('2026-03-28', 'entries'));
});

test('a spread never shows two entries pages; its day is the visible entries page', () => {
  for (const kind of ['entries', 'data', 'board']) {
    const spread = spreadOf(page('2026-05-10', kind), 'day', true);
    assert.equal(spread.length, 2);
    assert(spread.filter(item => item.page === 'entries').length <= 1);
  }
  assert.deepEqual(spreadOf(page('2026-05-10', 'entries'), 'day', true).map(pageKey), ['entries:2026-05-10', 'data:2026-05-10']);
  assert.deepEqual(spreadOf(page('2026-05-10', 'data'), 'day', true).map(pageKey), ['data:2026-05-10', 'board:2026-05-10']);
  const across = spreadOf(page('2026-05-10', 'board'), 'day', true);
  assert.deepEqual(across.map(pageKey), ['board:2026-05-10', 'entries:2026-05-11']);
  assert.equal(shownDate(across), '2026-05-11');
  assert.equal(shownDate(spreadOf(page('2026-05-10', 'data'), 'day', true)), '2026-05-10');
  assert.deepEqual(spreadOf(page('2026-05-10', 'board'), 'day', false), [page('2026-05-10', 'board')]);
  // Turning by one page: the right page moves to the left.
  const start = page('2026-05-10', 'entries');
  assert.deepEqual(spreadOf(nextPage(start, 'day'), 'day', true)[0], spreadOf(start, 'day', true)[1]);
});

test('bookmarks open a spread that stays on their day', () => {
  assert.deepEqual(startFor(page('2026-05-10', 'board'), 'day', true), page('2026-05-10', 'data'));
  assert.deepEqual(startFor(page('2026-05-10', 'board'), 'day', false), page('2026-05-10', 'board'));
  assert.deepEqual(startFor(page('2026-05-10', 'entries'), 'day', true), page('2026-05-10', 'entries'));
  assert.deepEqual(startFor(page('2026-05-10', 'activities'), 'month', true), page('2026-05-10', 'activities'));
  assert.deepEqual(startFor(page('2026-05-10', 'board'), 'month', true), page('2026-05-10', 'activities'));
});

test('overview pages turn by week, month, quarter and year', () => {
  assert.deepEqual(nextPage(page('2026-05-10', 'notes'), 'week'), page('2026-05-10', 'activities'));
  assert.deepEqual(nextPage(page('2026-05-10', 'activities'), 'week'), page('2026-05-17', 'notes'));
  assert.deepEqual(nextPage(page('2026-01-31', 'activities'), 'month'), page('2026-01-31', 'board'));
  assert.deepEqual(nextPage(page('2026-01-31', 'board'), 'month'), page('2026-02-28', 'notes'));
  assert.deepEqual(previousPage(page('2026-03-31', 'notes'), 'month'), page('2026-02-28', 'board'));
  assert.deepEqual(nextPage(page('2026-11-15', 'activities'), 'quarter'), page('2027-02-15', 'notes'));
  assert.deepEqual(previousPage(page('2026-11-15', 'notes'), 'year'), page('2025-11-15', 'board'));
  assert.equal(shiftPeriod('2024-02-29', 'year', 1), '2025-02-28');
  const spread = spreadOf(page('2026-05-10', 'activities'), 'month', true);
  assert.deepEqual(spread.map(pageKey), ['activities:2026-05-10', 'board:2026-05-10']);
  assert(showsDate(spread, 'month', '2026-05-01'));
  assert(!showsDate(spread, 'month', '2026-06-01'));
  assert.deepEqual(normalizePage(page('2026-05-10', 'board'), 'week'), page('2026-05-10', 'notes'));
  assert.deepEqual(normalizePage(page('2026-05-10', 'activities'), 'day'), page('2026-05-10', 'entries'));
});

test('page numbers count from the start of the year', () => {
  assert.equal(pageNumber(page('2026-01-01', 'entries'), 'day'), 1);
  assert.equal(pageNumber(page('2026-01-02', 'board'), 'day'), 6);
  assert.equal(pageNumber(page('2026-03-15', 'activities'), 'month'), 8);
  assert.equal(pageNumber(page('2026-03-15', 'notes'), 'year'), 1);
});

test('turning both pages at once: entries | data, then the board over two pages', async () => {
  const { spreadStart, spreadPagesOf, turnSpread } = await import('../src/book.ts');
  assert.deepEqual(spreadPagesOf(page('2026-05-10', 'data'), 'day').map(pageKey), ['entries:2026-05-10', 'data:2026-05-10']);
  assert.deepEqual(spreadPagesOf(page('2026-05-10', 'board'), 'day').map(pageKey), ['board:2026-05-10']);
  assert.deepEqual(turnSpread(page('2026-05-10', 'entries'), 'day', 1), page('2026-05-10', 'board'));
  assert.deepEqual(turnSpread(page('2026-05-10', 'data'), 'day', 1), page('2026-05-10', 'board'));
  assert.deepEqual(turnSpread(page('2026-05-31', 'board'), 'day', 1), page('2026-06-01', 'entries'));
  assert.deepEqual(turnSpread(page('2026-06-01', 'entries'), 'day', -1), page('2026-05-31', 'board'));
  assert.deepEqual(turnSpread(page('2026-06-01', 'board'), 'day', -1), page('2026-06-01', 'entries'));
  assert.deepEqual(spreadStart(page('2026-06-01', 'activities'), 'month'), page('2026-06-01', 'notes'));
  assert.deepEqual(turnSpread(page('2026-06-01', 'activities'), 'month', 1), page('2026-06-01', 'board'));
  assert.deepEqual(turnSpread(page('2026-06-01', 'board'), 'month', 1), page('2026-07-01', 'notes'));
  assert.deepEqual(spreadPagesOf(page('2026-06-01', 'notes'), 'week').map(item => item.page), ['notes', 'activities']);
  // There and back again over a week of days.
  let at = page('2026-03-26', 'entries');
  for (let index = 0; index < 14; index++) at = turnSpread(at, 'day', 1);
  assert.deepEqual(at, page('2026-04-02', 'entries'));
  for (let index = 0; index < 14; index++) at = turnSpread(at, 'day', -1);
  assert.deepEqual(at, page('2026-03-26', 'entries'));
});

test('monthly and yearly boards have their own spread, register page and reversible period boundaries', async () => {
  const { pagesOf, spreadStart, spreadPagesOf, turnSpread } = await import('../src/book.ts');
  for (const mode of ['month', 'year']) {
    const start=page('2026-06-01','notes'), board=page(start.date,'board');
    assert.deepEqual(pagesOf(mode),['notes','activities','board']);
    assert.deepEqual(spreadStart(board,mode),board);
    assert.deepEqual(spreadPagesOf(board,mode),[board]);
    assert.deepEqual(turnSpread(start,mode,1),board);
    assert.deepEqual(turnSpread(board,mode,-1),start);
    const next=turnSpread(board,mode,1);
    assert.equal(next.date,mode==='month'?'2026-07-01':'2027-06-01');
    assert.deepEqual(turnSpread(next,mode,-1),board);
    assert.deepEqual(previousPage(nextPage(board,mode),mode),board);
    assert.equal(pageNumber(board,mode),mode==='month'?18:3);
  }
  for (const mode of ['week','quarter']) assert.deepEqual(pagesOf(mode),['notes','activities']);
});
