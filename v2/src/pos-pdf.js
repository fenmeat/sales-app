import {PDFDocument, StandardFonts, PageSizes, rgb} from 'pdf-lib';
import {cashierName,receiptPaymentRows} from '../public/pos-receipt.js';
import {fenmeatLogo} from './fenmeat-receipt-brand.js';

// The original logo, black header/footer, blue rule and margins follow the
// approved FenMeat Official Letterhead PDF master. Presentation never changes
// a saved sale's prices, payments or accounting treatment.
export async function posReceiptPDF(sale) {
  const doc=await PDFDocument.create();
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const logo=await doc.embedPng(fenmeatLogo),[width,height]=PageSizes.A4;
  const margin=51,right=width-margin,usable=right-margin,bottom=766;
  const black=rgb(0,0,0),white=rgb(1,1,1),ink=rgb(.08,.12,.18),blue=rgb(7/255,91/255,1);
  const navy=rgb(18/255,60/255,115/255),pale=rgb(234/255,242/255,1),line=rgb(216/255,224/255,234/255);
  const money=n=>'R '+new Intl.NumberFormat('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100).replace(/[\u00a0\u202f]/g,' ');
  const printable=value=>Array.from(String(value??'').replace(/[\r\n\t]+/g,' ')).map(c=>{try{regular.encodeText(c);return c;}catch{return '?';}}).join('');
  let page,y;
  function text(value,x,top,size=11,font=regular,color=ink){page.drawText(printable(value),{x,y:height-top-size,size,font,color});}
  function aligned(value,edge,top,size=11,font=regular,color=ink){const label=printable(value);text(label,edge-font.widthOfTextAtSize(label,size),top,size,font,color);}
  function rect(x,top,w,h,color){page.drawRectangle({x,y:height-top-h,width:w,height:h,color});}
  function rule(top){page.drawLine({start:{x:margin,y:height-top},end:{x:right,y:height-top},thickness:.6,color:line});}
  function wrap(value,maxWidth,size=11,font=regular){
    const rows=[];let current='';
    for(const word of printable(value).split(/\s+/)){
      if(current&&font.widthOfTextAtSize(current+' '+word,size)<=maxWidth){current+=' '+word;continue;}
      if(current){rows.push(current);current='';}
      let rest=word;
      while(font.widthOfTextAtSize(rest,size)>maxWidth){let length=rest.length;while(length>1&&font.widthOfTextAtSize(rest.slice(0,length),size)>maxWidth)length--;rows.push(rest.slice(0,length));rest=rest.slice(length);}
      current=rest;
    }
    if(current||!rows.length)rows.push(current);
    return rows;
  }
  function nextPage(){
    page=doc.addPage(PageSizes.A4);
    rect(0,0,width,110.55,black);rect(0,110.55,width,4.82,blue);
    page.drawImage(logo,{x:margin,y:height-24.09-65.20,width:230.58,height:65.20});
    aligned('SALES RECEIPT',right,29,18,bold,white);
    aligned('Factory POS',right,56,11,regular,white);
    aligned(sale.number,right,78,12,bold,white);
    y=136;
  }
  function tableHeader(){
    rect(margin,y,usable,28,navy);
    text('ITEM / SALES UNIT',margin+9,y+8,9,bold,white);
    aligned('QTY',356,y+8,9,bold,white);aligned('UNIT PRICE',444,y+8,9,bold,white);aligned('AMOUNT',right-9,y+8,9,bold,white);
    y+=28;
  }
  nextPage();
  rect(margin,y,usable,54,pale);
  text('DATE & TIME',margin+12,y+9,9,bold);text('SERVED BY',316,y+9,9,bold);
  const stamp=new Date(sale.captured_at??sale.completed_at);
  const date=stamp.toLocaleDateString('en-GB',{timeZone:'Africa/Johannesburg',day:'2-digit',month:'short',year:'numeric'});
  const time=stamp.toLocaleTimeString('en-GB',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  text(date+'  '+time,margin+12,y+28,11,bold);text(cashierName(sale.actor),316,y+28,11,bold);
  y+=70;text('CUSTOMER',margin,y,9,bold);y+=17;
  for(const row of wrap(sale.customer.name,usable,11,bold)){text(row,margin,y,11,bold);y+=15;}
  if(sale.customer.phone){text(sale.customer.phone,margin,y,10);y+=15;}
  y+=20;tableHeader();
  for(const [index,item] of sale.lines.entries()){
    const names=wrap(item.name,235,10.5,bold),units=wrap(item.unit,235,9.5),rowHeight=(names.length+units.length)*15+16;
    if(y+rowHeight>bottom){nextPage();tableHeader();}
    if(index%2===0)rect(margin,y,usable,rowHeight,rgb(.965,.972,.982));
    let rowY=y+8;
    for(const row of names){text(row,margin+9,rowY,10.5,bold);rowY+=15;}
    for(const row of units){text(row,margin+9,rowY,9.5);rowY+=15;}
    aligned(String(item.qty/1000),356,y+8,10.5);
    aligned(money(item.price),444,y+8,10.5);aligned(money(item.total),right-9,y+8,10.5,bold);
    y+=rowHeight;rule(y);
  }
  const payment=sale.payment,rows=receiptPaymentRows(payment);
  const refs=[payment.card>0&&payment.card_reference?'Card reference: '+payment.card_reference:'',payment.shop2shop>0&&payment.shop2shop_reference?'Shop2Shop reference: '+payment.shop2shop_reference:'']
    .filter(Boolean).flatMap(value=>wrap(value,usable,10));
  const summaryHeight=20+58+22+rows.length*22+(refs.length?14+refs.length*15:0)+31;
  if(y+summaryHeight>bottom)nextPage();
  y+=20;rect(margin,y,usable,44,navy);text('TOTAL PAID',margin+12,y+13,12,bold,white);aligned(money(sale.total),right-12,y+10,17,bold,white);y+=58;
  text('PAID IN FULL',margin,y,10,bold,navy);text('PAYMENT',316,y,9,bold);y+=22;
  for(const row of rows){text(row.label,316,y,10.5);aligned(money(row.amount),right,y,11,bold);y+=22;}
  if(refs.length){y+=14;for(const row of refs){text(row,margin,y,10);y+=15;}}
  y+=20;text('Thank you for shopping at Fen Meat.',margin,y,11,bold);
  for(const [index,p] of doc.getPages().entries()){
    page=p;rect(0,height-51,width,51,black);
    text('FOURFORONE (PTY) LTD t/a FEN MEAT',margin,height-37,8,bold,white);
    text('Voorbaai, Mossel Bay | Quality is our Priority',margin,height-22,8,regular,white);
    aligned('PAGE '+(index+1)+' OF '+doc.getPageCount(),right,height-30,8,bold,white);
  }
  doc.setTitle('FenMeat Sales Receipt - '+sale.number);doc.setAuthor('Fourforone (Pty) Ltd t/a Fen Meat');
  return doc.save();
}
