import test from 'node:test';
import assert from 'node:assert/strict';
import {inflateSync} from 'node:zlib';
import {PDFDocument} from 'pdf-lib';
import {stocktakeSummaryRows,stocktakeSummaryPDF} from '../src/stocktake-summary-pdf.js';

const date='2026-10-27',selection={supplier:'test supplier',date};
function material(id,overrides={}){
 return {id,name:'Synthetic product '+id,supplier:'Test Supplier',procure:true,unit:'kg',pack_qty:25,stock:{qty:50,date,available_from:'2026-10-28',reserve:10,incoming:[{qty:999,date,reference:'SYNTHETIC'}],count:{packs:2,loose:0,pack_qty:25,unit:'kg'}},...overrides};
}
function pdfText(pdf){return pdf.getPages().flatMap(page=>page.node.Contents().asArray().flatMap(ref=>{
 const content=inflateSync(pdf.context.lookup(ref).getContents()).toString();return [...content.matchAll(/<([A-Fa-f0-9]+)> Tj/g)].map(m=>Buffer.from(m[1],'hex').toString('latin1'));
})).join('\n');}

test('daily supplier summary uses complete saved rows and distinguishes exact-date zero from missing and older counts',()=>{
 const register={materials:[
  material('A'),material('ZERO',{stock:{qty:0,date},pack_qty:null}),
  material('MISSING',{stock:{qty:null,date:null}}),material('OLDER',{stock:{qty:0,date:'2026-10-13'}}),
  material('FUTURE',{stock:{qty:50,date:'2026-10-29'}}),
  material('OTHER',{supplier:'Other supplier'}),material('INACTIVE',{procure:false}),material('UNAVAILABLE',{resale_available:false})
 ]},before=structuredClone(register);
 const result=stocktakeSummaryRows(register,selection);
 assert.deepEqual(result.rows.map(r=>[r.id,r.countText]),[['A','2 × 25 kg'],['ZERO','0 kg'],['MISSING','Not counted'],['OLDER','Not counted'],['FUTURE','Not counted']]);
 assert.equal(result.supplier,'Test Supplier');assert.equal(result.counted,2);assert.equal(result.total,5);assert.equal(result.other_date_count,2);
 assert.deepEqual(register,before,'counts, allocation and incoming entries remain untouched');
 assert.throws(()=>stocktakeSummaryRows(register,{...selection,date:'2026-02-30'}),/valid YYYY-MM-DD/);
 assert.throws(()=>stocktakeSummaryRows(register,{...selection,supplier:'absent'}),/Supplier not found/);
 assert.throws(()=>stocktakeSummaryRows(register,{...selection,supplier:null}),/Choose a supplier/);
});

test('saved pack basis is retained and loose or incompatible legacy quantities remain their exact recorded total',()=>{
 const register={materials:[
  material('CHANGED',{pack_qty:1000,pack_spec:{unit_label:'sakke'},unit:'unit',stock:{qty:500,date,count:{packs:2,loose:0,pack_qty:250,unit:'unit'}}}),
  material('LOOSE',{stock:{qty:52.5,date,count:{packs:2,loose:2.5,pack_qty:25,unit:'kg'}}}),
  material('RAW',{pack_qty:null,stock:{qty:12.345678,date}}),
  material('MISMATCH',{stock:{qty:49,date,count:{packs:2,loose:0,pack_qty:25,unit:'kg'}}}),
  material('CONTAINER',{unit:'unit',pack_qty:1,pack_spec:{unit_label:'houers van 5 L'},stock:{qty:3,date,count:{packs:3,loose:0,pack_qty:1,unit:'unit'}}}),
  material('BAGS',{unit:'unit',pack_qty:250,pack_spec:{unit_label:'sakke'},stock:{qty:1000,date,count:{packs:4,loose:0,pack_qty:250,unit:'unit'}}})
 ]};
 const rows=stocktakeSummaryRows(register,selection).rows;
 assert.deepEqual(rows.map(r=>r.countText),['2 × 250 units','52,5 kg','12,345678 kg','49 kg','3 containers (5 L)','4 × 250 bags']);
 assert.equal(rows[4].qty,3,'containers are not silently converted into litres');
});

test('39 supplier products render as one readable A4 page with one line each, including punctuation and unsupported glyphs',async()=>{
 const register={materials:Array.from({length:39},(_,i)=>material(String(i),{name:i===0?'Synthetic bags 300×450 – test →':i===1?'Synthetic powder (é)':undefined}))};
 // Fixture names must remain unique to verify that no line was dropped.
 for(const [i,m] of register.materials.entries())if(m.name===undefined)m.name='Synthetic product '+i;
 register.materials[38].stock={qty:0,date:'2026-10-13'};
 const saved={register,revision:7,saved_at:'2026-10-29T10:00:00Z'},before=structuredClone(saved);
 const pdf=await PDFDocument.load(await stocktakeSummaryPDF(saved,selection)),content=pdfText(pdf);
 assert.equal(pdf.getPageCount(),1);assert.ok(Math.abs(pdf.getPage(0).getWidth()-595.28)<.1);assert.ok(Math.abs(pdf.getPage(0).getHeight()-841.89)<.1);
 assert.match(content,/Count date: 27 Oct 2026/);assert.match(content,/38 of 39 products counted/);
 assert.match(content,/Synthetic bags 300×450 - test \[U\+2192\]/);assert.match(content,/Synthetic powder \(é\)/);
 for(let i=2;i<39;i++)assert.equal(content.split('\n').filter(x=>x==='Synthetic product '+i).length,1);
 assert.equal(content.split('\n').filter(x=>x==='Not counted').length,1);assert.doesNotMatch(content,/999/);
 assert.deepEqual(saved,before);assert.match(pdf.getSubject(),/revision 7/);
});

test('oversized single-page summaries fail clearly without dropping products or truncating names',async()=>{
 const saved={register:{materials:Array.from({length:300},(_,i)=>material(String(i)))},revision:1};
 await assert.rejects(()=>stocktakeSummaryPDF(saved,selection),/too many products for one readable A4/);
 saved.register.materials=[material('LONG',{name:'Very long synthetic material name '.repeat(20)})];
 await assert.rejects(()=>stocktakeSummaryPDF(saved,selection),/too long for one readable stocktake line/);
});
