-- Private, append-only recipe/material/packaging register. Existing tables unchanged.
CREATE TABLE IF NOT EXISTS v2_recipe_events (
 request_id TEXT PRIMARY KEY NOT NULL,
 request_hash TEXT NOT NULL,
 revision INTEGER UNIQUE NOT NULL,
 payload TEXT NOT NULL,
 actor TEXT NOT NULL,
 saved_at TEXT NOT NULL,
 reason TEXT NOT NULL
);
