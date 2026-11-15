import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Entry } from '../journal';
import { createEntryEditor } from './entryEditor';
import type { EntryEditor } from './entryEditor';
import { useFormatting } from './useFormatting';

interface StrikeLine { x1: number; x2: number; y: number }
// `strike` is 'ghost' while a cancel action is only being previewed.
export function EntryText({ entry, label, strike, readOnly = false, rich = false, onChange, focusEntryId }: { rich?: boolean; entry: Entry; label: string; strike: 'solid' | 'ghost' | null; readOnly?: boolean; onChange: (text: string) => void; focusEntryId: { current: string | null } }) {
  useLanguage();
  const containerRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const editor = useRef<EntryEditor | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const measureRef = useRef<() => void>(() => {});
  const [lines, setLines] = useState<StrikeLine[]>([]);
  const ariaLabel = readOnly ? t("{0} (geplant, Spur)", label) : t("{0} bearbeiten", label);

  useLayoutEffect(() => {
    const instance = createEntryEditor({
      parent: hostRef.current!, text: entry.text, readOnly, label: ariaLabel, rich,
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

  const format = useFormatting(editor, { readOnly, rich });

  return <div className="entry-edit" ref={containerRef} onKeyDown={format.onKeyDown} onBlur={format.onBlur}
    aria-keyshortcuts="Control+B Control+I Control+E Control+Shift+X Control+Shift+H Alt+1 Alt+2 Alt+3 Alt+4 Alt+5 Alt+6 Alt+7 Alt+8 Alt+0"
    onContextMenu={format.onContextMenu}>
    <div className="entry-host" ref={hostRef} />
    {strike && <svg className={`strike-overlay${strike === 'ghost' ? ' is-ghost' : ''}`} aria-hidden="true">{lines.map((line, index) => <line key={index} pathLength={1} x1={line.x1} x2={line.x2} y1={line.y} y2={line.y} />)}</svg>}
    {format.menu}
  </div>;
}
