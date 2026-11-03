import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDeviceKey } from '../src/sync/deviceKey.ts';

const bytes=Uint8Array.from({length:32},(_,i)=>(i*7+135)%256);
const key=btoa(String.fromCharCode(...bytes));
test('the generated key keeps exactly the same bytes and vault hash after paste formatting',async()=>{
  const hash=async b=>Buffer.from(await crypto.subtle.digest('SHA-256',b)).toString('hex');
  for(const value of [key,` \n${key.slice(0,20)}\r\n${key.slice(20)}\u200B`,key.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')]){
    assert.deepEqual(parseDeviceKey(value),bytes);
    assert.equal(await hash(parseDeviceKey(value)),await hash(bytes));
  }
});
test('passwords, truncated keys and invalid encodings have an actionable error instead of atob',()=>{
  for(const value of ['', 'my password', 'Google.apps.googleusercontent.com',key.slice(0,40),key+'=', 'A'.repeat(42)+'B=',key.slice(0,12)+'!'+key.slice(13),'🔑'.repeat(22)]){
    assert.throws(()=>parseDeviceKey(value),/Ungültiger Geräteschlüssel/);
    assert.throws(()=>parseDeviceKey(value,true),/Invalid device key/);
  }
});
