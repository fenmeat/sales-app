import {buildPushPayload} from './webpush-bundle.js';
import {check,UserError} from './domain.js';
import {hash} from './auth.js';
import {ensureTaskSchema,taskUsers} from './tasks-api.js';

const b64=bytes=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
export function allowedPushEndpoint(value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&value.length<2000&&(/^(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com|[a-z0-9-]+\.push\.apple\.com|web\.push\.apple\.com)$/.test(u.hostname));}catch{return false;}
}
async function pushKeys(db){
 let row=await db.prepare('SELECT payload FROM v2_task_push_keys WHERE id=1').first();
 if(!row){const pair=await crypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);const publicKey=b64(await crypto.subtle.exportKey('raw',pair.publicKey)),privateKey=(await crypto.subtle.exportKey('jwk',pair.privateKey)).d;
  await db.prepare('INSERT OR IGNORE INTO v2_task_push_keys VALUES(1,?)').bind(JSON.stringify({publicKey,privateKey})).run();row=await db.prepare('SELECT payload FROM v2_task_push_keys WHERE id=1').first();}
 return JSON.parse(row.payload);
}
export async function pushApi({request,env,user,bodyOf}){
 check(taskUsers(env).includes(user.username),'This account cannot use Tasks.',403);
 if(request.method==='GET')return {public_key:(await pushKeys(env.DB)).publicKey};
 check(request.method==='POST','Method not allowed.',405);const b=await bodyOf(request);
 check(allowedPushEndpoint(b.endpoint),'This browser notification service is not supported.');const endpointHash=await hash(b.endpoint);
 if(b.remove){await env.DB.prepare('DELETE FROM v2_task_push_subscriptions WHERE endpoint_hash=? AND username=?').bind(endpointHash,user.username).run();return {saved:true};}
 check(b.keys&&/^[A-Za-z0-9_-]{80,100}$/.test(b.keys.p256dh??'')&&/^[A-Za-z0-9_-]{20,30}$/.test(b.keys.auth??''),'Invalid browser notification subscription.');
 const existing=await env.DB.prepare('SELECT username FROM v2_task_push_subscriptions WHERE endpoint_hash=?').bind(endpointHash).first();
 if(existing?.username!==user.username){const count=await env.DB.prepare('SELECT COUNT(*) n FROM v2_task_push_subscriptions WHERE username=?').bind(user.username).first();check(count.n<3,'Notifications are already enabled on three browsers. Disable one before adding another.');}
 // This browser belongs to the person currently signed in. Never retain two owners.
 await env.DB.prepare('INSERT INTO v2_task_push_subscriptions VALUES(?,?,?,?) ON CONFLICT(endpoint_hash) DO UPDATE SET username=excluded.username,payload=excluded.payload,updated_at=excluded.updated_at').bind(endpointHash,user.username,JSON.stringify({endpoint:b.endpoint,keys:b.keys}),new Date().toISOString()).run();return {saved:true};
}
export async function flushTaskPush(env){
 await ensureTaskSchema(env.DB);
 const now=new Date().toISOString();
 const due=await env.DB.prepare('SELECT n.* FROM v2_task_notifications n WHERE n.push_sent_at IS NULL AND n.read_at IS NULL AND (n.next_attempt IS NULL OR n.next_attempt<=?) AND EXISTS(SELECT 1 FROM v2_task_push_subscriptions s WHERE s.username=n.username) ORDER BY n.created_at LIMIT 5').bind(now).all();
 if(!due.results.length)return {sent:0};const vapid=await pushKeys(env.DB);let sent=0;
 for(const n of due.results){
  if(!taskUsers(env).includes(n.username))continue;
  const subscriptions=await env.DB.prepare('SELECT * FROM v2_task_push_subscriptions WHERE username=?').bind(n.username).all();let failed=false;
  for(const row of subscriptions.results){
   try{const subscription=JSON.parse(row.payload);if(!allowedPushEndpoint(subscription.endpoint))throw new UserError('Invalid push endpoint.');
    const payload=await buildPushPayload({data:JSON.stringify({title:'FenMeat Tasks',body:n.kind==='completed'?'A task you created is complete.':n.kind==='assigned'?'A task has been assigned to you.':'A task has an update.',tag:n.id,url:'/tasks?task='+encodeURIComponent(n.task_id)}),options:{ttl:86400}},subscription,{...vapid,subject:'https://fenmeat-sales-test.alexander-fenwick.workers.dev'});
    const response=await fetch(subscription.endpoint,{...payload,redirect:'manual'});
    if([404,410].includes(response.status))await env.DB.prepare('DELETE FROM v2_task_push_subscriptions WHERE endpoint_hash=?').bind(row.endpoint_hash).run();
    else if(!response.ok)failed=true;
   }catch{failed=true;}
  }
  const next=new Date(Date.now()+Math.min(3600,60*2**Math.min(n.push_attempts,6))*1000).toISOString();
  await env.DB.prepare('UPDATE v2_task_notifications SET push_attempts=push_attempts+1,next_attempt=?,push_sent_at=? WHERE id=?').bind(failed?next:null,failed?null:now,n.id).run();if(!failed)sent++;
 }
 return {sent};
}
export async function queueTaskReminders(env){
 await ensureTaskSchema(env.DB);const now=new Date(),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Johannesburg'}).format(now);
 await env.DB.prepare(`INSERT OR IGNORE INTO v2_task_notifications(id,username,task_id,kind,created_at)
 SELECT 'reminder-'||e.task_id||'-'||?,json_extract(e.payload,'$.assigned_to'),e.task_id,'due',?
 FROM v2_task_events e JOIN (SELECT task_id,MAX(revision) revision FROM v2_task_events GROUP BY task_id) l ON l.task_id=e.task_id AND l.revision=e.revision
 WHERE json_extract(e.payload,'$.status') IN ('Pending','Waiting') AND
 (CASE WHEN json_extract(e.payload,'$.status')='Waiting' THEN json_extract(e.payload,'$.review_date') ELSE COALESCE(NULLIF(json_extract(e.payload,'$.due_date'),''),json_extract(e.payload,'$.review_date')) END) BETWEEN '2000-01-01' AND ?`).bind(date,now.toISOString(),date).run();
}
