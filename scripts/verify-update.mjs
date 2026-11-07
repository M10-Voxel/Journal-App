// Verify the packaged update against the same public key embedded in the app.
// No private signing material is read by this check.
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

const directory = resolve(process.argv[2] || 'src-tauri/target/release/update');
const config = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const manifest = JSON.parse(await readFile(join(directory, 'latest.json'), 'utf8'));
assert.equal(manifest.version, config.version, 'The manifest must match the app version.');
assert.equal(typeof manifest.notes, 'string', 'Release notes must be plain text.');
assert(Number.isFinite(Date.parse(manifest.pub_date)), 'A valid publication date is required.');
const platform = manifest.platforms['windows-x86_64'];
const download = new URL(platform.url);
assert.equal(download.origin, 'https://github.com');
assert(download.pathname.startsWith(`/M10-Voxel/Journal-App/releases/download/v${manifest.version}/`));
const file = decodeURIComponent(basename(download.pathname));
assert.equal(basename(file), file);
const signature = (await readFile(join(directory, file + '.sig'), 'utf8')).trim();
assert.equal(platform.signature, signature, 'Manifest and detached signature must match.');

const keyLines = Buffer.from(config.plugins.updater.pubkey, 'base64').toString('utf8').trim().split(/\r?\n/);
const publicKey = Buffer.from(keyLines[1], 'base64');
assert.equal(publicKey.length, 42);
const lines = Buffer.from(signature, 'base64').toString('utf8').trim().split(/\r?\n/);
assert.equal(lines.length, 4);
const signed = Buffer.from(lines[1], 'base64');
assert.equal(signed.length, 74);
assert.equal(signed.subarray(0, 2).toString('ascii'), 'ED', 'Require a prehashed Minisign signature.');
assert.deepEqual(signed.subarray(2, 10), publicKey.subarray(2, 10), 'Signature key ID must match the installed public key.');
assert(lines[2].startsWith('trusted comment: '));
const comment = lines[2].slice('trusted comment: '.length);
assert(comment.split(/\s+/).includes('version:' + manifest.version), 'The signed comment must authenticate the app version.');
const key = createPublicKey({ key:Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey.subarray(10)]), format:'der', type:'spki' });
const hash = createHash('blake2b512');
for await (const chunk of createReadStream(join(directory, file))) hash.update(chunk);
assert(verify(null, hash.digest(), key, signed.subarray(10)), 'Installer signature verification failed.');
assert(verify(null, Buffer.concat([signed.subarray(10), Buffer.from(comment)]), key, Buffer.from(lines[3], 'base64')), 'Signed version comment verification failed.');
console.log(`Verified Journal ${manifest.version}: installer signature, signed version, public key and manifest.`);
