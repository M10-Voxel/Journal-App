import test from 'node:test';
import assert from 'node:assert/strict';
import { activityLevel, activityPalette } from '../src/activityColors.ts';
test('Obsidian intensity uses 30 minute steps and caps at 180 minutes', () => {
 assert.equal(activityLevel(undefined,true),0);
 assert.deepEqual([0,29,30,59,60,89,90,119,120,149,150,179,180,900].map(minutes=>activityLevel({done:true,minutes},true)),[1,1,2,2,3,3,4,4,5,5,6,6,7,7]);
 assert.equal(activityLevel({done:false,minutes:95},true),4);
 assert.equal(activityLevel({done:true,minutes:180},false),1);
 assert.equal(activityLevel({done:true},true),1);
});
test('Obsidian palette preserves the base in the middle and darkens monotonically', () => {
 const shades=activityPalette('#569eff');
 assert.equal(shades.length,7);assert.equal(shades[3],'#569eff');assert.equal(shades[0],'#c2dcff');assert.equal(shades[6],'#2d5285');
 const luminance=hex=>[1,3,5].reduce((sum,offset)=>sum+parseInt(hex.slice(offset,offset+2),16),0);
 assert(shades.every((shade,index)=>index===0 || luminance(shade)<luminance(shades[index-1])));
});

test('a chosen range spreads the seven shades between its minutes', async () => {
 const { activityRange, activityLevelLabel, defaultRange } = await import('../src/activityColors.ts');
 const { normalizePeriodData } = await import('../src/periodData.ts');
 // 0–60: a shade every 10 minutes; below the start still the first, from the end on the last.
 const range = { min:0, max:60 };
 assert.deepEqual([0,9,10,25,50,59,60,500].map(minutes=>activityLevel({done:true,minutes},true,range)),[1,1,2,3,6,6,7,7]);
 // 30–120: the first shade also holds everything under 30 minutes (and an entry without minutes).
 assert.deepEqual([5,30,44,45,119,120].map(minutes=>activityLevel({done:true,minutes},true,{min:30,max:120})),[1,1,1,2,6,7]);
 assert.equal(activityLevel({done:false,minutes:0},true,range),0);
 assert.equal(activityLevel({done:true,minutes:500},false,range),1);
 assert.deepEqual([0,1,5,6].map(index=>activityLevelLabel(index,range)),['0–9 min','10–19 min','50–59 min','60+ min']);
 assert.deepEqual([0,6].map(index=>activityLevelLabel(index)),['0–29 min','180+ min']);
 assert.equal(activityLevelLabel(0,{min:30,max:120}),'0–44 min');
 // Invalid ranges fall back to 0–180; valid ones are kept whole.
 assert.deepEqual(activityRange({minMinutes:90,maxMinutes:60}),defaultRange);
 assert.deepEqual(activityRange({minMinutes:-5,maxMinutes:99999}),{min:0,max:1440});
 assert.deepEqual(activityRange({minMinutes:10.4,maxMinutes:70.6}),{min:10,max:71});
 assert.deepEqual(activityRange({}),defaultRange);
 const data = normalizePeriodData({ definitions:[{id:'a',name:'A',color:'#569eff',minMinutes:15,maxMinutes:75},{id:'b',name:'B',color:'#569eff',minMinutes:50,maxMinutes:20},{id:'c',name:'C',color:'#569eff'}] });
 assert.deepEqual(data.definitions.map(item=>[item.minMinutes,item.maxMinutes]),[[15,75],[0,180],[undefined,undefined]]);
});
