import test from 'node:test';
import assert from 'node:assert/strict';
import { colorThemes, colorTokens, normalizeColorSettings, resolvePalette, contrastRatio, applyColors } from '../src/colors.ts';

test('old or malformed preferences fall back to the complete original palette', () => {
  for (const stored of [null, undefined, {}, { colorTheme:'other', customColors:false }]) {
    assert.deepEqual(normalizeColorSettings(stored), { colorTheme:'original', customColors:{} });
    assert.deepEqual(resolvePalette(normalizeColorSettings(stored)), colorThemes[0].colors);
  }
  for (const theme of colorThemes) assert.deepEqual(Object.keys(theme.colors).sort(), [...colorTokens].sort());
});

test('per-theme custom colours are isolated and only allowed tokens and hex colours survive', () => {
  const settings = normalizeColorSettings({ colorTheme:'green', customColors:{
    original:{ accent:'#AABBCC' }, green:{ accent:'#BAED72', 'md-red':'#FFAABB', edge:'#abcdef80', line:'red;display:none', text:'url(https://example.org)', '--unknown':'#ffffff', surface:null }, summer:{'md-blue':'#82DDFF'}, unexpected:{text:'#ffffff'},
  } });
  assert.deepEqual(settings.customColors, { original:{accent:'#aabbcc'}, green:{accent:'#baed72',edge:'#abcdef80','md-red':'#ffaabb'}, summer:{'md-blue':'#82ddff'} });
  assert.equal(resolvePalette(settings).accent, '#baed72');
  assert.equal(resolvePalette(settings)['md-red'], '#ffaabb');
  assert.equal(resolvePalette({...settings,colorTheme:'original'}).accent, '#aabbcc');
  assert.equal(resolvePalette({...settings,customColors:{original:settings.customColors.original}}).accent,colorThemes[1].colors.accent);
  assert.equal(resolvePalette({...settings,colorTheme:'summer'})['md-blue'],'#82ddff');
  assert.equal(normalizeColorSettings({...settings,colorTheme:'summer'}).colorTheme,'summer');
});

test('image palettes have readable text and their own coordinated Markdown colours', () => {
  const markdownTokens = colorTokens.filter(token=>token.startsWith('md-'));
  for (const theme of colorThemes.filter(theme=>theme.id!=='original')) {
    const palette = theme.colors;
    for (const background of ['background', 'surface', 'inset']) {
      for (const token of ['text', 'strong', 'muted', 'accent', ...markdownTokens.filter(token=>!token.includes('highlight'))]) {
        assert(contrastRatio(palette[token],palette[background])>=4.5,`${theme.id}: ${token} on ${background} should be readable`);
      }
    }
    assert(contrastRatio(palette['event-text'],palette['event-background'])>=4.5);
    for (const token of markdownTokens) assert.notEqual(palette[token],colorThemes[0].colors[token],`${theme.id}: ${token} belongs to this theme`);
  }
});

test('applying a palette updates existing inherited styles and derives readable button text', () => {
  const properties = new Map();
  const previous = globalThis.document;
  globalThis.document = {documentElement:{dataset:{},style:{setProperty:(key,value)=>properties.set(key,value)}}};
  try {
    applyColors({colorTheme:'green',customColors:{green:{accent:'#080808','md-red':'#ffaaaa'}}});
    assert.equal(document.documentElement.dataset.colorTheme,'green');
    assert.equal(properties.get('--md-red'),'#ffaaaa');
    assert.equal(properties.get('--on-accent'),'#ffffff');
    applyColors({colorTheme:'original',customColors:{}});
    assert.equal(properties.get('--md-red'),'#df6262');
    assert.equal(properties.get('--on-accent'),'#06101f');
    assert.equal(properties.get('--surface'),'#292929');
  } finally {globalThis.document=previous;}
});
