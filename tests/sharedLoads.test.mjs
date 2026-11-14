import test from 'node:test';
import assert from 'node:assert/strict';
import {createSharedLoads} from '../src/sharedLoads.ts';

test('simultaneous image consumers share one load; closing the last releases the cache',async()=>{
 let reads=0;
 const loads=createSharedLoads(async key=>{reads++;return {key,bytes:'image data'};});
 const first=loads.acquire('a'),second=loads.acquire('a');
 assert.equal(first.promise,second.promise);
 assert.equal(await first.promise,await second.promise);assert.equal(reads,1);
 first.release();first.release();
 const third=loads.acquire('a');assert.equal(third.promise,second.promise);
 second.release();third.release();
 const next=loads.acquire('a');assert.notEqual(next.promise,first.promise);
 await next.promise;assert.equal(reads,2);next.release();
});

test('releasing an in-flight request cannot remove a new consumer of the same asset',async()=>{
 const pending=[];const loads=createSharedLoads(()=>new Promise(resolve=>pending.push(resolve)));
 const old=loads.acquire('a');await Promise.resolve();old.release();
 const current=loads.acquire('a');await Promise.resolve();
 pending[0]('old');await old.promise;old.release();
 const additional=loads.acquire('a');assert.equal(additional.promise,current.promise);
 pending[1]('new');assert.equal(await additional.promise,'new');current.release();additional.release();
});

test('a failed image is not kept after its views close',async()=>{
 let reads=0;const loads=createSharedLoads(async()=>{if(++reads===1)throw Error('unavailable');return 'restored';});
 const first=loads.acquire('a');await assert.rejects(first.promise,/unavailable/);first.release();
 const retry=loads.acquire('a');assert.equal(await retry.promise,'restored');retry.release();
});
