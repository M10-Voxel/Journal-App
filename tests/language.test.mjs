import test from 'node:test';
import assert from 'node:assert/strict';
import { setLanguage, t, getLanguage } from '../src/i18n.ts';
import { formatDate, formatMonth } from '../src/dates.ts';
import { suggestions, completion, parseRepeat } from '../src/repeatText.ts';
import { describe, describePattern, defaultRule, occurrences } from '../src/repeat.ts';

test('language changes translate UI/date formatting and switching back restores German', () => {
  try {
    setLanguage('en');
    assert.equal(t('Einstellungen'),'Settings');
    assert.equal(t('{0} bearbeiten','Aufgabe'),'Edit Aufgabe', 'Interpolated user data is not translated.');
    assert.match(formatDate('2026-11-01'),/Sunday.*November/);
    assert.equal(formatMonth('2026-11'),'November 2026');
    setLanguage('de');
    assert.equal(t('Einstellungen'),'Einstellungen');
    assert.match(formatDate('2026-11-01'),/Sonntag.*November/);
  } finally {setLanguage('de');}
});

test('suggestions use only the preferred language whenever it has a matching candidate', () => {
  const de=suggestions('Mon',20,'de').map(item=>item.word);
  assert(de.includes('Montag')); assert(!de.includes('Monday')); assert(!de.includes('monthly'));
  const en=suggestions('Mon',20,'en').map(item=>item.word);
  assert(en.includes('Monday')); assert(!en.includes('Montag')); assert(!en.includes('Monat'));
  assert.equal(suggestions('every 2 we',6,'de')[0].word,'werktags', 'Already typed English does not override the selected display language.');
  assert.equal(completion('Mon','en'),'th');
});

test('foreign words remain available as a fallback and duplicate shared words are removed', () => {
  assert.equal(suggestions('Thurs',6,'de')[0].word,'Thursday');
  assert.equal(suggestions('Mit',6,'en')[0].word,'Mittwoch');
  const shared=suggestions('Nov',20,'en').map(item=>item.word);
  assert.equal(shared.filter(word=>word==='November').length,1);
  try { setLanguage('en'); assert.equal(suggestions('Mon').find(item=>item.word==='Monday').description,'Weekday'); }
  finally {setLanguage('de');}
});

test('English rule descriptions remain readable by the bilingual planning parser', () => {
  const rules=[
    {start:'2026-11-02',unit:'week',every:2,weekdays:[0,2],end:{count:10}},
    {start:'2026-11-02',unit:'day',every:3},
    {start:'2026-11-02',unit:'month',every:1,on:'date'},
    {start:'2026-11-02',unit:'year',every:1,on:'date'},
    {start:'2026-11-02',unit:'month',every:1,on:'weekday'},
    {start:'2026-10-29',unit:'week',every:4,weekdays:[0,3,4],pause:{on:3,off:1,unit:'week'},end:{count:10}},
    {start:'2026-10-30',unit:'month',every:1,on:'last-weekday'},
    {start:'2026-10-31',unit:'month',every:2,on:'last-day'},
    {start:'2026-11-26',unit:'year',every:1,on:'weekday'},
    {start:'2027-03-26',unit:'year',every:1,on:'easter'},
    {start:'2026-11-02',unit:'week',every:1,weekdays:[0],end:{until:'2026-11-20'}},
    {start:'2027-05-01',unit:'day',every:1,months:[5,6,7,8,9]},
  ];
  try {
    setLanguage('en');
    assert.equal(getLanguage(),'en');
    assert.equal(describePattern(rules[0]),'Every 2 weeks on Mon, Wed');
    for(const rule of rules){const text=describe(rule), parsed=parseRepeat(text,defaultRule(rule.start)); assert(parsed,text); assert.deepEqual(parsed.unknown,[],text); assert.deepEqual(occurrences(parsed.rule,rule.start,'2028-12-31',30),occurrences(rule,rule.start,'2028-12-31',30),text);}
  } finally {setLanguage('de');}
});
