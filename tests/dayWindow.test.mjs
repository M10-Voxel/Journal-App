import test from 'node:test';
import assert from 'node:assert/strict';
import { bandBuffer, bandColumns, bandRange, bandWeeks, centeredScroll, clampOpenDays, datesBetween, foldedWidth, openWidth, rangeOf, spanTo, windowDates } from '../src/dayWindow.ts';
import { shiftDate } from '../src/dates.ts';
import { viewDates, viewTitle } from '../src/calendar.ts';
import { parseCalendarPreferences } from '../src/calendarPreferences.ts';

// 2026-11-18 is a Wednesday.
test('the open days and their size', () => {
  assert.deepEqual(windowDates('2026-11-18', 3), ['2026-11-18', '2026-11-19', '2026-11-20']);
  assert.equal(clampOpenDays(9), 5, 'At most five days are open.');
  assert.equal(clampOpenDays(0), 1);
  assert.equal(clampOpenDays(undefined), 3, 'Three by default: today and the two after.');
  assert.equal(parseCalendarPreferences('{}').openDays, 3);
  assert.equal(parseCalendarPreferences('{"openDays":4}').openDays, 4);
});

test('shift+click and dragging over the heads open a range of at most five days', () => {
  assert.deepEqual(spanTo('2026-11-18', 3, '2026-11-21'), { start:'2026-11-18', size:4 });
  assert.deepEqual(spanTo('2026-11-18', 3, '2026-11-16'), { start:'2026-11-16', size:5 });
  assert.deepEqual(spanTo('2026-11-18', 3, '2026-11-30'), { start:'2026-11-26', size:5 }, 'Too far: five days ending at the click.');
  assert.deepEqual(spanTo('2026-11-18', 3, '2026-11-19'), { start:'2026-11-18', size:3 }, 'An open day changes nothing.');
  assert.deepEqual(rangeOf('2026-11-18', '2026-11-16'), { start:'2026-11-16', size:3 });
  assert.deepEqual(rangeOf('2026-11-18', '2026-11-28'), { start:'2026-11-18', size:5 });
});

test('the band holds the open days with room on both sides and only grows', () => {
  const first = bandRange(null, '2026-11-18', 3);
  assert.deepEqual(first, { from:shiftDate('2026-11-18', -bandBuffer), to:shiftDate('2026-11-20', bandBuffer) });
  assert.deepEqual(bandRange(first, '2026-11-19', 3), { from:first.from, to:shiftDate('2026-11-21', bandBuffer) }, 'Moving on widens it at the end only.');
  assert.deepEqual(bandRange({ from:'2026-08-01', to:'2027-02-01' }, '2026-11-18', 3), { from:'2026-08-01', to:'2027-02-01' }, 'Never narrowed.');
  assert.equal(datesBetween('2026-11-29', '2026-12-02').length, 4);
});

test('how much is shown: weeks, widths and the middle', () => {
  assert.ok(bandWeeks(440, 3) >= 3, 'A slim sidebar shows three weeks or more.');
  assert.equal(bandWeeks(120, 5), 1);
  assert.equal(bandWeeks(240, 3), 2, 'A narrow desk panel still shows two weeks, with narrower open days.');
  const width = 440, size = 3, open = openWidth(width, size);
  assert.equal(open, (width - (bandWeeks(width, size) * 7 - size) * foldedWidth) / size, 'Open days share what the folded ones of the shown weeks leave.');
  const dates = datesBetween('2026-10-01', '2026-12-31'), opened = new Set(windowDates('2026-11-18', size));
  const widths = bandColumns(dates, opened, width, size);
  assert.equal(widths[0], foldedWidth); assert.equal(widths[dates.indexOf('2026-11-19')], open);
  const scroll = centeredScroll(dates, '2026-11-18', size, width);
  assert.equal(scroll + width / 2, dates.indexOf('2026-11-18') * foldedWidth + size * open / 2, 'The open days sit in the middle.');
  assert.equal(centeredScroll(dates, '2026-11-19', size, width) - scroll, foldedWidth, 'One day on: the band glides by one folded day, never jumps.');
});

test('the open days and the title', () => {
  assert.deepEqual(viewDates('day', '2026-11-16', 2), ['2026-11-16', '2026-11-17']);
  assert.equal(viewTitle('day', '2026-11-18', 3).sub, '18.–20.');
  assert.equal(viewTitle('day', '2026-11-29', 3).sub, '29.11.–1.12.');
});
