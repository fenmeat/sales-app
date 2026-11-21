// Local migration verification. The private workbook stays outside this repository.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {hash} from '../src/auth.js';
import {deriveFinanceImport,sourceValue} from '../src/finance-import.js';
import {toCents} from '../src/finance-domain.js';
const input=process.argv[2];
if(!input)throw Error('Pass the private captured workbook JSON path.');
const source=JSON.parse(await readFile(input,'utf8')),raw=JSON.stringify(source),derived=deriveFinanceImport(source);
const code=await build({entryPoints:['src/worker.js'],bundle:true,write:false,format:'esm',platform:'browser',external:['cloudflare:workers'],target:'es2022'});
const mf=new Miniflare(convertV4MiniflareOptions({name:'isolated-financial-migration-check',modules:true,script:code.outputFiles[0].text,compatibilityDate:'2026-09-30',d1Databases:{DB:'isolated-financial'},bindings:{APP_ACCESS_KEYS:JSON.stringify({alex:'SYNTHETIC-migration-check-01234567890123456789'}),APP_ENV:'test'},outboundService:()=>{throw Error('No external access during migration verification.');}}));
const origin='https://synthetic-migration.example';let cookie='';
const call=async(path,body)=>{const r=await mf.dispatchFetch(origin+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});assert.equal(r.status,200,await r.clone().text());return r;};
try{
 const login=await call('/api/login',{username:'alex',key:'SYNTHETIC-migration-check-01234567890123456789'});cookie=login.headers.get('set-cookie').split(';')[0];
 const id=await hash(raw),parts=[];for(let i=0;i<raw.length;i+=80000)parts.push(raw.slice(i,i+80000));
 const manifest={id,parts:await Promise.all(parts.map(hash))};
 await call('/api/financial/import',{operation:'import_start',import_id:id,manifest});
 for(let part=0;part<parts.length;part++)await call('/api/financial/import',{operation:'import_chunk',import_id:id,part,payload:parts[part]});
 const report=await(await call('/api/financial/import',{operation:'import_finish',import_id:id})).json();
 const state=await(await call('/api/financial')).json();assert.equal(state.records.length,derived.records.length);
 for(const r of derived.records)assert.deepEqual(state.records.find(x=>x.id===r.id).data,r.data);
 const accounts=state.records.filter(r=>r.type==='account');
 for(const r of accounts){const ref=r.data.source[0],sheet=source.sheets.find(s=>s.properties.sheetId===ref.sheet_id),cell=sheet.data[0].rowData[ref.row-1].values[1];assert.equal(state.summaries[r.id].total,toCents(sourceValue(cell)),`Month total mismatch: ${r.data.supplier} ${r.data.month}`);}
 const db=await mf.getD1Database('DB');const saved=(await db.prepare('SELECT payload FROM v2_finance_parts ORDER BY part').all()).results.map(r=>r.payload).join('');assert.equal(await hash(saved),id);assert.deepEqual(JSON.parse(saved),source);
 assert.equal((await db.prepare('SELECT count(*) n FROM v2_finance_events').first()).n,derived.records.length);
 if(process.argv[3])await writeFile(process.argv[3],new Uint8Array(await(await call('/api/financial/pdf?type=account&month=2026-09')).arrayBuffer()));
 console.log(JSON.stringify({verified:true,source_sha256:id,bytes:Buffer.byteLength(raw),parts:parts.length,records:report.records,counts:report.counts,monthly_totals_checked:accounts.length,source_rows:report.source_rows,duplicates:report.duplicates.length}));
}finally{await mf.dispose();}
