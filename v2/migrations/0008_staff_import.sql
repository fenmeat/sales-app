-- Private, immutable source snapshots. No employee data is shipped with code.
CREATE TABLE IF NOT EXISTS v2_staff_imports (id TEXT PRIMARY KEY, manifest TEXT NOT NULL, status TEXT NOT NULL, result TEXT, actor TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE IF NOT EXISTS v2_staff_import_chunks (import_id TEXT NOT NULL, part INTEGER NOT NULL, digest TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(import_id,part));
