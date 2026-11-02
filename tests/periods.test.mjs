import test from 'node:test';
import assert from 'node:assert/strict';
import { periodBounds, periodDates, ratingBuckets } from '../src/periods.ts';
test('period ranges handle leap days and ISO weeks across years', () => {
  assert.deepEqual(periodBounds('2026-01-01','week'), ['2025-12-29','2026-01-04']);
  assert.equal(periodDates(...periodBounds('2024-02-15','month')).length,29);
  assert.deepEqual(periodBounds('2026-11-02','quarter'), ['2026-10-01','2026-12-31']);
});
test('chart buckets preserve missing days and average recorded ratings only', () => {
  const dates=periodDates('2026-01-30','2026-02-02');
  assert.deepEqual(ratingBuckets(dates,{'2026-01-30':4,'2026-01-31':8},true),[{key:'2026-01',count:2,value:6},{key:'2026-02',count:0,value:null}]);
  assert.deepEqual(ratingBuckets(dates,{'2026-01-30':4},false).map(b=>b.value),[4,null,null,null]);
});
