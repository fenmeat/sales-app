import {PDFDocument,StandardFonts,PageSizes,rgb} from 'pdf-lib';
import {productionPlanningView} from './production.js';
import {routeName} from './domain.js';
import {productionStaffModel} from '../public/production-staff-print.js';

// Reuse the staff-sheet decisions and label rules. Printing never refreshes
// demand, substitutes forecasts for My plan, or writes production records.
export async function productionStaffPDF(saved,catalog){
 const p=saved.plan,m=productionStaffModel(productionPlanningView(p,catalog));
 const doc=await PDFDocument.create(),font=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const [width,height]=PageSizes.A4,margin=28,gap=14,usable=width-2*margin,bottom=margin+12;
 const ink=rgb(.08,.14,.19),line=rgb(.48,.56,.63),blue=rgb(.90,.95,.98);
 const printable=value=>[...String(value??'').replace(/[\u2010-\u2015]/g,'-').replace(/\t/g,' ')].map(c=>{
  if(c==='\n'||c==='\r')return c;
  try{font.encodeText(c);return c;}catch{return '[U+'+c.codePointAt(0).toString(16).toUpperCase()+']';}
 }).join('');
 const wrap=(value,size,w,f=font)=>{
  const lines=[];
  for(const paragraph of printable(value).split(/\r?\n/)){
   let current='';
   for(const word of paragraph.split(/\s+/).filter(Boolean)){
    const candidate=current?current+' '+word:word;
    if(f.widthOfTextAtSize(candidate,size)<=w){current=candidate;continue;}
    if(current)lines.push(current);current='';
    for(const char of word){if(current&&f.widthOfTextAtSize(current+char,size)>w){lines.push(current);current='';}current+=char;}
   }
   lines.push(current);
  }
  return lines;
 };
 const num=n=>n==null?'?':new Intl.NumberFormat('en-ZA',{maximumFractionDigits:3}).format(n);
 const products=m.rows.map(r=>({recipe:r.manufactureOnly,group:r.group,cells:[r.name+(r.review?' *':'')+(r.note?'\n'+r.note:''),r.make.replace(/ batch(?:es)?$/,''),r.manufactureOnly?'-':num(r.pack),r.manufactureOnly?'-':num(r.labels),r.manufactureOnly?'-':'']}));
 const trolleys=m.trolleys.map(r=>({cells:[String(r.number),...r.slots.map(s=>s.id?s.label:'-'),r.show_casings?[r.casings.P02,r.casings.P03,r.casings.P04].map(num).join(' / '):'-']}));
 const productHeads=['Product','Make','Pack','Labels','Actual'],productFractions=[.40,.17,.12,.155,.155];
 const trolleyHeads=['#','Batch 1','Batch 2','Casings S / M / L'],trolleyFractions=[.06,.32,.32,.30];
 const key='Pack / Actual: finished sales units. Actual is for handwriting. Labels: packet labels + outer-bag label. Make: batches unless casings or cut rolls are stated. Shared recipes are made once across all sizes.';
 const review=m.review.length||m.trolleyReview?'* Review marked plans in the app before work. ? = quantity not yet set or label rule needs checking.':'';
 const notes=[...(p.notes?['Notes: '+p.notes]:[]),key,...(review?[review]:[])];
 const routes=p.routes.map(code=>routeName(catalog.routes.find(r=>r.code===code),p.target_date)||code).join(' + ');
 const routeLines=wrap(routes,10,usable,bold),top=height-margin-67-routeLines.length*12;
 const measure=(rows,size,w,fractions)=>rows.map(r=>{
  const cells=r.cells.map((v,i)=>wrap(v,size,w*fractions[i]-8,r.recipe?bold:font));
  return {...r,lines:cells,h:Math.max(22,Math.max(...cells.map(c=>c.length))*size*1.16+8)};
 });
 const tableHeight=rows=>22+rows.reduce((sum,r)=>sum+r.h,0);
 const balanced=rows=>{
  if(rows.length<2)return [rows,[]];
  let best=null,score=Infinity;
  for(let i=1;i<rows.length;i++){
   if(rows[i-1].recipe&&rows[i-1].group===rows[i].group)continue;
   const pair=[rows.slice(0,i),rows.slice(i)],h=Math.max(...pair.map(tableHeight));
   if(h<score){score=h;best=pair;}
  }
  return best??[rows,[]];
 };
 const col=(usable-gap)/2;
 let size=10,columns,tr,paragraphs,fits=false;
 for(size of [10,9,8.5]){
  columns=balanced(measure(products,size,col,productFractions));tr=measure(trolleys,size,usable,trolleyFractions);
  paragraphs=notes.map(n=>wrap(n,size,usable));
  const needed=(products.length?Math.max(...columns.map(tableHeight)):24)+14+24+(tr.length?tableHeight(tr):22)+8+(wrap('S = Small. M = Medium. L = Long. Numbers are casings on that trolley.',size,usable).length*size*1.2+8)+paragraphs.reduce((sum,ls)=>sum+ls.length*size*1.2+8,0);
  if(top-needed>=bottom){fits=true;break;}
 }
 let page,y;
 const text=(value,x,at,s=size,f=font)=>page.drawText(printable(value),{x,y:at,size:s,font:f,color:ink});
 const newPage=()=>{
  page=doc.addPage(PageSizes.A4);
  text('Production & Packing',margin,height-margin-18,18,bold);
  text('FEN MEAT',width-margin-bold.widthOfTextAtSize('FEN MEAT',10),height-margin-16,10,bold);
  routeLines.forEach((l,i)=>text(l,margin,height-margin-36-i*12,10,bold));
  const context=height-margin-36-routeLines.length*12;
  text('Production: '+p.date+'    Route date: '+p.target_date,margin,context,10,bold);
  text(p.phase.toUpperCase()+' | Saved revision '+saved.revision,margin,context-15,9);
  y=top;
 };
 const row=(r,x,at,w,fractions,header=false)=>{
  let offset=0;
  fractions.forEach((fraction,i)=>{
   const cellWidth=w*fraction;
   page.drawRectangle({x:x+offset,y:at-r.h,width:cellWidth,height:r.h,borderWidth:.5,borderColor:line,...(header||r.recipe?{color:blue}:{})});
   r.lines[i].forEach((l,n)=>text(l,x+offset+4,at-4-size-n*size*1.16,size,header||r.recipe?bold:font));
   offset+=cellWidth;
  });
  return at-r.h;
 };
 const heading=(heads,w,fractions)=>({h:22,lines:heads.map((v,i)=>wrap(v,size,w*fractions[i]-8,bold))});
 const table=(rows,x,at,w,fractions,heads)=>{
  let yy=row(heading(heads,w,fractions),x,at,w,fractions,true);
  for(const r of rows)yy=row(r,x,yy,w,fractions);
  return yy;
 };
 const paragraph=value=>{
  for(const l of wrap(value,size,usable)){
   if(y-size*1.2<bottom)newPage();
   text(l,margin,y-size);y-=size*1.2;
  }
  y-=8;
 };
 const pagedTable=(rows,fractions,heads)=>{
  let started=false;
  for(let i=0;i<rows.length;i++){
   const r=rows[i],next=r.recipe&&rows[i+1]?.group===r.group?rows[i+1].h:0;
   if(y-r.h-next-(started?0:22)<bottom){newPage();started=false;}
   if(!started){y=row(heading(heads,usable,fractions),margin,y,usable,fractions,true);started=true;}
   y=row(r,margin,y,usable,fractions);
  }
 };
 newPage();
 if(products.length){
  if(fits)y=Math.min(...columns.filter(c=>c.length).map((c,i)=>table(c,margin+i*(col+gap),y,col,productFractions,productHeads)));
  else pagedTable(measure(products,size,usable,productFractions),productFractions,productHeads);
 }else paragraph('No manufacturing or packing work selected in this saved plan.');
 y-=14;
 if(y-24-22-(tr[0]?.h??22)<bottom)newPage();
 text('Production trolley plan'+(m.trolleyReview?' *':''),margin,y-12,12,bold);y-=24;
 if(tr.length)pagedTable(tr,trolleyFractions,trolleyHeads);else paragraph('No trolley selections saved.');
 y-=8;paragraph('S = Small. M = Medium. L = Long. Numbers are casings on that trolley.');
 for(const n of notes)paragraph(n);
 doc.getPages().forEach((p,i)=>p.drawText('Page '+(i+1)+' of '+doc.getPageCount(),{x:margin,y:margin-5,font,size:8,color:ink}));
 doc.setTitle('Fen Meat - Production staff sheet - '+p.date);doc.setAuthor('Fen Meat');
 return doc.save();
}
