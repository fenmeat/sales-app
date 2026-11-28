import test from 'node:test';
import assert from 'node:assert/strict';
import {createCanvas} from '@napi-rs/canvas';
import {PDFDocument} from 'pdf-lib';
import {paperCorners,encodePage,wholePage,straighten} from '../public/scan-image.js';
import {pagesToPdf} from '../public/scan-pdf.js';

test('uncertain margins keep the full photo and neutral paper can use lossless gray',async t=>{
 const previous=globalThis.document;
 globalThis.document={createElement(){
   const c=createCanvas(1,1);
   c.toBlob=(callback,mime,quality)=>callback(new Blob([c.toBuffer(mime,Math.round(100*quality))],{type:mime}));
   return c;
 }};
 t.after(()=>{globalThis.document=previous;});
 const c=createCanvas(640,960),ctx=c.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,c.width,c.height);
 assert.deepEqual(paperCorners(c),wholePage());
 ctx.fillStyle='black';ctx.fillRect(30,50,400,3);
 const gray=await encodePage(c,wholePage(),'auto');
 assert.equal(gray.space,'DeviceGray');assert.equal(gray.filter,'FlateDecode');
 ctx.fillStyle='#c02045';ctx.fillRect(350,590,4,4);
 const colour=await encodePage(c,wholePage(),'auto');assert.equal(colour.space,'DeviceRGB');
 const manual=straighten(c,wholePage(),'gray'),sample=manual.canvas.getContext('2d').getImageData(350,590,1,1).data;
 assert.equal(sample[0],sample[1]);assert.equal(sample[1],sample[2]);assert.ok(sample[0]<200);
 const pdf=await PDFDocument.load(await pagesToPdf([gray,colour]).arrayBuffer());
 assert.equal(pdf.getPageCount(),2);assert.throws(()=>straighten(c,[[0,0],[1,1],[1,0],[0,1]],'auto'));
});
