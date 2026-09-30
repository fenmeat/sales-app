-- Mirrors the five tables manually created in the test D1 console.
-- No production resources are referenced. No data is inserted or changed.
CREATE TABLE IF NOT EXISTS products (
  product_code TEXT PRIMARY KEY,
  product_name TEXT NOT NULL,
  sales_unit TEXT NOT NULL,
  price_cents INTEGER CHECK (price_cents >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS routes (
  route_code TEXT PRIMARY KEY NOT NULL,
  route_name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS route_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  service_date TEXT NOT NULL,
  route_code TEXT NOT NULL REFERENCES routes(route_code),
  trip_number INTEGER NOT NULL DEFAULT 1 CHECK (trip_number > 0),
  salesperson_name TEXT,
  vehicle_registration TEXT,
  load_confirmed_at TEXT,
  returns_confirmed_at TEXT,
  closed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (service_date, route_code, trip_number)
);
CREATE TABLE IF NOT EXISTS route_run_items (
  run_id TEXT NOT NULL REFERENCES route_runs(run_id),
  product_code TEXT NOT NULL REFERENCES products(product_code),
  forecast_qty REAL CHECK (forecast_qty >= 0),
  planned_qty REAL CHECK (planned_qty >= 0),
  loaded_qty REAL CHECK (loaded_qty >= 0),
  returned_qty REAL CHECK (returned_qty >= 0),
  sold_out INTEGER CHECK (sold_out IN (0, 1)),
  price_cents INTEGER CHECK (price_cents >= 0),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (run_id, product_code)
);
CREATE TABLE IF NOT EXISTS cash_ups (
  run_id TEXT PRIMARY KEY NOT NULL REFERENCES route_runs(run_id),
  cash_counted_cents INTEGER CHECK (cash_counted_cents >= 0),
  opening_float_cents INTEGER CHECK (opening_float_cents >= 0),
  shop2shop_total_cents INTEGER CHECK (shop2shop_total_cents >= 0),
  card_total_cents INTEGER CHECK (card_total_cents >= 0),
  eft_total_cents INTEGER CHECK (eft_total_cents >= 0),
  counted_by TEXT,
  confirmed_at TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
