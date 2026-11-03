import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarDaysWithSpans } from '../src/calendarSpans.ts';
const entry={id:'span',kind:'event',text:'Delivery',done:false,cancelled:false,priority:false,time:'00:00',end:'48:00',showInJournal:false};
test('continuations appear across month and year boundaries, preserving their edit origin',()=>{
 const days=new Map([['2026-12-31',{date:'2026-12-31',title:'',entries:[entry]}]]);
 const shown=calendarDaysWithSpans(days,'2027-01-01','2027-01-31');
 assert.equal(shown.get('2027-01-01').entries[0].spanOrigin,'2026-12-31');assert.equal(shown.has('2027-01-02'),false);
 assert.equal(days.size,1);assert.equal(entry.spanOrigin,undefined);
 const twice=calendarDaysWithSpans(shown,'2027-01-01','2027-01-31');assert.equal(twice.get('2027-01-01').entries.length,1);
});
