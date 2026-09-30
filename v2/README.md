# Fen Meat Sales V2 — test setup

Status: deployment foundation, not a usable sales application yet.

## Cloudflare connection

- GitHub repository: `fenmeat/sales-app`
- Branch: `build/sales-v2-cloudflare`
- Worker name: `fenmeat-sales-test`
- Root directory: `v2`
- Build command: `npm test`
- Deploy command: `npm run deploy`
- D1 binding: `DB` → `fenmeat-sales-test`
- D1 ID: `c50b5aff-e422-4430-8b51-8237248f9c23`
- No paid upgrade, production domain or live data migration is part of this setup.

The deploy uses only `v2/public` as public assets. Existing repository root files belong to the legacy app and are not served by this Worker. The old Apps Script endpoint and master spreadsheet are not called. `main` is not modified.

Cloudflare may label this Worker's selected branch as its production branch. Select `build/sales-v2-cloudflare`: the separate Worker and D1 database are both test resources. Do not select `main`. Disable builds for other branches during this setup so legacy branches are not accidentally deployed to this Worker.

The initial page and `/api/health` are public and contain no business data. The endpoint only checks whether the five starting tables exist. All data-change methods and business-data paths are disabled. Staff authentication must be implemented before any business endpoints or imports become accessible.

The five tables were created manually by Alex in the D1 console on 30 September 2026. `migrations/0001_initial.sql` records the same definitions for reproducible development. Deployment does not execute database migrations. The migration has not been remotely applied or marked as applied by this code.

## Local verification

```sh
npm ci
npm test
npm run check:deploy
```

`check:deploy` bundles only; it does not deploy remotely. To try the setup page with a local D1 database:

```sh
npx wrangler d1 migrations apply fenmeat-sales-test --local
npm run dev
```

## Agreed operational scope to implement

1. Adjustable morning load forecasts from actual recent sales, with a stock buffer. Compare 8-week and weighted 12-week baselines through backtesting. Missing history is not zero sales; stockouts constrain observed demand.
2. Actual morning loading and evening returns stored separately from forecasts and manual plans. Blank capture is unknown, not zero.
3. Route-day-product quantity reconciliation with Zoho invoices. Damage, transfers, samples, returns and corrections need separate reasons/audit records. Unexplained losses must not train the demand forecast.
4. Counted cash reconciled with actual payments received that day, separating current sales from collection of older credit by invoice allocations. Keep cash, Shop2Shop, other cards and EFT separate; handle float, deposits and cash adjustments explicitly.
5. A new Google Sheet as a synchronized reporting copy, with background synchronization, visible freshness and retries. No writes to the existing master file.

Still required: remaining schema and migrations, route/product import, historical validation and forecast tests, secure staff sign-in, auditable saves with idempotency/concurrency protection, Zoho authorization and read sync, reconciliation, new Google spreadsheet/report sync, UI acceptance tests and a pilot. Supplier ordering and commission are outside this phase.
