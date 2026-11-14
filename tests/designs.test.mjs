import test from 'node:test';
import assert from 'node:assert/strict';
import { fromTheme, legacyTheme, nativeLook, presetOf, storedDesign, takesPixel, hasFixedPalette, layouts, looks, popupVariants, popupStyleFor } from '../src/designs.ts';

test('the three ready-made designs are a layout with its look; mixes are none of them', () => {
  assert.equal(presetOf('book', 'journal'), 'journal');
  assert.equal(presetOf('desk', 'nebula'), 'nebula');
  assert.equal(presetOf('classic', 'classic'), 'classic');
  assert.equal(presetOf('book', 'nebula'), null);
  assert.equal(presetOf('classic', 'journal'), null);
  assert.deepEqual(layouts.map(nativeLook), ['classic', 'journal', 'nebula']);
  assert.deepEqual(looks.map(takesPixel), [true, true, false]);
  assert.deepEqual(looks.map(hasFixedPalette), [false, false, true]);
});

test('settings stored before the split (one theme) become layout and look; unknown ones the normal design', () => {
  assert.deepEqual(fromTheme('journal'), { layout: 'book', look: 'journal' });
  assert.deepEqual(fromTheme('nebula'), { layout: 'desk', look: 'nebula' });
  assert.deepEqual(fromTheme('pixel'), { layout: 'classic', look: 'classic' });
  assert.deepEqual(fromTheme(undefined), { layout: 'classic', look: 'classic' });
  assert.deepEqual(storedDesign({ theme: 'journal' }), { layout: 'book', look: 'journal' });
});

test('stored layout and look win, unless the theme beside them was changed by an older version', () => {
  // Written by this version: the theme is the layout's own.
  assert.deepEqual(storedDesign({ theme: 'journal', layout: 'book', look: 'nebula' }), { layout: 'book', look: 'nebula' });
  assert.equal(legacyTheme('book'), 'journal');
  assert.equal(legacyTheme('desk'), 'nebula');
  // An older version switched the design to Nebula on shared settings: its choice is the newer one.
  assert.deepEqual(storedDesign({ theme: 'nebula', layout: 'book', look: 'journal' }), { layout: 'desk', look: 'nebula' });
  // No theme (or an unknown one): layout and look as stored, a missing or invalid half from the theme.
  assert.deepEqual(storedDesign({ layout: 'desk', look: 'classic' }), { layout: 'desk', look: 'classic' });
  assert.deepEqual(storedDesign({ layout: 'bogus', look: 'bogus' }), { layout: 'classic', look: 'classic' });
});

test('the journal look has four popup variants, the others two; a variant the look lacks falls back to a', () => {
  assert.deepEqual(popupVariants('journal'), ['a', 'b', 'c', 'd']);
  assert.deepEqual(popupVariants('classic'), ['a', 'b']);
  assert.deepEqual(popupVariants('nebula'), ['a', 'b']);
  assert.equal(popupStyleFor('journal', 'c'), 'c');
  assert.equal(popupStyleFor('journal', 'd'), 'd');
  assert.equal(popupStyleFor('classic', 'c'), 'a', 'Sticker-Bogen is the journal look\'s own.');
  assert.equal(popupStyleFor('nebula', 'd'), 'a', 'Papierschnipsel is the journal look\'s own.');
  assert.equal(popupStyleFor('nebula', 'b'), 'b');
  assert.equal(popupStyleFor('journal', undefined), 'a');
  assert.equal(popupStyleFor('journal', 'z'), 'a');
});
