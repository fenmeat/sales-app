import {PDFDocument,StandardFonts,rgb,PageSizes} from 'pdf-lib';
import {addDraftProducts,availableForLoad,captureItems,check,routeName,today,CASH_DENOMINATIONS} from './domain.js';

const mm=72/25.4,margin=10*mm,gap=6*mm;
const ink=rgb(.08,.11,.15),line=rgb(.48,.56,.63),blue=rgb(.9,.95,.98);
const qty=n=>n==null?'':new Intl.NumberFormat('en-ZA',{maximumFractionDigits:3}).format(n);
const printable=value=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/[\u2010-\u2015]/g,'-');
function wrap(text,font,size,width){
 const lines=[];let current='';
 for(const word of printable(text).split(/\s+/)){
  const next=current?current+' '+word:word;
  if(font.widthOfTextAtSize(next,size)<=width){current=next;continue;}
  if(current)lines.push(current);current='';
  for(const char of word){if(current&&font.widthOfTextAtSize(current+char,size)>width){lines.push(current);current='';}current+=char;}
 }
 if(current)lines.push(current);return lines.length?lines:[''];
}

export function stockPrintRows(saved,catalog,asOf=today()){
 const run=addDraftProducts(saved.run,catalog.products,{},asOf);
 const rows=captureItems(run,false,catalog.products).map(i=>({code:i.code,name:i.name,
  out:run.date>=asOf&&!availableForLoad(i,catalog.products)&&i.loaded>0?i.loaded:i.planned}));
 check(rows.some(i=>i.out!==null),'Save your planned quantities before printing.');
 return rows;
}

// Render a private, read-only PDF from persisted quantities. No DOM, network
// font, animation frame or delayed window.print call is involved.
export async function stockPrintPDF(saved,catalog){
 const rows=stockPrintRows(saved,catalog),doc=await PDFDocument.create();
 const normal=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const [width,height]=PageSizes.A4,usable=width-margin*2,columns=rows.length>20?2:1;
 const columnWidth=(usable-gap*(columns-1))/columns,productWidth=columnWidth*.66,numberWidth=columnWidth*.17;
 const perColumn=Math.ceil(rows.length/columns),groups=Array.from({length:columns},(_,n)=>rows.slice(n*perColumn,(n+1)*perColumn));
 const tableTop=height-margin-49,cashSpace=153,bottom=margin+cashSpace;
 let size,layout;
 for(size=10;size>=8;size-=.5){
  layout=groups.map(group=>group.map(row=>{const lines=wrap(row.name,normal,size,productWidth-9);return {...row,lines,height:Math.max(rows.length>40?16:22,lines.length*size*1.16+6)};}));
  if(layout.every(group=>tableTop-22-group.reduce((sum,row)=>sum+row.height,0)>=bottom))break;
 }
 check(size>=8,'The product list is too long for one readable A4 load sheet.');
 const page=doc.addPage(PageSizes.A4);
 const text=(value,x,y,fontSize=10,font=normal)=>page.drawText(printable(value),{x,y,size:fontSize,font,color:ink});
 const box=(x,y,w,h,fill)=>page.drawRectangle({x,y,width:w,height:h,borderWidth:.5,borderColor:line,...(fill?{color:fill}:{})});
 text('Stock Load & Return',margin,height-margin-17,18,bold);
 const route=catalog.routes.find(r=>r.code===saved.run.route);
 const routeLines=wrap(routeName(route,saved.run.date)||saved.run.route,bold,11,usable-120);
 check(routeLines.length===1,'Route name is too long for the load sheet.');
 text(routeLines[0],margin,height-margin-36,11,bold);
 const date=new Date(saved.run.date+'T12:00:00Z').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
 text(date,width-margin-bold.widthOfTextAtSize(date,11),height-margin-36,11,bold);
 layout.forEach((group,n)=>{
  const x=margin+n*(columnWidth+gap);let y=tableTop;
  for(const [label,offset,w] of [['Product',0,productWidth],['Out',productWidth,numberWidth],['Return',productWidth+numberWidth,numberWidth]]){box(x+offset,y-22,w,22,blue);text(label,x+offset+4,y-14,9,bold);}
  y-=22;
  for(const row of group){
   for(const [offset,w] of [[0,productWidth],[productWidth,numberWidth],[productWidth+numberWidth,numberWidth]])box(x+offset,y-row.height,w,row.height);
   row.lines.forEach((label,i)=>text(label,x+4,y-4-size-i*size*1.16,size));
   const value=qty(row.out);text(value,x+productWidth+(numberWidth-bold.widthOfTextAtSize(value,size))/2,y-row.height/2-size*.35,size,bold);
   y-=row.height;
  }
 });
 // Keep all nine quantities and the total empty for handwritten cash-up.
 const cashY=margin+20,cashHeight=122;box(margin,cashY,usable,cashHeight);
 text('Cash Count',margin+9,cashY+cashHeight-18,13,bold);
 const left=margin+9,top=cashY+cashHeight-28,pairWidth=(usable-18)/3,denomWidth=pairWidth*.38;
 for(let col=0;col<3;col++){
  const x=left+col*pairWidth;
  box(x,top-18,denomWidth,18,blue);box(x+denomWidth,top-18,pairWidth-denomWidth,18,blue);
  text('Cash',x+4,top-12,9,bold);text('Quantity',x+denomWidth+4,top-12,9,bold);
  for(let row=0;row<3;row++){
   const y=top-18-(row+1)*20,d=CASH_DENOMINATIONS[row*3+col];
   box(x,y,denomWidth,20);box(x+denomWidth,y,pairWidth-denomWidth,20);
   text(d===50?'50c':'R'+d/100,x+4,y+6,10,bold);
  }
 }
 text('Cash Counted',width-margin-230,margin+3,11,bold);text('R',width-margin-140,margin+3,11,bold);
 box(width-margin-125,margin-3,125,19);
 doc.setTitle('Fen Meat - Stock Load & Return - '+saved.run.date);doc.setAuthor('Fen Meat');
 return doc.save();
}
