// Private baseline path is supplied by the operator; no source data in Git.
import fs from 'node:fs/promises';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {hash} from '../src/auth.js';
import {ledgerCommand,ledgerStatus} from '../src/zoho-ledger.js';
const path=process.argv[2];if(!path)throw Error('Supply the private normalized baseline JSON path');
const raw=await fs.readFile(path,'utf8'),id=await hash(raw),parts=[];for(let i=0;i<raw.length;i+=90000)parts.push(raw.slice(i,i+90000));
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,script:'export default {fetch(){return new Response("isolated");}}',compatibilityDate:'2026-09-30',d1Databases:{DB:'baseline-test'}}));
try{
 const DB=await mf.getD1Database('DB'),env={DB};await DB.prepare('CREATE TABLE preserved_business_records(id TEXT PRIMARY KEY,payload TEXT)').run();await DB.prepare("INSERT INTO preserved_business_records VALUES('sentinel','unchanged')").run();
 const command=(operation,data={})=>ledgerCommand(env,{username:'alex'},{operation,...data,revision:0,request_id:crypto.randomUUID(),reason:'Isolated R02 replay; no live records'});
 await command('zoho_import_start',{import_id:id,manifest:{id,parts:await Promise.all(parts.map(hash))}});
 for(let part=0;part<parts.length;part++)await command('zoho_import_chunk',{import_id:id,part,payload:parts[part]});
 const result=await command('zoho_import_finish',{import_id:id});
 const read=await ledgerStatus(DB,{date:'2026-11-06'}),expected=JSON.parse(raw).expected;
 for(const [owner,value] of Object.entries(expected))if(read.report.owners[owner].due!==value)throw Error('R02 mismatch: '+owner);
 const preserved=await DB.prepare("SELECT payload FROM preserved_business_records WHERE id='sentinel'").first();if(preserved.payload!=='unchanged')throw Error('Business record altered');
 console.log(JSON.stringify({passed:true,source_hash:id,counts:result.counts,owners:result.replay,total:result.total,report_send_blocked:!read.report.can_send_payment_instructions,snapshot_id:read.report.snapshot_id,preserved_business_records:true}));
}finally{await mf.dispose();}
