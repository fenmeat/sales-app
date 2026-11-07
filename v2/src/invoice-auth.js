import {check,UserError} from './domain.js';
import {authenticate,hash,isAdmin,randomToken,sameOrigin} from './auth.js';

export const isInvoiceRep=username=>['tapiz','mosa','musa'].includes(username);
export const repName=username=>username==='tapiz'?'Tapiz':isInvoiceRep(username)?'Musa':username;
const PHONE='__Host-fm_invoice_phone',SESSION='__Host-fm_invoice_session';
const DAY=86400000,SESSION_MS=24*3600000,PHONE_MS=90*DAY;
const cookie=(name,value,seconds)=>`${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${seconds}`;
const tokenOf=(request,name)=>request.headers.get('Cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
export const hasInvoicePhone=request=>!!tokenOf(request,PHONE);
const validToken=s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const enc=new TextEncoder();
export const INVOICE_AUTH_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS v2_invoice_phones(id TEXT PRIMARY KEY, rep TEXT NOT NULL CHECK(rep IN ('tapiz','mosa')), name TEXT NOT NULL, code_hash TEXT UNIQUE, code_expires INTEGER, token_hash TEXT UNIQUE, expires INTEGER, pin_salt TEXT, pin_verifier TEXT, session_hash TEXT, session_expires INTEGER, revoked INTEGER NOT NULL DEFAULT 0, revision INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login TEXT)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS v2_invoice_one_phone ON v2_invoice_phones(rep) WHERE revoked=0`,
 `CREATE TABLE IF NOT EXISTS v2_invoice_phone_audit(id TEXT PRIMARY KEY, phone_id TEXT NOT NULL, rep TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL)`
];
async function phoneFor(request,db){
 const token=tokenOf(request,PHONE);if(!validToken(token))return null;
 const phone=await db.prepare('SELECT * FROM v2_invoice_phones WHERE token_hash=? AND revoked=0 AND expires>?').bind(await hash(token),Date.now()).first();
 return phone?{phone,token}:null;
}
async function pinVerifier(token,salt,pin){
 // A verifier from a database dump cannot test PIN guesses without the separate,
 // random 256-bit phone credential. Neither credential nor PIN is stored in JS.
 const key=await crypto.subtle.importKey('raw',enc.encode(token),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,enc.encode('FenMeat invoice PIN|'+salt+'|'+pin)))).map(x=>x.toString(16).padStart(2,'0')).join('');
}
function equal(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
async function limit(db,key,max){
 const bucket=await hash('invoice-access|'+key+'|'+Math.floor(Date.now()/900000));
 const r=await db.prepare('INSERT INTO v2_auth_limits(bucket,attempts,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,Date.now()+900000).first();
 check(r.attempts<=max,'Too many attempts. Wait 15 minutes and try again.',429);return bucket;
}
function checkPin(b){check(typeof b.pin==='string'&&/^\d{6}$/.test(b.pin),'Choose a 6-digit PIN.');check(b.pin===b.pin_confirm,'The two PINs do not match.');check(!/^(\d)\1{5}$/.test(b.pin)&&!['012345','123456','234567','345678','456789','987654','876543','765432','654321','543210'].includes(b.pin),'Choose a less predictable PIN.');}
const audit=(db,p,action,actor,stamp,conditional=false)=>db.prepare(`INSERT INTO v2_invoice_phone_audit(id,phone_id,rep,action,actor,saved_at) SELECT ?,?,?,?,?,?${conditional?' WHERE changes()=1':''}`).bind(crypto.randomUUID(),p.id,p.rep,action,actor,stamp);
export async function authenticateApp(request,env,options={}){
 // A deliberate owner sign-in on this browser still takes precedence.
 try{const user=await authenticate(request,env,options);if(isInvoiceRep(user.username)){const registered=await env.DB.prepare('SELECT 1 FROM v2_invoice_phones WHERE rep=? AND token_hash IS NOT NULL LIMIT 1').bind(user.username==='musa'?'mosa':user.username).first();check(!registered,'This rep now signs in with a PIN on the registered phone.',401);}return user;}catch(e){if(e.status!==401)throw e;}
 const record=await phoneFor(request,env.DB),session=tokenOf(request,SESSION);
 check(record&&validToken(session),'Sign in to Invoices to continue.',401);
 const p=record.phone;check(p.session_expires>Date.now()&&equal(p.session_hash,await hash(session)),'Enter your PIN again. Your saved work stays on this phone.',401);
 return {username:p.rep,role:'invoice_rep',phone_id:p.id,phone_token_hash:p.token_hash,phone_session_hash:p.session_hash,expires:p.session_expires};
}
// Rechecked inside financial SQL, so revoking or locking a phone also prevents
// an already-in-flight request from appending a transaction after that change.
export function invoicePhoneGuard(user){return user.phone_id?{
 sql:'EXISTS(SELECT 1 FROM v2_invoice_phones WHERE id=? AND token_hash=? AND session_hash=? AND revoked=0 AND expires>? AND session_expires>?)',
 args:[user.phone_id,user.phone_token_hash,user.phone_session_hash,Date.now(),Date.now()]
}:{sql:'1=1',args:[]};}
export async function invoicePageRedirect(request,env){
 if(!hasInvoicePhone(request)&&!tokenOf(request,'fm_session'))return false;
 try{const u=await authenticate(request,env);return isInvoiceRep(u.username);}catch(e){if(e.status!==401)throw e;return hasInvoicePhone(request);}
}
export async function invoiceAccessApi({request,url,env,bodyOf}){
 const db=env.DB,path=url.pathname;
 if(path==='/api/invoicing/access/status'&&request.method==='GET'){
  const record=await phoneFor(request,db);return {data:record?{registered:true,username:record.phone.rep,name:repName(record.phone.rep),phone_id:record.phone.id}:{registered:false}};
 }
 check(request.method==='POST','Method not allowed.',405);sameOrigin(request);
 check(Number(request.headers.get('Content-Length')??0)<=4096,'Request too large.',413);
 const b=await bodyOf(request);check(b&&typeof b==='object'&&!Array.isArray(b),'Enter the sign-in details.');check(JSON.stringify(b).length<=4096,'Request too large.',413);
 if(path==='/api/invoicing/access/enroll'){
  await limit(db,'enroll-ip|'+(request.headers.get('CF-Connecting-IP')??'local'),20);checkPin(b);
  const code=String(b.code??'').replace(/[\s-]/g,'').toLowerCase();check(/^[a-f0-9]{16}$/.test(code),'Enter the activation code from Alex or Alinda.');
  const p=await db.prepare('SELECT * FROM v2_invoice_phones WHERE code_hash=? AND code_expires>? AND revoked=0').bind(await hash(code),Date.now()).first();check(p,'This activation code is invalid or expired. Ask Alex or Alinda for a new code.',401);
  let token=tokenOf(request,PHONE);
  if(p.token_hash)check(validToken(token)&&await hash(token)===p.token_hash&&p.expires>Date.now(),'Reset the PIN on the phone already registered to this rep. A replacement phone needs a new registration.',403);
  else{
   check(!(await phoneFor(request,db)),'This browser is already registered. Use the correct road phone.',409);
   const active=await db.prepare("SELECT 1 FROM v2_invoice_sessions WHERE actor IN (?,?) AND status='active'").bind(p.rep,p.rep==='mosa'?'musa':p.rep).first();check(!active,'Sync and finish this rep’s existing route before registering a phone.',409);token=randomToken();
  }
  const session=randomToken(),salt=randomToken(),now=Date.now(),stamp=new Date(now).toISOString(),verifier=await pinVerifier(token,salt,b.pin);
  const noActive=p.token_hash?'1=1':"NOT EXISTS(SELECT 1 FROM v2_invoice_sessions WHERE actor IN (?,?) AND status='active')";
  const result=await db.batch([
   db.prepare(`UPDATE v2_invoice_phones SET token_hash=?,expires=?,pin_salt=?,pin_verifier=?,session_hash=?,session_expires=?,code_hash=NULL,code_expires=NULL,revision=revision+1,updated_at=?,last_login=? WHERE id=? AND revision=? AND code_hash=? AND code_expires>? AND revoked=0 AND ${noActive}`).bind(await hash(token),now+PHONE_MS,salt,verifier,await hash(session),now+SESSION_MS,stamp,stamp,p.id,p.revision,p.code_hash,now,...(p.token_hash?[]:[p.rep,p.rep==='mosa'?'musa':p.rep])),
   audit(db,p,p.token_hash?'pin_reset':'enrolled',p.rep,stamp,true)
  ]);check(result[0].meta.changes===1,'This code was already used or the phone changed. Request a new code.',409);
  const legacy=tokenOf(request,'fm_session');if(validToken(legacy))await db.prepare('DELETE FROM v2_sessions WHERE token_hash=?').bind(await hash(legacy)).run();
  return {data:{username:p.rep,phone_id:p.id,expires:now+SESSION_MS},cookies:[cookie(PHONE,token,PHONE_MS/1000),cookie(SESSION,session,SESSION_MS/1000),cookie('fm_session','',0)]};
 }
 if(path==='/api/invoicing/access/login'){
  const record=await phoneFor(request,db);check(record,'Register this phone first, or ask Alex or Alinda to check its access.',401);const {phone:p,token}=record;
  const bucket=await limit(db,'pin|'+p.id,5);
  check(typeof b.pin==='string'&&/^\d{6}$/.test(b.pin)&&equal(await pinVerifier(token,p.pin_salt,b.pin),p.pin_verifier),'Incorrect PIN.',401);
  const session=randomToken(),now=Date.now(),stamp=new Date(now).toISOString();
  const results=await db.batch([
   db.prepare('UPDATE v2_invoice_phones SET session_hash=?,session_expires=?,revision=revision+1,last_login=?,updated_at=? WHERE id=? AND revision=? AND revoked=0 AND expires>?').bind(await hash(session),now+SESSION_MS,stamp,stamp,p.id,p.revision,now),
   audit(db,p,'unlocked',p.rep,stamp,true)
  ]);check(results[0].meta.changes===1,'Phone access changed. Try signing in again.',409);
  await db.prepare('DELETE FROM v2_auth_limits WHERE bucket=? OR expires<?').bind(bucket,now).run();
  const legacy=tokenOf(request,'fm_session');if(validToken(legacy))await db.prepare('DELETE FROM v2_sessions WHERE token_hash=?').bind(await hash(legacy)).run();
  return {data:{username:p.rep,phone_id:p.id,expires:now+SESSION_MS},cookies:[cookie(SESSION,session,SESSION_MS/1000),cookie('fm_session','',0)]};
 }
 if(path==='/api/invoicing/access/lock'){
  const record=await phoneFor(request,db);check(record,'This phone is not registered.',401);const p=record.phone;
  await db.batch([db.prepare('UPDATE v2_invoice_phones SET session_hash=NULL,session_expires=NULL,revision=revision+1,updated_at=? WHERE id=? AND token_hash=? AND revoked=0').bind(new Date().toISOString(),p.id,p.token_hash),audit(db,p,'locked',p.rep,new Date().toISOString(),true)]);
  return {data:{locked:true},cookies:[cookie(SESSION,'',0)]};
 }
 throw new UserError('Unknown sign-in operation.',404);
}
export async function invoicePhonesApi({request,env,user,bodyOf}){
 check(isAdmin(user.username),'Only Alex or Alinda manages rep phones.',403);const db=env.DB;
 if(request.method==='GET')return {phones:(await db.prepare(`SELECT p.id,p.rep,p.name,p.revoked,p.revision,p.created_at,p.updated_at,p.last_login,p.expires,p.code_expires,CASE WHEN p.token_hash IS NULL THEN 0 ELSE 1 END AS enrolled,(SELECT s.route FROM v2_invoice_sessions s WHERE s.actor IN (p.rep,CASE WHEN p.rep='mosa' THEN 'musa' ELSE p.rep END) AND s.status='active' LIMIT 1) AS active_route FROM v2_invoice_phones p ORDER BY p.created_at DESC LIMIT 100`).all()).results};
 check(request.method==='POST','Method not allowed.',405);const b=await bodyOf(request),stamp=new Date().toISOString();
 if(b.action==='create'){
  const rep=b.rep==='musa'?'mosa':b.rep;check(['tapiz','mosa'].includes(rep),'Choose Tapiz or Musa.');const name=String(b.name??repName(rep)+' road phone').trim();check(name.length>0&&name.length<=80,'Enter a short phone name.');
  const active=await db.prepare("SELECT 1 FROM v2_invoice_sessions WHERE actor IN (?,?) AND status='active'").bind(rep,rep==='mosa'?'musa':rep).first();check(!active,'Sync and finish this rep’s current route before registering a phone.',409);
  const p={id:crypto.randomUUID(),rep},code=randomToken().slice(0,16),expires=Date.now()+900000;
  try{await db.batch([db.prepare('INSERT INTO v2_invoice_phones(id,rep,name,code_hash,code_expires,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(p.id,rep,name,await hash(code),expires,user.username,stamp,stamp),audit(db,p,'invited',user.username,stamp)]);}catch{throw new UserError('This rep already has a registration. Use New code, or block the previous phone before replacing it.',409);}
  return {id:p.id,rep,name,code,expires};
 }
 check(['code','revoke'].includes(b.action),'Choose a phone action.');const p=await db.prepare('SELECT * FROM v2_invoice_phones WHERE id=?').bind(String(b.id??'')).first();check(p,'Phone not found.',404);
 check(Number.isSafeInteger(b.revision)&&p.revision===b.revision,'The phone changed. Reload the list before continuing.',409);
 const code=b.action==='code'?randomToken().slice(0,16):null,expires=code?Date.now()+900000:null;
 if(code){check(!p.revoked,'A blocked phone needs a new registration.',409);check(!p.token_hash||p.expires>Date.now(),'This registration expired. Block it, then register the phone again.',409);}
 const result=await db.batch([
  db.prepare(code?'UPDATE v2_invoice_phones SET code_hash=?,code_expires=?,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND revoked=0':'UPDATE v2_invoice_phones SET revoked=1,code_hash=NULL,code_expires=NULL,session_hash=NULL,session_expires=NULL,revision=revision+1,updated_at=? WHERE id=? AND revision=? AND revoked=0').bind(...(code?[await hash(code),expires]:[]),stamp,p.id,p.revision),
  audit(db,p,code?'code_renewed':'revoked',user.username,stamp,true)
 ]);check(result[0].meta.changes===1,'Phone access changed. Reload the list.',409);
 return code?{id:p.id,rep:p.rep,name:p.name,code,expires,reset:!!p.token_hash}:{revoked:true};
}
