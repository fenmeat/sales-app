import {check,UserError,dateKey,today} from './domain.js';
import {hash,keys,randomToken} from './auth.js';
import {matchZohoInvoice} from './zoho-matching.js';

export const ZOHO_ORIGIN='https://fenmeat-sales-test.alexander-fenwick.workers.dev';
export const ZOHO_REDIRECT_URI=ZOHO_ORIGIN+'/api/zoho/callback';
export const ZOHO_SCOPES=['ZohoBooks.settings.READ','ZohoBooks.invoices.READ','ZohoBooks.customerpayments.READ'];
// Alex confirmed this organisation from the live connection on 2 October 2026.
export const ZOHO_ORGANISATION={id:'852102281',name:'FEN',currency:'ZAR'};
const regions=Object.fromEntries(['com','eu','in','com.au','jp','ca','com.cn','sa'].map(suffix=>['https://accounts.zoho.'+suffix,'https://www.zohoapis.'+suffix]));
const genericApiDomains=Object.fromEntries(Object.keys(regions).map(accounts=>[accounts,accounts.replace('https://accounts.','https://api.')]));
class ZohoError extends UserError{
 constructor(reason,message){super(message,502);this.reason=reason;}
}
const cookieName='__Secure-fm_zoho_state';
const encoder=new TextEncoder();
const cookie=value=>`${cookieName}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/api/zoho; Max-Age=${value?600:0}`;
const base64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unbase64=text=>Uint8Array.from(atob(text),c=>c.charCodeAt(0));
const connection=db=>db.prepare('SELECT * FROM v2_zoho_connection WHERE id=1').first();
function settings(env){
 const clientId=String(env.ZOHO_CLIENT_ID??'').trim(),secret=String(env.ZOHO_CLIENT_SECRET??'').trim();
 const accountsUrl=String(env.ZOHO_ACCOUNTS_URL??'https://accounts.zoho.com');
 check(/^[A-Za-z0-9._-]{10,200}$/.test(clientId)&&secret.length>=16&&secret.length<=512&&!/\s/.test(secret),'Add ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET as Cloudflare Secrets first.',503);
 check(Object.hasOwn(regions,accountsUrl),'The Zoho accounts region is not supported.',503);
 return {clientId,secret,accountsUrl};
}
const fingerprint=config=>hash(config.clientId+'|'+config.secret);
const isOwner=user=>user.username==='alex';
async function encryptionKey(config){
 const material=await crypto.subtle.importKey('raw',encoder.encode(config.secret),'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:encoder.encode(config.clientId),info:encoder.encode('fenmeat-sales-v2:zoho:v1')},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
}
async function seal(config,value,purpose){
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const data=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(purpose)},await encryptionKey(config),encoder.encode(JSON.stringify(value)));
 return JSON.stringify({version:1,iv:base64(iv),data:base64(data)});
}
async function unseal(config,value,purpose){
 const data=JSON.parse(value);check(data.version===1,'Unsupported Zoho credential format.',503);
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unbase64(data.iv),additionalData:encoder.encode(purpose)},await encryptionKey(config),unbase64(data.data));
 return JSON.parse(new TextDecoder().decode(plain));
}
export async function zohoStatus(env,user){
 let config;try{config=settings(env);}catch{return {configured:false,connected:false,can_manage:isOwner(user),sync_enabled:false,organisations:[]};}
 const row=await connection(env.DB),matches=row&&row.client_fingerprint===await fingerprint(config);
 const organisations=matches?JSON.parse(row.organisations):[];
 return {configured:true,connected:!!matches,can_manage:isOwner(user),sync_enabled:false,credentials_changed:!!row&&!matches,
  connected_at:matches?row.connected_at:null,last_checked:matches?row.last_checked:null,api_domain:matches?row.api_domain:null,
  organisations,selected_organisation:organisations.find(o=>o.id===ZOHO_ORGANISATION.id&&o.active&&o.currency==='ZAR')??null,scopes:ZOHO_SCOPES};
}
export async function beginZoho(request,env,user){
 check(isOwner(user),'Sign in as Alex to manage the Zoho connection.',403);
 check(new URL(request.url).origin===ZOHO_ORIGIN,'Connect Zoho from the test app address.',400);
 const config=settings(env);check(!await connection(env.DB),'Zoho already has a saved authorisation. Use Check connection.',409);
 const session=request.headers.get('Cookie')?.match(/(?:^|;\s*)fm_session=([a-f0-9]{64})(?:;|$)/)?.[1];check(session,'Sign in again.',401);
 const state=randomToken(),verifier=randomToken(),sessionHash=await hash(session);
 const challenge=base64(await crypto.subtle.digest('SHA-256',encoder.encode(verifier))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 await env.DB.batch([
  env.DB.prepare('DELETE FROM v2_zoho_states WHERE expires<? OR session_hash=?').bind(Date.now(),sessionHash),
  env.DB.prepare('INSERT INTO v2_zoho_states(state_hash,session_hash,expires,client_fingerprint,accounts_url,verifier) VALUES(?,?,?,?,?,?)').bind(await hash(state),sessionHash,Date.now()+600000,await fingerprint(config),config.accountsUrl,await seal(config,{verifier},'oauth-state'))
 ]);
 const url=new URL(config.accountsUrl+'/oauth/v2/auth');url.search=new URLSearchParams({client_id:config.clientId,response_type:'code',redirect_uri:ZOHO_REDIRECT_URI,scope:ZOHO_SCOPES.join(','),access_type:'offline',prompt:'consent',state,code_challenge:challenge,code_challenge_method:'S256'}).toString();
 return {authorization_url:url.href,cookie:cookie(state)};
}
// Fixed destinations, no redirect following and no upstream error bodies in responses/logs.
async function requestJson(url,options){
 let response,data;
 // workerd rejects redirect:'error' before sending; manual + a 3xx check keeps redirects blocked.
 try{response=await fetch(url,{...options,redirect:'manual',signal:AbortSignal.timeout(12000)});}catch{throw new ZohoError('unreachable','Zoho could not be reached. Try again shortly.');}
 if(response.status>=300&&response.status<400)throw new ZohoError('unexpected_redirect','Zoho returned an unexpected redirect. The request was stopped to protect the connection credentials.');
 try{data=await response.json();if(!data||typeof data!=='object'||Array.isArray(data))throw new Error();}catch{throw new ZohoError('invalid_response','Zoho returned an unreadable response. Try again shortly.');}
 return {response,data};
}
async function tokenRequest(config,accountsUrl,parameters){
 check(Object.hasOwn(regions,accountsUrl),'Unexpected Zoho accounts region.',400);
 const {response,data}=await requestJson(accountsUrl+'/oauth/v2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:config.clientId,client_secret:config.secret,...parameters}).toString()});
 if(!response.ok||data.error||!data.access_token){
  const known={invalid_client:'Zoho rejected the Client ID or accounts region.',invalid_client_secret:'Zoho rejected the Client Secret.',invalid_redirect_uri:'The Zoho redirect URI does not match the test app.',invalid_code:'Zoho authorisation expired or was already used. Start again from the app.'};
  const reason=Object.hasOwn(known,data.error)?data.error:'token_rejected';
  throw new ZohoError(reason,known[reason]??'Zoho did not authorise the connection.');
 }
 if(typeof data.access_token!=='string'||data.access_token.length>=4096||!Number.isFinite(Number(data.expires_in))||Number(data.expires_in)<=0)throw new ZohoError('token_response','Zoho returned an incomplete token response.');
 // OAuth may return api.zoho.com; Books uses www.zohoapis.com in the same region.
 // Compare exact allowlisted origins; never follow a token-supplied destination.
 const returnedDomain=data.api_domain??regions[accountsUrl],apiDomain=regions[accountsUrl];
 if(returnedDomain!==apiDomain&&returnedDomain!==genericApiDomains[accountsUrl])throw new ZohoError('api_region','Zoho returned an unexpected API region.');
 return {...data,api_domain:apiDomain,expires_at:Date.now()+Math.min(Number(data.expires_in),3600)*1000};
}
async function listOrganisations(apiDomain,accessToken){
 check(Object.values(regions).includes(apiDomain),'Unexpected Zoho API region.',502);
 const {response,data}=await requestJson(apiDomain+'/books/v3/organizations',{method:'GET',headers:{Authorization:'Zoho-oauthtoken '+accessToken}});
 check(response.ok&&data.code===0&&Array.isArray(data.organizations),'Zoho authorisation is saved, but the organisation check failed. Try Check connection.',502);
 return data.organizations.map(o=>({id:String(o.organization_id??''),name:String(o.name??'').slice(0,200),currency:String(o.currency_code??'').slice(0,10),active:o.is_org_active!==false})).filter(o=>/^[0-9]{1,40}$/.test(o.id));
}
function returnToApp(result){return new Response(null,{status:303,headers:{Location:ZOHO_ORIGIN+'/?zoho='+result+'#setup','Set-Cookie':cookie(''),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'"}});}
export async function completeZoho(request,env){
 let stage='failed';
 try{
  check(new URL(request.url).origin===ZOHO_ORIGIN,'Wrong callback origin.',400);
  const url=new URL(request.url),state=url.searchParams.get('state');
  const browserState=request.headers.get('Cookie')?.match(/(?:^|;\s*)__Secure-fm_zoho_state=([a-f0-9]{64})(?:;|$)/)?.[1];
  if(!state||!browserState||state!==browserState||!/^[a-f0-9]{64}$/.test(state))return returnToApp('expired');
  // DELETE ... RETURNING atomically claims this one-use callback.
  stage='state_read';
  const pending=await env.DB.prepare('DELETE FROM v2_zoho_states WHERE state_hash=? RETURNING *').bind(await hash(state)).first();
  if(!pending||pending.expires<=Date.now())return returnToApp('expired');
  stage='session_check';
  const session=await env.DB.prepare('SELECT username,key_hash,expires FROM v2_sessions WHERE token_hash=?').bind(pending.session_hash).first();
  const accounts=keys(env);
  if(!session||!isOwner(session)||session.expires<=Date.now()||!accounts[session.username]||session.key_hash!==await hash(accounts[session.username]))return returnToApp('expired');
  stage='configuration';
  const config=settings(env);if(pending.client_fingerprint!==await fingerprint(config))return returnToApp('configuration');
  if(url.searchParams.has('error'))return returnToApp(url.searchParams.get('error')==='access_denied'?'denied':'consent_failed');
  const code=url.searchParams.get('code');if(!code||code.length>4096)return returnToApp('missing_code');
  const accountsUrl=url.searchParams.get('accounts-server')??pending.accounts_url;
  if(!Object.hasOwn(regions,accountsUrl))return returnToApp('accounts_region');
  stage='connection_read';
  if(await connection(env.DB))return returnToApp('already_connected');
  stage='state_decrypt';
  const {verifier}=await unseal(config,pending.verifier,'oauth-state');
  stage='token_request';
  const tokens=await tokenRequest(config,accountsUrl,{grant_type:'authorization_code',code,redirect_uri:ZOHO_REDIRECT_URI,code_verifier:verifier});
  if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token||tokens.refresh_token.length>4096)return returnToApp('missing_refresh');
  const stamp=new Date().toISOString();
  stage='token_encrypt';
  const encryptedTokens=await seal(config,{access_token:tokens.access_token,refresh_token:tokens.refresh_token,expires_at:tokens.expires_at},'tokens');
  stage='connection_save';
  await env.DB.prepare('INSERT INTO v2_zoho_connection(id,client_fingerprint,encrypted_tokens,accounts_url,api_domain,connected_at,connected_by,organisations) VALUES(1,?,?,?,?,?,?,?)').bind(await fingerprint(config),encryptedTokens,accountsUrl,tokens.api_domain,stamp,session.username,'[]').run();
  // Persist authorisation before the API check, so temporary Books errors cannot lose the refresh token.
  try{const organisations=await listOrganisations(tokens.api_domain,tokens.access_token);await env.DB.prepare('UPDATE v2_zoho_connection SET organisations=?,last_checked=? WHERE id=1').bind(JSON.stringify(organisations),new Date().toISOString()).run();}catch{return returnToApp('check_pending');}
  return returnToApp('connected');
 }catch(error){return returnToApp(error instanceof ZohoError?error.reason:stage);}
}
async function authorisedClient(env){
 const config=settings(env),row=await connection(env.DB);check(row,'Connect Zoho first.');
 check(row.client_fingerprint===await fingerprint(config),'The saved Zoho configuration changed. Restore the original Zoho Secrets before continuing.',409);
 let tokens;try{tokens=await unseal(config,row.encrypted_tokens,'tokens');}catch{throw new UserError('The saved Zoho authorisation could not be read. Check the original Zoho Secrets.',503);}
 if(tokens.expires_at<=Date.now()+60000){
  const fresh=await tokenRequest(config,row.accounts_url,{grant_type:'refresh_token',refresh_token:tokens.refresh_token});
  tokens={access_token:fresh.access_token,refresh_token:tokens.refresh_token,expires_at:fresh.expires_at};
  const result=await env.DB.prepare('UPDATE v2_zoho_connection SET encrypted_tokens=? WHERE id=1 AND encrypted_tokens=?').bind(await seal(config,tokens,'tokens'),row.encrypted_tokens).run();
  check(result.meta.changes===1,'Another connection check is in progress. Try again.',409);
 }
 return {row,tokens};
}
export async function checkZoho(env,user){
 check(isOwner(user),'Sign in as Alex to manage the Zoho connection.',403);
 const {row,tokens}=await authorisedClient(env);
 const organisations=await listOrganisations(row.api_domain,tokens.access_token);
 await env.DB.prepare('UPDATE v2_zoho_connection SET organisations=?,last_checked=? WHERE id=1').bind(JSON.stringify(organisations),new Date().toISOString()).run();
 return zohoStatus(env,user);
}

const textValue=(value,max=200)=>typeof value==='string'?value.slice(0,max):'';
function zohoId(value){
 const id=typeof value==='string'?value:typeof value==='number'&&Number.isSafeInteger(value)?String(value):'';
 check(/^[0-9]{1,40}$/.test(id),'Zoho returned an invalid record ID.',502);return id;
}
function previewDate(value){const date=dateKey(value);check(date>='2026-10-01'&&date<=today(),'Choose a date from 1 October 2026 up to today.');return date;}
function previewHeader(invoice,date){
 check(invoice&&invoice.date===date,'Zoho returned an invoice for a different date. Nothing was imported.',502);
 if(invoice.organization_id!==undefined)check(String(invoice.organization_id)===ZOHO_ORGANISATION.id,'Zoho returned a different organisation. Nothing was imported.',502);
 return {id:zohoId(invoice.invoice_id),number:textValue(invoice.invoice_number,100),date,status:textValue(invoice.status,60),customer:textValue(invoice.customer_name),
  salesperson_id:invoice.salesperson_id?zohoId(invoice.salesperson_id):null,salesperson:textValue(invoice.salesperson_name),currency:textValue(invoice.currency_code,10),
  total:typeof invoice.total==='number'&&Number.isFinite(invoice.total)&&invoice.total>=0?invoice.total:null};
}
async function readFenBooks(env,user,path,params){
 check(isOwner(user),'Sign in as Alex to check Zoho invoices.',403);
 check(/^invoices(?:\/[0-9]{1,40})?$/.test(path),'Invalid invoice request.');
 const saved=await connection(env.DB);
 check(saved&&JSON.parse(saved.organisations).some(o=>o.id===ZOHO_ORGANISATION.id&&o.active&&o.currency==='ZAR'),'FEN is not available in the saved connection. Press Check connection first.',409);
 const {row,tokens}=await authorisedClient(env);
 check(Object.values(regions).includes(row.api_domain),'Unexpected Zoho API region.',502);
 const query=new URLSearchParams({...params,organization_id:ZOHO_ORGANISATION.id});
 const {response,data}=await requestJson(row.api_domain+'/books/v3/'+path+'?'+query,{method:'GET',headers:{Authorization:'Zoho-oauthtoken '+tokens.access_token}});
 check(response.status!==429,'Zoho is busy or its request limit was reached. Try again later.',429);
 check(response.ok&&data.code===0,'Zoho could not read the FEN invoices. Press Check connection and try again.',502);
 return data;
}
export async function previewZohoInvoices(env,user,input){
 check(isOwner(user),'Sign in as Alex to check Zoho invoices.',403);
 const date=previewDate(input.date),page=input.page??1;
 check(Number.isInteger(page)&&page>=1&&page<=100,'Invalid invoice page.');
 const data=await readFenBooks(env,user,'invoices',{date,page:String(page),per_page:'20',sort_column:'invoice_number',sort_order:'A'});
 check(Array.isArray(data.invoices)&&data.invoices.length<=20&&typeof data.page_context?.has_more_page==='boolean'&&Number(data.page_context.page)===page,'Zoho returned an incomplete invoice page. Nothing was imported.',502);
 const invoices=data.invoices.map(i=>previewHeader(i,date));
 check(new Set(invoices.map(i=>i.id)).size===invoices.length,'Zoho returned duplicate invoices. Nothing was imported.',502);
 return {preview:true,organisation:ZOHO_ORGANISATION,date,page,has_more:data.page_context.has_more_page,invoices};
}
export async function previewZohoInvoice(env,user,input,catalog={products:[],routes:[]}){
 check(isOwner(user),'Sign in as Alex to check Zoho invoices.',403);
 const date=previewDate(input.date);check(typeof input.invoice_id==='string'&&/^[0-9]{1,40}$/.test(input.invoice_id),'Choose an invoice from the FEN list.');const id=input.invoice_id;
 const data=await readFenBooks(env,user,'invoices/'+id,{}),invoice=data.invoice;
 const result=previewHeader(invoice,date);
 check(result.id===id&&Array.isArray(invoice.line_items)&&invoice.line_items.length<=500,'Zoho returned incomplete invoice details. Nothing was imported.',502);
 const detail={...result,lines:invoice.line_items.map(line=>({
  id:zohoId(line.line_item_id),item_id:line.item_id?zohoId(line.item_id):null,name:textValue(line.name),sku:textValue(line.sku,100),unit:textValue(line.unit,80),
  quantity:typeof line.quantity==='number'&&Number.isFinite(line.quantity)&&line.quantity>=0?line.quantity:null
 }))};
 return {preview:true,organisation:ZOHO_ORGANISATION,invoice:detail,matching:matchZohoInvoice(detail,catalog)};
}
