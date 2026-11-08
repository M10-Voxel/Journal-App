// Repetitions written as text, in German or English: "alle 3 Wochen am Montag, Mittwoch", "every other week on tue and
// thu", "jährlich am 12. März", "last friday of the month", "Karfreitag", "täglich, 10 mal", "3 Wochen an, 1 aus", "bis 30.11.".
// Everything `describe` writes reads back. Text that names no days at all only changes the pause or end of the current rule.
import { shiftDate } from './dates.ts';
import { getLanguage, t } from './i18n.ts';
import type { Language } from './i18n.ts';
import { cleanRule, easter, weekdayIndex, weekdayOf } from './repeat.ts';
import type { RepeatOn, RepeatRule, RepeatUnit } from './repeat.ts';

export interface ParsedRepeat {
  rule: RepeatRule;
  /** Words that meant nothing here (shown, so a typo is noticed). */
  unknown: string[];
}

const pad = (value: number) => String(value).padStart(2, '0');
const make = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const daysIn = (year: number, month: number) => new Date(year, month, 0).getDate();

const numbers: Record<string, number> = {
  ein: 1, eins: 1, eine: 1, einen: 1, einem: 1, einer: 1, one: 1, a: 1, zwei: 2, two: 2, drei: 3, three: 3, vier: 4, four: 4, fünf: 5, fuenf: 5, five: 5,
  sechs: 6, six: 6, sieben: 7, seven: 7, acht: 8, eight: 8, neun: 9, nine: 9, zehn: 10, ten: 10, elf: 11, eleven: 11, zwölf: 12, zwoelf: 12, twelve: 12,
};
const ordinals: Record<string, number> = {
  erste: 1, ersten: 1, erster: 1, erstes: 1, first: 1, zweite: 2, zweiten: 2, zweiter: 2, zweites: 2, second: 2, other: 2, dritte: 3, dritten: 3, dritter: 3, drittes: 3, third: 3,
  vierte: 4, vierten: 4, vierter: 4, fourth: 4, fünfte: 5, fünften: 5, fifth: 5, letzte: -1, letzten: -1, letzter: -1, letztes: -1, last: -1,
};
const weekdayWords: [RegExp, number][] = [
  [/^(montags?|mo|mon|monday|mondays)$/, 0], [/^(dienstags?|di|tue|tues|tuesday|tuesdays)$/, 1], [/^(mittwochs?|mi|wed|weds|wednesday|wednesdays)$/, 2],
  [/^(donnerstags?|do|thu|thur|thurs|thursday|thursdays)$/, 3], [/^(freitags?|fr|fri|friday|fridays)$/, 4],
  [/^(samstags?|sonnabends?|sa|sam|sat|saturday|saturdays)$/, 5], [/^(sonntags?|so|sun|sunday|sundays)$/, 6],
];
const monthWords: [RegExp, number][] = [
  [/^(januar|jänner|jan|january)$/, 1], [/^(februar|feb|february)$/, 2], [/^(märz|maerz|mär|mrz|mar|march)$/, 3], [/^(april|apr)$/, 4], [/^(mai|may)$/, 5],
  [/^(juni|jun|june)$/, 6], [/^(juli|jul|july)$/, 7], [/^(august|aug)$/, 8], [/^(september|sep|sept)$/, 9], [/^(oktober|okt|oct|october)$/, 10],
  [/^(november|nov)$/, 11], [/^(dezember|dez|dec|december)$/, 12],
];
const units: [RegExp, RepeatUnit][] = [[/^(tage?n?|days?)$/, 'day'], [/^(wochen?|weeks?)$/, 'week'], [/^(monate?n?|months?)$/, 'month'], [/^(jahre?n?|years?)$/, 'year']];
const easterWords: [RegExp, number][] = [
  [/^(rosenmontag)$/, -48], [/^(fastnacht|faschingsdienstag|shrove ?tuesday)$/, -47], [/^(aschermittwoch|ash ?wednesday)$/, -46], [/^(gründonnerstag|maundy ?thursday)$/, -3],
  [/^(karfreitag|good ?friday)$/, -2], [/^(ostersonntag|ostern|easter ?sunday|easter)$/, 0], [/^(ostermontag|easter ?monday)$/, 1],
  [/^(christi ?himmelfahrt|himmelfahrt|ascension( ?day)?)$/, 39], [/^(pfingstsonntag|pfingsten|pentecost|whit ?sunday)$/, 49], [/^(pfingstmontag|whit ?monday)$/, 50],
  [/^(fronleichnam|corpus ?christi)$/, 60],
];
// Words that only join the others.
const fillers = new Set(['am', 'an', 'den', 'dem', 'der', 'die', 'das', 'des', 'im', 'in', 'um', 'und', 'sowie', 'oder', 'immer', 'jeweils', 'je', 'jeden', 'jede', 'jedes', 'jeder',
  'alle', 'allen', 'wiederholen', 'wiederholt', 'wiederholung', 'on', 'the', 'of', 'every', 'each', 'and', 'or', 'at', 'repeat', 'repeats', 'repeating', 'monats', 'month', 'monat', 'mal', 'x', 'times', 'zum', 'zur', 'to', 'einmal', 'once', 'a', 'nur', 'only', 'von', 'vom', 'from', 'during', 'zwischen', 'between', 'jeweils', 'immer',
  // "Pause" only introduces "3 an, 1 aus" ("pause 3 on 1 off"); the numbers carry the meaning.
  'pause', 'pausen', 'pausiere', 'pausieren']);

const find = <T,>(table: [RegExp, T][], word: string) => table.find(([pattern]) => pattern.test(word))?.[1];
const amount = (word: string | undefined) => word === undefined ? undefined : /^\d+$/.test(word) ? Number(word) : numbers[word];
const ordinal = (word: string | undefined) => word === undefined ? undefined : /^\d+(\.|st|nd|rd|th)$/.test(word) ? Number.parseInt(word) : ordinals[word];

/** The first date from `from` on that `test` accepts, looking a few years ahead. */
function firstFrom(from: string, test: (date: string) => boolean, days = 3 * 366): string | null {
  for (let step = 0, date = from; step < days; step++, date = shiftDate(date, 1)) if (test(date)) return date;
  return null;
}
/** A day and month (and maybe year) as the next such date from `from` on. */
function dateFrom(from: string, day: number, month: number, year?: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  if (year !== undefined) { const full = year < 100 ? 2000 + year : year; return day <= daysIn(full, month) ? make(full, month, day) : null; }
  const [fromYear] = from.split('-').map(Number);
  for (const candidate of [fromYear, fromYear + 1, fromYear + 2, fromYear + 3, fromYear + 4]) {
    if (day <= daysIn(candidate, month) && make(candidate, month, day) >= from) return make(candidate, month, day);
  }
  return null;
}

export function parseRepeat(text: string, current: RepeatRule): ParsedRepeat | null {
  // Words, with "12.3.", "12.03.2027", "15.", "3rd", "10x" kept whole; "mo-fr" and "–" become ranges.
  const source = text.toLowerCase().replace(/×/g, 'x').replace(/(\d)\s*x\b/g, '$1 x').replace(/[–—]/g, '-').replace(/\b([a-zäöü]+)-([a-zäöü]+)\b/g, '$1 bis $2');
  const words = source.match(/\d{1,2}\.\d{1,2}\.(\d{2,4})?|\d+(\.|st|nd|rd|th)|\d+-tägig|\d+|[a-zäöüß]+|\+|-/g) ?? [];
  const used = new Array<boolean>(words.length).fill(false);
  const take = (...indices: number[]) => { for (const index of indices) used[index] = true; };
  const start = current.start;

  let unit: RepeatUnit | undefined, every: number | undefined, on: RepeatOn | undefined, ruleStart: string | undefined;
  let weekdays: number[] = [];
  let pause: { on: number; off: number; unit?: 'day' | 'week' } | undefined, end: RepeatRule['end'] | undefined | null;
  let yearMonth: number | undefined;
  const months: number[] = [];

  for (let i = 0; i < words.length; i++) {
    if (used[i]) continue;
    const word = words[i], next = words[i + 1], after = words[i + 2];
    // End: "bis 30.11.", "until 30.11.2026", "bis zum 30. november", "until nov 30", "10 mal", "10x", "10 times", "für 2 wochen", "for 10 days", "für immer".
    if (/^(bis|until|till|through)$/.test(word)) {
      let j = i + 1;
      while (words[j] && /^(zum|to|the|am|on|einschließlich)$/.test(words[j])) j++;
      while (words[j] && find(weekdayWords, words[j]) !== undefined) j++;
      const date = readDate(j);
      if (date) { end = { until: date.value }; take(i, ...range(i + 1, date.next)); continue; }
    }
    if ((/^\d+$/.test(word) || numbers[word]) && next && /^(mal|x|times)$/.test(next) && !/^(im|in)$/.test(after ?? '')) {
      end = { count: amount(word)! }; take(i, i + 1); continue;
    }
    if (/^\d+x$/.test(word)) { end = { count: Number.parseInt(word) }; take(i); continue; }
    if (/^(für|for)$/.test(word)) {
      if (/^(immer|ever)$/.test(next ?? '')) { end = null; take(i, i + 1); continue; }
      const count = amount(next), per = after === undefined ? undefined : find(units, after);
      if (count && per) {
        const until = per === 'day' ? shiftDate(start, count - 1) : per === 'week' ? shiftDate(start, count * 7 - 1) : shiftDate(addMonths(start, per === 'month' ? count : count * 12), -1);
        end = { until }; take(i, i + 1, i + 2); continue;
      }
    }
    if (/^(forever|endlos)$/.test(word) || (word === 'ohne' && next === 'ende') || (word === 'no' && next === 'end')) { end = null; take(i, ...(word === 'ohne' || word === 'no' ? [i + 1] : [])); continue; }
    // Pause: "3 wochen an, 1 woche aus", "3 an 1 aus", "3 weeks on 1 week off".
    {
      const first = amount(word);
      if (first) {
        let j = i + 1, pauseUnit: 'day' | 'week' | undefined;
        const unitAt = (index: number) => { const value = words[index] && find(units, words[index]); return value === 'day' || value === 'week' ? value : undefined; };
        if (unitAt(j)) { pauseUnit = unitAt(j); j++; }
        if (/^(an|on)$/.test(words[j] ?? '')) {
          let k = j + 1;
          const second = amount(words[k]);
          if (second) {
            k++;
            if (unitAt(k)) { pauseUnit ??= unitAt(k); k++; }
            if (/^(aus|off|pause)$/.test(words[k] ?? '')) {
              pause = { on: first, off: second, unit: pauseUnit };
              take(...range(i, k + 1)); continue;
            }
          }
        }
      }
    }
    // Easter-based holidays, also of two words ("good friday", "christi himmelfahrt").
    {
      const two = next ? `${word} ${next}` : '';
      const offset = (two ? find(easterWords, two) : undefined) ?? find(easterWords, word);
      if (offset !== undefined) {
        const [year] = start.split('-').map(Number);
        const candidates = [year, year + 1].map(value => shiftDate(easter(value), offset));
        ruleStart = candidates.find(date => date >= start) ?? candidates[1];
        unit = 'year'; on = 'easter'; take(i, ...(two !== '' && find(easterWords, two) !== undefined ? [i + 1] : [])); continue;
      }
    }
    // Weekday positions: "am 2. Dienstag", "letzter Freitag im Monat", "the last friday of the month", "4. Do im Nov", "second sunday of may".
    {
      const nth = ordinal(word);
      const day = next === undefined ? undefined : find(weekdayWords, next);
      if (nth !== undefined && day !== undefined && (nth === -1 || (nth >= 1 && nth <= 4))) {
        let j = i + 2;
        while (words[j] && /^(im|in|of|the|des|monats|month|monat)$/.test(words[j])) j++;
        const month = words[j] ? find(monthWords, words[j]) : undefined;
        if (month !== undefined) { yearMonth = month; unit ??= 'year'; j++; } else { j = i + 2; while (words[j] && /^(im|in|of|the|monats|month|monat)$/.test(words[j])) j++; }
        on = nth === -1 ? 'last-weekday' : 'weekday';
        ruleStart = positionFrom(start, nth, day, month);
        take(...range(i, j)); continue;
      }
      // "am letzten Tag (im Monat)", "last day of the month", "Monatsende", "Monatsletzten".
      if (nth === -1 && next && /^(tag|tage|day)$/.test(next) || /^(monatsende|monatsletzte[nr]?|ultimo)$/.test(word) || (word === 'end' && next === 'of')) {
        let j = word === 'end' ? i + 2 : /^(monatsende|monatsletzte[nr]?|ultimo)$/.test(word) ? i + 1 : i + 2;
        while (words[j] && /^(im|in|of|the|des|monats|month|monat)$/.test(words[j])) j++;
        const month = words[j] ? find(monthWords, words[j]) : undefined;
        if (month !== undefined) { yearMonth = month; unit ??= 'year'; j++; }
        on = 'last-day';
        const [year, startMonth] = start.split('-').map(Number);
        ruleStart = month !== undefined ? dateFrom(start, daysIn(year, month), month) ?? make(year + 1, month, daysIn(year + 1, month)) : make(year, startMonth, daysIn(year, startMonth));
        take(...range(i, j)); continue;
      }
    }
    // Dates: "12.3.", "12.03.2027", "12. März", "12 march", "march 12", "12th of march", and days of the month: "am 15.", "on the 15th".
    {
      const date = readDate(i);
      if (date) {
        yearMonth = date.month; unit ??= 'year'; on = 'date'; ruleStart = date.value; take(...range(i, date.next)); continue;
      }
      const dayOfMonth = /^\d{1,2}(\.|st|nd|rd|th)$/.test(word) ? Number.parseInt(word) : undefined;
      // Not "3rd day" (an interval) nor "2. Dienstag" (a position).
      if (dayOfMonth && dayOfMonth <= 31 && (next === undefined || (find(weekdayWords, next) === undefined && find(units, next) === undefined))) {
        on = 'date';
        ruleStart = firstFrom(start, date => Number(date.slice(8)) === dayOfMonth, 400) ?? start;
        take(i); continue;
      }
    }
    // Intervals and units: "alle 3 wochen", "every 2 days", "jede zweite Woche", "every other month", "jeden 3. Tag", "täglich", "weekly" …
    {
      const interval = amount(word) ?? (/^\d+\.$/.test(word) ? Number.parseInt(word) : ordinal(word));
      const per = next === undefined ? undefined : find(units, next);
      if (interval && interval > 0 && per) { unit = per; every = interval; take(i, i + 1); continue; }
      const alone = find(units, word);
      if (alone) { unit = alone; take(i); continue; }
      const adverb = ({ täglich: ['day', 1], daily: ['day', 1], wöchentlich: ['week', 1], weekly: ['week', 1], monatlich: ['month', 1], monthly: ['month', 1], jährlich: ['year', 1], yearly: ['year', 1],
        annually: ['year', 1], annual: ['year', 1], zweiwöchentlich: ['week', 2], vierzehntägig: ['week', 2], biweekly: ['week', 2], fortnightly: ['week', 2], halbjährlich: ['month', 6],
        quartalsweise: ['month', 3], vierteljährlich: ['month', 3], quarterly: ['month', 3], geburtstag: ['year', 1], birthday: ['year', 1], jahrestag: ['year', 1], anniversary: ['year', 1] } as Record<string, [RepeatUnit, number]>)[word];
      if (adverb) { [unit, every] = [adverb[0], every ?? adverb[1]]; take(i); continue; }
      const days = /^(\d+)-tägig$/.exec(word);
      if (days) { const count = Number(days[1]); [unit, every] = count % 7 === 0 ? ['week', count / 7] : ['day', count]; take(i); continue; }
    }
    // Months on their own restrict the days: "jeden Mittwoch im März", "täglich von Mai bis September", "mondays in june and july".
    {
      const month = find(monthWords, word);
      if (month !== undefined) {
        const to = /^(bis|to|through|thru|-)$/.test(next ?? '') && after ? find(monthWords, after) : undefined;
        if (to !== undefined) { for (let value = month; ; value = value % 12 + 1) { months.push(value); if (value === to) break; } take(i, i + 1, i + 2); continue; }
        months.push(month); take(i); continue;
      }
    }
    // Weekdays, lists and ranges: "Mo, Mi", "montags und donnerstags", "mo-fr", "monday to friday", "werktags", "weekdays", "am Wochenende".
    {
      const day = find(weekdayWords, word);
      if (day !== undefined) {
        // "Mo bis Fr" is a range, "Mo bis Fr 20.11." an end on that Friday.
        const to = /^(bis|to|through|thru|-)$/.test(next ?? '') && after && !readDate(i + 3) ? find(weekdayWords, after) : undefined;
        if (to !== undefined) { for (let value = day; ; value = (value + 1) % 7) { weekdays.push(value); if (value === to) break; } take(i, i + 1, i + 2); continue; }
        weekdays.push(day); take(i); continue;
      }
      if (/^(werktags|wochentags|werktage|werktagen|weekdays|weekday|workdays)$/.test(word)) { weekdays.push(0, 1, 2, 3, 4); take(i); continue; }
      if (/^(wochenende|wochenenden|weekend|weekends)$/.test(word)) { weekdays.push(5, 6); take(i); continue; }
    }
  }

  function readDate(i: number): { value: string; month: number; next: number } | null {
    const word = words[i], next = words[i + 1], after = words[i + 2];
    if (!word) return null;
    const numeric = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})?$/.exec(word);
    if (numeric) { const value = dateFrom(start, Number(numeric[1]), Number(numeric[2]), numeric[3] ? Number(numeric[3]) : undefined); return value ? { value, month: Number(numeric[2]), next: i + 1 } : null; }
    const yearAt = (index: number) => words[index] && /^\d{4}$/.test(words[index]) ? Number(words[index]) : undefined;
    const day = /^\d{1,2}(\.|st|nd|rd|th)?$/.test(word) ? Number.parseInt(word) : undefined;
    if (day !== undefined) {
      const skip = next === 'of' ? 1 : 0;
      const month = words[i + 1 + skip] ? find(monthWords, words[i + 1 + skip]) : undefined;
      if (month !== undefined) { const year = yearAt(i + 2 + skip); const value = dateFrom(start, day, month, year); return value ? { value, month, next: i + 2 + skip + (year ? 1 : 0) } : null; }
    }
    const month = find(monthWords, word);
    if (month !== undefined && next && /^\d{1,2}(\.|st|nd|rd|th)?$/.test(next)) {
      const year = after && /^\d{4}$/.test(after) ? Number(after) : undefined;
      const value = dateFrom(start, Number.parseInt(next), month, year);
      return value ? { value, month, next: i + 2 + (year ? 1 : 0) } : null;
    }
    return null;
  }

  const unknown = words.filter((word, index) => !used[index] && !fillers.has(word) && !/^[+-]$/.test(word));
  weekdays = [...new Set(weekdays)].sort();
  const pattern = unit !== undefined || weekdays.length > 0 || on !== undefined;
  const inMonths = (date: string) => !months.length || months.includes(Number(date.slice(5, 7)));
  if (!pattern && pause === undefined && end === undefined && !months.length) return null;
  if (!pattern) {
    // Only the pause, end or months of the rule there is.
    const rule: RepeatRule = { ...current, ...pause !== undefined ? { pause: { ...pause, unit: pause.unit ?? (current.unit === 'day' ? 'day' : 'week') } } : {}, ...end !== undefined ? { end } : {}, ...months.length ? { months } : {} };
    if (months.length && !inMonths(rule.start)) rule.start = firstFrom(rule.start, date => inMonths(date) && (rule.unit !== 'week' || (rule.weekdays ?? [weekdayOf(current.start)]).includes(weekdayOf(date))), 400) ?? rule.start;
    return { rule: cleanRule(rule), unknown };
  }
  if (weekdays.length && unit === undefined) unit = 'week';
  if (unit === undefined) unit = on === 'easter' || yearMonth !== undefined ? 'year' : 'month';
  if (unit === 'week' && !weekdays.length && on !== undefined) unit = 'month';
  let first = ruleStart ?? start;
  if (unit === 'week' && weekdays.length) first = firstFrom(start, date => weekdays.includes(weekdayOf(date)) && inMonths(date), months.length ? 400 : 7) ?? start;
  else if (months.length && unit !== 'year' && !inMonths(first)) first = firstFrom(first, date => inMonths(date) && (unit === 'day' || Number(date.slice(8)) === Number(first.slice(8))), 400) ?? first;
  if (unit === 'month' && on === 'easter') unit = 'year';
  const rule: RepeatRule = { start: first, unit, every: every ?? 1, ...unit === 'week' ? { weekdays: weekdays.length ? weekdays : [weekdayOf(first)] } : {},
    ...(unit === 'month' || unit === 'year') ? { on: on ?? 'date' } : {}, ...pause ? { pause: { ...pause, unit: unit === 'week' ? 'week' as const : pause.unit ?? 'day' } } : {}, ...end ? { end } : {}, ...months.length && unit !== 'year' ? { months } : {} };
  if (rule.end?.until && rule.end.until < rule.start) rule.end = { until: rule.start };
  return { rule: cleanRule(rule), unknown };
}

function range(from: number, to: number) { return Array.from({ length: Math.max(0, to - from) }, (_, index) => from + index); }
function addMonths(date: string, months: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const index = month - 1 + months, targetYear = year + Math.floor(index / 12), targetMonth = index % 12 + 1;
  return make(targetYear, targetMonth, Math.min(day, daysIn(targetYear, targetMonth)));
}
/** The first `nth` (or last: -1) `weekday` of a month from `from` on – of `month` only when given. */
function positionFrom(from: string, nth: number, weekday: number, month?: number): string {
  const fits = (date: string) => weekdayOf(date) === weekday && (month === undefined || Number(date.slice(5, 7)) === month)
    && (nth === -1 ? Number(date.slice(8)) + 7 > daysIn(Number(date.slice(0, 4)), Number(date.slice(5, 7))) : weekdayIndex(date) === nth);
  return firstFrom(from, fits, month === undefined ? 400 : 3 * 366) ?? from;
}
// Complete in the display language first; the other language is a fallback only.
const german = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag', 'montags', 'dienstags', 'mittwochs', 'donnerstags', 'freitags', 'samstags', 'sonntags',
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
  'täglich', 'wöchentlich', 'monatlich', 'jährlich', 'werktags', 'Wochenende', 'zweiwöchentlich', 'alle', 'jeden', 'jede', 'jedes', 'Tage', 'Tag', 'Wochen', 'Woche', 'Monate', 'Monat', 'Jahre', 'Jahr',
  'ersten', 'zweiten', 'dritten', 'vierten', 'letzten', 'Monatsende', 'mal', 'bis', 'für', 'nur', 'von', 'Pause', 'an', 'aus', 'Geburtstag',
  'Karfreitag', 'Ostersonntag', 'Ostermontag', 'Pfingstsonntag', 'Pfingstmontag', 'Christi Himmelfahrt', 'Fronleichnam', 'Rosenmontag', 'Aschermittwoch', 'Gründonnerstag'];
const english = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'mondays', 'tuesdays', 'wednesdays', 'thursdays', 'fridays', 'saturdays', 'sundays',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'daily', 'weekly', 'monthly', 'yearly', 'weekdays', 'weekends', 'biweekly', 'every', 'other', 'days', 'day', 'weeks', 'week', 'months', 'month', 'years', 'year',
  'first', 'second', 'third', 'fourth', 'last', 'times', 'until', 'for', 'only', 'from', 'pause', 'on', 'off', 'birthday', 'Good Friday', 'Easter Monday', 'Easter Sunday', 'Pentecost', 'Whit Monday', 'Ascension Day'];

/** The rest of the word at the end of `text` that would complete it ("jeden Mit" → "twoch"), or "" when none fits. */
export function completion(text: string, preferred: Language = getLanguage()): string {
  const match = /([a-zäöüß]+(?: [a-zäöüß]+)?)$/i.exec(text);
  if (!match) return '';
  const primary = preferred === 'en' ? english : german;
  const words = [...primary, ...(preferred === 'en' ? german : english)];
  // The last word alone, or with the one before it for names of two words ("Good Fr" → "iday").
  for (const typed of [match[1], match[1].split(' ').at(-1)!]) {
    if (typed.length < 2) continue;
    // The shortest fitting word (in the order above), in the plural after a number above one ("3 Wo" → "Wochen").
    const candidates = words.filter(candidate => candidate.length > typed.length && candidate.toLowerCase().startsWith(typed.toLowerCase()));
    const local = candidates.filter(word => primary.includes(word));
    const fitting = local.length ? local : candidates;
    let word = fitting.reduce<string | undefined>((best, candidate) => !best || candidate.length < best.length ? candidate : best, undefined);
    const count = /(\d+)\s+\S*$/.exec(text)?.[1];
    if (word && count && Number(count) > 1) word = fitting.find(candidate => candidate.toLowerCase() === `${word!.toLowerCase()}n` || candidate.toLowerCase() === `${word!.toLowerCase()}s`) ?? word;
    if (word) return word.slice(typed.length);
  }
  return '';
}

// What each known word does, for the suggestion list.
const roles: [RegExp, string][] = [
  [/^(montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag|monday|tuesday|wednesday|thursday|friday|saturday|sunday)$/i, 'Wochentag'],
  [/^(montags|dienstags|mittwochs|donnerstags|freitags|samstags|sonntags|mondays|tuesdays|wednesdays|thursdays|fridays|saturdays|sundays)$/i, 'Wochentag · jede Woche'],
  [/^(januar|februar|märz|april|mai|juni|juli|august|september|oktober|november|dezember|january|february|march|may|june|july|october|december)$/i, 'Monat'],
  [/^(tage?|wochen?|monate?|jahre?|days?|weeks?|months?|years?)$/i, 'Einheit · alle n …'],
  [/^(täglich|daily)$/i, 'jeden Tag'], [/^(wöchentlich|weekly)$/i, 'jede Woche'], [/^(monatlich|monthly)$/i, 'jeden Monat'], [/^(jährlich|yearly)$/i, 'jedes Jahr'],
  [/^(zweiwöchentlich|biweekly)$/i, 'alle 2 Wochen'], [/^(werktags|weekdays)$/i, 'Mo – Fr'], [/^(wochenende|weekends)$/i, 'Sa und So'],
  [/^(alle|every)$/i, 'alle n Tage/Wochen …'], [/^(jeden|jede|jedes)$/i, 'jede(n) …'], [/^other$/i, 'jede zweite'],
  [/^(ersten|zweiten|dritten|vierten|first|second|third|fourth)$/i, 'Position im Monat'], [/^(letzten|last)$/i, 'letzter … im Monat'],
  [/^monatsende$/i, 'letzter Tag im Monat'], [/^(mal|times)$/i, 'Ende nach n-mal'], [/^(bis|until)$/i, 'Ende an einem Datum'], [/^(für|for)$/i, 'Dauer: für n Wochen …'],
  [/^(nur|only|von|from)$/i, 'nur in Monaten'], [/^(pause|an|aus|on|off)$/i, 'Pause: n an, n aus'], [/^(geburtstag|birthday)$/i, 'jedes Jahr am Datum'],
];
const holidayRole = (word: string) => { const offset = find(easterWords, word.toLowerCase()); return offset === undefined ? undefined : `${getLanguage() === 'en' ? 'Holiday · Easter' : 'Feiertag · Ostern'} ${offset === 0 ? '' : offset > 0 ? `+${offset}` : `−${-offset}`}`.trim(); };
const roleOf = (word: string) => roles.find(([pattern]) => pattern.test(word))?.[1] ?? holidayRole(word) ?? '';

export interface Suggestion { word: string; description: string; matches: number[]; prefix: boolean }
/**
 * Words for the one being typed, like an editor's completions: those that begin with it first (shortest first, in the
 * plural after a number above one), then those that contain its letters in order ("mtw" → Mittwoch). `matches` are the
 * letters typed, to show in bold.
 */
export function suggestions(text: string, limit = 6, preferred: Language = getLanguage()): Suggestion[] {
  const match = /([a-zäöüß]+)$/i.exec(text);
  if (!match) return [];
  const typed = match[1].toLowerCase();
  const before = text.slice(0, match.index);
  // A word already complete needs nothing (Enter then finishes writing).
  if ([...german, ...english].some(word => word.toLowerCase() === typed)) return [];
  const english_ = preferred === 'en';
  const words = [...new Set(english_ ? [...english, ...german] : [...german, ...english])];
  // The other language's words come after the text's own.
  const foreign = new Set(english_ ? german : english);
  const count = /(\d+)\s+$/.exec(before)?.[1];
  // In a pause ("3 an, 1 aus"): after the first number "an"/"on" comes first, after "n an m" then "aus"/"off".
  const pauseOff = /(?:^|\s)(?:an|on)\s+\d+\s+(?:(?:tage?|wochen?|days?|weeks?)\s+)?$/i.test(before);
  const pauseOn = !pauseOff && /\d+\s+(?:(?:tage?|wochen?|days?|weeks?),?\s+)?$/i.test(before);
  // Elsewhere these short words would otherwise lead the list for a single letter.
  const pauseBoost = (lower: string) => (pauseOn && (lower === 'an' || lower === 'on')) || (pauseOff && (lower === 'aus' || lower === 'off')) ? -60
    : ['an', 'on', 'aus', 'off'].includes(lower) && !pauseOn && !pauseOff ? 40 : 0;
  const scored: (Suggestion & { score: number })[] = [];
  for (const [order, word] of words.entries()) {
    const lower = word.toLowerCase();
    if (lower === typed) continue;
    if (lower.startsWith(typed)) {
      // A plural is the singular with one more letter (Tag/Tage, Woche/Wochen, day/days).
      const plural = count && Number(count) > 1 && words.some(other => other.toLowerCase() === lower.slice(0, -1)) ? -50 : 0;
      scored.push({ word, description: roleOf(word), matches: [...typed].map((_, index) => index), prefix: true, score: lower.length * 10 + order / 100 + plural + pauseBoost(lower) + (foreign.has(word) ? 60 : 0) });
      continue;
    }
    if (typed.length < 2) continue;
    // Letters in order, each after the last; closer together and earlier is better.
    const matches: number[] = [];
    let from = 0;
    for (const letter of typed) { const at = lower.indexOf(letter, from); if (at < 0) break; matches.push(at); from = at + 1; }
    if (matches.length === typed.length) scored.push({ word, description: roleOf(word), matches, prefix: false, score: 1000 + (matches.at(-1)! - matches[0]) * 20 + matches[0] * 5 + lower.length + order / 100 });
  }
  const primary = new Set(english_ ? english : german);
  const local = scored.filter(item => primary.has(item.word));
  return (local.length ? local : scored).sort((a, b) => a.score - b.score).slice(0, limit).map(({ score: _, ...item }) => ({ ...item, description: t(item.description) }));
}
