import {check, UserError, today, dateKey} from './domain.js';
import {canUseFactorySales, hash} from './auth.js';
import {posId, posText, posPhone, posLines, posPayment} from './pos-domain.js';

// Separate, additive POS ledger. Route sessions and historical factory debt stay intact.
export const POS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS v2_pos_sales (seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','paid','cancelled')), actor TEXT NOT NULL, customer_id TEXT, service_date TEXT NOT NULL, payload TEXT NOT NULL, saved_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS v2_pos_sales_day ON v2_pos_sales(service_date,status,seq)`,
  `CREATE INDEX IF NOT EXISTS v2_pos_sales_customer ON v2_pos_sales(customer_id,seq)`,
  `CREATE TABLE IF NOT EXISTS v2_pos_events (request_id TEXT PRIMARY KEY NOT NULL, request_hash TEXT NOT NULL, sale_id TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, payload TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(sale_id,revision))`,
  `CREATE TABLE IF NOT EXISTS v2_pos_customers (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, phone TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS v2_pos_stock (sale_id TEXT NOT NULL, product TEXT NOT NULL, name TEXT NOT NULL, unit TEXT NOT NULL, qty INTEGER NOT NULL CHECK(qty>0), service_date TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, PRIMARY KEY(sale_id,product))`,
  `CREATE INDEX IF NOT EXISTS v2_pos_stock_day ON v2_pos_stock(service_date,product)`,
  `CREATE TABLE IF NOT EXISTS v2_pos_payment_refs (method TEXT NOT NULL, reference TEXT NOT NULL, sale_id TEXT NOT NULL, PRIMARY KEY(method,reference))`
];

const view = row => row ? {...JSON.parse(row.payload), seq:row.seq, revision:row.revision} : null;
const pageNumber = value => {const n=Number(value ?? 0);check(Number.isSafeInteger(n)&&n>=0&&n<1000000,'Invalid page.');return n;};
export async function posStockSummary(db, date) {
  dateKey(date);
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_pos_stock'").first();
  if(!exists)return {date,source:'Factory POS completed sales',items:[],initialized:false};
  const rows = await db.prepare('SELECT product AS code,name,unit,SUM(qty) AS qty FROM v2_pos_stock WHERE service_date=? GROUP BY product,name,unit ORDER BY name').bind(date).all();
  return {date, source:'Factory POS completed sales', items:rows.results};
}
export async function posDaily(db, date) {
  dateKey(date);
  const exists=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='v2_pos_sales'").first();
  if(!exists)return {date,initialized:false,totals:{sales:0,total:0,cash:0,card:0,shop2shop:0,change:0},staff:[],stock:{date,source:'Factory POS completed sales',items:[]},generated_at:new Date().toISOString()};
  const sql = `COUNT(*) AS sales, COALESCE(SUM(json_extract(payload,'$.total')),0) AS total, COALESCE(SUM(json_extract(payload,'$.payment.cash')),0) AS cash, COALESCE(SUM(json_extract(payload,'$.payment.card')),0) AS card, COALESCE(SUM(json_extract(payload,'$.payment.shop2shop')),0) AS shop2shop, COALESCE(SUM(json_extract(payload,'$.payment.change')),0) AS change`;
  const totals = await db.prepare(`SELECT ${sql} FROM v2_pos_sales WHERE service_date=? AND status='paid'`).bind(date).first();
  const staff = await db.prepare(`SELECT actor,${sql} FROM v2_pos_sales WHERE service_date=? AND status='paid' GROUP BY actor ORDER BY actor`).bind(date).all();
  return {date, totals, staff:staff.results, stock:await posStockSummary(db,date), generated_at:new Date().toISOString()};
}
export async function posApi({request,url,db,user,catalog,bodyOf}) {
  check(canUseFactorySales(user.username), 'Your account does not have Factory POS access.', 403);
  const path = url.pathname;
  if (request.method === 'GET') {
    if (path === '/api/pos/bootstrap') return {username:user.username, date:today(), products:catalog.products.filter(p=>p.active), catalog_revision:catalog.revision, payment_methods:['cash','card','shop2shop'], credit:false};
    if (path === '/api/pos/customers') {
      const query = posText(url.searchParams.get('q') ?? '',160);
      const rows = await db.prepare('SELECT id,name,phone FROM v2_pos_customers WHERE instr(lower(name),lower(?))>0 OR instr(phone,?)>0 ORDER BY name,id LIMIT 51').bind(query,query).all();
      return {customers:rows.results.slice(0,50), more:rows.results.length>50};
    }
    if (path === '/api/pos/daily') return posDaily(db,dateKey(url.searchParams.get('date')??today()));
    if (path === '/api/pos/sales') {
      const draft=url.searchParams.get('status')==='draft', customer=url.searchParams.get('customer'), date=dateKey(url.searchParams.get('date')??today()), page=pageNumber(url.searchParams.get('page'));
      if(customer)check(posId(customer),'Invalid customer.');
      const where=draft?"status='draft' AND actor=?":customer?"status='paid' AND customer_id=?":"status='paid' AND service_date=?";
      const rows=await db.prepare(`SELECT * FROM v2_pos_sales WHERE ${where} ORDER BY seq DESC LIMIT 51 OFFSET ?`).bind(draft?user.username:customer??date,page*50).all();
      return {sales:rows.results.slice(0,50).map(view),more:rows.results.length>50,page};
    }
    if(path === '/api/pos/sale' || path === '/api/pos/receipt') {
      const id=url.searchParams.get('id');check(posId(id),'Invalid sale.');
      const row=await db.prepare('SELECT * FROM v2_pos_sales WHERE id=?').bind(id).first();
      check(row&&(row.status==='paid'||row.actor===user.username),'This sale is not available.',404);
      const sale=view(row);
      if(path==='/api/pos/sale')return {sale};
      check(sale.status==='paid','Complete and save payment before printing a receipt.',409);
      const {posReceiptPDF}=await import('./pos-pdf.js');
      return new Response(await posReceiptPDF(sale),{headers:{'Content-Type':'application/pdf','Content-Disposition':`inline; filename="FenMeat-${sale.number}.pdf"`,'Cache-Control':'no-store'}});
    }
    throw new UserError('Not found.',404);
  }
  check(request.method==='POST','Method not allowed.',405);
  const b=await bodyOf(request);
  if(path==='/api/pos/customers') {
    check(posId(b.id),'Missing customer identifier.');const name=posText(b.name),phone=posPhone(b.phone);check(name,'Enter the customer name.');
    const existing=await db.prepare('SELECT * FROM v2_pos_customers WHERE id=?').bind(b.id).first();
    if(existing){check(existing.name===name&&existing.phone===phone&&existing.actor===user.username,'Customer identifier was reused.',409);return {customer:{id:b.id,name,phone}};}
    await db.prepare('INSERT INTO v2_pos_customers VALUES(?,?,?,?,?)').bind(b.id,name,phone,user.username,new Date().toISOString()).run();
    return {customer:{id:b.id,name,phone}};
  }
  check(path==='/api/pos/sale','Not found.',404);
  check(posId(b.id)&&posId(b.request_id),'Missing sale or save identifier.');
  check(['save','complete','cancel'].includes(b.action),'Unknown sale action.');
  check(Number.isSafeInteger(b.revision)&&b.revision>=0,'Invalid sale revision.');
  const fingerprint=await hash(JSON.stringify(b));
  const replay=await db.prepare('SELECT * FROM v2_pos_events WHERE request_id=?').bind(b.request_id).first();
  if(replay){check(replay.actor===user.username&&replay.request_hash===fingerprint,'Save identifier was reused for different data.',409);const current=await db.prepare('SELECT * FROM v2_pos_sales WHERE id=?').bind(b.id).first();return {sale:view(current),replayed:true};}
  const old=await db.prepare('SELECT * FROM v2_pos_sales WHERE id=?').bind(b.id).first();
  check(!old||old.actor===user.username,'This draft belongs to another person.',403);
  check(!old||old.status==='draft','This sale is already completed or cancelled. Open its saved receipt.',409);
  check((old?.revision??0)===b.revision,'This draft changed on another screen. Reload it before continuing.',409);
  const stamp=new Date().toISOString(),revision=b.revision+1;
  let sale=old?view(old):{id:b.id,actor:user.username,created_at:stamp,status:'draft'};
  if(b.action==='save') {
    const priced=posLines(b.lines,catalog.products);let customer={id:null,name:'Walk-in customer',phone:''};
    if(b.customer_id){check(posId(b.customer_id),'Choose a saved customer.');const c=await db.prepare('SELECT id,name,phone FROM v2_pos_customers WHERE id=?').bind(b.customer_id).first();check(c,'Customer not found.',404);customer=c;}
    sale={...sale,...priced,customer,date:today(),catalog_revision:catalog.revision,priced_at:stamp,status:'draft'};
  } else {
    check(old,'Save the draft before taking payment.',409);
    if(b.action==='cancel')sale={...sale,status:'cancelled'};
    else {
      const payment=posPayment(b.payment,sale.total);
      check(sale.lines.length>0,'Add products before taking payment.');
      const captured=Date.parse(b.captured_at);
      check(typeof b.captured_at==='string'&&Number.isFinite(captured)&&captured<=Date.now()+300000&&captured>=Date.now()-7*86400000&&captured>=Date.parse(sale.created_at)-300000,'Check the device date/time before recording this payment.');
      const paidDate=new Date(captured+7200000).toISOString().slice(0,10);
      sale={...sale,status:'paid',number:'POS-'+String(old.seq).padStart(7,'0'),date:paidDate,captured_at:new Date(captured).toISOString(),completed_at:stamp,payment};
    }
  }
  sale.revision=revision;sale.saved_at=stamp;delete sale.seq;
  const payload=JSON.stringify(sale);
  const guard=old?"EXISTS(SELECT 1 FROM v2_pos_sales WHERE id=? AND revision=? AND actor=? AND status='draft')":"NOT EXISTS(SELECT 1 FROM v2_pos_sales WHERE id=?)";
  const args=old?[b.id,b.revision,user.username]:[b.id];
  const statements=[db.prepare(`INSERT INTO v2_pos_events(request_id,request_hash,sale_id,revision,action,actor,payload,saved_at) SELECT ?,?,?,?,?,?,?,? WHERE ${guard}`).bind(b.request_id,fingerprint,b.id,revision,b.action,user.username,payload,stamp,...args)];
  if(old)statements.push(db.prepare(`UPDATE v2_pos_sales SET revision=?,status=?,customer_id=?,service_date=?,payload=?,saved_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM v2_pos_events WHERE request_id=?)`).bind(revision,sale.status,sale.customer.id,sale.date,payload,stamp,b.id,b.revision,b.request_id));
  else statements.push(db.prepare('INSERT INTO v2_pos_sales(id,revision,status,actor,customer_id,service_date,payload,saved_at) SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM v2_pos_events WHERE request_id=?)').bind(b.id,revision,sale.status,user.username,sale.customer.id,sale.date,payload,stamp,b.request_id));
  if(b.action==='complete') {
    statements.push(db.prepare("INSERT INTO v2_pos_stock SELECT ?,json_extract(value,'$.code'),json_extract(value,'$.name'),json_extract(value,'$.unit'),json_extract(value,'$.qty'),?,?,? FROM json_each(?) WHERE EXISTS(SELECT 1 FROM v2_pos_events WHERE request_id=?)").bind(b.id,sale.date,user.username,stamp,JSON.stringify(sale.lines),b.request_id));
    if(sale.payment.shop2shop)statements.push(db.prepare("INSERT INTO v2_pos_payment_refs SELECT 'shop2shop',?,? WHERE EXISTS(SELECT 1 FROM v2_pos_events WHERE request_id=?)").bind(sale.payment.shop2shop_reference.toLowerCase(),b.id,b.request_id));
  }
  try {
    const result=await db.batch(statements);
    check(result[0].meta.changes===1,'Another screen changed this sale. Reload its saved record.',409);
  } catch(e) {
    const done=await db.prepare('SELECT * FROM v2_pos_events WHERE request_id=?').bind(b.request_id).first();
    if(done&&done.actor===user.username&&done.request_hash===fingerprint)return {sale:view(await db.prepare('SELECT * FROM v2_pos_sales WHERE id=?').bind(b.id).first()),replayed:true};
    if(e instanceof UserError)throw e;
    if(b.action==='complete'&&sale.payment.shop2shop){const used=await db.prepare("SELECT sale_id FROM v2_pos_payment_refs WHERE method='shop2shop' AND reference=?").bind(sale.payment.shop2shop_reference.toLowerCase()).first();if(used)throw new UserError('This Shop2Shop payment reference is already used on another sale.',409);}
    throw new UserError('The sale could not be saved. Check its saved status before taking payment again.',409);
  }
  return {sale:view(await db.prepare('SELECT * FROM v2_pos_sales WHERE id=?').bind(b.id).first())};
}
