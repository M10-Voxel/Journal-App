import { t } from './i18n.ts';
import { de, en } from 'chrono-node';
import { localDate } from './dates.ts';

export interface ModelMention { text: string; field: string; score: number; start: number; end: number }
export interface ModelAnalysis { text: string; mentions: ModelMention[]; classifications: { label: string; score: number }[]; milliseconds: number }
export type MailAnalyzer = (text: string) => Promise<ModelAnalysis>;
export interface ModelEvent { date: string; text: string; time: string | null; end: string | null; identity: string; evidence: string }

export function prepareMailText(subject: string, content: string): string {
  // Do not assign an old quoted "tomorrow" to the outer mail's reference date.
  const fresh: string[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (/^\s*(?:Am .+schrieb .+:|On .+wrote:|[- ]*(?:Original Message|Ursprüngliche Nachricht|Weitergeleitete Nachricht)[- ]*)\s*$/i.test(line)) break;
    if (/^\s*>/.test(line)) continue;
    fresh.push(line);
  }
  return [subject.trim(), fresh.join('\n').trim()].filter(Boolean).join('\n\n').slice(0, 24_000);
}
function parseSpan(date: string, time: string | null, sentAt: number) {
  if (/\b(?:woche|wochen|monat|monate|jahr|jahre|week|month|year)\b/i.test(date) && !/\b(?:montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i.test(date) && !/\b\d{1,2}\.\s*[A-Za-zäöü]+/i.test(date)) return null;
  const range = time?.replace(/\bzwischen\s+/i, '').replace(/\s+und\s+/i, '-');
  const reference = new Date(sentAt * 1000);
  // A separator prevents "12. November 17 Uhr" from being read as the year 2017.
  const german = de.parse(`${date}${range ? t(" um {0}", range) : ''}`, reference, { forwardDate: true });
  const results = german.length ? german : en.parse(`${date}${range ? ` at ${range}` : ''}`, reference, { forwardDate: true });
  const result = results.find(result => result.start.isCertain('day') || result.start.isCertain('weekday'));
  if (!result) return null;
  // A model can label words like "Uhrzeit" as time; a clock must also normalize to a concrete hour.
  if (time && !result.start.isCertain('hour')) return null;
  const value = result.start.date();
  const dateString = localDate(value);
  const clock = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  const start = time && result.start.isCertain('hour') ? clock(value) : null;
  const endDate = result.end?.date();
  const end = start && endDate && result.end?.isCertain('hour') && localDate(endDate) === dateString && clock(endDate) > start ? clock(endDate) : null;
  return { date: dateString, time: start, end };
}

function completeTimeRanges(text: string, mentions: ModelMention[], sentenceAt: (position: number) => number): ModelMention[] {
  // The model may select two clocks separately, only the end, or even just its minutes.
  // Complete a written range within a model-selected time or event/date context.
  const times = mentions.filter(item => item.field === 'time');
  const clock = String.raw`(?:[01]?\d|2[0-3])(?::[0-5]\d)?(?:\s*Uhr)?`;
  const ranges = new RegExp(String.raw`(?<![\p{L}\d:])(?:(zwischen|between|von|from)\s+)?(${clock})\s*(bis(?:\s+um)?|to|until|[-–—]|und|and)\s*(${clock})(?![\p{L}\d:])`, 'giu');
  const completed: ModelMention[] = [];
  for (const match of text.matchAll(ranges)) {
    // "20 und 21 Uhr" can name two appointments; "zwischen 20 und 21 Uhr" is a range.
    if (/^(?:und|and)$/i.test(match[3]) && !/^(?:zwischen|between)$/i.test(match[1] ?? '')) continue;
    const start = match.index!, end = start + match[0].length;
    const anchors = times.filter(item => item.start < end && item.end > start);
    if (!anchors.length) {
      // A bare hour may not receive a time label at all. Require both neural event
      // and date labels nearby in the same sentence before normalizing its clocks.
      const context = mentions.filter(item => sentenceAt(item.start) === sentenceAt(start) && Math.abs(item.start - start) < 200);
      const date = context.find(item => item.field === 'date' && (
        item.end <= start && /^\s*(?:um|ab|at)?\s*$/i.test(text.slice(item.end, start)) ||
        end <= item.start && /^\s*(?:am|on)?\s*$/i.test(text.slice(end, item.start))
      )), event = context.find(item => item.field === 'event');
      if (!date || !event) continue;
      anchors.push(date, event);
    }
    completed.push({ field: 'time', text: match[0], start, end, score: Math.max(...anchors.map(item => item.score)) });
  }
  return [...times.filter(item => !completed.some(range => item.start < range.end && item.end > range.start)), ...completed].sort((a, b) => a.start - b.start);
}

/** ML chooses the contextual spans; deterministic normalization only converts those spans into calendar values. */
export function extractModelEvents(analysis: ModelAnalysis, subject: string, sentAt: number, today: string): { events: ModelEvent[]; notice: string } {
  const mentions = analysis.mentions.filter(item => Number.isFinite(item.score) && item.score >= .5 && item.start >= 0 && item.end > item.start && item.end <= analysis.text.length && analysis.text.slice(item.start, item.end) === item.text);
  const verdict = [...analysis.classifications].filter(item => Number.isFinite(item.score)).sort((a, b) => b.score - a.score);
  const first = verdict[0], margin = first ? first.score - (verdict[1]?.score ?? 0) : 0;
  if (first && first.score >= .5 && margin >= .15 && /cancelled|past event/i.test(first.label)) {
    return { events: [], notice: 'Das lokale Modell stuft den Inhalt als mögliche Absage oder rückblickende Nachricht ein. Es wurde kein neuer Termin angelegt.' };
  }
  const dates = mentions.filter(item => item.field === 'date').sort((a, b) => a.start - b.start);
  const names = mentions.filter(item => item.field === 'event');
  const places = mentions.filter(item => item.field === 'location');
  const boundaries = [...analysis.text.matchAll(/(?<!\d)[.!?](?=\s|$)/g)].map(match => match.index! + 1);
  const sentenceAt = (position: number) => boundaries.filter(end => end <= position).length;
  const times = completeTimeRanges(analysis.text, mentions, sentenceAt);
  const events: ModelEvent[] = [];
  let unclear = false;
  for (let index = 0; index < dates.length; index++) {
    const date = dates[index];
    const after = times.filter(time => time.start >= date.end && time.start < (dates[index + 1]?.start ?? analysis.text.length) && time.start - date.end < 400);
    const before = times.filter(time => time.end <= date.start && time.start > (dates[index - 1]?.end ?? -1) && date.start - time.end < 200);
    const time = after[0] ?? before.at(-1);
    if (!time && !names.length) { unclear = true; continue; }
    let normalized = parseSpan(date.text, time?.text ?? null, sentAt);
    if (!normalized && time && names.some(name => Math.abs(name.start - date.start) < 200)) {
      // Keep a concrete event date reviewable even when no usable clock was extracted.
      normalized = parseSpan(date.text, null, sentAt); unclear = true;
    }
    if (!normalized || normalized.date < today) { unclear = true; continue; }
    const nearest = (items: ModelMention[]) => [...items].sort((a, b) => Math.abs(a.start - date.start) - Math.abs(b.start - date.start))[0];
    const sameEvent = (item: ModelMention) => {
      if (dates.length === 1) return true;
      if (sentenceAt(item.start) !== sentenceAt(date.start)) return false;
      if (dates.filter(other => sentenceAt(other.start) === sentenceAt(date.start)).length === 1) return true;
      return !time || [...times].sort((a, b) => Math.abs(a.start - item.start) - Math.abs(b.start - item.start))[0] === time;
    };
    const name = nearest(names.filter(sameEvent)), place = nearest(places.filter(sameEvent));
    const title = name?.text || subject.replace(/^(?:(?:re|fw|fwd|aw|wg):\s*)+/gi, '').trim() || 'Erkannter Termin';
    const text = `${title}${place && Math.abs(place.start - date.start) < 350 ? ` · ${place.text}` : ''}`;
    const identity = `${normalized.date}:${normalized.time ?? ''}:${normalized.end ?? ''}`;
    if (events.some(item => item.identity === identity)) continue;
    const start = Math.max(0, Math.min(date.start, time?.start ?? date.start, name?.start ?? date.start) - 120);
    const end = Math.min(analysis.text.length, Math.max(date.end, time?.end ?? date.end) + 120);
    events.push({ ...normalized, text, identity, evidence: `Kontextbezogener ML-Vorschlag · bitte prüfen\n${analysis.text.slice(start, end).trim()}` });
  }
  const notice = unclear ? 'Nicht alle erkannten Angaben konnten eindeutig in ein Datum oder eine Uhrzeit umgerechnet werden. Bitte den Originaltext prüfen.' : '';
  return { events, notice };
}
