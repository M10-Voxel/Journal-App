import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCalendar, importCalendar } from '../src/ical.ts';

process.env.TZ = 'Europe/Berlin';
const entry = (extra = {}) => ({ id:'10000000-0000-4000-8000-000000000001', kind:'event', text:'Kaffee', done:false, cancelled:false, priority:false, ...extra });
const wrap = (...events) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Test//EN', ...events, 'END:VCALENDAR'].join('\r\n');
const event = (uid, ...lines) => ['BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20261030T120000Z', ...lines, 'END:VEVENT'].join('\r\n');

test('ICS round trip preserves local schedule, UUID, text, priority, task status and daily-note visibility', () => {
  const text = '**Überraschung** 🎉, Kaffee; Tee\\Milch\nZweite Zeile\n' + 'Ä😀'.repeat(80);
  const original = entry({ kind:'task', text, description:'Details, mehrzeilig\nRaum 2; Unterlagen mitbringen 🎉', done:true, priority:true, reminder:true, time:'09:15', end:'10:30', showInJournal:false });
  const ics = exportCalendar([{ date:'2026-10-30', title:'Privater Tagestitel', entries:[original, entry({ kind:'note' }), entry({ plan:{ targets:[] } })] }]);
  assert(!ics.includes('Privater Tagestitel'));
  assert.equal((ics.match(/BEGIN:VEVENT/g) ?? []).length, 1);
  for (const line of ics.split('\r\n')) assert(Buffer.byteLength(line) <= 75, 'RFC folding counts UTF-8 bytes');
  const { entries, notices } = importCalendar(ics, 2026);
  assert.deepEqual(entries, [{ date:'2026-10-30', entry:{ ...original, calendarUid:`${original.id}@journal.local`, plan:null } }]);
  assert.deepEqual(notices, []);
});

test('all-day exports have an exclusive next-day end, and point events keep no end', () => {
  for (const extra of [{}, { time:'23:30', end:'24:00' }, { time:'14:00' }]) {
    const ics = exportCalendar([{ date:'2026-12-31', title:'', entries:[entry(extra)] }]);
    const imported = importCalendar(ics).entries;
    assert.equal(imported.length, 1);
    assert.equal(imported[0].date, '2026-12-31');
    assert.equal(imported[0].entry.time, extra.time ?? null);
    assert.equal(imported[0].entry.end, extra.end ?? null);
  }
});

test('multi-day and overnight events stay single entries with their original end', () => {
  const allDay = importCalendar(wrap(event('holiday', 'DTSTART;VALUE=DATE:20261030', 'DTEND;VALUE=DATE:20261102', 'SUMMARY:Urlaub')));
  assert.deepEqual(allDay.entries.map(e => e.date), ['2026-10-30']);
  assert.equal(new Set(allDay.entries.map(e => e.entry.calendarUid)).size, 1);
  assert(allDay.entries.every(e => e.entry.time === '00:00'));
  assert.equal(allDay.notices.length, 0);
  const overnight = importCalendar(wrap(event('night', 'DTSTART:20260131T220000Z', 'DTEND:20260201T010000Z', 'SUMMARY:Nachtschicht')));
  assert.deepEqual(overnight.entries.map(({ date, entry }) => [date, entry.time, entry.end]), [['2026-01-31','23:00','26:00']]);
});

test('IANA timezone identifiers without VTIMEZONE convert into local time', () => {
  const result = importCalendar(wrap(event('new-york', 'DTSTART;TZID=America/New_York:20261030T090000', 'DTEND;TZID=America/New_York:20261030T100000', 'SUMMARY:Meeting')));
  assert.equal(result.entries[0].entry.time, '14:00');
  assert.equal(result.entries[0].entry.end, '15:00');
  const point = importCalendar(wrap(event('point', 'DTSTART;TZID=America/New_York:20261030T090000', 'SUMMARY:Point')));
  assert.equal(point.entries[0].entry.end, null);
  assert.throws(() => importCalendar(wrap(event('unknown', 'DTSTART;TZID=MadeUp/Zone:20261030T090000'))));
});

test('series respect exclusions and moved exceptions, with stable identities for repeat import', () => {
  const ics = wrap(event('series', 'DTSTART:20261030T090000', 'DTEND:20261030T100000', 'RRULE:FREQ=DAILY;COUNT=4', 'EXDATE:20261031T090000', 'SUMMARY:Meeting'),
    event('series', 'RECURRENCE-ID:20261101T090000', 'DTSTART:20261101T110000', 'DTEND:20261101T120000', 'SUMMARY:Verschoben'));
  const result = importCalendar(ics, 2026);
  assert.deepEqual(result.entries.map(({ date, entry }) => [date, entry.time, entry.text]), [['2026-10-30','09:00','Meeting'],['2026-11-01','11:00','Verschoben'],['2026-11-02','09:00','Meeting']]);
  assert(result.notices.some(n => n.includes('2025 bis 2028')));
  assert.deepEqual(result.entries.map(e => e.entry.calendarUid), importCalendar(ics, 2026).entries.map(e => e.entry.calendarUid));
});

test('folded external text, descriptions, location and dated VTODO are imported', () => {
  const ics = wrap(event('external', 'DTSTART;VALUE=DATE:20261030', 'SUMMARY:Hallo\\, Welt', 'DESCRIPTION:Eine lange\r\n  Beschreibung\\nNeue Zeile', 'LOCATION:Büro\\; oben'),
    ['BEGIN:VTODO','UID:task','DUE;VALUE=DATE:20261031','SUMMARY:Abgeben','STATUS:COMPLETED','END:VTODO'].join('\r\n'));
  const result = importCalendar(ics).entries;
  assert.equal(result[0].entry.text, 'Hallo, Welt');
  assert.equal(result[0].entry.description, 'Eine lange Beschreibung\nNeue Zeile\n\nOrt: Büro; oben');
  assert.equal(result[1].entry.kind, 'task');
  assert.equal(result[1].entry.done, true);
});

test('bad files, duplicate identities and dangerous-sized expansions fail before import', () => {
  for (const ics of ['not a calendar', wrap(event('missing', 'SUMMARY:No date')), wrap(event('bad', 'DTSTART:20261030T100000', 'DTEND:20261030T090000')),
    wrap(event('dup', 'DTSTART;VALUE=DATE:20261030'), event('dup', 'DTSTART;VALUE=DATE:20261031')),
    wrap(event('hourly', 'DTSTART:20261030T090000','RRULE:FREQ=HOURLY'))]) assert.throws(() => importCalendar(ics));
});

test('an appointment past midnight exports with an end on the next day', () => {
  const content = exportCalendar([{ date:'2026-10-31', title:'', entries:[entry({ text:'Nachtschicht', time:'22:00', end:'26:30' })] }]);
  const imported = importCalendar(content, 2026).entries.map(({ date, entry: item }) => [date, item.time, item.end]);
  assert.deepEqual(imported, [['2026-10-31', '22:00', '26:30']]);
});

test('imported series retain exclusions and recurrence logic for future occurrences',async()=>{
 const {occurrences}=await import('../src/repeat.ts');
 const parsed=importCalendar(wrap(event('work','DTSTART:20261005T090000','DTEND:20261005T100000','RRULE:FREQ=WEEKLY;BYDAY=MO,WE;COUNT=6','EXDATE:20261007T090000','CATEGORIES:Arbeit','COLOR:#AEFF00')),2026);
 assert(parsed.entries.length>1);assert.equal(new Set(parsed.entries.map(item=>item.entry.repeat.series)).size,1);
 assert.deepEqual(occurrences(parsed.entries[0].entry.repeat.rule,'2026-10-01','2026-11-01'),parsed.entries.map(item=>item.date));
 assert.equal(parsed.entries[0].tag.name,'Arbeit');assert.equal(parsed.entries[0].tag.color,'#AEFF00');
});
test('multi-day all-day import preserves the exclusive ICS end as one span',()=>{
 const parsed=importCalendar(wrap(event('trip','DTSTART;VALUE=DATE:20261030','DTEND;VALUE=DATE:20261102','SUMMARY:Trip')));
 assert.equal(parsed.entries.length,1);assert.equal(parsed.entries[0].entry.end,'72:00');
});

test('calendar names and colors supply reusable tag metadata',()=>{
 const content=wrap(event('named','DTSTART;VALUE=DATE:20261103','SUMMARY:Meeting')).replace('VERSION:2.0','VERSION:2.0\r\nX-WR-CALNAME:Uni\r\nX-APPLE-CALENDAR-COLOR:#1A2B3CFF');
 const parsed=importCalendar(content);assert.equal(parsed.entries[0].tag.name,'Uni');assert.equal(parsed.entries[0].tag.color,'#1A2B3C');
});

test('reminder lead time and icon round trip; a foreign alarm sets the lead time', () => {
  const original = entry({ reminder:true, reminderBefore:90, icon:'graduation-cap', time:'10:00' });
  const ics = exportCalendar([{ date:'2026-11-05', title:'', entries:[original] }]);
  assert(ics.includes('X-JOURNAL-REMINDER-BEFORE:90') && ics.includes('X-JOURNAL-ICON:graduation-cap'));
  const [{ entry: back }] = importCalendar(ics, 2026).entries;
  assert.equal(back.reminderBefore, 90); assert.equal(back.icon, 'graduation-cap');
  const foreign = wrap(event('alarm@example.org', 'SUMMARY:Arzt', 'DTSTART:20261105T090000', 'DTEND:20261105T093000',
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'DESCRIPTION:Arzt', 'END:VALARM', 'X-JOURNAL-ICON:Not Valid'));
  const [{ entry: alarm }] = importCalendar(foreign, 2026).entries;
  assert.equal(alarm.reminder, true); assert.equal(alarm.reminderBefore, 15); assert.equal('icon' in alarm, false);
});
