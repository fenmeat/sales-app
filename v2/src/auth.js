import {check,UserError} from './domain.js';
const encoder=new TextEncoder();
export const hash=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(s)))).map(b=>b.toString(16).padStart(2,'0')).join('');
export const randomToken=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(b=>b.toString(16).padStart(2,'0')).join('');
function readKeys(raw){
 try{
  const value=JSON.parse(raw??'{}');
  if(!value||typeof value!=='object'||Array.isArray(value))return Object.create(null);
  const entries=Object.entries(value);check(entries.length<=20,'Too many accounts.');
  return Object.assign(Object.create(null),Object.fromEntries(entries.filter(([u,k])=>/^[a-z0-9_-]{1,40}$/.test(u)&&typeof k==='string'&&k.length>=32&&k.length<=200)));
 }catch{return Object.create(null);}
}
export function keys(env){
 const primary=readKeys(env.APP_ACCESS_KEYS);
 // Extra staff keys cannot bootstrap access, replace an existing identity or
 // change Alex/Alinda. An absent/malformed extra secret leaves primary access intact.
 if(!Object.keys(primary).length)return primary;
 const used=new Set(Object.values(primary));let count=Object.keys(primary).length;
 for(const [username,key] of Object.entries(readKeys(env.APP_STAFF_ACCESS_KEYS))){
  if(['alex','alinda'].includes(username)||Object.hasOwn(primary,username)||used.has(key)||count>=20)continue;
  Object.defineProperty(primary,username,{value:key,enumerable:true,configurable:true,writable:true});
  used.add(key);count++;
 }
 return primary;
}
export function sameOrigin(request){check(request.headers.get('Origin')===new URL(request.url).origin,'This save must come from the app.',403);}
export async function authenticate(request,env,{allowKey=false}={}){
 const accounts=keys(env);check(Object.keys(accounts).length>0,'Access keys have not been configured.',503);
 const bearer=request.headers.get('Authorization');
 if(allowKey&&bearer?.startsWith('Bearer ')){const h=await hash(bearer.slice(7));for(const [username,key] of Object.entries(accounts))if(h===await hash(key))return {username};throw new UserError('Invalid access key.',401);}
 const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)fm_session=([a-f0-9]{64})(?:;|$)/)?.[1];check(token,'Sign in to continue.',401);
 const session=await env.DB.prepare('SELECT username,key_hash,expires FROM v2_sessions WHERE token_hash=?').bind(await hash(token)).first();
 check(session&&session.expires>Date.now()&&accounts[session.username]&&session.key_hash===await hash(accounts[session.username]),'Your session expired. Sign in again.',401);return session;
}
export async function login(request,env,body){
 sameOrigin(request);const accounts=keys(env);check(Object.keys(accounts).length>0,'Access keys have not been configured.',503);
 const username=String(body.username??'').toLowerCase();const supplied=String(body.key??'');check(supplied.length<=200,'Invalid access key.',401);
 const bucket=await hash((request.headers.get('CF-Connecting-IP')??'local')+'|'+Math.floor(Date.now()/900000));
 const r=await env.DB.prepare('INSERT INTO v2_auth_limits(bucket,attempts,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,Date.now()+900000).first();
 check(r.attempts<=20,'Too many sign-in attempts. Try again in 15 minutes.',429);
 check(accounts[username]&&await hash(supplied)===await hash(accounts[username]),'Username or access key is incorrect.',401);
 const token=randomToken();await env.DB.batch([env.DB.prepare('INSERT INTO v2_sessions VALUES(?,?,?,?)').bind(await hash(token),username,await hash(accounts[username]),Date.now()+43200000),env.DB.prepare('DELETE FROM v2_sessions WHERE expires<?').bind(Date.now()),env.DB.prepare('DELETE FROM v2_auth_limits WHERE expires<?').bind(Date.now())]);
 return {username,cookie:`fm_session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`};
}
