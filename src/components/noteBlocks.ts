import { StateEffect, StateField } from '@codemirror/state';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, keymap } from '@codemirror/view';
import type { DecorationSet } from '@codemirror/view';
import { parseInline } from '../markdown';
import type { MdNode } from '../markdown';
import { t } from '../i18n';

// Block Markdown for board notes only (entries stay one-line-ish): # headings, - bullets, - [ ] checkboxes, 1. lists,
// ``` code blocks with a copy button, and | tables |. Like the inline formatting, it is a live preview: markers show
// where the cursor is, rendered everywhere else. A table off the cursor is drawn as a real table – a click into a cell
// edits it there, + at its right and bottom edge (on hover) adds a column or a row; Enter at a row's end adds a row,
// Tab moves between cells. Lists go on with Enter (an empty item ends them). Tab / Shift+Tab indent any line (or all
// selected ones) by a level: two spaces, a tab counts as one. Indented lines keep their level when they wrap.

const heading = /^(#{1,3}) /;
const task = /^(\s*)([-*+]) \[( |x|X)\] /;
const bullet = /^(\s*)([-*+]) /;
const ordered = /^(\s*)(\d+)([.)]) /;
const indented = /^([ 	]+)\S/;
/** The level of leading white space: two spaces or one tab each. */
export const indentLevel = (space: string) => Math.floor([...space].reduce((columns, char) => columns + (char === '	' ? 2 : 1), 0) / 2);
const fence = /^\s*```(\S*)\s*$/;
const tableRow = /^\s*\|.*\|\s*$/;
const tableRule = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

export const cellsOf = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim());
export const rowOf = (cells: readonly string[]) => `| ${cells.map(cell => cell || ' ').join(' | ')} |`.replace(/\|  \|/g, '|   |');
const ruleOf = (count: number) => `| ${Array.from({ length: count }, () => '---').join(' | ')} |`;

interface Block { kind: 'table' | 'code'; from: number; to: number; fromLine: number; toLine: number; lang?: string }
/** Tables (a header, a rule line, rows) and fenced code blocks, by line. */
export function findBlocks(state: EditorState): Block[] {
  const doc = state.doc, blocks: Block[] = [];
  for (let number = 1; number <= doc.lines; number++) {
    const line = doc.line(number);
    const open = fence.exec(line.text);
    if (open) {
      let end = number + 1;
      while (end <= doc.lines && !fence.test(doc.line(end).text)) end++;
      if (end > doc.lines) break;
      blocks.push({ kind: 'code', from: line.from, to: doc.line(end).to, fromLine: number, toLine: end, lang: open[1] });
      number = end; continue;
    }
    if (tableRow.test(line.text) && number < doc.lines && tableRule.test(doc.line(number + 1).text)) {
      let end = number + 1;
      while (end < doc.lines && tableRow.test(doc.line(end + 1).text)) end++;
      blocks.push({ kind: 'table', from: line.from, to: doc.line(end).to, fromLine: number, toLine: end });
      number = end;
    }
  }
  return blocks;
}
// Markers and sources show only in the focused editor (like Obsidian): leaving a note renders all of it.
const focusEffect = StateEffect.define<boolean>();
const focusedState = new WeakMap<EditorState, boolean>();
const touches = (state: EditorState, from: number, to: number) => (focusedState.get(state) ?? false) && state.selection.ranges.some(range => range.from <= to && range.to >= from);

function inlineDom(nodes: MdNode[], parent: HTMLElement) {
  for (const node of nodes) {
    if (node.type === 'text') parent.append(node.text);
    else if (node.type === 'style' || node.type === 'color') {
      const span = document.createElement('span');
      span.className = node.type === 'style' ? node.styles.map(style => `md-${style}`).join(' ') : 'md-color';
      if (node.type === 'color') span.style.setProperty('--md-color', `var(--md-${({ rot: 'red', orange: 'orange', gelb: 'yellow', 'grün': 'green', cyan: 'cyan', blau: 'blue', lila: 'purple', pink: 'pink' } as Record<string, string>)[node.color]})`);
      inlineDom(node.children, span); parent.append(span);
    }
  }
}

class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number) { super(); }
  eq(other: TableWidget) { return other.source === this.source && other.from === this.from; }
  toDOM(view: EditorView) {
    const wrap = document.createElement('div'); wrap.className = 'md-table-wrap';
    const table = document.createElement('table'); table.className = 'md-table';
    const lines = this.source.split('\n');
    let offset = this.from;
    lines.forEach((line, index) => {
      const start = offset; offset += line.length + 1;
      if (index === 1) return;
      const row = document.createElement('tr');
      // Each cell knows where its text starts in the source, so a click puts the cursor there.
      let at = start + line.indexOf('|') + 1;
      for (const cell of line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|')) {
        const element = document.createElement(index === 0 ? 'th' : 'td');
        inlineDom(parseInline(cell.trim()), element);
        const position = at + (cell.length - cell.trimStart().length), end = position + cell.trim().length;
        element.addEventListener('mousedown', event => { event.preventDefault(); view.focus(); view.dispatch({ selection: { anchor: end, head: end } }); });
        row.append(element); at += cell.length + 1;
      }
      table.append(row);
    });
    const button = (className: string, label: string, run: () => void) => {
      const element = document.createElement('button'); element.type = 'button'; element.className = className; element.title = label; element.setAttribute('aria-label', label); element.textContent = '+';
      element.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); run(); });
      return element;
    };
    wrap.append(table,
      button('md-table-add md-table-add-col', t('Spalte hinzufügen'), () => tableEdit(view, this.from, 'add-column', Infinity)),
      button('md-table-add md-table-add-row', t('Zeile hinzufügen'), () => tableEdit(view, this.from, 'add-row', Infinity)));
    return wrap;
  }
  ignoreEvent() { return true; }
}
class CodeHeader extends WidgetType {
  constructor(readonly lang: string, readonly code: string, readonly compact: boolean) { super(); }
  eq(other: CodeHeader) { return other.lang === this.lang && other.code === this.code && other.compact === this.compact; }
  toDOM() {
    const bar = document.createElement('span'); bar.className = `md-code-head${this.compact ? ' is-compact' : ''}`;
    if (!this.compact) { const lang = document.createElement('span'); lang.className = 'md-code-lang'; lang.textContent = this.lang || t('Code'); bar.append(lang); }
    const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'md-code-copy'; copy.textContent = t('Kopieren');
    copy.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
    copy.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      void navigator.clipboard?.writeText(this.code).then(() => { copy.textContent = t('Kopiert ✓'); copy.classList.add('is-done'); setTimeout(() => { copy.textContent = t('Kopieren'); copy.classList.remove('is-done'); }, 1400); });
    });
    bar.append(copy);
    return bar;
  }
  ignoreEvent() { return true; }
}
class Bullet extends WidgetType {
  eq() { return true; }
  toDOM() { const dot = document.createElement('span'); dot.className = 'md-bullet'; dot.setAttribute('aria-hidden', 'true'); return dot; }
}
class Checkbox extends WidgetType {
  constructor(readonly checked: boolean, readonly at: number) { super(); }
  eq(other: Checkbox) { return other.checked === this.checked && other.at === this.at; }
  toDOM(view: EditorView) {
    const box = document.createElement('span'); box.className = `md-checkbox${this.checked ? ' is-checked' : ''}`;
    box.setAttribute('role', 'checkbox'); box.setAttribute('aria-checked', String(this.checked));
    box.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); if (view.state.readOnly) return; view.dispatch({ changes: { from: this.at, to: this.at + 1, insert: this.checked ? ' ' : 'x' }, userEvent: 'input.toggle' }); });
    return box;
  }
  ignoreEvent() { return true; }
}

function decorate(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  const doc = state.doc, blocks = findBlocks(state);
  const covered = new Set<number>();
  for (const block of blocks) {
    for (let number = block.fromLine; number <= block.toLine; number++) covered.add(number);
    const editing = touches(state, block.from, block.to);
    if (block.kind === 'table') {
      if (!editing) ranges.push(Decoration.replace({ widget: new TableWidget(doc.sliceString(block.from, block.to), block.from), block: true }).range(block.from, block.to));
      else for (let number = block.fromLine; number <= block.toLine; number++) ranges.push(Decoration.line({ class: `md-table-source${number === block.fromLine + 1 ? ' is-rule' : ''}` }).range(doc.line(number).from));
      continue;
    }
    const code = doc.sliceString(doc.line(block.fromLine).to + 1, doc.line(block.toLine).from - 1);
    for (let number = block.fromLine; number <= block.toLine; number++) {
      const line = doc.line(number);
      const edge = number === block.fromLine ? ' md-code-top' : number === block.toLine ? ' md-code-bottom' : '';
      ranges.push(Decoration.line({ class: `md-code-line${edge}${editing ? ' is-editing' : ''}` }).range(line.from));
    }
    const top = doc.line(block.fromLine), bottom = doc.line(block.toLine);
    if (editing) ranges.push(Decoration.widget({ widget: new CodeHeader(block.lang ?? '', code, true), side: 1 }).range(top.to));
    else {
      ranges.push(Decoration.replace({ widget: new CodeHeader(block.lang ?? '', code, false) }).range(top.from, top.to));
      if (bottom.to > bottom.from) ranges.push(Decoration.replace({}).range(bottom.from, bottom.to));
    }
  }
  for (let number = 1; number <= doc.lines; number++) {
    if (covered.has(number)) continue;
    const line = doc.line(number), text = line.text;
    let match: RegExpExecArray | null;
    if ((match = heading.exec(text))) {
      ranges.push(Decoration.line({ class: `md-h md-h${match[1].length}` }).range(line.from));
      const end = line.from + match[0].length;
      ranges.push((touches(state, line.from, end) ? Decoration.mark({ class: 'md-mark' }) : Decoration.replace({})).range(line.from, end));
    } else if ((match = task.exec(text))) {
      const checked = match[3] !== ' ', start = line.from + match[1].length, end = line.from + match[0].length;
      const editing = touches(state, line.from, end - 1);
      ranges.push(Decoration.line({ class: `md-li md-task${checked ? ' is-done' : ''}${editing ? ' is-source' : ''}`, attributes: { style: `--indent: ${indentLevel(match[1])}` } }).range(line.from));
      // Rendered, the white space is the line's indent (so wrapped lines line up); at the cursor it shows as typed.
      if (!editing) ranges.push(Decoration.replace({ widget: new Checkbox(checked, start + 3) }).range(line.from, end));
      else ranges.push(Decoration.mark({ class: 'md-mark' }).range(start, end));
    } else if ((match = bullet.exec(text))) {
      const start = line.from + match[1].length, end = line.from + match[0].length;
      const editing = touches(state, line.from, end - 1);
      ranges.push(Decoration.line({ class: `md-li md-ul${editing ? ' is-source' : ''}`, attributes: { style: `--indent: ${indentLevel(match[1])}` } }).range(line.from));
      if (!editing) ranges.push(Decoration.replace({ widget: new Bullet() }).range(line.from, end));
      else ranges.push(Decoration.mark({ class: 'md-mark' }).range(start, end));
    } else if ((match = ordered.exec(text))) {
      const start = line.from + match[1].length, editing = touches(state, line.from, start);
      ranges.push(Decoration.line({ class: `md-li md-ol${editing ? ' is-source' : ''}`, attributes: { style: `--indent: ${indentLevel(match[1])}` } }).range(line.from));
      if (!editing && start > line.from) ranges.push(Decoration.replace({}).range(line.from, start));
      ranges.push(Decoration.mark({ class: 'md-ol-mark' }).range(start, line.from + match[0].length - 1));
    } else if ((match = indented.exec(text))) {
      // An indented paragraph: its level as the line's indent.
      const start = line.from + match[1].length, editing = touches(state, line.from, start);
      ranges.push(Decoration.line({ class: `md-indent${editing ? ' is-source' : ''}`, attributes: { style: `--indent: ${indentLevel(match[1])}` } }).range(line.from));
      if (!editing) ranges.push(Decoration.replace({}).range(line.from, start));
    }
  }
  return Decoration.set(ranges, true);
}
const blockField = StateField.define<{ focused: boolean; decorations: DecorationSet }>({
  create: state => ({ focused: false, decorations: decorate(state) }),
  update: (value, transaction) => {
    const effect = transaction.effects.find(item => item.is(focusEffect));
    const focused = effect ? effect.value as boolean : value.focused;
    focusedState.set(transaction.state, focused);
    return effect || transaction.docChanged || transaction.selection ? { focused, decorations: decorate(transaction.state) } : value;
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

/** Changes to the table that starts at `from`; `column` is the cell the cursor is in (Infinity: the last). */
export function tableEdit(view: EditorView, from: number, action: 'add-row' | 'add-column' | 'remove-row' | 'remove-column', column: number, rowLine?: number) {
  const block = findBlocks(view.state).find(item => item.kind === 'table' && item.from === from);
  if (!block) return;
  const doc = view.state.doc;
  const lines = Array.from({ length: block.toLine - block.fromLine + 1 }, (_, index) => doc.line(block.fromLine + index).text);
  const width = cellsOf(lines[0]).length;
  const at = Math.min(column, width - 1);
  let next = lines, cursor: number | null = null;
  if (action === 'add-row') {
    const index = rowLine === undefined ? lines.length : Math.max(2, rowLine - block.fromLine + 1);
    next = [...lines.slice(0, index), rowOf(Array(width).fill('')), ...lines.slice(index)];
    cursor = block.from + next.slice(0, index).join('\n').length + 3;
  } else if (action === 'remove-row') {
    const index = (rowLine ?? block.toLine) - block.fromLine;
    if (index < 2 || lines.length <= 3) return;
    next = lines.filter((_, i) => i !== index);
  } else {
    next = lines.map((line, index) => {
      const cells = cellsOf(line);
      if (action === 'add-column') cells.splice(at + 1, 0, index === 1 ? '---' : '');
      else if (width > 1) cells.splice(at, 1);
      return index === 1 ? ruleOf(cells.length) : rowOf(cells);
    });
  }
  view.dispatch({ changes: { from: block.from, to: block.to, insert: next.join('\n') }, selection: cursor === null ? undefined : { anchor: cursor }, userEvent: 'input.table' });
  view.focus();
}
/** The table (and the cursor's row and column in it) at the cursor, if any. */
export function tableAt(state: EditorState) {
  const head = state.selection.main.head;
  const block = findBlocks(state).find(item => item.kind === 'table' && head >= item.from && head <= item.to);
  if (!block) return null;
  const line = state.doc.lineAt(head);
  const column = Math.max(0, (line.text.slice(0, head - line.from).match(/\|/g)?.length ?? 1) - 1);
  return { block, line: line.number, column };
}

/** Inserting a block from the menu: at the start of the current line (a table or code block on lines of their own). */
export type BlockKind = 'h1' | 'h2' | 'h3' | 'bullets' | 'tasks' | 'numbers' | 'code' | 'table';
export function insertBlock(view: EditorView, kind: BlockKind) {
  const state = view.state, { from, to } = state.selection.main, line = state.doc.lineAt(from);
  const prefixes: Partial<Record<BlockKind, string>> = { h1: '# ', h2: '## ', h3: '### ', bullets: '- ', tasks: '- [ ] ', numbers: '1. ' };
  const prefix = prefixes[kind];
  if (prefix) {
    // On every selected line; a line that has it already loses it, other markers of a line are replaced.
    const last = state.doc.lineAt(to), changes = [];
    let toggled = true;
    for (let number = line.number; number <= last.number; number++) if (!state.doc.line(number).text.startsWith(prefix)) toggled = false;
    for (let number = line.number; number <= last.number; number++) {
      const current = state.doc.line(number), existing = /^(#{1,3} |\s*[-*+] \[[ xX]\] |\s*[-*+] |\s*\d+[.)] )/.exec(current.text)?.[0] ?? '';
      changes.push({ from: current.from, to: current.from + existing.length, insert: toggled ? '' : prefix });
    }
    view.dispatch({ changes, userEvent: 'input.format' });
  } else {
    const before = line.text.trim() ? '\n' : '', selected = state.sliceDoc(from, to);
    const insert = kind === 'code' ? `${before}\`\`\`\n${selected}\n\`\`\`\n` : `${before}| ${t('Spalte 1')} | ${t('Spalte 2')} |\n| --- | --- |\n|   |   |\n`;
    const at = kind === 'code' && before === '' && !selected ? line.from : line.text.trim() ? line.to : line.from;
    const caret = at + before.length + (kind === 'code' ? 4 : 2);
    view.dispatch({ changes: { from: at, to: kind === 'code' && selected ? to : at, insert }, selection: kind === 'code' ? { anchor: caret } : { anchor: caret, head: caret + t('Spalte 1').length }, userEvent: 'input.format' });
  }
  view.focus();
}

function enter(view: EditorView): boolean {
  const state = view.state, { head, empty } = state.selection.main;
  if (!empty) return false;
  const line = state.doc.lineAt(head);
  const table = tableAt(state);
  if (table && head === line.to) { tableEdit(view, table.block.from, 'add-row', 0, line.number + 1); return true; }
  if (findBlocks(state).some(block => block.kind === 'code' && head > block.from && head <= block.to)) return false;
  const match = task.exec(line.text) ?? bullet.exec(line.text) ?? ordered.exec(line.text);
  if (!match) {
    // An indented paragraph goes on at its level.
    const lead = indented.exec(line.text)?.[1];
    if (!lead || head < line.from + lead.length) return false;
    view.dispatch({ changes: { from: head, insert: `
${lead}` }, selection: { anchor: head + 1 + lead.length }, scrollIntoView: true, userEvent: 'input' });
    return true;
  }
  // An empty item ends the list.
  if (line.text.trim() === match[0].trim()) { view.dispatch({ changes: { from: line.from, to: line.to, insert: '' } }); return true; }
  const marker = task.test(line.text) ? `${match[1]}${match[2]} [ ] ` : ordered.test(line.text) ? `${match[1]}${Number(match[2]) + 1}${match[3]} ` : `${match[1]}${match[2]} `;
  view.dispatch({ changes: { from: head, insert: `\n${marker}` }, selection: { anchor: head + 1 + marker.length }, scrollIntoView: true, userEvent: 'input' });
  return true;
}
function tab(view: EditorView, back: boolean): boolean {
  const state = view.state, head = state.selection.main.head;
  const table = tableAt(state);
  if (table) {
    // To the next (or previous) cell, across rows; past the last a new row.
    const pipes: number[] = [];
    for (let number = table.block.fromLine; number <= table.block.toLine; number++) {
      if (number === table.block.fromLine + 1) continue;
      const row = state.doc.line(number);
      [...row.text].forEach((char, index) => { if (char === '|') pipes.push(row.from + index); });
    }
    const cells = pipes.slice(0, -1).map((pipe, index) => [pipe, pipes[index + 1]] as const).filter(([a, b]) => state.doc.lineAt(a).number === state.doc.lineAt(b).number);
    const current = cells.findIndex(([a, b]) => head > a && head <= b);
    const target = cells[current + (back ? -1 : 1)];
    if (!target) { if (!back) tableEdit(view, table.block.from, 'add-row', 0); return true; }
    const text = state.sliceDoc(target[0] + 1, target[1]), start = target[0] + 1 + (text.length - text.trimStart().length);
    view.dispatch({ selection: { anchor: start, head: start + text.trim().length } });
    return true;
  }
  // Every line of the selection moves a level in or out. Shift+Tab on a line that is not indented leaves the note.
  const { from, to } = state.selection.main, first = state.doc.lineAt(from), last = state.doc.lineAt(to), changes = [];
  for (let number = first.number; number <= last.number; number++) {
    const current = state.doc.line(number);
    if (back) { const lead = /^(	| {1,2})/.exec(current.text)?.[0].length ?? 0; if (lead) changes.push({ from: current.from, to: current.from + lead }); }
    else if (current.text.trim() || first.number === last.number) changes.push({ from: current.from, insert: '  ' });
  }
  if (!changes.length) return !back;
  view.dispatch({ changes, userEvent: back ? 'delete.dedent' : 'input.indent' });
  return true;
}

/** `tab: false` leaves Tab to the form around the editor (an entry's description): it moves on to the next field. */
export const noteBlocks = ({ tab: indents = true }: { tab?: boolean } = {}): Extension => [
  blockField,
  EditorView.focusChangeEffect.of((_, focusing) => focusEffect.of(focusing)),
  keymap.of([{ key: 'Enter', run: enter }, ...indents ? [{ key: 'Tab', run: (view: EditorView) => tab(view, false), shift: (view: EditorView) => tab(view, true) }] : []]),
];
