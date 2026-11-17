// The crop is always expressed in fractions of the original, oriented photo.
export const wholePage = () => [[0,0],[1,0],[1,1],[0,1]];
const clamp = (n, min, max) => Math.max(min, Math.min(n, max));

export function validCorners(points) {
  return points.length === 4 && points.every(([x,y], i) => {
    const [bx,by] = points[(i+1)%4], [cx,cy] = points[(i+2)%4];
    return x>=0 && x<=1 && y>=0 && y<=1 && (bx-x)*(cy-by)-(by-y)*(cx-bx) > .006;
  });
}

// Run Otsu segmentation on a small preview. Only propose a crop when a single
// bright, paper-shaped component has four distinguishable corners.
export function paperCorners(canvas) {
  const ratio = Math.min(1, 240 / Math.max(canvas.width, canvas.height));
  const small = document.createElement('canvas');
  const w = small.width = Math.max(1, Math.round(canvas.width*ratio));
  const h = small.height = Math.max(1, Math.round(canvas.height*ratio));
  const ctx = small.getContext('2d');
  ctx.drawImage(canvas,0,0,w,h);
  const rgba = ctx.getImageData(0,0,w,h).data;
  const light = new Uint8Array(w*h), histogram = new Uint32Array(256);
  let total = 0;
  for (let i=0;i<light.length;i++) {
    const j=i*4;
    light[i]=(rgba[j]*77+rgba[j+1]*150+rgba[j+2]*29)>>8;
    histogram[light[i]]++; total += light[i];
  }
  let count=0, sum=0, best=0, cut=0, gap=0;
  for(let k=0;k<255;k++) {
    count+=histogram[k]; sum+=histogram[k]*k;
    const rest=light.length-count;
    if(!count || !rest) continue;
    const contrast=(total-sum)/rest-sum/count, score=count*rest*contrast*contrast;
    if(score>best){best=score;cut=k;gap=contrast;}
  }
  if(gap<28) return wholePage();
  const seen=new Uint8Array(w*h), queue=new Int32Array(w*h);
  let largest=0, result=wholePage();
  for(let i=0;i<light.length;i++) {
    if(seen[i] || light[i]<=cut) continue;
    let head=0, tail=1;
    queue[0]=i; seen[i]=1;
    const scores=[-Infinity,-Infinity,-Infinity,-Infinity], corners=[];
    while(head<tail) {
      const p=queue[head++], x=p%w, y=Math.floor(p/w);
      const values=[-x-y,x-y,x+y,y-x];
      for(let j=0;j<4;j++) if(values[j]>scores[j]){scores[j]=values[j];corners[j]=[x/(w-1),y/(h-1)];}
      if(x && !seen[p-1] && light[p-1]>cut){seen[p-1]=1;queue[tail++]=p-1;}
      if(x+1<w && !seen[p+1] && light[p+1]>cut){seen[p+1]=1;queue[tail++]=p+1;}
      if(y && !seen[p-w] && light[p-w]>cut){seen[p-w]=1;queue[tail++]=p-w;}
      if(y+1<h && !seen[p+w] && light[p+w]>cut){seen[p+w]=1;queue[tail++]=p+w;}
    }
    if(tail<=largest || tail<w*h*.16 || !validCorners(corners)) continue;
    const area=corners.reduce((s,[x,y],j)=>{const [nx,ny]=corners[(j+1)%4];return s+x*ny-y*nx;},0)/2;
    if(area>.975 || Math.abs(tail/(w*h)-area)>area*.24) continue;
    largest=tail;
    // Include the thin border lost while sampling the preview.
    const cx=corners.reduce((s,p)=>s+p[0],0)/4, cy=corners.reduce((s,p)=>s+p[1],0)/4;
    result=corners.map(([x,y])=>[clamp(cx+(x-cx)*1.012,0,1),clamp(cy+(y-cy)*1.012,0,1)]);
  }
  return result;
}

export async function decodePhoto(file){
  if(typeof createImageBitmap==='function'){
    try{const image=await createImageBitmap(file,{imageOrientation:'from-image'});return {image,width:image.width,height:image.height,release:()=>image.close()};}catch{}
  }
  const url=URL.createObjectURL(file),image=document.createElement('img');
  try{
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Kies ’n JPG- of PNG-kopie van hierdie foto.'));image.src=url;});
    return {image,width:image.naturalWidth,height:image.naturalHeight,release:()=>{image.src='';URL.revokeObjectURL(url);}};
  }catch(e){URL.revokeObjectURL(url);throw e;}
}

export async function scanSource(file) {
  const decoded=await decodePhoto(file);
  try {
    const canvas=document.createElement('canvas');
    const ratio=Math.min(1,3200/Math.max(decoded.width,decoded.height));
    canvas.width=Math.max(1,Math.round(decoded.width*ratio));canvas.height=Math.max(1,Math.round(decoded.height*ratio));
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.drawImage(decoded.image,0,0,canvas.width,canvas.height);return canvas;
  }finally{decoded.release();}
}

// Inverse projective map from the rectangular output into the four source
// corners. Bilinear sampling avoids jagged strokes on fine print.
export function straighten(source, corners, mode) {
  if(!validCorners(corners)) throw Error('Skuif die vier hoeke na die buiterand van die bladsy.');
  const p=corners.map(([x,y])=>[x*(source.width-1),y*(source.height-1)]);
  const length=(a,b)=>Math.hypot(p[a][0]-p[b][0],p[a][1]-p[b][1]);
  const rawW=Math.max(length(0,1),length(3,2)),rawH=Math.max(length(0,3),length(1,2));
  const scale=Math.min(1,2700/Math.max(rawW,rawH));
  const out=document.createElement('canvas'),w=out.width=Math.max(2,Math.round(rawW*scale)),h=out.height=Math.max(2,Math.round(rawH*scale));
  const [[x0,y0],[x1,y1],[x2,y2],[x3,y3]]=p;
  const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  const det=dx1*dy2-dx2*dy1;
  if(!det)throw Error('Kies ’n groter deel van die bladsy.');
  const g=(dx3*dy2-dx2*dy3)/det, j=(dx1*dy3-dx3*dy1)/det;
  const a=x1-x0+g*x1,b=x3-x0+j*x3,d=y1-y0+g*y1,e=y3-y0+j*y3;
  const sw=source.width,sh=source.height;
  const pixels=source.getContext('2d').getImageData(0,0,sw,sh).data;
  const ctx=out.getContext('2d'),frame=ctx.createImageData(w,h),outData=frame.data;
  let hasColour=false;
  for(let y=0;y<h;y++){
    const v=y/(h-1), bx=b*v+x0, by=e*v+y0, den=j*v+1;
    for(let x=0;x<w;x++){
      const u=x/(w-1), f=1/(g*u+den), sx=clamp((a*u+bx)*f,0,sw-1), sy=clamp((d*u+by)*f,0,sh-1);
      const ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
      const tl=(iy*sw+ix)*4,tr=tl+(ix<sw-1?4:0),step=iy<sh-1?sw*4:0;
      const dest=(y*w+x)*4;
      for(let ch=0;ch<3;ch++)outData[dest+ch]=(1-fy)*((1-fx)*pixels[tl+ch]+fx*pixels[tr+ch])+fy*((1-fx)*pixels[tl+step+ch]+fx*pixels[tr+step+ch]);
      outData[dest+3]=255;
      const r=outData[dest],green=outData[dest+1],blue=outData[dest+2];
      if(Math.max(r,green,blue)-Math.min(r,green,blue)>10)hasColour=true;
      if(mode==='gray'){const gray=Math.round(.299*r+.587*green+.114*blue);outData[dest]=outData[dest+1]=outData[dest+2]=gray;}
    }
  }
  ctx.putImageData(frame,0,0);
  return {canvas:out,gray:mode==='gray'||(mode==='auto'&&!hasColour)};
}

export const canvasBlob=(canvas,type,quality)=>new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?.size?resolve(blob):reject(Error('Die beeld kon nie gestoor word nie. Probeer weer.')),type,quality));

export async function encodePage(source,corners,mode) {
  const {canvas,gray}=straighten(source,corners,mode);
  try {
    const jpeg=await canvasBlob(canvas,'image/jpeg',.88);
    let image=jpeg,filter='DCTDecode',space='DeviceRGB';
    if(gray && typeof CompressionStream==='function'){
      const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      const luminance=new Uint8Array(data.length/4);
      for(let i=0;i<luminance.length;i++)luminance[i]=Math.round(.299*data[i*4]+.587*data[i*4+1]+.114*data[i*4+2]);
      const lossless=await new Response(new Blob([luminance]).stream().pipeThrough(new CompressionStream('deflate'))).blob();
      if(lossless.size<jpeg.size){image=lossless;filter='FlateDecode';space='DeviceGray';}
    }
    return {width:canvas.width,height:canvas.height,image,filter,space,preview:jpeg};
  }finally{canvas.width=canvas.height=1;}
}
