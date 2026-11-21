import test from 'node:test';
import assert from 'node:assert/strict';
import {productionProfile,buildProductionPlan} from '../src/production.js';
import {productionStaffModel,productionStaffHTML,staffLabelCount} from '../public/production-staff-print.js';
function plan(codes){return buildProductionPlan({date:'2026-10-07',target_date:'2026-10-08',routes:['MB'],snapshot:'test',items:codes.map(code=>({code,name:code,unit:'sales bag',demand:100,breakdown:[],...productionProfile({code,name:code})}))});}
const group=(p,id)=>p.groups.find(g=>g.id===id),item=(p,code)=>p.items.find(i=>i.code===code);
test('staff labels count packets plus outer bags from packed units, including original exclusions',()=>{
 for(const [code,pack,labels] of [['W01',65,715],['W02',52,312],['W07',37,222],['P03',49,539],['B01',105,210],['R08',4,8]])assert.equal(staffLabelCount(code,pack),labels);
 for(const code of ['S01','S02','S03','O01','O02','O03'])assert.equal(staffLabelCount(code,30),0);
 for(const pack of [null,undefined,-1,2.5,Infinity])assert.equal(staffLabelCount('W01',pack),null);
 assert.equal(staffLabelCount('NEW',3),null);assert.equal(staffLabelCount('NEW',0),0);
});
test('chosen quantities and stored yields print without mutation, suggestions or actual captures',()=>{
 const p=plan(['W01','W02','R05','C03','B01','NEW']);
 for(const i of p.items)i.stock=0;
 group(p,'W01').planned=5;item(p,'W01').yield_qty=13;item(p,'W01').actual=999;
 group(p,'W02').planned=0;
 group(p,'R05').planned=0;group(p,'R05').coldroom_batches=2;item(p,'R05').pack_plan=22;
 group(p,'C03').planned=3;group(p,'NEW').planned=1;
 const before=structuredClone(p),m=productionStaffModel(p);
 assert.deepEqual(p,before);assert.equal(m.rows.length,4);
 assert.deepEqual(m.rows.filter(r=>r.code==='W01').map(r=>[r.make,r.pack,r.labels]),[['5 batches',65,715]]);
 assert.deepEqual(m.rows.filter(r=>r.code==='R05').map(r=>[r.make,r.pack,r.labels]),[['0 batches',22,242]]);
 assert.deepEqual(m.rows.filter(r=>r.code==='C03').map(r=>[r.make,r.pack,r.labels]),[['—',3,18]]);
 assert.equal(m.rows.find(r=>r.code==='NEW').pack,null);
 const html=productionStaffHTML({plan:p,revision:4},{routes:[{code:'MB',name:'MOSSEL BAY'}]},{dirty:true});
 for(const value of ['Saved revision 4','Unsaved screen edits excluded','2026-10-07','2026-10-08'])assert.ok(html.includes(value));assert.doesNotMatch(html,/999/);
 assert.equal((html.match(/class="staff-actual"><\/td>/g)??[]).length,4);
});
test('shared recipes appear once and packing uses selected size quantities',()=>{
 const p=plan(['R01','R02','R03','R04','P02','P03','P04']);
 group(p,'RUSSIAN').planned=3;group(p,'POLONY').planned=2;
 for(const i of p.items){i.stock=0;i.pack_plan=0;i.coldroom_casings=0;i.casing_plan=0;}
 item(p,'R01').pack_plan=20;item(p,'R03').pack_plan=10;
 for(const [code,casings,pack] of [['P02',1,20],['P03',3,49],['P04',4,48]]){item(p,code).casing_plan=casings;item(p,code).pack_plan=pack;}
 const m=productionStaffModel(p);
 assert.equal(m.rows.filter(r=>r.name==='RUSSIAN · all sizes').length,1);
 assert.equal(m.rows.filter(r=>r.name==='POLONY · all sizes').length,1);
 assert.deepEqual(m.rows.filter(r=>r.group==='RUSSIAN'&&!r.manufactureOnly).map(r=>[r.make,r.pack]),[['—',20],['—',10]]);
 assert.deepEqual(m.rows.filter(r=>r.group==='POLONY'&&!r.manufactureOnly).map(r=>[r.make,r.pack,r.labels]),[['1 casing',20,220],['3 casings',49,539],['4 casings',48,528]]);
 item(p,'P03').casing_plan=null;assert.equal(productionStaffModel(p).rows.find(r=>r.code==='P03').make,'? casings');
});
test('patties separate cutting from batches for freezing and retain loose disks',()=>{
 const p=plan(['W07']);Object.assign(group(p,'W07'),{cut_planned:3,planned:2,roll_stock:10,disks_per_roll:30,rolls_per_batch:20});
 const m=productionStaffModel(p);
 assert.deepEqual(m.rows.map(r=>[r.make,r.pack,r.labels,r.manufactureOnly]),[['Cut 3 rolls',4,24,false],['2 batches',null,null,true]]);
 assert.equal(m.rows[0].note,'10 loose disks remain');
});
test('manual trolley order, Vienna fractions and per-trolley casings render unchanged',()=>{
 const p=plan(['V01','V02','P02','P03','P04']);p.notes='Keep <saved> notes & sizes';
 p.trolleys=[{id:'manual-1',slot1:'V01',slot2:'V02_HALF',casings:{P02:0,P03:0,P04:0}},{id:'manual-2',slot1:'POLONY',slot2:'POLONY',casings:{P02:1,P03:3,P04:4}},{id:'manual-3',slot1:'',slot2:'',casings:{P02:1,P03:0,P04:0}}];
 const before=JSON.stringify(p),m=productionStaffModel(p),html=productionStaffHTML({plan:p,revision:2},{routes:[]});
 assert.equal(JSON.stringify(p),before);assert.equal(m.rows.length,0,'trolleys do not auto-fill quantities');
 assert.deepEqual(m.trolleys.map(r=>r.id),['manual-1','manual-2','manual-3']);assert.equal(m.trolleyReview,true);
 for(const value of ['VIENNA Full','CHEESE VIENNA Half','1 / 3 / 4','1 / 0 / 0','Keep &lt;saved&gt; notes &amp; sizes','No manufacturing or packing work selected'])assert.ok(html.includes(value));
});

test('zero work is omitted for every production mode despite positive demand',()=>{
 const p=plan(['W01','W07','R01','R02','R05','P01','P02','P03','P04','B01']);
 for(const g of p.groups){g.planned=0;g.cut_planned=0;g.coldroom_batches=10;}
 for(const i of p.items){i.pack_plan=0;i.casing_plan=0;i.stock=0;i.actual=20;}
 assert.deepEqual(productionStaffModel(p).rows,[]);
 group(p,'R05').planned=1;item(p,'P03').pack_plan=14;
 const rows=productionStaffModel(p).rows;assert.equal(rows.length,2);
 assert.equal(rows.find(r=>r.code==='R05').pack,0,'positive manufacturing work still appears');
 assert.equal(rows.find(r=>r.code==='P03').make,'0 casings','packing cooked stock still appears');
 assert.equal(rows.find(r=>r.code==='P03').labels,154);
});
