import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEdit, parseInline, plainText, setColor, toggleStyle } from '../src/markdown.ts';

// Compact notation of the tree: markers in ‹›, styles as b/i/s/h(...), colours as name(...).
const show = nodes => nodes.map(node => node.type === 'text' ? node.text : node.type === 'mark' ? `‹${node.text}›`
  : `‹${node.open}›${node.type === 'style' ? node.styles.map(style => style[0]).join('') : node.color}(${show(node.children)})‹${node.close}›`).join('');
const source = nodes => nodes.map(node => node.type === 'text' || node.type === 'mark' ? node.text : node.open + source(node.children) + node.close).join('');

test('parses bold, italic, both, strike and highlight, keeping every character', () => {
  const cases = {
    'ein **fetter** Tag': 'ein ‹**›b(fetter)‹**› Tag',
    '*kursiv* und _auch_': '‹*›i(kursiv)‹*› und ‹_›i(auch)‹_›',
    '***beides***': '‹***›bi(beides)‹***›',
    '~~weg~~ ==wichtig==': '‹~~›s(weg)‹~~› ‹==›h(wichtig)‹==›',
    '**fett mit *kursiv* drin**': '‹**›b(fett mit ‹*›i(kursiv)‹*› drin)‹**›',
  };
  for (const [text, expected] of Object.entries(cases)) {
    const tree = parseInline(text);
    assert.equal(show(tree), expected, text);
    assert.equal(source(tree), text, `${text} must keep every character`);
  }
});
test('leaves things alone that are not formatting', () => {
  for (const text of ['2 * 3 * 4', 'snake_case_name', '** offen', 'a ** b **', 'kein ~~ende', '5*', '[nur Klammern]', '[x]{magenta}', '`code` bleibt Text', '$x^2$']) {
    const tree = parseInline(text);
    assert.equal(show(tree), text, text);
  }
});
test('colours spans with the theme colours and allows formatting inside', () => {
  assert.equal(show(parseInline('[Achtung]{rot} und [**so**]{grün}')), '‹[›rot(Achtung)‹]{rot}› und ‹[›grün(‹**›b(so)‹**›)‹]{grün}›');
  assert.equal(show(parseInline('**[wichtig]{blau}**')), '‹**›b(‹[›blau(wichtig)‹]{blau}›)‹**›');
});
test('backslash escapes markers', () => {
  assert.equal(show(parseInline('\\*kein\\* Stern')), '‹\\›*kein‹\\›* Stern');
  assert.equal(plainText('**fett** [rot]{rot} \\*'), 'fett rot *');
});
test('toggling a style wraps, and unwraps when the markers surround or are part of the selection', () => {
  const run = (text, start, end, style) => { const edit = toggleStyle(text, start, end, style); return [applyEdit(text, edit), ...edit.selection]; };
  assert.deepEqual(run('ein Tag', 4, 7, 'bold'), ['ein **Tag**', 6, 9]);
  assert.deepEqual(run('ein **Tag**', 6, 9, 'bold'), ['ein Tag', 4, 7]);
  assert.deepEqual(run('ein **Tag**', 4, 11, 'bold'), ['ein Tag', 4, 7]);
  assert.deepEqual(run('ein **Tag**', 6, 9, 'italic'), ['ein ***Tag***', 7, 10], 'Italic adds to bold.');
  assert.deepEqual(run('ein ***Tag***', 7, 10, 'italic'), ['ein **Tag**', 6, 9], 'Italic is removed from bold+italic.');
  assert.deepEqual(run('ein ***Tag***', 7, 10, 'bold'), ['ein *Tag*', 5, 8]);
  assert.deepEqual(run('a b', 1, 1, 'strike'), ['a~~~~ b', 3, 3], 'Without a selection the caret lands between the markers.');
  assert.deepEqual(run('==x==', 2, 3, 'highlight'), ['x', 0, 1]);
});
test('colouring wraps, recolours and removes', () => {
  const run = (text, start, end, color) => { const edit = setColor(text, start, end, color); return [applyEdit(text, edit), ...edit.selection]; };
  assert.deepEqual(run('ein Tag', 4, 7, 'rot'), ['ein [Tag]{rot}', 5, 8]);
  assert.deepEqual(run('ein [Tag]{rot}', 5, 8, 'blau'), ['ein [Tag]{blau}', 5, 8]);
  assert.deepEqual(run('ein [Tag]{rot}', 5, 8, null), ['ein Tag', 4, 7]);
  assert.deepEqual(run('ein [Tag]{rot}', 4, 14, 'grün'), ['ein [Tag]{grün}', 5, 8]);
  assert.deepEqual(run('ein [Tag]{rot}', 4, 14, null), ['ein Tag', 4, 7]);
});
test('reports existing styles and colours of a selection', async () => {
  const { colorAt, hasStyle } = await import('../src/markdown.ts');
  assert.equal(hasStyle('ein **Tag**', 6, 9, 'bold'), true);
  assert.equal(hasStyle('ein **Tag**', 6, 9, 'italic'), false);
  assert.equal(hasStyle('ein ***Tag***', 7, 10, 'italic'), true);
  assert.equal(hasStyle('ein **Tag**', 4, 11, 'bold'), true);
  assert.equal(colorAt('ein [Tag]{rot}', 5, 8), 'rot');
  assert.equal(colorAt('ein [Tag]{rot}', 4, 14), 'rot');
  assert.equal(colorAt('ein Tag', 4, 7), null);
});
test('spans carry absolute offsets of content and markers', async () => {
  const { markdownSpans } = await import('../src/markdown.ts');
  const text = 'a **b *c*** \\* [d]{rot}';
  const spans = markdownSpans(text);
  const show = span => [text.slice(span.from, span.from + span.open), text.slice(span.from + span.open, span.to - span.close), text.slice(span.to - span.close, span.to)];
  assert.deepEqual(spans.map(show), [['**', 'b *c*', '**'], ['*', 'c', '*'], ['\\', '*', ''], ['[', 'd', ']{rot}']]);
  assert.equal(spans[3].color, 'rot');
  assert.deepEqual(spans[0].styles, ['bold']);
});
test('markers are revealed only for parts the cursor touches, and only while focused', async () => {
  const { isRevealed } = await import('../src/markdown.ts');
  const span = { from: 4, to: 12 };
  assert.equal(isRevealed(span, [{ from: 2, to: 2 }], true), false);
  assert.equal(isRevealed(span, [{ from: 4, to: 4 }], true), true, 'Directly before the opening marker.');
  assert.equal(isRevealed(span, [{ from: 12, to: 12 }], true), true, 'Directly after the closing marker.');
  assert.equal(isRevealed(span, [{ from: 13, to: 13 }], true), false);
  assert.equal(isRevealed(span, [{ from: 0, to: 20 }], true), true, 'A selection over the part.');
  assert.equal(isRevealed(span, [{ from: 8, to: 8 }], false), false, 'Never while not editing.');
});
