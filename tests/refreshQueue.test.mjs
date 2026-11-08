import test from 'node:test';
import assert from 'node:assert/strict';
import { createRefreshQueue } from '../src/refreshQueue.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject};};

test('refresh bursts stay single-flight and superseded data never reaches the UI',async()=>{
  const pending=[],applied=[],errors=[];let active=0,maximum=0;
  const queue=createRefreshQueue(()=>{const p=deferred();pending.push(p);maximum=Math.max(maximum,++active);return p.promise.finally(()=>active--);},value=>applied.push(value),e=>errors.push(e));
  const done=queue.request();for(let i=0;i<40;i++)void queue.request();
  assert.equal(pending.length,1);pending[0].resolve('stale');
  await new Promise(resolve=>setImmediate(resolve));assert.equal(pending.length,2);assert.deepEqual(applied,[]);
  pending[1].resolve('current');await done;assert.equal(maximum,1);assert.deepEqual(applied,['current']);assert.deepEqual(errors,[]);
});

test('errors can be retried and disposed views receive no callbacks or extra requests',async()=>{
  const pending=[],applied=[],errors=[];const queue=createRefreshQueue(()=>{const p=deferred();pending.push(p);return p.promise;},value=>applied.push(value),e=>errors.push(e));
  const first=queue.request();pending[0].reject('offline');await first;assert.deepEqual(errors,['offline']);
  const retry=queue.request();void queue.request();queue.dispose();pending[1].resolve('closed view');await retry;await queue.request();
  assert.equal(pending.length,2);assert.deepEqual(applied,[]);
});

test('a failed superseded read does not overwrite the next successful refresh with an error',async()=>{
  const pending=[],applied=[],errors=[];const queue=createRefreshQueue(()=>{const p=deferred();pending.push(p);return p.promise;},v=>applied.push(v),e=>errors.push(e));
  const done=queue.request();void queue.request();pending[0].reject('old failure');await new Promise(resolve=>setImmediate(resolve));pending[1].resolve('recovered');await done;
  assert.deepEqual(errors,[]);assert.deepEqual(applied,['recovered']);
});
