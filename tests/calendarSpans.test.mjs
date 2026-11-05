import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDaysWithSpans, calendarSpanLanes, calendarSpanSegment } from '../src/calendarSpans.ts';
const entry={id:'span',kind:'event',text:'Delivery',done:false,cancelled:false,priority:false,time:'00:00',end:'48:00',showInJournal:false};
test('continuations appear across month and year boundaries, preserving their edit origin',()=>{
 const days=new Map([['2026-12-31',{date:'2026-12-31',title:'',entries:[entry]}]]);
 const shown=calendarDaysWithSpans(days,'2027-01-01','2027-01-31');
 assert.equal(shown.get('2027-01-01').entries[0].spanOrigin,'2026-12-31');assert.equal(shown.has('2027-01-02'),false);
 assert.equal(days.size,1);assert.equal(entry.spanOrigin,undefined);
 const twice=calendarDaysWithSpans(shown,'2027-01-01','2027-01-31');assert.equal(twice.get('2027-01-01').entries.length,1);
});

test('overlapping spans retain stable lanes through week boundaries and reuse free lanes', () => {
 const days = new Map([
  ['2026-11-01', { entries: [{...entry,id:'long',end:'240:00'}, {...entry,id:'short',end:'72:00'}] }],
  ['2026-11-04', { entries: [{...entry,id:'later',end:'96:00'}] }],
 ]);
 const shown = calendarDaysWithSpans(days, '2026-11-01', '2026-11-15');
 const dates = Array.from({length:15},(_,i)=>`2026-11-${String(i+1).padStart(2,'0')}`);
 const spans = calendarSpanLanes(dates, date => shown.get(date)?.entries ?? []);
 assert.deepEqual(spans.map(span=>[span.entry.id,span.lane,span.start,span.end]),[
  ['long',0,'2026-11-01','2026-11-10'], ['short',1,'2026-11-01','2026-11-03'], ['later',1,'2026-11-04','2026-11-07'],
 ]);
 assert.deepEqual(calendarSpanSegment(spans[0], dates.slice(0,7)), {start:0,end:6,starts:true,ends:false});
 assert.deepEqual(calendarSpanSegment(spans[0], dates.slice(7,14)), {start:0,end:2,starts:false,ends:true});
 assert.equal(calendarSpanSegment(spans[1], dates.slice(7,14)), null);
});

test('spans beginning in the prior year keep their origin and midnight ends exclude the following day', () => {
 const shown=calendarDaysWithSpans(new Map([['2026-12-31',{entries:[entry]}]]),'2027-01-01','2027-01-07');
 const spans=calendarSpanLanes(['2027-01-01','2027-01-02'],date=>shown.get(date)?.entries ?? []);
 assert.equal(spans.length,1);assert.equal(spans[0].start,'2026-12-31');assert.equal(spans[0].end,'2027-01-01');
 assert.deepEqual(calendarSpanSegment(spans[0],['2027-01-01','2027-01-02']),{start:0,end:0,starts:false,ends:true});
 assert.deepEqual(calendarSpanLanes(['2027-01-01'],()=>[]),[]);
});
