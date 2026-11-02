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
