import { useEffect, useRef } from 'react';

type Step = { undo: () => void | Promise<void>; redo: () => void | Promise<void>; time?: number };
const back: Step[] = [], forward: Step[] = [];
const pending = new Set<() => void>();
let replaying = false, installed = false;
let lastSidePointer = -Infinity;
let inputEpoch = 0, replayEpoch = 0;
async function travel(redo: boolean) {
  if (replaying) return;
  pending.forEach(flush => flush());
  const step = (redo ? forward : back).pop();
  if (!step) return;
  replaying = true;
  replayEpoch = inputEpoch;
  try { await (redo ? step.redo : step.undo)(); }
  finally { requestAnimationFrame(() => requestAnimationFrame(() => { replaying = false; })); }
  (redo ? back : forward).push(step);
}
function install() {
  if (installed) return; installed = true;
  window.addEventListener('pointerdown', event => { if (event.button !== 3 && event.button !== 4) inputEpoch++; }, true);
  window.addEventListener('keydown', () => { inputEpoch++; }, true);
  // Editors may cancel pointerdown, which suppresses the later compatibility mousedown.
  // Intercept first, while allowing mousedown to reach our native-navigation guard.
  window.addEventListener('pointerdown', event => {
    if (event.button !== 3 && event.button !== 4) return;
    event.stopImmediatePropagation();
    lastSidePointer = performance.now();
    void travel(event.button === 4);
  }, true);
  window.addEventListener('mousedown', event => {
    if (event.button !== 3 && event.button !== 4) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (performance.now() - lastSidePointer > 500) void travel(event.button === 4);
  }, true);
  for (const type of ['mouseup', 'auxclick']) window.addEventListener(type, event => {
    const mouse = event as MouseEvent;
    if (mouse.button === 3 || mouse.button === 4) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
}

/** View state only: independent of the journal's content undo. Coalesce continuous window drags. */
export function useViewHistory<T>(value: T, restore: (value: T) => void | Promise<void>) {
  const apply = useRef(restore); apply.current = restore;
  const previous = useRef(JSON.stringify(value));
  const next = JSON.stringify(value);
  useEffect(() => {
    install();
    if (previous.current === next) return;
    if (replaying && inputEpoch === replayEpoch) { previous.current = next; return; }
    const before = previous.current;
    const flush = () => {
      if (!pending.delete(flush)) return;
      clearTimeout(timer);
      previous.current = next;
      const step: Step = { undo: () => apply.current(JSON.parse(before)), redo: () => apply.current(JSON.parse(next)), time: performance.now() };
      const last = back.at(-1);
      if (last && step.time! - (last.time ?? 0) < 80) {
        back[back.length - 1] = { undo: async () => { await step.undo(); await last.undo(); }, redo: async () => { await last.redo(); await step.redo(); }, time: step.time };
      } else back.push(step);
      if (back.length > 100) back.shift(); forward.length = 0;
    };
    pending.add(flush);
    const timer = window.setTimeout(flush, 250);
    return () => { clearTimeout(timer); pending.delete(flush); };
  }, [next]);
}
