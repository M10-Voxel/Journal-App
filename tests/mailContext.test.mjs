import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { newMailAccount, recognizeMail, deliveryWorkdayWindow } from '../src/mail.ts';
import { extractModelEvents } from '../src/mailMl.ts';
import { mailSentences } from '../src/mailSentences.ts';
import { setLanguage } from '../src/i18n.ts';

const read = name => JSON.parse(readFileSync(new URL(name,import.meta.url),'utf8'));
const cases=[...read('../tools/mail-ml-probe/context-cases.json'),...read('../tools/mail-ml-probe/context-challenge.json')];
const fixture=read('./fixtures/mail-context-model-output.json');
const predictions=new Map(fixture.cases.map(row=>[row.id,row.analysis]));
const reference=+new Date('2026-11-09T08:30:00+01:00')/1000;
const account=newMailAccount('custom');
for(const sample of cases) test(`mail sentence context: ${sample.id}`,async()=>{
  const result=await recognizeMail({account,message:{key:sample.id,subject:sample.subject,sender:'synthetic@example.org',sentAt:reference,text:sample.text,html:'',calendars:[]}},'2026-11-09',async text=>{
    const analysis=predictions.get(sample.id);assert(analysis, 'A real captured model output must exist');assert.equal(analysis.text,text);return analysis;
  });
  assert.deepEqual(result.candidates.map(c=>[c.date,c.entry.time,c.entry.end]),sample.expected);
});
test('German and English mail normalization is independent of application display language',()=>{
  try {
    setLanguage('en');
    const sample=cases.find(c=>c.id==='delivery-today-between');
    const actual=extractModelEvents(predictions.get(sample.id),sample.subject,reference,'2026-11-09');
    assert.deepEqual(actual.events.map(e=>[e.date,e.time,e.end]),sample.expected);
  } finally {setLanguage('de');}
});
test('paragraph and table continuations retain exact offsets and separate service sentences',()=>{
  const text='Lieferung\n\nVoraussichtliche Zustellung\nMorgen\n12:00–14:00 Uhr\n\nUnser Support ist morgen von 8 bis 18 Uhr erreichbar.';
  const sentences=mailSentences(text,'Lieferung');
  assert(sentences.some(s=>s.text.includes('Morgen\n12:00')));
  assert(sentences.every(s=>text.slice(s.start,s.end)===s.text));
  assert(sentences.find(s=>s.text.includes('Support')).score<.2);
});
test('low-confidence neural spans may be recovered by the trained sentence model',()=>{
  const sample=cases.find(c=>c.id==='delivery-today-between'),analysis=structuredClone(predictions.get(sample.id));
  analysis.mentions=analysis.mentions.map(m=>({...m,score:.1}));
  assert.deepEqual(extractModelEvents(analysis,sample.subject,reference,'2026-11-09').events.map(e=>[e.date,e.time,e.end]),sample.expected);
});
test('business-day reply and return durations never inherit delivery context from a subject',()=>{
  for(const text of ['Ihre Support-Anfrage beantworten wir innerhalb von 1 bis 2 Werktagen.','Für die Beantwortung Ihres Tickets benötigen wir 2 bis 3 Werktage.','Für Retouren rechnen Sie mit 1 bis 2 Werktagen.'])assert.equal(deliveryWorkdayWindow('Ihr Paket ist unterwegs',text,reference),null);
});
test('the shipped classifier records its training data and independent template split',()=>{
  const model=read('../src/mailContextModel.json'),report=read('../tools/mail-ml-probe/context-training-report.json');
  assert.equal(model.sourceSha256,createHash('sha256').update(readFileSync(new URL('../tools/mail-ml-probe/context-training.json',import.meta.url),'utf8').replace(/\r\n/g,'\n')).digest('hex'));
  assert.equal(model.sourceSha256,report.sourceSha256);
  assert(report.templates.train>200);assert(report.templates.validation>=14);assert(report.templates.test>=14);
  assert(model.threshold>=.25&&model.threshold<=.75);
});
