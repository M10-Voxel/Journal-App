import test from 'node:test';
import assert from 'node:assert/strict';
import { ticketForEntry } from '../src/nebulaTickets.ts';
import { mailTagDefinitions } from '../src/mailTags.ts';

const entry = extra => ({ kind:'event', done:false, cancelled:false, ...extra });
const activities = new Set(['activity-reading']);

test('tickets distinguish visible events from calendar-only entries and activity time', () => {
  assert.equal(ticketForEntry(entry({}), [], activities)?.kind, 'event');
  assert.equal(ticketForEntry(entry({showInJournal:true}), [], activities)?.kind, 'event');
  assert.equal(ticketForEntry(entry({showInJournal:false}), [], activities), null);
  assert.equal(ticketForEntry(entry({tag:'activity-reading',showInJournal:false}), [], activities), null);
  assert.equal(ticketForEntry(entry({tag:'activity-reading',showInJournal:true}), [], activities), null);
  for (const kind of ['task','note']) assert.equal(ticketForEntry(entry({kind}), [], activities), null);
});

test('all three mail categories keep tickets for calendar-only entries and renamed tags', () => {
  for (const [kind, definition] of Object.entries(mailTagDefinitions)) {
    const tags = [{id:definition.id,name:'Renamed category',color:'#123456'}];
    assert.deepEqual(ticketForEntry(entry({tag:definition.id,showInJournal:false}), tags, activities), {kind,tag:'Renamed category'});
    for (const name of [definition.de,definition.en]) {
      assert.equal(ticketForEntry(entry({kind:'task',tag:'legacy',showInJournal:false}), [{id:'legacy',name,color:'#123456'}], activities)?.kind, kind);
    }
  }
});

test('finished entries and similarly named activities do not leak into tickets', () => {
  const tag = mailTagDefinitions.delivery.id;
  assert.equal(ticketForEntry(entry({tag,done:true}), [], activities), null);
  assert.equal(ticketForEntry(entry({tag,cancelled:true}), [], activities), null);
  assert.equal(ticketForEntry(entry({tag:'activity-reading'}), [{id:'activity-reading',name:'Delivery',color:'#123456'}], activities), null);
});
