import test from 'node:test';
import assert from 'node:assert/strict';
import { fingerprint, isBusy, isRateLimit, minGap, normalizeSyncPrefs, retryDelay, saveDue, saveMaxWait, saveQuiet, syncsOnClose } from '../src/sync/driveSchedule.ts';

test('the sync moment is checked; the interval stays between two minutes and a day', () => {
  assert.deepEqual(normalizeSyncPrefs(null), { moment:'manual', minutes:15 });
  assert.deepEqual(normalizeSyncPrefs({ moment:'save', minutes:0.5 }), { moment:'save', minutes:2 });
  assert.deepEqual(normalizeSyncPrefs({ moment:'interval', minutes:99999 }), { moment:'interval', minutes:1440 });
  assert.deepEqual(normalizeSyncPrefs({ moment:'sometimes', minutes:'5' }), { moment:'manual', minutes:15 });
  assert.equal(syncsOnClose({ moment:'close', minutes:15 }), true);
  assert.equal(syncsOnClose({ moment:'quit', minutes:15 }), false);
});

test('saving syncs after a quiet moment, at the latest after two minutes, never closer than half a minute', () => {
  const now = 1_000_000;
  assert.equal(saveDue(now, now, now, 0), now + saveQuiet);
  // Writing on and on: the first change still goes out after saveMaxWait.
  assert.equal(saveDue(now + 110_000, now, now + 110_000, 0), now + saveMaxWait);
  // Just synced: wait for the gap.
  assert.equal(saveDue(now, now - 60_000, now - 25_000, now - 5_000), now - 5_000 + minGap);
  assert.equal(saveDue(now, now - 600_000, now - 600_000, 0), now, 'Overdue runs now.');
});

test('failures wait longer each time, Google\'s request limit at least five minutes; busy states are no failures', () => {
  assert.deepEqual([1, 2, 3, 4, 7, 20].map(n => retryDelay(n, false) / 60_000), [1, 2, 4, 8, 60, 60]);
  assert.equal(retryDelay(1, true), 5 * 60_000);
  assert(isRateLimit('Google Drive: HTTP 429. Das Google-Anfragelimit ist erreicht.'));
  assert(isRateLimit('Google Drive: HTTP 403 (userRateLimitExceeded).'));
  assert(!isRateLimit('Upload fehlgeschlagen'));
  assert(isBusy('Google Drive arbeitet bereits'));
  assert(isBusy('Lokale Daten wurden während der Synchronisierung geändert. Erneut versuchen.'));
});

test('the fingerprint ignores key order and notices any change', () => {
  assert.equal(fingerprint({ a:1, b:{ c:[1, 2], d:null } }), fingerprint({ b:{ d:null, c:[1, 2] }, a:1 }));
  assert.notEqual(fingerprint({ a:1 }), fingerprint({ a:2 }));
  assert.notEqual(fingerprint({ list:[1, 2] }), fingerprint({ list:[2, 1] }));
  assert.notEqual(fingerprint({ a:'x' }), fingerprint({ a:'y' }));
});
