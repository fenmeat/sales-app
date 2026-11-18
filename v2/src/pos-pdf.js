import {PDFDocument, StandardFonts, PageSizes, rgb} from 'pdf-lib';
import {cashierName,receiptPaymentRows} from '../public/pos-receipt.js';

// The compact white/royal-blue/navy identity follows the approved 13 November
// 2026 FenMeat PDF masters. Presentation never changes a saved sale's prices,
// payments or accounting treatment; historical receipts use this renderer too.
export async function posReceiptPDF(sale) {
  const doc=await PDFDocument.create();
  const regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const [width,height]=PageSizes.A4;
  const margin=33,right=width-margin,usable=right-margin,bottom=776;
  const white=rgb(1,1,1),ink=rgb(28/255,46/255,66/255),blue=rgb(14/255,85/255,216/255);
  const navy=rgb(16/255,44/255,79/255),muted=rgb(94/255,113/255,136/255),pale=rgb(236/255,242/255,248/255),line=rgb(207/255,220/255,234/255);
  const qtyEdge=378,priceEdge=466,amountEdge=right-9,paymentLeft=322;
  const money=n=>'R '+new Intl.NumberFormat('en-ZA',{minimumFractionDigits:2,maximumFractionDigits:2}).format(n/100).replace(/[\u00a0\u202f]/g,' ');
  const printable=value=>Array.from(String(value??'').replace(/[\r\n\t]+/g,' ')).map(c=>{try{regular.encodeText(c);return c;}catch{return '?';}}).join('');
  let page,y;
  function text(value,x,top,size=11,font=regular,color=ink){page.drawText(printable(value),{x,y:height-top-size,size,font,color});}
  function aligned(value,edge,top,size=11,font=regular,color=ink){const label=printable(value);text(label,edge-font.widthOfTextAtSize(label,size),top,size,font,color);}
  function rect(x,top,w,h,color){page.drawRectangle({x,y:height-top-h,width:w,height:h,color});}
  function rule(top,color=line,thickness=.6){page.drawLine({start:{x:margin,y:height-top},end:{x:right,y:height-top},thickness,color});}
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
    text('FEN',margin,19,27,bold,blue);
    text(' MEAT',margin+bold.widthOfTextAtSize('FEN',27),19,27,bold,navy);
    text('QUALITY IS OUR PRIORITY',margin+1,52,7.3,regular,muted);
    aligned('SALES RECEIPT',right,20,13,bold,navy);
    const numberSize=Math.min(18,240/bold.widthOfTextAtSize(printable(sale.number),1));
    aligned(sale.number,right,39,numberSize,bold,blue);
    aligned('Factory POS',right,63,8,regular,muted);
    rule(79,blue,1.8);
    y=96;
  }
  function tableHeader(){
    rect(margin,y,usable,28,navy);
    text('ITEM / SALES UNIT',margin+9,y+8,9,bold,white);
    aligned('QTY',qtyEdge,y+8,9,bold,white);aligned('UNIT PRICE',priceEdge,y+8,9,bold,white);aligned('AMOUNT',amountEdge,y+8,9,bold,white);
    y+=28;
  }
  nextPage();
  const stamp=new Date(sale.captured_at??sale.completed_at);
  const date=stamp.toLocaleDateString('en-GB',{timeZone:'Africa/Johannesburg',day:'2-digit',month:'short',year:'numeric'});
  const time=stamp.toLocaleTimeString('en-GB',{timeZone:'Africa/Johannesburg',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const fields=[['DATE',date],['TIME',time],['SERVED BY',cashierName(sale.actor)],['STATUS','Paid in full']];
  fields.forEach(([label,value],i)=>{
    const x=margin+i*usable/4;
    if(i)page.drawLine({start:{x:x-10,y:height-y+3},end:{x:x-10,y:height-y-30},thickness:.6,color:line});
    text(label,x+2,y,7.5,regular,muted);text(value,x+2,y+16,10.5,bold,ink);
  });
  y+=44;
  const panelWidth=(usable-14)/2,customerRows=wrap(sale.customer.name,panelWidth-20,11,bold);
  const panelHeight=Math.max(77,37+customerRows.length*15+(sale.customer.phone?15:0));
  rect(margin,y,panelWidth,panelHeight,pale);rect(margin+panelWidth+14,y,panelWidth,panelHeight,pale);
  text('CUSTOMER',margin+10,y+10,8,bold,navy);
  customerRows.forEach((row,i)=>text(row,margin+10,y+28+i*15,11,bold));
  if(sale.customer.phone)text(sale.customer.phone,margin+10,y+28+customerRows.length*15,10);
  const issuerX=margin+panelWidth+24;
  text('ISSUED BY',issuerX,y+10,8,bold,navy);
  text('Fourforone (Pty) Ltd t/a Fen Meat',issuerX,y+28,10.5,bold);
  text('21C Mascador Street, Voorbaai',issuerX,y+44,9.5);
  text('Mossel Bay, 6500',issuerX,y+58,9.5);
  y+=panelHeight+16;tableHeader();
  for(const [index,item] of sale.lines.entries()){
    const names=wrap(item.name,265,10.5,bold),units=wrap(item.unit,265,9.5),rowHeight=(names.length+units.length)*15+16;
    if(y+rowHeight>bottom){nextPage();tableHeader();}
    if(index%2===0)rect(margin,y,usable,rowHeight,rgb(.965,.972,.982));
    let rowY=y+8;
    for(const row of names){text(row,margin+9,rowY,10.5,bold);rowY+=15;}
    for(const row of units){text(row,margin+9,rowY,9.5);rowY+=15;}
    aligned(String(item.qty/1000),qtyEdge,y+8,10.5);
    aligned(money(item.price),priceEdge,y+8,10.5);aligned(money(item.total),amountEdge,y+8,10.5,bold);
    y+=rowHeight;rule(y);
  }
  const payment=sale.payment,rows=receiptPaymentRows(payment);
  const refs=[payment.card>0&&payment.card_reference?'Card reference: '+payment.card_reference:'',payment.shop2shop>0&&payment.shop2shop_reference?'Shop2Shop reference: '+payment.shop2shop_reference:'']
    .filter(Boolean).flatMap(value=>wrap(value,usable,10));
  const summaryHeight=20+58+22+rows.length*22+(refs.length?14+refs.length*15:0)+31;
  if(y+summaryHeight>bottom)nextPage();
  y+=20;rect(margin,y,usable,44,navy);text('TOTAL PAID',margin+12,y+13,12,bold,white);aligned(money(sale.total),right-12,y+10,17,bold,white);y+=58;
  text('PAID IN FULL',margin,y,10,bold,navy);text('PAYMENT',paymentLeft,y,9,bold);y+=22;
  for(const row of rows){text(row.label,paymentLeft,y,10.5);aligned(money(row.amount),right,y,11,bold);y+=22;}
  if(refs.length){y+=14;for(const row of refs){text(row,margin,y,10);y+=15;}}
  y+=20;text('Thank you for shopping at Fen Meat.',margin,y,11,bold);
  for(const [index,p] of doc.getPages().entries()){
    page=p;rule(height-47,blue,.8);
    text('FOURFORONE (PTY) LTD t/a FEN MEAT',margin,height-36,8.1,bold,navy);
    text('Voorbaai, Mossel Bay | Quality is our Priority',margin,height-23,7,regular,muted);
    aligned('PAGE '+(index+1)+' OF '+doc.getPageCount(),right,height-30,7.6,bold,navy);
  }
  doc.setTitle('FenMeat Sales Receipt - '+sale.number);doc.setAuthor('Fourforone (Pty) Ltd t/a Fen Meat');
  return doc.save();
}
