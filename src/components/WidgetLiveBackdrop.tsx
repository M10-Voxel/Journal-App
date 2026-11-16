import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

/** GPU wallpaper frames, cropped by the backend to this widget. The frame loop
 * has at most one request/decoded image in flight and releases every old blob. While other windows hide the whole
 * widget the loop rests (the last picture stays; nothing of it is visible) and goes on at once when a part shows again.
 * The backend is asked whether the widget is covered every half second. */
export function WidgetLiveBackdrop({active,blur,onError}:{active:boolean;blur:number;onError(error:string):void}) {
  const [url,setUrl]=useState<string|null>(null);
  useEffect(()=>{
    if(!active){setUrl(null);return;}
    let stopped=false,timer:number|undefined,current:string|null=null,covered=false,resting=false;
    const started=Date.now();
    const frame=async()=>{
      if(covered){resting=true;return;}
      let next:string|null=null;
      try{
        const bytes=await invoke<ArrayBuffer>('desktop_widget_live_frame');
        if(stopped)return;
        if(!bytes.byteLength){if(!current&&Date.now()-started>2000)onError('Der Live-Hintergrund liefert noch keine Bilder.');return;}
        next=URL.createObjectURL(new Blob([bytes],{type:'image/bmp'}));
        const image=new Image();image.src=next;await image.decode();
        if(stopped)return;
        const old=current;current=next;next=null;setUrl(current);
        if(old)URL.revokeObjectURL(old);
        onError('');
      }catch(reason){if(!stopped){if(current)URL.revokeObjectURL(current);current=null;setUrl(null);onError(String(reason));}}
      finally{
        if(next)URL.revokeObjectURL(next);
        if(!stopped)timer=globalThis.setTimeout(()=>void frame(),50);
      }
    };
    const look=async()=>{
      try{
        const next=await invoke<boolean>('desktop_widget_covered');
        if(stopped)return;
        covered=next;
        if(!covered&&resting){resting=false;globalThis.clearTimeout(timer);void frame();}
      }catch{covered=false;if(resting&&!stopped){resting=false;void frame();}}
    };
    void frame();
    const watch=globalThis.setInterval(()=>void look(),500);
    return()=>{stopped=true;globalThis.clearTimeout(timer);globalThis.clearInterval(watch);if(current)URL.revokeObjectURL(current);};
  },[active,onError]);
  if(!active||!url)return null;
  return <span className="desktop-widget-backdrop" aria-hidden="true" data-live-capture="true">
    <svg width="0" height="0"><filter id="widget-live-backdrop-blur" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB"><feGaussianBlur stdDeviation={blur} edgeMode="duplicate" /></filter></svg>
    <i style={{backgroundImage:`url("${url}")`,backgroundSize:'100% 100%',width:'100%',height:'100%',left:0,top:0,filter:'url(#widget-live-backdrop-blur)'}} />
  </span>;
}
