import test from 'node:test';
import assert from 'node:assert/strict';
import { activitySummary, normalizePeriodData } from '../src/periodData.ts';
test('recorded minutes are included even without a checkbox and survive disabling tracking', () => {
 const data=normalizePeriodData({definitions:[{id:'a',name:'Read',trackTime:false}],days:{'2026-11-02':{items:{a:{done:false,minutes:45}}},'2026-11-03':{items:{a:{done:true,minutes:30}}}}});
 const sum=activitySummary(['2026-11-02','2026-11-03','2026-11-04'],data.days,'a');
 assert.equal(sum.minutes,75); assert.equal(sum.activeDays,2); assert.equal(data.definitions[0].trackTime,false);
 assert.equal(activitySummary(['2026-11-04'],data.days,'a').minutes,0);
});
test('existing activities retain time and notes support when defaults are added', () => {
 const data=normalizePeriodData({definitions:[{id:'a',name:'Read'}]});
 assert.equal(data.definitions[0].textField,true); assert.equal(data.definitions[0].active,true); assert.equal(data.definitions[0].color,'#569eff');
});
