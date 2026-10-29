import { Annotation, Compartment, EditorState, Transaction } from '@codemirror/state';
import type { Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, keymap } from '@codemirror/view';
import type { DecorationSet, ViewUpdate } from '@codemirror/view';
import { history, historyKeymap } from '@codemirror/commands';
import { isRevealed, markdownSpans, textColors } from '../markdown';
import type { TextColor } from '../markdown';

// The editor of an entry: CodeMirror with Obsidian-like live preview. Formatting is always rendered; its markers
// (`**`, `]{rot}` …) are only shown while the cursor or selection touches that part, and hidden everywhere else.

const colorValue = Object.fromEntries(textColors.map(color => [color.name, color.value])) as Record<TextColor, string>;
const hidden = Decoration.replace({});
const marker = Decoration.mark({ class: 'md-mark' });
const colorMarker = (color: TextColor) => Decoration.mark({ class: 'md-mark md-color-mark', attributes: { style: `--md-color: ${colorValue[color]}` } });

function previewDecorations(view: EditorView): DecorationSet {
  const focused = view.hasFocus && !view.state.readOnly;
  const selection = view.state.selection.ranges;
  const decorations: Range<Decoration>[] = [];
  const add = (from: number, to: number, decoration: Decoration) => { if (to > from) decorations.push(decoration.range(from, to)); };
  for (const span of markdownSpans(view.state.doc.toString())) {
    const shown = isRevealed(span, selection, focused);
    add(span.from, span.from + span.open, shown ? marker : hidden);
    add(span.to - span.close, span.to, shown ? span.color ? colorMarker(span.color) : marker : hidden);
    const classes = [...span.styles.map(style => `md-${style}`), ...span.color ? ['md-color'] : []];
    if (classes.length) add(span.from + span.open, span.to - span.close, Decoration.mark({ class: classes.join(' '), attributes: span.color ? { style: `--md-color: ${colorValue[span.color]}` } : undefined }));
  }
  return Decoration.set(decorations, true);
}

const livePreview = ViewPlugin.fromClass(class {
  decorations: DecorationSet;
  constructor(view: EditorView) { this.decorations = previewDecorations(view); }
  update(update: ViewUpdate) {
    if (update.docChanged || update.selectionSet || update.focusChanged || update.transactions.some(tr => tr.reconfigured)) this.decorations = previewDecorations(update.view);
  }
}, { decorations: plugin => plugin.decorations });

// Tauri adds a nonce to the app's CSP (which makes 'unsafe-inline' ineffective), so CodeMirror's injected styles must
// carry it too. The nonce is read from the elements Tauri stamped; without one the CSP still allows inline styles.
const cspNonce = (document.querySelector<HTMLElement>('style[nonce], script[nonce]')?.nonce) || null;

// Layout lives in styles.css; this only neutralises CodeMirror's defaults that need its own specificity.
const theme = EditorView.theme({
  '&': { backgroundColor: 'transparent', color: 'inherit', fontSize: '13px' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'inherit', lineHeight: '24px', overflow: 'visible' },
  '.cm-content': { padding: '6px 5px', minHeight: '36px', caretColor: 'var(--accent)' },
  '.cm-line': { padding: '0' },
});

/** The textarea-like surface of an entry editor, so navigation and focus code can treat it like a text field. */
export type TextField = HTMLElement & {
  readonly value: string; readonly selectionStart: number; readonly selectionEnd: number;
  readonly selectionDirection: 'forward' | 'backward' | 'none'; readonly readOnly: boolean;
  setSelectionRange(start: number, end: number, direction?: 'forward' | 'backward' | 'none'): void;
};
export const asTextField = (target: EventTarget | null): TextField | null =>
  target instanceof HTMLElement && target.classList.contains('entry-text') ? target as TextField : null;

const external = Annotation.define<boolean>();

export interface EntryEditor {
  view: EditorView;
  setText(text: string): void;
  configure(options: { readOnly: boolean; label: string }): void;
}

export function createEntryEditor({ parent, text, readOnly, label, onChange, onUpdate }: {
  parent: HTMLElement; text: string; readOnly: boolean; label: string;
  onChange: (text: string) => void; onUpdate: (update: ViewUpdate) => void;
}): EntryEditor {
  const settings = new Compartment();
  const configuration = (readOnly: boolean, label: string) => [
    EditorState.readOnly.of(readOnly),
    EditorView.contentAttributes.of({ class: 'entry-text', 'aria-label': label, 'aria-multiline': 'true', spellcheck: 'true', role: 'textbox' }),
  ];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        history(), keymap.of(historyKeymap), EditorView.lineWrapping, livePreview, theme, settings.of(configuration(readOnly, label)),
        cspNonce ? EditorView.cspNonce.of(cspNonce) : [],
        EditorView.updateListener.of(update => {
          if (update.docChanged && !update.transactions.every(tr => tr.annotation(external))) onChange(update.state.doc.toString());
          onUpdate(update);
        }),
      ],
    }),
  });
  const content = view.contentDOM as TextField;
  Object.defineProperties(content, {
    value: { get: () => view.state.doc.toString() },
    // Writable like a textarea's: React itself restores selections this way after moving focused elements.
    selectionStart: { get: () => view.state.selection.main.from, set: (start: number) => content.setSelectionRange(start, Math.max(start, view.state.selection.main.to)) },
    selectionEnd: { get: () => view.state.selection.main.to, set: (end: number) => content.setSelectionRange(Math.min(end, view.state.selection.main.from), end) },
    selectionDirection: { get: () => { const { anchor, head } = view.state.selection.main; return head < anchor ? 'backward' : anchor === head ? 'none' : 'forward'; } },
    readOnly: { get: () => view.state.readOnly },
    setSelectionRange: { value: (start: number, end: number, direction?: string) => {
      const length = view.state.doc.length;
      const from = Math.min(Math.max(start, 0), length), to = Math.min(Math.max(end, from), length);
      view.dispatch({ selection: direction === 'backward' ? { anchor: to, head: from } : { anchor: from, head: to } });
    } },
  });
  return {
    view,
    setText(next) {
      if (view.state.doc.toString() === next) return;
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: next }, annotations: [external.of(true), Transaction.addToHistory.of(false)] });
    },
    configure({ readOnly, label }) { view.dispatch({ effects: settings.reconfigure(configuration(readOnly, label)) }); },
  };
}
