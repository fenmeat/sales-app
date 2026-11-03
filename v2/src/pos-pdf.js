import {PDFDocument, StandardFonts, PageSizes, rgb} from 'pdf-lib';

export async function posReceiptPDF(sale) {
  const doc=await PDFDocument.create(),regular=await doc.embedFont(StandardFonts.Helvetica),bold=await doc.embedFont(StandardFonts.HelveticaBold);
  const ink=rgb(.06,.16,.22),money=n=>'R '+(n/100).toFixed(2),qty=n=>String(n/1000);
  const printable=value=>Array.from(String(value??'')).map(c=>{try{regular.encodeText(c);return c;}catch{return '?';}}).join('');
  let page,y;
  const text=(value,x,size=11,font=regular)=>page.drawText(printable(value),{x,y,size,font,color:ink});
  function nextPage(){page=doc.addPage(PageSizes.A4);y=800;text('FEN MEAT',36,20,bold);text('Factory POS',400,14,bold);y-=28;text(sale.number,36,13,bold);text('PAID IN FULL',400,12,bold);y-=25;}
  function ensure(height){if(y-height<45)nextPage();}
  function line(label,value){ensure(22);text(label,36);text(value,365,11,bold);y-=21;}
  function wrap(value,width,size=11){const rows=[''];for(const word of printable(value).split(/\s+/)){let remaining=word;if(rows.at(-1)&&regular.widthOfTextAtSize(rows.at(-1)+' '+word,size)<=width){rows[rows.length-1]+=' '+word;continue;}if(rows.at(-1))rows.push('');while(regular.widthOfTextAtSize(remaining,size)>width){let n=remaining.length;while(n>1&&regular.widthOfTextAtSize(remaining.slice(0,n),size)>width)n--;rows[rows.length-1]=remaining.slice(0,n);remaining=remaining.slice(n);rows.push('');}rows[rows.length-1]=remaining;}return rows;}
  nextPage();
  line('Date',new Date(sale.captured_at??sale.completed_at).toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'}));
  line('Served by',sale.actor);
  for(const row of wrap('Customer: '+sale.customer.name,520)){ensure(17);text(row,36);y-=17;}
  if(sale.customer.phone){text(sale.customer.phone,36);y-=18;}
  y-=12;text('Item / sales unit',36,11,bold);text('Qty',326,11,bold);text('Price',390,11,bold);text('Total',480,11,bold);y-=23;
  for(const item of sale.lines){const rows=wrap(item.name+' · '+item.unit,275);ensure(rows.length*16+12);text(qty(item.qty),326);text(money(item.price),385);text(money(item.total),475,11,bold);for(const row of rows){text(row,36);y-=16;}y-=9;}
  ensure(180);y-=10;line('TOTAL',money(sale.total));
  const p=sale.payment;
  line('Cash applied',money(p.cash));
  if(p.cash_tendered){line('Cash tendered',money(p.cash_tendered));line('Change',money(p.change));}
  line('Card (Capitec)',money(p.card));line('Shop2Shop',money(p.shop2shop));line('Balance due',money(0));
  for(const ref of [p.card_reference?'Card reference: '+p.card_reference:'',p.shop2shop_reference?'Shop2Shop reference: '+p.shop2shop_reference:''].filter(Boolean))for(const row of wrap(ref,520,10)){ensure(17);text(row,36,10);y-=17;}
  y-=8;ensure(20);text('Thank you for shopping at Fen Meat.',36,11,bold);
  doc.setTitle('FenMeat '+sale.number);return doc.save();
}
