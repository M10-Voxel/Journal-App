import { encodeMailContent } from './mailContent.ts';
import { shiftDate } from './dates.ts';
import { t } from './i18n.ts';
import type { CalendarImport, Entry } from './journal.ts';
import { localDate } from './dates.ts';
import type { MailAnalyzer } from './mailMl.ts';
import { mailSentences } from './mailSentences.ts';
import { calendarContextThreshold } from './mailContext.ts';

export interface MailAccount {
  id: string; provider: string; label: string; email: string; protocol: 'imap' | 'pop3' | 'gmail' | 'microsoft';
  host: string; port: number; security: 'tls' | 'starttls' | 'bridge'; username: string; folder: string;
  enabled: boolean; autoImport: boolean; senders: string; subjectFilter: string; days: number;
  clientId: string; tenant: string; lastSync?: number | null; error?: string | null;
}
export interface MailMessage { key: string; subject: string; sender: string; sentAt: number; text: string; html: string; calendars: string[]; notice?: string }
export interface MailPending { account: MailAccount; message: MailMessage }
export interface MailCandidate extends CalendarImport {
  id: string; accountId: string; messageKey: string; subject: string; sender: string; sentAt: number; evidence: string; automatic: boolean;
}
export const mailProviders = () => ([
  { id: 'gmail', name: 'Google', caption: t("Gmail · Browseranmeldung"), protocol: 'gmail', host: 'imap.gmail.com', pop: 'pop.gmail.com', help: t("Mit Google anmelden. Alternativ IMAP/POP3 mit einem von Google zugelassenen App-Passwort."), url: 'https://support.google.com/accounts/answer/185833' },
  { id: 'microsoft', name: 'Microsoft', caption: 'Outlook · Microsoft 365 · Exchange Online', protocol: 'microsoft', host: 'outlook.office365.com', pop: 'outlook.office365.com', help: t("Mit Microsoft anmelden. Firmenkonten benötigen gegebenenfalls die Freigabe ihrer Organisation. Lokale Exchange-Server können über freigegebenes IMAP eingerichtet werden."), url: 'https://learn.microsoft.com/en-us/graph/auth-register-app-v2' },
  { id: 'icloud', name: 'iCloud', caption: 'Apple Mail · IMAP', protocol: 'imap', host: 'imap.mail.me.com', pop: '', help: t("Ein anwendungsspezifisches Passwort deines Apple Accounts verwenden. iCloud unterstützt kein POP3."), url: 'https://support.apple.com/de-de/102525' },
  { id: 'gmx', name: 'GMX', caption: t("IMAP oder POP3"), protocol: 'imap', host: 'imap.gmx.net', pop: 'pop.gmx.net', help: t("POP3/IMAP zuerst im GMX-Postfach freischalten. Je nach Kontoeinstellung ist ein App-Passwort erforderlich."), url: 'https://hilfe.gmx.net/pop-imap/imap/serverdaten.html' },
  { id: 'webde', name: 'WEB.DE', caption: t("IMAP oder POP3"), protocol: 'imap', host: 'imap.web.de', pop: 'pop3.web.de', help: t("POP3/IMAP zuerst in den WEB.DE-Einstellungen einschalten. Gegebenenfalls ein App-Passwort verwenden."), url: 'https://hilfe.web.de/pop-imap/imap/imap-serverdaten.html' },
  { id: 'proton', name: 'Proton Mail', caption: t("Über Proton Mail Bridge"), protocol: 'imap', host: '127.0.0.1', pop: '', help: t("Erfordert einen bezahlten Proton-Tarif und die laufende Bridge auf diesem PC. Benutzername und Bridge-Passwort aus der Bridge übernehmen. Die lokale Bridge verwendet ein selbstsigniertes TLS-Zertifikat."), url: 'https://proton.me/support/protonmail-bridge-clients' },
  { id: 'custom', name: t("Anderer Anbieter"), caption: t("IMAP · POP3 · eigener Server"), protocol: 'imap', host: '', pop: '', help: t("Die Zugangsdaten für den Posteingang deines Anbieters verwenden. Unterstützt werden TLS und STARTTLS. Ein lokaler Exchange-Server benötigt einen freigeschalteten IMAP-/POP3-Zugang."), url: '' },
] as const);
export function newMailAccount(provider: string): MailAccount {
  const preset = mailProviders().find(item => item.id === provider) ?? mailProviders().at(-1)!;
  return { id: crypto.randomUUID(), provider: preset.id, label: '', email: '', protocol: preset.protocol,
    host: preset.host, port: provider === 'proton' ? 1143 : 993, security: provider === 'proton' ? 'bridge' : 'tls',
    username: '', folder: 'INBOX', enabled: true, autoImport: false, senders: '', subjectFilter: '', days: 14, clientId: '', tenant: 'common' };
}
async function hash(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function uuid(value: string) {
  const hex = await hash(value);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function mailText(html: string): string {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>|<style\b[^>]*>[\s\S]*?<\/style\s*>|<!--[\s\S]*?-->/gi, '')
    .replace(/<\/?(?:p|div|br|tr|h[1-6]|li)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);|&#(?:x[\da-f]+|\d+);/gi, value => {
      const named: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' };
      if (named[value.toLowerCase()]) return named[value.toLowerCase()];
      const n = value[2].toLowerCase() === 'x' ? parseInt(value.slice(3, -1), 16) : parseInt(value.slice(2, -1), 10);
      return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
    }).replace(/[\t ]+/g, ' ').replace(/\n\s*\n/g, '\n').trim();
}
/** Keep the original wording: the local classifier does not generate summaries. */
export function mailDescription(content: string): string {
  const lines: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(?:Am .+schrieb .+:|On .+wrote:|[- ]*(?:Original Message|Ursprüngliche Nachricht|Weitergeleitete Nachricht)[- ]*)\s*$/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    lines.push(line.trim());
  }
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > 2000 ? `${text.slice(0, 1999).trimEnd()}…` : text;
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
    return { candidates, notice: 'Mögliche Absage erkannt. Vorhandenen Termin bitte im Kalender prüfen; es wurde kein neuer Eintrag angelegt.' };
  }
  for (const calendar of message.calendars) {
    try {
      const { importCalendar } = await import('./ical.ts');
      const preview = importCalendar(calendar, Number(today.slice(0, 4)));
      for (const item of preview.entries) await add(item, `ics:${item.entry.calendarUid}`, `Kalenderanhang · ${message.subject}`, true);
      notices.push(...preview.notices);
      if (preview.entries.length > 200) notices.push('Der Kalenderanhang enthält viele Termine. Es werden höchstens 200 zukünftige Termine pro Mail vorgeschlagen.');
    } catch { notices.push('Ein Kalenderanhang konnte nicht ausgewertet werden.'); }
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
    } catch { notices.push('Strukturierte Maildaten konnten nicht vollständig gelesen werden.'); }
  }
  if (candidates.length) return { candidates, notice: [...new Set(notices)].join(' ').slice(0, 2000) };
  const workdays=deliveryWorkdayWindow(message.subject,content,message.sentAt);
  if(workdays){await add({date:workdays.date,entry:event(message.subject || 'Lieferung',workdays.time,workdays.end)},`delivery-window:${message.key}`,workdays.evidence,true);return {candidates,notice:'Lieferfenster in Werktagen erkannt; Feiertage sind nicht berücksichtigt.'};}
  if (analyzer) {
    const { extractModelEvents, prepareMailText } = await import('./mailMl.ts');
    const prepared = prepareMailText(message.subject, content);
    if (!prepared.trim()) return { candidates, notice: '' };
    const analysis = await analyzer(prepared);
    if (analysis.text !== prepared) throw new Error('Die Modellantwort gehört nicht zu diesem Mailtext.');
    const result = extractModelEvents(analysis, message.subject, message.sentAt, today);
    for (const item of result.events) await add({ date:item.date, entry:event(item.text,item.time,item.end) },`ml:${message.key}:${item.identity}`,item.evidence,false);
    return { candidates, notice: [...notices,result.notice].filter(Boolean).join(' ').slice(0,2000) };
  }
  if (!content.trim() && !message.subject.trim()) return { candidates, notice: '' };
  throw new Error('Die kontextbezogene Mailauswertung benötigt das lokale ML-Modell. Bitte die Modelleinrichtung öffnen.');
}

/** Only the newest announcement of an identical external event is presented. */
export function latestMailCandidates(candidates: readonly MailCandidate[]): MailCandidate[] {
  const latest = new Map<string, MailCandidate>();
  for (const candidate of candidates) {
    const key = candidate.entry.calendarUid ?? candidate.id;
    const previous = latest.get(key);
    if (!previous || candidate.sentAt >= previous.sentAt) latest.set(key, candidate);
  }
  return [...latest.values()].sort((a, b) => a.date.localeCompare(b.date) || a.entry.text.localeCompare(b.entry.text));
}
