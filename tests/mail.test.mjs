import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { latestMailCandidates, mailText, newMailAccount, recognizeMail } from '../src/mail.ts';

const today = '2026-10-30';
const account = { ...newMailAccount('custom'), id:'d5fd0501-3bda-440a-b401-69c6c4292684' };
const message = (change = {}) => ({ key:'imap:INBOX:20:12', subject:'Ihre Lieferung', sender:'Carrier <notify@carrier.example>', sentAt:+new Date('2026-10-30T12:00:00+01:00')/1000, text:'', html:'', calendars:[], ...change });
const recognize = change => recognizeMail({ account, message:message(change) }, today);
const modelSamples = JSON.parse(readFileSync(new URL('./fixtures/mail-ml-model-output.json',import.meta.url),'utf8'));

test('provider defaults keep Proton local and distinguish modern authentication', () => {
  assert.equal(newMailAccount('proton').host, '127.0.0.1');
  assert.equal(newMailAccount('proton').security, 'bridge');
  assert.equal(newMailAccount('gmail').protocol, 'gmail');
  assert.equal(newMailAccount('microsoft').protocol, 'microsoft');
});
test('delivery text yields a reviewable, calendar-only time window and stable retry identity', async () => {
  const sample = modelSamples.find(item => item.id === 'delivery');
  const pending = { account,message:message({subject:'',text:sample.text}) };
  const recognize = () => recognizeMail(pending,today,async text=>{assert.equal(text,sample.text);return sample;});
  const { candidates } = await recognize();
  assert.equal(candidates.length, 1);
  const entry = candidates[0];
  assert.equal(entry.entry.description, sample.text);
  assert.deepEqual([entry.date,entry.entry.time,entry.entry.end,entry.entry.showInJournal,entry.automatic], ['2026-11-12','10:00','12:00',false,false]);
  assert.equal((await recognize()).candidates[0].entry.id, entry.entry.id);
  assert.equal((await recognize()).candidates[0].id, entry.id);
});
test('mail descriptions preserve calendar details and omit quoted replies', async () => {
  const calendar = ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:details@example.org','DTSTART:20261031T110000','SUMMARY:Abholung','DESCRIPTION:Am Eingang','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const { candidates } = await recognize({ calendars:[calendar], text:'Das Paket enthält Schuhe.\n\nAm Montag schrieb jemand:\n> Alte Nachricht' });
  assert.equal(candidates[0].entry.description, 'Am Eingang\n\nDas Paket enthält Schuhe.');
});
test('free-text recognition never silently falls back to keyword rules without the model', async () => {
  await assert.rejects(recognize({ text:'Treffen morgen 17 Uhr' }),/ML-Modell/);
});
test('structured delivery updates share an identity across different emails', async () => {
  const parcel = date => `<script type="application/ld+json">${JSON.stringify({ '@context':'https://schema.org', '@type':'ParcelDelivery', trackingNumber:'TRACK123', expectedArrivalFrom:`${date}T10:00:00+01:00`, expectedArrivalUntil:`${date}T12:00:00+01:00` })}</script>`;
  const first = (await recognize({ html:parcel('2026-10-31') })).candidates[0];
  const next = (await recognize({ key:'imap:INBOX:20:13', sentAt:message().sentAt+100, html:parcel('2026-11-01') })).candidates[0];
  assert.equal(first.automatic, true);
  assert.equal(first.entry.calendarUid, next.entry.calendarUid);
  assert.equal(latestMailCandidates([first,next])[0].date, '2026-11-01');
});
test('ICS attachments preserve external identity, titles, times and do not re-enable journal visibility', async () => {
  const calendar = ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:appointment@example.org','DTSTART:20261031T110000','DTEND:20261031T120000','SUMMARY:Abholung','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const { candidates } = await recognize({ calendars:[calendar] });
  assert.equal(candidates.length, 1); assert.equal(candidates[0].entry.text, 'Abholung'); assert.equal(candidates[0].automatic, true);
  assert.equal(candidates[0].entry.showInJournal, false);
  assert.equal((await recognize({ key:'new-mail', calendars:[calendar] })).candidates[0].entry.calendarUid, candidates[0].entry.calendarUid);
  assert.notEqual((await recognizeMail({ account:{...account,id:'other-account'},message:message({ calendars:[calendar] }) }, today)).candidates[0].entry.calendarUid, candidates[0].entry.calendarUid);
});
test('cancellations become a notice rather than a new appointment', async () => {
  const result = await recognize({ subject:'Termin abgesagt',text:'Der Termin am 31.10.2026 wurde abgesagt.' });
  assert.equal(result.candidates.length, 0); assert.match(result.notice, /Absage/);
});
test('HTML stays plain text and does not treat scripts as instructions or mail contents', () => {
  assert.equal(mailText('<script>alert(1)</script><style>x{}</style><p>A &amp; B</p><img src="https://tracker.example"><p>&#x1F4E6;</p>'), 'A & B\n📦');
});
