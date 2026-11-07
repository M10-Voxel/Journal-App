// Synthetic mail only: the isolated worker has no account or journal database access.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { isDeepStrictEqual } from 'node:util';
import { recognizeMail, newMailAccount } from '../src/mail.ts';

const executable = resolve(process.argv[2] ?? 'src-tauri/target/release/journal-app.exe');
const assets = resolve(process.argv[3] ?? 'src-tauri/target/mail-ml-assets');
const output = process.argv[4] ?? 'src-tauri/target/mail-context-live-report.json';
const samples = JSON.parse(await readFile(process.argv[5] ?? 'tools/mail-ml-probe/context-cases.json', 'utf8'));
const child = spawn(executable, ['--mail-ml-worker', assets], { stdio: ['pipe','pipe','pipe'], windowsHide: true, env: {...process.env, GLINER2_DEVICE:'cpu'} });
const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
let stderr = '';
child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-4000); });
const response = async () => {
  let timeout;
  try {
    const line = await Promise.race([lines.next(),new Promise((_,reject) => {timeout=setTimeout(()=>reject(new Error('Worker timeout')),120_000);})]);
    if (line.done) throw new Error(`Worker ended: ${stderr}`);
    return JSON.parse(line.value);
  } finally { clearTimeout(timeout); }
};
const reports = [];
try {
  if (!(await response()).ready) throw new Error('Worker did not initialize');
  const account = newMailAccount('custom');
  for (const sample of samples) {
    let analysis;
    const result = await recognizeMail({account,message:{key:sample.id,subject:sample.subject,sender:'synthetic@example.org',sentAt:+new Date('2026-11-09T08:30:00+01:00')/1000,text:sample.text,html:'',calendars:[]}},'2026-11-09',async text=>{
      child.stdin.write(JSON.stringify({text})+'\n');analysis=await response();return analysis;
    });
    const actual=result.candidates.map(item=>[item.date,item.entry.time,item.entry.end]);
    const passed=isDeepStrictEqual(actual,sample.expected);
    reports.push({...sample,actual,passed,notice:result.notice,analysis});
    console.log(`${passed?'PASS':'FAIL'} ${sample.id}: ${JSON.stringify(actual)}`);
  }
  const summary = {total:reports.length,passed:reports.filter(r=>r.passed).length,falsePositiveMails:reports.filter(r=>!r.expected.length&&r.actual.length).length,missedMails:reports.filter(r=>r.expected.length&&!r.actual.length).length};
  await writeFile(output,JSON.stringify({summary,reports},null,2)+'\n');
  console.log(JSON.stringify(summary));
  if(summary.passed!==summary.total)process.exitCode=1;
} finally { child.stdin.end();child.kill(); }
