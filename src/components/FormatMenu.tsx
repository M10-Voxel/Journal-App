import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { Style, TextColor, textColors } from '../markdown';

const styles: { style: Style; label: string; tip: string }[] = [
  { style: 'bold', label: 'Fett', tip: 'Fett · Strg B' },
  { style: 'italic', label: 'Kursiv', tip: 'Kursiv · Strg I' },
  { style: 'strike', label: 'Durchgestrichen', tip: 'Durchgestrichen · Strg ⇧ X' },
  { style: 'highlight', label: 'Markieren', tip: 'Markieren · Strg ⇧ H' },
];

// Right-click menu for selected text. It never takes focus (mousedown is prevented), so the editor keeps its selection.
export function FormatMenu({ x, y, active, color, onStyle, onColor, onClose }: {
  x: number; y: number; active: Record<Style, boolean>; color: TextColor | null;
  onStyle: (style: Style) => void; onColor: (color: TextColor | null) => void; onClose: () => void;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: x, top: y });
  // Formatting may scroll the list a little to keep the cursor in view; that is no reason to close, only real scrolling is.
  const actedAt = useRef(0);
  const acting = <A extends unknown[]>(action: (...args: A) => void) => (...args: A) => { actedAt.current = performance.now(); action(...args); };

  // Keep the menu inside the window.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(x, innerWidth - width - 8)), top: y + height + 8 > innerHeight ? Math.max(8, y - height - 4) : y + 4 });
  }, [x, y]);
  useEffect(() => {
    const close = (event: Event) => { if (!menuRef.current?.contains(event.target as Node)) onClose(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', key, true);
    const scroll = () => { if (performance.now() - actedAt.current > 400) onClose(); };
    window.addEventListener('blur', onClose);
    document.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [onClose]);

  return createPortal(<div ref={menuRef} className="format-menu" role="toolbar" aria-label="Text formatieren" style={position} onMouseDown={event => event.preventDefault()}>
    <div className="format-row">
      {styles.map(({ style, label, tip }) => <button key={style} type="button" className={`format-style format-${style}`} aria-label={label} aria-pressed={active[style]} data-tip={tip} onClick={acting(() => onStyle(style))}>
        {{ bold: 'B', italic: 'I', strike: 'S', highlight: 'H' }[style]}
      </button>)}
    </div>
    <div className="format-row format-colors">
      {textColors.map(({ name, value }, index) => <button key={name} type="button" className="format-color" aria-label={`Farbe ${name}`} aria-pressed={color === name} data-tip={`${name[0].toUpperCase()}${name.slice(1)} · Alt ${index + 1}`}
        style={{ '--swatch': value } as CSSProperties} onClick={acting(() => onColor(name))} />)}
      <button type="button" className="format-color format-no-color" aria-label="Farbe entfernen" data-tip="Ohne Farbe · Alt 0" disabled={!color} onClick={acting(() => onColor(null))} />
    </div>
  </div>, document.body);
}
