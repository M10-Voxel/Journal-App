import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GitHub, compareVersions, isPublishRun, nextVersion, parseVersion, prepare, publish, repository, setVersion, stage } from '../scripts/ci-release.mjs';
import { verifyUpdate } from '../scripts/verify-update.mjs';

const env = {GITHUB_REPOSITORY:repository, GITHUB_REF:'refs/heads/Windows', GITHUB_EVENT_NAME:'push', GITHUB_SHA:'a'.repeat(40), GITHUB_RUN_ID:'12345', GITHUB_RUN_ATTEMPT:'1', RELEASE_VERSION:'0.1.2'};
const release = (version, extra = {}) => ({tag_name:'v' + version, draft:false, prerelease:false, ...extra});
async function temporary(t) { const root = await mkdtemp(join(tmpdir(), 'journal-release-test-')); t.after(() => rm(root, {recursive:true, force:true})); return root; }
async function versionFixture(t) {
 const root = await temporary(t); await mkdir(join(root, 'src-tauri'), {recursive:true});
 const version = '0.1.1';
 for (const [path, value] of [['package.json',{version}], ['package-lock.json',{version,packages:{'':{version},dep:{version:'3.2.1'}}}], ['src-tauri/tauri.conf.json',{version,productName:'Journal'}]]) await writeFile(join(root,path),JSON.stringify(value));
 await writeFile(join(root,'src-tauri/Cargo.toml'),'[package]\r\nname = "journal-app"\r\nversion = "0.1.1"\r\n[dependencies]\r\nexample = "2"\r\n');
 await writeFile(join(root,'src-tauri/Cargo.lock'),'[[package]]\nname = "dependency"\nversion = "2.0.0"\n[[package]]\nname = "journal-app"\nversion = "0.1.1"\n');
 return root;
}
async function signedFixture(t) {
 const root = await temporary(t), directory = join(root,'src-tauri/target/release/update'); await mkdir(directory,{recursive:true});
 const {publicKey,privateKey} = generateKeyPairSync('ed25519'), id = Buffer.from('12345678'), version = env.RELEASE_VERSION;
 const publicPacket = Buffer.concat([Buffer.from('Ed'),id,publicKey.export({format:'der',type:'spki'}).subarray(-32)]);
 const config = {version:'0.1.1',productName:'Journal',plugins:{updater:{pubkey:Buffer.from('untrusted comment: test public key\n'+publicPacket.toString('base64')+'\n').toString('base64')}}};
 await writeFile(join(root,'src-tauri/tauri.conf.json'),JSON.stringify(config));
 const name = `Journal_${version}_x64-setup.exe`, bytes = Buffer.from('synthetic installer'), hash = createHash('blake2b512').update(bytes).digest();
 const signature = sign(null,hash,privateKey), packet = Buffer.concat([Buffer.from('ED'),id,signature]);
 const comment = `timestamp:1\tfile:${name}\tversion:${version}`;
 const global = sign(null,Buffer.concat([signature,Buffer.from(comment)]),privateKey);
 const text = Buffer.from(`untrusted comment: test signature\n${packet.toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`).toString('base64');
 const manifest = {version,notes:'Test update',pub_date:'2026-11-07T00:00:00Z',platforms:{'windows-x86_64':{signature:text,url:`https://github.com/${repository}/releases/download/v${version}/${name}`}}};
 await writeFile(join(directory,name),bytes); await writeFile(join(directory,name+'.sig'),text); await writeFile(join(directory,'latest.json'),JSON.stringify(manifest)); await writeFile(join(directory,'journal-app.exe'),'synthetic exe');
 return {root,directory,name,manifest};
}
function githubFixture({releases = [], badDigest = false, oldAssets = []} = {}) {
 const calls = [], assets = [...oldAssets];
 const draft = {id:10,draft:true,tag_name:'v0.1.2',target_commitish:env.GITHUB_SHA,upload_url:`https://uploads.github.com/repos/${repository}/releases/10/assets{?name,label}`,html_url:'https://github.com/'+repository+'/releases/tag/v0.1.2'};
 const github = {
  releases:async()=>releases,
  request:async(path,method='GET',body)=>{
   calls.push({path,method,body});
   if(path==='/releases'&&method==='POST')return draft;
   if(path==='/releases/10/assets')return structuredClone(assets);
   if(method==='DELETE'){const index=assets.findIndex(a=>path.endsWith('/'+a.id));assert(index>=0);assets.splice(index,1);return null;}
   if(path==='/releases/10'&&method==='PATCH')return {...draft,draft:false};
   throw new Error('Unexpected test API request');
  },
  upload:async(_url,path,name)=>{
   const bytes=await readFile(path),item={id:100+assets.length,name,size:bytes.length,digest:badDigest?'sha256:wrong':'sha256:'+createHash('sha256').update(bytes).digest('hex'),state:'uploaded'};
   assets.push(item);return item;
  }
 };
 return {github,calls,assets,draft};
}

test('automatic versions advance across releases, reserved drafts and Windows component limits',()=>{
 assert.equal(nextVersion('0.1.1',[release('0.1.1')]),'0.1.2');
 assert.equal(nextVersion('0.1.1',[release('0.1.3'),release('0.1.4',{draft:true})]),'0.1.5');
 assert.equal(nextVersion('0.2.0',[release('0.1.9')]),'0.2.0');
 assert.equal(nextVersion('0.1.1',[release('0.2.0',{prerelease:true})]),'0.1.1');
 assert.equal(nextVersion('0.1.1',[release('1.2.65535')]),'1.3.0');
 assert.equal(nextVersion('0.1.1',[release('1.65535.65535')]),'2.0.0');
 assert.throws(()=>nextVersion('0.1.1',[release('65535.65535.65535')]));
 for(const bad of ['1.2.3-beta','01.2.3','1.2.65536','../1.2.3','1.2'])assert.equal(parseVersion(bad),null);
 assert(compareVersions('0.1.10','0.1.9')>0);
});
test('only push or manual builds of the original Windows branch may sign and publish',()=>{
 assert(isPublishRun(env));assert(isPublishRun({...env,GITHUB_EVENT_NAME:'workflow_dispatch'}));
 for(const other of [{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'pull_request_target'},{GITHUB_REF:'refs/heads/test'},{GITHUB_REF:'refs/heads/WIP'},{GITHUB_REF:'refs/heads/android'},{GITHUB_REPOSITORY:'fork/Journal-App'}])assert(!isPublishRun({...env,...other}));
});
test('version preparation updates every package version while preserving dependency versions and Cargo syntax',async t=>{
 const root=await versionFixture(t);await setVersion(root,'0.1.12');
 for(const path of ['package.json','package-lock.json','src-tauri/tauri.conf.json'])assert.equal(JSON.parse(await readFile(join(root,path),'utf8')).version,'0.1.12');
 const lock=JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));assert.equal(lock.packages[''].version,'0.1.12');assert.equal(lock.packages.dep.version,'3.2.1');
 assert.match(await readFile(join(root,'src-tauri/Cargo.toml'),'utf8'),/name = "journal-app"\r\nversion = "0.1.12"\r\n/);
 assert.match(await readFile(join(root,'src-tauri/Cargo.lock'),'utf8'),/name = "dependency"\nversion = "2.0.0"/);
 assert.match(await readFile(join(root,'src-tauri/Cargo.lock'),'utf8'),/name = "journal-app"\nversion = "0.1.12"/);
});
test('PR builds never query releases or change the source version',async t=>{
 const root=await versionFixture(t);const result=await prepare({root,env:{...env,GITHUB_EVENT_NAME:'pull_request'},github:{releases:()=>assert.fail('PR must not query releases')}});
 assert.equal(result.publish,'false');assert.equal(result.version,'0.1.1');
 assert.equal(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,'0.1.1');
});
test('trusted build preparation selects a newer version and emits matching download metadata',async t=>{
 const root=await versionFixture(t),output=join(root,'workflow-output');
 const result=await prepare({root,env:{...env,GITHUB_OUTPUT:output},github:{releases:async()=>[release('0.1.1')]}});
 assert.equal(result.publish,'true');assert.equal(result.version,'0.1.2');assert.equal(result.prefix,'Journal-0.1.2-aaaaaaa');
 assert.equal(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,'0.1.2');
 assert.match(await readFile(join(root,result.notes_file),'utf8'),/Journal 0.1.2/);
 assert.match(await readFile(output,'utf8'),/publish=true\nversion=0.1.2\n/);
});
test('inconsistent version files fail before changes are written',async t=>{
 const root=await versionFixture(t);await writeFile(join(root,'src-tauri/Cargo.toml'),'[package]\nname = "journal-app"\nversion = "0.0.1"\n');
 await assert.rejects(setVersion(root,'0.1.2'),/Cargo version differs/);
 assert.equal(JSON.parse(await readFile(join(root,'package.json'),'utf8')).version,'0.1.1');
});
test('update verification binds installer bytes and the trusted version comment to the installed public key',async t=>{
 const fixture=await signedFixture(t),options={configPath:join(fixture.root,'src-tauri/tauri.conf.json'),expectedVersion:'0.1.2'};
 await verifyUpdate(fixture.directory,options);
 await assert.rejects(verifyUpdate(fixture.directory,{...options,expectedVersion:'0.1.3'}));
 await writeFile(join(fixture.directory,fixture.name),'tampered installer');
 await assert.rejects(verifyUpdate(fixture.directory,options),/signature verification failed/);
});
test('publication remains a draft until all four uploads match their SHA-256 digests',async t=>{
 const fixture=await signedFixture(t),mock=githubFixture();
 const result=await publish({...fixture,env,github:mock.github});
 assert.equal(result.reused,'false');assert.equal(mock.assets.length,4);
 assert.equal(mock.calls[0].body.draft,true);assert.equal(mock.calls.at(-1).body.draft,false);assert.equal(mock.calls.at(-1).body.make_latest,'true');
});
test('an incorrect uploaded digest prevents release publication',async t=>{
 const fixture=await signedFixture(t),mock=githubFixture({badDigest:true});
 await assert.rejects(publish({...fixture,env,github:mock.github}),/SHA-256 mismatch/);
 assert(!mock.calls.some(c=>c.method==='PATCH'));
});
test('a stale build cannot replace a newer published app update',async t=>{
 const fixture=await signedFixture(t),mock=githubFixture({releases:[release('0.1.3')]});
 await assert.rejects(publish({...fixture,env,github:mock.github}),/newer version/);assert.equal(mock.calls.length,0);
});
test('retries can resume their own draft but do not replace public releases or other commits',async t=>{
 const fixture=await signedFixture(t),mock=githubFixture({oldAssets:[{id:900,name:fixture.name,size:1,digest:'wrong',state:'uploaded'}]});mock.github.releases=async()=>[mock.draft];
 await publish({...fixture,env,github:mock.github});assert(mock.calls.some(c=>c.method==='DELETE'));assert(!mock.calls.some(c=>c.path==='/releases'&&c.method==='POST'));
 const existing=githubFixture({releases:[release('0.1.2',{target_commitish:env.GITHUB_SHA,html_url:'existing'})]});
 assert.equal((await publish({...fixture,env,github:existing.github})).reused,'true');assert.equal(existing.calls.length,0);
 existing.github.releases=async()=>[release('0.1.2',{target_commitish:'b'.repeat(40)})];
 await assert.rejects(publish({...fixture,env,github:existing.github}),/another commit/);
});
test('untrusted publication contexts fail before accessing files or GitHub',async()=>{
 await assert.rejects(publish({env:{...env,GITHUB_EVENT_NAME:'pull_request'},github:{releases:()=>assert.fail()}}),/trusted Windows/);
});
test('Android builds cannot allocate Windows versions or publish Windows updates',async t=>{
 const root=await versionFixture(t);
 for(const event of ['push','workflow_dispatch']){
  const android={...env,GITHUB_REF:'refs/heads/android',GITHUB_EVENT_NAME:event};
  const github={releases:()=>assert.fail('Android must not query the Windows release channel')};
  const result=await prepare({root,env:android,github});
  assert.equal(result.publish,'false');assert.equal(result.version,'0.1.1');
  await assert.rejects(publish({root,env:android,github}),/trusted Windows/);
 }
 assert.equal(nextVersion('0.1.1',[release('0.1.2'),{tag_name:'android-v999.0.0',prerelease:false}]),'0.1.3');
 const fixture=await signedFixture(t),mock=githubFixture({releases:[{tag_name:'android-v999.0.0',prerelease:false,draft:false}]});
 await publish({...fixture,env,github:mock.github});
 assert(mock.calls.some(call=>call.method==='PATCH'));
});
test('upload tokens cannot be sent to another host or repository',async()=>{
 const github=new GitHub('test-token',()=>assert.fail('No request may be sent'));
 await assert.rejects(github.upload('https://attacker.example/assets','unused','file'));
 await assert.rejects(github.upload('https://uploads.github.com/repos/other/repo/releases/10/assets','unused','file'));
});
test('unsigned artifact staging includes only this installer, without cached older updates or signatures',async t=>{
 const root=await versionFixture(t),releasePath=join(root,'src-tauri/target/release');await mkdir(join(releasePath,'bundle/nsis'),{recursive:true});
 await writeFile(join(releasePath,'bundle/nsis/Journal_0.1.1_x64-setup.exe'),'current');await writeFile(join(releasePath,'bundle/nsis/Journal_0.1.0_x64-setup.exe'),'old');await writeFile(join(releasePath,'bundle/nsis/Journal_0.1.1_x64-setup.exe.sig'),'cached signature');await writeFile(join(releasePath,'journal-app.exe'),'exe');
 const result=await stage({root,env:{...env,GITHUB_REF:'refs/heads/test'}});
 const {readdir}=await import('node:fs/promises');assert.deepEqual(await readdir(result.installer),['Journal_0.1.1_x64-setup.exe']);assert.deepEqual(await readdir(result.exe),['journal-app.exe']);
});
