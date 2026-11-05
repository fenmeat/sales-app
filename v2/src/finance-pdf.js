import {PDFDocument,rgb,PageSizes} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import {regular,bold as boldFont} from './recipe-fonts.js';
import {FINANCE_TYPES,money,recordTitle,matchesFinanceFilter} from './finance-domain.js';
import {check} from './domain.js';
export async function financePDF(state,query={}){
 const type=query.type||'account';check(FINANCE_TYPES[type],'Choose a financial report.');
 const rows=state.records.filter(r=>r.type===type&&(query.filter==='Archived'?r.data.archived:!r.data.archived)).filter(r=>!query.month||(r.data.month||r.data.date?.slice(0,7))===query.month).filter(r=>!query.from||(r.data.date||r.data.due_date||'')>=query.from).filter(r=>!query.to||(r.data.date||r.data.due_date||'')<=query.to).filter(r=>!query.q||JSON.stringify(r.data).toLowerCase().includes(query.q.toLowerCase())).filter(r=>matchesFinanceFilter(r,state.summaries[r.id]||{},query.filter));
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));const normal=await doc.embedFont(bytes(regular),{subset:true}),bold=await doc.embedFont(bytes(boldFont),{subset:true});
 let page,y;const [width,height]=PageSizes.A4,margin=32,ink=rgb(.06,.17,.27);
 const wrap=(text,size=10,font=normal)=>{const lines=[];let line='';for(const word of String(text??'').replace(/[\r\n\t]+/g,' ').split(/\s+/)){if(font.widthOfTextAtSize((line?line+' ':'')+word,size)>width-2*margin&&line){lines.push(line);line='';}for(const char of word){if(font.widthOfTextAtSize(line+char,size)>width-2*margin){lines.push(line);line='';}line+=char;}line+=' ';}if(line.trim())lines.push(line.trim());return lines;};
 const next=()=>{page=doc.addPage(PageSizes.A4);y=height-margin;page.drawText('FEN MEAT',{x:margin,y:y-18,font:bold,size:19,color:ink});y-=40;page.drawText(FINANCE_TYPES[type].title,{x:margin,y,font:bold,size:13,color:ink});y-=18;page.drawText([query.month,query.from&&'From '+query.from,query.to&&'To '+query.to,`${rows.length} entries`].filter(Boolean).join(' · '),{x:margin,y,font:normal,size:10,color:ink});y-=25;};
 const draw=(text,size=10,font=normal)=>{for(const line of wrap(text,size,font)){if(y<margin+30)next();page.drawText(line,{x:margin,y,font,size,color:ink});y-=size+4;}};
 next();draw('Recorded information as at '+new Date().toISOString()+'. Unknown amounts and conditional discounts remain subject to verification.',9);y-=8;
 for(const r of rows){const d=r.data,s=state.summaries[r.id]||{};if(y<margin+100)next();draw(recordTitle(r),11,bold);draw([d.month||d.date||d.period,d.amount!=null?money(d.amount):'',(s.payment_status??d.status)].filter(Boolean).join(' · '));
  if(type==='account'){draw(`Invoices less credits ${money(s.total)} | ${s.conditional?'Conditional discount':'Discount'} ${money(s.discount)} | Net ${money(s.net)}`);draw(`Recorded paid ${money(s.paid)} | Balance ${money(s.outstanding)}${s.missing?' | '+s.missing+' amount(s) unknown':''}`);}
  if(type==='weekly')draw(`Recorded paid ${money(s.paid)} | Balance ${money(s.outstanding)} | Paid date ${d.paid_date||'unknown'}`);
  if(type==='credit')draw(`${s.cases} unique invoices / 60 days | ${s.warning} | ${d.verification} | ${d.decision}`);
  if(type==='debt')draw(`${d.accounts??'Unknown'} accounts | Driver ${d.driver||'to confirm'} | ${d.notes||''}`);
  if(type==='stock')draw(`Counted ${d.closing??'unknown'} | Expected ${s.expected??'unknown'} | Difference ${s.difference??'unknown'}`);
  if(type==='settlement')draw(`Received ${money(d.received)} on ${d.received_date||'date unknown'} | Remaining ${money(s.remaining)}`);
  if(type==='profit')draw(`Sales ${money(d.sales)} | Cost ${money(d.cost)} | Expenses ${money(d.expenses)} | Profit ${money(s.profit)}`);
  if(d.review)draw('REVIEW: '+d.review,9);y-=10;
 }
 doc.getPages().forEach((p,i)=>p.drawText(`Page ${i+1} of ${doc.getPageCount()}`,{x:width-110,y:18,font:normal,size:9,color:ink}));doc.setTitle('Fen Meat Financial - '+FINANCE_TYPES[type].title);return doc.save();
}
