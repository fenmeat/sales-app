import {queueTaskReminders,flushTaskPush} from './tasks-push.js';
import app from './worker.js';
import {OAuthProvider,OAuthError,AuthorizationError,insufficientScope} from '@cloudflare/workers-oauth-provider';
import {authenticate,keys,hash,sameOrigin,isAdmin} from './auth.js';
import {UserError,check} from './domain.js';
import {initPaStorage,oauthStore,rateLimit,cleanPaStorage} from './pa-storage.js';
import {mcpResponse} from './pa-mcp.js';
import {WRITE_TOOLS} from './pa-writes.js';
import {STAFF_READ_SCOPE,needsStaffRead} from './pa-staff-reads.js';

const PA_ORIGIN='https://fenmeat-sales-test.alexander-fenwick.workers.dev';
const RESOURCE=PA_ORIGIN+'/mcp',SCOPES=['fenmeat:read','fenmeat:write',STAFF_READ_SCOPE,'offline_access'];
const headers={'Cache-Control':'no-store','Pragma':'no-cache','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','Referrer-Policy':'no-referrer'};
const json=(data,status=200,extra={})=>Response.json(data,{status,headers:{...headers,...extra}});
const escape=value=>String(value).replace(/[&<>"']/g,c=>'&#'+c.charCodeAt(0)+';');
const challenge=()=>json({error:'invalid_token'},401,{'WWW-Authenticate':`Bearer resource_metadata="${PA_ORIGIN}/.well-known/oauth-protected-resource/mcp", scope="fenmeat:read"`});
function allowedRedirect(uri) {
  try {const u=new URL(uri);return u.origin==='https://chatgpt.com'&&!u.search&&!u.hash&&!u.username&&!u.password&&(u.pathname==='/connector_platform_oauth_redirect'||/^\/connector\/oauth\/[a-zA-Z0-9_-]{8,100}$/.test(u.pathname));}catch{return false;}
}
async function validAdmin(env,props) {
  if(!isAdmin(props?.username))return false;
  const key=keys(env)[props.username];
  return !!key&&props.keyFingerprint===await hash(key);
}
async function administrator(request,env) {
  const user=await authenticate(request,env);
  check(isAdmin(user.username),'Net Alex of Alinda kan hierdie verbinding bestuur.',403);
  return user;
}
function page(body,extraHeaders={}) {
  const pageHeaders=new Headers(extraHeaders);
  for(const [key,value] of Object.entries(headers))pageHeaders.set(key,value);
  pageHeaders.set('Content-Type','text/html; charset=utf-8');
  pageHeaders.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; form-action 'self' https://chatgpt.com; frame-ancestors 'none'; base-uri 'none'");
  return new Response(`<!doctype html><html lang="af"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FenMeat · ChatGPT-toegang</title><link rel="stylesheet" href="/pa-access.css"><script src="/pa-access.js" defer></script></head><body><main><a href="/">← FenMeat</a><h1>ChatGPT-toegang</h1>${body}<p id="message" role="status"></p><section id="sign-in"><h2>Meld eenmalig aan</h2><p>Gebruik jou eie Alex- of Alinda-aanmelding hier op die FenMeat-webwerf.</p><form id="login-form"><label for="username">Admin</label><select id="username" name="username" autocomplete="username"><option value="alinda">Alinda</option><option value="alex">Alex</option></select><label for="key">Wagwoord</label><input id="key" type="password" autocomplete="current-password" maxlength="200" required><button>Meld aan</button></form></section><p id="signed-in" hidden><span id="current-user"></span> <button id="switch-account" type="button" class="secondary">Gebruik ander admin</button></p></main></body></html>`,{headers:pageHeaders});
}
async function consent(request,env) {
  const oauth=env.OAUTH_PROVIDER;
  if(request.method==='GET') {
    const auth=await oauth.parseAuthRequest(request);
    check(allowedRedirect(auth.redirectUri),'Hierdie terugkeerskakel word nie toegelaat nie. Begin die koppeling in ChatGPT.',400);
    check(auth.codeChallengeMethod==='S256'&&!!auth.codeChallenge,'PKCE S256 is required.',400);
    const details=await oauth.describeConsent(auth),pending=await oauth.beginConsent(auth);
    return page(`<section><p><strong>${escape(details.clientName)}</strong> vra toegang vir ChatGPT. Toegang keer terug na <strong>${escape(details.redirectHost)}</strong>.</p><p>Jy gee toestemming om FenMeat se verkope, forecasts, produksieplanne, trolleys, resepte, voorraad, Order Guy en die bestaande FEN Zoho-fakture en ontvangste te lees.</p><p>Die verbinding kan homself hernu. Kies hieronder of dit ook data mag verander of private Staff-data mag lees. Elke wysiging word nagegaan en met sy vorige waarde aangeteken. Dit gee geen toestemming om bestellings te stuur of Zoho te verander nie. Jy kan die verbinding enige tyd hier intrek.</p><form id="consent-form" method="post"><input type="hidden" name="handle" value="${escape(pending.handle)}"><label class="scope-choice"><input type="checkbox" name="write_access" value="yes" ${auth.scope.includes('fenmeat:write')?'checked':''}>Laat ook skryftoegang toe: resepte, grondstowwe, pryse, pakgroottes, voorraad, produkte, verkope en produksie.</label><label class="scope-choice"><input type="checkbox" name="staff_read_access" value="yes" ${auth.scope.includes(STAFF_READ_SCOPE)?'checked':''}>Laat Staff-leestoegang toe: personeelprofiele, ID- en bankbesonderhede, tariewe, klokrekords, verlof en ingevoerde loongeskiedenis. Slegs lees; geen Staff-wysigings, betalings of indienings nie.</label><button name="decision" value="approve" id="approve" disabled>Bevestig gekose toegang</button><button name="decision" value="deny" class="secondary">Kanselleer</button></form></section>`,pending.headers);
  }
  check(request.method==='POST','Method not allowed.',405);sameOrigin(request);
  const form=await request.formData(),handle=String(form.get('handle')??'');
  if(form.get('decision')==='deny'){const denied=await oauth.denyConsent(request,handle);return new Response(null,{status:302,headers:denied.headers});}
  check(form.get('decision')==='approve','Choose Allow or Cancel.');
  const user=await administrator(request,env);
  const scope=['fenmeat:read',...(form.get('write_access')==='yes'?['fenmeat:write']:[]),...(form.get('staff_read_access')==='yes'?[STAFF_READ_SCOPE]:[]),'offline_access'];
  const approved=await oauth.approveConsent(request,handle,{scope});
  check(allowedRedirect(approved.request.redirectUri),'Invalid redirect URI.');
  const {redirectTo}=await oauth.completeAuthorization({request:approved.request,userId:user.username,metadata:{name:'ChatGPT · '+user.username+' · '+(scope.includes('fenmeat:write')?'FenMeat lees en skryf':'FenMeat lees')+(scope.includes(STAFF_READ_SCOPE)?' + Staff lees':'')},scope,props:{username:user.username,keyFingerprint:await hash(keys(env)[user.username])}});
  approved.headers.set('Location',redirectTo);
  return new Response(null,{status:302,headers:approved.headers});
}
async function management(request,env) {
  const user=await administrator(request,env),oauth=env.OAUTH_PROVIDER;
  if(request.method==='GET') {
    const grants=await oauth.listUserGrants(user.username,{limit:100});
    return json({username:user.username,endpoint:RESOURCE,grants:grants.items.map(g=>({id:g.id,name:g.metadata?.name??'ChatGPT',write_access:g.scope.includes('fenmeat:write'),staff_read_access:g.scope.includes(STAFF_READ_SCOPE),created_at:new Date(g.createdAt*1000).toISOString(),expires_at:g.expiresAt?new Date(g.expiresAt*1000).toISOString():null})),more:!!grants.cursor});
  }
  check(request.method==='POST','Method not allowed.',405);sameOrigin(request);
  const body=await request.json();check(typeof body.grant_id==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(body.grant_id),'Choose an existing connection.');
  await oauth.revokeGrant(body.grant_id,user.username);
  return json({revoked:true});
}
const provider=new OAuthProvider({
  apiRoute:'/mcp',authorizeEndpoint:'/oauth/authorize',tokenEndpoint:'/oauth/token',clientRegistrationEndpoint:'/oauth/register',
  resourceMetadata:{resource:RESOURCE,authorization_servers:[PA_ORIGIN],resource_name:'FenMeat app access'},
  scopesSupported:SCOPES,requiredScopes:['fenmeat:read'],
  accessTokenTTL:900,refreshTokenTTL:7776000,refreshTokenIdleTTL:7776000,clientRegistrationTTL:undefined,
  allowTokenExchangeGrant:false,clientIdMetadataDocumentEnabled:false,
  // Avoid echoing library/client error descriptions into platform logs.
  onError:()=>{},
  clientRegistrationCallback({clientMetadata}) {
    if(!Array.isArray(clientMetadata.redirect_uris)||!clientMetadata.redirect_uris.length||!clientMetadata.redirect_uris.every(allowedRedirect)||clientMetadata.software_statement)return {description:'Only registered ChatGPT HTTPS callbacks are allowed.'};
  },
  async tokenExchangeCallback({env,props}) {
    if(!await validAdmin(env,props))throw new OAuthError('invalid_grant',{description:'App access was revoked. Connect again using your own Alex or Alinda admin account.'});
  },
  apiHandler:{async fetch(request,env,ctx) {
    if(new URL(request.url).pathname!=='/mcp')return json({error:'Not found.'},404);
    if(!ctx.auth?.scope?.includes('fenmeat:read'))return insufficientScope(ctx.auth,['fenmeat:read']);
    if(!await validAdmin(env,ctx.props))return challenge();
    if(!await rateLimit(env.DB,'mcp:'+ctx.auth.userId,120,60))return json({error:'Too many app requests. Try again shortly.'},429,{'Retry-After':'60'});
    if(request.method==='POST'){
      let rpc;try{rpc=await request.clone().json();}catch{}
      if(rpc?.method==='tools/call'&&WRITE_TOOLS.has(rpc.params?.name)&&!ctx.auth.scope.includes('fenmeat:write'))return insufficientScope(ctx.auth,['fenmeat:read','fenmeat:write'],'Approve write access using your own Alex or Alinda admin account before saving.');
      if(rpc?.method==='tools/call'&&needsStaffRead(rpc.params?.name,rpc.params?.arguments)&&!ctx.auth.scope.includes(STAFF_READ_SCOPE))return insufficientScope(ctx.auth,['fenmeat:read',...(ctx.auth.scope.includes('fenmeat:write')?['fenmeat:write']:[]),STAFF_READ_SCOPE],'Reconnect and approve separate Staff read access using your own Alex or Alinda admin account.');
    }
    return mcpResponse(request,env,ctx.props.username,ctx.auth.scope);
  }},
  defaultHandler:{async fetch(request,env) {
    const path=new URL(request.url).pathname;
    if(path==='/oauth/authorize')return consent(request,env);
    if(path==='/api/pa/connections')return management(request,env);
    return json({error:'Not found.'},404);
  }},
});
const integrationPath=path=>path==='/mcp'||path.startsWith('/mcp/')||path.startsWith('/oauth/')||path.startsWith('/.well-known/oauth-')||path==='/api/pa/connections';
export default {async scheduled(event,env,ctx){await queueTaskReminders(env);await flushTaskPush(env);},async fetch(request,env,ctx) {
  const url=new URL(request.url),path=url.pathname;
  if(['/pa-access','/pa-access/'].includes(path)&&request.method==='GET')return page(`<p>ChatGPT kan met jou toestemming FenMeat se data lees en verander. Elke verbinding se toegang verskyn hieronder. Vir Staff: herverbind die bestaande FenMeat-koppeling in ChatGPT en merk “Laat Staff-leestoegang toe” op die FenMeat-toestemmingsblad. Behou “Laat ook skryftoegang toe” indien jy steeds Sales en Production deur ChatGPT wil wysig. Staff is slegs lees. Bestaande verbindings kry nie vanself Staff-toegang nie.</p><section id="connections" hidden><h2>Verbindings</h2><div id="grants"></div></section><p>Om te koppel: open ChatGPT se Plugins, kies + en Add custom MCP server. Gebruik OAuth en hierdie adres:</p><p class="endpoint">${RESOURCE}</p>`);
  if(!integrationPath(path))return app.fetch(request,env,ctx);
  try {
    check(env.APP_ENV==='test'&&url.origin===PA_ORIGIN,'Connection endpoint is not configured.',503);
    const origin=request.headers.get('Origin');
    check(!origin||origin===PA_ORIGIN||origin==='https://chatgpt.com','Origin is not allowed.',403);
    if(request.method==='POST') {
      const maxBody=path==='/mcp'?750000:65536;
      check(Number(request.headers.get('Content-Length')??0)<=maxBody,'Request too large.',413);
      check((await request.clone().arrayBuffer()).byteLength<=maxBody,'Request too large.',413);
    }
    await initPaStorage(env.DB);
    const oauthEnv={...env,OAUTH_KV:oauthStore(env.DB)};
    if(path==='/oauth/register'||path==='/oauth/authorize'||path==='/oauth/token') {
      const ip=await hash(request.headers.get('CF-Connecting-IP')??'local');
      const registering=path==='/oauth/register';
      if(!await rateLimit(env.DB,path+':'+ip,registering?20:120,registering?3600:60))return json({error:'Too many connection requests. Try again later.'},429,{'Retry-After':registering?'3600':'60'});
    }
    const response=await provider.fetch(request,oauthEnv,ctx);
    const safeHeaders=new Headers(response.headers);for(const [key,value] of Object.entries(headers))safeHeaders.set(key,value);
    // Browser form POSTs can send Origin: null under no-referrer. Same-origin
    // retains the CSRF origin check and still sends no referrer to ChatGPT.
    if(safeHeaders.get('Content-Type')?.startsWith('text/html'))safeHeaders.set('Referrer-Policy','same-origin');
    // Request cleanup only changes expired authentication records, never business data.
    if(path==='/oauth/token'&&response.ok)ctx.waitUntil(cleanPaStorage(env.DB));
    return new Response(response.body,{status:response.status,headers:safeHeaders});
  }catch(error) {
    if(error instanceof AuthorizationError&&error.redirectTo)return new Response(null,{status:302,headers:{...headers,Location:error.redirectTo}});
    if(error instanceof AuthorizationError)return json({error:'The connection request expired or was invalid. Start the connection again in ChatGPT.'},400);
    return json({error:error instanceof UserError?error.message:'The connection request could not be completed. Check the saved app data before retrying a save.'},error instanceof UserError?error.status:500);
  }
}};
