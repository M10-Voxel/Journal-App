import { t, useLanguage } from '../i18n';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { isHexColor } from '../colors';
import { clamp, hexOf, hsvaOf, rgbOf } from '../colorSpace';
import type { Hsva } from '../colorSpace';
import { Icon } from './Icon';
import { Popover } from './Popover';

// Our own colour picker instead of the system's: a field for saturation and brightness, a hue bar, optionally opacity,
// the hex value and a row of suggestions. In the pixel theme the field and bars are drawn as coarse pixels (and the
// thumbs are squares); the colours themselves stay exact.

/** Whether the pixel theme is on (it can change while a picker is open, from another window). */
function usePixelTheme(): boolean {
  const read = () => document.documentElement.dataset.theme === 'pixel';
  const [pixel, setPixel] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setPixel(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);
  return pixel;
}
/** Paints a small image that CSS stretches: smooth in the classic theme, in visible cells in the pixel theme. */
function usePaint(ref: RefObject<HTMLCanvasElement | null>, width: number, height: number, color: (x: number, y: number) => [number, number, number, number], deps: unknown[]) {
  useLayoutEffect(() => {
    const canvas = ref.current, context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    canvas.width = width; canvas.height = height;
    const image = context.createImageData(width, height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const [r, g, b, a] = color(width > 1 ? x / (width - 1) : 0, height > 1 ? y / (height - 1) : 0);
      image.data.set([r * 255, g * 255, b * 255, a * 255], (y * width + x) * 4);
    }
    context.putImageData(image, 0, 0);
  }, [width, height, ...deps]);
}

/** Dragging (or clicking) in an area gives a position from 0 to 1 on both axes. */
function drag(event: ReactPointerEvent<HTMLElement>, onMove: (x: number, y: number) => void) {
  if (event.button !== 0) return;
  const element = event.currentTarget;
  const at = (clientX: number, clientY: number) => { const rect = element.getBoundingClientRect(); onMove(clamp((clientX - rect.left) / rect.width), clamp((clientY - rect.top) / rect.height)); };
  element.setPointerCapture(event.pointerId);
  element.focus({ preventScroll: true });
  at(event.clientX, event.clientY);
  const move = (next: PointerEvent) => at(next.clientX, next.clientY);
  const end = () => { element.removeEventListener('pointermove', move); element.removeEventListener('pointerup', end); element.removeEventListener('pointercancel', end); };
  element.addEventListener('pointermove', move);
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', end);
}
/** Arrow keys step by 1 % (with Shift by 10 %); Home and End jump to the ends. */
function stepKey(event: KeyboardEvent, horizontal: (step: number) => void, vertical?: (step: number) => void) {
  const size = event.shiftKey ? .1 : .01;
  const steps: Record<string, [number, boolean]> = { ArrowLeft: [-size, true], ArrowRight: [size, true], ArrowUp: [size, false], ArrowDown: [-size, false], Home: [-1, true], End: [1, true], PageUp: [.1, !vertical], PageDown: [-.1, !vertical] };
  const step = steps[event.key];
  if (!step) return;
  event.preventDefault();
  event.stopPropagation();
  if (step[1] || !vertical) horizontal(step[0]); else vertical(step[0]);
}

export function ColorPicker({ value, onChange, alpha = false, swatches = [] }: {
  value: string; onChange: (value: string) => void; alpha?: boolean; swatches?: readonly string[];
}) {
  useLanguage();
  const pixel = usePixelTheme();
  const [color, setColor] = useState(() => hsvaOf(value));
  const [draft, setDraft] = useState(value);
  const original = useRef(value);
  // A value set from outside (the hex field elsewhere, a reset) moves the picker; its own changes keep the hue.
  const emitted = useRef(value);
  useEffect(() => { if (value !== emitted.current) { emitted.current = value; setColor(current => hsvaOf(value, current.h)); setDraft(value); } }, [value]);
  const change = (next: Hsva) => {
    setColor(next);
    const hex = hexOf(next, alpha);
    emitted.current = hex;
    setDraft(hex);
    if (hex !== value) onChange(hex);
  };
  const hex = hexOf(color, alpha);
  const opaque = hexOf({ ...color, a: 1 }, false);
  const field = useRef<HTMLCanvasElement>(null), hues = useRef<HTMLCanvasElement>(null), alphas = useRef<HTMLCanvasElement>(null);
  const cells = pixel ? { field: [18, 12], bar: 24 } : { field: [96, 64], bar: 180 };
  usePaint(field, cells.field[0], cells.field[1], (x, y) => [...rgbOf({ h: color.h, s: x, v: 1 - y, a: 1 }), 1], [color.h]);
  usePaint(hues, cells.bar, 1, x => [...rgbOf({ h: x * 360, s: 1, v: 1, a: 1 }), 1], []);
  usePaint(alphas, cells.bar, 1, x => [...rgbOf(color), x], [color.h, color.s, color.v]);
  const eyeDropper = (window as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
  const percent = (value: number) => `${Math.round(value * 100)} %`;
  const invalid = !isHexColor(draft) || (!alpha && draft.length === 9);

  return <div className={`color-picker${pixel ? ' is-pixel' : ''}`} style={{ '--picked': hex, '--picked-opaque': opaque, '--hue': `hsl(${color.h} 100% 50%)` } as CSSProperties}>
    <div className="color-picker-field" role="slider" tabIndex={0} data-autofocus aria-label={t('Sättigung und Helligkeit')}
      aria-valuetext={t('Sättigung {0}, Helligkeit {1}', percent(color.s), percent(color.v))} aria-valuenow={Math.round(color.s * 100)}
      onPointerDown={event => drag(event, (x, y) => change({ ...color, s: x, v: 1 - y }))}
      onKeyDown={event => stepKey(event, step => change({ ...color, s: clamp(color.s + step) }), step => change({ ...color, v: clamp(color.v + step) }))}>
      <canvas ref={field} aria-hidden="true" />
      <span className="color-picker-thumb" style={{ left: `${color.s * 100}%`, top: `${(1 - color.v) * 100}%` }} />
    </div>
    <div className="color-picker-bars">
      <div className="color-picker-bar is-hue" role="slider" tabIndex={0} aria-label={t('Farbton')} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(color.h)}
        onPointerDown={event => drag(event, x => change({ ...color, h: Math.min(359.9, x * 360) }))}
        onKeyDown={event => stepKey(event, step => change({ ...color, h: clamp(color.h + step * 360, 0, 359.9) }))}>
        <canvas ref={hues} aria-hidden="true" />
        <span className="color-picker-thumb" style={{ left: `${color.h / 360 * 100}%` }} />
      </div>
      {alpha && <div className="color-picker-bar is-alpha" role="slider" tabIndex={0} aria-label={t('Deckkraft')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(color.a * 100)}
        onPointerDown={event => drag(event, x => change({ ...color, a: x }))}
        onKeyDown={event => stepKey(event, step => change({ ...color, a: clamp(color.a + step) }))}>
        <canvas ref={alphas} aria-hidden="true" />
        <span className="color-picker-thumb" style={{ left: `${color.a * 100}%` }} />
      </div>}
    </div>
    <div className="color-picker-values">
      {/* Before and after: the colour it had when opened, a click takes it back. */}
      <button type="button" className="color-picker-compare" aria-label={t('Ursprüngliche Farbe {0} wiederherstellen', original.current)} data-tip={t('Vorher · zurück')}
        style={{ '--before': original.current } as CSSProperties} onClick={() => change(hsvaOf(original.current, color.h))}><i /><b /></button>
      <input className="color-picker-hex" value={draft} spellCheck={false} autoComplete="off" maxLength={alpha ? 9 : 7} aria-label={t('Hexwert')} aria-invalid={invalid || undefined}
        onChange={event => { const next = event.target.value.trim(); setDraft(next); if (isHexColor(next) && (alpha || next.length === 7)) change(hsvaOf(next.toLowerCase(), color.h)); }}
        onBlur={() => setDraft(hex)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); setDraft(hex); } }} />
      {alpha && <span className="color-picker-alpha">{percent(color.a)}</span>}
      {eyeDropper && <button type="button" className="color-picker-dropper" aria-label={t('Farbe vom Bildschirm aufnehmen')} data-tip={t('Pipette')}
        onClick={() => { void new eyeDropper().open().then(result => change({ ...hsvaOf(result.sRGBHex.toLowerCase(), color.h), a: color.a })).catch(() => {}); }}><Icon name="pipette" /></button>}
    </div>
    {swatches.length > 0 && <div className="color-picker-swatches" role="group" aria-label={t('Vorschläge')}>
      {swatches.map(swatch => <button key={swatch} type="button" style={{ '--swatch': swatch } as CSSProperties} aria-label={swatch} aria-pressed={opaque === swatch.slice(0, 7)}
        onClick={() => change({ ...hsvaOf(swatch, color.h), a: swatch.length === 9 ? hsvaOf(swatch).a : color.a })} />)}
    </div>}
  </div>;
}

/** A colour well that opens the picker next to it. */
export function ColorButton({ value, onChange, label, alpha = false, swatches, className = '' }: {
  value: string; onChange: (value: string) => void; label: string; alpha?: boolean; swatches?: readonly string[]; className?: string;
}) {
  useLanguage();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={button} type="button" className={`color-well ${className}`} style={{ '--swatch': value } as CSSProperties} aria-label={t('{0}: Farbe wählen', label)} aria-haspopup="dialog" aria-expanded={open}
      data-tip={value} onClick={() => setOpen(current => !current)}><span /></button>
    {open && <Popover anchor={button.current} className="color-picker-popover" label={t('{0}: Farbe wählen', label)} onClose={byKey => { setOpen(false); if (byKey) button.current?.focus(); }}>
      <ColorPicker value={value} onChange={onChange} alpha={alpha} swatches={swatches} />
    </Popover>}
  </>;
}
