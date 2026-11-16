import { t } from './i18n.ts';
import type { CalendarImport } from './journal.ts';

export interface MailAccount {
  id: string; provider: string; label: string; email: string; protocol: 'imap' | 'pop3' | 'gmail' | 'microsoft';
  host: string; port: number; security: 'tls' | 'starttls' | 'bridge'; username: string; folder: string;
  enabled: boolean; autoImport: boolean; senders: string; subjectFilter: string; days: number;
  clientId: string; tenant: string; lastSync?: number | null; error?: string | null;
}
export interface MailMessage { key: string; subject: string; sender: string; sentAt: number; text: string; html: string; calendars: string[]; notice?: string }
export interface MailPending { account: MailAccount; message: MailMessage }
export interface MailCandidate extends CalendarImport {
  id: string; accountId: string; messageKey: string; subject: string; sender: string; sentAt: number; evidence: string; automatic: boolean; relevance?: number;
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
/** Only the newest announcement of an identical external event is presented. */
// Recognizing a mail's appointments: mailRecognize.ts (loaded on demand).

export function latestMailCandidates(candidates: readonly MailCandidate[]): MailCandidate[] {
  const latest = new Map<string, MailCandidate>();
  for (const candidate of candidates) {
    const key = candidate.entry.calendarUid ?? candidate.id;
    const previous = latest.get(key);
    if (!previous || candidate.sentAt >= previous.sentAt) latest.set(key, candidate);
  }
  return [...latest.values()].sort((a, b) => a.date.localeCompare(b.date) || a.entry.text.localeCompare(b.entry.text));
}
