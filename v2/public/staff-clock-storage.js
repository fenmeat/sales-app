// Durable kiosk evidence. No PIN is stored. Offline credentials are encrypted
// under the employee PIN; only the ticket for an authorised action enters outbox.
const ROOT='fenmeat-clock-durable-v2',utf8=new TextEncoder();
export function readClockStore(storage=localStorage){
 const raw=storage.getItem(ROOT);if(raw===null)return {people:{},queue:[],receipts:[],snapshot:null};
 const value=JSON.parse(raw);
 if(!value||!value.people||!Array.isArray(value.queue)||!Array.isArray(value.receipts))throw Error('Klokberging kan nie gelees word nie. Hou hierdie toestel en vra bestuur om die rekords te herstel.');
 return value;
}
export function writeClockStore(value,storage=localStorage){
 storage.setItem(ROOT,JSON.stringify(value));
 if(storage.getItem(ROOT)!==JSON.stringify(value))throw Error('Die toestel kon nie die klokrekord bewaar nie. Geen bevestiging is ontvang nie.');
}
const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unbase64=value=>Uint8Array.from(atob(value),c=>c.charCodeAt(0));
async function key(pin,salt){
 const material=await crypto.subtle.importKey('raw',utf8.encode(pin),'PBKDF2',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'PBKDF2',salt:unbase64(salt),iterations:150000,hash:'SHA-256'},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
export async function lockClockGrant(pin,grant){
 const salt=base64(crypto.getRandomValues(new Uint8Array(16))),iv=base64(crypto.getRandomValues(new Uint8Array(12)));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv:unbase64(iv)},await key(pin,salt),utf8.encode(JSON.stringify(grant)));
 return {salt,iv,data:base64(encrypted)};
}
export async function unlockClockGrant(pin,stored){
 try{return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(stored.iv)},await key(pin,stored.salt),unbase64(stored.data))));}
 catch{throw Error('PIN is verkeerd, of hierdie werknemer is nog nie op hierdie toestel vir offline-klok bevestig nie.');}
}
export function queueClockAction(store,entry){
 if(store.queue.some(x=>x.request_id===entry.request_id))return store;
 if(store.queue.some(x=>x.employee_id===entry.employee_id&&x.revision===entry.revision))throw Error('Nog ’n klokaksie gebruik reeds dié werknemerstatus. Herlees die gestoorde rekord.');
 if(store.queue.length>=300)throw Error('Te veel ongestuurde klokrekords. Verbind met die internet en laat bestuur help.');
 return {...store,queue:[...store.queue,entry]};
}
export function acceptClockReceipt(store,entry,receipt){
 if(receipt.employee_id!==entry.employee_id||receipt.kind!==entry.kind||receipt.revision!==entry.revision+1||receipt.at!==entry.captured_at)throw Error('Die gestoorde bevestiging pas nie by die klokrekord nie. Hou dit vir herstel.');
 return {...store,queue:store.queue.filter(x=>x.request_id!==entry.request_id),receipts:[...store.receipts,{request_id:entry.request_id,employee_id:entry.employee_id,kind:entry.kind,at:receipt.at,revision:receipt.revision,confirmed_at:new Date().toISOString()}].slice(-3000)};
}
