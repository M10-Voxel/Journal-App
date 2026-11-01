import test from 'node:test';
import assert from 'node:assert/strict';
import { completion, parseRepeat, suggestions } from '../src/repeatText.ts';
import { cleanRule, describe } from '../src/repeat.ts';

// Friday, 30 October 2026, weekly on Fridays: what the planner starts with.
const current = { start: '2026-10-30', unit: 'week', every: 1, weekdays: [4] };
const read = text => { const parsed = parseRepeat(text, current); return parsed && { ...parsed.rule, unknown: parsed.unknown }; };
const says = text => { const parsed = parseRepeat(text, current); return parsed && describe(parsed.rule); };

test('weekdays every n weeks, in German and English, starting on the first of those days', () => {
  assert.deepEqual(read('alle 3 Wochen am Montag, Mittwoch'), { start: '2026-11-02', unit: 'week', every: 3, weekdays: [0, 2], unknown: [] });
  assert.equal(says('every 3 weeks on monday and wednesday'), 'Alle 3 Wochen am Mo, Mi');
  assert.equal(says('jede zweite Woche dienstags und donnerstags'), 'Alle 2 Wochen am Di, Do');
  assert.equal(says('every other week on tue, thu'), 'Alle 2 Wochen am Di, Do');
  assert.equal(says('Mo, Do und Fr alle 4 Wochen'), 'Alle 4 Wochen am Mo, Do, Fr');
  assert.equal(says('montags'), 'Wöchentlich am Mo');
  assert.equal(says('mo-fr'), 'Werktags');
  assert.equal(says('monday to friday'), 'Werktags');
  assert.equal(says('werktags'), 'Werktags');
  assert.equal(says('weekends'), 'Wöchentlich am Sa, So');
  assert.equal(says('zweiwöchentlich'), 'Alle 2 Wochen am Fr');
  assert.equal(says('biweekly'), 'Alle 2 Wochen am Fr');
});

test('days, months and years', () => {
  assert.equal(says('täglich'), 'Täglich');
  assert.equal(says('every day'), 'Täglich');
  assert.equal(says('jeden zweiten Tag'), 'Alle 2 Tage');
  assert.equal(says('every 3rd day'), 'Alle 3 Tage');
  assert.equal(says('alle 10 Tage'), 'Alle 10 Tage');
  assert.equal(says('monatlich'), 'Monatlich am 30.');
  assert.equal(says('every month on the 15th'), 'Monatlich am 15.');
  assert.equal(read('am 15. jeden Monats').start, '2026-11-15');
  assert.equal(says('alle 3 Monate'), 'Alle 3 Monate am 30.');
  assert.equal(says('jährlich'), 'Jährlich am 30. Okt');
  assert.equal(says('every year'), 'Jährlich am 30. Okt');
});

test('birthdays by date, holidays by weekday position or Easter', () => {
  assert.deepEqual(read('jedes Jahr am 12. März'), { start: '2027-03-12', unit: 'year', every: 1, on: 'date', unknown: [] });
  assert.equal(read('Geburtstag am 12.3.').start, '2027-03-12');
  assert.equal(says('birthday on march 12'), 'Jährlich am 12. Mär');
  assert.equal(says('every year on 4 may'), 'Jährlich am 4. Mai');
  assert.equal(read('am 31.12.2026').start, '2026-12-31');
  assert.equal(says('am letzten Freitag im Monat'), 'Monatlich am letzten Fr');
  assert.equal(says('the last friday of the month'), 'Monatlich am letzten Fr');
  assert.equal(says('jeden 2. Dienstag'), 'Monatlich am 2. Di');
  assert.equal(read('jeden 2. Dienstag').start, '2026-11-10');
  assert.equal(says('first monday of every month'), 'Monatlich am 1. Mo');
  assert.equal(says('am letzten Tag im Monat'), 'Monatlich am Monatsende');
  assert.equal(says('end of month'), 'Monatlich am Monatsende');
  assert.deepEqual([says('4. Donnerstag im November'), read('4. Donnerstag im November').start], ['Jährlich am 4. Do im Nov', '2026-11-26']);
  assert.equal(says('second sunday of may'), 'Jährlich am 2. So im Mai');
  assert.deepEqual([says('Karfreitag'), read('Karfreitag').start], ['Jährlich · Karfreitag', '2027-03-26']);
  assert.equal(says('easter monday'), 'Jährlich · Ostermontag');
  assert.equal(says('Pfingstmontag'), 'Jährlich · Pfingstmontag');
});

test('the word being typed is completed', () => {
  assert.equal(completion('jeden Mit'), 'twoch');
  assert.equal(completion('alle 3 Wo'), 'chen');
  assert.equal(completion('every 2 we', 'en'), 'eks');
  assert.equal(completion('on wed', 'en'), 'nesday');
  assert.equal(completion('jeden Mittwoch im Mä'), 'rz');
  assert.equal(completion('good fr', 'en'), 'iday');
  assert.equal(completion('Karf'), 'reitag');
  assert.equal(completion('jeden Mittwoch'), 's', 'A longer known word still completes.');
  assert.equal(completion('alle 3 '), '');
  assert.equal(completion('xyzq'), '');
});

test('only in some months', () => {
  assert.deepEqual(read('jeden Mittwoch im März'), { start: '2027-03-03', unit: 'week', every: 1, weekdays: [2], months: [3], unknown: [] });
  assert.equal(says('jeden Mittwoch im März'), 'Wöchentlich am Mi · nur im Mär');
  assert.equal(says('täglich von Mai bis September'), 'Täglich · nur Mai–Sep');
  assert.equal(says('mondays in june and july'), 'Wöchentlich am Mo · nur Jun, Jul');
  assert.equal(says('every wednesday in march'), 'Wöchentlich am Mi · nur im Mär');
  assert.equal(says('nur im Dezember'), 'Wöchentlich am Fr · nur im Dez', 'Months alone restrict the rule there is.');
  assert.equal(read('nur im Dezember').start, '2026-12-04');
});

test('pauses and ends', () => {
  assert.equal(says('montags, 3 Wochen an, 1 Woche aus'), 'Wöchentlich am Mo · 3 an, 1 Woche aus');
  assert.equal(says('mondays 3 weeks on 1 week off'), 'Wöchentlich am Mo · 3 an, 1 Woche aus');
  assert.equal(says('täglich 5 an 2 aus'), 'Täglich · 5 an, 2 Tage aus');
  assert.equal(says('täglich, 10 mal'), 'Täglich · 10×');
  assert.equal(says('daily 7 times'), 'Täglich · 7×');
  assert.equal(says('täglich 10x'), 'Täglich · 10×');
  assert.equal(says('täglich für 2 Wochen'), 'Täglich · bis Do 12.11.');
  assert.equal(says('weekly until 30.11.'), 'Wöchentlich am Fr · bis Mo 30.11.');
  assert.equal(says('wöchentlich bis zum 20. november'), 'Wöchentlich am Fr · bis Fr 20.11.');
  assert.equal(says('every monday until dec 21'), 'Wöchentlich am Mo · bis Mo 21.12.');
  // Without days, the text changes only the end or the pause of the rule there is.
  assert.equal(says('10 mal'), 'Wöchentlich am Fr · 10×');
  assert.equal(says('bis 27.11.'), 'Wöchentlich am Fr · bis Fr 27.11.');
});

test('what the app writes reads back, and unknown words are named', () => {
  const rules = [
    { start: '2026-10-29', unit: 'week', every: 4, weekdays: [0, 3, 4], pause: { on: 3, off: 1, unit: 'week' }, end: { count: 10 } },
    { start: '2026-11-02', unit: 'week', every: 1, weekdays: [0, 1, 2, 3, 4] },
    { start: '2026-10-30', unit: 'day', every: 1, end: { count: 5 } },
    { start: '2028-02-29', unit: 'year', every: 1, on: 'date' },
    { start: '2026-10-30', unit: 'month', every: 1, on: 'last-weekday' },
    { start: '2026-11-26', unit: 'year', every: 1, on: 'weekday' },
    { start: '2027-03-26', unit: 'year', every: 1, on: 'easter' },
    { start: '2026-11-02', unit: 'week', every: 1, weekdays: [0], end: { until: '2026-11-20' } },
    { start: '2026-10-31', unit: 'month', every: 2, on: 'last-day' },
    { start: '2026-11-10', unit: 'month', every: 1, on: 'weekday' },
    { start: '2026-11-04', unit: 'day', every: 1, pause: { on: 21, off: 7, unit: 'day' } },
    { start: '2027-03-03', unit: 'week', every: 1, weekdays: [2], months: [3] },
    { start: '2027-05-01', unit: 'day', every: 1, months: [5, 6, 7, 8, 9] },
    { start: '2027-01-04', unit: 'week', every: 2, weekdays: [0], months: [1, 3, 12] },
  ];
  for (const rule of rules) {
    const back = parseRepeat(describe(rule), { ...current, start: rule.start });
    assert.deepEqual(back && { rule: back.rule, unknown: back.unknown }, { rule: cleanRule(rule), unknown: [] }, describe(rule));
  }
  assert.deepEqual(read('alle 2 Wochen am Montag bitte').unknown, ['bitte']);
  assert.equal(parseRepeat('hallo welt', current), null);
  assert.equal(parseRepeat('', current), null);
});

test('suggestions like an editor: beginnings first, then letters in order, with what the word does', () => {
  const words = text => suggestions(text).map(item => item.word);
  assert.deepEqual(words('jeden M').slice(0, 3), ['Mai', 'mal', 'März']);
  assert.equal(suggestions('jeden Mit')[0].word, 'Mittwoch');
  assert.equal(suggestions('jeden Mit')[0].description, 'Wochentag');
  assert.deepEqual(suggestions('jeden Mit')[0].matches, [0, 1, 2]);
  assert.equal(words('alle 3 Wo')[0], 'Wochen', 'In the plural after a number above one.');
  assert.equal(suggestions('every 2 we', 6, 'en')[0].word, 'weeks');
  assert.ok(words('jeden mtw').includes('Mittwoch'), 'Letters in order also match.');
  assert.deepEqual(suggestions('jeden mtw').find(item => item.word === 'Mittwoch').matches, [0, 2, 4]);
  assert.equal(suggestions('Karf')[0].description, 'Feiertag · Ostern −2');
  assert.deepEqual(suggestions('alle 3 '), []);
});
