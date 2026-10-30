-- Additive authentication storage only; no sales, stock or production changes.
-- Also initialized lazily by pa-storage.js for the established deployment flow.
CREATE TABLE IF NOT EXISTS v2_pa_oauth (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER);
CREATE INDEX IF NOT EXISTS v2_pa_oauth_expiry ON v2_pa_oauth(expires);
CREATE TABLE IF NOT EXISTS v2_pa_limits (bucket TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
