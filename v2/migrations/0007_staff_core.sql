-- Additive Staff tables. No legacy attendance or payroll data is imported.
CREATE TABLE IF NOT EXISTS v2_staff_register (revision INTEGER PRIMARY KEY, payload TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, detail TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_staff_requests (id TEXT PRIMARY KEY, request_hash TEXT NOT NULL, result TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_staff_pins (employee_id TEXT PRIMARY KEY, salt TEXT NOT NULL, digest TEXT NOT NULL, pepper_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_staff_devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, code_hash TEXT UNIQUE, code_expires INTEGER NOT NULL, token_hash TEXT UNIQUE, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, created_by TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS v2_staff_time (request_id TEXT PRIMARY KEY, employee_id TEXT NOT NULL, shift_id TEXT NOT NULL, revision INTEGER NOT NULL, start_at TEXT NOT NULL, end_at TEXT, state TEXT NOT NULL, payload TEXT NOT NULL, action TEXT NOT NULL, actor TEXT NOT NULL, saved_at TEXT NOT NULL, UNIQUE(employee_id,revision));
CREATE INDEX IF NOT EXISTS v2_staff_time_shift ON v2_staff_time(shift_id,revision);
CREATE INDEX IF NOT EXISTS v2_staff_time_date ON v2_staff_time(start_at,end_at);
