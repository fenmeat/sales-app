# Fen Meat Sales V2 — separate pilot

Pilot 0.7.2 implements the route-day workflow, the measured month-phase forecast trial, the owner-approved task-first interface and separate production planning. It is not ready to replace the current operational system: Zoho mapping checks and operational acceptance are pending. The owner confirmed the live read-only connection on 2 October 2026.

- Test app: https://fenmeat-sales-test.alexander-fenwick.workers.dev
- Reporting spreadsheet: the separately supplied private **FenMeat Sales V2 — Test** file. Its ID is not committed here.
- Review branch: `build/sales-v2-cloudflare`; draft PR #2. Do not merge during the pilot.
- Worker and D1: `fenmeat-sales-test`; D1 ID `c50b5aff-e422-4430-8b51-8237248f9c23`.

Only `v2/public` is deployed. The current app, master spreadsheet and legacy Apps Script endpoints are separate and are not called or changed.

## Activate

1. Open the test app and sign in with your existing personal access key. The demo was removed at the owner's request. Steps 2–4 below are initial provisioning instructions, not steps to repeat on an already configured app.
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

10. Approved 2 October: remove Try the demo, in-memory demo storage and sample reconciliation. Sign-in and saved D1 route records are unchanged; no data or access keys are cleared. The removed demo source remains recoverable through Git history.

## Parallel operational trial

The owner will enter actual route data for Thursday 1 October 2026, Friday 2 October and later dates. Existing entries on those dates must be reviewed, not automatically treated as verified actuals or erased. Keep using the existing production app as the official record during parallel testing. The two apps do not automatically synchronise with each other. Before a final cutover, back up and verify the retained/migrated real records; no production cutover is approved.

Zoho integration investigation is approved from 2 October: begin with read-only invoices, line quantities and customer payments. Preserve separate cash/Shop2Shop/card/EFT channels and use payment date for money received, including allocations to older invoices. Organisation, region, product IDs, route/salesperson IDs and collection-route attribution still need verification before activation. No Zoho connection, permission grant, token reuse or sync is implemented by this demo-removal update.

The 0.3.3 demo-removal update included no database migration, access-key rotation, new integration, forecast algorithm change or production cutover. Real data must not be included in this public repository. User operational acceptance remains outstanding.

Verification for 0.3.0: 20 domain/API tests pass; Worker deployment dry-run succeeds. Local Chromium checks at 320, 375, 390, 768, 834, 1024 and 1280 pixels found no horizontal overflow in Morning load, Evening returns, Cash-up or Reconcile. Browser checks verified saved-plan printing despite unsaved edits, empty Return cells, load/return confirmation, denomination arithmetic and Save/Reload retention. PDF inspection confirmed one A4 page for the staff sheet, including a 49-product stress case. These checks use synthetic quantities and do not reconcile actual business sales or certify the forecast.

Verification for 0.3.2: all 21 domain/API tests and the deployment dry-run pass. The actual print renderer was exercised with saved plans and deliberately different unsaved/captured values: all products are present, Out uses the saved plan, and Return plus all nine cash quantities and Cash Counted stay blank. A4 PDF checks with WeasyPrint passed at 20, 21, 29, 40, 41 and 49 products; 29- and 49-product layouts were visually inspected for full names and handwriting space. Physical iPad/AirPrint confirmation remains with the owner.

## 11. Zoho read-only authorisation — 2 October 2026

Pilot 0.4.0 adds **Setup & history → Zoho Books → Connect Zoho**. This is the connection stage; importing or automatically reconciling invoices/payments remains disabled until organisation, product, route and payment-allocation mappings have been checked against real Zoho data.

The owner created a separate **FenMeat Sales V2** server-based client in Zoho and stored its `ZOHO_CLIENT_ID` and `ZOHO_CLIENT_SECRET` as runtime Secrets on the test Worker. Keep the existing Self Client, legacy Apps Script integration and `APP_ACCESS_KEYS` unchanged. The registered callback is exactly:

`https://fenmeat-sales-test.alexander-fenwick.workers.dev/api/zoho/callback`

Sign in as `alex`, save any pending route changes, and press **Connect Zoho**. The owner reviews Zoho's permission screen. Requested scopes are only `ZohoBooks.settings.READ`, `ZohoBooks.invoices.READ` and `ZohoBooks.customerpayments.READ`. The Worker currently makes only a read-only organisation-list request, plus OAuth token exchanges/refreshes. The available organisation names and IDs are shown for verification; no organisation is silently selected from memory.

The accounts server defaults to `https://accounts.zoho.com`, matching the console used to register this client. An optional `ZOHO_ACCOUNTS_URL` can specify an officially supported region; do not change it unless the client's region is verified. Callback accounts servers and Books API domains must match a fixed official allowlist. Requests do not follow redirects or reflect upstream error bodies.

Authorisation uses PKCE S256 and 10-minute, single-use state, bound both to an HttpOnly/Secure/SameSite=Lax temporary browser cookie and the existing signed-in session. The ordinary app session retains SameSite=Strict. Logged-out/expired/changed-key sessions cannot complete authorisation. Only Alex can initiate or check the connection. OAuth results redirect to a clean app URL with a fixed status code; no token is returned to browser JavaScript, reports or route exports.

Access and refresh tokens are stored in the separate D1 connection table using AES-256-GCM, with a purpose-specific HKDF key derived from the Cloudflare client secret and client ID. Temporary PKCE verifiers are also encrypted. The secrets must therefore be retained unchanged: changing them does not silently overwrite or decrypt a previous connection. A successful token exchange is saved before checking Books, so a temporary organisation API failure cannot lose the refresh token. **Check connection** can retry and refresh expired access tokens. A saved authorisation is not automatically recreated.

`0003_zoho_oauth.sql` documents two new additive tables, also initialized through the existing repeat-safe schema mechanism. There are no destructive migrations, changes to captured routes/history, production changes or remote migration commands in this update.

Verification: the existing 22 domain/API cases plus 5 OAuth integration cases pass with synthetic data and mocked Zoho responses. Coverage includes read-only scopes, PKCE, one-use callbacks, browser/session binding, denial/expiry/logout, owner-only management, CSRF, encrypted storage, safe token refresh, failed API checks retaining authorisation, hostile destination rejection and unchanged saved route revisions. Deployment dry-run succeeds. Live Zoho permission and organisation verification require the owner's next action; no live Zoho records were accessed during development.

Sources: https://www.zoho.com/books/api/v3/oauth/ ; https://www.zoho.com/books/api/v3/organizations/ ; https://www.zoho.com/books/api/v3/introduction/ ; https://www.zoho.com/developer/oauth/web-server-apps/overview.html


### 11.1 OAuth response compatibility and failure diagnosis — 2 October 2026

After the owner accepted the read-only permission request, the live callback returned the generic failure message. The specific upstream failure is not known: the previous callback discarded diagnostic reasons. Pilot 0.4.1 fixes a reproducible compatibility problem: the official generic OAuth response can contain `https://api.zoho.com`, while Books uses `https://www.zohoapis.com`. Accept only these exact, same-region allowlisted origins and always use the canonical Books origin. Other regions, arbitrary hosts, paths, queries and redirects remain rejected.

Callback failures now use fixed, safe reason codes with specific staff-facing messages for rejected credentials, expired codes, network/response failures, region mismatches and app storage/encryption stages. No upstream text, tokens, keys or secret values appear in callback URLs, app responses or logs. Existing authorisations and all captured route data are preserved; no new permissions or schema changes are needed.

Regression coverage exercises the documented generic OAuth response through initial connection and refresh, hostile/cross-region response rejection, known and unknown upstream errors, network/JSON failures and storage/decryption failures. All 31 domain/API/OAuth cases and the Worker deployment dry-run pass. Live retry and organisation verification remain pending.

Additional source: https://www.zoho.com/developer/oauth/web-server-apps/get-access-token.html


### 11.2 Cloudflare runtime request fix — 2 October 2026

The owner's retry reached `unreachable`. Reproducing the full callback in local Cloudflare workerd/D1 returned exactly that result: workerd rejects `redirect: 'error'` before sending any HTTP request. The Node-only mocks and deploy dry-run did not detect this runtime incompatibility. Pilot 0.4.2 uses supported `redirect: 'manual'` and explicitly rejects all 3xx responses before parsing the body. No redirect destination is followed, so credentials remain restricted to the fixed Zoho endpoints.

Two new runtime regression cases execute the actual Worker, D1 state/session checks, WebCrypto encryption, token exchange and refresh in workerd. A local fake service handles all outbound requests without live credentials or external traffic. The success case failed before the fix with `zoho=unreachable`, matching the owner's screenshot, and passes after the fix. All 33 domain/API/OAuth/runtime cases and the deployment dry-run pass. Redirect cases cover 301/302/303/307/308 and preserve an encrypted authorisation when the Books organisation check redirects. The installed Miniflare version is pinned explicitly for these CI tests. Saved route revisions, app keys and production remain unchanged. Live consent and organisation verification still require an owner retry.


## 12. FEN confirmed and read-only invoice preview — 2 October 2026

**11 completed:** the owner's screenshot shows Connected — read-only, checked at 15:14:22 SAST. The available organisations are 441 (857912290), FEN (852102281), and FOUR4ONE (804365236), all ZAR. Alex explicitly confirmed that all invoices are recorded in **FEN**.

**12 in progress:** pilot 0.4.3 pins invoice reads to FEN ID `852102281`, checks that it is active and accessible in the saved connection, and displays it as the selected organisation. Under Setup & history, Alex can use **Load FEN invoices** (default check date 1 October 2026), page through 20 summaries at a time, and press **View invoice** to inspect its Zoho salesperson/route, status, product names, SKU, sales units and quantities. **Download invoice check** includes only those selected invoice fields and the app's product/route catalogue for matching. It excludes addresses, contact details, bank data, notes and all credentials.

This is a read-only verification step, not reconciliation data. It does not infer routes from invoice dates, assign products, total paid invoices as cash receipts, or claim a partial page is a complete extract. Draft/void invoices are visible with their statuses for checking. Zoho payments, current/old-credit allocation, product units and route mapping still need verification before import or automatic sync. These preview endpoints only make GET requests to the fixed FEN invoice endpoints; OAuth refresh remains server-side. No new permissions, destructive schema changes or production edits.

The preview is owner-only and same-origin. Dates are restricted to the authorised real-data trial from 1 October 2026 up to today. Pages and invoice IDs are validated; wrong-date/organisation responses and incomplete pagination are rejected. Runtime tests cover FEN-only reads even when a different organisation ID is supplied, real token refresh, paging, sanitised details, invalid inputs, wrong-date data and unchanged saved route revisions. Node tests also verify staff/CSRF rejection. All 35 domain/API/OAuth/runtime cases and the deployment dry-run pass. All automatic sync remains disabled pending the owner's live preview check.

API references: https://www.zoho.com/books/api/v3/invoices/ ; https://www.zoho.com/books/api/v3/introduction/

### 12.1 Confirmed product/route matching — pilot 0.4.4, 2 October 2026

**Approved and implemented:** Alex confirmed that ALL app/Zoho quantities use the same sales unit, with a factor of **1**. One Ouma is one outer bag containing five inner packs in both systems. Numeric prefixes in Zoho product names are legacy sort positions, never quantities or product IDs. Keep product names/grouping unchanged for now.

The live invoice list and detail view were confirmed in the owner's screenshots, followed by `fen-invoice-check-2026-10-01.json` for FEN invoice `INV-018567` (`5173603000008253001`). It has six separate invoice lines for five distinct products. The two Ouma lines each have quantity 1; their app quantity must be 2, not 10.

| Verified Zoho item ID | App code | App product |
| --- | --- | --- |
| 5173603000000845465 | W01 | BRAAI WORS |
| 5173603000000845476 | W02 | OUMA |
| 5173603000000845487 | W03 | CHAKALAKA |
| 5173603000000845751 | S01 | SIX GUN 20g SML |
| 5173603000000845762 | S02 | SIX GUN 200g BIG |

Verified salesperson ID `5173603000000932936` (`07. THURSDAY MOSSEL BAY`) maps to app route `R07` (`MOSSEL BAY`). Matching uses exact Zoho IDs and checks the saved app catalogue. It never guesses a match from name prefixes, SKU, customer name, date or weekday. Missing mappings, invalid quantities, duplicate line IDs, unknown invoice statuses and non-ZAR currency remain explicit issues. Draft/void invoices remain excluded; paid invoices are never treated as cash receipts.

The detail screen shows each matched app product and per-product quantities for **this invoice only**. The mobile SKU field now has its own full-width row, with wrapping, to stop the observed overlap with Unit. No Zoho records or app route captures are written by this check.

### 12.2 Remaining products and routes — in progress

**Check page products** reads up to 20 invoices from the displayed page, sequentially, with a 1.2-second wait before each request. It reuses the existing owner-only, same-origin FEN preview endpoints and can be stopped. **Download product check** provides the checked invoices, confirmed matches and app catalogue in one file. Failures/cancellation retain an explicitly partial report; a checked page never claims to be a complete day. This avoids requiring Alex to open/download each invoice individually.

Next: review the owner's first page product-check download to establish remaining item IDs and route IDs. Do not guess missing matches, import partial sales, enable scheduled Zoho sync or implement payment allocation from invoice-paid status. Payment-date and collection-route handling are still outstanding.

Validation: all **41** domain/API/OAuth/matching/page-check/workerd tests and the deployment dry-run pass. Tests verify the five exact matches, the repeated Ouma line total, invalid/missing mappings, partial downloads, sequential requests, cancellation, and unchanged saved D1 route revisions/history. UI syntax and public module serving also pass. Visual confirmation on the owner's phone remains outstanding. No schema migrations, access-key changes, production edits or main-branch changes.


## 13. Forecast data freshness and preserved plans — pilot 0.5.0, 6 October 2026

Owner authorised the forecast improvement plan after a review found recent actuals missing from the pilot import and saved forecasts frozen. This change keeps the existing 8/12-week estimator: the paired September diagnostic did not justify replacing it with a four-visit, 14-day-decay or last-visit estimator. The private comparison uses only prior observations for each target and excludes suspected stockout targets; provisional source quality still limits the conclusion. Run `node scripts/compare-forecast-models.mjs PRIVATE_SETUP.json PRIVATE_LOAD_ROWS.json ...` locally; do not commit private data or outputs.

Forecast reads now combine imported history with the latest confirmed physical returns from the real trial beginning 1 October. Matching stock/invoice quantities are labelled verified independently of cash close; confirmed physical movements without invoice reconciliation remain provisional. A later stock draft change, load reconfirmation or reopening invalidates the earlier approval until returns are confirmed again. Known invoice mismatches, non-sale adjustments, never-carried items and future/practice data do not become training observations. Saved event payloads and the imported history are not rewritten by this derived view.

Each new forecast stores a source fingerprint. Opening a saved plan compares that fingerprint with current history and flags changed input. **Refresh suggestions** saves a new audited revision and updates forecast fields only; explicit plan values (including zero), loads, returns, cash, notes and product snapshots are preserved. Refresh is unavailable after load confirmation. **Use forecast as plan** remains a separately confirmed operation; it is not part of refresh. The screen shows expected sales, buffer, latest comparable sales/date and missing/low suggestion warnings. No automatic last-week minimum or unproven payday factor is introduced.

Setup accepts a `kind: fenmeat-history-update` JSON with `history` rows, without catalog replacement. Batches reject duplicate keys, invalid dates/quantities and invalid stockout flags. Imported data stays provisional; reconciled rows are protected and confirmed captures take precedence. Legacy read/import still requires authentication and original access keys. No migration, credentials, Zoho writes, production app or original Master File change is part of this update.

Validation: domain and real workerd/D1 tests cover history precedence, physical confirmation independent of cash, changed/reopened/adjusted/uncarried stock exclusion, matching and mismatched invoice quantities, protected refresh, idempotency, stale revisions and saved manual plans after reload. Existing OAuth, invoice matching and security tests are retained. Live import and browser verification must be recorded separately after completion.

## 14. Measured month-phase adjustment — pilot 0.5.1, 6 October 2026

Alex confirmed that the start of the month is traditionally busier and authorised testing a calendar adjustment. V2 now distinguishes days **1–7**, **8–14**, and **15–month end**. These are the newly requested calendar groups, not the old app's ALL_PAY_WEEK/FORTNIGHT_WEEK labels or supplier-ordering rules.

`month-cycle.js` keeps the existing same-route/same-weekday 8/12-week expected-sales baseline and learns a multiplicative route index from the preceding 168 days. Only completed calendar months are fitted. Each product/month must have at least three observed visits covering at least two phases and average sales of at least three units. Product quantities are divided by their own monthly average before pooling, so unlike products' units are never summed to estimate the index. Each month/phase needs at least five eligible products; the median relative-sales index limits individual-product outliers. At least three comparable months are required. One neutral pseudo-month shrinks sparse evidence towards 1. The final factor is bounded to 0.65–1.75 as a guardrail, not an assumed uplift.

The adjustment applies to **expected sales**. The existing calibrated buffer is retained, or increased if 15% of adjusted expected sales requires more. One buffer is added, never two. This deliberately avoids cutting the existing reserve while introducing calendar seasonality. An unsupported phase retains the ordinary forecast; no-history and explicit-zero distinctions remain. Known stockouts remain lower-bound sales and keep their warnings; no lost demand is invented. The pool is separated by weekday, including routes visited on more than one weekday.

The UI reports the date's phase, measured route percentage and number of completed months. When a saved plan's source/model fingerprint is stale, its old quantities remain visible and the new adjustment is not falsely labelled as already applied. **Refresh suggestions** uses the existing audited revision/idempotency/concurrency workflow and preserves manual plans and actual captures. The versioned fingerprint invalidates older model snapshots without rewriting them. Prices, units, catalogue, schema, credentials, production app and original Master File are unchanged.

### Evaluation and limitations

Run `node scripts/compare-month-cycle.mjs PRIVATE_SETUP.json PRIVATE_HISTORY_UPDATE.json PRIVATE_LOAD_ROWS.json ...`. The script constructs chronological, paired forecasts using only earlier observations for each target and preserves the app's actual history metadata. Independent load evidence excludes suspected stockout **evaluation targets**, without silently adding unavailable stockout flags to model inputs. June–July is exploratory development; August and September are later diagnostic windows, not an untouched prospective trial. Alternative product-only and shorter-history approaches were also explored privately. Do not commit any private input or generated business-result file.

The chosen route model showed only a **small** reduction in aggregate expected-sales error across these windows. First-week simulated shortages decreased, but excess suggested stock increased; first-week point error did not improve. Second-week shortages can increase on individual observations despite better aggregate point error. These trade-offs are explicit: software tests do not certify future demand accuracy, all legacy history is provisional, and a suggested excess is not an observed physical return. Monitor actual loads, returns, stockouts and confirmed sales during the existing pilot before changing the reserve or claiming a material accuracy improvement.

Validation: **55** tests pass, including calendar boundaries, incomplete/future-month exclusion, correct weekday and quality filtering, scale-invariant pooling, sparse-data fallback, no invented sales, one-buffer behavior, and a real workerd/D1 refresh/reload preserving all non-forecast capture fields. The deployment dry-run passes. Live deployment and both Wednesday refreshes are recorded in draft PR #2 after verification.

Method references: https://otexts.com/fpp3/tscv.html ; https://otexts.com/fpp3/forecasting-decomposition.html

## 15. Approved usability update — pilot 0.6.0, 6 October 2026

Alex approved the in-conversation layout, requested larger product names, then authorised implementation in the existing test app. Four persistent, labelled destinations keep Morning load, Evening returns, Cash-up and Reconcile reachable while scrolling. The compact route picker puts the selected date's scheduled routes first, with all other routes still available. Date and route remain explicit. Print opens the existing saved-plan Stock Load & Return sheet; More contains saved history, reload, Setup & Zoho, current-view printing and sign-out.

Product names are 24px and bold on all capture layouts. Quantity and cash-count inputs are 24px with at least 54px height. Morning cards separate the forecast suggestion, editable plan and actual load; tablet widths use two product columns. Forecast explanations, route details and notes expand on demand. Stale/missing-data and low-suggestion warnings remain visible. Reconciliation owns the summary metrics. Cash-up's primary action reviews reconciliation rather than closing the day directly; closing still uses the existing server checks. The persistent dock reserves its measured height and respects device safe areas and the visual keyboard viewport.

Save draft remains explicit. Saved, unsaved, saving and failed-save states are distinct. Pending saves temporarily suspend editing/navigation; failures restore editing and keep the typed values. Changing work views preserves in-memory drafts; changing date/route or reloading still asks before discarding unsaved edits. Selecting an input still selects its entire value. Refresh suggestions and Use forecast as plan remain separate, with the existing replacement confirmation.

Scope: interface plus version metadata only. No database migration, catalogue, unit, price, forecast/domain algorithm, history, access-key, dependency or automatic Zoho sync change. Production, main and the original Master File are untouched. No production or test business records were written for validation.

Validation: the existing 55 domain/API/workerd tests and Worker deployment dry-run pass. Local Chromium exercised the actual interface against the actual Worker with an isolated ephemeral D1 database and synthetic catalogue/captures. All four work views fit 320, 390, 768, 1024 and 1280px; navigation stays reachable after scrolling. The flow verifies value replacement, unsaved and explicit-zero quantities across tabs/Setup, cancelled route/date changes, draft save/reload, forecast refresh retaining non-forecast fields, load/return confirmation, cash-count persistence, and a simulated failed save preserving entered data and the stored revision. No browser exceptions were observed. The 29-product saved-plan printout remains one A4 page with blank Return and Cash Count fields. These are simulated browser/runtime checks; physical iPad Safari and AirPrint acceptance remain with the owner.

Publish only to `build/sales-v2-cloudflare` and the existing test Worker. Keep PR #2 in draft; do not merge. Record the deployed commit and verified live build in that PR and the existing PA app record.

## 16. Production planning — pilot 0.7.0, 6 October 2026

Alex authorised implementation after confirming that available stock is counted after the day's trucks depart, before production, and that production must retain the existing suggestion-versus-manual-plan choice. Open **Production** from the sales header. Select a production date and target route date, review the included routes, and enter available stock in catalogue sales units. Stock on departed trucks is already excluded and is never subtracted again.

Route demand uses each saved manual route-plan quantity, including explicit zero, and otherwise the current forecast suggestion. Sum the selected routes before subtracting available stock once; no additional buffer is added. Missing counts and missing forecasts remain unknown, not zero. For ordinary recipes, round a positive shortage up to whole batches. Example: need 30 Braaiwors, stock 10, yield 13 gives 2 suggested batches, 26 output and 6 left after loading. **My plan** is a separate whole-batch decision. Accept a suggestion explicitly or enter another value, including zero. Bulk acceptance fills blank plans only. Shortage warnings do not silently change the owner's plan.

Planning yields were checked read-only against the existing production app's current `getBagsPerBatch` output on 6 October: W01–W08 = 13/26/24/55/50/16/29/31, R05–R07 = 22/24/23, V01/V02 = 32/36, and P02–P04 = 122/61/31. These are operational planning references, not guaranteed measured output; some legacy Master DATA rows differ. Each product exposes its editable yield. A new production date starts with the latest earlier saved yield settings but blank counts, manual plans and actual output. Existing production plans retain their saved yields.

Russian sizes R01–R04 share one recipe: aggregate shortages using 1310 loose Russians per recipe and 60/50/40/30 loose per sales bag, then round the combined recipe need once. Polony sizes P02–P04 likewise share a combined recipe calculation using their size-specific yields. Both groups have one batch plan plus separate manual packing quantities by size, with capacity warnings. P01/R08 are surplus packing, not independently cooked recipes. Bought-in products use buy/repack quantities; this screen does not send orders. Ingredient requirements, trolley allocation and automatic stock carry-forward are outside this release; keep using the original production app for those tasks.

**Refresh route needs** replaces only the demand snapshot and retains counts, yields, manual batches/packing, actual output and notes. Opening an existing plan flags changed sources without replacing saved figures. Route/date selection requires an explicit refresh. Saves append separate `v2_production_events` revisions with actor/time, idempotency and stale-revision protection. Existing sales events and history are not written. Confirmation requires an explicit plan decision for each group and acknowledgement of visible shortages/missing counts. Actual output is recorded separately after confirmation; it does not add stock or alter route plans. Printing uses the saved My plan, including its draft/confirmed status, even when unsaved screen edits differ. Saved history and draft download are available under More.

`0004_production_plans.sql` documents the new additive table, created by the existing repeat-safe authenticated schema initializer. No destructive migration, catalogue update, access-key change, dependency change or automatic Zoho sync is included. Original production files, the original Master File and main are unchanged. No live operational records were created or changed for testing.

Validation: 65 domain/API/workerd tests pass, including combined rounding, explicit zero, unknown quantities, shared recipes, server-owned demand, saved yield inheritance, revision/idempotency conflicts, rejected cross-origin writes, read-only audit access, refresh/manual preservation, confirmed actuals and isolation from route events/history. Worker deploy dry-run passes. Local Chromium with the actual Worker and synthetic D1 passed 320/390/768/1024/1280px layouts with 24px product names and numeric inputs, no horizontal overflow or browser errors. The browser workflow covered save/reload, manual zero, cancelled date changes, saved-plan printing, failed-save retry, source refresh, confirmed actual output and preservation of unrefreshed route selections. The 29-product production print sample fits a legible A4 page; larger plans may continue across pages. Physical iPhone/iPad Safari and AirPrint remain owner acceptance.


### 16.1 Production navigation repair — pilot 0.7.1, 6 October 2026

Alex reported a raw `{"error":"Not found."}` page when opening Production. A live HTTP check reproduced `production.html` → HTTP 307 `/production` → HTTP 404: Cloudflare canonicalizes standalone HTML assets to extensionless paths, but the Worker allowlist only contained the `.html` spelling. The previous local browser fixture served files directly and missed the actual asset redirect. The earlier cloud-browser policy block did not establish that this page worked.

Allow the canonical Production and access-setup paths, including trailing-slash variants for the asset service to normalize, and send the Production button directly to `/production`. Keep existing `.html` links working. No broad fallback to the sales page is added; unknown paths remain 404 and business API access still requires authentication. No schema, captured data, manual plan, forecasting, recipe, credentials, dependency or production/Master changes.

A new integration case uses the actual Cloudflare asset service in workerd with the shipped Wrangler routing configuration. Before the fix it reproduces the same final 404 JSON; after the fix it follows the full HTML redirect chains and verifies the correct screens, supporting modules, response headers, unknown-page 404 and protected production API. All 66 tests and the deployment dry-run pass. Live deployment and final HTTP verification are recorded in PR #2.

Reference: https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/


### 16.2 Shared packing drives batch suggestions — pilot 0.7.2, 6 October 2026

Alex found that entering 100 Russian 6 sales bags in My packing plan left the suggestion at the route-shortage total of two batches. Shared Russian and Polony suggestions now use each entered packing quantity, including explicit zero; only blank sizes fall back to the current shortage. Sum all sizes as recipe fractions and round up once. Packing quantities mean new output, so available stock is not deducted from them again. For the current Russian yield, 100 Russian 6 alone needs ceil(100 × 60 / 1310) = 5 batches; other sizes can increase the combined total.

The suggestion updates immediately while typing. A short note identifies whether packing quantities or only shortages are being used. Use suggestion accepts the resulting batch count and fills blank packing quantities, preserving every entered packing quantity. Existing manual batch choices, including zero, remain untouched until explicitly replaced; capacity/shortage warnings remain. Bulk acceptance still fills blank batch plans only. Fully specified packing quantities can be calculated before stock counts are known; missing counts retain warnings, and any unknown blank-size shortage prevents an unsupported combined suggestion.

Saved production counts, yields, packing quantities, manual batches, actuals and notes are preserved on reload/refresh. No schema, route-plan, forecast, recipe-yield, credential, dependency, original production app or Master File changes. Tests cover the reported two-to-five-or-six batch case, all sizes combined, explicit zero, blank fallback, partial unknowns, clearing overrides, Polony, accepting without losing 100, and real D1 save/refresh/reload with route/history isolation. All 70 tests and the deployment dry-run pass. Local Chromium against the actual Worker, Cloudflare asset service and synthetic D1 verified Sales-to-Production navigation, immediate packing-based suggestions, accepting without overwrites, explicit zero, saved/reloaded/refreshed quantities, preserved saved-plan printing and no route-event changes. Layouts at 320/390/768/1024px have no horizontal overflow, with zero browser errors. Live deployment evidence is recorded in draft PR #2.
