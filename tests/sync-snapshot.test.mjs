import test from 'node:test';
import assert from 'node:assert/strict';
import {upgradeSnapshot,databaseSnapshot,syncPreferences} from '../src/sync/snapshot.ts';
import {mergeThreeWay} from '../src/sync/merge.ts';
test('legacy cloud preserves newly added activities, cards and images',()=>{
 const old={schema:11,tables:{}};
 const local=upgradeSnapshot({...old,settings:{'period-data':{days:{a:{rating:8}}},'board:card:a':{asset:'image'}},images:{image:'avif'},preferences:{theme:'pixel'}});
 const merged=mergeThreeWay(upgradeSnapshot(old),local,upgradeSnapshot(old));
 assert.deepEqual(merged.conflicts,[]);assert.deepEqual(merged.value,local);
 assert.deepEqual(databaseSnapshot(local),{schema:12,tables:{},settings:local.settings});
});
test('independent activity dates merge and concurrent notes conflict',()=>{
 const base=upgradeSnapshot({schema:12,tables:{},settings:{'period-data':{days:{}},'board:card:a':{text:'old'}}});
 const a=structuredClone(base),b=structuredClone(base);
 a.settings['period-data'].days.a={rating:8};b.settings['period-data'].days.b={rating:7};
 a.settings['board:card:a'].text='a';b.settings['board:card:a'].text='b';
 const result=mergeThreeWay(base,a,b);
 assert.equal(Object.keys(result.value.settings['period-data'].days).length,2);
 assert.equal(result.conflicts.length,1);
});
test('mail accounts from both devices merge without losing legacy data',()=>{
 const base=upgradeSnapshot({schema:12,tables:{},settings:{}});
 const local=structuredClone(base),remote=structuredClone(base);
 local.mailAccounts.a={id:'a',label:'Privat'};remote.mailAccounts.b={id:'b',label:'Arbeit'};
 const result=mergeThreeWay(base,local,remote);
 assert.deepEqual(result.conflicts,[]);
 assert.deepEqual(Object.keys(result.value.mailAccounts).sort(),['a','b']);
 assert.equal(databaseSnapshot(result.value).schema,12);
 assert.equal(databaseSnapshot(result.value).mailAccounts,undefined);
});

test('tag emoji and independent daily scale values survive a complete merged snapshot',()=>{
 const base=upgradeSnapshot({schema:12,tables:{tags:{tag:{id:'tag',name:'Sport',color:'#123456',position:0}}},settings:{'period-data':{scales:[{id:'sleep',name:'Schlaf',min:0,max:10}],days:{'2026-11-11':{items:{},scales:{sleep:5}}}}}});
 const local=structuredClone(base),remote=structuredClone(base);
 local.tables.tags.tag.icon='emoji:🏃';
 local.settings['period-data'].days['2026-11-11'].scales.sleep=8;
 remote.settings['period-data'].days['2026-11-12']={items:{},rating:9,scales:{sleep:7}};
 delete remote.tables.tags.tag.icon; // An older device has not added the icon column yet.
 const merged=mergeThreeWay(base,upgradeSnapshot(local),upgradeSnapshot(remote));
 assert.deepEqual(merged.conflicts,[]);
 const db=databaseSnapshot(merged.value);
 assert.equal(db.tables.tags.tag.icon,'emoji:🏃');
 assert.equal(db.settings['period-data'].days['2026-11-11'].scales.sleep,8);
 assert.equal(db.settings['period-data'].days['2026-11-12'].scales.sleep,7);
 assert.deepEqual(db.settings['period-data'].scales,base.settings['period-data'].scales);
});

test('device and widget preferences never enter the cloud, including legacy snapshots',()=>{
 const prefs={theme:'nebula',pixel:false,widgets:[{id:'private',x:100}],widgetAutostart:true,windowLayout:{x:2}};
 assert.deepEqual(syncPreferences(prefs),{theme:'nebula',pixel:false});
 const next=upgradeSnapshot({schema:13,tables:{},preferences:prefs});
 assert.deepEqual(next.preferences,{theme:'nebula',pixel:false});
 assert.equal(prefs.widgets[0].x,100);
});

test('mixed layouts, sticker popup variants and ink preference are shared with their palette',()=>{
 const prefs={theme:'nebula',layout:'desk',look:'journal',popupStyle:'d',inkPressure:false,colorTheme:'lavender-night',widgets:[],windowLayout:{x:100}};
 const expected={theme:'nebula',layout:'desk',look:'journal',popupStyle:'d',inkPressure:false,colorTheme:'lavender-night'};
 assert.deepEqual(syncPreferences(prefs),expected);
 assert.deepEqual(upgradeSnapshot({schema:13,tables:{},preferences:prefs}).preferences,expected);
});
