import test from 'node:test';
import assert from 'node:assert/strict';
import { activityTags, calendarMinutes, entryMinutes, withCalendarMinutes } from '../src/activityCalendar.ts';

const definitions = [{ id:'read', name:'Lesen', color:'#569eff', trackTime:true, textField:false, active:true, calendarTagId:'tag-read' }, { id:'sport', name:'Sport', color:'#76d982', trackTime:true, textField:false, active:true }];
const entry = (extra) => ({ id:'x', kind:'event', text:'', done:false, cancelled:false, priority:false, ...extra });

test('timed entries count with their length; open ends and cancelled tasks do not', () => {
  assert.equal(entryMinutes({ time:'09:15', end:'10:00' }), 45);
  assert.equal(entryMinutes({ time:'23:30', end:'24:00' }), 30);
  assert.equal(entryMinutes({ time:'09:00', end:null }), 0);
  assert.equal(entryMinutes({ time:'09:00', end:'10:00', cancelled:true }), 0);
});

test('calendar entries with an activity tag add up per day; other tags and untagged entries are ignored', () => {
  const minutes = calendarMinutes([
    { date:'2026-11-02', title:'', entries:[entry({ tag:'tag-read', time:'08:00', end:'08:30' }), entry({ tag:'tag-read', time:'20:00', end:'21:15' }), entry({ tag:'other', time:'10:00', end:'11:00' }), entry({ time:'12:00', end:'13:00' })] },
    { date:'2026-11-03', title:'', entries:[entry({ tag:'other', time:'10:00', end:'11:00' })] },
  ], definitions);
  assert.deepEqual(minutes, { '2026-11-02': { read:105 } });
});

test('shown minutes are typed plus calendar time, the stored data stays unchanged', () => {
  const data = { definitions, notes:{}, days:{ '2026-11-02': { items:{ read:{ done:true, minutes:20, text:'Buch' } } } } };
  const shown = withCalendarMinutes(data, { '2026-11-02': { read:30 }, '2026-11-04': { read:15 } });
  assert.deepEqual(shown.days['2026-11-02'].items.read, { done:true, minutes:50, text:'Buch' });
  assert.deepEqual(shown.days['2026-11-04'].items.read, { done:false, minutes:15 });
  assert.equal(data.days['2026-11-02'].items.read.minutes, 20);
});

test('activities get a tag: an unused one of the same name, else a new one in their colour with a free name', () => {
  let n = 0;
  const id = () => `new-${++n}`;
  const shared = activityTags([{ id:'tag-read', name:'Lesen', color:'#569eff' }, { id:'s', name:'sport', color:'#ffffff' }], definitions, id);
  assert.equal(shared.definitions[1].calendarTagId, 's');
  assert.equal(shared.tags.length, 2);
  const taken = activityTags([{ id:'tag-read', name:'Lesen', color:'#569eff' }], [...definitions, { ...definitions[0], id:'read2', calendarTagId:undefined }], id);
  assert.deepEqual(taken.tags.slice(1), [{ id:'new-1', name:'Sport', color:'#76d982' }, { id:'new-2', name:'Lesen (2)', color:'#569eff' }]);
  const restored = activityTags([], definitions.slice(0, 1), id);
  assert.deepEqual(restored.tags, [{ id:'tag-read', name:'Lesen', color:'#569eff' }]);
});
