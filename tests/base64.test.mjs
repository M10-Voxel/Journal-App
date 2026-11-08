import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBase64, encodeBase64 } from '../src/base64.ts';

test('base64 preserves all byte values, chunk boundaries and subarray offsets', () => {
  for (const size of [0, 1, 2, 3, 256, 32767, 32768, 32769, 4 * 1024 * 1024 + 1]) {
    const storage = Uint8Array.from({ length: size + 18 }, (_, i) => i % 256);
    const bytes = storage.subarray(7, size + 7);
    const encoded = encodeBase64(bytes);
    assert.equal(encoded, Buffer.from(bytes).toString('base64'));
    assert.deepEqual(decodeBase64(encoded), bytes);
  }
});

test('base64 decoding keeps atob compatibility and rejects malformed input', () => {
  assert.deepEqual(decodeBase64(' Y Q \n'), new Uint8Array([97]));
  for (const invalid of ['a', '%%%=', 'abc===', '😸']) assert.throws(() => decodeBase64(invalid));
});
