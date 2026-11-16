// Recognizing appointments in mails (structured data, delivery windows, the local model). Loaded only once a mail
// is waiting to be read (useMailImport.ts): the sentence model (mailContextModel.json) stays out of the app until then.
import { encodeMailContent } from './mailContent.ts';
import { shiftDate, localDate } from './dates.ts';
import { t } from './i18n.ts';
import type { CalendarImport, Entry } from './journal.ts';
import type { MailAnalyzer } from './mailMl.ts';
import { mailSentences } from './mailSentences.ts';
import { calendarContextThreshold } from './mailContext.ts';
import { mailDescription, mailText } from './mail.ts';
import type { MailCandidate, MailPending } from './mail.ts';

async function hash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function uuid(value: string) {
  const hex = await hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function validDate(year: number, month: number, day: number): string | null {
  const value = new Date(year, month - 1, day, 12);
  return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}` : null;
}
function isoParts(value: string): { date: string; time: string | null } | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)) return null;
  if (!validDate(+value.slice(0, 4), +value.slice(5, 7), +value.slice(8, 10))) return null;
  const date = value.length === 10 ? new Date(`${value}T12:00`) : new Date(value);
  return Number.isFinite(+date) ? { date: localDate(date), time: value.length === 10 ? null : `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}` } : null;
}

/** Delivery windows count from the sending date, never the date of the sync. */
export function deliveryWorkdayWindow(subject:string,content:string,sentAt:number,includeSaturday=false):{date:string;time:string|null;end:string|null;evidence:string}|null {
 const text=`${subject}\n\n${content}`;
 const pattern=/\b(\d{1,2})(?:\s*(?:bis|to|[-\u2013\u2014])\s*(\d{1,2}))?\s*(?:werktag(?:e|en|es)?|business\s+days?|working\s+days?)\b/gi;
 for(const sentence of mailSentences(text,subject)){
  if(sentence.score<calendarContextThreshold)continue;
  for(const match of sentence.text.matchAll(pattern)){
  if(/(?:vor|seit|ago)\s*$/i.test(sentence.text.slice(Math.max(0,match.index!-15),match.index!)))continue;
  // The duration must describe delivery in this sentence, not a support reply in a nearby footer.
  const delivery=/(liefer|zustell|versand|paket|sendung|delivery|shipping|shipment|arriv|dispatch)/i;
  const bare=/^\s*\d{1,2}(?:\s*(?:bis|to|[-–—])\s*\d{1,2})?\s*(?:werktag(?:e|en|es)?|business\s+days?|working\s+days?)[.!]?\s*$/i.test(sentence.text);
  if(!(delivery.test(sentence.text)||bare&&delivery.test(subject)) || /(retour|widerruf|rückgabe|rueckgabe|erstattung|refund|return policy)/i.test(sentence.text))continue;
  const first=Number(match[1]),last=Number(match[2] ?? match[1]);if(first<1 || last<first || last>60)continue;
  const base=new Date(sentAt*1000);if(!Number.isFinite(+base))return null;
  const add=(count:number)=>{let date=localDate(base);while(count>0){date=shiftDate(date,1);const weekday=new Date(`${date}T12:00`).getDay();if(weekday!==0 && (includeSaturday || weekday!==6))count--;}return date;};
  const date=add(first),endDate=add(last),days=Math.round((Date.parse(endDate)-Date.parse(date))/86400000);
  return {date,time:days?'00:00':null,end:days?`${String(days*24+23).padStart(2,'0')}:59`:null,evidence:`${match[0]} · Maildatum ${localDate(base)} · ${includeSaturday?'Mo–Sa':'Mo–Fr'}, ohne Feiertagskalender`};
  }
 }
 return null;
}

/** Structured data is parsed directly; free text uses the isolated local model. */
export async function recognizeMail({ account, message }: MailPending, today = localDate(), analyzer?: MailAnalyzer): Promise<{ candidates: MailCandidate[]; notice: string }> {
  if (message.notice) return { candidates: [], notice: message.notice };
  const candidates: MailCandidate[] = [], notices: string[] = [];
  const base = { accountId: account.id, messageKey: message.key, subject: message.subject, sender: message.sender, sentAt: message.sentAt };
  async function add(item: CalendarImport, identity: string, evidence: string, automatic: boolean) {
    const endDate=item.entry.time && item.entry.end ? shiftDate(item.date,Math.floor(Number(item.entry.end.split(':')[0])/24)) : item.date;
    if (endDate < today || candidates.length >= 200) return;
    const calendarUid = `mail:${account.id}:${await hash(identity)}`;
    if (candidates.some(candidate => candidate.entry.calendarUid === calendarUid)) return;
    const description=encodeMailContent({html:message.html,text:[item.entry.description?.trim(),mailDescription(message.text || mailText(message.html))].filter(Boolean).join('\n\n'),subject:message.subject,sender:message.sender,notes:item.entry.description});
    const entry: Entry = { ...item.entry, description, id: await uuid(calendarUid), calendarUid, text: item.entry.text.slice(0, 2000), showInJournal: false, reminder: false };
    candidates.push({ ...base, date: item.date, entry, id: await uuid(`${message.key}:${calendarUid}`), evidence: evidence.slice(0, 4000), automatic });
  }
  const event = (text: string, time: string | null, end: string | null): Entry => ({ id: '', kind: 'event', text, time, end: time && end && end > time ? end : null, done: false, cancelled: false, priority: false, reminder: false, plan: null });
  const content = message.text || mailText(message.html);
  if ((!analyzer && /\b(?:abgesagt|storniert|cancelled|canceled)\b/i.test(message.subject)) || message.calendars.some(ics => /(?:METHOD:CANCEL|STATUS:CANCELLED)/i.test(ics))) {
    return { candidates, notice: t("Mögliche Absage erkannt. Vorhandenen Termin bitte im Kalender prüfen; es wurde kein neuer Eintrag angelegt.") };
  }
  for (const calendar of message.calendars) {
    try {
      const { importCalendar } = await import('./ical.ts');
      const preview = importCalendar(calendar, Number(today.slice(0, 4)));
      for (const item of preview.entries) await add(item, `ics:${item.entry.calendarUid}`, `Kalenderanhang · ${message.subject}`, true);
      notices.push(...preview.notices);
      if (preview.entries.length > 200) notices.push(t("Der Kalenderanhang enthält viele Termine. Es werden höchstens 200 zukünftige Termine pro Mail vorgeschlagen."));
    } catch { notices.push(t("Ein Kalenderanhang konnte nicht ausgewertet werden.")); }
  }
  // JSON-LD parcel/event data is preferable to interpreting dates in free text.
  function objects(value: unknown, depth = 0): Record<string, unknown>[] {
    if (depth > 10 || !value || typeof value !== 'object') return [];
    if (Array.isArray(value)) return value.slice(0, 100).flatMap(item => objects(item, depth + 1));
    const object = value as Record<string, unknown>;
    return [object, ...Object.values(object).flatMap(item => objects(item, depth + 1))];
  }
  for (const match of message.html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    try {
      for (const data of objects(JSON.parse(match[1]))) {
        const type = String(data['@type'] ?? '').replace(/^https?:\/\/schema.org\//, '');
        const start = type === 'ParcelDelivery' ? data.expectedArrivalFrom ?? data.expectedArrivalUntil : type === 'Event' ? data.startDate : null;
        if (typeof start !== 'string') continue;
        const from = isoParts(start); if (!from) continue;
        const finish = type === 'ParcelDelivery' ? data.expectedArrivalUntil : data.endDate;
        const to = typeof finish === 'string' ? isoParts(finish) : null;
        const track = typeof data.trackingNumber === 'string' ? data.trackingNumber.trim() : '';
        const name = typeof data.name === 'string' ? data.name : type === 'ParcelDelivery' ? `Lieferung${track ? ` · ${track}` : ''}` : message.subject;
        await add({ date: from.date, entry: event(name, to && to.date>from.date ? from.time ?? '00:00' : from.time, to && to.date>from.date ? `${String(Math.round((Date.parse(to.date)-Date.parse(from.date))/86400000)*24+Number((to.time ?? '23:59').split(':')[0])).padStart(2,'0')}:${(to.time ?? '23:59').split(':')[1]}` : to?.time ?? null) },
          track ? `parcel:${track}` : `structured:${message.key}:${start}`, `Strukturierte ${type === 'ParcelDelivery' ? 'Lieferankündigung' : 'Terminangabe'} · ${start}${finish ? ` – ${finish}` : ''}`, true);
      }
    } catch { notices.push(t("Strukturierte Maildaten konnten nicht vollständig gelesen werden.")); }
  }
  if (candidates.length) return { candidates, notice: [...new Set(notices)].join(' ').slice(0, 2000) };
  const workdays=deliveryWorkdayWindow(message.subject,content,message.sentAt);
  if(workdays){await add({date:workdays.date,entry:event(message.subject || 'Lieferung',workdays.time,workdays.end)},`delivery-window:${message.key}`,workdays.evidence,true);return {candidates,notice:'Lieferfenster in Werktagen erkannt; Feiertage sind nicht berücksichtigt.'};}
  if (analyzer) {
    const { extractModelEvents, prepareMailText } = await import('./mailMl.ts');
    const prepared = prepareMailText(message.subject, content);
    if (!prepared.trim()) return { candidates, notice: '' };
    const analysis = await analyzer(prepared);
    if (analysis.text !== prepared) throw new Error(t("Die Modellantwort gehört nicht zu diesem Mailtext."));
    const result = extractModelEvents(analysis, message.subject, message.sentAt, today);
    for (const item of result.events) await add({ date:item.date, entry:event(item.text,item.time,item.end) },`ml:${message.key}:${item.identity}`,item.evidence,false);
    return { candidates, notice: [...notices,result.notice].filter(Boolean).join(' ').slice(0,2000) };
  }
  if (!content.trim() && !message.subject.trim()) return { candidates, notice: '' };
  throw new Error(t("Die kontextbezogene Mailauswertung benötigt das lokale ML-Modell. Bitte die Modelleinrichtung öffnen."));
}
