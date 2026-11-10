import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { commonIcons, searchIcons, validIconName } from '../src/entryIcons.ts';

// The names the app uses are Lucide's file names (see lucideSet.ts).
const names = readdirSync('node_modules/lucide/dist/esm/icons').filter(file => file.endsWith('.mjs')).map(file => file.slice(0, -4));

test('icon names: every Lucide name is valid as stored, every common icon exists', () => {
  assert(names.length > 1500);
  assert(names.every(validIconName));
  assert.equal(validIconName('Not An Icon'), false);
  assert.deepEqual(commonIcons.filter(name => !names.includes(name)), []);
});

test('search: German words first, then names; without a query the common icons', () => {
  assert.equal(searchIcons(names, 'arzt')[0], 'stethoscope');
  assert.equal(searchIcons(names, 'Geburtstag')[0], 'cake');
  assert.equal(searchIcons(names, 'bike')[0], 'bike');
  assert(searchIcons(names, 'cap').includes('graduation-cap'));
  assert(searchIcons(names, '2x2').includes('grid-2x2-plus'));
  assert.deepEqual(searchIcons(names, ''), [...commonIcons]);
  assert.deepEqual(searchIcons(names, 'qqqqzz'), []);
});
