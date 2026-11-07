import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useDismissLayer } from './useDismissLayer';
import { Style, TextColor, textColors } from '../markdown';
import type { BlockKind } from './noteBlocks';

const styles = (): { style: Style; label: string; tip: string }[] => ([
  { style: 'bold', label: t("Fett"), tip: t("Fett · Strg B") },
  { style: 'italic', label: t("Kursiv"), tip: t("Kursiv · Strg I") },
  { style: 'strike', label: t("Durchgestrichen"), tip: t("Durchgestrichen · Strg ⇧ X") },
  { style: 'highlight', label: t("Markieren"), tip: t("Markieren · Strg ⇧ H") },
]);

// Right-click menu for selected text. It never takes focus (mousedown is prevented), so the editor keeps its selection.
export function FormatMenu({ x, y, active, color, onStyle, onColor, onClose, blocks, byKey = false, onReturn }: {
  /** Opened from the keyboard: the first button takes the focus, arrows move, Escape returns to the text. */
  byKey?: boolean; onReturn?: () => void;
  /** Board notes also offer blocks, and inside a table its rows and columns. */
  blocks?: { table: boolean; onBlock: (kind: BlockKind) => void; onTable: (action: 'add-row' | 'add-column' | 'remove-row' | 'remove-column') => void };
  x: number; y: number; active: Record<Style, boolean>; color: TextColor | null;
  onStyle: (style: Style) => void; onColor: (color: TextColor | null) => void; onClose: () => void;
}) {
  useLanguage();
  const menuRef = useRef<HTMLDivElement>(null);
  useDismissLayer({element:()=>menuRef.current,onDismiss:onClose});
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
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); onReturn?.(); } };
    window.addEventListener('keydown', key, true);
    const scroll = () => { if (performance.now() - actedAt.current > 400) onClose(); };
    window.addEventListener('blur', onClose);
    document.addEventListener('scroll', scroll, true);
    return () => {
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      document.removeEventListener('scroll', scroll, true);
    };
  }, [onClose]);

  useEffect(() => { if (byKey) menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [byKey]);
  return createPortal(<div ref={menuRef} className="format-menu" role="toolbar" aria-label={t("Text formatieren")} style={position} onMouseDown={event => event.preventDefault()}
    onKeyDown={event => {
      const buttons = [...menuRef.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')], index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1, Home: -Infinity, End: Infinity }[event.key];
      if (step === undefined || index < 0) return;
      event.preventDefault();
      buttons[step === -Infinity ? 0 : step === Infinity ? buttons.length - 1 : (index + step + buttons.length) % buttons.length]?.focus();
    }}
    onBlur={event => { if (byKey && !menuRef.current?.contains(event.relatedTarget as Node) && !(event.relatedTarget as Element | null)?.closest('.cm-editor')) onClose(); }}>
    <div className="format-row">
      {styles().map(({ style, label, tip }) => <button key={style} type="button" className={`format-style format-${style}`} aria-label={label} aria-pressed={active[style]} data-tip={tip} onClick={acting(() => onStyle(style))}>
        {{ bold: 'B', italic: 'I', strike: 'S', highlight: 'H' }[style]}
      </button>)}
    </div>
    <div className="format-row format-colors">
      {textColors.map(({ name, value }, index) => <button key={name} type="button" className="format-color" aria-label={t("Farbe {0}", t(name))} aria-pressed={color === name} data-tip={`${t(name)[0].toUpperCase()}${t(name).slice(1)} · Alt ${index + 1}`}
        style={{ '--swatch': value } as CSSProperties} onClick={acting(() => onColor(name))} />)}
      <button type="button" className="format-color format-no-color" aria-label={t("Farbe entfernen")} data-tip={t("Ohne Farbe · Alt 0")} disabled={!color} onClick={acting(() => onColor(null))} />
    </div>
    {blocks && <div className="format-row format-blocks">
      {([['h1', 'H1', t('Überschrift 1')], ['h2', 'H2', t('Überschrift 2')], ['h3', 'H3', t('Überschrift 3')], ['bullets', '•', t('Stichpunkte')], ['tasks', '☐', t('Checkliste')], ['numbers', '1.', t('Nummeriert')], ['code', '</>', t('Codeblock')], ['table', '▦', t('Tabelle')]] as [BlockKind, string, string][])
        .map(([kind, symbol, label]) => <button key={kind} type="button" className={`format-block format-block-${kind}`} aria-label={label} data-tip={label} onClick={acting(() => blocks.onBlock(kind))}>{symbol}</button>)}
    </div>}
    {blocks?.table && <div className="format-row format-table">
      {([['add-row', t('+ Zeile')], ['add-column', t('+ Spalte')], ['remove-row', t('− Zeile')], ['remove-column', t('− Spalte')]] as const).map(([action, label]) =>
        <button key={action} type="button" className="format-table-action" onClick={acting(() => blocks.onTable(action))}>{label}</button>)}
    </div>}
  </div>, document.body);
}
