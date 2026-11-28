import {PDFDocument,StandardFonts,rgb,PageSizes} from 'pdf-lib';
import {check,shopDeliveryRows,dateKey} from './domain.js';

const margin=23,gap=12,ink=rgb(.06,.14,.2),line=rgb(.42,.49,.54),blue=rgb(.89,.95,.98);
const printable=value=>String(value??'').replace(/[\r\n\t]+/g,' ').replace(/[\u2010-\u2015]/g,'-');
function wrap(value,font,size,width){
 const result=[];let current='';
 for(const word of printable(value).split(/\s+/)){
  const next=current?current+' '+word:word;
  if(font.widthOfTextAtSize(next,size)<=width){current=next;continue;}
  if(current)result.push(current);current='';
  for(const char of word){if(current&&font.widthOfTextAtSize(current+char,size)>width){result.push(current);current='';}current+=char;}
 }
 if(current)result.push(current);return result.length?result:[''];
}
// Exactly one A4 page. Never drop shops, truncate names or create a second page.
export async function shopListPDF(list){
 dateKey(list.date);const rows=shopDeliveryRows(list.rows);check(rows.length>0&&rows.length<=250,'No printable shop list.');
 const doc=await PDFDocument.create(),normal=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
 const [width,height]=PageSizes.A4,usable=width-2*margin,top=height-margin-57,bottom=margin+25,header=25;
 let chosen;
 for(const columns of rows.length<=40?[1,2,3,4,5]:[2,3,4,5]){
  const columnWidth=(usable-gap*(columns-1))/columns,stopWidth=columns>=5?20:columns>2?24:28,countWidth=columns>2?36:46,nameWidth=columnWidth-stopWidth-countWidth;
  const perColumn=Math.ceil(rows.length/columns);
  for(let size=10;size>=7;size-=.25){
   const groups=Array.from({length:columns},(_,n)=>rows.slice(n*perColumn,(n+1)*perColumn).map(s=>({...s,lines:wrap(s.name,normal,size,nameWidth-7)})));
   const heights=groups.map(group=>group.map(s=>Math.max(11.3,s.lines.length*(size+1)+3)));
   if(heights.every(group=>group.reduce((n,h)=>n+h,0)<=top-header-bottom)){
    chosen={columns,columnWidth,stopWidth,countWidth,nameWidth,size,groups,heights};break;
   }
  }
  if(chosen)break;
 }
 check(chosen,'This shop list cannot fit legibly on one A4 page. Shorten the shop display names before printing. No shops were omitted.');
 const {columnWidth,stopWidth,countWidth,nameWidth,size,groups,heights}=chosen,page=doc.addPage(PageSizes.A4);
 const text=(value,x,y,n=10,font=normal)=>page.drawText(printable(value),{x,y,size:n,font,color:ink});
 const box=(x,y,w,h,fill)=>page.drawRectangle({x,y,width:w,height:h,borderColor:line,borderWidth:.45,...(fill?{color:fill}:{})});
 text('FEN MEAT',margin,height-margin-15,16,bold);text('SHOP LIST',width-margin-85,height-margin-14,13,bold);
 const route=printable(list.route_name||list.route);let routeSize=11;while(bold.widthOfTextAtSize(route,routeSize)>usable-95&&routeSize>7)routeSize-=.25;
 check(bold.widthOfTextAtSize(route,routeSize)<=usable-95,'Route name is too long.');
 text(route,margin,height-margin-31,routeSize,bold);text(list.date,width-margin-65,height-margin-31,10,bold);
 text('Rep: ______________________    Vehicle: ______________________',margin,height-margin-47,9);
 groups.forEach((group,col)=>{
  const x=margin+col*(columnWidth+gap);let y=top;
  box(x,y-header,stopWidth,header,blue);box(x+stopWidth,y-header,nameWidth,header,blue);box(x+stopWidth+nameWidth,y-header,countWidth,header,blue);
  text('Stop',x+3,y-16,8,bold);text('Shop',x+stopWidth+3,y-16,9,bold);
  text('Items',x+stopWidth+nameWidth+3,y-10,7.5,bold);text('delivered',x+stopWidth+nameWidth+3,y-20,7.5,bold);y-=header;
  group.forEach((shop,i)=>{const h=heights[col][i];
   box(x,y-h,stopWidth,h);box(x+stopWidth,y-h,nameWidth,h);box(x+stopWidth+nameWidth,y-h,countWidth,h);
   const stop=String(shop.stop).padStart(3,'0');text(stop,x+3,y-h/2-size*.35,Math.min(size,9));
   shop.lines.forEach((label,j)=>text(label,x+stopWidth+3,y-2-size-j*(size+1),size));
   // Deliberately blank even when saved physical counts or invoice totals exist.
   y-=h;
  });
 });
 text(rows.length+' shops  |  Count bags / sales units as physically delivered.',margin,margin+11,8);
 text('Total items: ______________',width-margin-132,margin+11,9,bold);
 text('Read down each column, then continue at the top of the next.  |  '+(list.run_revision?'Route revision '+list.run_revision:'Shop list revision '+list.catalog_revision),margin,margin-2,7);
 doc.setTitle('Fen Meat - Shop List - '+route+' - '+list.date);doc.setAuthor('Fen Meat');
 return doc.save();
}
