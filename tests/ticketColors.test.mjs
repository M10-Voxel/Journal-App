import test from 'node:test';
import assert from 'node:assert/strict';
import { foilPalette, lightTagColor, tagFoil } from '../src/ticketColors.ts';
import { contrastRatio } from '../src/colors.ts';

test('dark tag colours are lightened so black print stays readable; light ones stay', () => {
  for (const color of ['#1a237e', '#000000', '#7b1fa2', '#2e7d32', '#ffeb3b', '#f5f5f5']) {
    assert.ok(contrastRatio('#141414', lightTagColor(color)) >= 7, color);
    for (const band of foilPalette(color)) assert.ok(contrastRatio('#141414', band) >= 6, `${color} ${band}`);
  }
});

test('the foil carries the tag hue in its middle and the complement in its veins', () => {
  const [vein, , , middle] = foilPalette('#2060e0');
  const blue = parseInt(middle.slice(5, 7), 16), red = parseInt(middle.slice(1, 3), 16);
  assert.ok(blue > red, middle);
  assert.ok(parseInt(vein.slice(1, 3), 16) > parseInt(vein.slice(5, 7), 16), vein);
  assert.match(tagFoil('#2060e0').foil, /^url\("data:image\/svg\+xml,/);
  assert.equal(tagFoil('#2060e0'), tagFoil('#2060e0'));
});
