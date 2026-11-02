import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractModelEvents, prepareMailText } from '../src/mailMl.ts';
import { newMailAccount, recognizeMail } from '../src/mail.ts';

// These are real outputs from the pinned GLiNER2.5 model, not hand-written predictions.
const samples = JSON.parse(readFileSync(new URL('./fixtures/mail-ml-model-output.json', import.meta.url),'utf8'));
const reference = +new Date('2026-10-31T12:00:00+01:00')/1000;
const result = id => extractModelEvents(samples.find(item=>item.id===id),'Nachricht',reference,'2026-10-31');

test('real ML output turns the exact user example into tomorrow at 17:00', async () => {
  const sample=samples.find(item=>item.id==='simple-relative');
  const pending={account:newMailAccount('custom'),message:{key:'example',subject:'',sender:'person@example.org',sentAt:reference,text:sample.text,html:'',calendars:[]}};
  const recognized=await recognizeMail(pending,'2026-10-31',async text=>{assert.equal(text,sample.text);return sample;});
  assert.equal(recognized.candidates.length,1);
  assert.deepEqual([recognized.candidates[0].entry.text,recognized.candidates[0].date,recognized.candidates[0].entry.time,recognized.candidates[0].automatic],['Treffen','2026-11-01','17:00',false]);
});
test('contextual spans support a message without event keywords and mentions across lines', () => {
  const plain=result('no-event-keyword').events[0];
  assert.deepEqual([plain.date,plain.time],['2026-11-12','17:30']);
  const multiline=result('split-lines').events[0];
  assert.deepEqual([multiline.date,multiline.time],['2026-11-02','17:00']);
  assert.match(multiline.text,/Bahnhof/);
});
test('model-selected delivery windows and multiple events retain their own times', () => {
  const delivery=result('delivery').events[0];
  assert.deepEqual([delivery.date,delivery.time,delivery.end],['2026-11-12','10:00','12:00']);
  assert.deepEqual(result('two-events').events.map(item=>[item.date,item.time]),[['2026-11-01','17:00'],['2026-11-02','10:00']]);
  assert(!result('two-events').events[1].text.includes('Café'), 'A place of the first event must not leak to the second.');
  assert.deepEqual(result('two-dates').events.map(item=>[item.date,item.time]),[['2026-11-12','17:00'],['2026-11-13','18:00']], 'A bare hour after a month name must not become a two-digit year.');
  assert.deepEqual(result('no-time').events.map(item=>[item.date,item.time]),[['2026-11-01',null]], 'An announced delivery without a known clock retains its date.');
  assert(result('no-time').notice, 'An unusable time span is explained in the review notice.');
});
test('cancellations, historical statements and non-specific weeks do not become new events', () => {
  for (const id of ['cancellation','past','invoice','hypothetical']) assert.equal(result(id).events.length,0,id);
});
test('quoted older relative dates are excluded from the model input', () => {
  const sample=samples.find(item=>item.id==='quoted-history');
  const prepared=prepareMailText('',sample.text);
  assert.match(prepared,/13\. November/); assert(!prepared.includes('morgen')); assert(!prepared.includes('30. Oktober'));
});
test('invalid model offsets are rejected, never used to create fabricated date or time values', () => {
  const sample=structuredClone(samples.find(item=>item.id==='simple-relative'));
  sample.mentions=sample.mentions.map(item=>({...item,start:-1}));
  assert.equal(extractModelEvents(sample,'',reference,'2026-10-31').events.length,0);
});

test('real ML outputs retain both ends of written clock ranges, including bare hours', () => {
  for (const sample of samples.filter(item => item.id.startsWith('range-'))) {
    const events = extractModelEvents(sample,'Nachricht',reference,'2026-10-31').events;
    assert.deepEqual(events.map(item=>[item.date,item.time,item.end]),[['2026-11-01','20:00',sample.id.includes('mixed') || ['range-uhr','range-between'].includes(sample.id) ? '21:20' : '20:15']],sample.id);
  }
});

test('clock range completion requires ML context and never joins alternative times', () => {
  const sample = structuredClone(samples.find(item=>item.id==='range-mixed'));
  sample.mentions = sample.mentions.filter(item=>item.field==='date');
  assert.equal(extractModelEvents(sample,'',reference,'2026-10-31').events[0].time,null, 'A date alone creates an all-day entry without interpreting the numeric range as a clock.');
  sample.text = 'Treffen morgen, die Kosten betragen 20 bis 21 Euro.';
  sample.mentions = [['event','Treffen'],['date','morgen']].map(([field,text])=>({field,text,start:sample.text.indexOf(text),end:sample.text.indexOf(text)+text.length,score:.99}));
  assert.equal(extractModelEvents(sample,'',reference,'2026-10-31').events[0].time,null, 'Unrelated numeric ranges do not become clocks.');
  sample.text = 'Treffen morgen 20:00 Uhr oder 20:15';
  sample.mentions = [['event','Treffen'],['date','morgen'],['time','20:00 Uhr'],['time','20:15']].map(([field,text])=>({field,text,start:sample.text.indexOf(text),end:sample.text.indexOf(text)+text.length,score:.99}));
  assert.equal(extractModelEvents(sample,'',reference,'2026-10-31').events[0].end,null, 'Alternatives do not express a duration.');
});
