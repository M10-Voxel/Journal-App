import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptSuggestion, excerpt, highlights, parseQuery, runSearch, searchSuggestions } from '../src/search.ts';

const tags = [{ id:'w', name:'Arbeit', color:'#569eff' }, { id:'p', name:'Neues Projekt', color:'#76d982' }];
const item = (key, type, title, extra = {}) => ({ key, type, title, snippet:'', date:'2026-11-05', tag:null, target:{ kind:'title', date:'2026-11-05' }, ...extra });
const BS = '\\';

test('queries: words, @ types (also Pinnwand/Zettel), backslash tags with underscores', () => {
  const parsed = parseQuery(`Kisten @Aufgabe @Pinnwand/Zettel ${BS}Neues_Projekt`, 999, tags);
  assert.deepEqual(parsed.words, ['kisten']);
  assert.deepEqual(parsed.rawWords, ['Kisten']);
  assert.deepEqual(parsed.types, ['task', 'board-note']);
  assert.deepEqual(parsed.tags, ['p']);
});

test('suggestions complete the filter at the cursor, the start of a name first', () => {
  const parsed = parseQuery('Park @pin', 9, tags);
  const list = searchSuggestions(parsed, tags);
  assert.equal(list[0].insert, '@Pinnwand');
  assert.deepEqual(list[0].matches, [0, 1, 2]);
  const next = acceptSuggestion('Park @pin', parsed, list[0]);
  assert.equal(next.query, 'Park @Pinnwand ');
  assert.deepEqual(searchSuggestions(parseQuery(`${BS}pro`, 4, tags), tags).map(s => s.insert), [`${BS}Neues_Projekt`]);
});

test('results fit every word (accents aside), any chosen type and the tag', () => {
  const items = [item('a', 'task', 'Müll rausbringen', { tag:'w' }), item('b', 'event', 'Müll Abholung'), item('c', 'board-image', 'Mullbinde')];
  assert.deepEqual(runSearch(items, parseQuery('mull', 4, tags)).map(r => r.key).sort(), ['a', 'b', 'c']);
  assert.deepEqual(runSearch(items, parseQuery('mull @Pinnwand', 99, tags)).map(r => r.key), ['c']);
  assert.deepEqual(runSearch(items, parseQuery(`${BS}Arbeit`, 99, tags)).map(r => r.key), ['a']);
  assert.deepEqual(runSearch(items, parseQuery('', 0, tags)), [], 'An empty query finds nothing.');
  assert.deepEqual(highlights('Müll und Müll', ['mull']), [[0, 4], [9, 13]]);
  assert.match(excerpt('a '.repeat(80) + 'Ziel ' + 'b '.repeat(80), ['ziel'], 40), /^….*Ziel.*…$/);
});
