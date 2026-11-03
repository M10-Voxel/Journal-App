/// <reference types="vite/client" />
import encode from '@jsquash/avif/encode';
self.onmessage=async(event:MessageEvent<File>)=>{
  try {
    const bitmap=await createImageBitmap(event.data);
    const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
    const context=canvas.getContext('2d')!;
    context.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const result=await encode(context.getImageData(0,0,canvas.width,canvas.height),{quality:55,speed:8});
    self.postMessage({result});
  } catch(error){self.postMessage({error:String(error)});}
};
