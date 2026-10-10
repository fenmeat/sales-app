import test from 'node:test';import assert from 'node:assert/strict';
import {aggregateProductionDemand,buildProductionPlan,productionProfile,productionSummary,applyProductionSuggestion,validateProductionEdits,nextProductionTarget,normaliseProductionPlan,upgradeBabalasRecipe,productionPlanningView,babalasRecipeUpdateNeeded} from '../src/production.js';
const product=(code='W01')=>({code,name:code,unit:'bag',active:true,available:true});
function make(codes=['W01']){const p=buildProductionPlan({date:'2026-10-07',target_date:'2026-10-08',routes:['MB','PL'],snapshot:'test',items:codes.map(code=>({...product(code),...productionProfile(product(code)),demand:30,breakdown:[]}))});for(const g of p.groups)if(['shared','cooked'].includes(g.mode))g.coldroom_batches=0;for(const i of p.items)if(i.mode==='casings')i.coldroom_casings=0;return p;}
test('24 Babalas units require one new 2-pack batch after cooked stock is counted',()=>{
 const p=make(['R07']);Object.assign(p.items[0],{demand:24,stock:0,pack_plan:24});p.groups[0].coldroom_batches=null;
 assert.equal(p.items[0].recipe_version,2);assert.equal(p.items[0].yield_qty,46);
 let s=productionSummary(p).groups[0];assert.equal(s.suggested,null);assert.ok(s.warnings.some(w=>w.includes('enter 0 if none')));
 p.groups[0].coldroom_batches=0;assert.equal(productionSummary(p).groups[0].suggested,1);
 p.groups[0].coldroom_batches=1;assert.equal(productionSummary(p).groups[0].suggested,0);
});
test('explicit recipe update preserves physical quantities and history while resetting only affected cooking choices',()=>{
 const old=make(['R07','V01']);delete old.items[0].recipe_version;Object.assign(old.items[0],{yield_qty:23,stock:4,pack_plan:24,actual:22});Object.assign(old.groups[0],{planned:2,coldroom_batches:1.5});old.groups[1].planned=2;
 old.trolleys=[{id:'mixed',slot1:'R07',slot2:'V01',casings:{P02:0,P03:0,P04:0}}];const before=structuredClone(old);
 assert.equal(babalasRecipeUpdateNeeded(old),true);const p=upgradeBabalasRecipe(old);
 assert.deepEqual(old,before);assert.equal(p.items[0].yield_qty,46);assert.equal(p.groups[0].coldroom_batches,.75);assert.equal(p.groups[0].planned,null);
 for(const field of ['stock','pack_plan','actual'])assert.equal(p.items[0][field],old.items[0][field]);
 assert.equal(p.groups[1].planned,2);assert.equal(p.trolleys[0].slot1,'');assert.equal(p.trolleys[0].slot2,'V01');assert.equal(p.babalas_recipe_update.previous_trolleys[0].slot1,'R07');
 assert.equal(babalasRecipeUpdateNeeded(p),false);assert.throws(()=>upgradeBabalasRecipe(p),/already/);assert.doesNotThrow(()=>validateProductionEdits(p,p));
 const fresh=make(['R07','V01']);const refresh=buildProductionPlan({date:p.date,target_date:p.target_date,routes:p.routes,items:fresh.items,snapshot:'refresh',previous:p});assert.deepEqual(refresh.babalas_recipe_update,p.babalas_recipe_update);
 const next=buildProductionPlan({date:'2026-10-08',target_date:'2026-10-09',routes:p.routes,items:fresh.items,snapshot:'next',yieldSettings:old.items,settingsPlan:old});assert.equal(next.items[0].yield_qty,46);assert.equal(next.groups[0].coldroom_batches,null);
 old.groups[0].coldroom_batches=.001;const tiny=upgradeBabalasRecipe(old);assert.equal(tiny.groups[0].coldroom_batches,.0005);assert.doesNotThrow(()=>validateProductionEdits(tiny,tiny));
});
test('availability filters current production, shared sizes and trolley instructions without rewriting saved decisions',()=>{
 const p=make(['C01','R01','R02','R07']);for(const i of p.items){i.stock=0;i.pack_plan=20;}p.trolleys=[{id:'mixed',slot1:'R07',slot2:'RUSSIAN',casings:{P02:0,P03:0,P04:0}}];
 const catalog={products:p.items.map(i=>({...product(i.code),available:i.code==='R02'}))},before=structuredClone(p);
 const view=productionPlanningView(p,catalog,p.date);assert.deepEqual(view.items.map(i=>i.code),['R02']);assert.deepEqual(view.groups.map(g=>g.id),['RUSSIAN']);assert.equal(view.trolleys[0].slot1,'');assert.equal(view.trolleys[0].slot2,'RUSSIAN');assert.deepEqual(p,before);
 assert.equal(productionSummary(view).groups[0].suggested,1);assert.deepEqual(productionPlanningView(p,catalog,'2026-10-08'),normaliseProductionPlan(p));
 for(const product of catalog.products)product.available=true;assert.equal(productionPlanningView(p,catalog,p.date).items.length,4);
});
test('Braaiwors: total need 30, post-dispatch stock 10, two complete recipes and six bags left',()=>{const p=make();p.items[0].stock=10;const s=productionSummary(p).groups[0];assert.equal(s.suggested,2);assert.equal(p.groups[0].planned,null);applyProductionSuggestion(p,'W01');const planned=productionSummary(p).groups[0];assert.equal(planned.output,26);assert.equal(planned.balances[0].balance,6);p.groups[0].planned=1;assert.equal(productionSummary(p).groups[0].balances[0].balance,-7);assert.ok(productionSummary(p).groups[0].warnings.includes('My plan leaves a shortage'));});
test('enough stock gives zero, blank stock stays unknown, zero plan is kept',()=>{const p=make();assert.equal(productionSummary(p).groups[0].suggested,null);assert.equal(applyProductionSuggestion(p,'W01'),false);p.items[0].stock=30;assert.equal(productionSummary(p).groups[0].suggested,0);p.groups[0].planned=0;p.items[0].stock=0;assert.equal(applyProductionSuggestion(p,'W01',{blankOnly:true}),false);assert.equal(p.groups[0].planned,0);});
test('route quantities use manual override including zero; incomplete forecast remains unknown',()=>{const ps=[product()];const source=(route,planned,forecast)=>({route,name:route,revision:1,run:{items:[{code:'W01',planned}]},forecasts:{W01:{qty:forecast}}});assert.equal(aggregateProductionDemand(ps,[source('A',0,25),source('B',30,90)])[0].demand,30);assert.equal(aggregateProductionDemand(ps,[source('A',null,12),source('B',null,null)])[0].demand,null);});
test('shared Russian sizes round once and packing cannot exceed batch capacity silently',()=>{const p=make(['R01','R02']);p.items[0].demand=10;p.items[1].demand=10;for(const i of p.items)i.stock=0;assert.equal(productionSummary(p).groups[0].suggested,1);applyProductionSuggestion(p,'RUSSIAN');assert.equal(p.groups[0].planned,1);assert.deepEqual(p.items.map(i=>i.pack_plan),[10,10]);p.items[0].pack_plan=30;assert.ok(productionSummary(p).groups[0].warnings.includes('Packing plan exceeds cooked stock plus new batches'));});
test('owner polony example uses eight casings, one trolley, two batches; bought-in units stay units',()=>{const p=make(['P02','P03','P04','B01']);for(const i of p.items)i.stock=0;[20,42,32].forEach((q,n)=>p.items[n].demand=q);const s=productionSummary(p),g=s.groups.find(g=>g.id==='POLONY');assert.deepEqual(g.rows.map(i=>i.casing_suggested),[1,3,4]);assert.equal(g.new_casings,8);assert.equal(g.trolleys,1);assert.equal(g.suggested,2);assert.equal(s.groups.find(g=>g.id==='B01').suggested,30);applyProductionSuggestion(p,'POLONY');assert.deepEqual(p.items.slice(0,3).map(i=>i.casing_plan),[1,3,4]);assert.equal(productionSummary(p).groups[0].has_decision,true);});
test('refresh retains manual plan, stock, yield, actual output and product history',()=>{const p=make();Object.assign(p.items[0],{stock:10,yield_qty:14,actual:29});p.groups[0].planned=0;p.notes='Keep me';const next=buildProductionPlan({date:p.date,target_date:p.target_date,routes:p.routes,items:[{...p.items[0],demand:100}],snapshot:'changed',previous:p});assert.equal(next.items[0].stock,10);assert.equal(next.items[0].yield_qty,14);assert.equal(next.items[0].actual,29);assert.equal(next.groups[0].planned,0);assert.equal(next.notes,'Keep me');});
test('manual batches are whole; unsupported yields do not create a made-up suggestion',()=>{const p=make(['X01']);p.items[0].stock=0;assert.equal(productionSummary(p).groups[0].suggested,null);const v=structuredClone(p);v.groups[0].planned=.5;assert.throws(()=>validateProductionEdits(v,p));v.groups[0].planned=0;v.items[0].stock=-1;assert.throws(()=>validateProductionEdits(v,p));v.items[0].stock=0;v.items[0].yield_qty=0;assert.throws(()=>validateProductionEdits(v,p));});
test('next production target skips days with no scheduled routes',()=>{assert.equal(nextProductionTarget('2026-10-09',[{weekday:1}]),'2026-10-12');});
test('shared suggestion follows entered packing amounts, fills only blanks and keeps manual batch decisions',()=>{
 const p=make(['R01','R02','R03','R04']);
 for(const i of p.items){i.stock=0;i.demand=0;}
 Object.assign(p.items[0],{demand:40,stock:26});p.items[1].demand=25;
 assert.equal(productionSummary(p).groups[0].suggested,2);
 p.items[0].pack_plan=100;
 assert.equal(productionSummary(p).groups[0].suggested,6,'100 R6 plus 25 R5 needs six whole batches');
 assert.equal(p.groups[0].planned,null,'A suggestion does not silently choose My plan');
 assert.equal(applyProductionSuggestion(p,'RUSSIAN'),true);
 assert.equal(p.groups[0].planned,6);
 assert.deepEqual(p.items.map(i=>i.pack_plan),[100,25,0,0],'Accept keeps entered packing and fills blanks');
 p.items[0].pack_plan=120;
 assert.equal(productionSummary(p).groups[0].suggested,7);
 assert.equal(p.groups[0].planned,6,'Existing manual batches stay editable and are not overwritten');
 assert.ok(productionSummary(p).groups[0].warnings.includes('Packing plan exceeds cooked stock plus new batches'));
 applyProductionSuggestion(p,'RUSSIAN');assert.equal(p.groups[0].planned,7);assert.equal(p.items[0].pack_plan,120);
});
test('explicit packing zero wins over shortage and stock is not deducted from new packing twice',()=>{
 const p=make(['R01','R02']);for(const i of p.items)i.stock=0;
 Object.assign(p.items[0],{stock:26,demand:40,pack_plan:100});p.items[1].pack_plan=0;
 assert.equal(productionSummary(p).groups[0].suggested,5);
 assert.equal(applyProductionSuggestion(p,'RUSSIAN',{blankOnly:true}),true);
 assert.equal(p.groups[0].planned,5);assert.deepEqual(p.items.map(i=>i.pack_plan),[100,0]);
 p.groups[0].planned=0;assert.equal(applyProductionSuggestion(p,'RUSSIAN',{blankOnly:true}),false);assert.equal(p.groups[0].planned,0);
 p.items[0].pack_plan=0;assert.equal(productionSummary(p).groups[0].suggested,0);
});
test('shared packing basis handles incomplete counts, clearing an override and polony combined rounding',()=>{
 const p=make(['P02','P03']);p.items[0].pack_plan=20;p.items[1].pack_plan=56;
 assert.equal(productionSummary(p).groups[0].suggested,2,'Complete packing quantities can be calculated before stock is counted');
 p.items[1].pack_plan=null;assert.equal(productionSummary(p).groups[0].suggested,null,'Unknown blank size is not silently zero');
 p.items[1].stock=0;assert.equal(productionSummary(p).groups[0].suggested,1,'Blank size falls back to its shortage');
 p.items[0].stock=30;p.items[0].pack_plan=null;assert.equal(productionSummary(p).groups[0].suggested,1,'Clearing an override restores shortage basis');
 const r=make(['R01','R02']);for(const i of r.items){i.stock=0;i.demand=100;i.pack_plan=10;}
 assert.equal(productionSummary(r).groups[0].suggested,1,'Sum the entered sizes and round only once');
});
test('cooked stock reduces new cooking before rounding and never reduces the packing instruction',()=>{
 const p=make(['R01','R02']);for(const i of p.items){i.stock=0;i.pack_plan=i.yield_qty;}
 p.groups[0].coldroom_batches=1;assert.equal(productionSummary(p).groups[0].suggested,1);applyProductionSuggestion(p,'RUSSIAN');let s=productionSummary(p).groups[0];assert.equal(s.used,2);assert.equal(s.unpacked_left,0);assert.deepEqual(p.items.map(i=>i.pack_plan),p.items.map(i=>i.yield_qty));
 p.items[1].pack_plan=p.items[1].yield_qty*.2;p.groups[0].coldroom_batches=.5;assert.equal(productionSummary(p).groups[0].suggested,1);
 p.groups[0].coldroom_batches=null;assert.equal(productionSummary(p).groups[0].suggested,null);for(const i of p.items)i.pack_plan=0;assert.equal(productionSummary(p).groups[0].suggested,0);
});
test('each distinct cooked recipe has its own pool; explicit packing overrides and zero are kept',()=>{
 const codes=['R05','R06','R07','V01','V02'],p=make(codes);for(const i of p.items){i.stock=30;i.pack_plan=i.yield_qty*2;}
 for(const [n,g] of p.groups.entries()){g.coldroom_batches=n===0?2:1;g.planned=0;}
 assert.deepEqual(productionSummary(p).groups.map(g=>g.suggested),[0,1,1,1,1]);for(const g of p.groups)assert.equal(applyProductionSuggestion(p,g.id,{blankOnly:true}),false);
 assert.ok(p.groups.every(g=>g.planned===0));p.items[1].pack_plan=0;assert.equal(productionSummary(p).groups[1].suggested,0);
});
test('polony cooked casings are size-specific; cases round per size before batch and trolley totals',()=>{
 const p=make(['P02','P03','P04']);for(const i of p.items){i.stock=0;i.demand=0;i.pack_plan=0;}
 Object.assign(p.items[0],{pack_plan:30,coldroom_casings:.5});Object.assign(p.items[1],{pack_plan:1,coldroom_casings:0});Object.assign(p.items[2],{pack_plan:56,coldroom_casings:0});
 let s=productionSummary(p).groups[0];assert.deepEqual(s.rows.map(i=>i.casing_suggested),[1,1,7]);assert.equal(s.new_casings,9);assert.equal(s.suggested,3);assert.equal(s.trolleys,2);applyProductionSuggestion(p,'POLONY');s=productionSummary(p).groups[0];assert.ok(s.warnings.includes('3 casing slots still need a size allocation'));
 p.items[0].casing_plan=0;assert.equal(productionSummary(p).groups[0].suggested,2);assert.equal(p.groups[0].planned,3);assert.ok(productionSummary(p).groups[0].warnings.some(x=>x.includes('packing exceeds')));
 p.items[0].coldroom_casings=100;assert.equal(productionSummary(p).groups[0].rows[1].casing_suggested,1,'Small surplus cannot supply medium');
});
test('patties cut complete bags from frozen rolls and manufacture replenishment separately',()=>{
 const p=make(['W07']),g=p.groups[0],i=p.items[0];i.demand=3;i.stock=0;g.roll_stock=10;let s=productionSummary(p).groups[0];assert.equal(s.suggested,2);assert.equal(s.suggested_batches,0);applyProductionSuggestion(p,'W07');s=productionSummary(p).groups[0];assert.equal(s.output,3);assert.equal(s.loose_disks,0);assert.equal(s.rolls_after_cut,8);assert.equal(g.planned,0);
 g.cut_planned=1;s=productionSummary(p).groups[0];assert.equal(s.output,1);assert.equal(s.loose_disks,10);assert.equal(s.balances[0].balance,-2);
 i.demand=2;g.cut_planned=null;assert.equal(productionSummary(p).groups[0].suggested,2,'Need two complete bags, not one and a half');
 g.roll_stock=0;g.planned=20;g.cut_planned=2;g.rolls_per_batch=8;s=productionSummary(p).groups[0];assert.equal(s.rolls_after_cut,-2);assert.ok(s.warnings.some(x=>x.includes('Not enough frozen')));assert.equal(s.suggested_batches,1);
 g.roll_stock=10;g.min_roll_stock=20;assert.equal(productionSummary(p).groups[0].suggested_batches,2);g.rolls_per_batch=null;assert.equal(productionSummary(p).groups[0].suggested_batches,null);applyProductionSuggestion(p,'W07');assert.equal(g.planned,20,'Existing manufacturing batches never turn into roll cutting count');
});
test('legacy view upgrade preserves stored payload, batch decisions, yields and manual packing',()=>{
 const p=make(['W07','P02']);p.groups[0].planned=2;p.groups[0].mode='batch';delete p.groups[0].cut_planned;p.items[1].yield_qty=122;p.items[1].pack_plan=20;p.items[1].coldroom_casings=0;p.items[1].mode='shared';const before=JSON.stringify(p),v=normaliseProductionPlan(p);assert.equal(JSON.stringify(p),before);assert.equal(v.groups[0].planned,2);assert.equal(v.groups[0].cut_planned,null);assert.equal(v.items[1].yield_qty,122);assert.equal(productionSummary(v).groups[1].rows[0].casing_suggested,1);
});
test('new count fields validate and older clients cannot erase omitted fields or forge casing yields',()=>{
 const p=make(['W07','P02']);p.groups[0].roll_stock=10;p.groups[0].cut_planned=2;p.items[1].casing_plan=3;let v=structuredClone(p);delete v.groups[0].roll_stock;delete v.groups[0].cut_planned;delete v.items[1].casing_plan;v.items[1].casing_yield_qty=999;let saved=validateProductionEdits(v,p);assert.equal(saved.groups[0].roll_stock,10);assert.equal(saved.groups[0].cut_planned,2);assert.equal(saved.items[1].casing_plan,3);assert.equal(saved.items[1].casing_yield_qty,20);
 for(const [kind,index,key,value] of [['groups',0,'roll_stock',.5],['groups',0,'rolls_per_batch',0],['groups',0,'disks_per_roll',null],['items',1,'casing_plan',.5],['items',1,'coldroom_casings',-1]]){v=structuredClone(p);v[kind][index][key]=value;assert.throws(()=>validateProductionEdits(v,p),key);}
});
test('refresh preserves all new decisions, while new days carry settings only',()=>{
 const p=make(['W07','P02','R01']);Object.assign(p.groups[0],{planned:2,cut_planned:4,roll_stock:8,rolls_per_batch:12,min_roll_stock:10,disks_per_roll:32});Object.assign(p.items[1],{stock:5,pack_plan:50,coldroom_casings:2,casing_plan:1,actual:49});p.groups[2].coldroom_batches=.5;
 const refresh=buildProductionPlan({date:p.date,target_date:p.target_date,routes:p.routes,items:p.items,snapshot:'new',previous:p});assert.deepEqual(refresh.groups,p.groups);assert.deepEqual(refresh.items,p.items);
 const next=buildProductionPlan({date:'2026-10-08',target_date:'2026-10-09',routes:p.routes,items:p.items,snapshot:'new',settingsPlan:p,yieldSettings:p.items});assert.equal(next.groups[0].rolls_per_batch,12);assert.equal(next.groups[0].min_roll_stock,10);assert.equal(next.groups[0].disks_per_roll,32);assert.equal(next.groups[0].roll_stock,null);assert.equal(next.groups[0].cut_planned,null);assert.equal(next.groups[0].planned,null);assert.equal(next.groups[2].coldroom_batches,null);assert.equal(next.items[1].casing_plan,null);assert.equal(next.items[1].coldroom_casings,null);assert.equal(next.items[1].stock,null);assert.equal(next.items[1].actual,null);
});
