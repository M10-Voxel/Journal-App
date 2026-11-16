import test from 'node:test';
import assert from 'node:assert/strict';
import { colorThemes, colorTokens, normalizeColorSettings, resolvePalette, contrastRatio, applyColors } from '../src/colors.ts';

test('old or malformed preferences fall back to the complete original palette', () => {
  for (const stored of [null, undefined, {}, { colorTheme:'other', customColors:false }]) {
    assert.deepEqual(normalizeColorSettings(stored), { colorTheme:'original', customColors:{}, customThemes:[], colorDrafts:{} });
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
  globalThis.document = {documentElement:{dataset:{},style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}}};
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

test('sticker colours follow general text overrides, allow independent choices, and clear on theme switch/reset', () => {
  const properties = new Map(), previous = globalThis.document;
  globalThis.document = {documentElement:{dataset:{},style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}}};
  try {
    const settings = normalizeColorSettings({ colorTheme:'green', customColors:{ green:{ text:'#ABCDEF', strong:'#fedcba', muted:'#879abc', 'key-bg':'#124578', 'key-backdrop':'#abcdef80', 'poster-background':'#123456', pink:'#ff8899', mint:'#99ffbb', violet:'#aabbff', 'tint-base':'#eeeedd' } } });
    const palette = resolvePalette(settings);
    assert.equal(palette.ink, '#abcdef');
    assert.equal(palette['ink-fixed'], '#abcdef');
    assert.equal(palette['poster-text'], '#abcdef');
    applyColors(settings);
    for (const [token, value] of Object.entries(settings.customColors.green)) assert.equal(properties.get('--'+token), value);
    assert.equal(properties.get('--ink'), '#abcdef');
    assert.equal(properties.get('--ink-fixed'), '#abcdef');
    assert.equal(properties.get('--poster-text'), '#abcdef');
    assert.equal(properties.get('--poster-muted'), '#879abc');
    assert.equal(properties.get('--poster-strong'), '#fedcba');
    applyColors({...settings, customColors:{green:{...settings.customColors.green, ink:'#112233', 'ink-fixed':'#223344', 'poster-text':'#334455', 'poster-muted':'#445566'}}});
    assert.equal(properties.get('--ink'), '#112233');
    assert.equal(properties.get('--ink-fixed'), '#223344');
    assert.equal(properties.get('--poster-text'), '#334455');
    assert.equal(properties.get('--poster-muted'), '#445566');
    for (const reset of [{...settings,colorTheme:'lavender'}, {...settings,customColors:{}}]) {
      applyColors(reset);
      for (const token of ['ink','ink-fixed','key-bg','key-backdrop','poster-background','poster-text','poster-muted','poster-strong']) assert.equal(properties.has('--'+token), false, token+' falls back to the unchanged CSS default');
      // The sticker trio is the palette's own (lavender's or green's), never the custom one left behind.
      for (const token of ['pink','mint','violet','tint-base']) assert.equal(properties.get('--'+token), resolvePalette(reset)[token], `${token} is the palette's own`);
    }
  } finally { globalThis.document = previous; }
});

test('the journal look\'s lavender palettes: light and dark, readable, among the journal palettes (lavender first)', async () => {
  const { journalColorThemes, isLightPalette } = await import('../src/colors.ts');
  const lavender = colorThemes.find(theme => theme.id === 'lavender'), night = colorThemes.find(theme => theme.id === 'lavender-night');
  assert(lavender && night);
  assert.equal(journalColorThemes[0], 'lavender');
  assert(journalColorThemes.includes('lavender-night') && journalColorThemes.includes('paper') && journalColorThemes.includes('candle'));
  assert.equal(isLightPalette(lavender.colors), true);
  assert.equal(isLightPalette(night.colors), false);
  assert.equal(lavender.colors.background, '#e9e4f5');
  assert.equal(normalizeColorSettings({ colorTheme:'lavender-night' }).colorTheme, 'lavender-night');
});

test('the stickers\' white edge and ink line are palette colours, so they can be changed per palette', () => {
  for (const theme of colorThemes) for (const token of ['sticker-edge', 'sticker-line']) assert.match(theme.colors[token], /^#[\da-f]{6}$/i, `${theme.id} ${token}`);
  const settings = normalizeColorSettings({ colorTheme:'lavender', customColors:{ lavender:{ 'sticker-edge':'#FFE4F0', 'sticker-line':'#123456' } } });
  assert.equal(resolvePalette(settings)['sticker-edge'], '#ffe4f0');
  assert.equal(resolvePalette(settings)['sticker-line'], '#123456');
  // Another palette keeps its own edge.
  assert.equal(resolvePalette({ ...settings, colorTheme:'lavender-night' })['sticker-edge'], colorThemes.find(theme => theme.id === 'lavender-night').colors['sticker-edge']);
});

test('custom palettes: created from another palette with a name, saved, renamed, removed; ids and names are checked', async () => {
  const { createCustomTheme, saveColorDraft, discardColorDraft, renameCustomTheme, removeCustomTheme, colorThemeBase, colorOverrides } = await import('../src/colors.ts');
  let settings = normalizeColorSettings({ colorTheme:'summer', customColors:{ summer:{ accent:'#112233' } } });
  settings = createCustomTheme(settings, '  Meer  ', 'summer', false, 'custom-sea');
  assert.equal(settings.colorTheme, 'custom-sea');
  assert.deepEqual(settings.customThemes, [{ id:'custom-sea', name:'Meer', base:'summer', colors:{ accent:'#112233' } }]);
  assert.equal(colorThemeBase(settings), 'summer');
  assert.equal(resolvePalette(settings).accent, '#112233');
  assert.equal(resolvePalette(settings).background, colorThemes.find(theme => theme.id === 'summer').colors.background);
  // Unsaved changes show at once, but only saving puts them into the palette.
  settings = { ...settings, colorDrafts:{ 'custom-sea':{ background:'#010203' } } };
  assert.equal(resolvePalette(settings).background, '#010203');
  assert.equal(resolvePalette(settings, 'custom-sea', false).background, colorThemes.find(theme => theme.id === 'summer').colors.background);
  assert.deepEqual(discardColorDraft(settings).colorDrafts, {});
  settings = saveColorDraft(settings);
  assert.deepEqual(settings.customThemes[0].colors, { accent:'#112233', background:'#010203' });
  assert.deepEqual(settings.colorDrafts, {});
  // A colour set back to the base's own drops out when saved.
  settings = saveColorDraft({ ...settings, colorDrafts:{ 'custom-sea':{ accent: colorThemes.find(theme => theme.id === 'summer').colors.accent } } });
  assert.deepEqual(settings.customThemes[0].colors, { background:'#010203' });
  // A new palette from the unsaved changes of a built-in one takes them along and leaves the built-in one as it was.
  let fromDraft = createCustomTheme({ ...settings, colorTheme:'green', colorDrafts:{ green:{ text:'#eeeeee' } } }, 'Wald', 'green', true, 'custom-wood');
  assert.deepEqual(fromDraft.customThemes[1], { id:'custom-wood', name:'Wald', base:'green', colors:{ text:'#eeeeee' } });
  assert.deepEqual(fromDraft.colorDrafts, {});
  assert.deepEqual(colorOverrides(fromDraft, 'green'), {});
  fromDraft = renameCustomTheme(fromDraft, 'custom-wood', 'Tannenwald');
  assert.equal(fromDraft.customThemes[1].name, 'Tannenwald');
  assert.equal(renameCustomTheme(fromDraft, 'custom-wood', '   ').customThemes[1].name, 'Tannenwald');
  const removed = removeCustomTheme(fromDraft, 'custom-wood');
  assert.equal(removed.colorTheme, 'green');
  assert.equal(removed.customThemes.length, 1);
  // Stored values are whitelisted: unknown ids, bad ids and drafts of missing palettes go.
  const clean = normalizeColorSettings({ colorTheme:'custom-gone', customThemes:[{ id:'custom-a', name:'A', base:'nope', colors:{ text:'#ABCDEF', bad:'#000000' } }, { id:'evil<script>', name:'B', base:'green', colors:{} }, { id:'custom-a', name:'dup', base:'green', colors:{} }],
    colorDrafts:{ 'custom-a':{ accent:'#123456' }, 'custom-gone':{ accent:'#123456' } } });
  assert.equal(clean.colorTheme, 'original');
  assert.deepEqual(clean.customThemes, [{ id:'custom-a', name:'A', base:'original', colors:{ text:'#abcdef' } }]);
  assert.deepEqual(clean.colorDrafts, { 'custom-a':{ accent:'#123456' } });
});

test('a custom palette carries its base to the page, so the looks\' light and dark rules follow it', () => {
  const properties = new Map(), previous = globalThis.document;
  globalThis.document = {documentElement:{dataset:{},style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}}};
  try {
    applyColors({ colorTheme:'custom-x', customColors:{}, customThemes:[{ id:'custom-x', name:'X', base:'paper', colors:{ accent:'#334455' } }], colorDrafts:{ 'custom-x':{ 'md-red':'#aa0000' } } });
    assert.equal(document.documentElement.dataset.colorTheme, 'paper');
    assert.equal(properties.get('--accent'), '#334455');
    assert.equal(properties.get('--md-red'), '#aa0000');
  } finally { globalThis.document = previous; }
});

test('every palette has its own sticker trio, readable under the dark sticker ink', () => {
  for (const theme of colorThemes) for (const token of ['pink', 'mint']) assert(contrastRatio(theme.colors[token], '#2b2140') >= 4.5, `${theme.id} ${token}`);
  const trios = new Set(colorThemes.map(theme => `${theme.colors.violet}${theme.colors.pink}${theme.colors.mint}`));
  assert(trios.size >= 6, 'The palettes do not all share one sticker trio');
});

test('the journal tickets\' brightness becomes the share of the tag colour; out-of-range values fall back', async () => {
  const { isTicketBrightness } = await import('../src/colors.ts');
  const properties = new Map(), previous = globalThis.document;
  globalThis.document = {documentElement:{dataset:{},style:{setProperty:(key,value)=>properties.set(key,value),removeProperty:key=>properties.delete(key)}}};
  try {
    applyColors({ colorTheme:'lavender', customColors:{} });
    assert.equal(properties.get('--ticket-tint'), '34%', 'The look\'s own third of the colour.');
    applyColors({ colorTheme:'lavender', customColors:{}, ticketBrightness:90 });
    assert.equal(properties.get('--ticket-tint'), '10%');
    applyColors({ colorTheme:'lavender', customColors:{}, ticketBrightness:0 });
    assert.equal(properties.get('--ticket-tint'), '100%');
    for (const bad of [-1, 101, NaN, '50', null]) assert.equal(isTicketBrightness(bad), false);
  } finally { globalThis.document = previous; }
});
