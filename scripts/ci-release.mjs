// Release automation uses only Node's standard library. Build jobs have read-only
// repository access; only the isolated publication job receives a write token.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { appendFile, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyUpdate } from './verify-update.mjs';

export const repository = 'M10-Voxel/Journal-App';
const sourceBranch = 'refs/heads/WIP';
const componentLimit = 65535;
export function parseVersion(value) {
 if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)) return null;
 const parts = value.split('.').map(Number);
 return parts.every(part => part <= componentLimit) ? parts : null;
}
export function compareVersions(left, right) {
 const a = parseVersion(left), b = parseVersion(right);
 assert(a && b, 'Invalid Windows app version.');
 for (let index = 0; index < 3; index++) if (a[index] !== b[index]) return Math.sign(a[index] - b[index]);
 return 0;
}
export function nextVersion(base, releases) {
 assert(parseVersion(base), 'Invalid source version.');
 // Include reserved draft tags to avoid reusing the version of an interrupted run.
 const known = releases.filter(item => !item.prerelease).map(item => item.tag_name?.replace(/^v/, '')).filter(value => parseVersion(value));
 const highest = known.sort(compareVersions).at(-1);
 if (!highest || compareVersions(base, highest) > 0) return base;
 const parts = parseVersion(highest);
 for (let index = 2; index >= 0; index--) {
  if (parts[index] < componentLimit) { parts[index]++; return parts.join('.'); }
  parts[index] = 0;
 }
 throw new Error('Windows app version range exhausted.');
}
export function isPublishRun(env) {
 return env.GITHUB_REPOSITORY === repository && env.GITHUB_REF === sourceBranch && ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME);
}
function context(env) {
 assert(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA), 'Invalid build commit.');
 assert(/^\d+$/.test(env.GITHUB_RUN_ID), 'Invalid workflow run.');
 assert(/^\d+$/.test(env.GITHUB_RUN_ATTEMPT || '1'), 'Invalid workflow attempt.');
}
async function json(file) { return JSON.parse(await readFile(file, 'utf8')); }
async function writeJson(file, value) { await writeFile(file, JSON.stringify(value, null, 2) + '\n'); }
export async function setVersion(root, version) {
 assert(parseVersion(version), 'Invalid version.');
 const files = ['package.json', 'package-lock.json', 'src-tauri/tauri.conf.json'];
 const data = await Promise.all(files.map(file => json(join(root, file))));
 assert.equal(data[0].version, data[1].version, 'npm lockfile version differs.');
 assert.equal(data[0].version, data[1].packages[''].version, 'npm root package differs.');
 assert.equal(data[0].version, data[2].version, 'Tauri version differs.');
 const cargoPath = join(root, 'src-tauri/Cargo.toml'), lockPath = join(root, 'src-tauri/Cargo.lock');
 const cargo = await readFile(cargoPath, 'utf8'), lock = await readFile(lockPath, 'utf8');
 const cargoPattern = /(^\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)("[^\n]*\n)/m;
 const lockPattern = /(^name = "journal-app"\r?\nversion = ")([^"]+)(")/m;
 assert(cargoPattern.test(cargo) && lockPattern.test(lock), 'Cargo package version not found.');
 assert.equal(cargoPattern.exec(cargo)[2], data[0].version, 'Cargo version differs.');
 assert.equal(lockPattern.exec(lock)[2], data[0].version, 'Cargo lockfile version differs.');
 for (const item of data) item.version = version;
 data[1].packages[''].version = version;
 // Callback replacements keep numeric versions separate from regex group numbers.
 await writeFile(cargoPath, cargo.replace(cargoPattern, (_, before, _old, after) => before + version + after));
 await writeFile(lockPath, lock.replace(lockPattern, (_, before, _old, after) => before + version + after));
 for (let index = 0; index < files.length; index++) await writeJson(join(root, files[index]), data[index]);
}

export class GitHub {
 constructor(token, fetcher = fetch) { assert(token, 'GitHub token is missing.'); this.token = token; this.fetcher = fetcher; }
 headers() { return {Authorization:`Bearer ${this.token}`, Accept:'application/vnd.github+json', 'X-GitHub-Api-Version':'2022-11-28', 'User-Agent':'Journal-CI'}; }
 async request(path, method = 'GET', body) {
  assert(path.startsWith('/') && !path.includes('://'));
  const response = await this.fetcher(`https://api.github.com/repos/${repository}${path}`, {method, headers:{...this.headers(), ...(body ? {'Content-Type':'application/json'} : {})}, body:body ? JSON.stringify(body) : undefined, redirect:'error', signal:AbortSignal.timeout(60000)});
  if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
  return response.status === 204 ? null : response.json();
 }
 async releases() {
  const result = [];
  for (let page = 1;; page++) {
   const items = await this.request(`/releases?per_page=100&page=${page}`);
   assert(Array.isArray(items), 'Invalid release list.'); result.push(...items);
   if (items.length < 100) return result;
  }
 }
 async upload(uploadUrl, file, name) {
  const url = new URL(uploadUrl.replace(/\{.*$/, ''));
  assert.equal(url.origin, 'https://uploads.github.com');
  assert(new RegExp(`^/repos/${repository}/releases/\\d+/assets$`).test(url.pathname), 'Invalid upload destination.');
  url.searchParams.set('name', name);
  const response = await this.fetcher(url, {method:'POST', headers:{...this.headers(), 'Content-Type':'application/octet-stream', 'Content-Length':String((await stat(file)).size)}, body:createReadStream(file), duplex:'half', redirect:'error', signal:AbortSignal.timeout(1200000)});
  if (!response.ok) throw new Error(`GitHub asset upload: HTTP ${response.status}`);
  return response.json();
 }
}
async function output(env, values) {
 if (env.GITHUB_OUTPUT) await appendFile(env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
 return values;
}
export async function prepare({root = process.cwd(), env = process.env, github} = {}) {
 context(env);
 const publish = isPublishRun(env), config = await json(join(root, 'package.json'));
 const releases = publish ? await github.releases() : [];
 const version = publish ? nextVersion(config.version, releases) : config.version;
 const notes_file = 'src-tauri/target/ci-release-notes.md';
 if (publish) {
  await setVersion(root, version);
  const previous = releases.filter(item => !item.draft && !item.prerelease && parseVersion(item.tag_name?.replace(/^v/, ''))).sort((a, b) => compareVersions(a.tag_name.replace(/^v/, ''), b.tag_name.replace(/^v/, ''))).at(-1);
  const range = previous ? [previous.tag_name + '..HEAD'] : [];
  let messages;
  try { messages = execFileSync('git', ['log', ...range, '-20', '--format=%s'], {cwd:root, encoding:'utf8', windowsHide:true}).trim(); }
  catch { messages = 'Journal aktualisiert'; }
  const notes = `Journal ${version}\n\n${messages.split(/\r?\n/).filter(Boolean).map(message => '- ' + message).join('\n')}\n\nAutomatischer Build aus WIP (${env.GITHUB_SHA.slice(0, 7)}).\n[Build ansehen](https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID})\n`;
  await mkdir(join(root, 'src-tauri/target'), {recursive:true}); await writeFile(join(root, notes_file), notes);
 }
 return output(env, {publish:String(publish), version, prefix:`Journal-${version}-${env.GITHUB_SHA.slice(0, 7)}`, notes_file});
}
export async function stage({root = process.cwd(), env = process.env} = {}) {
 context(env);
 const config = await json(join(root, 'src-tauri/tauri.conf.json'));
 const release = join(root, 'src-tauri/target/release'), signed = isPublishRun(env);
 const installer = `${config.productName}_${config.version}_x64-setup.exe`;
 const source = signed ? join(release, 'update') : join(release, 'bundle/nsis');
 const destination = join(env.RUNNER_TEMP || join(root, 'src-tauri/target'), `journal-downloads-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || '1'}`);
 const installerDirectory = join(destination, 'installer'), exeDirectory = join(destination, 'exe');
 await mkdir(installerDirectory, {recursive:true}); await mkdir(exeDirectory, {recursive:true});
 await copyFile(join(source, installer), join(installerDirectory, installer));
 if (signed) for (const name of [installer + '.sig', 'latest.json']) await copyFile(join(source, name), join(installerDirectory, name));
 await copyFile(join(release, 'journal-app.exe'), join(exeDirectory, 'journal-app.exe'));
 return output(env, {installer:installerDirectory, exe:exeDirectory});
}
async function digest(file) {
 const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk);
 return {size:(await stat(file)).size, digest:'sha256:' + hash.digest('hex')};
}
export async function publish({directory = 'src-tauri/target/release/update', root = process.cwd(), env = process.env, github} = {}) {
 assert(isPublishRun(env), 'Only trusted WIP builds may publish app updates.'); context(env);
 assert(parseVersion(env.RELEASE_VERSION), 'Missing build version.');
 const verified = await verifyUpdate(directory, {configPath:join(root, 'src-tauri/tauri.conf.json'), expectedVersion:env.RELEASE_VERSION});
 const {manifest, files} = verified, tag = 'v' + manifest.version;
 const releases = await github.releases();
 let release = releases.find(item => item.tag_name === tag);
 if (release) {
  assert.equal(release.target_commitish, env.GITHUB_SHA, 'Release tag belongs to another commit.');
  if (!release.draft) return output(env, {url:release.html_url, reused:'true'});
 }
 const published = releases.filter(item => !item.draft && !item.prerelease && parseVersion(item.tag_name?.replace(/^v/, '')));
 assert(published.every(item => compareVersions(manifest.version, item.tag_name.replace(/^v/, '')) > 0), 'A newer version is already published; refusing to replace the update source.');
 if (!release) release = await github.request('/releases', 'POST', {tag_name:tag, target_commitish:env.GITHUB_SHA, name:`Journal ${manifest.version}`, body:manifest.notes, draft:true, prerelease:false});
 assert(Number.isSafeInteger(release.id), 'Invalid release ID.');
 const expected = new Map();
 const existing = await github.request(`/releases/${release.id}/assets`);
 for (const name of files) {
  const file = join(verified.directory, name), checksum = await digest(file); expected.set(name, checksum);
  const old = existing.find(item => item.name === name);
  if (old && old.state === 'uploaded' && old.size === checksum.size && old.digest === checksum.digest) continue;
  if (old) { assert(Number.isSafeInteger(old.id)); await github.request(`/releases/assets/${old.id}`, 'DELETE'); }
  const uploaded = await github.upload(release.upload_url, file, name);
  assert.equal(uploaded.size, checksum.size, `Upload size mismatch: ${name}`);
  assert.equal(uploaded.digest, checksum.digest, `Upload SHA-256 mismatch: ${name}`);
 }
 const assets = await github.request(`/releases/${release.id}/assets`);
 assert.equal(assets.length, files.length, 'Unexpected release assets.');
 for (const name of files) {
  const asset = assets.find(item => item.name === name), checksum = expected.get(name);
  assert(asset && asset.state === 'uploaded' && asset.size === checksum.size && asset.digest === checksum.digest, `Incomplete upload: ${name}`);
 }
 release = await github.request(`/releases/${release.id}`, 'PATCH', {draft:false, prerelease:false, make_latest:'true'});
 return output(env, {url:release.html_url, reused:'false'});
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 const command = process.argv[2];
 const github = command === 'stage' ? undefined : new GitHub(process.env.GH_TOKEN);
 const result = command === 'prepare' ? await prepare({github}) : command === 'stage' ? await stage() : command === 'publish' ? await publish({github}) : assert.fail('Expected prepare, stage or publish.');
 console.log(JSON.stringify(result));
}
