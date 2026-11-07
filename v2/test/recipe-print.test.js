import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import {recipeStaffPDF,recipePrintData,recipeQuantity} from '../src/recipe-print-pdf.js';
import {printPageOptions,browserPrintURL} from '../public/print-page-options.js';

import {fixture,pdfText} from './recipe-print-fixture.js';

test('every saved staff sheet is a single A4 page; only Vienna groups have a half column',async()=>{
 for(const group of ['TEST','POLONY','RUSSIAN','R06','V01','V02']){
  const saved=fixture(group,group==='TEST'?11:6),before=structuredClone(saved),half=['V01','V02'].includes(group);
  const pdf=await PDFDocument.load(await recipeStaffPDF(saved,{group,version:2})),text=await pdfText(pdf);
  assert.equal(pdf.getPageCount(),1);assert.equal(pdf.getPage(0).getWidth(),595.28);assert.equal(pdf.getPage(0).getHeight(),841.89);
  assert.equal(text.includes('HALF BATCH'),half);assert.ok(text.includes(half?'25.010 kg':'100.020 kg')||text.includes('50.020 kg'));
  assert.match(text,/20 g/);assert.match(text,/Butcher's Red colour/);assert.match(text,/TOTAL MIX/);
  assert.doesNotMatch(text,/PRIVATE_|CASING|Price|trolley|Weigh colour|curing/i);
  assert.deepEqual(saved,before);
 }
 assert.equal(recipeQuantity(.03,'kg',.5),'15 g');assert.equal(recipeQuantity(.4,'kg'),'400 g');assert.equal(recipeQuantity(3,'kg',.5),'1,5 kg');
});
test('review and incomplete recipes retain their status independently of costing',async()=>{
 const saved=fixture(),selection={group:'TEST',version:2};
 saved.register.recipes[0].ingredients[0].status='estimate';
 assert.equal(recipePrintData(saved,selection).status,'NEEDS REVIEW');
 assert.match(await pdfText(await PDFDocument.load(await recipeStaffPDF(saved,selection))),/NEEDS REVIEW/);
 saved.register.recipes[0].status='historical';assert.equal(recipePrintData(saved,selection).status,'HISTORICAL RECIPE');
 assert.throws(()=>recipePrintData(saved,{group:'TEST',version:3}),/could not be found/);
 await assert.rejects(()=>recipeStaffPDF(fixture('TEST',80),selection),/too many ingredients/);
});
test('recipe browser handoff pins recipe version and register revision without copying credentials',()=>{
 const link=browserPrintURL('/api/print/recipe?group=V01&version=2&revision=7&token=PRIVATE');
 const options=printPageOptions(link.split('?')[1]);
 assert.equal(options.url,'/api/print/recipe?group=V01&version=2&revision=7');assert.equal(options.returnPath,'/recipes');assert.equal(options.fitPage,true);
 assert.equal(options.filename,'FenMeat-Recipe-V01-v2-r7.pdf');assert.doesNotMatch(link,/PRIVATE|token/);
 for(const change of [{group:'<script>'},{group:''},{version:'0'},{version:'1e2'},{revision:'0'},{revision:'9007199254740992'}])assert.throws(()=>printPageOptions(new URLSearchParams({document:'recipe',group:'V01',version:'2',revision:'7',...change})));
});
