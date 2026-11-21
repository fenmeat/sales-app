-- Test app only; append-only production plans, separate from every sales record.
-- ensureSchema also creates this table repeat-safely on authenticated API use.
CREATE TABLE IF NOT EXISTS v2_production_events (
 request_id TEXT PRIMARY KEY NOT NULL,
 request_hash TEXT NOT NULL,
 production_date TEXT NOT NULL,
 revision INTEGER NOT NULL,
 action TEXT NOT NULL,
 payload TEXT NOT NULL,
 actor TEXT NOT NULL,
 saved_at TEXT NOT NULL,
 UNIQUE(production_date,revision)
);
