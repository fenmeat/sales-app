// Additive pilot schema. These tables do not alter the five initial tables.
export const SCHEMA = [
`CREATE TABLE IF NOT EXISTS v2_recipe_events (request_id TEXT PRIMARY KEY NOT NULL, request_hash TEXT NOT NULL, revision INTEGER UNIQUE NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, reason TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS v2_production_events (request_id TEXT PRIMARY KEY NOT NULL, request_hash TEXT NOT NULL, production_date TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(production_date,revision))`,
`CREATE TABLE IF NOT EXISTS v2_catalog (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS v2_events (request_id TEXT PRIMARY KEY NOT NULL, request_hash TEXT NOT NULL, run_id TEXT NOT NULL, service_date TEXT NOT NULL, route TEXT NOT NULL, revision INTEGER NOT NULL, action TEXT NOT NULL, payload TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(run_id,revision))`,
`CREATE INDEX IF NOT EXISTS v2_events_date ON v2_events(service_date,route,revision)`,
`CREATE TABLE IF NOT EXISTS v2_history (service_date TEXT NOT NULL, route TEXT NOT NULL, product TEXT NOT NULL, qty REAL NOT NULL CHECK(qty>=0), quality TEXT NOT NULL, source TEXT NOT NULL, constrained INTEGER, PRIMARY KEY(route,product,service_date))`,
`CREATE INDEX IF NOT EXISTS v2_history_route_date ON v2_history(route,service_date)`,
`CREATE TABLE IF NOT EXISTS v2_sessions (token_hash TEXT PRIMARY KEY NOT NULL, username TEXT NOT NULL, key_hash TEXT NOT NULL, expires INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS v2_auth_limits (bucket TEXT PRIMARY KEY NOT NULL, attempts INTEGER NOT NULL, expires INTEGER NOT NULL)`,
`CREATE TABLE IF NOT EXISTS v2_sync (id TEXT PRIMARY KEY NOT NULL, saved_at TEXT NOT NULL, payload TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS v2_zoho_states (state_hash TEXT PRIMARY KEY NOT NULL, session_hash TEXT NOT NULL, expires INTEGER NOT NULL, client_fingerprint TEXT NOT NULL, accounts_url TEXT NOT NULL, verifier TEXT NOT NULL)`,
`CREATE TABLE IF NOT EXISTS v2_zoho_connection (id INTEGER PRIMARY KEY CHECK(id=1), client_fingerprint TEXT NOT NULL, encrypted_tokens TEXT NOT NULL, accounts_url TEXT NOT NULL, api_domain TEXT NOT NULL, connected_at TEXT NOT NULL, connected_by TEXT NOT NULL, organisations TEXT NOT NULL, last_checked TEXT)`
];
export async function ensureSchema(db){await db.batch(SCHEMA.map(sql=>db.prepare(sql)));}
