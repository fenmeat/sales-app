import {PDFDocument,StandardFonts,rgb} from 'pdf-lib';

export async function downloadWages(report,date) {
 const pdf=await PDFDocument.create(), regular=await pdf.embedFont(StandardFonts.Helvetica),bold=await pdf.embedFont(StandardFonts.HelveticaBold);
 const columns=[145,56,48,45,66,57,50,53,86,85],margin=25;
 let page,y;
 const draw=(value,x,at,font=regular,size=9)=>page.drawText(String(value).replace(/\u202f|\u00a0/g,' '),{x,y:at,font,size});
 const line=(fields,font)=>{
  let x=margin,height=14;
  for(const [i,value] of fields.entries()){
   const words=String(value).replace(/\u202f|\u00a0/g,' ').split(/\s+/);let row='',offset=0;
   for(const word of words){const next=row?row+' '+word:word;if(row&&font.widthOfTextAtSize(next,9)>columns[i]-4){draw(row,x,y-offset,font);offset+=12;row=word;}else row=next;}
   draw(row,x,y-offset,font);height=Math.max(height,offset+14);x+=columns[i];
  }
  y-=height+3;page.drawLine({start:{x:margin,y:y+4},end:{x:716,y:y+4},color:rgb(.82,.85,.87),thickness:.4});
 };
 const start=()=>{page=pdf.addPage([842,595]);y=555;draw('Fen Meat  |  '+report.title,margin,y,bold,16);y-=28;line(report.headers,bold);};
 start();for(const fields of report.rows){if(y<75)start();line(fields,regular);}
 if(y<70)start();y-=8;draw(report.note,margin,y);draw(report.total,margin,y-19,bold);
 const url=URL.createObjectURL(new Blob([await pdf.save()],{type:'application/pdf'}));
 const link=document.createElement('a');link.href=url;link.download='FenMeat-betaalstaat-'+date+'.pdf';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
