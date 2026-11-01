// Inline Markdown for entry texts: **bold**, *italic* (also _italic_), ***both***, ~~strike~~, ==highlight==,
// [text]{color} with theme-aware semantic colours, and \-escapes. No code, links or formulas.
// Every character of the source is kept in the tree: formatted nodes carry their `open`/`close` markers, escapes are
// `mark` nodes. The editor uses this to hide markers unless the cursor is in or at the formatted part.

export const textColors = [
  { name: 'rot', value: 'var(--md-red, #df6262)' }, { name: 'orange', value: 'var(--md-orange, #e6a85c)' }, { name: 'gelb', value: 'var(--md-yellow, #e2d7b7)' }, { name: 'grün', value: 'var(--md-green, #76d982)' },
  { name: 'cyan', value: 'var(--md-cyan, #c2dce9)' }, { name: 'blau', value: 'var(--md-blue, #569eff)' }, { name: 'lila', value: 'var(--md-purple, #c69bff)' }, { name: 'pink', value: 'var(--md-pink, #ad4075)' },
] as const;
export type TextColor = typeof textColors[number]['name'];
export type Style = 'bold' | 'italic' | 'strike' | 'highlight';
export type MdNode =
  | { type: 'text'; text: string }
  | { type: 'mark'; text: string }
  | { type: 'style'; styles: Style[]; open: string; close: string; children: MdNode[] }
  | { type: 'color'; color: TextColor; open: string; close: string; children: MdNode[] };

const delimiters: { marker: string; styles: Style[] }[] = [
  { marker: '***', styles: ['bold', 'italic'] }, { marker: '**', styles: ['bold'] }, { marker: '__', styles: ['bold'] },
  { marker: '~~', styles: ['strike'] }, { marker: '==', styles: ['highlight'] }, { marker: '*', styles: ['italic'] }, { marker: '_', styles: ['italic'] },
];
const colorNames = textColors.map(color => color.name).join('|');
const colorEnd = new RegExp(`\\]\\{(${colorNames})\\}`, 'gu');
const space = /\s/u;
const word = /[\p{L}\p{N}]/u;

/** Index of the closing `marker` for an opening one ending at `from`, or -1. Closers must follow a non-space. */
function findClose(text: string, marker: string, from: number): number {
  for (let index = text.indexOf(marker, from + 1); index >= 0; index = text.indexOf(marker, index + 1)) {
    if (space.test(text[index - 1])) continue;
    // A single * or _ must not be part of a longer run (that belongs to bold), and _ only closes at a word end.
    if (marker.length === 1 && (text[index + 1] === marker || text[index - 1] === marker)) continue;
    if (marker === '_' && word.test(text[index + 1] ?? '')) continue;
    // In a longer run (`**b *c***`) the closer is the end of the run, leaving the inner `*` to the nested part.
    while (marker.length > 1 && text[index + marker.length] === marker[0]) index += 1;
    return index;
  }
  return -1;
}

export function parseInline(text: string): MdNode[] {
  const nodes: MdNode[] = [];
  let plain = '';
  const flush = () => { if (plain) { nodes.push({ type: 'text', text: plain }); plain = ''; } };
  let index = 0;
  outer: while (index < text.length) {
    const char = text[index];
    if (char === '\\' && /[*_~=[\]{}\\]/.test(text[index + 1] ?? '')) {
      flush();
      nodes.push({ type: 'mark', text: '\\' });
      plain += text[index + 1];
      index += 2;
      continue;
    }
    if (char === '[') {
      colorEnd.lastIndex = index + 2;
      const end = colorEnd.exec(text);
      if (end) {
        flush();
        nodes.push({ type: 'color', color: end[1] as TextColor, open: '[', close: end[0], children: parseInline(text.slice(index + 1, end.index)) });
        index = end.index + end[0].length;
        continue;
      }
    }
    for (const { marker, styles } of delimiters) {
      if (!text.startsWith(marker, index)) continue;
      const after = text[index + marker.length];
      if (after === undefined || space.test(after) || (marker.length === 1 && after === marker)) continue;
      if (marker === '_' && word.test(text[index - 1] ?? '')) continue;
      const close = findClose(text, marker, index + marker.length);
      if (close < 0) continue;
      flush();
      nodes.push({ type: 'style', styles, open: marker, close: marker, children: parseInline(text.slice(index + marker.length, close)) });
      index = close + marker.length;
      continue outer;
    }
    plain += char;
    index += 1;
  }
  flush();
  return nodes;
}

/** Plain text without markers, e.g. for labels. */
export function plainText(text: string): string {
  const walk = (nodes: MdNode[]): string => nodes.map(node => node.type === 'text' ? node.text : node.type === 'mark' ? '' : walk(node.children)).join('');
  return walk(parseInline(text));
}

/** A text change: replace `from`–`to` with `insert`, then select `selection` (in the new text). */
export interface Edit { from: number; to: number; insert: string; selection: [number, number] }

const runBefore = (text: string, index: number, char: string) => { let count = 0; while (text[index - count - 1] === char) count += 1; return count; };
const runAfter = (text: string, index: number, char: string) => { let count = 0; while (text[index + count] === char) count += 1; return count; };

/**
 * Toggles a style around the selection. Bold/strike/highlight are present when both sides have a run of at least
 * two marker characters; italic when both runs are odd (`*x*` or `***x***`), so italic and bold can be combined.
 * A selection that includes the markers is unwrapped as well.
 */
const styleMarkers: Record<Style, string> = { bold: '**', italic: '*', strike: '~~', highlight: '==' };
function surrounded(text: string, start: number, end: number, style: Style): boolean {
  const char = styleMarkers[style][0];
  const before = runBefore(text, start, char);
  const after = runAfter(text, end, char);
  return style === 'italic' ? before % 2 === 1 && after % 2 === 1 : before >= 2 && after >= 2;
}
/** Whether the selection already carries `style` (markers around it or included at its ends). */
export function hasStyle(text: string, start: number, end: number, style: Style): boolean {
  const marker = styleMarkers[style];
  const selected = text.slice(start, end);
  return (selected.length > marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) || surrounded(text, start, end, style);
}
/** The colour of a colour span the selection exactly covers (with or without its markers). */
export function colorAt(text: string, start: number, end: number): TextColor | null {
  const closing = text.slice(end).match(new RegExp(`^\\]\\{(${colorNames})\\}`, 'u'));
  if (text[start - 1] === '[' && closing) return closing[1] as TextColor;
  return (text.slice(start, end).match(new RegExp(`^\\[[\\s\\S]*\\]\\{(${colorNames})\\}$`, 'u'))?.[1] as TextColor | undefined) ?? null;
}

export function toggleStyle(text: string, start: number, end: number, style: Style): Edit {
  const marker = styleMarkers[style];
  const selected = text.slice(start, end);
  if (selected.length > marker.length * 2 && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(marker.length, -marker.length);
    return { from: start, to: end, insert: inner, selection: [start, start + inner.length] };
  }
  if (surrounded(text, start, end, style)) {
    const size = marker.length;
    return { from: start - size, to: end + size, insert: selected, selection: [start - size, end - size] };
  }
  return { from: start, to: end, insert: `${marker}${selected}${marker}`, selection: [start + marker.length, end + marker.length] };
}

/** Colours the selection, recolours a colour span it exactly covers, or removes it (`color` null). */
export function setColor(text: string, start: number, end: number, color: TextColor | null): Edit {
  const selected = text.slice(start, end);
  const closing = text.slice(end).match(new RegExp(`^\\]\\{(${colorNames})\\}`, 'u'));
  if (text[start - 1] === '[' && closing) {
    const insert = color ? `[${selected}]{${color}}` : selected;
    return { from: start - 1, to: end + closing[0].length, insert, selection: color ? [start, end] : [start - 1, end - 1] };
  }
  const inner = selected.match(new RegExp(`^\\[([\\s\\S]*)\\]\\{(${colorNames})\\}$`, 'u'));
  if (inner) {
    const insert = color ? `[${inner[1]}]{${color}}` : inner[1];
    return { from: start, to: end, insert, selection: color ? [start + 1, start + 1 + inner[1].length] : [start, start + inner[1].length] };
  }
  if (!color) return { from: start, to: end, insert: selected, selection: [start, end] };
  return { from: start, to: end, insert: `[${selected}]{${color}}`, selection: [start + 1, end + 1] };
}

export function applyEdit(text: string, edit: Edit): string {
  return text.slice(0, edit.from) + edit.insert + text.slice(edit.to);
}

/** A formatted part with absolute offsets: markers are `from`–`from+open` and `to-close`–`to`. */
export interface MdSpan { from: number; to: number; open: number; close: number; styles: Style[]; color: TextColor | null }

/** All formatted parts and escapes of `text`, outermost first. Escapes are spans with `open` 1 and no closing marker. */
export function markdownSpans(text: string): MdSpan[] {
  const spans: MdSpan[] = [];
  const walk = (nodes: MdNode[], start: number): number => {
    let position = start;
    for (const node of nodes) {
      if (node.type === 'text') { position += node.text.length; continue; }
      if (node.type === 'mark') { spans.push({ from: position, to: position + 2, open: 1, close: 0, styles: [], color: null }); position += node.text.length; continue; }
      const span: MdSpan = { from: position, to: 0, open: node.open.length, close: node.close.length, styles: node.type === 'style' ? node.styles : [], color: node.type === 'color' ? node.color : null };
      spans.push(span);
      span.to = walk(node.children, position + node.open.length) + node.close.length;
      position = span.to;
    }
    return position;
  };
  walk(parseInline(text), 0);
  return spans;
}

/** Markers are shown while the editor has focus and a cursor or selection touches the part (edges included). */
export function isRevealed(span: Pick<MdSpan, 'from' | 'to'>, selection: readonly { from: number; to: number }[], focused: boolean): boolean {
  return focused && selection.some(range => range.from <= span.to && range.to >= span.from);
}
