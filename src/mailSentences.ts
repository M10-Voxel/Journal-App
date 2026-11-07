import { calendarContextScore } from './mailContext.ts';

export interface MailSentence { text: string; start: number; end: number; paragraph: number; subject: boolean; score: number }
const segmenter = new Intl.Segmenter('de', { granularity: 'sentence' });
const relativeOnly = /^(?:heute|morgen|übermorgen|today|tomorrow|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)\s*[:,-]?$/iu;
const month = /^(?:januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|may|june|july|october|december)\b/iu;

/** Keep complete sentences and date/time continuations, with original UTF-16 offsets. */
export function mailSentences(text: string, subject: string): MailSentence[] {
  const sentences: MailSentence[] = [];
  const hasSubject = !!subject.trim() && text.startsWith(subject.trim() + '\n\n');
  let paragraph = 0;
  for (const block of text.matchAll(/[^\n]+(?:\n(?!\s*\n)[^\n]+)*/g)) {
    for (const item of segmenter.segment(block[0])) {
      const raw = item.segment, lead = raw.length - raw.trimStart().length;
      const start = block.index! + item.index + lead, end = start + raw.trim().length;
      if (start >= end) continue;
      const previous = sentences.at(-1);
      const continuation = previous && previous.paragraph === paragraph && (
        relativeOnly.test(previous.text) || relativeOnly.test(raw.trim()) && previous.text.length<80 && !/[.!?]$/u.test(previous.text) ||
        /\b\d{1,2}\.\s*$/u.test(previous.text) && month.test(raw.trim()) ||
        !/[.!?]$/u.test(previous.text) && previous.text.length < 160 && /^(?:zwischen|zwichen|between|von|from|um|at|\d{1,2}[:.])\b/iu.test(raw.trim())
      );
      if (continuation) { previous.end = end; previous.text = text.slice(previous.start, end); }
      else sentences.push({ text: text.slice(start, end), start, end, paragraph, subject: hasSubject && start < subject.trim().length, score: 0 });
    }
    paragraph++;
  }
  for (const [index,sentence] of sentences.entries()) sentence.score = calendarContextScore({ text: sentence.text, subject, previous: sentences[index - 1]?.paragraph === sentence.paragraph ? sentences[index - 1].text : '' });
  return sentences;
}
