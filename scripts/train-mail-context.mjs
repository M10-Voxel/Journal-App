// Deterministic supervised logistic regression, CPU-only, no Python/GPU/service required.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { mailContextFeatures } from '../src/mailContextFeatures.ts';
const source = (await readFile('tools/mail-ml-probe/context-training.json', 'utf8')).replace(/\r\n/g,'\n');
const corpus = JSON.parse(source);
// Contrast the SAME service nouns in generic availability and personally booked appointments.
for(const service of corpus.contrastiveSubjects) {
  for(const predicate of corpus.availabilityPredicates) {
    corpus.train.ignore.push(`Unser ${service} ist {date} {range} ${predicate}.`);
    corpus.train.ignore.push(`Bei Rückfragen steht Ihnen unser ${service} {date} {range} zur Verfügung.`);
  }
  corpus.train.event.push(`Ein persönlicher Rückruf vom ${service} ist {date} um {clock} vereinbart.`);
  corpus.train.event.push(`Ihr Gesprächstermin beim ${service} wurde für {date} {range} gebucht.`);
}
for(const offer of ['kostenlosen Versand','gratis Lieferung','einen Rabatt auf dein Paket','20 Prozent Preisnachlass','günstige Versandkosten']) {
  corpus.train.ignore.push(`{date} {range} bekommst du ${offer} im Shop.`);
  corpus.train.ignore.push(`Nur {date} {range} gibt es ${offer} für Ihre Bestellungen.`);
}
for(const split of ['train','validation','test']) for(const label of ['event','ignore']) corpus[split][label]=[...new Set(corpus[split][label])];
const subjects = ['Ihre Lieferung','Ihr Paket kommt heute','Hilfe zu Ihrer Bestellung','Support','Treffen','Your delivery','Contact us',''];
const dates = ['heute','morgen','am 18. Dezember','am kommenden Freitag','today','tomorrow'];
const ranges = ['zwischen 10 und 12 Uhr','von 14:30 bis 16:15 Uhr','zwischen 20 und 21:20 Uhr','between 2 and 4 pm','from 10:30 am to 12:15 pm'];
const previous = ['','Ihr Paket ist unterwegs.','Wir freuen uns auf Sie.','Der Support ist von 8 bis 18 Uhr erreichbar.'];
let seed = 20261107;
const random = () => { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; };
function expand(split) {
  const rows = [];
  for (const [label, templates] of Object.entries(corpus[split])) for (const [index,template] of templates.entries()) {
    for (let variant=0;variant<24;variant++) {
      const text=template.replaceAll('{date}',dates[variant%dates.length]).replaceAll('{range}',ranges[variant%ranges.length]).replaceAll('{clock}',variant%2?'17:30':'10 Uhr').replaceAll('{days}',variant%2?'1 bis 2':'2 bis 3');
      rows.push({ id:`${split}-${label}-${index}-${variant}`, group:`${split}-${label}-${index}`,label:label==='event'?1:0,text,subject:subjects[variant%subjects.length],previous:previous[variant%previous.length] });
    }
  }
  return rows;
}
const train=expand('train'), validation=expand('validation'), test=expand('test');
// No template (nor exact resulting focal sentence) is shared across the three splits.
const seen=new Map();
for (const [split,rows] of [['train',train],['validation',validation],['test',test]]) for(const row of rows) {
  if(seen.has(row.text)&&seen.get(row.text)!==split)throw new Error('Training/test contamination');seen.set(row.text,split);
}
const counts=new Map();
for(const row of train)for(const feature of mailContextFeatures(row).keys())counts.set(feature,(counts.get(feature)??0)+1);
const vocabulary=[...counts].filter(([,count])=>count>=3).map(([key])=>key).sort();
const ids=new Map(vocabulary.map((key,index)=>[key,index]));
const vector = row => [...mailContextFeatures(row)].filter(([key])=>ids.has(key)).map(([key,value])=>[ids.get(key),value]);
const encoded=train.map(row=>({label:row.label,features:vector(row)}));
const weights=new Float64Array(vocabulary.length);let bias=0;
const sigmoid=x=>1/(1+Math.exp(-Math.max(-30,Math.min(30,x))));
for(let epoch=0;epoch<75;epoch++) {
  for(let i=encoded.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[encoded[i],encoded[j]]=[encoded[j],encoded[i]];}
  const rate=.22/(1+epoch*.025);
  for(const row of encoded){
    let z=bias;for(const [index,value] of row.features)z+=weights[index]*value;
    const error=sigmoid(z)-row.label;bias-=rate*error;
    for(const [index,value] of row.features)weights[index]-=rate*(error*value+.0006*weights[index]);
  }
}
function metrics(rows, threshold) {
  let tp=0,fp=0,tn=0,fn=0;
  const failures=[];
  for(const row of rows){let z=bias;for(const [index,value] of vector(row))z+=weights[index]*value;const score=sigmoid(z),positive=score>=threshold;
    if(positive&&row.label)tp++;else if(positive){fp++;failures.push({id:row.id,label:row.label,score,text:row.text});}else if(row.label){fn++;failures.push({id:row.id,label:row.label,score,text:row.text});}else tn++;
  }
  return {samples:rows.length,tp,fp,tn,fn,precision:tp/(tp+fp)||0,recall:tp/(tp+fn)||0,failures};
}
// Select only on validation templates. F0.5 emphasizes precision; ties use the stricter threshold.
const candidates=[.25,.3,.35,.4,.45,.5,.55,.6,.65,.7,.75].map(threshold=>{
  const m=metrics(validation,threshold),f=.25*m.precision+m.recall;
  return {threshold,f05:f?1.25*m.precision*m.recall/f:0};
}).sort((a,b)=>b.f05-a.f05||b.threshold-a.threshold);
const threshold=candidates[0].threshold;
const artifact={version:1,algorithm:'l2-logistic-regression-word-and-character-ngrams',seed:20261107,sourceSha256:createHash('sha256').update(source).digest('hex'),threshold,bias:Number(bias.toFixed(8)),weights:Object.fromEntries(vocabulary.map((key,i)=>[key,Number(weights[i].toFixed(7))]))};
await writeFile('src/mailContextModel.json',JSON.stringify(artifact)+'\n');
const report={provenance:corpus.provenance,templates:Object.fromEntries(['train','validation','test'].map(split=>[split,Object.values(corpus[split]).reduce((n,a)=>n+a.length,0)])),features:vocabulary.length,sourceSha256:artifact.sourceSha256,threshold,thresholdSelection:'validation F0.5, test unused for threshold selection',train:metrics(train,threshold),validation:metrics(validation,threshold),test:metrics(test,threshold)};
await writeFile('tools/mail-ml-probe/context-training-report.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(report).map(([key,value])=>[key,value?.failures?{...value,failures:value.failures.length}:value])),null,2));
