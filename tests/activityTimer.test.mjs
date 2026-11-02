import test from 'node:test';
import assert from 'node:assert/strict';
import { elapsedTimer, pauseTimer, timerCalendarEntries } from '../src/activityTimer.ts';
import { moveActivity } from '../src/periodData.ts';
const timer=()=>({id:'session',tagId:'tag',elapsedMs:0,startedAt:1000,segments:[]});
test('pause and resume exclude paused time',()=>{
 const paused=pauseTimer(timer(),61000);
 assert.equal(paused.elapsedMs,60000);assert.equal(elapsedTimer(paused,90000),60000);
 const stopped=pauseTimer({...paused,startedAt:120000},180000);
 assert.equal(stopped.elapsedMs,120000);assert.deepEqual(stopped.segments,[{start:1000,end:61000},{start:120000,end:180000}]);
 assert.deepEqual(pauseTimer(stopped,240000),stopped);
});
test('sessions split midnight, round outward, and keep stable identities on retry',async()=>{
 const start=new Date(2026,10,2,23,59,45).getTime(),end=new Date(2026,10,3,0,1,5).getTime();
 const state={...timer(),startedAt:null,segments:[{start,end}]};
 const entries=await timerCalendarEntries(state,'Lesen','Notiz');
 assert.deepEqual(entries.map(item=>[item.date,item.entry.time,item.entry.end]),[['2026-11-02','23:59','24:00'],['2026-11-03','00:00','00:02']]);
 assert.deepEqual(entries,await timerCalendarEntries(state,'Lesen','Notiz'));
 assert.equal(entries[0].entry.showInJournal,false);assert.equal(entries[0].entry.tag,'tag');
});
test('short sessions remain visible and separate paused intervals stay separate',async()=>{
 const start=new Date(2026,10,2,12,0,10).getTime();
 const entries=await timerCalendarEntries({...timer(),startedAt:null,segments:[{start,end:start+100},{start:start+120000,end:start+130000}]},'Sport','');
 assert.equal(entries.length,2);assert.equal(entries[0].entry.end,'12:01');assert.notEqual(entries[0].entry.id,entries[1].entry.id);
});
test('activity reorder preserves identities and options',()=>{
 const defs=[{id:'a',trackTime:true},{id:'b',textField:true},{id:'c'}];
 const reordered=moveActivity(defs,'a','c');assert.deepEqual(reordered.map(d=>d.id),['b','c','a']);assert.equal(reordered[2],defs[0]);assert.deepEqual(defs.map(d=>d.id),['a','b','c']);
});
