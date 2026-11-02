// Repeating entries. A rule describes which days an entry recurs on, starting with its first day (`start`, which is
// always an occurrence, like DTSTART in iCalendar). Occurrences are real entries; see `Repeat` in journal.ts.
import { shiftDate } from './dates.ts';
import { getLanguage, t } from './i18n.ts';

export type RepeatUnit = 'day' | 'week' | 'month' | 'year';
/**
 * Where in a month an occurrence falls (monthly and yearly), taken from the start date: the same date (clamped to the
 * month's last day, so "the 31st" is the 30th in April and a birthday on 29 Feb the 28th in other years), the same
 * weekday position ("2nd Tuesday"), the last such weekday ("last Friday"), the month's last day, or – yearly only –
 * the same distance to Easter Sunday (Good Friday, Whit Monday …).
 */
export type RepeatOn = 'date' | 'weekday' | 'last-weekday' | 'last-day' | 'easter';
export interface RepeatRule {
  start: string;
  unit: RepeatUnit;
  /** Every n days, weeks, months or years. */
  every: number;
  /** Weekly: the days, 0 = Monday … 6 = Sunday (the start's weekday without). */
  weekdays?: number[];
  /** Monthly and yearly. */
  on?: RepeatOn;
  /**
   * Alternating periods (daily and weekly rules): `on` periods with occurrences, then `off` without (3 weeks on, 1 off).
   * Weeks count from the start's week for weekly rules, otherwise periods count from the start itself.
   */
  pause?: { on: number; off: number; unit: 'day' | 'week' } | null;
  /** After `count` occurrences (the start included) or on `until` (inclusive); open-ended without. */
  end?: { count?: number; until?: string } | null;
  /** Daily, weekly and monthly rules: only in these months, 1 = January ("jeden Mittwoch im März"). */
  months?: number[] | null;
}

const pad = (value: number) => String(value).padStart(2, '0');
const parts = (date: string) => date.split('-').map(Number) as [number, number, number];
const make = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;
const daysIn = (year: number, month: number) => new Date(year, month, 0).getDate();
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (date: string) => { const [y, m, d] = parts(date); return (new Date(y, m - 1, d, 12).getDay() + 6) % 7; };
const dayNumber = (date: string) => { const [y, m, d] = parts(date); return Math.round(Date.UTC(y, m - 1, d) / 86_400_000); };
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

/** Easter Sunday (Gregorian calendar, anonymous algorithm). */
export function easter(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return make(year, month, day);
}
export const easterOffset = (date: string) => daysBetween(easter(parts(date)[0]), date);
/** 1–5: which of its weekday in the month the date is. */
export const weekdayIndex = (date: string) => Math.ceil(parts(date)[2] / 7);
/** Whether no later day of the month has the same weekday. */
export const isLastWeekday = (date: string) => { const [y, m, d] = parts(date); return d + 7 > daysIn(y, m); };
const weekdaysOf = (rule: RepeatRule) => [...new Set(rule.weekdays?.length ? rule.weekdays : [weekdayOf(rule.start)])].sort();

/** The day in `year`-`month` a monthly or yearly rule falls on, or null when that month has none (a 5th weekday). */
function dayInMonth(rule: RepeatRule, year: number, month: number): string | null {
  const [, , startDay] = parts(rule.start);
  const last = daysIn(year, month), weekday = weekdayOf(rule.start);
  switch (rule.on ?? 'date') {
    case 'last-day': return make(year, month, last);
    case 'last-weekday': return make(year, month, last - (weekdayOf(make(year, month, last)) - weekday + 7) % 7);
    case 'weekday': {
      const first = 1 + (weekday - weekdayOf(make(year, month, 1)) + 7) % 7;
      const day = first + 7 * (weekdayIndex(rule.start) - 1);
      return day <= last ? make(year, month, day) : null;
    }
    default: return make(year, month, Math.min(startDay, last));
  }
}

/** Candidate days in ascending order, the start first; pause and end are applied by `occurrences`. */
function* candidates(rule: RepeatRule): Generator<string> {
  const every = Math.max(1, Math.floor(rule.every) || 1);
  const [startYear, startMonth] = parts(rule.start);
  yield rule.start;
  const later = function* (dates: Iterable<string | null>) { for (const date of dates) if (date && date > rule.start) yield date; };
  if (rule.unit === 'day') {
    for (let step = 1; ; step++) yield shiftDate(rule.start, step * every);
  } else if (rule.unit === 'week') {
    const days = weekdaysOf(rule);
    const monday = shiftDate(rule.start, -weekdayOf(rule.start));
    for (let week = 0; ; week++) yield* later(days.map(day => shiftDate(monday, week * every * 7 + day)));
  } else if (rule.unit === 'month') {
    for (let step = 0; step < 100_000; step++) {
      const index = startMonth - 1 + step * every;
      yield* later([dayInMonth(rule, startYear + Math.floor(index / 12), index % 12 + 1)]);
    }
  } else {
    const offset = easterOffset(rule.start);
    for (let step = 0; step < 10_000; step++) {
      const year = startYear + step * every;
      yield* later([rule.on === 'easter' ? shiftDate(easter(year), offset) : dayInMonth(rule, year, startMonth)]);
    }
  }
}

const monthsOf = (rule: RepeatRule) => rule.unit !== 'year' && rule.months?.length && rule.months.length < 12 ? [...new Set(rule.months)].sort((a, b) => a - b) : null;
/** Whether the date lies in one of the rule's months (always without a restriction). */
export const inMonths = (rule: RepeatRule, date: string) => { const months = monthsOf(rule); return !months || months.includes(Number(date.slice(5, 7))); };

/** With a pause: whether the date lies in an "on" period. */
function inActivePeriod(rule: RepeatRule, date: string): boolean {
  const pause = rule.unit === 'day' || rule.unit === 'week' ? rule.pause : null;
  if (!pause || pause.on < 1 || pause.off < 1) return true;
  const size = pause.unit === 'week' ? 7 : 1;
  const origin = rule.unit === 'week' ? shiftDate(rule.start, -weekdayOf(rule.start)) : rule.start;
  return Math.floor(daysBetween(origin, date) / size) % (pause.on + pause.off) < pause.on;
}

/** The occurrences from `from` to `to` (inclusive), at most `limit` of them. */
export function occurrences(rule: RepeatRule, from: string, to: string, limit = 5000): string[] {
  const result: string[] = [];
  const until = rule.end?.until, count = rule.end?.count;
  let counted = 0;
  for (const date of candidates(rule)) {
    if (date > to || (until && date > until) || result.length >= limit) break;
    if (date !== rule.start && (!inActivePeriod(rule, date) || !inMonths(rule, date))) continue;
    counted += 1;
    if (count && counted > count) break;
    if (date >= from) result.push(date);
  }
  return result;
}

/** The date of the last occurrence a rule can have, or null when it is open-ended. */
export function lastOccurrence(rule: RepeatRule): string | null {
  if (rule.end?.until) return occurrences(rule, rule.start, rule.end.until).at(-1) ?? rule.start;
  if (rule.end?.count) return occurrences(rule, rule.start, '9999-12-31', rule.end.count).at(-1) ?? rule.start;
  return null;
}

export const weekdayShort = () => getLanguage() === 'en' ? ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] : ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const monthShort = () => getLanguage() === 'en' ? ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] : ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
/** The unit in the singular and plural: "Woche", "Wochen". */
export const unitNames = (): Record<RepeatUnit, [string, string]> => getLanguage() === 'en' ? { day:['day','days'],week:['week','weeks'],month:['month','months'],year:['year','years'] } : { day: ['Tag', 'Tage'], week: ['Woche', 'Wochen'], month: ['Monat', 'Monate'], year: ['Jahr', 'Jahre'] };
const adverbs: Record<RepeatUnit, string> = { day: 'Täglich', week: 'Wöchentlich', month: 'Monatlich', year: 'Jährlich' };
const easterNames: Record<number, string> = { [-48]: 'Rosenmontag', [-47]: 'Fastnacht', [-46]: 'Aschermittwoch', [-3]: 'Gründonnerstag', [-2]: 'Karfreitag', [0]: 'Ostersonntag', [1]: 'Ostermontag', [39]: 'Christi Himmelfahrt', [49]: 'Pfingstsonntag', [50]: 'Pfingstmontag', [60]: 'Fronleichnam' };
export const easterName = (offset: number) => easterNames[offset] ? t(easterNames[offset]) : `${getLanguage() === 'en' ? 'Easter' : 'Ostern'} ${offset > 0 ? '+' : '−'}${Math.abs(offset)}`;
/** "Mo 2.11." */
export const formatOccurrence = (date: string) => `${weekdayShort()[weekdayOf(date)]} ${parts(date)[2]}.${parts(date)[1]}.`;

function englishOn(rule: Pick<RepeatRule, 'start' | 'unit' | 'on' | 'every'>, sentence: boolean): string {
  const [, month, day] = parts(rule.start), weekday = weekdayShort()[weekdayOf(rule.start)];
  const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th'}`;
  const inMonth = sentence && rule.unit === 'year' ? ` in ${monthShort()[month-1]}` : '';
  const prefix = sentence ? 'on ' : '';
  switch (rule.on ?? 'date') {
    case 'weekday': return `${prefix}${ordinal(weekdayIndex(rule.start))} ${weekday}${inMonth}`;
    case 'last-weekday': return `${prefix}last ${weekday}${inMonth}`;
    case 'last-day': return sentence ? `on last day of the month${inMonth}` : 'Month end';
    case 'easter': return `${sentence ? '· ' : ''}${easterName(easterOffset(rule.start))}`;
    default: return `${prefix}${rule.unit === 'year' ? `${day} ${monthShort()[month-1]}` : ordinal(day)}`;
  }
}

/** The choice of a monthly or yearly position as a short label: "30.", "30. Okt", "2. Fr", "letzter Fr", "Monatsende", "Karfreitag". */
export function onLabel(start: string, unit: RepeatUnit, on: RepeatOn): string {
  if (getLanguage() === 'en') return englishOn({ start, unit, on, every:1 }, false);
  const [, month, day] = parts(start), weekday = weekdayShort()[weekdayOf(start)];
  switch (on) {
    case 'weekday': return `${weekdayIndex(start)}. ${weekday}`;
    case 'last-weekday': return `letzter ${weekday}`;
    case 'last-day': return 'Monatsende';
    case 'easter': return easterName(easterOffset(start));
    default: return unit === 'year' ? `${day}. ${monthShort()[month - 1]}` : `${day}.`;
  }
}
/** "am 30." / "am 2. Di" / "am letzten Fr" / "am Monatsende" – yearly in the start's month ("am 2. So im Mai"). */
function describeOn(rule: RepeatRule): string {
  const [, month, day] = parts(rule.start);
  const weekday = weekdayShort()[weekdayOf(rule.start)], inMonth = rule.unit === 'year' ? ` im ${monthShort()[month - 1]}` : '';
  switch (rule.on ?? 'date') {
    case 'weekday': return `am ${weekdayIndex(rule.start)}. ${weekday}${inMonth}`;
    case 'last-weekday': return `am letzten ${weekday}${inMonth}`;
    case 'last-day': return `am Monatsende${inMonth}`;
    case 'easter': return `· ${easterName(easterOffset(rule.start))}`;
    default: return rule.unit === 'year' ? `am ${day}. ${monthShort()[month - 1]}` : `am ${day}.`;
  }
}

const sameDays = (a: readonly number[], b: readonly number[]) => a.length === b.length && a.every(day => b.includes(day));
/** Which days, as a short German phrase: "Alle 4 Wochen am Mo, Do, Fr", "Werktags", "Jährlich am 12. Mär". */
export function describePattern(rule: RepeatRule): string {
  if (getLanguage() === 'en') {
    const every = Math.max(1, rule.every);
    const lead = every === 1 ? ({day:'Daily',week:'Weekly',month:'Monthly',year:'Yearly'})[rule.unit] : `Every ${every} ${unitNames()[rule.unit][1]}`;
    if (rule.unit === 'day') return lead;
    if (rule.unit !== 'week') return `${lead} ${englishOn(rule, true)}`;
    const days = weekdaysOf(rule);
    if (sameDays(days,[0,1,2,3,4])) return every === 1 ? 'Weekdays' : `${lead} on weekdays`;
    if (days.length === 7) return every === 1 ? 'Daily' : `${lead} every day`;
    return `${lead} on ${days.map(day=>weekdayShort()[day]).join(', ')}`;
  }
  const every = Math.max(1, rule.every);
  const lead = every === 1 ? adverbs[rule.unit] : `Alle ${every} ${unitNames()[rule.unit][1]}`;
  if (rule.unit === 'day') return lead;
  if (rule.unit !== 'week') return `${lead} ${describeOn(rule)}`;
  const days = weekdaysOf(rule);
  if (sameDays(days, [0, 1, 2, 3, 4])) return every === 1 ? 'Werktags' : `${lead} werktags`;
  if (days.length === 7) return every === 1 ? 'Täglich' : `${lead} jeden Tag`;
  return `${lead} am ${days.map(day => weekdayShort()[day]).join(', ')}`;
}
/** "Mär", "Mär, Jun", "Mär–Mai" (runs of three and more as a range). */
export function describeMonths(months: readonly number[]): string {
  const parts: string[] = [];
  for (let index = 0; index < months.length;) {
    let end = index;
    while (end + 1 < months.length && months[end + 1] === months[end] + 1) end++;
    if (end - index >= 2) parts.push(`${monthShort()[months[index] - 1]}–${monthShort()[months[end] - 1]}`);
    else for (let value = index; value <= end; value++) parts.push(monthShort()[months[value] - 1]);
    index = end + 1;
  }
  return parts.join(', ');
}
/** The whole rule: "Alle 4 Wochen am Mo, Do, Fr · nur im Mär · 3 Wochen an, 1 Woche aus · 10×". */
export function describe(rule: RepeatRule): string {
  if (getLanguage() === 'en') {
    let text = describePattern(rule);
    const months = monthsOf(rule);
    if (months) text += ` · only in ${describeMonths(months)}`;
    const pause = rule.unit === 'day' || rule.unit === 'week' ? rule.pause : null;
    if (pause && pause.on>0 && pause.off>0) text += ` · ${pause.on} ${unitNames()[pause.unit][pause.on === 1 ? 0 : 1]} on, ${pause.off} ${unitNames()[pause.unit][pause.off === 1 ? 0 : 1]} off`;
    if (rule.end?.count) text += ` · ${rule.end.count} times`;
    else if (rule.end?.until) text += ` · until ${formatOccurrence(rule.end.until)}`;
    return text;
  }
  let text = describePattern(rule);
  const months = monthsOf(rule);
  if (months) text += ` · nur ${months.length === 1 ? 'im ' : ''}${describeMonths(months)}`;
  const pause = rule.unit === 'day' || rule.unit === 'week' ? rule.pause : null;
  // Both counts with their unit: "3 Wochen an, 1 Woche aus".
  const periods = (count: number) => `${count} ${pause!.unit === 'week' ? count === 1 ? 'Woche' : 'Wochen' : count === 1 ? 'Tag' : 'Tage'}`;
  if (pause && pause.on > 0 && pause.off > 0) text += ` · ${periods(pause.on)} an, ${periods(pause.off)} aus`;
  if (rule.end?.count) text += ` · ${rule.end.count}×`;
  else if (rule.end?.until) text += ` · bis ${formatOccurrence(rule.end.until)}`;
  return text;
}

/** Turning repetition on: weekly on the start's weekday. */
export const defaultRule = (start: string): RepeatRule => ({ start, unit: 'week', every: 1, weekdays: [weekdayOf(start)] });
/** A pause, as first offered: 3 periods on, 1 off. */
export const defaultPause = (unit: RepeatUnit): NonNullable<RepeatRule['pause']> => ({ on: 3, off: 1, unit: unit === 'day' ? 'day' : 'week' });

/** The monthly/yearly positions a start date offers: same date, nth weekday (not a 5th), last weekday, last day, Easter. */
export function onChoices(start: string, unit: RepeatUnit): RepeatOn[] {
  const [y, m, d] = parts(start);
  const choices: RepeatOn[] = ['date'];
  if (weekdayIndex(start) <= 4) choices.push('weekday');
  if (isLastWeekday(start)) choices.push('last-weekday');
  if (d === daysIn(y, m)) choices.push('last-day');
  if (unit === 'year' && Math.abs(easterOffset(start)) <= 70) choices.push('easter');
  return choices;
}
/**
 * A rule started on another day keeps its pattern where it can (every, pause, end, several weekdays) and fits the rest:
 * a single weekday follows the start's, a position the new date does not offer becomes the nearest one it does.
 */
export function withStart(rule: RepeatRule, start: string, followWeekday = true): RepeatRule {
  const next: RepeatRule = { ...rule, start };
  if (followWeekday && rule.weekdays?.length === 1 && rule.weekdays[0] === weekdayOf(rule.start)) next.weekdays = [weekdayOf(start)];
  const offered = onChoices(start, next.unit);
  if (next.on && !offered.includes(next.on)) next.on = next.on !== 'last-weekday' && offered.includes('last-weekday') ? 'last-weekday' : 'date';
  if (next.end?.until && next.end.until < start) next.end = { until: start };
  return next;
}
/**
 * A changed rule that continues a series from its occurrence on `day`: it keeps the series' start – and with it the
 * rhythm of weeks and pauses and the count – as long as `day` still is one of its occurrences; otherwise it starts on `day`.
 */
export function continued(rule: RepeatRule, day: string): RepeatRule {
  return rule.start < day && occurrences(rule, day, day).length ? rule : withStart(rule, day);
}

function normalize(rule: RepeatRule | null | undefined) {
  if (!rule) return null;
  const pause = (rule.unit === 'day' || rule.unit === 'week') && rule.pause && rule.pause.on > 0 && rule.pause.off > 0 ? rule.pause : null;
  return { start: rule.start, unit: rule.unit, every: Math.max(1, rule.every), weekdays: rule.unit === 'week' ? weekdaysOf(rule) : null,
    on: rule.unit === 'month' || rule.unit === 'year' ? rule.on ?? 'date' : null, pause: pause && { on: pause.on, off: pause.off, unit: pause.unit },
    end: rule.end?.count ? { count: rule.end.count } : rule.end?.until ? { until: rule.end.until } : null, months: monthsOf(rule) };
}
/** Whether two rules (or none) give the same occurrences the same way. */
export const sameRule = (a: RepeatRule | null | undefined, b: RepeatRule | null | undefined) => JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
/** A rule as it is stored: only what applies to its unit. */
export function cleanRule(rule: RepeatRule): RepeatRule {
  const value = normalize(rule)!;
  return { start: value.start, unit: value.unit, every: value.every, ...value.weekdays ? { weekdays: value.weekdays } : {}, ...value.on ? { on: value.on } : {}, ...value.pause ? { pause: value.pause } : {}, ...value.end ? { end: value.end } : {}, ...value.months ? { months: value.months } : {} };
}

/**
 * Occurrences are created ahead up to the end of the year after next (like the ICS import), or to the end of the start's
 * year when that is later, and added as the horizon moves on (see `ensureSeries` in journal.ts).
 */
export function seriesHorizon(today: string, start = today): string {
  const ahead = `${parts(today)[0] + 2}-12-31`, own = `${parts(start)[0]}-12-31`;
  return own > ahead ? own : ahead;
}
