import test from 'node:test';
import assert from 'node:assert/strict';
import { resizeBoardView } from '../src/boardViewport.ts';

const centre = (view, size) => [(size.width / 2 - view.pan.x) / view.scale, (size.height / 2 - view.pan.y) / view.scale];
const close = (a,b) => a.forEach((value,i)=>assert(Math.abs(value-b[i])<1e-8));
test('resizing fits both dimensions and preserves the world centre after panning and zooming', () => {
 const size={width:800,height:600}, view={scale:1.7,pan:{x:-430,y:120}}, reference={...size,scale:view.scale};
 const small={width:400,height:450}, next=resizeBoardView(view,size,small,reference);
 assert.equal(next.scale,.85);close(centre(view,size),centre(next,small));
 const tall={width:800,height:300}, vertical=resizeBoardView(view,size,tall,reference);
 assert.equal(vertical.scale,.85);close(centre(view,size),centre(vertical,tall));
});
test('repeated resizing and returning to the original size does not accumulate zoom drift',()=>{
 const size={width:800,height:600}, initial={scale:2,pan:{x:80,y:-220}}, reference={...size,scale:2};
 let previous=size, view=initial;
 for(const next of [{width:400,height:600},{width:400,height:300},{width:800,height:300},size]) {
  view=resizeBoardView(view,previous,next,reference);previous=next;
 }
 assert.equal(view.scale,initial.scale);close([view.pan.x,view.pan.y],[initial.pan.x,initial.pan.y]);
});
