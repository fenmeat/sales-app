// The OAuth library's small KV contract, backed by a separate private D1 table.
// D1 is already bound to this Worker; no new account secret or KV binding is needed.
const ready = new WeakMap();
export async function initPaStorage(db) {
  if (!ready.has(db)) ready.set(db, db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS v2_pa_oauth (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER)'),
    db.prepare('CREATE INDEX IF NOT EXISTS v2_pa_oauth_expiry ON v2_pa_oauth(expires)'),
    db.prepare('CREATE TABLE IF NOT EXISTS v2_pa_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS v2_pa_changes (request_id TEXT PRIMARY KEY NOT NULL, request_hash TEXT NOT NULL, target TEXT NOT NULL, resource_key TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, before_payload TEXT, after_payload TEXT NOT NULL, write_guard INTEGER NOT NULL CHECK(write_guard=1))'),
    db.prepare('CREATE INDEX IF NOT EXISTS v2_pa_changes_resource ON v2_pa_changes(target,resource_key,revision)'),
    db.prepare('CREATE TABLE IF NOT EXISTS v2_pa_write_probes (id TEXT PRIMARY KEY, payload TEXT NOT NULL)'),
  ]).catch(error => { ready.delete(db); throw error; }));
  await ready.get(db);
}
export function oauthStore(db) {
  return {
    async get(key, options = {}) {
      const row = await db.prepare('SELECT value FROM v2_pa_oauth WHERE key=? AND (expires IS NULL OR expires>?)').bind(key, Math.floor(Date.now()/1000)).first();
      if (!row) return null;
      const type = typeof options === 'string' ? options : options.type;
      if (type === 'json') return JSON.parse(row.value);
      if (type && type !== 'text') throw new Error('Unsupported OAuth storage type');
      return row.value;
    },
    async put(key, value, options = {}) {
      if (typeof key !== 'string' || typeof value !== 'string') throw new Error('Invalid OAuth storage value');
      const expires = options.expiration ?? (options.expirationTtl === undefined ? null : Math.floor(Date.now()/1000) + options.expirationTtl);
      await db.prepare('INSERT INTO v2_pa_oauth(key,value,expires) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,expires=excluded.expires').bind(key,value,expires).run();
    },
    async delete(key) { await db.prepare('DELETE FROM v2_pa_oauth WHERE key=?').bind(key).run(); },
    async list({prefix = '', cursor = '', limit = 1000} = {}) {
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('Invalid OAuth list limit');
      const rows = await db.prepare('SELECT key,expires FROM v2_pa_oauth WHERE substr(key,1,?)=? AND key>? AND (expires IS NULL OR expires>?) ORDER BY key LIMIT ?').bind(prefix.length,prefix,cursor,Math.floor(Date.now()/1000),limit+1).all();
      const page = rows.results.slice(0,limit), complete = rows.results.length <= limit;
      return {keys:page.map(r=>({name:r.key,...(r.expires===null?{}:{expiration:r.expires})})),list_complete:complete,cursor:complete?'':page.at(-1).key};
    },
  };
}
export async function rateLimit(db, bucket, limit, seconds) {
  const now = Math.floor(Date.now()/1000), key = bucket+'|'+Math.floor(now/seconds);
  const row = await db.prepare('INSERT INTO v2_pa_limits(bucket,attempts,expires) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,now+seconds).first();
  return row.attempts <= limit;
}
export async function cleanPaStorage(db) {
  const now = Math.floor(Date.now()/1000);
  await db.batch([
    db.prepare('DELETE FROM v2_pa_oauth WHERE expires IS NOT NULL AND expires<=?').bind(now),
    db.prepare('DELETE FROM v2_pa_limits WHERE expires<=?').bind(now),
  ]);
}
