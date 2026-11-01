import { t, useLanguage } from '../i18n';
import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { clockAngle, clockValue, formatTime, parseTime, stepTime, typeDigit } from '../planning';
import type { ClockMode } from '../planning';
import { Icon } from './Icon';

const size = 196;
const center = size / 2;
const outer = 80;
const inner = 52;
const quickTimes = ['08:00', '12:00', '15:00', '18:00', '20:00'];
const typingPause = 1500;

// Time picker without typing: drag or tap the hour (outer ring 1–12, inner ring 13–00), it then flips to minutes in 5-minute steps.
// Keyboard: digits type the active part (see typeDigit), Tab switches hours/minutes, arrows and the wheel fine-tune.
// It lies over the hidden calendar, so both views of the planner are exactly the same size.
export function ClockDial({ time, onChange, onBack }: { time: string; onChange: (time: string) => void; onBack: () => void }) {
  useLanguage();
  const [mode, setMode] = useState<ClockMode>('hour');
  const dragging = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLDivElement>(null);
  const angle = useRef<number | null>(null);
  const typed = useRef<{ pending: number | null; at: number }>({ pending: null, at: 0 });
  const { hour, minute } = parseTime(time);

  // Keep the hand's rotation continuous so it never spins the long way round when passing 12.
  const target = clockAngle(mode, hour, minute);
  if (angle.current === null) angle.current = target;
  else angle.current += ((target - angle.current) % 360 + 540) % 360 - 180;
  const radius = mode === 'hour' && (hour === 0 || hour > 12) ? inner : outer;

  function switchMode(next: ClockMode) {
    typed.current.pending = null;
    setMode(next);
  }
  function pick(event: PointerEvent<HTMLDivElement>) {
    // Measured, not assumed: the face may still be scaling in while it is tapped.
    const bounds = event.currentTarget.getBoundingClientRect();
    const scale = bounds.width / size;
    const next = clockValue(mode, event.clientX - bounds.left - bounds.width / 2, event.clientY - bounds.top - bounds.height / 2, scale * (inner + outer) / 2, { hour, minute });
    if (next !== time) onChange(next);
  }
  function onKey(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
    if (event.ctrlKey || event.altKey || event.metaKey) return;
    if (/^[0-9]$/.test(event.key)) {
      const now = performance.now();
      const pending = now - typed.current.at < typingPause ? typed.current.pending : null;
      const next = typeDigit({ time, mode, pending }, Number(event.key));
      typed.current = { pending: next.pending, at: now };
      onChange(next.time);
      if (next.mode !== mode) setMode(next.mode);
    } else if (event.key === 'Tab') switchMode(mode === 'hour' ? 'minute' : 'hour');
    else if (event.key in steps) { typed.current.pending = null; onChange(stepTime(time, mode, steps[event.key])); }
    else return;
    event.preventDefault();
    event.stopPropagation();
    faceRef.current?.focus({ preventScroll: true });
  }
  // React registers wheel listeners as passive; a native one can keep the page from scrolling while the time turns.
  const wheel = useRef((_: globalThis.WheelEvent) => {});
  wheel.current = event => {
    event.preventDefault();
    typed.current.pending = null;
    onChange(stepTime(time, mode, (event.deltaY < 0 ? 1 : -1) * (mode === 'minute' ? 5 : 1)));
  };
  useEffect(() => {
    const root = rootRef.current!;
    const listener = (event: globalThis.WheelEvent) => wheel.current(event);
    root.addEventListener('wheel', listener, { passive: false });
    faceRef.current?.focus({ preventScroll: true });
    return () => root.removeEventListener('wheel', listener);
  }, []);

  const numbers = mode === 'hour'
    ? [...Array.from({ length: 12 }, (_, index) => ({ value: index === 0 ? 12 : index, ring: outer })), ...Array.from({ length: 12 }, (_, index) => ({ value: index === 0 ? 0 : index + 12, ring: inner }))]
    : Array.from({ length: 12 }, (_, index) => ({ value: index * 5, ring: outer }));
  const active = mode === 'hour' ? hour : minute;

  return <div className="clock" ref={rootRef} onKeyDown={onKey}>
    <div className="clock-head">
      <button type="button" className="clock-back" aria-label={t("Zurück zum Kalender")} data-tip={t("Zurück · Esc")} onClick={onBack}><Icon name="left" /></button>
      <div className="clock-readout">
        <button type="button" className="clock-part" aria-pressed={mode === 'hour'} aria-label={t("Stunde {0}", hour)} onClick={() => { switchMode('hour'); faceRef.current?.focus({ preventScroll: true }); }}><span key={hour}>{formatTime(hour, minute).slice(0, 2)}</span></button>
        <span className="clock-colon">:</span>
        <button type="button" className="clock-part" aria-pressed={mode === 'minute'} aria-label={t("Minute {0}", minute)} onClick={() => { switchMode('minute'); faceRef.current?.focus({ preventScroll: true }); }}><span key={minute}>{formatTime(hour, minute).slice(3)}</span></button>
      </div>
    </div>
    <div className="clock-main">
      <div ref={faceRef} className="clock-face" role="slider" tabIndex={0} aria-label={mode === 'hour' ? t("Stunde wählen") : t("Minute wählen")} aria-valuemin={0} aria-valuemax={mode === 'hour' ? 23 : 59} aria-valuenow={active} aria-valuetext={time}
        aria-keyshortcuts="Tab 0 1 2 3 4 5 6 7 8 9" style={{ width: size, height: size }}
        onPointerDown={event => { if (event.button !== 0) return; dragging.current = true; typed.current.pending = null; event.currentTarget.setPointerCapture(event.pointerId); event.currentTarget.focus({ preventScroll: true }); pick(event); }}
        onPointerMove={event => { if (dragging.current) pick(event); }}
        onPointerUp={() => { if (!dragging.current) return; dragging.current = false; if (mode === 'hour') switchMode('minute'); }}
        onPointerCancel={() => { dragging.current = false; }}>
        <div className="clock-hand" style={{ height: radius, transform: `rotate(${angle.current}deg)` }}><span className="clock-knob" /></div>
        <span className="clock-pivot" />
        <div className="clock-numbers" key={mode}>
          {numbers.map(({ value, ring }, index) => {
            const rad = (index % 12) * Math.PI / 6;
            return <span key={`${ring}-${value}`} className={`clock-number${ring === inner ? ' is-inner' : ''}${value === active ? ' is-active' : ''}${mode === 'minute' && minute % 5 !== 0 && value === minute - minute % 5 ? ' is-near' : ''}`}
              style={{ left: center + ring * Math.sin(rad), top: center - ring * Math.cos(rad) }}>{mode === 'minute' || value === 0 ? String(value).padStart(2, '0') : value}</span>;
          })}
        </div>
      </div>
      <div className="clock-quick" role="group" aria-label={t("Schnellwahl")}>
        {quickTimes.map(value => <button key={value} type="button" aria-pressed={value === time} onClick={() => { onChange(value); switchMode('hour'); faceRef.current?.focus({ preventScroll: true }); }}>{value.slice(0, 2)}</button>)}
      </div>
    </div>
  </div>;
}
