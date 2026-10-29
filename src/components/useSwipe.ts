import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { IconName } from './Icon';

export type SwipeDirection = 'right' | 'left' | 'up' | 'down';
/** `color` is the action's own colour (from the Clean theme), shown on the handle and as the trail behind it. */
export interface SwipeAction<P> { id: string; label: string; icon: IconName; color: string; preview?: P; leaves?: boolean; run: () => void }
/** Per direction the actions by stage: the further the drag, the later the action (up to three sideways, two vertically). */
export type SwipeActions<P> = Record<SwipeDirection, SwipeAction<P>[]>;

/** Pointer distance for each stage. */
export const swipeStages: Record<'x' | 'y', number[]> = { x: [56, 125, 195], y: [30, 72] };
const limit = 250;

export const directionOf = (axis: 'x' | 'y', distance: number): SwipeDirection => axis === 'x' ? distance > 0 ? 'right' : 'left' : distance > 0 ? 'down' : 'up';

/** The action a drag of `distance` px along `axis` reaches, or null below the first stage. */
export function swipeTarget<P>(actions: SwipeActions<P>, axis: 'x' | 'y', distance: number): { action: SwipeAction<P>; stage: number } | null {
  const side = actions[directionOf(axis, distance)];
  const stages = swipeStages[axis];
  for (let stage = Math.min(side.length, stages.length) - 1; stage >= 0; stage--) if (Math.abs(distance) >= stages[stage]) return { action: side[stage], stage };
  return null;
}
/** The handle follows the pointer; past the last stage with growing resistance (vertically sooner, it leaves the row). */
export function resist(axis: 'x' | 'y', distance: number): number {
  const size = Math.abs(distance);
  const edge = axis === 'y' ? 90 : limit;
  return Math.sign(distance) * (size <= edge ? size : edge + (size - edge) * 0.2);
}

// Swipe gestures on an entry: drag its symbol in one of four directions (or swipe sideways on a trackpad) and release to act.
// The axis locks after the first few pixels. A press without movement is a tap, however long it is held.
export function useSwipe<P>({ actions, onTap, onPreview }: { actions: SwipeActions<P>; onTap: () => void; onPreview: (preview: P | null) => void }) {
  const [axis, setAxis] = useState<'x' | 'y'>('x');
  const [distance, setDistance] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'dragging' | 'settling' | 'leaving'>('idle');
  const start = useRef<{ x: number; y: number; pointer: number; axis: 'x' | 'y' | null } | null>(null);
  const wheelTimer = useRef<number>(undefined);
  const wheelDistance = useRef(0);
  const latest = useRef({ actions, onTap, onPreview, axis, distance });
  latest.current = { actions, onTap, onPreview, axis, distance };
  const target = swipeTarget(actions, axis, distance);
  // The direction stays known while the row settles back, so the indicator can fade with it.
  const direction = useRef<SwipeDirection>('right');
  if (distance) direction.current = directionOf(axis, distance);

  useEffect(() => { if (phase === 'dragging') onPreview(target?.action.preview ?? null); }, [target?.action.id, phase]);
  useEffect(() => () => window.clearTimeout(wheelTimer.current), []);
  const settle = () => window.setTimeout(() => setPhase(current => current === 'settling' ? 'idle' : current), 380);

  function finish(reached: { action: SwipeAction<P> } | null, along: 'x' | 'y', signed: number) {
    latest.current.onPreview(null);
    wheelDistance.current = 0;
    if (reached?.action.leaves) {
      setPhase('leaving');
      setDistance(Math.sign(signed) * (along === 'x' ? 900 : 60));
      window.setTimeout(() => reached.action.run(), 220);
      return;
    }
    setPhase('settling');
    setDistance(0);
    settle();
    reached?.action.run();
  }
  const release = () => { const { actions, axis, distance } = latest.current; finish(swipeTarget(actions, axis, distance), axis, distance); };
  /** Runs a stage directly (keyboard): the row nudges in that direction and the action happens. */
  function trigger(towards: SwipeDirection, stage: number) {
    const action = latest.current.actions[towards][stage] ?? latest.current.actions[towards][0];
    if (!action) return;
    const along = towards === 'left' || towards === 'right' ? 'x' : 'y';
    const signed = (towards === 'right' || towards === 'down' ? 1 : -1) * (swipeStages[along][stage] ?? swipeStages[along][0]);
    setAxis(along);
    setPhase('settling');
    setDistance(signed);
    requestAnimationFrame(() => requestAnimationFrame(() => finish({ action }, along, signed)));
  }

  return {
    distance, axis, phase, target, direction: direction.current,
    /** Visual offset of the handle (the symbol); the row itself stays where it is. */
    offset: { x: axis === 'x' ? resist('x', distance) : 0, y: axis === 'y' ? resist('y', distance) : 0 },
    trigger,
    handle: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (event.button !== 0 || !event.isPrimary) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = { x: event.clientX, y: event.clientY, pointer: event.pointerId, axis: null };
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        const drag = start.current;
        if (!drag || drag.pointer !== event.pointerId) return;
        const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
        if (!drag.axis) {
          if (Math.hypot(dx, dy) < 7) return;
          drag.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
          setAxis(drag.axis);
        }
        setPhase('dragging');
        setDistance(drag.axis === 'x' ? dx : dy);
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        const drag = start.current;
        if (!drag || drag.pointer !== event.pointerId) return;
        start.current = null;
        if (drag.axis) release(); else latest.current.onTap();
      },
      onPointerCancel() { if (start.current?.axis) release(); start.current = null; },
      // A tap is handled on pointerup; the click that follows must not toggle anything else.
      onClick(event: ReactMouseEvent<HTMLElement>) { if (event.detail > 0) event.preventDefault(); },
    },
    wheel(deltaX: number, deltaY: number) {
      if (Math.abs(deltaX) <= Math.abs(deltaY) || phase === 'leaving') return false;
      setAxis('x');
      setPhase('dragging');
      wheelDistance.current -= deltaX;
      setDistance(wheelDistance.current);
      window.clearTimeout(wheelTimer.current);
      wheelTimer.current = window.setTimeout(release, 160);
      return true;
    },
  };
}
