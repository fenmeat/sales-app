import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {parseHTML} from 'linkedom';
import {today,addDays,routeName,routeScheduled} from '../src/domain.js';
import {buildProductionPlan,productionProfile,productionSummary,productionStockBalance,productionPlanningView,babalasRecipeUpdateNeeded,applyProductionSuggestion,createProductionTrolley} from '../src/production.js';
import {trolleyPlanHTML} from '../public/production-trolleys.js';
import {parseDecimal} from '../public/decimal-input.js';

function plan(){
 const products=[['R01','RUSSIAN 6',24],['R02','RUSSIAN 5',29],['R06','CHEESE RUSSIAN',27],['V01','VIENNA',38],['P02','POLONY SMALL',122],['P03','POLONY MED',61],['W01','BRAAI WORS',13],['W07','PATTIES',29],['B01','BOUGHT IN',null]].map(([code,name,yield_qty])=>({code,name,yield_qty,unit:code.startsWith('P')?'sales unit':'bag: 10 packs',demand:72,breakdown:[],active:true,available:true}));
 const p=buildProductionPlan({date:today(),target_date:addDays(today(),1),routes:['MB'],items:products.map(i=>({...i,...productionProfile(i),yield_qty:i.yield_qty})),snapshot:'synthetic-coldroom-test'});
 for(const i of p.items){i.stock=28;i.actual=5;i.pack_plan=45;}
 for(const g of p.groups){g.planned=3;g.coldroom_batches=2.5;}
 p.items.find(i=>i.code==='P02').coldroom_casings=1.5;
 p.items.find(i=>i.code==='P03').coldroom_casings=5;
 return p;
}
const output=(p,code)=>productionSummary(p).items.find(i=>i.code===code).coldroom_sales_units;

test('Coldroom converts shared batches with each saved yield without adding future batches or changing stock',()=>{
 const p=plan(),before=structuredClone(p);
 assert.equal(output(p,'R01'),60);
 assert.equal(output(p,'R02'),72.5);
 assert.equal(productionStockBalance(p.items[0]).closing,33);
 assert.deepEqual(p,before,'the estimate is derived without rewriting the saved plan');
 p.groups.find(g=>g.id==='RUSSIAN').planned=99;p.items[0].pack_plan=500;p.items[0].stock=800;
 assert.equal(output(p,'R01'),60,'planned new batches, packing and already-packed stock are excluded');
 p.items[0].yield_qty=20;assert.equal(output(p,'R01'),50,'use the plan yield, not a hard-coded recipe');
 assert.equal(output(p,'R02'),72.5,'shared sizes have separate conversions, never a summed stock total');
});

test('cooked products keep fractional estimates and polony uses its own casing size',()=>{
 const p=plan();p.groups.find(g=>g.id==='R06').coldroom_batches=1.5;p.groups.find(g=>g.id==='V01').coldroom_batches=.5;
 assert.equal(output(p,'R06'),40.5,'do not round up to a full bag that does not exist');
 assert.equal(output(p,'V01'),19);
 assert.equal(output(p,'P02'),30,'1.5 small casings × 20, not the 122-unit batch reference');
 assert.equal(output(p,'P03'),70,'5 medium casings × 14');
 p.items.find(i=>i.code==='P02').coldroom_casings=0;assert.equal(output(p,'P02'),0);assert.equal(output(p,'P03'),70);
 for(const code of ['W01','W07','B01'])assert.equal(output(p,code),undefined,'no cooked-stock conversion for '+code);
});

test('unknown and invalid counts/yields stay unknown while an explicit zero stays zero',()=>{
 const p=plan(),g=p.groups.find(g=>g.id==='RUSSIAN');
 for(const stock of [null,undefined,-1,NaN,Infinity,100001,'2.5']){g.coldroom_batches=stock;assert.equal(output(p,'R01'),null);}
 g.coldroom_batches=2.5;
 for(const yieldQty of [null,undefined,0,-1,NaN,Infinity,100001,'24']){p.items[0].yield_qty=yieldQty;assert.equal(output(p,'R01'),null);}
 g.coldroom_batches=0;assert.equal(output(p,'R01'),0,'no stock means zero even while recipe yield is missing');
 g.coldroom_batches=.1;p.items[0].yield_qty=3;assert.equal(output(p,'R01'),.3,'stable decimal presentation');
});

async function screen(){
 const source=(await readFile(new URL('../public/production-app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
 const {document,window}=parseHTML('<html><body><div id="app"></div><div id="notice"></div></body></html>');
 window.HTMLElement.prototype.getBoundingClientRect=()=>({height:100});
 const initial={plan:plan(),revision:7,saved_at:'2026-11-04T06:00:00Z'},requests=[];
 const catalog={products:initial.plan.items,routes:[{code:'MB',name:'Mossel Bay',weekday:4}]};
 const deps={document,window:{addEventListener(){}},location:{assign(){}},ResizeObserver:class{observe(){}disconnect(){}},today,routeName,routeScheduled,
  calculateSummary:productionSummary,productionStockBalance,productionPlanningView,babalasRecipeUpdateNeeded,applyProductionSuggestion,createProductionTrolley,
  trolleyPlanHTML,updateTrolleyPlan(){},readNumericInput:el=>parseDecimal(el.value),
  fetch:async(path,options)=>{requests.push({path,...options});assert.equal(options.method,'GET');return {ok:true,json:async()=>structuredClone(path==='/api/bootstrap'?{catalog,username:'alex'}:initial)};}};
 const execute=new (Object.getPrototypeOf(async function(){}).constructor)(...Object.keys(deps),source+'\nreturn state;');
 const state=await execute(...Object.values(deps));
 assert.ok(document.querySelector('[data-coldroom-units="R01"]'),document.body.textContent);
 const edit=(selector,value)=>{const el=document.querySelector(selector);el.value=value;el.oninput();};
 const text=selector=>document.querySelector(selector).textContent;
 return {document,state,initial,requests,edit,text};
}

test('production screen shows Coldroom capacity and shared-stock warning, with no controls for unrelated modes',async()=>{
 const h=await screen();
 assert.equal(h.text('[data-coldroom-units="R01"]'),'60 bags');
 assert.match(h.text('[data-coldroom-basis="R01"]'),/2[.,]5 batches × 24 bags per batch/);
 assert.match(h.document.querySelector('[data-coldroom-units="R01"]').parentElement.textContent,/all shared stock is packed as RUSSIAN 6.*Do not add/);
 assert.equal(h.text('[data-coldroom-units="P02"]'),'30 sales units');
 for(const code of ['W01','W07','B01'])assert.equal(h.document.querySelector('[data-coldroom-units="'+code+'"]'),null);
 assert.deepEqual(h.state.saved.plan,h.initial.plan);assert.equal(h.state.dirty,false);
});

test('typing comma/dot counts and yields recalculates immediately without saving or changing existing plans',async()=>{
 const h=await screen(),requests=h.requests.length,saved=structuredClone(h.state.saved);
 const batches='[data-group="RUSSIAN"][data-field="coldroom_batches"]';
 h.edit(batches,'1,5');assert.equal(h.text('[data-coldroom-units="R01"]'),'36 bags');
 h.edit('[data-code="R01"][data-field="yield_qty"]','20');assert.equal(h.text('[data-coldroom-units="R01"]'),'30 bags');assert.equal(h.text('[data-yield-summary="R01"]'),'Recipe yield · 20 sales units');
 h.edit(batches,'2.5');assert.equal(h.text('[data-coldroom-units="R01"]'),'50 bags');
 h.edit('[data-code="P02"][data-field="coldroom_casings"]','0,5');assert.equal(h.text('[data-coldroom-units="P02"]'),'10 sales units');assert.equal(h.text('[data-coldroom-units="P03"]'),'70 sales units');
 h.edit(batches,'');assert.equal(h.text('[data-coldroom-units="R01"]'),'— bags');assert.match(h.text('[data-coldroom-basis="R01"]'),/Enter cooked/);
 h.edit(batches,'wrong');assert.equal(h.text('[data-coldroom-units="R01"]'),'— bags');assert.match(h.text('[data-coldroom-basis="R01"]'),/valid cooked/);
 h.edit(batches,'0');h.edit('[data-code="R01"][data-field="yield_qty"]','');assert.equal(h.text('[data-coldroom-units="R01"]'),'0 bags');
 h.edit(batches,'1');assert.equal(h.text('[data-coldroom-units="R01"]'),'— bags');assert.match(h.text('[data-coldroom-basis="R01"]'),/Set the recipe yield/);
 assert.equal(h.state.result.plan.items[0].stock,28);assert.equal(h.state.result.plan.items[0].pack_plan,45);assert.equal(h.state.result.plan.items[0].actual,5);
 assert.deepEqual(h.state.saved,saved);assert.equal(h.requests.length,requests,'typing never saves stock or production');
});
