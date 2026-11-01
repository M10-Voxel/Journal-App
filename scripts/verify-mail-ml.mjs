// Real, offline ML integration check. This starts only the app's isolated worker, never its GUI or databases.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { recognizeMail, newMailAccount } from '../src/mail.ts';

const executable=resolve(process.argv[2] ?? 'src-tauri/target/debug/journal-app.exe');
const assets=resolve(process.argv[3] ?? 'src-tauri/target/mail-ml-assets');
const child=spawn(executable,['--mail-ml-worker',assets],{stdio:['pipe','pipe','pipe'],windowsHide:true,env:{...process.env,GLINER2_DEVICE:'cpu'}});
const lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
let stderr=''; child.stderr.on('data',bytes=>{stderr+=bytes.toString().slice(0,4000);});
const response=async()=>{
  let timeout;
  try {
    const {value,done}=await Promise.race([lines.next(),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('ML worker timed out')),120_000);})]);
    if(done)throw new Error(`ML worker ended unexpectedly: ${stderr}`);
    return JSON.parse(value);
  } finally {clearTimeout(timeout);}
};
const reports=[];
try {
  assert.equal((await response()).ready,true);
  const samples=(await readFile('tools/mail-ml-probe/cases.jsonl','utf8')).trim().split('\n').map(line=>JSON.parse(line));
  const account=newMailAccount('custom');
  const sentAt=+new Date('2026-10-31T12:00:00+01:00')/1000;
  for(const sample of samples){
    let analysis;
    const result=await recognizeMail({account,message:{key:sample.id,subject:'',sender:'synthetic@example.org',sentAt,text:sample.text,html:'',calendars:[]}},'2026-10-31',async text=>{
      child.stdin.write(JSON.stringify({text})+'\n'); analysis=await response(); assert.equal(analysis.text,text);return analysis;
    });
    const slots=result.candidates.map(item=>[item.date,item.entry.time,item.entry.end]);
    reports.push({id:sample.id,expected:sample.expected,slots,notice:result.notice,analysis});
    await writeFile('src-tauri/target/mail-ml-live-report.json',JSON.stringify(reports,null,2)+'\n');
    if(sample.id==='simple-relative')assert.deepEqual(slots,[['2026-11-01','17:00',null]]);
    if(sample.id==='no-event-keyword')assert.deepEqual(slots,[['2026-11-12','17:30',null]]);
    if(sample.id==='split-lines')assert.deepEqual(slots,[['2026-11-02','17:00',null]]);
    if(sample.id==='delivery')assert.deepEqual(slots,[['2026-11-12','10:00','12:00']]);
    if(['cancellation','past','invoice','hypothetical'].includes(sample.id))assert.equal(slots.length,0,sample.id);
    if(sample.id==='quoted-history')assert.deepEqual(slots,[['2026-11-13','18:00',null]]);
    if(sample.id==='two-events')assert.deepEqual(slots,[['2026-11-01','17:00',null],['2026-11-02','10:00',null]]);
    if(sample.id==='two-dates')assert.equal(slots.length,2);
    if(sample.id==='no-time')assert.deepEqual(slots,[['2026-11-01',null,null]]);
    if(sample.expected==='appointment_range')assert.deepEqual(slots,[['2026-11-01',sample.time,sample.end]],sample.id);
    assert(result.candidates.every(item=>!item.automatic && item.entry.showInJournal===false));
    console.log(`${sample.id}: ${JSON.stringify(slots)} · ${analysis?.milliseconds ?? 0} ms`);
  }
  await writeFile('src-tauri/target/mail-ml-live-report.json',JSON.stringify(reports,null,2)+'\n');
  console.log(`Real offline ML checks passed for ${samples.length} synthetic German samples. No account or journal database was opened.`);
} finally { child.stdin.end();child.kill(); }
