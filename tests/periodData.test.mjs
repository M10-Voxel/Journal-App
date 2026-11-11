import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySummary, normalizePeriodData } from '../src/periodData.ts';
test('recorded minutes are included even without a checkbox and survive disabling tracking', () => {
 const data=normalizePeriodData({definitions:[{id:'a',name:'Read',trackTime:false}],days:{'2026-11-02':{items:{a:{done:false,minutes:45}}},'2026-11-03':{items:{a:{done:true,minutes:30}}}}});
 const sum=activitySummary(['2026-11-02','2026-11-03','2026-11-04'],data.days,'a');
 assert.equal(sum.minutes,75); assert.equal(sum.activeDays,2); assert.equal(data.definitions[0].trackTime,false);
 assert.equal(activitySummary(['2026-11-04'],data.days,'a').minutes,0);
});
test('existing activities retain time and notes support when defaults are added', () => {
 const data=normalizePeriodData({definitions:[{id:'a',name:'Read'}]});
 assert.equal(data.definitions[0].textField,true); assert.equal(data.definitions[0].active,true); assert.equal(data.definitions[0].color,'#569eff');
});

test('day values: definitions are made valid, the rating span defaults to 0–10, values outside stay stored', async () => {
  const { ratingScale, seriesOf, clampToScale } = await import('../src/periodData.ts');
  const data = normalizePeriodData({ scales: [{ id: 's', name: 'Stress', color: 'red', min: 5, max: 2 }, { id: 'p', name: 'Sleep', color: '#112233', min: 0.4, max: 20.2, active: false }, { name: 'no id' }],
    days: { '2026-11-02': { items: {}, rating: 12, scales: { s: 7, p: 25 } } } });
  assert.deepEqual(data.scales.map(item => [item.id, item.color, item.min, item.max, item.active]), [['s', '#569eff', 0, 10, true], ['p', '#112233', 0, 20, false]]);
  assert.equal(data.rating, undefined, 'No rating settings are added to an older vault.');
  assert.deepEqual(ratingScale(data), { color: '#569eff', min: 0, max: 10 });
  assert.deepEqual(ratingScale(normalizePeriodData({ rating: { color: '#abcdef', min: 1, max: 5 } })), { color: '#abcdef', min: 1, max: 5 });
  assert.equal(data.days['2026-11-02'].scales.p, 25, 'Stored as it was ...');
  assert.equal(seriesOf(['2026-11-02'], data.days, 'p', data.scales[1])['2026-11-02'], 20, '... shown within the span.');
  assert.equal(seriesOf(['2026-11-02'], data.days, 'rating', ratingScale(data))['2026-11-02'], 10);
  assert.equal(clampToScale(-3, { min: 0, max: 10 }), 0);
});

test('chart series keep gaps and the y axis spans every shown line', async () => {
  const { seriesOf, chartRange } = await import('../src/periodData.ts');
  const days = { '2026-11-02': { items: {}, rating: 4, scales: { s: 3 } }, '2026-11-04': { items: {}, scales: { s: 9 } } };
  const dates = ['2026-11-02', '2026-11-03', '2026-11-04'];
  assert.deepEqual(seriesOf(dates, days, 'rating', { min: 0, max: 10 }), { '2026-11-02': 4, '2026-11-03': undefined, '2026-11-04': undefined });
  assert.deepEqual(seriesOf(dates, days, 's', { min: 0, max: 10 }), { '2026-11-02': 3, '2026-11-03': undefined, '2026-11-04': 9 });
  assert.deepEqual(chartRange([{ min: 0, max: 20 }, { min: 0, max: 10 }]), { min: 0, max: 20 });
  assert.deepEqual(chartRange([{ min: -5, max: 5 }, { min: 1, max: 10 }]), { min: -5, max: 10 });
  assert.deepEqual(chartRange([]), { min: 0, max: 10 }, 'Nothing shown: the default span.');
});

test('the input maps a point to a value: a cell per step, or the nearest value with many steps', async () => {
  const { scaleCells, valueAt, positionOf } = await import('../src/periodData.ts');
  assert.deepEqual(scaleCells({ min: 0, max: 10 }).length, 11);
  assert.equal(valueAt(0, { min: 0, max: 10 }), 0);
  assert.equal(valueAt(.999, { min: 0, max: 10 }), 10);
  assert.equal(valueAt(.5, { min: 0, max: 10 }), 5, 'The middle cell of eleven.');
  assert.equal(valueAt(1.4, { min: 1, max: 5 }), 5, 'Past the end: the highest value.');
  const wide = { min: 0, max: 100 };
  assert.equal(scaleCells(wide).length, 24);
  assert.deepEqual([scaleCells(wide)[0], scaleCells(wide).at(-1)], [0, 100]);
  assert.equal(valueAt(.37, wide), 37);
  assert.equal(positionOf(5, { min: 0, max: 10 }), 5.5 / 11);
  assert.equal(positionOf(50, wide), .5);
});
