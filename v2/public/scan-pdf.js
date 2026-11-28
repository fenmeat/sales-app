// Image-only PDF 1.4. Streams are embedded as produced by the browser, without
// re-encoding. Track byte offsets, including binary images, for the xref table.
export function pagesToPdf(pages) {
  if(!pages.length)throw Error('Voeg eers ’n bladsy by.');
  const parts=[],offsets=[0],encoder=new TextEncoder();
  let size=0;
  function append(data){
    const part=typeof data==='string'?encoder.encode(data):data;
    parts.push(part);size+=part.size??part.byteLength;
  }
  function object(id,body){offsets[id]=size;append(id+' 0 obj\n');for(const part of body)append(part);append('\nendobj\n');}
  append('%PDF-1.4\n');append(new Uint8Array([37,226,227,207,211,10]));
  object(1,['<< /Type /Catalog /Pages 2 0 R >>']);
  object(2,['<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>']);
  pages.forEach(({width,height,image,filter,space},i)=>{
    const id=3+i*3,scale=842/Math.max(width,height),w=(width*scale).toFixed(2),h=(height*scale).toFixed(2);
    object(id,[`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Scan ${id+1} 0 R >> >> /Contents ${id+2} 0 R >>`]);
    object(id+1,[`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /${space} /BitsPerComponent 8 /Filter /${filter} /Length ${image.size} >>\nstream\n`,image,'\nendstream']);
    const draw=`q ${w} 0 0 ${h} 0 0 cm /Scan Do Q\n`;
    object(id+2,[`<< /Length ${draw.length} >>\nstream\n`,draw,'endstream']);
  });
  const xref=size;
  append(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
  for(const offset of offsets.slice(1))append(String(offset).padStart(10,'0')+' 00000 n \n');
  append(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts,{type:'application/pdf'});
}
