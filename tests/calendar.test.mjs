import test from 'node:test';
import assert from 'node:assert/strict';
import { durationOf, formatDuration, isoWeek, layoutTimed, orderForCalendar, shiftMonthKeepingDay, shiftView, snapRange, viewDates, viewRange, viewTitle } from '../src/calendar.ts';
import { formatSpan, keepDuration, planChange, tomorrowChange } from '../src/planning.ts';

const entry = (id, kind, extra = {}) => ({ id, kind, text:id, done:false, cancelled:false, priority:false, time:null, reminder:false, plan:null, ...extra });

test('views show the right dates', () => {
  assert.deepEqual(viewDates('workweek', '2026-11-01'), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30'], 'Sunday belongs to the week before.');
  assert.equal(viewDates('week', '2026-10-30').length, 7);
  assert.equal(viewDates('year', '2024-06-01').length, 366);
  assert.equal(viewDates('year', '2026-06-01').length, 365);
  assert.deepEqual(viewRange('year', '2026-10-30'), { from:'2026-01-01', to:'2026-12-31' });
  assert.deepEqual(viewRange('day', '2026-10-30'), { from:'2026-09-28', to:'2026-11-08' }, 'The day view loads its month for the side calendar.');
});

test('stepping keeps the day where the month allows it', () => {
  assert.equal(shiftMonthKeepingDay('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftView('year', '2024-02-29', 1), '2025-02-28');
  assert.equal(shiftView('month', '2026-12-15', 1), '2027-01-15');
  assert.equal(shiftView('workweek', '2026-10-30', -1), '2026-10-23');
  assert.equal(shiftView('day', '2026-10-31', 1), '2026-11-01');
});

test('ISO week numbers', () => {
  assert.equal(isoWeek('2026-10-30'), 44);
  assert.equal(isoWeek('2027-01-01'), 53, '1 January 2027 is a Friday and still in week 53 of 2026.');
  assert.equal(isoWeek('2025-12-29'), 1, 'Monday 29 December 2025 starts week 1 of 2026.');
});

test('titles read like a calendar app', () => {
  assert.deepEqual(viewTitle('month', '2026-10-30'), { main:'Oktober', sub:'2026' });
  assert.deepEqual(viewTitle('week', '2026-10-21'), { main:'Oktober', sub:'KW 43 · 2026' });
  assert.deepEqual(viewTitle('week', '2026-11-01'), { main:'Okt – Nov', sub:'KW 44 · 2026' });
  assert.deepEqual(viewTitle('day', '2026-10-30'), { main:'30. Oktober', sub:'Freitag · 2026' });
});

test('entries without time come first, then by time; priority and events lead', () => {
  const ordered = orderForCalendar([entry('late', 'task', { time:'18:00' }), entry('task', 'task'), entry('early', 'event', { time:'08:30' }), entry('event', 'event'), entry('urgent', 'task', { priority:true })]);
  assert.deepEqual(ordered.map(item => item.id), ['urgent', 'event', 'task', 'early', 'late']);
});

test('overlapping timed entries share the width', () => {
  const layout = layoutTimed([{ id:'a', time:'09:00' }, { id:'b', time:'09:30' }, { id:'c', time:'10:15' }, { id:'d', time:'12:00' }]);
  const by = Object.fromEntries(layout.map(item => [item.item.id, item]));
  assert.deepEqual([by.a.column, by.b.column, by.c.column], [0, 1, 0], 'c starts after a ended and takes its column.');
  assert.equal(by.a.columns, 2); assert.equal(by.c.columns, 2, 'c overlaps b, so it belongs to the same group.');
  assert.deepEqual([by.d.column, by.d.columns], [0, 1]);
  assert.equal(by.b.start, 570);
});

test('spans last until their end; without an end an hour, but not past midnight', () => {
  assert.equal(durationOf({ time:'09:00', end:'10:30' }), 90);
  assert.equal(durationOf({ time:'09:00' }), 60);
  assert.equal(durationOf({ time:'23:30' }), 30);
  const layout = layoutTimed([{ id:'long', time:'09:00', end:'12:00' }, { id:'later', time:'11:00', end:'11:15' }, { id:'after', time:'12:00', end:'12:30' }]);
  const by = Object.fromEntries(layout.map(item => [item.item.id, item]));
  assert.deepEqual([by.long.columns, by.later.column, by.after.columns], [2, 1, 1], 'A long entry reaches entries that start later; one starting at its end is free.');
  assert.equal(by.long.duration, 180);
});

test('a marked range snaps to quarter hours in either direction', () => {
  assert.deepEqual(snapRange(9 * 60 + 7, 10 * 60 + 20), { start:540, end:630 }, '09:07 to 10:20 marks 09:00–10:30.');
  assert.deepEqual(snapRange(10 * 60 + 20, 9 * 60 + 7), { start:540, end:630 }, 'Dragging upwards gives the same range.');
  assert.deepEqual(snapRange(600, 600), { start:600, end:615 }, 'At least one quarter.');
  assert.deepEqual(snapRange(-30, 24 * 60 + 40), { start:0, end:1440 }, 'Clamped to the day.');
  assert.deepEqual([formatDuration(90), formatDuration(45), formatDuration(120)], ['1 h 30', '45 min', '2 h']);
});

test('planning keeps a span; moving its start keeps the duration', () => {
  const span = { id:'e', kind:'event', text:'Termin', done:false, cancelled:false, priority:false, time:'09:00', end:'10:30', reminder:false, plan:null };
  assert.equal(keepDuration(span, '14:15'), '15:45');
  assert.equal(keepDuration(span, '23:00'), null, 'Past midnight the end is dropped.');
  assert.equal(keepDuration({ time:'09:00', end:null }, '10:00'), null);
  assert.deepEqual(planChange('2026-10-30', ['2026-10-30'], { time:'14:15', end:'15:45', reminder:false }), { time:'14:15', end:'15:45', reminder:false });
  assert.deepEqual(planChange('2026-10-30', ['2026-10-30'], { time:null, end:'15:45', reminder:false }), { time:null, end:null, reminder:false }, 'No end without a start.');
  assert.equal(tomorrowChange(span, '2026-10-30', () => 'id').plan.end, '10:30');
  assert.equal(formatSpan('09:00', '10:30'), '09:00–10:30');
});
