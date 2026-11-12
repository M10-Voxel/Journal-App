import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasPoint, cutByLasso, decodePoints, deleteStrokes, encodePoints, eraseStrokes, inRect, inkBottom, inkOf, inkPaperOf, nextPaperStep, outlinePath, restyleStrokes, selectInRect, selectionBox, strokeBounds, strokeColor, strokeOptions, transformStrokes } from '../src/ink.ts';
import { nextPen, normalizePrefs, withRecent } from '../src/inkPrefs.ts';

const line = (x0, y0, x1, y1, n = 50, pressure = .5) => Array.from({ length: n + 1 }, (_, i) => [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n, pressure]);
const stroke = (points, size = 4) => ({ size, pressure: true, points: encodePoints(points) });

test('points survive the compact encoding at quarter-pixel and per-mille precision', () => {
  const points = [[0, 0, 0], [10.25, 3.5, .5], [10, 3.75, 1], [-20.5, 400.25, .333], [1200.75, 900, .02]];
  const decoded = decodePoints(encodePoints(points));
  assert.equal(decoded.length, points.length);
  points.forEach(([x, y, p], i) => { assert.equal(decoded[i][0], x); assert.equal(decoded[i][1], y); assert(Math.abs(decoded[i][2] - p) <= .0005); });
  // About 6 bytes a point (Base64 adds a third).
  assert(encodePoints(line(0, 0, 100, 100, 999)).length <= 1000 * 6 * 4 / 3 + 4);
});

test('jumps beyond one Int16 step and out-of-range pressure stay correct', () => {
  const decoded = decodePoints(encodePoints([[30000, -25000, 2], [30001, -25000, -1]]));
  const last = decoded.at(-1), before = decoded.at(-2);
  assert.deepEqual([before[0], before[1], before[2]], [30000, -25000, 1]);
  assert.deepEqual([last[0], last[1], last[2]], [30001, -25000, 0]);
  assert.deepEqual(decodePoints('%%%'), []);
});

test('erasing across a stroke removes the touched points and splits it in two', () => {
  const strokes = [stroke(line(0, 0, 200, 0))];
  const { strokes: result, changed } = eraseStrokes(strokes, [{ x: 100, y: -30 }, { x: 100, y: 30 }], 6);
  assert.equal(changed, true);
  assert.equal(result.length, 2);
  const [left, right] = result.map(s => decodePoints(s.points));
  assert(left.every(([x]) => x < 100 - 6) && right.every(([x]) => x > 100 + 6));
  assert.equal(left[0][0], 0); assert.equal(right.at(-1)[0], 200);
  assert.equal(result[0].size, 4); assert.equal(result[0].pressure, true);
});

test('the eraser catches a fast stroke between two far points and keeps the pieces compact', () => {
  const sparse = stroke([[0, 0, .5], [200, 0, .5]]);
  const { strokes: result } = eraseStrokes([sparse], [{ x: 100, y: 0 }], 5);
  assert.equal(result.length, 2);
  for (const piece of result) assert(decodePoints(piece.points).length <= 3);
});

test('untouched strokes stay the same objects; erasing nothing changes nothing', () => {
  const far = stroke(line(0, 300, 200, 300)), near = stroke(line(0, 0, 200, 0));
  const strokes = [far, near];
  const { strokes: result } = eraseStrokes(strokes, [{ x: 50, y: -20 }, { x: 50, y: 20 }], 4);
  assert.equal(result[0], far);
  const none = eraseStrokes(strokes, [{ x: 500, y: 500 }], 4);
  assert.equal(none.changed, false); assert.equal(none.strokes, strokes);
});

test('erasing a whole stroke removes it, a single dot included', () => {
  const dot = stroke([[10, 10, .5]]), short = stroke(line(0, 0, 4, 0, 4));
  const { strokes: result } = eraseStrokes([dot, short], [{ x: 0, y: 0 }, { x: 10, y: 10 }], 8);
  assert.deepEqual(result, []);
});

test('client points map onto the drawing at any board zoom', () => {
  const rect = { left: 100, top: 50, width: 480 };
  assert.deepEqual(canvasPoint({ x: 340, y: 290 }, rect, 240), { x: 120, y: 120 });
  assert.deepEqual(canvasPoint({ x: 112, y: 62 }, { left: 100, top: 50, width: 120 }, 240), { x: 24, y: 24 });
  assert.deepEqual(canvasPoint({ x: 110, y: 60 }, rect, 0), { x: 10, y: 10 });
});

test('pressure off draws with a constant width; a mouse simulates pressure', () => {
  assert.equal(strokeOptions({ size: 3, pressure: false }).thinning, 0);
  assert(strokeOptions({ size: 3, pressure: true }).thinning > 0);
  assert.equal(strokeOptions({ size: 3, pressure: true, mouse: true }).simulatePressure, true);
  assert.equal(strokeOptions({ size: 3, pressure: false, mouse: true }).simulatePressure, false);
  assert.ok(strokeOptions({ size: 3, pressure: true }).streamline < .3);
});

test('drawings load safely and know their lowest point', () => {
  assert.deepEqual(inkOf(undefined), { v: 1, strokes: [] });
  assert.deepEqual(inkOf({ v: 2, strokes: [] }), { v: 1, strokes: [] });
  const ink = inkOf({ v: 1, strokes: [stroke(line(0, 10, 0, 90), 6), { size: 0, points: '' }] });
  assert.equal(ink.strokes.length, 1);
  assert.equal(inkBottom(ink), 93);
  assert.match(outlinePath([[0, 0], [10, 0], [10, 10]]), /^M0 0Q.*Z$/);
});

test('each pen has its own feel: the highlighter is even with flat ends, the pencil thinner in its swell', () => {
  const marker = strokeOptions({ size: 14, pressure: true, mouse: true, tool: 'marker' });
  assert.equal(marker.thinning, 0); assert.equal(marker.simulatePressure, false);
  assert.equal(marker.start.cap, false); assert.equal(marker.end.cap, false);
  const pencil = strokeOptions({ size: 2, pressure: true, tool: 'pencil' }), pen = strokeOptions({ size: 2, pressure: true });
  assert(pencil.thinning > 0 && pencil.thinning < pen.thinning);
  assert(pencil.smoothing > pen.smoothing && pencil.streamline < .3);
  assert.equal(strokeColor({ color: '#2457c5' }), '#2457c5');
  assert.equal(strokeColor({}), 'currentColor'); assert.equal(strokeColor({ color: 'red;x' }), 'currentColor');
});

test('a rectangle catches a stroke when at least 60 % of its points lie inside', () => {
  const s = stroke(line(0, 0, 100, 0, 10)); // 11 points at x = 0, 10, …, 100
  assert.equal(inRect(s, { left: -5, top: -5, right: 55, bottom: 5 }), false); // 6 of 11
  assert.equal(inRect(s, { left: -5, top: -5, right: 65, bottom: 5 }), true); // 7 of 11
  const far = stroke(line(0, 200, 100, 200, 10));
  assert.deepEqual(selectInRect([s, far], { left: -5, top: -5, right: 105, bottom: 5 }), [0]);
  assert.deepEqual(strokeBounds(stroke(line(10, 20, 30, 40), 4)), { left: 8, top: 18, right: 32, bottom: 42 });
  assert.deepEqual(selectionBox([s, far], [1]), { left: -2, top: 198, right: 102, bottom: 202 });
  assert.equal(selectionBox([s], []), null);
});

test('the lasso cuts a stroke at its outline: outside, inside, outside, without a gap', () => {
  const across = stroke(line(0, 50, 200, 50, 40)), away = stroke(line(0, 300, 200, 300)), within = stroke(line(90, 40, 110, 40, 4));
  const square = [{ x: 60, y: 0 }, { x: 140, y: 0 }, { x: 140, y: 100 }, { x: 60, y: 100 }];
  const cut = cutByLasso([away, across, within], square);
  assert.equal(cut.changed, true);
  assert.equal(cut.strokes.length, 5);
  assert.equal(cut.strokes[0], away, 'Strokes outside stay the same objects.');
  assert.equal(cut.strokes[4], within, 'Strokes wholly inside stay the same objects.');
  const [left, middle, right] = cut.strokes.slice(1, 4).map(s => decodePoints(s.points));
  assert.equal(left[0][0], 0); assert.equal(right.at(-1)[0], 200);
  assert.equal(left.at(-1)[0], 60); assert.equal(middle[0][0], 60, 'Both pieces share the point on the outline.');
  assert.equal(middle.at(-1)[0], 140); assert.equal(right[0][0], 140);
  assert(middle.every(([x]) => x >= 60 && x <= 140));
  assert.deepEqual(cut.selected, [2, 4], 'Only the pieces inside are selected.');
  assert.deepEqual(cut.origin, [0, 1, 1, 1, 2]);
  assert.equal(cut.strokes[2].size, 4); assert.equal(cut.strokes[2].pressure, true);
  const none = cutByLasso([away], square);
  assert.equal(none.changed, false); assert.equal(none.strokes[0], away); assert.deepEqual(none.selected, []);
});

test('moving and scaling change the points and the width, other strokes stay', () => {
  const a = stroke(line(10, 10, 30, 10, 2), 4), b = stroke(line(0, 100, 10, 100, 2));
  const moved = transformStrokes([a, b], [0], { dx: 5, dy: -2 });
  assert.deepEqual(decodePoints(moved[0].points).map(([x, y]) => [x, y]), [[15, 8], [25, 8], [35, 8]]);
  assert.equal(moved[0].size, 4); assert.equal(moved[1], b);
  const scaled = transformStrokes([a, b], new Set([0]), { scale: 2, origin: { x: 10, y: 10 } });
  assert.deepEqual(decodePoints(scaled[0].points).map(([x, y]) => [x, y]), [[10, 10], [30, 10], [50, 10]]);
  assert.equal(scaled[0].size, 8); assert.equal(scaled[1], b);
  assert.equal(transformStrokes([a], [0], {})[0], a);
});

test('recolouring, thickening and deleting touch only the selection', () => {
  const a = stroke(line(0, 0, 10, 0), 4), b = { ...stroke(line(0, 20, 10, 20)), color: '#c9302c', tool: 'pencil' };
  const coloured = restyleStrokes([a, b], [0], { color: '#2457c5' });
  assert.equal(coloured[0].color, '#2457c5'); assert.equal(coloured[1], b);
  assert.equal('color' in restyleStrokes([b], [0], { color: null })[0], false, 'Back to the ink.');
  const thicker = restyleStrokes([a, b], [0, 1], { size: size => size * 1.25 });
  assert.equal(thicker[0].size, 5); assert.equal(thicker[1].tool, 'pencil'); assert.equal(thicker[1].points, b.points);
  assert.deepEqual(deleteStrokes([a, b], [0]), [b]);
  const all = [a, b]; assert.equal(deleteStrokes(all, []), all);
});

test('tool prefs: older ones are taken over, the pens cycle, colours are remembered', () => {
  const old = normalizePrefs({ tool: 'pen', pen: 3.75, eraser: 36 });
  assert.deepEqual(old.pen, { size: 3.75, color: null }); assert.equal(old.eraser, 36); assert.equal(old.tool, 'pen');
  assert.equal(old.marker.size, 14); assert.equal(old.select, 'rect'); assert.deepEqual(old.recent, []);
  const fresh = normalizePrefs({ tool: 'select', kind: 'pencil', select: 'lasso', marker: { size: 99, color: '#FFE14D' }, recent: ['#123456', 'nope'] });
  assert.equal(fresh.tool, 'select'); assert.equal(fresh.kind, 'pencil'); assert.equal(fresh.select, 'lasso');
  assert.deepEqual(fresh.marker, { size: 14, color: '#ffe14d' }); assert.deepEqual(fresh.recent, ['#123456']);
  assert.equal(normalizePrefs(null).tool, 'pen');
  assert.deepEqual(['pen', 'pencil', 'marker'].map(nextPen), ['pencil', 'marker', 'pen']);
  assert.deepEqual(withRecent(['#111111', '#222222'], '#222222'), ['#222222', '#111111']);
});

test('the background of a drawing is checked and steps through its spacings', () => {
  assert.deepEqual(inkPaperOf({ kind: 'grid', step: 24 }), { kind: 'grid', step: 24 });
  assert.equal(inkPaperOf({ kind: 'waves', step: 24 }), null); assert.equal(inkPaperOf(null), null);
  assert.equal(nextPaperStep(24, 1), 32); assert.equal(nextPaperStep(24, -1), 20);
  assert.equal(nextPaperStep(48, 1), 48); assert.equal(nextPaperStep(12, -1), 12); assert.equal(nextPaperStep(25, -1), 24);
});
