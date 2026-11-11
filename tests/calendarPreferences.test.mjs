import test from 'node:test';
import assert from 'node:assert/strict';
import { calendarInitialDate, calendarWidgetPreferencesKey, copyWidgetPreferences, loadCalendarPreferences, parseCalendarPreferences } from '../src/calendarPreferences.ts';

test('calendar preferences retain all five views and valid filters', () => {
  for(const view of ['year','month','week','workweek','day']) assert.deepEqual(parseCalendarPreferences(JSON.stringify({view,kinds:{event:false,task:true,note:true},date:'2026-11-11',followToday:false})),{view,kinds:{event:false,task:true,note:true},date:'2026-11-11',followToday:false});
});
test('malformed preferences and invalid dates recover without invalid calendar ranges', () => {
  for(const raw of ['null','false','[]','{bad',JSON.stringify({view:'unknown',kinds:{event:'no'},date:'2025-02-29'})]){
    const prefs=parseCalendarPreferences(raw);assert.equal(prefs.view,'month');assert.equal(prefs.date,null);assert.equal(prefs.kinds.event,true);
  }
});
test('today follows midnight while a browsed date survives a restart', () => {
  const prefs=parseCalendarPreferences(JSON.stringify({view:'week',date:'2026-11-11',followToday:true}));
  assert.equal(calendarInitialDate(prefs,'2026-11-12'),'2026-11-12');
  assert.equal(calendarInitialDate({...prefs,followToday:false},'2026-11-12'),'2026-11-11');
});
test('calendar widgets save independently and duplication copies presentation without sharing keys', () => {
  const values=new Map(), old=globalThis.localStorage;
  globalThis.localStorage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  try{
    values.set('journal.calendar',JSON.stringify({view:'month'}));
    values.set(calendarWidgetPreferencesKey('one'),JSON.stringify({view:'week',kinds:{note:true},date:'2026-10-10',followToday:false}));
    values.set('journal.hiddenTags',JSON.stringify({'widget-one':['work'],journal:['other']}));
    copyWidgetPreferences('one','two');
    assert.equal(loadCalendarPreferences(calendarWidgetPreferencesKey('two')).view,'week');
    assert.deepEqual(JSON.parse(values.get('journal.hiddenTags'))['widget-two'],['work']);
    values.set(calendarWidgetPreferencesKey('two'),JSON.stringify({view:'year'}));
    copyWidgetPreferences('one','two');
    assert.equal(loadCalendarPreferences(calendarWidgetPreferencesKey('two')).view,'year','Reloading a copied widget preserves its own later changes');
    assert.equal(loadCalendarPreferences(calendarWidgetPreferencesKey('one')).view,'week');
    assert.equal(loadCalendarPreferences().view,'month');
  }finally{if(old===undefined)delete globalThis.localStorage;else globalThis.localStorage=old;}
});
