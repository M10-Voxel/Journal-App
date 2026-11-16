import './calendar-native.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCalendar, importCalendar } from '../src/ical.ts';
import { readFileSync } from 'node:fs';
import { occurrencesAsync, withStartAsync, continuedAsync } from '../src/repeat.ts';
import { repeatChangeAsync } from '../src/planning.ts';

process.env.TZ = 'Europe/Berlin';
const entry = (extra = {}) => ({ id:'10000000-0000-4000-8000-000000000001', kind:'event', text:'Kaffee', done:false, cancelled:false, priority:false, ...extra });
const wrap = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const event = (uid, ...lines) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261030T120000Z', ...lines, 'END:VEVENT'].join('\r\n');

test('legacy import fixtures match through the frontend bridge',async()=>{
  const normalize=value=>Array.isArray(value) ? value.map(normalize) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).filter(([key])=>!['id','series','ics'].includes(key)).map(([key,value])=>[key,normalize(value)])) : value;
  const fixtures=JSON.parse(readFileSync(new URL('./fixtures/ical-import.json',import.meta.url),'utf8'));
  for(const fixture of fixtures){
    if(fixture.error) await assert.rejects(()=>importCalendar(fixture.content,fixture.year));
    else assert.deepEqual(normalize(await importCalendar(fixture.content,fixture.year)),normalize(fixture.expected));
  }
});

for (const fixture of JSON.parse(readFileSync(new URL('./fixtures/ical-export.json',import.meta.url),'utf8'))) {
  test('legacy export fixture preserves properties and Unicode text',async()=>{
    const unfold=s=>s.replace(/\r\n[ \t]/g,'');
    assert.equal(unfold(await exportCalendar(fixture.days,new Date(fixture.now))),unfold(fixture.content));
  });
}
test('UTC EXDATE excludes a timezone-specific occurrence',async()=>{
  const parsed=await importCalendar(wrap(event('utc-exdate','DTSTART;TZID=America/New_York:20261102T090000','RRULE:FREQ=DAILY;COUNT=3','EXDATE:20261103T140000Z')),2026);
  assert.deepEqual(parsed.entries.map(e=>e.date),['2026-11-02','2026-11-04']);
});
test('open-ended ICS previews stop at the requested limit',async()=>{
  const rule={start:'2026-11-02',unit:'day',every:1,ics:'BEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20261102\r\nRRULE:FREQ=DAILY\r\nEND:VEVENT'};
  assert.deepEqual(await occurrencesAsync(rule,'2026-11-02','9999-12-31',3),['2026-11-02','2026-11-03','2026-11-04']);
});

for (const fixture of JSON.parse(readFileSync(new URL('./fixtures/ical-special.json', import.meta.url),'utf8'))) {
  test(fixture.name, async () => {
    const result=await importCalendar(fixture.content,2026);
    assert.deepEqual(result.entries.map(({date,entry})=>[date,entry.time,entry.end]),fixture.schedule);
    const exported=await exportCalendar(result.entries.map(({date,entry})=>({date,title:'',entries:[entry]})));
    assert.deepEqual((await importCalendar(exported,2026)).entries.map(({date,entry})=>[date,entry.time,entry.end]),fixture.schedule);
  });
}
test('stored ICS rules can be previewed, continued and shifted through Rust', async()=>{
  const parsed=await importCalendar(wrap(event('stored','DTSTART;VALUE=DATE:20261102','RRULE:FREQ=WEEKLY;COUNT=4','EXDATE;VALUE=DATE:20261109')),2026);
  const rule=parsed.entries[0].entry.repeat.rule;
  assert.deepEqual(await occurrencesAsync(rule,'2026-11-01','2026-12-01'),['2026-11-02','2026-11-16','2026-11-23']);
  assert.deepEqual(await continuedAsync(rule,'2026-11-16'),rule);
  const moved=await withStartAsync(rule,'2026-11-03');
  assert.equal(moved.icsUid,undefined);
  assert.deepEqual(await occurrencesAsync(moved,'2026-11-01','2026-12-01'),['2026-11-03','2026-11-10','2026-11-17','2026-11-24']);
  const changed=await repeatChangeAsync(entry(), '2026-11-03',['2026-11-03'],{time:null,reminder:false},moved,'2026-11-01');
  assert.deepEqual(changed.repeat.dates,['2026-11-10','2026-11-17','2026-11-24']);
});

test('ICS round trip preserves local schedule, UUID, text, priority, task status and daily-note visibility', async () => {
  const text = '**Überraschung** 🎉, Kaffee; Tee\\Milch\nZweite Zeile\n' + 'Ä😀'.repeat(80);
  const original = entry({ kind:'task', text, description:'Details, mehrzeilig\nRaum 2; Unterlagen mitbringen 🎉', done:true, priority:true, reminder:true, time:'09:15', end:'10:30', showInJournal:false });
  const ics = await exportCalendar([{ date:'2026-10-30', title:'Privater Tagestitel', entries:[original, entry({ kind:'note' }), entry({ plan:{ targets:[] } })] }]);
  assert(!ics.includes('Privater Tagestitel'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  for (const line of ics.split('\r\n')) assert(Buffer.byteLength(line) <= 75, 'RFC folding counts UTF-8 bytes');
  const { entries, notices } = await importCalendar(ics, 2026);
  assert.deepEqual(entries, [{ date:'2026-10-30', entry:{ ...original, calendarUid:`${original.id}@journal.local`, plan:null } }]);
  assert.deepEqual(notices, []);
});

test('all-day exports have an exclusive next-day end, and point events keep no end', async () => {
  for (const extra of [{}, { time:'23:30', end:'24:00' }, { time:'14:00' }]) {
    const ics = await exportCalendar([{ date:'2026-12-31', title:'', entries:[entry(extra)] }]);
    const imported = (await importCalendar(ics)).entries;
    assert.equal(imported.length, 1);
    assert.equal(imported[0].date, '2026-12-31');
    assert.equal(imported[0].entry.time, extra.time ?? null);
    assert.equal(imported[0].entry.end, extra.end ?? null);
  }
});

test('multi-day and overnight events stay single entries with their original end', async () => {
  const allDay = await importCalendar(wrap(event('holiday', 'DTSTART;VALUE=DATE:20261030', 'DTEND;VALUE=DATE:20261102', 'SUMMARY:Urlaub')));
  assert.deepEqual(allDay.entries.map(e => e.date), ['2026-10-30']);
  assert.equal(new Set(allDay.entries.map(e => e.entry.calendarUid)).size, 1);
  assert(allDay.entries.every(e => e.entry.time === '00:00'));
  assert.equal(allDay.notices.length, 0);
  const overnight = await importCalendar(wrap(event('night', 'DTSTART:20260131T220000Z', 'DTEND:20260201T010000Z', 'SUMMARY:Nachtschicht')));
  assert.deepEqual(overnight.entries.map(({ date, entry }) => [date, entry.time, entry.end]), [['2026-01-31','23:00','26:00']]);
});

test('IANA timezone identifiers without VTIMEZONE convert into local time', async () => {
  const result = await importCalendar(wrap(event('new-york', 'DTSTART;TZID=America/New_York:20261030T090000', 'DTEND;TZID=America/New_York:20261030T100000', 'SUMMARY:Meeting')));
  assert.equal(result.entries[0].entry.time, '14:00');
  assert.equal(result.entries[0].entry.end, '15:00');
  const point = await importCalendar(wrap(event('point', 'DTSTART;TZID=America/New_York:20261030T090000', 'SUMMARY:Point')));
  assert.equal(point.entries[0].entry.end, null);
  await assert.rejects(() => importCalendar(wrap(event('unknown', 'DTSTART;TZID=MadeUp/Zone:20261030T090000'))));
});

test('series respect exclusions and moved exceptions, with stable identities for repeat import', async () => {
  const ics = wrap(event('series', 'DTSTART:20261030T090000', 'DTEND:20261030T100000', 'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE:20261031T090000', 'SUMMARY:Meeting'),
    event('series', 'RECURRENCE-ID:20261101T090000', 'DTSTART:20261101T110000', 'DTEND:20261101T120000', 'SUMMARY:Verschoben'));
  const result = await importCalendar(ics, 2026);
  assert.deepEqual(result.entries.map(({ date, entry }) => [date, entry.time, entry.text]), [['2026-10-30','09:00','Meeting'],['2026-11-01','11:00','Verschoben'],['2026-11-02','09:00','Meeting']]);
  assert(result.notices.some(n => n.includes('2025 bis 2028')));
  assert.deepEqual(result.entries.map(e => e.entry.calendarUid), (await importCalendar(ics, 2026)).entries.map(e => e.entry.calendarUid));
});

test('folded external text, descriptions, location and dated VTODO are imported', async () => {
  const ics = wrap(event('external', 'DTSTART;VALUE=DATE:20261030', 'SUMMARY:Hallo\\, Welt', 'DESCRIPTION:Eine lange\r\n  Beschreibung\\nNeue Zeile', 'LOCATION:Büro\\; oben'),
    ['BEGIN:VTODO','UID:task','DUE;VALUE=DATE:20261031','SUMMARY:Abgeben','STATUS:COMPLETED','END:VTODO'].join('\r\n'));
  const result = (await importCalendar(ics)).entries;
  assert.equal(result[0].entry.text, 'Hallo, Welt');
  assert.equal(result[0].entry.description, 'Eine lange Beschreibung\nNeue Zeile\n\nOrt: Büro; oben');
  assert.equal(result[1].entry.kind, 'task');
  assert.equal(result[1].entry.done, true);
});

test('bad files, duplicate identities and dangerous-sized expansions fail before import', async () => {
  for (const ics of ['not a calendar', wrap(event('missing', 'SUMMARY:No date')), wrap(event('bad', 'DTSTART:20261030T100000', 'DTEND:20261030T090000')),
    wrap(event('dup', 'DTSTART;VALUE=DATE:20261030'), event('dup', 'DTSTART;VALUE=DATE:20261031')),
    wrap(event('hourly', 'DTSTART:20261030T090000','RRULE:FREQ=HOURLY'))]) await assert.rejects(() => importCalendar(ics));
});

test('an appointment past midnight exports with an end on the next day', async () => {
  const content = await exportCalendar([{ date:'2026-10-31', title:'', entries:[entry({ text:'Nachtschicht', time:'22:00', end:'26:30' })] }]);
  const imported = (await importCalendar(content, 2026)).entries.map(({ date, entry: item }) => [date, item.time, item.end]);
  assert.deepEqual(imported, [['2026-10-31', '22:00', '26:30']]);
});

test('imported series retain exclusions and recurrence logic for future occurrences',async()=>{
 const {occurrencesAsync}=await import('../src/repeat.ts');
 const parsed=await importCalendar(wrap(event('work','DTSTART:20261005T090000','DTEND:20261005T100000','RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6','EXDATE:20261007T090000','CATEGORIES:Arbeit','COLOR:#AEFF00')),2026);
 assert(parsed.entries.length>1);assert.equal(new Set(parsed.entries.map(item=>item.entry.repeat.series)).size,1);
 assert.deepEqual(await occurrencesAsync(parsed.entries[0].entry.repeat.rule,'2026-10-01','2026-11-01'),parsed.entries.map(item=>item.date));
 assert.equal(parsed.entries[0].tag.name,'Arbeit');assert.equal(parsed.entries[0].tag.color,'#AEFF00');
});
test('multi-day all-day import preserves the exclusive ICS end as one span',async()=>{
 const parsed=await importCalendar(wrap(event('trip','DTSTART;VALUE=DATE:20261030','DTEND;VALUE=DATE:20261102','SUMMARY:Trip')));
 assert.equal(parsed.entries.length,1);assert.equal(parsed.entries[0].entry.end,'72:00');
});

test('calendar names and colors supply reusable tag metadata',async()=>{
 const content=wrap(event('named','DTSTART;VALUE=DATE:20261103','SUMMARY:Meeting')).replace('VERSION:2.0','VERSION:2.0\r\nX-WR-CALNAME:Uni\r\nX-APPLE-CALENDAR-COLOR:#1A2B3CFF');
 const parsed=await importCalendar(content);assert.equal(parsed.entries[0].tag.name,'Uni');assert.equal(parsed.entries[0].tag.color,'#1A2B3C');
});

test('reminder lead time and icon round trip; a foreign alarm sets the lead time', async () => {
  const original = entry({ reminder:true, reminderBefore:90, icon:'graduation-cap', time:'10:00' });
  const ics = await exportCalendar([{ date:'2026-11-05', title:'', entries:[original] }]);
  assert(ics.includes('X-JOURNAL-REMINDER-BEFORE:90') && ics.includes('X-JOURNAL-ICON:graduation-cap'));
  const [{ entry: back }] = (await importCalendar(ics, 2026)).entries;
  assert.equal(back.reminderBefore, 90); assert.equal(back.icon, 'graduation-cap');
  const foreign = wrap(event('alarm@example.org', 'SUMMARY:Arzt', 'DTSTART:20261105T090000', 'DTEND:20261105T093000',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Arzt', 'END:VALARM', 'X-JOURNAL-ICON:Not Valid'));
  const [{ entry: alarm }] = (await importCalendar(foreign, 2026)).entries;
  assert.equal(alarm.reminder, true); assert.equal(alarm.reminderBefore, 15); assert.equal('icon' in alarm, false);
});
