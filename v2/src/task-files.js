import {check,UserError} from './domain.js';

const LIMIT=6000000, CHUNK=480000;
const word='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const excel='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const documents=['application/pdf','text/plain','text/csv',word,excel];
const formats=new Set([...documents,'image/jpeg','image/png','image/webp','image/heic','image/heif','image/heic-sequence','image/heif-sequence']);
export const fileChunksSchema='CREATE TABLE IF NOT EXISTS v2_task_file_chunks (file_id TEXT NOT NULL, part INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY(file_id,part))';
// Leave the original attachment row and all its IDs valid. Overflow chunks
// and their referring task are committed in the same D1 transaction.
const hexDigits='0123456789abcdef';
const hexByte=Array.from({length:256},(_,i)=>hexDigits[i>>4]+hexDigits[i&15]);
function toHex(bytes){
  if(typeof bytes.toHex==='function')return bytes.toHex();
  let encoded='';for(const byte of bytes)encoded+=hexByte[byte];return encoded;
}
function fromHex(encoded){
  if(typeof Uint8Array.fromHex==='function')return Uint8Array.fromHex(encoded);
  const bytes=new Uint8Array(encoded.length/2);
  for(let i=0;i<bytes.length;i++)bytes[i]=parseInt(encoded.slice(i*2,i*2+2),16);
  return bytes;
}
export function fileStatements(db,taskId,username,at,file){
  // Binding a short hex string avoids D1 serialising large byte arrays as JSON numbers.
  const first=toHex(file.bytes.subarray(0,CHUNK));
  const statements=[db.prepare('INSERT INTO v2_task_attachments VALUES(?,?,?,?,?,unhex(?),?)').bind(file.id,taskId,username,file.mime_type,file.filename,first,at)];
  for(let start=CHUNK;start<file.bytes.length;start+=CHUNK){
    const part=toHex(file.bytes.subarray(start,start+CHUNK));
    statements.push(db.prepare('INSERT INTO v2_task_file_chunks VALUES(?,?,unhex(?))').bind(file.id,start/CHUNK,part));
  }
  return statements;
}
async function unpack(bytes){
  try{
    const reader=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const parts=[];let length=0;
    while(true){
      const {done,value}=await reader.read();if(done)break;
      length+=value.length;
      if(length>LIMIT){await reader.cancel();throw Error();}
      parts.push(value);
    }
    const result=new Uint8Array(length);let pos=0;
    for(const part of parts){result.set(part,pos);pos+=part.length;}
    return result;
  }catch{throw new UserError('Die lêer is beskadig of groter as 6 MB.');}
}
export async function originalFileBytes(db,file){
  let bytes=file.encoded!==undefined?fromHex(file.encoded):new Uint8Array(file.bytes);
  if(bytes.length===CHUNK){
    const {results}=await db.prepare('SELECT hex(bytes) encoded FROM v2_task_file_chunks WHERE file_id=? ORDER BY part').bind(file.id).all();
    if(results.length){
      const joined=new Uint8Array(CHUNK+results.reduce((sum,row)=>sum+row.encoded.length/2,0));
      joined.set(bytes);let pos=CHUNK;
      for(const {encoded} of results){const chunk=fromHex(encoded);joined.set(chunk,pos);pos+=chunk.length;}
      bytes=joined;
    }
  }
  return bytes[0]===31&&bytes[1]===139?unpack(bytes):bytes;
}
function matchesType(bytes,type){
  const ascii=(start,end)=>String.fromCharCode(...bytes.subarray(start,end));
  if(type==='application/pdf')return ascii(0,5)==='%PDF-';
  if(type==='image/png')return ascii(1,4)==='PNG'&&bytes[0]===137;
  if(type==='image/jpeg')return bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
  if(type==='image/webp')return ascii(0,4)==='RIFF'&&ascii(8,12)==='WEBP';
  if(type.startsWith('image/hei'))return ascii(4,8)==='ftyp'&&/heic|heix|hevc|hevx|mif1|msf1/.test(ascii(8,64));
  if(type===word||type===excel)return ascii(0,4)==='PK\x03\x04';
  if(type==='text/plain'||type==='text/csv'){
    try{return !new TextDecoder('utf-8',{fatal:true}).decode(bytes).includes('\0');}catch{return false;}
  }
  return false;
}
export async function attachmentData(b){
  check(b&&/^[a-zA-Z0-9-]{8,90}$/.test(b.id??'')&&formats.has(b.mime_type),'Kies ’n ondersteunde foto of dokument.');
  check(typeof b.base64==='string'&&b.base64.length<=8000000&&/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64),'Gebruik ’n lêer van hoogstens 6 MB.');
  let bytes;
  try{if(typeof Uint8Array.fromBase64==='function')bytes=Uint8Array.fromBase64(b.base64);
  else{const raw=atob(b.base64);bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);}}catch{throw new UserError('Die lêer kon nie oopmaak nie.');}
  check(bytes.length>0&&bytes.length<=LIMIT,'Gebruik ’n lêer van hoogstens 6 MB.');
  check(b.encoding===undefined||(b.encoding==='gzip'&&documents.includes(b.mime_type)),'Onbekende lêerformaat.');
  const original=b.encoding?await unpack(bytes):bytes;
  check(original.length>0&&matchesType(original,b.mime_type),'The file contents do not match its type.');
  check(b.filename==null||typeof b.filename==='string','Ongeldige lêernaam.');
  const filename=(b.filename||'attachment').replace(/[^a-zA-Z0-9._-]/g,'_').slice(-100);
  return {id:b.id,mime_type:b.mime_type,filename,bytes};
}
export const downloadOnly=mime=>!['image/jpeg','image/png','image/webp','application/pdf'].includes(mime);
