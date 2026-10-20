import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=await readFile(new URL('../public/print-document.js',import.meta.url),'utf8');
function fixture(fonts=Promise.resolve()){
 const classes=new Set(),events=new Map(),frames=[],prints=[];
 const window={addEventListener:(name,fn)=>events.set(name,fn),print(){
  events.get('beforeprint')?.();prints.push([...classes]);
  // Model early completion while the native preview can still re-paginate.
  events.get('afterprint')?.();
 }};
 const context=vm.createContext({window,document:{fonts:{ready:fonts},body:{classList:{remove:(...names)=>names.forEach(n=>classes.delete(n)),add:n=>classes.add(n)}}},requestAnimationFrame:fn=>frames.push(fn)});
 vm.runInContext(source.replace('export async function','async function'),context);
 const tick=async()=>{await new Promise(resolve=>setImmediate(resolve));frames.splice(0).forEach(fn=>fn());};
 return {classes,prints,events,tick,print:(...args)=>context.printDocument(...args)};
}
test('first print waits for document, fonts and layout; early afterprint retains the selected sheet',async()=>{
 let ready;const f=fixture(new Promise(r=>ready=r));
 const job=f.print('printing-stock',async()=>({}));
 await f.tick();assert.equal(f.prints.length,0);
 ready();await f.tick();assert.equal(f.prints.length,0);
 await f.tick();await job;
 assert.deepEqual(f.prints,[['printing-stock']]);
 assert.deepEqual([...f.classes],['printing-stock']);
 f.events.get('afterprint')?.();f.events.get('beforeprint')();
 assert.deepEqual([...f.classes],['printing-stock'],'later pagination still uses stock sheet');
});
test('double taps prepare and print once; cancel/retry and explicit current-view selection work',async()=>{
 const f=fixture();let release,calls=0;
 const job=f.print('printing-production-staff',()=>{calls++;return new Promise(r=>release=r);});
 await f.print('printing-stock',()=>{throw Error('duplicate preparation');});
 release({});await f.tick();await f.tick();await job;
 assert.equal(calls,1);assert.equal(f.prints.length,1);
 for(const mode of ['printing-production-staff','printing-production',null,'printing-stock']){
  const retry=f.print(mode,()=>({}));await f.tick();await f.tick();await retry;
  assert.deepEqual([...f.classes],mode?[mode]:[]);
 }
 assert.equal(f.prints.length,5);
});
test('missing saved plan, fit failure or network error cannot print the app screen; retry is allowed',async()=>{
 const f=fixture();
 await f.print('printing-stock',()=>undefined);
 await f.print('printing-production-staff',()=>undefined);
 await assert.rejects(f.print('printing-stock',()=>{throw Error('Network unavailable');}),/Network unavailable/);
 assert.equal(f.prints.length,0);
 const job=f.print('printing-stock',()=>({}));await f.tick();await f.tick();await job;
 assert.equal(f.prints.length,1);
});
