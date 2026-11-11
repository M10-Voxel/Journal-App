import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultLayout, dockPanel, dockWindow, dropIndex, floatPanel, movePanel, normalizeLayout, setHeight, setSpan, spanOf, toggleHalf, toggleMinimized, undockWindow, visiblePanels } from '../src/nebulaLayout.ts';

const open = { calendar: true, notebook: false };
/** The layout most tests were written against: no stacks, only entries, rating and board in the day (the rating and the
 *  board share their row), no heights set. */
const halves = () => ({ ...defaultLayout(), order: { day: ['entries', 'rating', 'board'], period: ['notes', 'activities', 'board'] }, spans: { rating: 6, board: 6 }, heights: {}, stacked: { day: [], period: [] } });

test('by default the entries stand left of a stack of rating, day values and activities; the board lies below, taller', async () => {
  const { rowsOf, cellsOf } = await import('../src/nebulaLayout.ts');
  const layout = defaultLayout();
  const day = ['entries', 'rating', 'scales', 'activities', 'board'];
  assert.deepEqual(cellsOf(layout, day, 'day'), [['entries'], ['rating', 'scales', 'activities'], ['board']]);
  assert.deepEqual(rowsOf(layout, day, 'day'), [['entries', 'rating'], ['board']]);
  assert.deepEqual([spanOf(layout, 'entries'), spanOf(layout, 'rating'), spanOf(layout, 'board')], [7, 5, 12]);
  assert.equal(layout.heights.entries, undefined, 'The entries stretch to the stack beside them.');
  assert(layout.heights.board > 400);
  const period = ['notes', 'ratings', 'activities', 'board'];
  assert.deepEqual(cellsOf(layout, period, 'period'), [['notes', 'ratings'], ['activities'], ['board']], 'In an overview the ratings stand below the note, the activities right.');
  assert.deepEqual(rowsOf(layout, period, 'period'), [['notes', 'activities'], ['board']]);
});

test('a stored layout is made whole: own windows always there, unknown ids and stray windows gone', () => {
  assert.deepEqual(normalizeLayout(null), defaultLayout());
  const layout = normalizeLayout({ order: { day: ['board', 'calendar', 'nonsense', 'board', 'entries', 'rating', 'scales', 'activities'], period: [] }, docked: ['notebook'], minimized: ['rating', 'x'], heights: { board: 300, rating: 20, nonsense: 400 }, stacked: { day: ['scales'], period: [] } });
  assert.deepEqual(layout.order.day, ['board', 'entries', 'rating', 'scales', 'activities', 'notebook'], 'The calendar is not docked, so it leaves; the docked notebook joins.');
  assert.deepEqual(layout.order.period, ['notes', 'ratings', 'activities', 'board', 'notebook']);
  assert.deepEqual(layout.minimized, ['rating']);
  assert.deepEqual(layout.heights, { board: 300 }, 'Heights below the minimum are dropped.');
  assert.deepEqual(layout.stacked, { day: ['scales'], period: [] }, 'Stored stacks are kept.');
});

test("an older layout's data window becomes the rating, day values and activities in its place", () => {
  const layout = normalizeLayout({ order: { day: ['board', 'entries', 'data'], period: ['activities', 'notes', 'board'] }, minimized: ['data'], spans: { entries: 8, data: 4 }, floating: [], docked: [], heights: { data: 520, entries: 520 } });
  assert.deepEqual(layout.order.day, ['board', 'entries', 'rating', 'scales', 'activities']);
  assert.deepEqual(layout.order.period, ['activities', 'notes', 'ratings', 'board'], 'The ratings join after the note.');
  assert.deepEqual(layout.minimized, ['rating', 'scales', 'activities']);
  assert.equal(spanOf(layout, 'rating'), 4, 'The rating heads the stack with the old width.');
  assert.deepEqual(layout.stacked, defaultLayout().stacked);
  const floating = normalizeLayout({ order: { day: ['entries', 'data', 'board'] }, floating: ['data'] });
  assert.deepEqual(floating.floating, ['rating', 'scales', 'activities']);
  assert.deepEqual(normalizeLayout({ order: { day: ['board', 'entries'] } }).order.day, ['board', 'entries', 'rating', 'scales', 'activities'], 'Without the data window: after the entries.');
});

test('docking puts the calendar into both grids, at the chosen place in this one', () => {
  const layout = dockWindow(halves(), 'day', 'calendar', 1, open);
  assert.deepEqual(layout.order.day, ['entries', 'calendar', 'rating', 'board']);
  assert.deepEqual(layout.order.period, ['notes', 'activities', 'board', 'calendar']);
  assert.deepEqual(visiblePanels(layout, 'day', { calendar: false, notebook: false }), ['entries', 'rating', 'board'], 'Closed, it is not shown but keeps its place.');
  const back = undockWindow(toggleMinimized(layout, 'calendar'), 'calendar');
  assert.deepEqual(back.order.day, ['entries', 'rating', 'board']);
  assert.deepEqual(back.minimized, [], 'Floating again, it is not minimized.');
});

test('old period layouts gain a board panel while weeks and quarters can hide it without losing its place', () => {
  const layout=normalizeLayout({order:{period:['activities','notes']},heights:{board:480}});
  assert.deepEqual(layout.order.period,['activities','notes','ratings','board']);
  assert.deepEqual(visiblePanels(layout,'period',{...open,board:true}),['activities','notes','ratings','board']);
  assert.deepEqual(visiblePanels(layout,'period',{...open,board:false}),['activities','notes','ratings']);
  assert.equal(layout.heights.board,480);
  const front=movePanel(layout,'period','board',0,{...open,board:true});
  assert.deepEqual(visiblePanels(front,'period',{...open,board:true}),['board','activities','notes','ratings']);
  assert.deepEqual(visiblePanels(front,'period',{...open,board:false}),['activities','notes','ratings']);
});

test('moving counts the shown windows; hidden ones keep their place', () => {
  const docked = dockWindow(halves(), 'day', 'notebook', 3, { calendar: false, notebook: true });
  // The notebook is closed now: moving the board to the front leaves it after the rating.
  const moved = movePanel(docked, 'day', 'board', 0, { calendar: false, notebook: false });
  assert.deepEqual(moved.order.day, ['board', 'entries', 'rating', 'notebook']);
  assert.deepEqual(movePanel(halves(), 'day', 'entries', 9, open).order.day, ['rating', 'board', 'entries'], 'Past the end: last.');
});

test('half rows, minimizing and heights toggle per window', () => {
  const layout = toggleHalf(toggleMinimized(halves(), 'entries'), 'rating');
  assert.deepEqual(layout.minimized, ['entries']);
  assert.equal(spanOf(layout, 'rating'), 12, 'The rating takes the whole row again.');
  assert.equal(spanOf(toggleHalf(setSpan(layout, 'entries', 8), 'entries'), 'entries'), 6, 'From any other width: half.');
  assert.equal(spanOf(setSpan(layout, 'board', 1), 'board'), 3, 'Never narrower than three columns.');
  assert.deepEqual(normalizeLayout({ half: ['entries'] }).spans, { entries: 6 }, 'An older layout keeps its half windows.');
  assert.equal(setHeight(layout, 'calendar', 90).heights.calendar, 120, 'Never lower than the minimum.');
  for (const id of ['rating', 'scales', 'activities']) {
    const resized = setHeight(layout, id, 64);
    assert.equal(normalizeLayout(resized).heights[id], 64, 'Compact window heights survive reload.');
    assert.deepEqual(resized.spans, layout.spans, 'Resizing height never changes column widths.');
  }
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
  const floated = floatPanel(toggleMinimized(halves(), 'board'), 'board');
  assert.deepEqual(visiblePanels(floated, 'day', open), ['entries', 'rating'], 'Floating, it leaves the grid ...');
  assert.deepEqual(floated.minimized, [], '... and is not minimized.');
  assert.deepEqual(visiblePanels(dockPanel(floated, 'day', 'board', 0, open), 'day', open), ['board', 'entries', 'rating']);
  assert.deepEqual(normalizeLayout({ floating: ['board', 'calendar', 'x'] }).floating, ['board'], 'Only own windows float this way.');
  assert.deepEqual(floatPanel(dockWindow(halves(), 'day', 'calendar', 0, open), 'calendar').docked, [], 'The calendar floats by leaving the grid.');
});

test('rows: resizing gives the difference to the neighbour, leaving a row closes the gap', async () => {
  const { rowsOf, resizeInRow, leaveRow } = await import('../src/nebulaLayout.ts');
  const layout = halves();
  const ids = ['entries', 'rating', 'board'];
  assert.deepEqual(rowsOf(layout, ids), [['entries'], ['rating', 'board']]);
  const wider = resizeInRow(layout, ids, 'rating', 8);
  assert.deepEqual([spanOf(wider, 'rating'), spanOf(wider, 'board')], [8, 4], 'The board gives what the rating takes.');
  const limit = resizeInRow(layout, ids, 'board', 11);
  assert.deepEqual([spanOf(limit, 'rating'), spanOf(limit, 'board')], [3, 9], 'The neighbour keeps its minimum.');
  assert.equal(spanOf(resizeInRow(layout, ids, 'entries', 7), 'entries'), 7, 'Alone in its row: only the window changes.');
  assert.equal(spanOf(leaveRow(wider, ids, 'board'), 'rating'), 12, 'The rating takes the whole row when the board leaves.');
});

test('a drop beside a window shares its width; between rows a window gets a row of its own', async () => {
  const { dropTarget, placePanel } = await import('../src/nebulaLayout.ts');
  const boxes = [{ id: 'entries', left: 0, top: 0, width: 800, height: 200, wide: true }, { id: 'rating', left: 0, top: 220, width: 390, height: 300 }, { id: 'board', left: 410, top: 220, width: 390, height: 300 }];
  assert.deepEqual(dropTarget(boxes, { x: 760, y: 100 }), { index: 1, beside: { id: 'entries', side: 'right' } });
  assert.deepEqual(dropTarget(boxes, { x: 20, y: 300 }), { index: 1, beside: { id: 'rating', side: 'left' } });
  assert.deepEqual(dropTarget(boxes, { x: 400, y: 40 }), { index: 0 }, 'In the middle: between rows.');
  const ids = ['entries', 'rating', 'board'];
  // The board dragged beside the entries: the two share the row, the data window gets the board's half back.
  const shared = placePanel(halves(), 'day', ids, 'board', { index: 1, beside: { id: 'entries', side: 'right' } }, open, true);
  assert.deepEqual(shared.order.day, ['entries', 'board', 'rating']);
  assert.deepEqual([spanOf(shared, 'entries'), spanOf(shared, 'board'), spanOf(shared, 'rating')], [6, 6, 12]);
  // The data window dropped between rows (on top): a row of its own; the board fills the row it left.
  const alone = placePanel(halves(), 'day', ids, 'rating', { index: 0 }, open, true);
  assert.deepEqual([spanOf(alone, 'rating'), spanOf(alone, 'board')], [12, 12]);
  // The calendar, floating, docked beside the data window.
  const docked = placePanel(halves(), 'day', ids, 'calendar', { index: 1, beside: { id: 'rating', side: 'left' } }, open, false);
  assert.deepEqual(visiblePanels(docked, 'day', open), ['entries', 'calendar', 'rating', 'board']);
  assert.deepEqual([spanOf(docked, 'calendar'), spanOf(docked, 'rating')], [3, 3]);
});

test('a minimized window beside an open one stands upright and gives its width away while minimized', async () => {
  const { displaySpans } = await import('../src/nebulaLayout.ts');
  const ids = ['entries', 'rating', 'board'];
  const minimized = toggleMinimized(halves(), 'rating');
  assert.deepEqual(displaySpans(minimized, ids), { spans: { entries: 12, rating: 1, board: 11 }, upright: ['rating'], pull: { board: [1, 0], rating: [0, -1] } });
  assert.equal(spanOf(minimized, 'board'), 6, 'The stored width stays.');
  const last = toggleMinimized(halves(), 'board');
  assert.deepEqual(displaySpans(last, ids).spans, { entries: 12, rating: 11, board: 1 }, 'The last in a row gives to the one before it.');
  assert.deepEqual(displaySpans(last, ids).pull, { rating: [0, 1], board: [-1, 0] });
  assert.deepEqual(displaySpans(toggleMinimized(last, 'rating'), ids).upright, [], 'Only minimized windows in a row: they lie flat.');
  assert.deepEqual(displaySpans(toggleMinimized(halves(), 'entries'), ids).upright, [], 'Alone in its row: flat.');
});

test("stacks: a cell takes its head's width, resizing and leaving work on the cell", async () => {
  const { cellsOf, rowsOf, resizeInRow, leaveRow, displaySpans } = await import('../src/nebulaLayout.ts');
  const layout = defaultLayout();
  const ids = ['entries', 'rating', 'scales', 'activities', 'board'];
  const wider = resizeInRow(layout, ids, 'scales', 6);
  assert.deepEqual([spanOf(wider, 'entries'), spanOf(wider, 'rating')], [6, 6], 'Resizing a stacked window resizes its cell (by its head).');
  assert.deepEqual(displaySpans(layout, ids).spans, { entries: 7, rating: 5, scales: 5, activities: 5, board: 12 }, "Stacked windows show the cell's width.");
  // The head leaves: the next window heads the stack with its width; the cell stays beside the entries.
  const left = leaveRow(layout, ids, 'rating');
  const rest = ['entries', 'scales', 'activities', 'board'];
  assert.deepEqual(cellsOf(left, rest, 'day'), [['entries'], ['scales', 'activities'], ['board']]);
  assert.equal(spanOf(left, 'scales'), 5);
  assert.deepEqual(rowsOf(left, rest, 'day'), [['entries', 'scales'], ['board']]);
  // A stacked window leaves: the stack closes up, no width changes.
  const member = leaveRow(layout, ids, 'scales');
  assert.deepEqual(member.spans, layout.spans);
  assert.equal(member.stacked.day.includes('scales'), false);
  const minimized = toggleMinimized(toggleMinimized(toggleMinimized(layout, 'rating'), 'scales'), 'activities');
  assert.deepEqual(displaySpans(minimized, ids).upright, [], 'A minimized stack never stands upright.');
});

test("a drop on a window's upper or lower rim puts it into that window's stack", async () => {
  const { dropTarget, placePanel, cellsOf } = await import('../src/nebulaLayout.ts');
  const boxes = [{ id: 'entries', left: 0, top: 0, width: 460, height: 600 }, { id: 'rating', cell: 'rating', left: 480, top: 0, width: 320, height: 200 }, { id: 'scales', cell: 'rating', left: 480, top: 218, width: 320, height: 180 }, { id: 'activities', cell: 'rating', left: 480, top: 416, width: 320, height: 184 }, { id: 'board', left: 0, top: 620, width: 800, height: 300, wide: true }];
  assert.deepEqual(dropTarget(boxes, { x: 640, y: 225 }), { index: 2, stack: { id: 'scales', side: 'above' } });
  assert.deepEqual(dropTarget(boxes, { x: 640, y: 590 }), { index: 4, stack: { id: 'activities', side: 'below' } });
  assert.deepEqual(dropTarget(boxes, { x: 790, y: 300 }), { index: 4, beside: { id: 'rating', side: 'right' } }, 'Beside a stacked window: beside its whole cell.');
  assert.deepEqual(dropTarget(boxes, { x: 640, y: 300 }), { index: 4 }, 'In the middle of a stacked window: after the whole cell, never inside it.');
  const ids = ['entries', 'rating', 'scales', 'activities', 'board'];
  // The board stacked below the activities.
  const below = placePanel(defaultLayout(), 'day', ids, 'board', { index: 4, stack: { id: 'activities', side: 'below' } }, open, true);
  assert.deepEqual(cellsOf(below, visiblePanels(below, 'day', open), 'day'), [['entries'], ['rating', 'scales', 'activities', 'board']]);
  // The board above the stack's head: it heads the stack now, with its width.
  const above = placePanel(defaultLayout(), 'day', ids, 'board', { index: 1, stack: { id: 'rating', side: 'above' } }, open, true);
  assert.deepEqual(cellsOf(above, visiblePanels(above, 'day', open), 'day'), [['entries'], ['board', 'rating', 'scales', 'activities']]);
  assert.equal(spanOf(above, 'board'), 5);
  // Pulled out of the stack into a row of its own: no longer stacked.
  const out = placePanel(defaultLayout(), 'day', ids, 'scales', { index: 4 }, open, true);
  assert.deepEqual(cellsOf(out, visiblePanels(out, 'day', open), 'day'), [['entries'], ['rating', 'activities'], ['board'], ['scales']]);
  assert.equal(spanOf(out, 'scales'), 12);
});
