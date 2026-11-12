import { useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { inkPaperOf, nextPaperStep, paperSteps } from '../ink';
import type { InkPaper, InkPen, InkTool } from '../ink';
import { clampSize, isPen, markerColors, nextPen, normalizePrefs, penColors, sizePresets, sizeRanges, withRecent } from '../inkPrefs';
import type { InkPrefs, PenPrefs, SizedTool } from '../inkPrefs';
import type { Card } from '../notebook';
import { t } from '../i18n';
import { ColorPicker } from './ColorPicker';
import { Popover } from './Popover';

// The handwriting strip: kinds of pen and of selection in small dropdowns with icons, the eraser, the colour, the width
// and the note's background in popovers. What is chosen is remembered per device (inkPrefs.ts).

const prefsKey = 'journal.ink';
function readPrefs(): InkPrefs {
  try { return normalizePrefs(JSON.parse(localStorage.getItem(prefsKey) ?? '{}')); } catch { return normalizePrefs({}); }
}
let prefs = readPrefs();
const listeners = new Set<() => void>();
export const inkPrefs = () => prefs;
export function setInkPrefs(change: Partial<InkPrefs>) {
  prefs = { ...prefs, ...change };
  if (isPen(prefs.tool)) prefs.kind = prefs.tool;
  try { localStorage.setItem(prefsKey, JSON.stringify(prefs)); } catch { /* storage unavailable: keep it for this session */ }
  for (const listener of [...listeners]) listener();
}
export const setPenPrefs = (pen: InkPen, change: Partial<PenPrefs>) => setInkPrefs({ [pen]: { ...prefs[pen], ...change } });
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const useInkPrefs = () => useSyncExternalStore(subscribe, () => prefs, () => prefs);
/** The tool whose width the strip shows (null for the selection). */
const sizedTool = (tool: InkTool): SizedTool | null => tool === 'select' ? null : tool;
const sizeOf = (current: InkPrefs, tool: SizedTool) => tool === 'eraser' ? current.eraser : current[tool].size;
const setSize = (tool: SizedTool, value: number) => tool === 'eraser' ? setInkPrefs({ eraser: clampSize(tool, value) }) : setPenPrefs(tool, { size: clampSize(tool, value) });

/** P pen (again: the next kind), M highlighter, E eraser, S selection (again: rectangle ↔ lasso), [ and ] the width. */
export function inkKey(event: ReactKeyboardEvent<HTMLElement> | KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return false;
  const key = event.key.toLowerCase(), tool = prefs.tool;
  if (key === 'p') { event.preventDefault(); setInkPrefs({ tool: isPen(tool) ? nextPen(tool) : prefs.kind }); return true; }
  if (key === 'm') { event.preventDefault(); setInkPrefs({ tool: 'marker' }); return true; }
  if (key === 'e') { event.preventDefault(); setInkPrefs({ tool: 'eraser' }); return true; }
  if (key === 's') { event.preventDefault(); setInkPrefs(tool === 'select' ? { select: prefs.select === 'rect' ? 'lasso' : 'rect' } : { tool: 'select' }); return true; }
  if (event.key === '[' || event.key === ']') {
    const sized = sizedTool(tool);
    if (!sized) return false;
    event.preventDefault();
    setSize(sized, sizeOf(prefs, sized) * (event.key === ']' ? 1.25 : 1 / 1.25));
    return true;
  }
  return false;
}

export type Glyph = InkTool | 'rect' | 'lasso' | 'blank' | 'lines' | 'grid' | 'dots' | 'more' | 'trash' | 'caret' | 'width';
const glyphs: Record<Glyph, ReactNode> = {
  pen: <path d="M11 2.5 13.5 5 6.5 12l-3.5 1 1-3.5Z M9.5 4l2.5 2.5" />,
  pencil: <path d="M10.8 2.7 13.3 5.2 5.6 12.9 2.5 13.5 3.1 10.4Z M3.1 10.4l2.5 2.5 M9.3 4.2l2.5 2.5" />,
  marker: <path d="M10 2.5 13.5 6 8 11.5H5.5v-2.5Z M5.5 9 3 13.5h4.5l.5-2" />,
  eraser: <path d="M9.5 2.8 13.2 6.5 7.5 12.2H4.8L2.8 10.2Z M6.3 6l3.7 3.7 M5.5 13.5h8" />,
  select: <path d="M2.5 2.5h3M7 2.5h2M10.5 2.5h3v3M13.5 7v2M13.5 10.5v3h-3M9 13.5H7M5.5 13.5h-3v-3M2.5 9V7M2.5 5.5v-3" />,
  rect: <path d="M2.5 2.5h3M7 2.5h2M10.5 2.5h3v3M13.5 7v2M13.5 10.5v3h-3M9 13.5H7M5.5 13.5h-3v-3M2.5 9V7M2.5 5.5v-3" />,
  lasso: <path d="M8 3c3.3 0 5.5 1.5 5.5 3.6S11.3 10 8 10 2.5 8.7 2.5 6.6 4.7 3 8 3Z M4.5 9.5c-.8 1-1 2-.3 2.7.8.8 2 .3 2.2 1.8" strokeDasharray="2 1.6" />,
  blank: <path d="M3.5 2.5h9v11h-9Z" />,
  lines: <path d="M3.5 2.5h9v11h-9Z M5 6h6M5 8.5h6M5 11h6" />,
  grid: <path d="M3.5 2.5h9v11h-9Z M3.5 6.2h9M3.5 9.8h9M6.5 2.5v11M9.5 2.5v11" />,
  dots: <path d="M3.5 2.5h9v11h-9Z M5.9 6h.2M9.9 6h.2M5.9 10h.2M9.9 10h.2" strokeWidth="1.8" />,
  more: <path d="M3.4 8h.2M7.9 8h.2M12.4 8h.2" strokeWidth="2.2" />,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9M7 7v4M9 7v4" />,
  caret: <path d="M4.5 6.5 8 10l3.5-3.5" />,
  width: <path d="M3 4.5h10M3 8h10M3 11.5h10" />,
};
export function ToolGlyph({ name }: { name: Glyph }) {
  return <svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">{glyphs[name]}</svg>;
}
export const toolNames = (): Record<InkTool | 'rect' | 'lasso', string> => ({
  pen: t('Füller'), pencil: t('Bleistift'), marker: t('Textmarker'), eraser: t('Radierer'), select: t('Auswahl'), rect: t('Rechteck-Auswahl'), lasso: t('Lasso-Auswahl'),
});
const paperNames = (): Record<InkPaper['kind'] | 'blank', string> => ({ blank: t('Leer'), lines: t('Linien'), grid: t('Raster'), dots: t('Punkte') });

/** A dropdown of icons (role menu): arrows move, Enter or a click chooses, Escape closes. */
function InkMenu({ anchor, label, items, onClose }: {
  anchor: HTMLElement | null; label: string; onClose: (byKey: boolean) => void;
  items: { key: string; label: string; glyph: Glyph; checked: boolean; run: () => void }[];
}) {
  return <Popover anchor={anchor} className="ink-menu" label={label} onClose={onClose}>
    <div role="menu" aria-label={label} onKeyDown={event => {
      const all = [...event.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')], at = all.indexOf(document.activeElement as HTMLElement);
      const to = ({ ArrowDown: at + 1, ArrowRight: at + 1, ArrowUp: at - 1, ArrowLeft: at - 1, Home: 0, End: all.length - 1 } as Record<string, number>)[event.key];
      if (to === undefined) return;
      event.preventDefault();
      all[(to + all.length) % all.length]?.focus();
    }}>
      {items.map(item => <button key={item.key} type="button" role="menuitemradio" aria-checked={item.checked} aria-label={item.label} title={item.label}
        data-autofocus={item.checked || undefined} className={`ink-menu-item is-${item.key}`} onClick={() => { item.run(); onClose(true); }}>
        <ToolGlyph name={item.glyph} /><span>{item.label}</span></button>)}
    </div>
  </Popover>;
}

/**
 * The colours for a pen: the design's ink, the pen colours (the highlighter has its own), the recent ones and a colour
 * of one's own. `onPick(color, final)`: a swatch is final at once, the own colour while dragging is not (the owner
 * takes the last one on closing).
 */
export function InkPalette({ marker, value, onPick }: { marker: boolean; value: string | null; onPick: (color: string | null, final: boolean) => void }) {
  const current = useInkPrefs();
  const [own, setOwn] = useState(false);
  const swatch = (color: string | null, label: string, key: string) => <button key={key} type="button" className={`ink-swatch${color ? '' : ' is-ink'}`} role="radio"
    aria-checked={value === color} aria-label={label} title={label} style={color ? { '--swatch': color } as CSSProperties : undefined} onClick={() => onPick(color, true)} />;
  const names: Record<string, string> = {
    '#1f1f1f': t('Schwarz'), '#2457c5': t('Blau'), '#c9302c': t('Rot'), '#2e8b57': t('Grün'), '#7b3fb3': t('Violett'), '#7a4b28': t('Braun'), '#7d7d7d': t('Grau'), '#e07b1a': t('Orange'),
    '#ffe14d': t('Gelb'), '#7ee07e': t('Grün'), '#ff7ac8': t('Pink'), '#6cc4ff': t('Blau'), '#ffb347': t('Orange'),
  };
  const palette = marker ? markerColors : penColors;
  const recent = current.recent.filter(color => !palette.includes(color));
  return <div className="ink-palette">
    <div className="ink-swatches" role="radiogroup" aria-label={t('Farbe')}>
      {swatch(null, t('Tinte'), 'ink')}
      {palette.map(color => swatch(color, names[color] ?? color, color))}
    </div>
    {recent.length > 0 && <div className="ink-swatches is-recent" role="radiogroup" aria-label={t('Zuletzt benutzt')}>{recent.map(color => swatch(color, color, `recent-${color}`))}</div>}
    {own ? <ColorPicker value={value ?? (marker ? markerColors[0] : penColors[0])} swatches={palette} onChange={color => onPick(color, false)} />
      : <button type="button" className="ink-own-color" onClick={() => setOwn(true)}>{t('Eigene Farbe …')}</button>}
  </div>;
}
/** A palette in a popover; an own colour still being dragged is taken when the popover closes. */
export function PalettePopover({ anchor, marker, value, onPick, onClose, label }: {
  anchor: HTMLElement | null; marker: boolean; value: string | null; label: string; onPick: (color: string | null, final: boolean) => void; onClose: (byKey: boolean) => void;
}) {
  const pending = useRef<string | null | undefined>(undefined);
  return <Popover anchor={anchor} className="ink-color-popover" label={label} onClose={byKey => {
    if (pending.current !== undefined) { onPick(pending.current, true); pending.current = undefined; }
    onClose(byKey);
  }}>
    <InkPalette marker={marker} value={value} onPick={(color, final) => {
      if (final) { pending.current = undefined; onPick(color, true); onClose(true); }
      else { pending.current = color; onPick(color, false); }
    }} />
  </Popover>;
}
export const rememberColor = (color: string | null) => { if (color) setInkPrefs({ recent: withRecent(prefs.recent, color) }); };

type Patch = (id: string, value: Partial<Card>) => unknown;
type Open = 'pens' | 'selects' | 'color' | 'size' | 'paper' | 'more' | null;

/** The compact strip: [pen ▾] [eraser] [selection ▾] | [colour] [width] | [background]. */
export function InkToolbar({ card, patch }: { card: Card; patch: Patch }) {
  const current = useInkPrefs(), tool = current.tool, names = toolNames();
  const [open, setOpen] = useState<Open>(null);
  const refs = useRef<Partial<Record<Exclude<Open, null>, HTMLButtonElement | null>>>({});
  const anchor = (name: Exclude<Open, null>) => refs.current[name] ?? null;
  const close = (name: Exclude<Open, null>) => (byKey: boolean) => { setOpen(null); if (byKey) anchor(name)?.focus(); };
  const pen = isPen(tool) ? tool : current.kind, sized = sizedTool(tool), paper = inkPaperOf(card.inkPaper);
  const color = isPen(tool) ? current[tool].color : null;
  const keyOpen = (name: Exclude<Open, null>) => (event: ReactKeyboardEvent) => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(name); } };
  const trigger = (name: Exclude<Open, null>, label: string, className: string, children: ReactNode, disabled = false, popup: 'menu' | 'dialog' = 'dialog') =>
    <button ref={element => { refs.current[name] = element; }} type="button" className={className} aria-label={label} title={label} aria-haspopup={popup} aria-expanded={open === name}
      disabled={disabled} onKeyDown={keyOpen(name)} onClick={() => setOpen(value => value === name ? null : name)}>{children}</button>;
  const savePaper = (next: InkPaper | null) => void patch(card.id, { inkPaper: next });
  return <div className="ink-toolbar" role="toolbar" aria-label={t('Handschrift')} onPointerDown={event => event.stopPropagation()}>
    <span className="ink-split">
      <button type="button" className={`ink-tool is-${pen} is-pens`} aria-pressed={isPen(tool)} aria-label={names[pen]} title={`${names[pen]} · P`}
        onClick={() => setInkPrefs({ tool: pen })}><ToolGlyph name={pen} /></button>
      {trigger('pens', t('Stiftart wählen'), 'ink-caret', <ToolGlyph name="caret" />, false, 'menu')}
    </span>
    <button type="button" className="ink-tool is-eraser" aria-pressed={tool === 'eraser'} aria-label={names.eraser} title={`${names.eraser} · E`}
      onClick={() => setInkPrefs({ tool: 'eraser' })}><ToolGlyph name="eraser" /></button>
    <span className="ink-split">
      <button type="button" className={`ink-tool is-select is-${current.select}`} aria-pressed={tool === 'select'} aria-label={names[current.select]} title={`${names[current.select]} · S`}
        onClick={() => setInkPrefs({ tool: 'select' })}><ToolGlyph name={current.select} /></button>
      {trigger('selects', t('Auswahlart wählen'), 'ink-caret', <ToolGlyph name="caret" />, false, 'menu')}
    </span>
    <span className="ink-divider" aria-hidden="true" />
    {trigger('color', `${t('Farbe')}: ${color ?? t('Tinte')}`, `ink-color${color ? '' : ' is-ink'}`, <i style={color ? { '--swatch': color } as CSSProperties : undefined} />, !isPen(tool))}
    <span className="ink-wide">
      {trigger('size', `${t('Strichstärke')} · [ ]`, 'ink-width', <i style={{ '--dot': `${Math.max(2, Math.min(12, sized ? sizeOf(current, sized) * (sized === 'marker' ? .5 : sized === 'eraser' ? .3 : 1.4) : 4))}px` } as CSSProperties} />, !sized)}
      <span className="ink-divider" aria-hidden="true" />
      {trigger('paper', t('Hintergrund'), `ink-paper-button${paper ? ' is-set' : ''}`, <ToolGlyph name={paper?.kind ?? 'blank'} />)}
    </span>
    {trigger('more', t('Mehr'), 'ink-more', <ToolGlyph name="more" />, false, 'menu')}

    {open === 'pens' && <InkMenu anchor={anchor('pens')} label={t('Stiftart')} onClose={close('pens')}
      items={(['pen', 'pencil', 'marker'] as const).map(name => ({ key: name, label: names[name], glyph: name, checked: pen === name, run: () => setInkPrefs({ tool: name }) }))} />}
    {open === 'selects' && <InkMenu anchor={anchor('selects')} label={t('Auswahlart')} onClose={close('selects')}
      items={(['rect', 'lasso'] as const).map(name => ({ key: name, label: names[name], glyph: name, checked: current.select === name, run: () => setInkPrefs({ tool: 'select', select: name }) }))} />}
    {open === 'more' && <InkMenu anchor={anchor('more')} label={t('Mehr')} onClose={close('more')}
      items={[
        ...(sized ? [{ key: 'size', label: t('Strichstärke'), glyph: 'width' as const, checked: false, run: () => setTimeout(() => setOpen('size')) }] : []),
        { key: 'paper', label: t('Hintergrund'), glyph: paper?.kind ?? 'blank', checked: false, run: () => setTimeout(() => setOpen('paper')) },
      ]} />}
    {open === 'color' && isPen(tool) && <PalettePopover anchor={anchor('color')} marker={tool === 'marker'} value={color} label={`${names[tool]}: ${t('Farbe')}`} onClose={close('color')}
      onPick={(next, final) => { setPenPrefs(tool, { color: next }); if (final) rememberColor(next); }} />}
    {open === 'size' && sized && <Popover anchor={anchor('size')?.offsetParent ? anchor('size') : anchor('more')} className="ink-size-popover" label={`${names[sized]}: ${t('Strichstärke')}`} onClose={close('size')}>
      <div className="ink-sizes" role="group" aria-label={t('Strichstärke')}>
        {sizePresets[sized].map((preset, index) => <button key={preset} type="button" className="ink-size" aria-pressed={sizeOf(current, sized) === preset} aria-label={`${t('Strichstärke')} ${index + 1}`}
          data-autofocus={sizeOf(current, sized) === preset || undefined} onClick={() => setSize(sized, preset)}><i style={{ '--dot': `${3 + index * 3}px` } as CSSProperties} /></button>)}
        <input type="range" className="ink-range" aria-label={t('Strichstärke')} title={`${t('Strichstärke')} · [ ]`} min={sizeRanges[sized][0]} max={sizeRanges[sized][1]} step={.25} value={sizeOf(current, sized)}
          onChange={event => setSize(sized, Number(event.target.value))} />
        <output>{sizeOf(current, sized)}</output>
      </div>
    </Popover>}
    {open === 'paper' && <Popover anchor={anchor('paper')?.offsetParent ? anchor('paper') : anchor('more')} className="ink-paper-popover" label={t('Hintergrund')} onClose={close('paper')}>
      <div className="ink-paper-kinds" role="radiogroup" aria-label={t('Hintergrund')}>
        {(['blank', 'lines', 'grid', 'dots'] as const).map(kind => <button key={kind} type="button" role="radio" className={`ink-paper-kind is-${kind}`} aria-label={paperNames()[kind]} title={paperNames()[kind]}
          aria-checked={(paper?.kind ?? 'blank') === kind} data-autofocus={(paper?.kind ?? 'blank') === kind || undefined}
          onClick={() => savePaper(kind === 'blank' ? null : { kind, step: paper?.step ?? 24 })}><ToolGlyph name={kind} /></button>)}
      </div>
      <div className="ink-paper-step" role="group" aria-label={t('Abstand')}>
        <span>{t('Abstand')}</span>
        <button type="button" className="ink-step-down" aria-label={t('Abstand kleiner')} disabled={!paper || paper.step <= paperSteps[0]} onClick={() => paper && savePaper({ ...paper, step: nextPaperStep(paper.step, -1) })}>−</button>
        <output>{paper ? `${paper.step} px` : '–'}</output>
        <button type="button" className="ink-step-up" aria-label={t('Abstand größer')} disabled={!paper || paper.step >= paperSteps[paperSteps.length - 1]} onClick={() => paper && savePaper({ ...paper, step: nextPaperStep(paper.step, 1) })}>+</button>
      </div>
    </Popover>}
  </div>;
}
