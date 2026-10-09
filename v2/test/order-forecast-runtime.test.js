import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {addDays,weekday} from '../src/domain.js';

test('real Worker exports current forecast days, draft fallback and confirmed zero without modifying any business records',async t=>{
 const origin='https://orders-local.example',key='synthetic-local-order-test-key-012345678901';
 const mf=new Miniflare(convertV4MiniflareOptions({name:'order-forecast-test',modules:['worker','order-guy-api','order-guy','stocktake','register-corrections','production-api','production','domain','forecast','month-cycle','forecast-history','auth','schema','zoho','zoho-matching'].map(n=>({type:'ESModule',path:fileURLToPath(new URL('../src/'+n+'.js',import.meta.url))})),compatibilityDate:'2026-09-30',d1Databases:{DB:'order-forecast-test'},bindings:{APP_ENV:'test',APP_ACCESS_KEYS:JSON.stringify({alex:key})},outboundService:()=>{throw Error('No outbound traffic in tests');}}));
 t.after(()=>mf.dispose());let cookie='';
 async function call(path,body){const response=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:cookie},body:body?JSON.stringify(body):undefined});const data=await response.json();assert.equal(response.status,200,JSON.stringify(data));return {data,headers:response.headers};}
 cookie=(await call('/api/login',{username:'alex',key})).headers.get('set-cookie').split(';')[0];
 const catalog={products:[{code:'W01',name:'Synthetic',unit:'bag',price_cents:100,active:true,available:true}],routes:[2,3,4,5].map(day=>({code:'T'+day,name:'Test '+day,weekday:day}))};
 await call('/api/catalog',{revision:0,catalog});const db=await mf.getD1Database('DB');
 for(let d='2026-08-01';d<'2026-10-01';d=addDays(d,1))if([2,3,4,5].includes(weekday(d)))await db.prepare('INSERT INTO v2_history VALUES(?,?,?,?,?,?,?)').bind(d,'T'+weekday(d),'W01',10,'verified','Synthetic actual sales',0).run();
 const material=id=>({id,name:id,unit:'kg',supplier:'Test',pack_qty:5,procure:true,source:'Test',notes:'',price:{amount:1,status:'verified',date:'2026-10-01',valid_until:null,source:'Test invoice'},stock:{qty:0,date:'2026-10-12',reserve:0,incoming:[],source:'Test opening balance'}});
 const register={schema_version:1,notes:'',materials:[material('RAW'),{...material('PACK'),unit:'unit'}],recipes:[{group:'W01',name:'Synthetic recipe',version:1,effective_date:'2026-10-01',status:'approved',complete:true,batch_kg:10,ingredients:[{material:'RAW',qty:10,unit:'kg',status:'approved',note:''}],consumables:[],source:'Test recipe',notes:'',forecast_yields:[{product:'W01',qty:13,status:'approved',source:'Measured output for test recipe v1'}]}],packaging:[{product:'W01',complete:true,source:'Test packing',notes:'',lines:[{material:'PACK',qty:1,unit:'unit',status:'approved',note:''}]}]};
 await call('/api/recipes',{register,revision:0,reason:'Synthetic testing register',request_id:crypto.randomUUID()});
 const forecast=(await call('/api/run?date=2026-10-13&route=T2')).data;
 const demand=forecast.run.items[0].forecast.qty;assert(demand>0);
 forecast.run.items[0].planned=999;await call('/api/run',{run:forecast.run,revision:0,action:'save',request_id:crypto.randomUUID()});
 for(const [date,confirmed] of [['2026-10-13',false],['2026-10-14',true]]){const p=(await call('/api/production?date='+date)).data;p.plan.groups[0].planned=confirmed?0:999;await call('/api/production',{plan:p.plan,revision:0,action:confirmed?'confirm':'save',acknowledge_warnings:true,request_id:crypto.randomUUID()});}
 const tables=['v2_events','v2_production_events','v2_recipe_events','v2_history','v2_catalog'];
 async function snapshot(){return Promise.all(tables.map(async table=>(await db.prepare('SELECT * FROM '+table).all()).results));}
 const before=await snapshot(),r=(await call('/api/order-guy?from=2026-10-12&to=2026-10-14')).data;
 assert.deepEqual(r.coverage.map(c=>c.status),['forecast','forecast','confirmed_plan']);assert.equal(r.coverage[1].replaced_draft_revision,1);
 const raw=r.rows.find(x=>x.material==='RAW'),pack=r.rows.find(x=>x.material==='PACK');
 assert.equal(raw.gross,20);assert.equal(raw.early_month_reserve,3);assert.equal(raw.net,23);assert.equal(raw.order_packs,5);assert.equal(pack.gross,demand*2);assert.equal(raw.contributions.length,2);
 assert.equal(r.coverage[0].target_date,'2026-10-13');assert.equal(r.coverage[0].sources[0].snapshot,forecast.forecast_status.snapshot);assert.equal(r.plans[0].plan.groups[0].planned,999);assert.equal(r.plans[0].plan.items[0].stock,null);
 assert.deepEqual(await snapshot(),before);
 // The sync export uses exactly the same calculation; only generation time changes.
 const again=(await call('/api/sync/order-guy?from=2026-10-12&to=2026-10-14')).data;delete r.generated_at;delete again.generated_at;assert.deepEqual(again,r);assert.deepEqual(await snapshot(),before);
});
