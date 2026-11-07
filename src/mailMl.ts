import { de, en } from 'chrono-node';
import { localDate } from './dates.ts';
import { calendarContextThreshold } from './mailContext.ts';
import { mailSentences } from './mailSentences.ts';
import type { MailSentence } from './mailSentences.ts';

export interface ModelMention { text: string; field: string; score: number; start: number; end: number }
export interface ModelAnalysis { text: string; mentions: ModelMention[]; classifications: { label: string; score: number }[]; milliseconds: number }
export type MailAnalyzer = (text: string) => Promise<ModelAnalysis>;
export interface ModelEvent { date: string; text: string; time: string | null; end: string | null; identity: string; evidence: string }

export function prepareMailText(subject: string, content: string): string {
  const fresh: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(?:Am .+schrieb .+:|On .+wrote:|[- ]*(?:Original Message|Ursprüngliche Nachricht|Weitergeleitete Nachricht)[- ]*)\s*$/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    fresh.push(line);
  }
  return [subject.trim(), fresh.join('\n').trim()].filter(Boolean).join('\n\n').slice(0, 24_000);
}
const vagueDate = (date: string) => /\b(?:woche|wochen|monat|monate|jahr|jahre|week|month|year)\b/i.test(date) &&
  !/\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(date) && !/\b\d{1,2}\.\s*[A-Za-zäöü]+/i.test(date);
function parsedDates(text: string, reference: Date) {
  if (vagueDate(text)) return [];
  const certain = (results: ReturnType<typeof de.parse>) => results.filter(result => result.start.isCertain('day') || result.start.isCertain('weekday'));
  const german = certain(de.parse(text, reference, { forwardDate: true }));
  // Never interpret 12.11.2026 once as 12 November and again as 11 December.
  return german.length ? german : certain(en.parse(text, reference, { forwardDate: true }));
}
const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2,'0')}:${String(minutes % 60).padStart(2,'0')}`;
function minutes(text: string, inherited = ''): number | null {
  const match = /^(\d{1,2})(?:[:.](\d{2}))?\s*(uhr|[ap]\.?m\.?)?$/iu.exec(text.trim());
  if (!match) return null;
  let hour=Number(match[1]);const minute=Number(match[2] ?? 0),meridiem=(match[3] ?? inherited).replace(/\./g,'').toLowerCase();
  if (minute>59 || hour>23 || /[ap]m/.test(meridiem) && (hour<1 || hour>12)) return null;
  if (meridiem==='pm' && hour<12)hour+=12;
  if (meridiem==='am' && hour===12)hour=0;
  return hour*60+minute;
}
interface TimeSpan { start: number; end: number; time: string; finish: string | null }
function sentenceTimes(text: string, mentions: ModelMention[]): TimeSpan[] {
  const result: TimeSpan[]=[];
  const value=String.raw`(?:[01]?\d|2[0-3])(?:[:.][0-5]\d)?(?:\s*(?:Uhr|[ap]\.?m\.?))?`;
  const ranges=new RegExp(String.raw`(?<![\p{L}\d:.])(?:(zwischen|zwichen|between|von|from)\s+)?(${value})\s*(bis(?:\s+um)?|to|until|[-–—]|und|and)\s*(${value})(?![\p{L}\d:])`,'giu');
  for (const match of text.matchAll(ranges)) {
    if (/^(?:und|and)$/i.test(match[3]) && !/^(?:zwischen|zwichen|between)$/i.test(match[1] ?? ''))continue;
    if (/^\s*(?:Euro|EUR|€|Prozent|%|Werktag|business|working)\b/iu.test(text.slice(match.index!+match[0].length)))continue;
    if (!/[:.]\d{2}|Uhr|[ap]\.?m\.?/iu.test(match[0]) && !mentions.some(m=>m.field==='time'&&m.start<match.index!+match[0].length&&m.end>match.index!))continue;
    const aMeridiem=/([ap]\.?m\.?)$/iu.exec(match[2])?.[1] ?? '',bMeridiem=/([ap]\.?m\.?)$/iu.exec(match[4])?.[1] ?? '';
    const a=minutes(match[2],aMeridiem||bMeridiem),b=minutes(match[4],bMeridiem||aMeridiem);
    if(a===null||b===null||a===b)continue;
    result.push({start:match.index!,end:match.index!+match[0].length,time:clock(a),finish:clock(b<a?b+1440:b)});
  }
  const singles=new RegExp(String.raw`(?<![\p{L}\d:.])(?:[01]?\d|2[0-3])(?:(?:[:.][0-5]\d)(?:\s*(?:Uhr|[ap]\.?m\.?))?|\s*(?:Uhr|[ap]\.?m\.?))(?![\p{L}\d:])`,'giu');
  for(const match of text.matchAll(singles)) {
    const start=match.index!,end=start+match[0].length;
    if(result.some(r=>r.start<end&&r.end>start) || /\d\.\d/.test(match[0])&&text[end]==='.')continue;
    const value=minutes(match[0]);if(value!==null)result.push({start,end,time:clock(value),finish:null});
  }
  for(const mention of mentions.filter(m=>m.field==='time')) {
    if(result.some(r=>r.start<mention.end&&r.end>mention.start))continue;
    const value=minutes(mention.text);if(value!==null)result.push({start:mention.start,end:mention.end,time:clock(value),finish:null});
  }
  return result.sort((a,b)=>a.start-b.start);
}
interface DateSpan { start: number; end: number; date: string }

/** Sentence classification chooses event context; GLiNER spans and chrono normalize its dates and clocks. */
export function extractModelEvents(analysis: ModelAnalysis, subject: string, sentAt: number, today: string): { events: ModelEvent[]; notice: string } {
  const reference=new Date(sentAt*1000);
  if (!Number.isFinite(+reference)) return {events:[],notice:''};
  const valid=analysis.mentions.filter(item=>Number.isFinite(item.score)&&item.start>=0&&item.end>item.start&&item.end<=analysis.text.length&&analysis.text.slice(item.start,item.end)===item.text);
  if(analysis.mentions.length && !valid.length)return {events:[],notice:''};
  const mentions=valid.filter(item=>item.score>=.5);
  const sentences=mailSentences(analysis.text,subject);
  const subjectDates=sentences.filter(s=>s.subject&&s.score>=calendarContextThreshold).flatMap(s=>parsedDates(s.text,reference).map(p=>localDate(p.start.date())));
  const subjectDate=subjectDates.length===1?subjectDates[0]:null;
  const events: (ModelEvent & {subject: boolean})[]=[];
  let unclear=false;
  function localMentions(sentence: MailSentence) {
    return mentions.filter(m=>m.start>=sentence.start&&m.end<=sentence.end).map(m=>({...m,start:m.start-sentence.start,end:m.end-sentence.start}));
  }
  for(const [index,sentence] of sentences.entries()) {
    const local=localMentions(sentence), dates:DateSpan[]=[];
    // Near the decision boundary require independent neural agreement in this SAME sentence.
    const neuralAgreement=['event','date','time'].every(field=>local.some(m=>m.field===field&&m.score>=(field==='event'?.6:.8)));
    if(sentence.score<calendarContextThreshold && !(sentence.score>=calendarContextThreshold-.1&&neuralAgreement))continue;
    for(const mention of local.filter(m=>m.field==='date')) {
      const date=parsedDates(mention.text,reference)[0];
      if(date)dates.push({start:mention.start,end:mention.end,date:localDate(date.start.date())});
    }
    // Recover dates missed by GLiNER only inside a sentence selected by the trained classifier.
    for(const parsed of parsedDates(sentence.text,reference)) {
      const date=localDate(parsed.start.date()),start=parsed.index,end=start+parsed.text.length;
      if(!dates.some(d=>d.date===date&&d.start<end&&d.end>start))dates.push({date,start,end});
    }
    let times=sentenceTimes(sentence.text,local),continuation:MailSentence|undefined;
    if(!dates.length&&!sentence.subject&&subjectDate&&times.length)dates.push({start:0,end:0,date:subjectDate});
    dates.sort((a,b)=>a.start-b.start);
    const next=sentences[index+1];
    if(!times.length&&dates.length===1&&next&&next.paragraph===sentence.paragraph&&next.score>=calendarContextThreshold&&next.text.length<240&&!parsedDates(next.text,reference).length) {
      const following=sentenceTimes(next.text,localMentions(next));
      if(following.length){times=following.map(t=>({...t,start:t.start+sentence.text.length,end:t.end+sentence.text.length}));continuation=next;}
    }
    for(const [dateIndex,date] of dates.entries()) {
      const previous=dates[dateIndex-1],nextDate=dates[dateIndex+1];
      const eligible=times.filter(time=>time.start>=(previous?.end??0)&&time.start<(nextDate?.start??Infinity));
      const time=eligible.find(t=>t.start>=date.start)??eligible.at(-1);
      const nextDay=time?.finish&&Number(time.finish.split(':')[0])>=24?localDate(new Date(new Date(date.date+'T12:00:00').getTime()+86400000)):null;
      if(date.date<today && (!nextDay||nextDay<today))continue;
      const nearest=(items:ModelMention[])=>[...items].sort((a,b)=>Math.abs(a.start-date.start)-Math.abs(b.start-date.start))[0];
      const name=nearest(local.filter(m=>m.field==='event'));
      let place=nearest(local.filter(m=>m.field==='location'));
      if(!place&&continuation)place=nearest(localMentions(continuation).filter(m=>m.field==='location'));
      // A following short place-only sentence belongs to an explicit personal continuation.
      if(!place&&continuation&&sentences[index+2]?.paragraph===sentence.paragraph)place=nearest(localMentions(sentences[index+2]).filter(m=>m.field==='location'));
      const title=name?.text||subject.replace(/^(?:(?:re|fw|fwd|aw|wg):\s*)+/gi,'').trim()||'Erkannter Termin';
      const text=`${title}${place?` · ${place.text}`:''}`;
      const identity=`${date.date}:${time?.time??''}:${time?.finish??''}`;
      if(events.some(e=>e.identity===identity))continue;
      if(!time&&local.some(m=>m.field==='time') || !time&&next?.text.includes('Uhrzeit'))unclear=true;
      events.push({date:date.date,time:time?.time??null,end:time?.finish??null,text,identity,subject:sentence.subject,evidence:`Kontextbezogener ML-Vorschlag · bitte prüfen\n${sentence.text}${continuation?'\n'+continuation.text:''}`});
    }
  }
  const bodyEvents=events.filter(e=>!e.subject);
  const first=[...analysis.classifications].filter(c=>Number.isFinite(c.score)).sort((a,b)=>b.score-a.score)[0];
  const cancellation=first&&first.score>=.5&&/cancelled|past event/i.test(first.label);
  const selected=bodyEvents.length?bodyEvents:cancellation?[]:events;
  const notice=!selected.length&&cancellation?'Das lokale Modell stuft den Inhalt als mögliche Absage oder rückblickende Nachricht ein. Es wurde kein neuer Termin angelegt.':unclear?'Nicht alle erkannten Angaben konnten eindeutig in ein Datum oder eine Uhrzeit umgerechnet werden. Bitte den Originaltext prüfen.':'';
  return {events:selected.map(({subject:_,...event})=>event),notice};
}
