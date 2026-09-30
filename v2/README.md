# Fen Meat Sales V2 — separate pilot

Pilot 0.2.0 implements the route-day workflow. It is not ready to replace the current operational system: automatic Zoho access is pending and Google report sync needs one-time activation.

- Test app: https://fenmeat-sales-test.alexander-fenwick.workers.dev
- Reporting spreadsheet: the separately supplied private **FenMeat Sales V2 — Test** file. Its ID is not committed here.
- Review branch: `build/sales-v2-cloudflare`; draft PR #2. Do not merge during the pilot.
- Worker and D1: `fenmeat-sales-test`; D1 ID `c50b5aff-e422-4430-8b51-8237248f9c23`.

Only `v2/public` is deployed. The current app, master spreadsheet and legacy Apps Script endpoints are separate and are not called or changed.

## Activate

1. Open the test app and try the demo. Synthetic figures stay in browser memory and reset on refresh.
2. Expand **First-time access setup**. Generate keys on your device and keep them in a password manager. In the test Worker's **Settings → Variables and Secrets**, add a **Secret** named `APP_ACCESS_KEYS` and paste the generated JSON. Deploy that configuration. Never put keys in GitHub, a spreadsheet cell or chat.
3. Sign in. Under **Setup & history**, upload the privately supplied `FenMeat_Sales_V2_Setup.json`. It loads the catalogue and provisional historical actuals in repeatable batches. Real sales history is not committed to this public repository.
4. In the new spreadsheet, open **Extensions → Apps Script**. Paste `integrations/GoogleSheets.gs`, save and run `setupSalesV2Sync`. Follow Google's authorization prompt and enter your app key in the dialog. Setup requires the test spreadsheet title and report tabs, then privately records that spreadsheet's ID in Script Properties. Limit script editing to trusted administrators: script editors can read Script Properties.
5. Continue using the existing system while testing. Zoho authorization and mapping checks are still required before operational acceptance.

Rotating a person's key revokes their sessions. Hashed session tokens expire after 12 hours. Missing access configuration blocks all business data. Public health reports infrastructure only, not operational readiness.

## Daily workflow

Morning suggestions, edited plans and actual loads are separate. Confirm what was physically loaded. Blank quantities mean unknown. Record evening returns and non-sale damage, samples or transfers with a reason. Stock sales equal loaded minus returned minus non-sale stock.

Reconciliation compares every product with issued invoice quantities, excluding draft/void invoices. Invoiced products absent from the load still produce discrepancies. The pilot imports a complete checked JSON extract under **Reconcile**, with a downloadable example. This is a manual bridge, not automatic Zoho sync. Invoice quantities must use catalogue sales units.

Expected cash = opening float + cash receipts received that day + other cash added − banked cash − approved expenses. Invoice allocation dates separate current sales receipts from old credit collected today. Unpaid invoices are not receipts. Shop2Shop, other card and EFT are matched separately. Include every receipt allocation exactly once. An omitted receipt cannot be detected from a receipt-only extract; unpaid cash-sale invoices and completeness need independent Zoho checks before sign-off.

Closing requires confirmed returns, complete reconciliation, zero product/payment differences and no unallocated cash. Saves append actor/time revisions. Repeated save IDs are idempotent; stale revisions are rejected. Reopening requires a note and removes that day's verified training data until closed again.

Only reconciled sales for positively loaded products become verified forecast history. Unexplained differences and never-loaded products do not train as sales or zero demand. Legacy history is provisional and visibly labelled; invoice reconciliation is unverified.

## Forecast

Compare an 8-week same-route/same-weekday average with a 12-week average weighted by a 28-day half-life. Rolling comparisons use earlier observations only. Four scoring observations and a 5% MAE improvement are needed to select the weighted method. Missing days are not invented as zeros. The buffer is the larger of 3 sales units, 15% of demand, or the 85th percentile of positive errors when enough exist. A zero base has zero buffer. Suggestions round upward; plans remain editable.

Sold-out observations are lower bounds on demand, carry warnings and are excluded as backtest targets. The pilot does not estimate unmet demand or enforce payday effects. The private spreadsheet contains a chronological historical comparison, which does not prove improvement over the old model.

## Reports

D1 is the operational source; Sheets is a one-way copy. The script refreshes the last 90 days every 10 minutes, upserts stable keys and retains older rows. Use **Rebuild full report history** after changing an older record. Failures preserve the last successful timestamp and show an error. Sync is acknowledged only after report writes finish. History, product, route and validation tabs are setup snapshots, not two-way inputs.

## Build and verification

Cloudflare: root `v2`, build `npm test`, deploy `npm run deploy`, selected branch `build/sales-v2-cloudflare`, preview builds off. `.node-version` selects Node 24.19.0; tests use built-in SQLite. This configuration does not require a paid upgrade.

```sh
npm ci
npm test
npm run check:deploy
npm run dev
```

Build copies shared domain/forecast modules into public assets. `check:deploy` bundles without publishing. Tests cover stock, cash/credit, missing vs zero, channel mismatches, forecast date isolation, access, revisions, retries, concurrent edits, close and reopen.

`0001_initial.sql` records the existing foundation schema; `0002_pilot.sql` records the additive pilot schema. The authenticated Worker initializes repeat-safe pilot tables. Deployment does not run migration commands. Use `--local` for local migration commands.

## Pilot limits

One combined route per day; online saves. No independent manager approval or staff roles. Weekdays are hints; Friday alternation is selected manually. Automatic Zoho sync, refunds/credit notes, multiple trips, offline capture, supplier ordering and commission remain outside this pilot. Review these acceptance items before replacing operational use.
