import test from 'node:test';
import assert from 'node:assert/strict';

test('browsing retains only a bounded set of days and reloads evicted content', async () => {
  const calls = new Map();
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    if (command === 'load_series') return [];
    if (command === 'load_day') {
      calls.set(args.date, (calls.get(args.date) ?? 0) + 1);
      return { date: args.date, title: args.date, body: '', entries: [], revision: 1 };
    }
    throw new Error(command);
  } } };
  const { journal } = await import('../src/journal.ts');
  const dates = Array.from({ length: 80 }, (_, i) => new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10));
  for (const date of dates) await journal.load(date);
  assert.equal(dates.filter(date => journal.cached(date)).length, 32);
  assert.equal(journal.cached(dates[0]), undefined);
  await journal.load(dates[79]);
  assert.equal(calls.get(dates[79]), 1, 'Recent content is reused.');
  await journal.load(dates[0]);
  assert.equal(calls.get(dates[0]), 2, 'Eviction does not lose persisted data.');
  journal.invalidate();
  assert(dates.every(date => !journal.cached(date)));
});

test('large mail text evicts older cached days without dropping the newest content',async()=>{
  const {journal}=await import('../src/journal.ts');journal.invalidate();
  const text='mail 🐈 '.repeat(140000);const calls=new Map();
  globalThis.window={__TAURI_INTERNALS__:{invoke:async(command,args)=>{
    if(command==='load_series')return [];
    if(command==='load_day'){calls.set(args.date,(calls.get(args.date)??0)+1);return {date:args.date,title:'',body:'',revision:1,entries:[{id:args.date,kind:'event',text:'Mail',description:text,done:false,cancelled:false,priority:false}]};}
    throw new Error(command);
  }}};
  const dates=Array.from({length:16},(_,i)=>`2026-12-${String(i+1).padStart(2,'0')}`);
  for(const date of dates)await journal.load(date);
  const retained=dates.filter(date=>journal.cached(date));assert(retained.length<16);assert(retained.length>1);
  assert.equal(journal.cached(dates.at(-1)).entries[0].description,text);
  assert.equal(journal.cached(dates[0]),undefined);assert.equal((await journal.load(dates[0])).entries[0].description,text);assert.equal(calls.get(dates[0]),2);
  journal.invalidate();
  const huge='x'.repeat(9*1024*1024);
  globalThis.window.__TAURI_INTERNALS__.invoke=async(command,args)=>command==='load_series'?[]:{date:args.date,title:'',body:huge,entries:[],revision:1};
  await journal.load('2026-12-20');assert.equal(journal.cached('2026-12-20').body,huge,'An oversized newest day is kept in full.');
  journal.invalidate();
});

test('late loads and failures cannot overwrite a saved day or corrupt cache accounting',async()=>{
  const {journal}=await import('../src/journal.ts');journal.invalidate();let finish;
  const saved={date:'2026-12-22',title:'Saved',body:'',revision:2,entries:[]};
  globalThis.window={__TAURI_INTERNALS__:{invoke:async(command)=>{
    if(command==='load_series')return [];
    if(command==='load_day')return new Promise(resolve=>{finish=resolve;});
    if(command==='save_day')return saved;
    throw new Error(command);
  }}};
  const loading=journal.load(saved.date);await new Promise(resolve=>setImmediate(resolve));await journal.save(saved);
  finish({...saved,title:'Outdated',revision:1});await loading;assert.equal(journal.cached(saved.date).title,'Saved');
  journal.invalidate();globalThis.window.__TAURI_INTERNALS__.invoke=async()=>{throw new Error('Offline');};
  await assert.rejects(journal.load(saved.date),/Offline/);assert.equal(journal.cached(saved.date),undefined);
  journal.invalidate();
});
