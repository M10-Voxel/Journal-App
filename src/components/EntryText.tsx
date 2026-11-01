import { t, useLanguage } from '../i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Entry } from '../journal';
import { Edit, Style, TextColor, colorAt, hasStyle, setColor, textColors, toggleStyle } from '../markdown';
import { createEntryEditor } from './entryEditor';
import type { EntryEditor } from './entryEditor';
import { FormatMenu } from './FormatMenu';

interface StrikeLine { x1: number; x2: number; y: number }
const styleKeys: Record<string, Style> = { KeyB: 'bold', KeyI: 'italic' };
const shiftStyleKeys: Record<string, Style> = { KeyX: 'strike', KeyH: 'highlight' };

// `strike` is 'ghost' while a cancel action is only being previewed.
export function EntryText({ entry, label, strike, readOnly = false, onChange, focusEntryId }: { entry: Entry; label: string; strike: 'solid' | 'ghost' | null; readOnly?: boolean; onChange: (text: string) => void; focusEntryId: { current: string | null } }) {
  useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editor = useRef<EntryEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const measureRef = useRef<() => void>(() => {});
  const [lines, setLines] = useState<StrikeLine[]>([]);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ariaLabel = readOnly ? t("{0} (geplant, Spur)", label) : t("{0} bearbeiten", label);

  useLayoutEffect(() => {
    const instance = createEntryEditor({
      parent: hostRef.current!, text: entry.text, readOnly, label: ariaLabel,
      onChange: text => onChangeRef.current(text),
      // Hidden or revealed markers change the text's geometry, so a strike-through is re-measured after such updates.
      onUpdate: update => { if (update.geometryChanged || update.focusChanged || update.selectionSet) requestAnimationFrame(() => measureRef.current()); },
    });
    editor.current = instance;
    if (focusEntryId.current === entry.id) { instance.view.focus(); focusEntryId.current = null; }
    return () => { instance.view.destroy(); editor.current = null; };
  }, []);
  useEffect(() => { editor.current?.setText(entry.text); }, [entry.text]);
  useEffect(() => { editor.current?.configure({ readOnly, label: ariaLabel }); }, [readOnly, ariaLabel]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const content = editor.current?.view.contentDOM;
    if (!container || !content) return;
    if (!strike) { measureRef.current = () => {}; setLines(previous => previous.length ? [] : previous); return; }
    function measure() {
      if (!container || !content) return;
      // Only text counts: the editor's line elements are full-width blocks.
      const origin = container.getBoundingClientRect();
      const rects: StrikeLine[] = [];
      const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const rect of range.getClientRects()) if (rect.width > 0) rects.push({ x1: rect.left - origin.left, x2: rect.right - origin.left, y: rect.top - origin.top + rect.height / 2 });
      }
      // Lines and inline spans each add rectangles; one stroke per visual row, the first one reaching across the symbol.
      const rows: StrikeLine[] = [];
      for (const rect of rects) {
        const row = rows.find(other => Math.abs(other.y - rect.y) < 4);
        if (row) { row.x1 = Math.min(row.x1, rect.x1); row.x2 = Math.max(row.x2, rect.x2); } else rows.push({ ...rect });
      }
      rows.sort((a, b) => a.y - b.y);
      if (rows.length) rows[0].x1 = -40; else rows.push({ x1: -40, x2: 5, y: 18 });
      setLines(previous => previous.length === rows.length && previous.every((line, index) => line.x1 === rows[index].x1 && line.x2 === rows[index].x2 && line.y === rows[index].y) ? previous : rows);
    }
    measureRef.current = measure;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    // The writing font loads lazily; once it is in, the text has new line breaks without the box necessarily resizing.
    document.fonts.addEventListener('loadingdone', measure);
    return () => { observer.disconnect(); document.fonts.removeEventListener('loadingdone', measure); };
  }, [entry.text, strike !== null]);

  // Formatting is an ordinary editor transaction, so Ctrl+Z undoes it like typing.
  function apply(edit: Edit) {
    const view = editor.current?.view;
    if (!view || readOnly) return;
    view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.selection[0], head: edit.selection[1] }, userEvent: 'input.format' });
    view.focus();
  }
  const selection = () => { const state = editor.current!.view.state; return [state.doc.toString(), state.selection.main.from, state.selection.main.to] as const; };
  const style = (name: Style) => { const [text, start, end] = selection(); apply(toggleStyle(text, start, end, name)); };
  const color = (name: TextColor | null) => { const [text, start, end] = selection(); apply(setColor(text, start, end, name)); };
  const closeMenu = useCallback(() => setMenu(null), []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (readOnly || event.metaKey || !editor.current) return;
    const ctrl = event.ctrlKey && !event.altKey;
    if (ctrl && !event.shiftKey && event.code in styleKeys) style(styleKeys[event.code]);
    else if (ctrl && event.shiftKey && event.code in shiftStyleKeys) style(shiftStyleKeys[event.code]);
    else if (event.altKey && !event.ctrlKey && !event.shiftKey && /^Digit[0-8]$/.test(event.code)) {
      const index = Number(event.code.slice(5));
      color(index === 0 ? null : textColors[index - 1].name);
    } else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const [text, start, end] = menu && editor.current ? selection() : ['', 0, 0];
  return <div className="entry-edit" ref={containerRef} onKeyDown={onKeyDown} onBlur={closeMenu}
    aria-keyshortcuts="Control+B Control+I Control+Shift+X Control+Shift+H Alt+1 Alt+2 Alt+3 Alt+4 Alt+5 Alt+6 Alt+7 Alt+8 Alt+0"
    onContextMenu={event => {
      // Only selected text gets the format menu; otherwise the system menu (copy, paste, spelling) stays.
      const state = editor.current?.view.state;
      if (readOnly || !state || state.selection.main.empty) return;
      event.preventDefault();
      setMenu({ x: event.clientX, y: event.clientY });
    }}>
    <div className="entry-host" ref={hostRef} />
    {strike && <svg className={`strike-overlay${strike === 'ghost' ? ' is-ghost' : ''}`} aria-hidden="true">{lines.map((line, index) => <line key={index} pathLength={1} x1={line.x1} x2={line.x2} y1={line.y} y2={line.y} />)}</svg>}
    {menu && <FormatMenu x={menu.x} y={menu.y} color={colorAt(text, start, end)}
      active={{ bold: hasStyle(text, start, end, 'bold'), italic: hasStyle(text, start, end, 'italic'), strike: hasStyle(text, start, end, 'strike'), highlight: hasStyle(text, start, end, 'highlight') }}
      onStyle={style} onColor={color} onClose={closeMenu} />}
  </div>;
}
