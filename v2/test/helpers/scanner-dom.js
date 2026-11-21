// Native canvas backing for the real scanner in the DOM acceptance harness.
// This exercises image processing and PDF creation; it does not emulate a
// physical camera, browser layout or touch events.
import {createCanvas,loadImage} from '@napi-rs/canvas';
export function scannerDOM(document){
 const create=document.createElement.bind(document),canvases=new WeakMap(),previousBitmap=globalThis.createImageBitmap;
 document.createElement=(name,...args)=>{
  const el=create(name,...args);
  if(name==='canvas'){
   const canvas=createCanvas(1,1);canvases.set(el,canvas);
   for(const key of ['width','height'])Object.defineProperty(el,key,{get:()=>canvas[key],set:value=>{canvas[key]=value;}});
   el.getContext=(...args)=>{const ctx=canvas.getContext(...args);return new Proxy(ctx,{get(target,key){if(key==='drawImage')return (source,...rest)=>target.drawImage(canvases.get(source)||source,...rest);const value=target[key];return typeof value==='function'?value.bind(target):value;},set(target,key,value){target[key]=value;return true;}});};
   el.toBlob=(cb,mime,quality)=>cb(new Blob([canvas.toBuffer(mime,Math.round(quality*100))],{type:mime}));
  }
  if(name==='dialog'){
   el.showModal=()=>el.open=true;el.close=()=>el.open=false;
   const query=el.querySelector.bind(el);el.querySelector=selector=>{const found=query(selector);if(found?.localName==='select'&&!Object.hasOwn(found,'value')){let value='auto';Object.defineProperty(found,'value',{get:()=>value,set:v=>value=v});}return found;};
  }
  return el;
 };
 globalThis.createImageBitmap=async file=>{const image=await loadImage(Buffer.from(await file.arrayBuffer()));image.close=()=>{};return image;};
 return ()=>{document.createElement=create;globalThis.createImageBitmap=previousBitmap;};
}
export function cameraDocument(){
 const canvas=createCanvas(640,960),ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,640,960);ctx.fillStyle='black';ctx.font='24px sans-serif';ctx.fillText('Synthetic delivery document',30,60);
 for(let i=0;i<15;i++)ctx.fillText('Item '+(i+1)+'    R 125.50',30,130+i*40);
 return new File([canvas.toBuffer('image/jpeg',92)],'camera.jpg',{type:'image/jpeg'});
}
