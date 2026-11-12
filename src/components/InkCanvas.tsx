import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from 'react';
import { getStroke } from 'perfect-freehand';
import { boxOf, canvasPoint, cutByLasso, decodePoints, deleteStrokes, encodePoints, eraseStrokes, inkBottom, inkOf, inkPaperOf, outlinePath, penOf, restyleStrokes, selectInRect, selectionBox, strokeColor, strokeOptions, transformStrokes } from '../ink';
import type { Box, Ink, InkPoint, InkStroke } from '../ink';
import { isPen } from '../inkPrefs';
import type { Card } from '../notebook';
import { loadSettings } from '../settings';
import { t } from '../i18n';
import { InkToolbar, PalettePopover, ToolGlyph, inkKey, inkPrefs, rememberColor, setInkPrefs, useInkPrefs } from './InkToolbar';

export { inkKey, setInkPrefs, useInkPrefs } from './InkToolbar';

// A note as a drawing surface: fountain pen, pencil and highlighter (pressure from the pen, simulated for a mouse), a
// partial eraser and a selection (rectangle or lasso) that moves, scales, recolours, thickens or deletes strokes.
// The running stroke bypasses React and is written straight into its path once per frame, from every raw pointer sample,
// so the ink lies under the pen. A finished stroke, an erasing gesture or a change of the selection is saved as one
// change of the card, which makes it one step in the undo history. Touch is left to the board (it pans and moves cards).

const paths = new WeakMap<InkStroke, string>();
function strokePath(stroke: InkStroke) {
  let d = paths.get(stroke);
  if (d === undefined) { d = outlinePath(getStroke(decodePoints(stroke.points), strokeOptions(stroke))); paths.set(stroke, d); }
  return d;
}
const sameStrokes = (a: InkStroke[], b: InkStroke[]) => a === b || (a.length === b.length && a.every((stroke, i) => stroke === b[i]));

/** Switches a note between text and drawing; the other stays saved. */
export function NoteModeButton({ card, patch, className = '' }: { card: Card; patch: (id: string, value: Partial<Card>) => unknown; className?: string }) {
  const ink = card.mode === 'ink', label = ink ? t('Als Text schreiben') : t('Handschriftlich schreiben');
  return <button type="button" className={`note-mode ${className}`} aria-pressed={ink} aria-label={label} title={label}
    onClick={() => void patch(card.id, { mode: ink ? 'text' : 'ink' })}>
    {ink ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 4h9M8 4v9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      : <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 12.5c1.5-3 3-5.5 4.2-5.5 1.6 0-.9 5 .9 5 1.3 0 2.2-2.6 3.4-2.6.9 0 .6 1.6 2.5 1.4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>}
  </button>;
}

function usePixelLook(): boolean {
  const read = () => typeof document !== 'undefined' && document.documentElement.dataset.pixel !== undefined;
  const [pixel, setPixel] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setPixel(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-pixel'] });
    return () => observer.disconnect();
  }, []);
  return pixel;
}

type Patch = (id: string, value: Partial<Card>) => unknown;
type Vec = { x: number; y: number };
/**
 * The strokes selected: `strokes` is what is shown, `base` the saved drawing it was made on. They differ while a lasso's
 * cut is pending: the cut is saved only together with the first action on the selection.
 */
type Selection = { base: InkStroke[]; strokes: InkStroke[]; ids: number[] };
type Preview = { dx: number; dy: number; scale: number; origin: Vec };
type Corner = 'nw' | 'ne' | 'sw' | 'se';
const rawUpdates = typeof window !== 'undefined' && 'onpointerrawupdate' in window;
const corners = (box: Box): Record<Corner, Vec> => ({ nw: { x: box.left, y: box.top }, ne: { x: box.right, y: box.top }, sw: { x: box.left, y: box.bottom }, se: { x: box.right, y: box.bottom } });
const opposite: Record<Corner, Corner> = { nw: 'se', ne: 'sw', sw: 'ne', se: 'nw' };
const previewed = (box: Box, preview: Preview | null): Box => {
  if (!preview) return box;
  const { dx, dy, scale, origin } = preview, map = (x: number, y: number) => ({ x: origin.x + (x - origin.x) * scale + dx, y: origin.y + (y - origin.y) * scale + dy });
  return boxOf(map(box.left, box.top), map(box.right, box.bottom));
};
const transformOf = (preview: Preview | null) => preview ? `translate(${preview.origin.x + preview.dx} ${preview.origin.y + preview.dy}) scale(${preview.scale}) translate(${-preview.origin.x} ${-preview.origin.y})` : undefined;
const pad = 4;

export function InkCanvas({ card, patch, label }: { card: Card; patch: Patch; label?: string }) {
  const ink = useMemo(() => inkOf(card.ink), [card.ink]);
  const paper = inkPaperOf(card.inkPaper);
  const current = useInkPrefs();
  const pixel = usePixelLook();
  const id = `${card.id}-${useId()}`.replace(/[^\w-]/g, '');
  const [draft, setDraft] = useState<InkStroke[] | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [colors, setColors] = useState(false);
  const surface = useRef<HTMLDivElement>(null), live = useRef<SVGPathElement>(null), cursor = useRef<HTMLDivElement>(null), marquee = useRef<SVGPathElement>(null), colorButton = useRef<HTMLButtonElement>(null);
  /** Saves an action on the selection (with a pending lasso cut, as one step) and keeps the selection on the result. */
  const commit = (make: (strokes: InkStroke[], ids: number[]) => { strokes: InkStroke[]; ids: number[] }) => {
    const chosen = state.current.selection;
    if (!chosen) return;
    const result = make(chosen.strokes, chosen.ids);
    setDraft(null);
    if (result.strokes === chosen.base) return;
    void state.current.patch(state.current.card.id, { ink: { v: 1, strokes: result.strokes } });
    setSelection(result.ids.length ? { base: result.strokes, strokes: result.strokes, ids: result.ids } : null);
  };
  const state = useRef({ ink, card, patch, drawing: false, selection, commit }); state.current = { ...state.current, ink, card, patch, selection, commit };
  const bottom = useMemo(() => inkBottom(ink), [ink]);
  // The finished stroke stays in the live path until the saved one is drawn, so nothing flickers in between.
  useLayoutEffect(() => { if (!state.current.drawing) live.current?.setAttribute('d', ''); }, [ink]);
  // A selection belongs to the drawing it was made on: a change from elsewhere (undo, another window) ends it.
  useLayoutEffect(() => { setSelection(chosen => chosen && !sameStrokes(chosen.base, ink.strokes) ? null : chosen); }, [ink]);
  // Taking a pen or the eraser ends the selection.
  useEffect(() => { if (current.tool !== 'select') { setSelection(null); setPreview(null); setColors(false); } }, [current.tool]);

  useEffect(() => {
    const element = surface.current; if (!element) return;
    const zoomOf = () => { const width = element.offsetWidth, rect = element.getBoundingClientRect(); return width > 0 && rect.width > 0 ? rect.width / width : 1; };
    const hitSelection = (p: Vec): { corner: Corner | null; inside: boolean } | null => {
      const chosen = state.current.selection, box = chosen && selectionBox(chosen.strokes, chosen.ids);
      if (!box) return null;
      const grip = 8 / zoomOf(), framed = { left: box.left - pad, top: box.top - pad, right: box.right + pad, bottom: box.bottom + pad };
      const corner = (Object.entries(corners(framed)) as [Corner, Vec][]).find(([, at]) => Math.abs(at.x - p.x) <= grip && Math.abs(at.y - p.y) <= grip)?.[0] ?? null;
      return { corner, inside: p.x >= framed.left && p.x <= framed.right && p.y >= framed.top && p.y <= framed.bottom };
    };
    const showCursor = (e: PointerEvent) => {
      const ring = cursor.current; if (!ring) return;
      const prefs = inkPrefs(), at = canvasPoint({ x: e.clientX, y: e.clientY }, element.getBoundingClientRect(), element.offsetWidth);
      if (prefs.tool === 'select') {
        const hit = hitSelection(at);
        element.style.cursor = hit?.corner ? (hit.corner === 'nw' || hit.corner === 'se' ? 'nwse-resize' : 'nesw-resize') : hit?.inside ? 'move' : '';
      } else element.style.cursor = '';
      const eraser = prefs.tool === 'eraser' || (e.pointerType === 'pen' && (e.buttons & 32) !== 0);
      if (!eraser || e.pointerType === 'touch') { ring.hidden = true; return; }
      ring.hidden = false; ring.style.setProperty('--size', `${prefs.eraser}px`); ring.style.transform = `translate(${at.x}px, ${at.y}px)`;
    };
    const hover = (e: PointerEvent) => { if (!state.current.drawing) showCursor(e); };
    const leave = () => { if (!state.current.drawing && cursor.current) cursor.current.hidden = true; };
    const down = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || state.current.drawing) return;
      if ((e.target as Element | null)?.closest?.('.ink-selection-bar')) return;
      const penEraser = e.pointerType === 'pen' && (e.button === 5 || (e.buttons & 32) !== 0);
      if (e.button !== 0 && !penEraser) return;
      e.preventDefault(); e.stopPropagation();
      element.focus({ preventScroll: true });
      try { element.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      const rect = element.getBoundingClientRect(), width = element.offsetWidth;
      const at = (sample: PointerEvent) => canvasPoint({ x: sample.clientX, y: sample.clientY }, rect, width);
      const samples = (sample: PointerEvent) => { const list = sample.getCoalescedEvents?.() ?? []; return list.length ? list : [sample]; };
      const prefs = inkPrefs(), eraser = prefs.tool === 'eraser' || penEraser;
      const mouse = e.pointerType !== 'pen';
      let frame = 0;
      state.current.drawing = true;
      const stop = () => {
        cancelAnimationFrame(frame);
        element.removeEventListener(moveEvent, move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end); element.removeEventListener('lostpointercapture', end);
        state.current.drawing = false;
      };
      const moveEvent = (rawUpdates ? 'pointerrawupdate' : 'pointermove') as 'pointermove';
      let move: (sample: PointerEvent) => void, end: (sample: PointerEvent) => void;
      if (prefs.tool === 'select' && !eraser) {
        const start = at(e), hit = e.shiftKey ? null : hitSelection(start), chosen = state.current.selection;
        const box = chosen && selectionBox(chosen.strokes, chosen.ids);
        if (box && hit && (hit.corner || hit.inside)) {
          // Moving (inside the frame) or scaling about the opposite corner (at a corner), shown live by a transform.
          const framed = corners({ left: box.left - pad, top: box.top - pad, right: box.right + pad, bottom: box.bottom + pad });
          const grabbed = hit.corner ? framed[hit.corner] : null, origin = hit.corner ? framed[opposite[hit.corner]] : start;
          let next: Preview = { dx: 0, dy: 0, scale: 1, origin };
          move = sample => {
            if (sample.pointerId !== e.pointerId) return;
            const p = at(sample);
            if (grabbed) {
              const ax = grabbed.x - origin.x, ay = grabbed.y - origin.y, length = ax * ax + ay * ay;
              next = { dx: 0, dy: 0, origin, scale: length ? Math.max(.05, ((p.x - origin.x) * ax + (p.y - origin.y) * ay) / length) : 1 };
            } else next = { dx: p.x - start.x, dy: p.y - start.y, scale: 1, origin };
            if (!frame) frame = requestAnimationFrame(() => { frame = 0; setPreview(next); });
          };
          end = sample => {
            if (sample.pointerId !== e.pointerId) return;
            stop(); setPreview(null);
            if (sample.type !== 'pointerup' || (Math.abs(next.dx) < .25 && Math.abs(next.dy) < .25 && Math.abs(next.scale - 1) < .005)) return;
            state.current.commit((strokes, ids) => ({ strokes: transformStrokes(strokes, ids, next), ids }));
          };
        } else {
          // A new selection (Shift: added to the one there is): a rectangle, or a lasso that is closed on letting go.
          const lasso = prefs.select === 'lasso', points: Vec[] = [start];
          const show = () => {
            frame = 0;
            const last = points[points.length - 1], path = marquee.current;
            if (!path) return;
            path.setAttribute('d', lasso ? `M${points.map(p => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L')}` : `M${start.x} ${start.y}H${last.x}V${last.y}H${start.x}Z`);
          };
          show();
          move = sample => {
            if (sample.pointerId !== e.pointerId) return;
            if (lasso) for (const each of samples(sample)) points.push(at(each)); else points[1] = at(sample);
            if (!frame) frame = requestAnimationFrame(show);
          };
          end = sample => {
            if (sample.pointerId !== e.pointerId) return;
            stop(); marquee.current?.setAttribute('d', '');
            if (sample.type !== 'pointerup') return;
            const extent = boxOf({ x: Math.min(...points.map(p => p.x)), y: Math.min(...points.map(p => p.y)) }, { x: Math.max(...points.map(p => p.x)), y: Math.max(...points.map(p => p.y)) });
            const adding = e.shiftKey ? state.current.selection : null;
            if (extent.right - extent.left < 3 && extent.bottom - extent.top < 3) { if (!adding) setSelection(null); return; }
            const base = adding?.base ?? state.current.ink.strokes, on = adding?.strokes ?? base;
            if (!lasso) {
              const ids = [...new Set([...(adding?.ids ?? []), ...selectInRect(on, extent)])].sort((a, b) => a - b);
              setSelection(ids.length ? { base, strokes: on, ids } : null);
            } else {
              const cut = cutByLasso(on, points), before = new Set(adding?.ids ?? []);
              const ids = [...new Set([...cut.selected, ...cut.origin.flatMap((from, i) => before.has(from) ? [i] : [])])].sort((a, b) => a - b);
              setSelection(ids.length ? { base, strokes: cut.strokes, ids } : null);
            }
          };
        }
      } else if (!eraser) {
        const kind = isPen(prefs.tool) ? prefs.tool : prefs.kind, pen = prefs[kind];
        const pressure = kind !== 'marker' && loadSettings().inkPressure;
        const stroke = { size: pen.size, pressure, ...(mouse && kind !== 'marker' ? { mouse: true } : {}), ...(kind !== 'pen' ? { tool: kind } : {}), ...(pen.color ? { color: pen.color } : {}) };
        const points: InkPoint[] = [];
        const add = (sample: PointerEvent) => {
          const p = at(sample), last = points[points.length - 1];
          const force = mouse ? .5 : sample.pressure > 0 ? sample.pressure : last?.[2] ?? .35;
          if (last && last[0] === p.x && last[1] === p.y) { last[2] = force; return; }
          points.push([p.x, p.y, force]);
        };
        const draw = () => { frame = 0; live.current?.setAttribute('d', outlinePath(getStroke(points, strokeOptions(stroke, false)))); };
        add(e); draw();
        move = sample => {
          if (sample.pointerId !== e.pointerId) return;
          for (const each of samples(sample)) add(each);
          if (!frame) frame = requestAnimationFrame(draw);
        };
        end = sample => {
          if (sample.pointerId !== e.pointerId) return;
          stop();
          if (sample.type !== 'pointerup') { live.current?.setAttribute('d', ''); return; }
          live.current?.setAttribute('d', outlinePath(getStroke(points, strokeOptions(stroke))));
          const { ink, card, patch } = state.current;
          const next: Ink = { v: 1, strokes: [...ink.strokes, { ...stroke, points: encodePoints(points) }] };
          void patch(card.id, { ink: next });
        };
      } else {
        const radius = prefs.eraser / 2;
        let strokes = state.current.ink.strokes, changed = false, last = at(e), pending: Vec[] = [last];
        const apply = () => {
          frame = 0;
          const result = eraseStrokes(strokes, [last, ...pending], radius);
          last = pending[pending.length - 1] ?? last; pending = [];
          if (result.changed) { strokes = result.strokes; changed = true; setDraft(strokes); }
        };
        apply();
        move = sample => {
          if (sample.pointerId !== e.pointerId) return;
          showCursor(sample);
          for (const each of samples(sample)) pending.push(at(each));
          if (!frame) frame = requestAnimationFrame(apply);
        };
        end = sample => {
          if (sample.pointerId !== e.pointerId) return;
          if (pending.length) apply();
          stop();
          if (sample.type === 'pointerup' && changed) { const { card, patch } = state.current; void patch(card.id, { ink: { v: 1, strokes } }); }
          setDraft(null);
        };
      }
      element.addEventListener(moveEvent, move); element.addEventListener('pointerup', end); element.addEventListener('pointercancel', end); element.addEventListener('lostpointercapture', end);
    };
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', hover); element.addEventListener('pointerleave', leave);
    return () => { element.removeEventListener('pointerdown', down); element.removeEventListener('pointermove', hover); element.removeEventListener('pointerleave', leave); };
  }, []);

  /** Delete/Backspace, arrows (Shift: further), Escape and Ctrl+A on the selection; else the tool keys. */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'a') {
      event.preventDefault(); event.stopPropagation();
      const strokes = ink.strokes;
      setInkPrefs({ tool: 'select' });
      setSelection(strokes.length ? { base: strokes, strokes, ids: strokes.map((_, i) => i) } : null);
      return;
    }
    if (selection && !event.ctrlKey && !event.metaKey && !event.altKey) {
      const step = event.shiftKey ? 10 : 1;
      const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); event.stopPropagation(); commit((strokes, ids) => ({ strokes: deleteStrokes(strokes, ids), ids: [] })); return; }
      if (moves[event.key]) { event.preventDefault(); event.stopPropagation(); const [dx, dy] = moves[event.key]; commit((strokes, ids) => ({ strokes: transformStrokes(strokes, ids, { dx, dy }), ids })); return; }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setSelection(null); return; }
    }
    if (inkKey(event)) event.stopPropagation();
  };

  const shown = draft ?? selection?.strokes ?? ink.strokes;
  const chosen = useMemo(() => new Set(selection?.ids ?? []), [selection]);
  const box = useMemo(() => selection && selectionBox(selection.strokes, selection.ids), [selection]);
  const frame = box && previewed({ left: box.left - pad, top: box.top - pad, right: box.right + pad, bottom: box.bottom + pad }, preview);
  const transform = transformOf(preview);
  const pencil = `url(#ink-pencil-${id})`;
  const strokePathOf = (stroke: InkStroke, index: number) => <path key={index} d={strokePath(stroke)} fill={strokeColor(stroke)} data-index={index}
    className={`is-${penOf(stroke)}${chosen.has(index) ? ' is-selected' : ''}`} filter={penOf(stroke) === 'pencil' ? pencil : undefined} transform={chosen.has(index) ? transform : undefined} />;
  const indices = shown.map((_, index) => index);
  const liveKind = isPen(current.tool) ? current.tool : current.kind, liveColor = current[liveKind].color ?? 'currentColor';
  const livePath = <path ref={live} className={`ink-live is-${liveKind}`} fill={liveColor} filter={liveKind === 'pencil' ? pencil : undefined} d="" />;
  const first = selection ? selection.strokes[selection.ids[0]] : undefined;
  const allMarkers = !!selection && selection.ids.every(index => penOf(selection.strokes[index]) === 'marker');
  // The bar sits above the frame, below it when there is no room above.
  const barTop = frame ? (frame.top >= 34 ? frame.top - 32 : frame.bottom + 6) : 0;
  return <div className="ink-note">
    <InkToolbar card={card} patch={patch} />
    <div ref={surface} className={`ink-canvas is-${current.tool}${current.tool === 'select' ? ` is-${current.select}` : ''}`} tabIndex={0} role="img"
      aria-label={label ? `${t('Handschrift')}: ${label}` : t('Handschrift')} data-strokes={shown.length} data-selected={selection?.ids.length ?? 0}
      style={{ '--ink-min': `${Math.max(140, Math.ceil(bottom) + 24)}px` } as CSSProperties} onKeyDown={onKeyDown}>
      <svg className="ink-strokes" aria-hidden="true">
        <defs>
          {pixel
            ? <filter id={`ink-pencil-${id}`} x="0" y="0" width="1" height="1" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency=".32" numOctaves="1" seed="7" result="noise" />
              <feComponentTransfer in="noise" result="grain"><feFuncA type="discrete" tableValues=".35 .75 1 1" /></feComponentTransfer>
              <feComposite in="SourceGraphic" in2="grain" operator="in" />
            </filter>
            : <filter id={`ink-pencil-${id}`} x="0" y="0" width="1" height="1" primitiveUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
              <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" result="noise" />
              <feColorMatrix in="noise" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  2.6 0 0 0 -.45" result="grain" />
              <feComposite in="SourceGraphic" in2="grain" operator="in" />
            </filter>}
          {paper && <pattern id={`ink-paper-${id}`} className={`ink-paper-pattern is-${paper.kind}`} x="0" y="0" width={paper.step} height={paper.step} patternUnits="userSpaceOnUse">
            {paper.kind === 'lines' ? <path d={`M0 ${paper.step - .5}H${paper.step}`} />
              : paper.kind === 'grid' ? <path d={`M0 .5H${paper.step}M.5 0V${paper.step}`} />
              : <rect x={paper.step / 2 - .75} y={paper.step / 2 - .75} width="1.5" height="1.5" />}
          </pattern>}
        </defs>
        {paper && <rect className={`ink-paper is-${paper.kind}`} data-step={paper.step} width="100%" height="100%" fill={`url(#ink-paper-${id})`} />}
        {chosen.size > 0 && <g className="ink-glow" transform={transform}>{selection!.ids.map(index => shown[index] && <path key={index} d={strokePath(shown[index])} />)}</g>}
        <g className="ink-markers">{indices.filter(index => penOf(shown[index]) === 'marker').map(index => strokePathOf(shown[index], index))}{liveKind === 'marker' && livePath}</g>
        <g className="ink-inks">{indices.filter(index => penOf(shown[index]) !== 'marker').map(index => strokePathOf(shown[index], index))}{liveKind !== 'marker' && livePath}</g>
        {frame && <g className="ink-frame">
          <rect x={frame.left} y={frame.top} width={frame.right - frame.left} height={frame.bottom - frame.top} />
          {Object.entries(corners(frame)).map(([name, at]) => <rect key={name} className={`ink-grip is-${name}`} x={at.x - 3.5} y={at.y - 3.5} width="7" height="7" />)}
        </g>}
        <path ref={marquee} className={`ink-marquee is-${current.select}`} d="" />
      </svg>
      {frame && !preview && <div className="ink-selection-bar" role="toolbar" aria-label={t('Auswahl')} style={{ left: Math.max(0, frame.left), top: barTop }}
        onPointerDown={event => event.stopPropagation()}>
        <button ref={colorButton} type="button" className={`ink-color${first?.color ? '' : ' is-ink'}`} aria-label={`${t('Farbe')}: ${first?.color ?? t('Tinte')}`} title={t('Farbe')}
          aria-haspopup="dialog" aria-expanded={colors} onClick={() => setColors(open => !open)}><i style={first?.color ? { '--swatch': first.color } as CSSProperties : undefined} /></button>
        <button type="button" className="ink-thinner" aria-label={t('Dünner')} title={t('Dünner')} onClick={() => commit((strokes, ids) => ({ strokes: restyleStrokes(strokes, ids, { size: size => size * .8 }), ids }))}>−</button>
        <button type="button" className="ink-thicker" aria-label={t('Dicker')} title={t('Dicker')} onClick={() => commit((strokes, ids) => ({ strokes: restyleStrokes(strokes, ids, { size: size => size * 1.25 }), ids }))}>+</button>
        <button type="button" className="ink-delete" aria-label={t('Auswahl löschen')} title={`${t('Auswahl löschen')} · Entf`} onClick={() => { commit((strokes, ids) => ({ strokes: deleteStrokes(strokes, ids), ids: [] })); surface.current?.focus({ preventScroll: true }); }}><ToolGlyph name="trash" /></button>
      </div>}
      {colors && selection && <PalettePopover anchor={colorButton.current} marker={allMarkers} value={first?.color ?? null} label={`${t('Auswahl')}: ${t('Farbe')}`}
        onClose={byKey => { setColors(false); setDraft(null); if (byKey) colorButton.current?.focus(); }}
        onPick={(color, final) => {
          if (!final) { setDraft(restyleStrokes(selection.strokes, selection.ids, { color })); return; }
          rememberColor(color);
          commit((strokes, ids) => ({ strokes: restyleStrokes(strokes, ids, { color }), ids }));
        }} />}
      <div ref={cursor} className="ink-cursor" hidden aria-hidden="true" />
    </div>
  </div>;
}
