import test from 'node:test';
import assert from 'node:assert/strict';

test('browsing retains only a bounded set of days and reloads evicted content', async () => {
  const calls = new Map();
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    if (command === 'load_series') return [];
    if (command === 'load_day') {
      calls.set(args.date, (calls.get(args.date) ?? 0) + 1);
      return { date: args.date, title: args.date, body: '', entries: [], revision: 1 };
    }
    throw new Error(command);
  } } };
  const { journal } = await import('../src/journal.ts');
  const dates = Array.from({ length: 80 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
  for (const date of dates) await journal.load(date);
  assert.equal(dates.filter(date => journal.cached(date)).length, 32);
  assert.equal(journal.cached(dates[0]), undefined);
  await journal.load(dates[79]);
  assert.equal(calls.get(dates[79]), 1, 'Recent content is reused.');
  await journal.load(dates[0]);
  assert.equal(calls.get(dates[0]), 2, 'Eviction does not lose persisted data.');
  journal.invalidate();
  assert(dates.every(date => !journal.cached(date)));
});
