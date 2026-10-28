import { useLayoutEffect, useRef, useState } from 'react';
import { Entry } from '../journal';

interface StrikeLine { x1: number; x2: number; y: number }

export function EntryText({ entry, label, onChange, focusEntryId }: { entry: Entry; label: string; onChange: (text: string) => void; focusEntryId: { current: string | null } }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [lines, setLines] = useState<StrikeLine[]>([]);

  useLayoutEffect(() => {
    if (focusEntryId.current !== entry.id) return;
    inputRef.current?.focus();
    focusEntryId.current = null;
  }, []);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;
    if (!entry.cancelled) { setLines(previous => previous.length ? [] : previous); return; }
    function measure() {
      if (!container || !text) return;
      const range = document.createRange();
      range.selectNodeContents(text);
      const origin = container.getBoundingClientRect();
      const next = Array.from(range.getClientRects()).filter(rect => rect.width > 0).map((rect, index) => ({
        x1: index === 0 ? -40 : rect.left - origin.left,
        x2: rect.right - origin.left,
        y: rect.top - origin.top + rect.height / 2,
      }));
      if (next.length === 0) next.push({ x1: -40, x2: 5, y: 18 });
      setLines(previous => previous.length === next.length && previous.every((line, index) => line.x1 === next[index].x1 && line.x2 === next[index].x2 && line.y === next[index].y) ? previous : next);
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [entry.text, entry.cancelled]);

  return <div className="entry-edit" ref={containerRef}>
    <div className="entry-mirror" aria-hidden="true"><span ref={textRef}>{entry.text}</span>{' '}</div>
    <textarea ref={inputRef} className="entry-text" rows={1} aria-label={`${label} bearbeiten`} value={entry.text} onChange={e => onChange(e.target.value)} />
    {entry.cancelled && <svg className="strike-overlay" aria-hidden="true">{lines.map((line, index) => <line key={index} pathLength={1} x1={line.x1} x2={line.x2} y1={line.y} y2={line.y} />)}</svg>}
  </div>;
}
