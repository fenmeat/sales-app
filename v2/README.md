# Fen Meat Sales V2 — separate pilot

Pilot 0.3.2 implements the route-day workflow and the approved capture-screen changes. It is not ready to replace the current operational system: automatic Zoho access and operational acceptance are pending.

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

Morning suggestions, edited plans and actual loads are separate. Confirm what was physically loaded. Blank quantities mean unknown. Record evening returns for loaded products. Stock sales equal loaded minus returned. Unavailable products are hidden from planning; any product already loaded remains visible for returns. Earlier saved non-sale adjustments remain intact and are shown as historical notes.

Reconciliation compares every product with issued invoice quantities, excluding draft/void invoices. Invoiced products absent from the load still produce discrepancies. The pilot imports a complete checked JSON extract under **Reconcile**, with a downloadable example. This is a manual bridge, not automatic Zoho sync. Invoice quantities must use catalogue sales units.

Expected cash is cash receipts received that day. Cash Count accepts whole-number quantities for R200 through 50c and calculates the counted total in integer cents. Counts are stored in the route revision and restored on reload. Opening float, banked cash, expenses and extra-cash inputs have been removed; earlier saved adjustments remain unchanged and are disclosed when present. Invoice allocation dates separate current sales receipts from old credit collected today. Unpaid invoices are not receipts. Shop2Shop, other card and EFT are matched separately. Include every receipt allocation exactly once. An omitted receipt cannot be detected from a receipt-only extract; unpaid cash-sale invoices and completeness need independent Zoho checks before sign-off.

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

## Approved screen changes — 1 October 2026

Approved together by the owner after review of Morning load, Evening returns and Cash-up. Implemented in the test branch only:

1. Light-blue surfaces and dark-blue controls replace the green theme.
2. **Print Stock Load & Return** prints an A4 staff sheet with route/date and Product / Out / Return only. Out comes from the saved route plan, even if there are unsaved on-screen edits; Return stays empty. Larger catalogues use two side-by-side tables on the same page. The ordinary Print action remains available.
3. Forecast explanations and the provisional-history warning appear once in the footer.
4. Capture rows become product cards on small screens; navigation and controls wrap. No horizontal capture scrolling.
5. Availability column and Show all products toggle removed. Current catalogue availability controls the morning list; loaded products remain available for evening capture.
6. Non-sale quantity/reason inputs removed. Existing saved adjustments are preserved, not erased or reinterpreted.
7. Cash Count replaces cash/adjustment inputs. Shop2Shop, Card and EFT remain separate. Counted total feeds reconciliation and is validated on the server.
8. Approved subsequently for all input boxes: entering or clicking an editable text, quantity, receipt or denomination field selects its entire current value for replacement. Includes login fields, search, salesperson, vehicle and route notes; works again after tab changes and Save/Reload. Date pickers, files, checkboxes and disabled/read-only fields retain their native behavior. Selecting alone does not alter or save data. Numeric constraints and keyboards are preserved.

9. Approved 2 October: the staff Stock Load & Return print adds a blank Cash Count block (R200, R100, R50, R20, R10, R5, R2, R1, 50c quantities and Cash Counted total). It stays on one A4 sheet with the product list; longer lists split into two columns. Out still uses the saved plan; Return and all cash-writing spaces stay empty, even when returns/cash are captured in the app.

No database migration, access-key rotation, new integration, forecast algorithm change or production cutover is part of this update. Real data must not be included in this public repository. User operational acceptance remains outstanding.

Verification for 0.3.0: 20 domain/API tests pass; Worker deployment dry-run succeeds. Local Chromium checks at 320, 375, 390, 768, 834, 1024 and 1280 pixels found no horizontal overflow in Morning load, Evening returns, Cash-up or Reconcile. Browser checks verified saved-plan printing despite unsaved edits, empty Return cells, load/return confirmation, denomination arithmetic and Save/Reload retention. PDF inspection confirmed one A4 page for the staff sheet, including a 49-product stress case. These checks use synthetic quantities and do not reconcile actual business sales or certify the forecast.

Verification for 0.3.2: all 21 domain/API tests and the deployment dry-run pass. The actual print renderer was exercised with saved plans and deliberately different unsaved/captured values: all products are present, Out uses the saved plan, and Return plus all nine cash quantities and Cash Counted stay blank. A4 PDF checks with WeasyPrint passed at 20, 21, 29, 40, 41 and 49 products; 29- and 49-product layouts were visually inspected for full names and handwriting space. Physical iPad/AirPrint confirmation remains with the owner.
