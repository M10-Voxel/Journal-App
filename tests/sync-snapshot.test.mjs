import test from 'node:test';
import assert from 'node:assert/strict';
import {upgradeSnapshot,databaseSnapshot} from '../src/sync/snapshot.ts';
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
