import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, dockPanel, dockWindow, dropIndex, floatPanel, movePanel, normalizeLayout, setHeight, setSpan, spanOf, toggleHalf, toggleMinimized, undockWindow, visiblePanels } from '../src/nebulaLayout.ts';

const open = { calendar: true, notebook: false };

test('a stored layout is made whole: own windows always there, unknown ids and stray windows gone', () => {
  assert.deepEqual(normalizeLayout(null), defaultLayout());
  const layout = normalizeLayout({ order: { day: ['board', 'calendar', 'nonsense', 'board'], period: [] }, docked: ['notebook'], minimized: ['data', 'x'], heights: { board: 300, data: 20, nonsense: 400 } });
  assert.deepEqual(layout.order.day, ['board', 'entries', 'data', 'notebook'], 'The calendar is not docked, so it leaves; the docked notebook joins.');
  assert.deepEqual(layout.order.period, ['notes', 'activities', 'notebook']);
  assert.deepEqual(layout.minimized, ['data']);
  assert.deepEqual(layout.heights, { board: 300 }, 'Heights below the minimum are dropped.');
});

test('docking puts the calendar into both grids, at the chosen place in this one', () => {
  const layout = dockWindow(defaultLayout(), 'day', 'calendar', 1, open);
  assert.deepEqual(layout.order.day, ['entries', 'calendar', 'data', 'board']);
  assert.deepEqual(layout.order.period, ['notes', 'activities', 'calendar']);
  assert.deepEqual(visiblePanels(layout, 'day', { calendar: false, notebook: false }), ['entries', 'data', 'board'], 'Closed, it is not shown but keeps its place.');
  const back = undockWindow(toggleMinimized(layout, 'calendar'), 'calendar');
  assert.deepEqual(back.order.day, ['entries', 'data', 'board']);
  assert.deepEqual(back.minimized, [], 'Floating again, it is not minimized.');
});

test('moving counts the shown windows; hidden ones keep their place', () => {
  const docked = dockWindow(defaultLayout(), 'day', 'notebook', 3, { calendar: false, notebook: true });
  // The notebook is closed now: moving the board to the front leaves it after the data.
  const moved = movePanel(docked, 'day', 'board', 0, { calendar: false, notebook: false });
  assert.deepEqual(moved.order.day, ['board', 'entries', 'data', 'notebook']);
  assert.deepEqual(movePanel(defaultLayout(), 'day', 'entries', 9, open).order.day, ['data', 'board', 'entries'], 'Past the end: last.');
});

test('half rows, minimizing and heights toggle per window', () => {
  const layout = toggleHalf(toggleMinimized(defaultLayout(), 'entries'), 'data');
  assert.deepEqual(layout.minimized, ['entries']);
  assert.equal(spanOf(layout, 'data'), 12, 'The data window takes the whole row again.');
  assert.equal(spanOf(toggleHalf(setSpan(layout, 'entries', 8), 'entries'), 'entries'), 6, 'From any other width: half.');
  assert.equal(spanOf(setSpan(layout, 'board', 1), 'board'), 3, 'Never narrower than three columns.');
  assert.deepEqual(normalizeLayout({ half: ['entries'] }).spans, { entries: 6 }, 'An older layout keeps its half windows.');
  assert.equal(setHeight(layout, 'calendar', 90).heights.calendar, 120, 'Never lower than the minimum.');
  assert.equal(setHeight(setHeight(layout, 'calendar', 500), 'calendar', null).heights.calendar, undefined);
});

test('a drop lands before the window it comes before in reading order', () => {
  // A wide window on top, two half ones below it.
  const boxes = [{ left: 0, top: 0, width: 800, height: 200, wide: true }, { left: 0, top: 220, width: 390, height: 300 }, { left: 410, top: 220, width: 390, height: 300 }];
  assert.equal(dropIndex(boxes, { x: 400, y: 50 }), 0, 'Upper half of the wide window: before it.');
  assert.equal(dropIndex(boxes, { x: 400, y: 150 }), 1, 'Lower half: after it.');
  assert.equal(dropIndex(boxes, { x: 100, y: 300 }), 1, 'Left half of the first half window: before it.');
  assert.equal(dropIndex(boxes, { x: 300, y: 300 }), 2, 'Its right half: before the second.');
  assert.equal(dropIndex(boxes, { x: 400, y: 300 }), 2, 'In the gap between them: before the second.');
  assert.equal(dropIndex(boxes, { x: 700, y: 300 }), 3, 'Right half of the last: at the end.');
  assert.equal(dropIndex(boxes, { x: 100, y: 900 }), 3, 'Below everything: at the end.');
});

test("the day's own windows can float and come back to their place", () => {
  const floated = floatPanel(toggleMinimized(defaultLayout(), 'board'), 'board');
  assert.deepEqual(visiblePanels(floated, 'day', open), ['entries', 'data'], 'Floating, it leaves the grid ...');
  assert.deepEqual(floated.minimized, [], '... and is not minimized.');
  assert.deepEqual(visiblePanels(dockPanel(floated, 'day', 'board', 0, open), 'day', open), ['board', 'entries', 'data']);
  assert.deepEqual(normalizeLayout({ floating: ['board', 'calendar', 'x'] }).floating, ['board'], 'Only own windows float this way.');
  assert.deepEqual(floatPanel(dockWindow(defaultLayout(), 'day', 'calendar', 0, open), 'calendar').docked, [], 'The calendar floats by leaving the grid.');
});

test('rows: resizing gives the difference to the neighbour, leaving a row closes the gap', async () => {
  const { rowsOf, resizeInRow, leaveRow } = await import('../src/nebulaLayout.ts');
  const layout = defaultLayout();
  const ids = ['entries', 'data', 'board'];
  assert.deepEqual(rowsOf(layout, ids), [['entries'], ['data', 'board']]);
  const wider = resizeInRow(layout, ids, 'data', 8);
  assert.deepEqual([spanOf(wider, 'data'), spanOf(wider, 'board')], [8, 4], 'The board gives what the data window takes.');
  const limit = resizeInRow(layout, ids, 'board', 11);
  assert.deepEqual([spanOf(limit, 'data'), spanOf(limit, 'board')], [3, 9], 'The neighbour keeps its minimum.');
  assert.equal(spanOf(resizeInRow(layout, ids, 'entries', 7), 'entries'), 7, 'Alone in its row: only the window changes.');
  assert.equal(spanOf(leaveRow(wider, ids, 'board'), 'data'), 12, 'The data window takes the whole row when the board leaves.');
});

test('a drop beside a window shares its width; between rows a window gets a row of its own', async () => {
  const { dropTarget, placePanel } = await import('../src/nebulaLayout.ts');
  const boxes = [{ id: 'entries', left: 0, top: 0, width: 800, height: 200, wide: true }, { id: 'data', left: 0, top: 220, width: 390, height: 300 }, { id: 'board', left: 410, top: 220, width: 390, height: 300 }];
  assert.deepEqual(dropTarget(boxes, { x: 760, y: 100 }), { index: 1, beside: { id: 'entries', side: 'right' } });
  assert.deepEqual(dropTarget(boxes, { x: 20, y: 300 }), { index: 1, beside: { id: 'data', side: 'left' } });
  assert.deepEqual(dropTarget(boxes, { x: 400, y: 40 }), { index: 0 }, 'In the middle: between rows.');
  const ids = ['entries', 'data', 'board'];
  // The board dragged beside the entries: the two share the row, the data window gets the board's half back.
  const shared = placePanel(defaultLayout(), 'day', ids, 'board', { index: 1, beside: { id: 'entries', side: 'right' } }, open, true);
  assert.deepEqual(shared.order.day, ['entries', 'board', 'data']);
  assert.deepEqual([spanOf(shared, 'entries'), spanOf(shared, 'board'), spanOf(shared, 'data')], [6, 6, 12]);
  // The data window dropped between rows (on top): a row of its own; the board fills the row it left.
  const alone = placePanel(defaultLayout(), 'day', ids, 'data', { index: 0 }, open, true);
  assert.deepEqual([spanOf(alone, 'data'), spanOf(alone, 'board')], [12, 12]);
  // The calendar, floating, docked beside the data window.
  const docked = placePanel(defaultLayout(), 'day', ids, 'calendar', { index: 1, beside: { id: 'data', side: 'left' } }, open, false);
  assert.deepEqual(visiblePanels(docked, 'day', open), ['entries', 'calendar', 'data', 'board']);
  assert.deepEqual([spanOf(docked, 'calendar'), spanOf(docked, 'data')], [3, 3]);
});
