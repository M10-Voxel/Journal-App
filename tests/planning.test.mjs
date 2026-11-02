import test from 'node:test';
import assert from 'node:assert/strict';
import { editScopes, formatSpan, keepDuration, linkedScopes, canPlan, clockAngle, clockValue, isValidTime, nextFullHour, planChange, stepTime, tomorrowChange, typeDigit } from '../src/planning.ts';
import { monthGrid, shiftMonth, shiftDate } from '../src/dates.ts';

const entry = (kind, extra = {}) => ({ id:'e', kind, text:'Beispiel', done:false, cancelled:false, priority:false, time:null, reminder:false, plan:null, ...extra });
let counter = 0;
const ids = () => `id-${++counter}`;

test('planning on the same day only sets time and reminder', () => {
  assert.deepEqual(planChange('2026-10-28', ['2026-10-28'], { time:'15:00', reminder:true }), { time:'15:00', end:null, reminder:true });
});
test('planning to another date turns the entry into a trace with one target', () => {
  const change = planChange('2026-10-28', ['2026-11-02'], { time:null, reminder:true }, undefined, ids);
  assert.deepEqual(change, { plan: { via:'date', targets:[{ date:'2026-11-02', id:'id-1' }], time:null, end:null, reminder:true } });
});
test('several dates are sorted, deduplicated and marked as days, without the origin day', () => {
  const change = planChange('2026-10-28', ['2026-10-31', '2026-10-28', '2026-10-30', '2026-10-31'], { time:'08:00', reminder:false }, undefined, ids);
  assert.equal(change.plan.via, 'days');
  assert.deepEqual(change.plan.targets.map(target => target.date), ['2026-10-30', '2026-10-31']);
  assert.equal(new Set(change.plan.targets.map(target => target.id)).size, 2);
});
test('tomorrow keeps the existing schedule, also across month and year ends', () => {
  const change = tomorrowChange(entry('task', { time:'07:30', reminder:true }), '2026-12-31', ids);
  assert.deepEqual(change.plan, { via:'tomorrow', targets:[{ date:'2027-01-01', id:change.plan.targets[0].id }], time:'07:30', end:null, reminder:true });
});
test('only unplanned tasks and events can be planned', () => {
  assert.equal(canPlan(entry('task')), true);
  assert.equal(canPlan(entry('event')), true);
  assert.equal(canPlan(entry('note')), false);
  assert.equal(canPlan(entry('task', { plan:{ via:'date', targets:[], time:null, reminder:false } })), false);
});
test('times are optional and must be HH:MM', () => {
  for (const time of [null, undefined, '00:00', '09:05', '23:59']) assert.equal(isValidTime(time), true, String(time));
  for (const time of ['24:00', '9:00', '12:60', '']) assert.equal(isValidTime(time), false, time);
});
test('month grids start on Monday, cover six weeks and contain the whole month', () => {
  const grid = monthGrid('2026-10');
  assert.equal(grid.length, 42);
  assert.equal(grid[0], '2026-09-28');
  assert.equal(new Date(`${grid[0]}T12:00`).getDay(), 1);
  assert.equal(grid.filter(date => date.startsWith('2026-10')).length, 31);
  assert.equal(monthGrid('2026-02').filter(date => date.startsWith('2026-02')).length, 28);
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftDate('2026-03-28', 2), '2026-03-30', 'Daylight saving changes must not skip days.');
});

test('the clock face maps pointer positions to hours on two rings and minutes in fives', () => {
  const at = (slot, radius) => [radius * Math.sin(slot * Math.PI / 6), -radius * Math.cos(slot * Math.PI / 6)];
  const now = { hour:9, minute:30 };
  assert.equal(clockValue('hour', ...at(0, 80), 66, now), '12:30');
  assert.equal(clockValue('hour', ...at(0, 50), 66, now), '00:30');
  assert.equal(clockValue('hour', ...at(3, 80), 66, now), '03:30');
  assert.equal(clockValue('hour', ...at(3, 50), 66, now), '15:30');
  assert.equal(clockValue('hour', ...at(11.6, 80), 66, now), '12:30', 'Just left of 12 rounds to 12.');
  assert.equal(clockValue('minute', ...at(9, 80), 66, now), '09:45');
  assert.equal(clockValue('minute', ...at(11.8, 80), 66, now), '09:00');
  assert.equal(clockAngle('hour', 15, 0), 90);
  assert.equal(clockAngle('minute', 15, 45), 270);
});
test('stepping wraps hours within the day and carries minutes into the hour', () => {
  assert.equal(stepTime('23:10', 'hour', 1), '00:10');
  assert.equal(stepTime('00:10', 'hour', -1), '23:10');
  assert.equal(stepTime('09:58', 'minute', 5), '10:03');
  assert.equal(stepTime('00:00', 'minute', -1), '23:59');
  assert.equal(nextFullHour(new Date(2026, 9, 28, 23, 40)), '00:00');
  assert.equal(nextFullHour(new Date(2026, 9, 28, 8, 5)), '09:00');
});
test('typing digits fills hours, then minutes, reading a second digit only when it fits', () => {
  const type = (keys, time = '09:00') => [...keys].reduce((state, key) => typeDigit(state, Number(key)), { time, mode:'hour', pending:null });
  assert.deepEqual(type('1530'), { time:'15:30', mode:'minute', pending:null });
  assert.deepEqual(type('930'), { time:'09:30', mode:'minute', pending:null }, '9 cannot start an hour above 23.');
  assert.deepEqual(type('250'), { time:'02:50', mode:'minute', pending:null }, '25 does not fit, so 5 starts the minutes.');
  assert.deepEqual(type('23'), { time:'23:00', mode:'minute', pending:null });
  assert.deepEqual(type('1'), { time:'01:00', mode:'hour', pending:1 }, 'A single 1 may still become 10–19.');
  assert.deepEqual(type('07'), { time:'07:00', mode:'minute', pending:null });
  assert.deepEqual(type('127'), { time:'12:07', mode:'minute', pending:null }, '7 cannot start minutes above 59.');
  assert.deepEqual(type('1278'), { time:'12:08', mode:'minute', pending:null }, 'After complete minutes, a new digit starts them again.');
  assert.deepEqual(type('12345'), { time:'12:05', mode:'minute', pending:5 });
  assert.deepEqual(type('128'), { time:'12:08', mode:'minute', pending:null }, '8 cannot start minutes above 59.');
  assert.deepEqual(typeDigit({ time:'10:15', mode:'minute', pending:null }, 4), { time:'10:04', mode:'minute', pending:4 });
});
test('several days: a range from two points, with single days flipped out of it or added outside', async () => {
  const { datesBetween, pickedDays } = await import('../src/planning.ts');
  assert.deepEqual(datesBetween('2026-11-02', '2026-10-30'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02']);
  const range = { from:'2026-10-28', to:'2026-11-01' };
  assert.deepEqual(pickedDays(range, [], '2026-10-28'), ['2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01'], 'The entry\'s own day is never a target.');
  assert.deepEqual(pickedDays(range, ['2026-10-30', '2026-11-05'], '2026-10-28'), ['2026-10-29', '2026-10-31', '2026-11-01', '2026-11-05']);
  assert.deepEqual(pickedDays(null, ['2026-11-05'], '2026-10-28'), ['2026-11-05']);
});

test('actions on linked entries offer the following ones and, when removing or cancelling, all of them', () => {
  const item = (id, date, extra = {}) => ({ id, date, kind:'task', done:false, cancelled:false, trace:false, ...extra });
  const group = [item('a', '2026-10-28', { trace:true }), item('b', '2026-10-29'), item('c', '2026-10-30', { done:true }), item('d', '2026-10-31')];
  const shape = options => options.map(option => `${option.scope}:${option.others.map(other => other.id).join('')}`);
  assert.deepEqual(shape(linkedScopes(group, 'b', 'remove')), ['this:', 'following:cd', 'all:acd'], 'Removing reaches traces too.');
  assert.deepEqual(shape(linkedScopes(group, 'b', 'done')), ['this:', 'following:d'], 'Finished tasks are left out; nothing earlier is finished along.');
  assert.deepEqual(shape(linkedScopes(group, 'b', 'cancelled')), ['this:', 'following:cd'], 'The trace keeps no status, so cancelling all equals cancelling the following.');
  assert.deepEqual(shape(linkedScopes(group, 'd', 'remove')), ['this:', 'all:abc']);
  assert.deepEqual(shape(linkedScopes(group, 'd', 'done')), ['this:'], 'Nothing to ask.');
  assert.deepEqual(shape(linkedScopes([], 'x', 'remove')), ['this:'], 'An unsaved entry has no group yet.');
  assert.deepEqual(shape(linkedScopes([item('e', '2026-10-28', { kind:'event' }), item('f', '2026-10-29', { kind:'event' })], 'e', 'cancelled')), ['this:'], 'Events are never cancelled.');
});

test('appointments past midnight end on the next day', () => {
  assert.equal(formatSpan('22:00', '26:30'), '22:00–02:30⁺¹');
  assert.equal(formatSpan('23:00', '24:00'), '23:00–24:00', 'Midnight itself stays 24:00.');
  assert.equal(keepDuration({ time: '20:00', end: '23:00' }, '23:30'), '26:30', 'Moving it later keeps the length past midnight.');
  assert.equal(keepDuration({ time: '00:00', end: '23:00' }, '23:30'), '46:30');
});

test('an edit in the calendar offers this one, every one on the same weekday, or all (traces left out)', () => {
  const item = (id, date, extra = {}) => ({ id, date, kind:'event', done:false, cancelled:false, trace:false, ...extra });
  // Tuesdays and Thursdays of a series, and the trace it was planned from.
  const group = [item('trace', '2026-10-30', { trace:true }), item('tu1', '2026-11-03'), item('th1', '2026-11-05'), item('tu2', '2026-11-10'), item('th2', '2026-11-12')];
  const shape = options => options.map(option => `${option.scope}:${option.others.map(other => other.id).join(',')}`);
  assert.deepEqual(shape(editScopes(group, 'tu1', '2026-11-03')), ['this:', 'weekday:tu2', 'all:tu1,th1,tu2,th2'.replace('tu1,', '')]);
  assert.equal(editScopes(group, 'tu1', '2026-11-03')[1].weekday, 1, 'Tuesday');
  const tuesdays = group.filter(entry => entry.id.startsWith('tu'));
  assert.deepEqual(shape(editScopes(tuesdays, 'tu1', '2026-11-03')), ['this:', 'all:tu2'], 'All on the same weekday: no separate choice.');
  assert.deepEqual(shape(editScopes([item('alone', '2026-11-03')], 'alone', '2026-11-03')), ['this:'], 'Nothing to ask.');
});

test('removing also offers every one on the same weekday', () => {
  const item = (id, date, extra = {}) => ({ id, date, kind:'event', done:false, cancelled:false, trace:false, ...extra });
  const group = [item('trace', '2026-10-30', { trace:true }), item('tu1', '2026-11-03'), item('th1', '2026-11-05'), item('tu2', '2026-11-10'), item('th2', '2026-11-12')];
  const options = linkedScopes(group, 'tu1', 'remove');
  assert.deepEqual(options.map(option => option.scope), ['this', 'following', 'weekday', 'all']);
  assert.deepEqual(options[2].others.map(other => other.id), ['tu2']);
  assert.equal(options[2].weekday, 1);
  assert.deepEqual(linkedScopes(group.map(entry => ({ ...entry, kind:'task' })), 'tu1', 'done').map(option => option.scope), ['this', 'following'], 'Only removing asks for the weekday.');
});
