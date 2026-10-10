import test from 'node:test';
import assert from 'node:assert/strict';
import {aggregateProductionDemand,buildProductionPlan,productionProfile,productionSummary,createProductionTrolley,validateProductionEdits,normaliseProductionPlan} from '../src/production.js';
const codes=['R01','R02','R03','R04','R05','R06','R07','V01','V02','P02','P03','P04','W01','W07','B01'];
function make(){return buildProductionPlan({date:'2026-10-07',target_date:'2026-10-08',routes:['MB'],snapshot:'test',items:codes.map(code=>({code,name:code,unit:'bag',demand:0,breakdown:[],...productionProfile({code,name:code})}))});}
function row(a='',b='',casings={}){return {...createProductionTrolley(),slot1:a,slot2:b,casings:{P02:0,P03:0,P04:0,...casings}};}
function chosen(p){for(const i of p.items){i.stock=0;i.pack_plan=0;i.casing_plan=0;i.coldroom_casings=0;}for(const g of p.groups){g.planned=0;g.coldroom_batches=0;}return p;}
const requirement=(s,id)=>s.trolley.requirements.find(r=>r.id===id);
test('manual batch requirements drive two-recipe trolleys with mixed recipes and no automatic assignments',()=>{
 const p=chosen(make());for(const [id,q] of Object.entries({RUSSIAN:3,R05:1,R06:2,R07:2,V01:1,V02:.5,POLONY:2}))p.groups.find(g=>g.id===id).planned=q;
 let s=productionSummary(p);assert.deepEqual(p.trolleys,[]);assert.equal(requirement(s,'RUSSIAN').remaining,3);assert.equal(s.trolley.requirements.length,7);assert.equal(s.trolley.recipes.length,9);
 p.trolleys=[row('R05','RUSSIAN'),row('RUSSIAN','RUSSIAN'),row('R06','R06'),row('V01','V02_HALF'),row('R07','R07'),row('POLONY','POLONY',{P02:1,P03:3,P04:4})];
 [1,3,4].forEach((n,index)=>p.items.find(i=>i.code===['P02','P03','P04'][index]).casing_plan=n);
 s=productionSummary(p);assert.ok(s.trolley.requirements.every(r=>r.remaining===0));assert.equal(s.trolley.rows.length,6);assert.equal(s.trolley.rows[5].casing_capacity,8);assert.equal(s.trolley.warnings.length,0);assert.ok(s.trolley.rows[0].slots.every(slot=>!slot.detail.includes('1310 sales')));
 assert.ok(!s.trolley.recipes.some(r=>['W01','W07','B01'].includes(r.group)));
});
test('recipe requirements preview suggestions until a manual decision, and already cooked stock is not counted twice',()=>{
 const p=make();for(const i of p.items){i.stock=0;i.pack_plan=0;i.coldroom_casings=0;}
 const r=p.items.find(i=>i.code==='R01'),g=p.groups.find(g=>g.id==='RUSSIAN');r.pack_plan=r.yield_qty*3;g.coldroom_batches=1;
 let req=requirement(productionSummary(p),'RUSSIAN');assert.equal(req.required,2);assert.match(req.basis,/Suggestion/);
 g.planned=4;assert.equal(requirement(productionSummary(p),'RUSSIAN').required,4);g.planned=0;p.trolleys=[row('RUSSIAN','RUSSIAN')];req=requirement(productionSummary(p),'RUSSIAN');assert.equal(req.required,0);assert.equal(req.remaining,-2);assert.equal(req.basis,'My plan');
 g.planned=null;g.coldroom_batches=null;assert.equal(requirement(productionSummary(p),'RUSSIAN').required,null,'Missing count must not become zero');
});
test('need changes preserve every selected recipe, order, empty row and casing allocation',()=>{
 const p=chosen(make());p.groups.find(g=>g.id==='RUSSIAN').planned=3;p.trolleys=[row('RUSSIAN','R06'),row(),row('POLONY','POLONY',{P02:1,P03:3,P04:4})];const saved=structuredClone(p.trolleys);
 p.groups.find(g=>g.id==='RUSSIAN').planned=0;productionSummary(p);assert.deepEqual(p.trolleys,saved);
 const fresh=buildProductionPlan({date:p.date,target_date:p.target_date,routes:p.routes,items:p.items,snapshot:'new',previous:p});assert.deepEqual(fresh.trolleys,saved);
 const edits=structuredClone(p);delete edits.trolleys;assert.deepEqual(validateProductionEdits(edits,p).trolleys,saved,'Old client omits, not clears');
 edits.trolleys=[];assert.deepEqual(validateProductionEdits(edits,p).trolleys,[],'Explicit clear is saved');
 const tomorrow=buildProductionPlan({date:'2026-10-08',target_date:'2026-10-09',routes:p.routes,items:p.items,snapshot:'new',settingsPlan:p});assert.deepEqual(tomorrow.trolleys,[]);
 delete edits.trolleys;const raw=JSON.stringify(edits);assert.deepEqual(normaliseProductionPlan(edits).trolleys,[]);assert.equal(JSON.stringify(edits),raw);
});
test('Vienna full/half selections use their real fraction and half batches are editable only for Vienna',()=>{
 const p=chosen(make()),g=p.groups.find(g=>g.id==='V01');g.planned=1.5;p.trolleys=[row('V01','V01_HALF')];let s=productionSummary(p);assert.equal(requirement(s,'V01').assigned,1.5);assert.equal(requirement(s,'V01').remaining,0);assert.match(s.trolley.rows[0].slots[1].detail,/16 sales units/);assert.equal(validateProductionEdits(p,p).groups.find(g=>g.id==='V01').planned,1.5);
 g.planned=.5;p.trolleys=[row('V01_HALF','')];assert.equal(productionSummary(p).trolley.warnings.length,0,'A deliberately partially loaded trolley is valid');
 p.groups.find(g=>g.id==='R06').planned=.5;assert.throws(()=>validateProductionEdits(p,p));p.groups.find(g=>g.id==='R06').planned=0;g.planned=.25;assert.throws(()=>validateProductionEdits(p,p));g.planned='1.5';assert.throws(()=>validateProductionEdits(p,p));
});
test('polony casing allocations are counted once and checked against selected polony slots and each size plan',()=>{
 const p=chosen(make());p.groups.find(g=>g.id==='POLONY').planned=2;[1,3,4].forEach((n,index)=>p.items.find(i=>i.code===['P02','P03','P04'][index]).casing_plan=n);
 p.trolleys=[row('POLONY','POLONY',{P02:1,P03:3,P04:4})];let s=productionSummary(p).trolley;assert.equal(s.rows.length,1);assert.equal(s.requirements.find(r=>r.id==='POLONY').assigned,2);assert.ok(s.casing_requirements.every(r=>r.remaining===0));assert.equal(s.warnings.length,0);
 p.trolleys[0].slot2='RUSSIAN';s=productionSummary(p).trolley;assert.equal(s.rows[0].casing_capacity,4);assert.ok(s.warnings.some(w=>w.includes('exceed')));assert.deepEqual(p.trolleys[0].casings,{P02:1,P03:3,P04:4},'Recipe change never wipes casing choices');
 p.trolleys[0].slot1='';s=productionSummary(p).trolley;assert.equal(s.rows[0].show_casings,true);assert.equal(s.rows[0].casing_capacity,0);
});
test('server rejects unknown recipes, duplicate IDs, extra positions, invalid casings and more than eight trolleys',()=>{
 const p=chosen(make());p.trolleys=[row('RUSSIAN','R06')];const bads=[q=>q.trolleys[0].slot1='W01',q=>q.trolleys[0].slot3='R05',q=>q.trolleys.push(structuredClone(q.trolleys[0])),q=>q.trolleys[0].casings.P02=.5,q=>q.trolleys[0].casings.P02=-1,q=>q.trolleys[0].casings.P03=9,q=>q.trolleys=Array.from({length:9},()=>row()),q=>q.trolleys=null];
 for(const change of bads){const q=structuredClone(p);change(q);assert.throws(()=>validateProductionEdits(q,p));}
 p.trolleys=Array.from({length:8},()=>row());assert.equal(validateProductionEdits(p,p).trolleys.length,8);p.groups.find(g=>g.id==='RUSSIAN').planned=17;assert.ok(productionSummary(p).trolley.warnings.some(w=>w.includes('More than eight')));
});
