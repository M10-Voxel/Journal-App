import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanRule, continued, describe, easter, easterName, lastOccurrence, occurrences, onChoices, onLabel, sameRule, seriesHorizon, withStart } from '../src/repeat.ts';
import { linkedScopes, repeatChange } from '../src/planning.ts';

const weekly = (start, weekdays, extra = {}) => ({ start, unit: 'week', every: 1, weekdays, ...extra });
const until = (rule, to) => occurrences(rule, rule.start, to);

test('weekly on chosen weekdays every n-th week, starting with the entry itself', () => {
  // Thursday 29 October; Monday that week lies before the start.
  const rule = weekly('2026-10-29', [0, 3, 4], { every: 4 });
  assert.deepEqual(until(rule, '2026-12-31'), ['2026-10-29', '2026-10-30', '2026-11-23', '2026-11-26', '2026-11-27', '2026-12-21', '2026-12-24', '2026-12-25']);
  assert.equal(describe(rule), 'Alle 4 Wochen am Mo, Do, Fr');
  assert.equal(describe(weekly('2026-11-02', [0, 1, 2, 3, 4])), 'Werktags');
});

test('daily for n days, or until a date', () => {
  const rule = { start: '2026-10-30', unit: 'day', every: 1, end: { count: 5 } };
  assert.deepEqual(until(rule, '2026-12-31'), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03']);
  assert.equal(lastOccurrence(rule), '2026-11-03');
  assert.equal(describe(rule), 'Täglich · 5×');
  const monday = weekly('2026-11-02', [0], { end: { until: '2026-11-20' } });
  assert.deepEqual(until(monday, '2026-12-31'), ['2026-11-02', '2026-11-09', '2026-11-16']);
  assert.equal(describe(monday), 'Wöchentlich am Mo · bis Fr 20.11.');
  assert.equal(lastOccurrence(weekly('2026-11-02', [0])), null, 'Open-ended.');
});

test('pauses: three weeks on, one off', () => {
  const rule = weekly('2026-11-02', [0], { pause: { on: 3, off: 1, unit: 'week' } });
  assert.deepEqual(until(rule, '2026-12-31'), ['2026-11-02', '2026-11-09', '2026-11-16', '2026-11-30', '2026-12-07', '2026-12-14', '2026-12-28']);
  assert.equal(describe(rule), 'Wöchentlich am Mo · 3 an, 1 Woche aus');
  // Daily (a 21/7 cycle) counts from the start itself, in days or in weeks alike.
  const days = { start: '2026-11-04', unit: 'day', every: 1, pause: { on: 21, off: 7, unit: 'day' } };
  const weeks = { ...days, pause: { on: 3, off: 1, unit: 'week' } };
  assert.deepEqual(occurrences(days, '2026-11-24', '2026-12-02'), ['2026-11-24', '2026-12-02']);
  assert.deepEqual(occurrences(weeks, '2026-11-24', '2026-12-02'), ['2026-11-24', '2026-12-02']);
  assert.ok(sameRule({ start: '2026-11-02', unit: 'month', every: 1, pause: { on: 3, off: 1, unit: 'week' } }, { start: '2026-11-02', unit: 'month', every: 1 }), 'Monthly rules have no pause.');
});

test('only in some months: weekly on Wednesdays in March', () => {
  const rule = weekly('2027-03-03', [2], { months: [3] });
  assert.deepEqual(until(rule, '2028-03-31'), ['2027-03-03', '2027-03-10', '2027-03-17', '2027-03-24', '2027-03-31', '2028-03-01', '2028-03-08', '2028-03-15', '2028-03-22', '2028-03-29']);
  assert.equal(describe(rule), 'Wöchentlich am Mi · nur im Mär');
  assert.ok(!sameRule(rule, weekly('2027-03-03', [2])));
});

test('birthdays: the same date every year, 29 February on the 28th in other years', () => {
  const rule = { start: '2024-02-29', unit: 'year', every: 1, on: 'date' };
  assert.deepEqual(until(rule, '2029-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28', '2027-02-28', '2028-02-29', '2029-02-28']);
  assert.equal(describe(rule), 'Jährlich am 29. Feb');
});

test('monthly by date, weekday position, last weekday and month end', () => {
  assert.deepEqual(until({ start: '2026-01-31', unit: 'month', every: 1 }, '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  assert.deepEqual(until({ start: '2026-11-10', unit: 'month', every: 1, on: 'weekday' }, '2027-01-31'), ['2026-11-10', '2026-12-08', '2027-01-12']);
  const lastFriday = { start: '2026-10-30', unit: 'month', every: 1, on: 'last-weekday' };
  assert.deepEqual(until(lastFriday, '2026-12-31'), ['2026-10-30', '2026-11-27', '2026-12-25']);
  assert.equal(describe(lastFriday), 'Monatlich am letzten Fr');
  assert.deepEqual(until({ start: '2026-10-31', unit: 'month', every: 1, on: 'last-day' }, '2027-02-28'), ['2026-10-31', '2026-11-30', '2026-12-31', '2027-01-31', '2027-02-28']);
  assert.deepEqual(onChoices('2026-10-31', 'month'), ['date', 'last-weekday', 'last-day'], 'A 5th Saturday is no position every month has.');
  assert.equal(onLabel('2026-10-31', 'month', 'last-weekday'), 'letzter Sa');
});

test('holidays by weekday position or by Easter', () => {
  assert.deepEqual([2024, 2025, 2026, 2027, 2028].map(easter), ['2024-03-31', '2025-04-20', '2026-04-05', '2027-03-28', '2028-04-16']);
  const thanksgiving = { start: '2026-11-26', unit: 'year', every: 1, on: 'weekday' };
  assert.deepEqual(until(thanksgiving, '2027-12-31'), ['2026-11-26', '2027-11-25']);
  assert.equal(describe(thanksgiving), 'Jährlich am 4. Do im Nov');
  const goodFriday = { start: '2026-04-03', unit: 'year', every: 1, on: 'easter' };
  assert.ok(onChoices('2026-04-03', 'year').includes('easter'));
  assert.deepEqual(until(goodFriday, '2028-12-31'), ['2026-04-03', '2027-03-26', '2028-04-14']);
  assert.equal(easterName(-2), 'Karfreitag');
  assert.equal(describe(goodFriday), 'Jährlich · Karfreitag');
});

test('a rule moved to another start keeps its pattern and fits the rest', () => {
  assert.deepEqual(withStart(weekly('2026-10-29', [3]), '2026-10-30').weekdays, [4], 'A single weekday follows the start.');
  assert.deepEqual(withStart(weekly('2026-10-29', [0, 3]), '2026-10-30').weekdays, [0, 3]);
  assert.equal(withStart({ start: '2026-10-31', unit: 'month', every: 1, on: 'last-day' }, '2026-11-15').on, 'date');
  assert.equal(withStart({ start: '2026-10-31', unit: 'month', every: 1, on: 'last-day' }, '2026-11-27').on, 'last-weekday');
  // Continuing a series from an occurrence keeps its rhythm while that occurrence still fits it.
  const fortnightly = weekly('2026-11-02', [0], { every: 2 });
  assert.equal(continued(fortnightly, '2026-11-16').start, '2026-11-02');
  assert.equal(continued(fortnightly, '2026-11-09').start, '2026-11-09');
  assert.ok(sameRule(weekly('2026-10-29', undefined), weekly('2026-10-29', [3])));
  assert.deepEqual(cleanRule({ start: '2026-10-29', unit: 'day', every: 2, weekdays: [3], on: 'date', pause: null, end: null }), { start: '2026-10-29', unit: 'day', every: 2 });
  assert.equal(seriesHorizon('2026-10-30'), '2028-12-31');
  assert.equal(seriesHorizon('2026-10-30', '2030-05-01'), '2030-12-31');
});

const entry = (extra = {}) => ({ id: 'e', kind: 'task', text: 'Sport', done: false, cancelled: false, priority: false, time: '18:00', reminder: false, plan: null, ...extra });
let counter = 0;
const ids = () => `id-${++counter}`;
const schedule = { time: '18:00', reminder: false };

test('confirming the planner starts, continues or ends a series', () => {
  const friday = weekly('2026-10-30', [4], { end: { until: '2026-11-20' } });
  assert.deepEqual(repeatChange(entry(), '2026-10-30', ['2026-10-30'], schedule, friday, '2026-10-30', () => 'S'),
    { time: '18:00', end: null, reminder: false, repeat: { series: 'S', rule: cleanRule(friday), horizon: '2028-12-31', dates: ['2026-11-06', '2026-11-13', '2026-11-20'] } });
  // An occurrence whose rule stays the same only changes itself.
  const member = entry({ repeat: { series: 'old', rule: weekly('2026-11-02', [0]), horizon: '2028-12-31' } });
  assert.deepEqual(repeatChange(member, '2026-11-16', ['2026-11-16'], schedule, weekly('2026-11-02', [0]), '2026-10-30', ids), { time: '18:00', end: null, reminder: false });
  // Every second week from the 16th on keeps the series' start, which the 16th still fits.
  const changed = repeatChange(member, '2026-11-16', ['2026-11-16'], schedule, weekly('2026-11-02', [0], { every: 2, end: { until: '2026-12-31' } }), '2026-10-30', () => 'N');
  assert.equal(changed.repeat.rule.start, '2026-11-02');
  assert.deepEqual(changed.repeat.dates, ['2026-11-30', '2026-12-14', '2026-12-28']);
  // No rule: the entry leaves its series (an unknown series without rule).
  assert.deepEqual(repeatChange(member, '2026-11-16', ['2026-11-16'], schedule, null, '2026-10-30', () => 'L').repeat, { series: 'L', rule: null, horizon: '' });
  // Planned to another date, the copy there starts the series.
  const planned = repeatChange(entry(), '2026-10-30', ['2027-03-12'], schedule, { start: '2026-10-30', unit: 'year', every: 1, on: 'date' }, '2026-10-30', ids);
  assert.equal(planned.repeat, undefined);
  assert.equal(planned.plan.targets[0].date, '2027-03-12');
  assert.deepEqual([planned.plan.repeat.rule.start, planned.plan.repeat.horizon, planned.plan.repeat.dates], ['2027-03-12', '2028-12-31', ['2028-03-12']]);
  // Several days are planned without repetition.
  const days = repeatChange(entry(), '2026-10-30', ['2026-11-02', '2026-11-03'], schedule, friday, '2026-10-30', ids);
  assert.equal(days.plan.repeat, undefined); assert.equal(days.repeat, undefined);
});

test('occurrences of a series are finished one by one but can be removed together', () => {
  const group = ['2026-11-02', '2026-11-09', '2026-11-16'].map((date, index) => ({ id: `o${index}`, date, kind: 'task', done: false, cancelled: false, trace: false, series: 'S' }));
  assert.deepEqual(linkedScopes(group, 'o0', 'done').map(option => option.scope), ['this']);
  assert.deepEqual(linkedScopes(group, 'o1', 'cancelled').map(option => option.scope), ['this']);
  assert.deepEqual(linkedScopes(group, 'o1', 'remove').map(option => [option.scope, option.others.length]), [['this', 0], ['following', 1], ['all', 2]]);
});
