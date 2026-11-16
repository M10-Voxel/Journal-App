import test from 'node:test';
import assert from 'node:assert/strict';

import { withLook, normalizeLookMemory } from '../src/lookMemory.ts';
const withDesign = (settings, layout, look) => ({ ...withLook(settings, look), layout });
const defaultSettings = { layout:'classic', look:'classic', popupStyle:'a', colorTheme:'original', customColors:{}, customThemes:[], colorDrafts:{} };

const start = (extra = {}) => ({ ...defaultSettings, ...extra });

test('each look gets back the palette and popup variant it had (journal → Nebula → journal)', () => {
  let settings = withLook(start({ colorTheme:'summer' }), 'journal');
  assert.equal(settings.colorTheme, 'lavender', 'The journal look brings lavender the first time.');
  settings = { ...settings, colorTheme:'lavender-night', popupStyle:'c' };
  settings = withLook(settings, 'nebula');
  assert.equal(settings.colorTheme, 'lavender-night', 'Nebula leaves the palette alone (its own is fixed).');
  assert.equal(settings.popupStyle, 'a', 'Nebula lacks variant C.');
  settings = withLook(settings, 'journal');
  assert.equal(settings.colorTheme, 'lavender-night');
  assert.equal(settings.popupStyle, 'c', 'The journal look gets variant C back.');
  settings = withLook(settings, 'classic');
  assert.equal(settings.colorTheme, 'summer', 'The normal look gets its palette from before.');
  settings = withLook({ ...settings, colorTheme:'green', popupStyle:'b' }, 'journal');
  assert.equal(settings.colorTheme, 'lavender-night');
  assert.equal(settings.popupStyle, 'c');
  settings = withLook(settings, 'classic');
  assert.equal(settings.colorTheme, 'green');
  assert.equal(settings.popupStyle, 'b');
});

test('Nebula remembers its own popup variant; the ready-made designs go through the same memory', () => {
  let settings = withDesign(start({ colorTheme:'paper' }), 'desk', 'nebula');
  settings = withLook({ ...settings, popupStyle:'b' }, 'classic');
  assert.equal(settings.colorTheme, 'paper');
  settings = withDesign({ ...settings, popupStyle:'a' }, 'book', 'journal');
  assert.equal(settings.colorTheme, 'paper', 'A journal palette already chosen stays.');
  settings = withDesign(settings, 'desk', 'nebula');
  assert.equal(settings.popupStyle, 'b');
});

test('a palette deleted meanwhile is not given back; stored memory is checked', () => {
  let settings = withLook(start({ colorTheme:'custom-x', customThemes:[{ id:'custom-x', name:'X', base:'lavender', colors:{} }] }), 'classic');
  assert.equal(settings.colorTheme, 'custom-x');
  settings = withLook({ ...start(), look:'classic', lookMemory:{ journal:{ colorTheme:'custom-gone', popupStyle:'d' } } }, 'journal');
  assert.equal(settings.colorTheme, 'lavender');
  assert.equal(settings.popupStyle, 'd');
  assert.deepEqual(normalizeLookMemory({ journal:{ colorTheme:'candle', popupStyle:'d' }, nebula:{ popupStyle:'d' }, classic:{ colorTheme:'nope' }, other:{} }, start()),
    { journal:{ colorTheme:'candle', popupStyle:'d' } });
});
