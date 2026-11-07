import {PDFDocument,PageSizes,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {regular,bold as boldBytes} from './recipe-fonts.js';
import {check} from './domain.js';

const amount=value=>Number(value.toFixed(6)).toLocaleString('en-ZA',{maximumFractionDigits:6}).replace(/[\u00a0\u202f]/g,' ');
export function recipeQuantity(qty,unit,factor=1){
 const value=qty*factor;
 return unit==='kg'&&value>0&&value<1?amount(value*1000)+' g':amount(value)+' '+unit;
}

export function recipePrintData(saved,{group,version}){
 const recipe=saved.register?.recipes?.find(r=>r.group===group&&r.version===version);
 check(recipe,'This saved recipe version could not be found. Reload Recipes and try again.',404);
 check(recipe.ingredients?.length>0,'This recipe has no saved ingredients.');
 const materials=new Map(saved.register.materials.map(m=>[m.id,m]));
 const rows=recipe.ingredients.map(line=>{
  const material=materials.get(line.material);
  check(material&&Number.isFinite(line.qty)&&line.qty>0&&line.unit===material.unit,'A saved ingredient needs review before this recipe can be printed.');
  // RM25 is the existing colour used in the owner's approved staff sheet.
  const name=line.material==='RM25'&&material.name==='Dye Red'?"Butcher's Red colour":material.name;
  return {name,qty:line.qty,unit:line.unit,status:line.status};
 });
 const review=recipe.status!=='approved'||!recipe.complete||rows.some(l=>l.status!=='approved');
 const status=recipe.status==='historical'?'HISTORICAL RECIPE':review?'NEEDS REVIEW':'APPROVED RECIPE';
 return {recipe,rows,half:['V01','V02'].includes(recipe.group),status,review};
}

// Staff sheets contain ingredients only. Manufacturing casings, prices, source
// notes and packing yields are intentionally not part of the mixture table.
export async function recipeStaffPDF(saved,selection){
 const {recipe,rows,half,status,review}=recipePrintData(saved,selection);
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);
 const decode=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
 const normal=await doc.embedFont(decode(regular),{subset:true}),bold=await doc.embedFont(decode(boldBytes),{subset:true});
 const printable=value=>[...String(value??'').replace(/[\r\n\t\u00a0\u202f]+/g,' ')].map(char=>{
  try{normal.encodeText(char);return char;}catch{return '[U+'+char.codePointAt(0).toString(16).toUpperCase()+']';}
 }).join('');
 const [width,height]=PageSizes.A4,margin=42,usable=width-2*margin;
 const navy=rgb(.082,.208,.294),ink=rgb(.10,.17,.20),white=rgb(1,1,1),pale=rgb(.933,.957,.969);
 const page=doc.addPage(PageSizes.A4);
 const text=(value,x,y,size=14,font=normal,color=ink)=>page.drawText(printable(value),{x,y,size,font,color});
 const rect=(x,y,w,h,color)=>page.drawRectangle({x,y,width:w,height:h,color});
 function fit(value,font,size,maxWidth,min=10){
  const label=printable(value);while(size>=min&&font.widthOfTextAtSize(label,size)>maxWidth)size-=.25;
  check(size>=min,'A recipe label is too long for one readable A4 page. Shorten the saved label before printing.');return {label,size};
 }
 function wrap(value,size,maxWidth){
  const words=printable(value).split(/\s+/),lines=[];let line='';
  for(const word of words){
   if(normal.widthOfTextAtSize(word,size)>maxWidth)return null;
   const next=line?line+' '+word:word;
   if(line&&normal.widthOfTextAtSize(next,size)>maxWidth){lines.push(line);line=word;}else line=next;
  }
  if(line)lines.push(line);return lines;
 }
 const numberWidth=half?113:170,nameWidth=usable-numberWidth*(half?2:1),tableTop=height-183,headHeight=37,totalHeight=44;
 const available=tableTop-headHeight-totalHeight-91;
 let layout,size;
 for(size=15;size>=11;size-=.5){
  const candidate=rows.map(row=>({...row,lines:wrap(row.name,size,nameWidth-26)}));
  if(candidate.some(row=>!row.lines))continue;
  candidate.forEach(row=>row.height=Math.max(34,row.lines.length*(size+3)+18));
  if(candidate.reduce((sum,row)=>sum+row.height,0)<=available){layout=candidate;break;}
 }
 check(layout,'This recipe has too many ingredients for one readable A4 page.');
 const extra=Math.min(10,(available-layout.reduce((sum,row)=>sum+row.height,0))/rows.length);
 layout.forEach(row=>row.height+=extra);
 rect(0,height-110,width,110,navy);
 text('FENMEAT',margin,height-38,25,bold,white);
 text('STAFF RECIPE SHEET',margin,height-56,9,normal,white);
 const title=fit(recipe.name,bold,21,usable,12);text(title.label,margin,height-85,title.size,bold,white);
 text(half?'Full and half batches':'One full batch',margin,height-101,10,normal,white);
 rect(margin,height-164,usable,35,review?rgb(1,.95,.83):rgb(.90,.96,.91));
 text(status,margin+12,height-150,10,bold);
 const detail=fit('v'+recipe.version+'  |  Effective '+recipe.effective_date,normal,10,usable-170,8);
 text(detail.label,width-margin-12-normal.widthOfTextAtSize(detail.label,detail.size),height-150,detail.size);
 rect(margin,tableTop-headHeight,usable,headHeight,navy);
 text('INGREDIENT',margin+13,tableTop-24,10,bold,white);
 const centers=[margin+nameWidth+numberWidth/2,...(half?[margin+nameWidth+numberWidth*1.5]:[])];
 for(const [i,label] of (half?['FULL BATCH','HALF BATCH']:['ONE FULL BATCH']).entries())text(label,centers[i]-bold.widthOfTextAtSize(label,10)/2,tableTop-24,10,bold,white);
 let y=tableTop-headHeight;
 for(const [i,row] of layout.entries()){
  if(i%2===0)rect(margin,y-row.height,usable,row.height,pale);
  const first=y-row.height/2+(row.lines.length-1)*(size+3)/2-size*.35;
  row.lines.forEach((line,j)=>text(line,margin+13,first-j*(size+3),size));
  for(const [j,factor] of (half?[1,.5]:[1]).entries()){
   const label=fit(recipeQuantity(row.qty,row.unit,factor),normal,size,numberWidth-16,10);
   text(label.label,centers[j]-normal.widthOfTextAtSize(label.label,label.size)/2,y-row.height/2-label.size*.35,label.size);
  }
  y-=row.height;
 }
 rect(margin,y-totalHeight,usable,totalHeight,navy);
 text('TOTAL MIX',margin+13,y-28,14,bold,white);
 for(const [j,factor] of (half?[1,.5]:[1]).entries()){
  const label=fit((recipe.batch_kg*factor).toFixed(3)+' kg',bold,half?14:18,numberWidth-16,11);
  text(label.label,centers[j]-bold.widthOfTextAtSize(label.label,label.size)/2,y-28,label.size,bold,white);
 }
 page.drawLine({start:{x:margin,y:65},end:{x:width-margin,y:65},thickness:.5,color:rgb(.78,.83,.86)});
 text('FENMEAT  |  '+recipe.group+'  |  Saved register '+saved.revision,margin,49,8);
 text('Page 1 of 1',width-margin-normal.widthOfTextAtSize('Page 1 of 1',8),49,8);
 doc.setTitle('FenMeat - '+printable(recipe.name)+' - v'+recipe.version);doc.setAuthor('FenMeat');
 doc.setSubject('Staff recipe sheet; saved register '+saved.revision+'; recipe '+recipe.group+' v'+recipe.version);
 return doc.save();
}
