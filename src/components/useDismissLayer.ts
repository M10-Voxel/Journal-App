import { useLayoutEffect, useRef } from 'react';

interface DismissLayer {
  element: () => HTMLElement | null;
  anchor?: () => HTMLElement | null;
  inside?: (target: Element) => boolean;
  ignore?: () => boolean;
  onDismiss: () => void;
}
const layers: DismissLayer[] = [];
let releaseGesture: (() => void) | undefined;

/** The pointer's eventual click must stay consumed even after its popup has unmounted. */
function consumeGesture(down: PointerEvent) {
  releaseGesture?.();
  const stop = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); };
  stop(down);
  let timer: number | undefined;
  const mouse = (event: Event) => {
    // Keyboard activation and explicit .click() are independent of this pointer gesture.
    if (['click','dblclick','auxclick'].includes(event.type) && (event as MouseEvent).detail === 0) return;
    stop(event);
    if (['click','auxclick','contextmenu'].includes(event.type)) { window.clearTimeout(timer); timer=window.setTimeout(cleanup,0); }
  };
  const up = (event: PointerEvent) => {
    if(event.pointerId!==down.pointerId)return;
    stop(event); window.clearTimeout(timer); timer=window.setTimeout(cleanup,600);
  };
  const cleanup = () => {
    window.clearTimeout(timer);
    for(const name of ['mousedown','mouseup','click','dblclick','auxclick','contextmenu'])window.removeEventListener(name,mouse,true);
    window.removeEventListener('pointerup',up,true);
    window.removeEventListener('pointercancel',cleanup,true);
    window.removeEventListener('pointerdown',cleanup,true);
    window.removeEventListener('blur',cleanup);
    if(releaseGesture===cleanup)releaseGesture=undefined;
  };
  for(const name of ['mousedown','mouseup','click','dblclick','auxclick','contextmenu'])window.addEventListener(name,mouse,true);
  window.addEventListener('pointerup',up,true);
  window.addEventListener('pointercancel',cleanup,true);
  window.addEventListener('pointerdown',cleanup,true);
  window.addEventListener('blur',cleanup);
  releaseGesture=cleanup;
}
function outside(event: PointerEvent) {
  const layer=layers.at(-1),target=event.target;
  if(!layer || !(target instanceof Element) || layer.ignore?.())return;
  if(layer.element()?.contains(target)||layer.anchor?.()?.contains(target)||layer.inside?.(target))return;
  consumeGesture(event);
  layer.onDismiss();
}

/** Only the top floating layer dismisses, and the dismissing press never activates the view behind it. */
export function useDismissLayer(options: DismissLayer, enabled=true) {
  const latest=useRef(options);latest.current=options;
  useLayoutEffect(()=>{
    if(!enabled)return;
    const layer:DismissLayer={element:()=>latest.current.element(),anchor:()=>latest.current.anchor?.()??null,inside:target=>latest.current.inside?.(target)??false,ignore:()=>latest.current.ignore?.()??false,onDismiss:()=>latest.current.onDismiss()};
    // Child layout effects may run first; its portal anchor still identifies the parent layer.
    const child=layers.findIndex(other=>{const anchor=other.anchor?.()??other.element();return !!anchor&&!!layer.element()?.contains(anchor);});
    layers.splice(child<0?layers.length:child,0,layer);
    if(layers.length===1)window.addEventListener('pointerdown',outside,true);
    return ()=>{const index=layers.indexOf(layer);if(index>=0)layers.splice(index,1);if(!layers.length)window.removeEventListener('pointerdown',outside,true);};
  },[enabled]);
}
