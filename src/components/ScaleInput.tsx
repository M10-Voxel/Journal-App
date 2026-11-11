import { useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { t, useLanguage } from '../i18n';
import { clampToScale, positionOf, scaleCells, valueAt } from '../periodData';

/**
 * A day's value (the daily rating or a day value of the user's own) set with the mouse: a click sets it, dragging moves
 * it along, hovering shows where a click would set it. The keys work as on a slider (arrows, Home, End; Delete clears).
 * One piece of markup, drawn per theme in scaleInput.css: dots (classic), a ruler with the value circled in ink
 * (journal), a terminal bar of blocks `[████░░] 04/10` (nebula), an HP bar of square cells (pixel).
 */
export function ScaleInput({ label, value, min, max, color, onChange, id }: {
  label: string; value: number | undefined; min: number; max: number; color: string; onChange: (value: number | undefined) => void; id?: string;
}) {
  useLanguage();
  const range = { min, max };
  const track = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const shown = value == null ? undefined : clampToScale(value, range);
  const cells = scaleCells(range);
  const at = (event: PointerEvent<HTMLElement>) => {
    const box = track.current!.getBoundingClientRect();
    return valueAt((event.clientX - box.left) / Math.max(1, box.width), range);
  };
  const set = (next: number) => { if (next !== shown) onChange(next); };
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const big = Math.max(1, Math.round((max - min) / 10));
    const base = shown ?? min;
    const next = ({ ArrowRight: base + 1, ArrowUp: base + 1, ArrowLeft: base - 1, ArrowDown: base - 1, PageUp: base + big, PageDown: base - big, Home: min, End: max } as Record<string, number>)[event.key];
    if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (value != null) onChange(undefined); return; }
    if (next == null) return;
    event.preventDefault();
    // From no value yet, the first step sets the lowest value (Home and End go to their end at once).
    set(shown == null && event.key !== 'Home' && event.key !== 'End' ? min : clampToScale(next, range));
  };
  const pad = (number: number) => String(number).padStart(String(max).length, '0');
  const preview = hover ?? shown;
  return <div id={id} className={`scale-input${shown == null ? ' is-empty' : ''}${hover != null && !dragging ? ' is-hovering' : ''}${dragging ? ' is-dragging' : ''}${cells.length < max - min + 1 ? ' is-condensed' : cells.length > 11 ? ' is-dense' : ''}`}
    style={{ '--scale-color': color, '--scale-cells': cells.length } as CSSProperties}
    role="slider" tabIndex={0} aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={shown}
    aria-valuetext={shown == null ? t('Noch nicht bewertet') : `${shown} / ${max}`} data-value={shown ?? undefined}
    onKeyDown={keys}>
    <span className="scale-bracket" aria-hidden="true">[</span>
    <div ref={track} className="scale-track" aria-hidden="true"
      onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); (event.currentTarget.closest('.scale-input') as HTMLElement | null)?.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); setHover(null); set(at(event)); }}
      onPointerMove={event => { const next = at(event); if (dragging) set(next); else setHover(next); }}
      onPointerUp={event => { if (dragging) { setDragging(false); event.currentTarget.releasePointerCapture(event.pointerId); } }}
      onPointerCancel={() => setDragging(false)} onLostPointerCapture={() => setDragging(false)}
      onPointerLeave={() => setHover(null)}>
      {cells.map((cell, index) => {
        const next = cells[index + 1] ?? max + 1;
        return <i key={cell} className="scale-cell" data-on={shown != null && shown >= cell || undefined} data-hover={hover != null && hover >= cell || undefined}
          data-current={preview != null && preview >= cell && preview < next || undefined}>
          <span className="scale-tick">{cell}</span>
        </i>;
      })}
      {/* Journal: the value circled in ink; while hovering a pencil circle shows where a click would set it. */}
      {shown != null && <svg className="scale-ink" style={{ left: `${positionOf(shown, range) * 100}%` }} viewBox="0 0 40 30"><path d="M30 6C24 1 9 2 5 10c-4 8 4 16 15 15 11-1 17-8 14-15-2-4-7-6-12-6" /></svg>}
      {hover != null && !dragging && hover !== shown && <svg className="scale-ink is-pencil" style={{ left: `${positionOf(hover, range) * 100}%` }} viewBox="0 0 40 30"><path d="M30 6C24 1 9 2 5 10c-4 8 4 16 15 15 11-1 17-8 14-15-2-4-7-6-12-6" /></svg>}
    </div>
    <span className="scale-bracket" aria-hidden="true">]</span>
    <output className="scale-value" aria-hidden="true">
      <b className="scale-number">{preview ?? '–'}</b><small className="scale-max">/ {max}</small>
      <span className="scale-term">{preview == null ? '--' : pad(preview)}/{pad(max)}</span>
    </output>
  </div>;
}
