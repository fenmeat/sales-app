import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {TASK_SCHEMA,latestSQL} from '../src/tasks-api.js';
import {LEDGER_SCHEMA} from '../src/zoho-ledger.js';

test('upgrade and rollback keep historical task revisions and Zoho source records usable',t=>{
 const db=new DatabaseSync(':memory:');
 t.after(()=>db.close());
 const create=(schema,table)=>db.exec(schema.find(sql=>sql.startsWith('CREATE TABLE IF NOT EXISTS '+table+' ' )||sql.startsWith('CREATE TABLE IF NOT EXISTS '+table+'(')));
 create(TASK_SCHEMA,'v2_task_events');
 create(LEDGER_SCHEMA,'v2_zoho_mirror_records');
 const event=db.prepare("INSERT INTO v2_task_events VALUES(?,'hash','old-task',?,?,'{}','test','now')");
 event.run('one',1,'create');
 event.run('two',2,'reminder');
 const source=db.prepare('INSERT INTO v2_zoho_mirror_records VALUES(?,?,?,?,?)');
 source.run('invoice','one','{}','a','run');
 const setup=()=>{db.exec('BEGIN');for(const sql of [...TASK_SCHEMA,...LEDGER_SCHEMA])db.exec(sql);db.exec('COMMIT');};
 setup();setup();
 const current=()=>db.prepare(latestSQL).get();
 assert.equal(current().revision,2);
 assert.equal(current().pa_revision,1);
 // Older Workers keep using the same append and UPSERT operations on rollback.
 event.run('four',4,'set_visibility');
 event.run('three',3,'edit');
 source.run('payment','two','{}','b','run');
 db.exec("INSERT INTO v2_zoho_mirror_records VALUES('invoice','one','{}','new','later') ON CONFLICT(kind,id) DO UPDATE SET digest=excluded.digest,run_id=excluded.run_id");
 setup();
 assert.equal(current().revision,4);
 assert.equal(current().pa_revision,3);
 assert.deepEqual(db.prepare('SELECT revision FROM v2_task_events ORDER BY revision').all().map(r=>r.revision),[1,2,3,4]);
 assert.deepEqual(db.prepare('SELECT kind,count FROM v2_zoho_record_counts ORDER BY kind').all().map(r=>[r.kind,r.count]),[['invoice',1],['payment',1]]);
 assert.equal(db.prepare("SELECT digest FROM v2_zoho_mirror_records WHERE id='one'").get().digest,'new');
});
