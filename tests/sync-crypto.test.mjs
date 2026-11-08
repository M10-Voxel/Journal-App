import test from 'node:test';
import assert from 'node:assert/strict';
import { decrypt, encrypt, encryptionKey } from '../src/sync/crypto.ts';

const raw = Uint8Array.from({ length: 32 }, (_, i) => i * 7 % 256);
const legacyEncode = bytes => Buffer.from(bytes).toString('base64');
const legacyDecode = value => new Uint8Array(Buffer.from(value, 'base64'));

test('existing encrypted Drive envelopes and new exports are mutually compatible', async () => {
  const key = await encryptionKey(raw);
  const data = { schema: 13, title: 'Grüße 😸', mail: '<style>p{color:red}</style>Heute um 17 Uhr', image: 'x'.repeat(2 * 1024 * 1024) };
  const iv = new Uint8Array(12).fill(17);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(data)));
  const oldEnvelope = JSON.stringify({ version: 1, iv: legacyEncode(iv), cipher: legacyEncode(cipher) });
  assert.deepEqual(await decrypt(oldEnvelope, key), data);

  const encoded = await encrypt(data, key);
  const envelope = JSON.parse(encoded);
  assert.equal(envelope.version, 1);
  assert.equal(legacyDecode(envelope.iv).length, 12);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: legacyDecode(envelope.iv) }, key, legacyDecode(envelope.cipher));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plain)), data);
  assert.deepEqual(await decrypt(encoded, key), data);
  assert.notEqual(JSON.parse(await encrypt(data, key)).iv, envelope.iv, 'Each encryption uses a fresh IV.');
});

test('wrong keys, altered ciphertext and unknown envelopes are rejected', async () => {
  const key = await encryptionKey(raw);
  const data = JSON.parse(await encrypt({ title: 'Test' }, key));
  const wrongKey = await encryptionKey(new Uint8Array(32));
  await assert.rejects(decrypt(JSON.stringify(data), wrongKey), /nicht entschlüsselt/);
  const changed = legacyDecode(data.cipher); changed[0] ^= 1;
  await assert.rejects(decrypt(JSON.stringify({ ...data, cipher: legacyEncode(changed) }), key), /nicht entschlüsselt/);
  await assert.rejects(decrypt(JSON.stringify({ ...data, cipher: '???' }), key), /nicht entschlüsselt/);
  await assert.rejects(decrypt(JSON.stringify({ ...data, version: 2 }), key), /Unbekanntes Cloud-Format/);
});
