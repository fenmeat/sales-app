# Forecast validation and release policy

Release 0.39.5 improves the Morning Load explanation and preserves the active
8/12-week forecast policy. The new candidates in `balanced-forecast.js` are
**offline only**. Neither Worker nor production planning imports them. Lower
loading alone is not sufficient evidence to activate a candidate. The private
13 November 2026 report records the comparison and why no candidate passed.

## Current calculation

The 8-week arithmetic mean is compared to a 12-week weighted mean (28-day
half-life). On up to eight earlier comparable visits with at least four prior
observations, uncensored mean absolute errors choose weighted12 only if it
improves MAE by more than 5%. The current reserve is the greater of 3 units,
15% of expected sales and the nearest-rank 85th percentile of positive errors
when at least four positive errors exist. This conditional percentile can be
much higher than the 85th percentile of all errors.

Month factors use completed months, product-relative ratios pooled by route
and comparable weekday, at least three qualifying months and five products
per phase/month, neutral shrinkage, and bounds 0.65-1.75. The old reserve is
retained after that adjustment. The final proposal is the greater of the model
quantity and latest positive comparable sales plus max(3,15%), rounded up.
These are alternative minimums, not additive reserves.

## Evidence and reproducibility

`get_forecast` supplies admin-only bounded `evidence`: imported rows, the
conservative last import timestamp, and changes to stock-confirmation history
with saved timestamps. It excludes customer, payment, staff and note payloads.
`compactForecastTimeline` invalidates drafts after stock changes and preserves
reconfirmation and invoice-match quality. Normal Morning Load reads do not
request this audit export. All physical confirmations still follow the
existing reconciliation rules; no data is promoted to invoice-verified.

`node scripts/backtest-stock-policy.mjs PRIVATE_DIR RESULT.json` compares the
legacy, signed-error, returns/stockout-aware seasonal and empirical policies.
The directory contains catalog.json and R01.json through R11.json from the
read-only connector. Input/output is private and must not enter this public
repository. Factory POS R12 has no loading schedule and is excluded explicitly.
Training is rebuilt at 05:00 Africa/Johannesburg on each target date, using
only imported data and event revisions available then. Eventual confirmed
sales are evaluation targets only. Current schedule rules were established
13 October, so evaluation starts 14 October; 30 October onward is held apart.
Legacy per-row ingestion dates and older catalogue revisions do not exist;
pre-import evaluation is therefore not claimed. The script fails on any
missing route file. Its service-date boundaries intentionally identify the
frozen experiment; a future experiment must use an independently chosen cutoff.

Signed errors include overpredictions. The balanced candidate separately uses
positive stockout errors as lower bounds, never invents lost sales, and only
uses consistent completed-month seasonality; it deseasonalises past values
before applying the target phase. An empirical 85th-percentile alternative is
also compared. Historical sales limited by stock are lower bounds. Sensitivity
cases of +10% and +25% additional demand on those visits are scenarios, not
observed lost sales or guaranteed confidence bounds.

## Display, preservation and rollback

The main card shows expected sales rounded up, one effective safety quantity,
and previous comparable sold/returned counts. Expected + safety = suggested.
Unknown returns show Unknown; explicit zero remains zero. Details explain
when the latest-sales minimum actually raises the proposal and retain quality
warnings. Saved historical forecast snapshots are not rewritten. Existing draft
plans can Refresh suggestions; explicit zero/manual plans, OUT/IN, notes,
reconciliation, invoices and payments remain untouched.

No schema change, migration, operational write, supplier action or automation
change occurs. To roll back, revert only this presentation/evidence release
on the latest `build/sales-v2-cloudflare` head and use its ordinary Cloudflare
pipeline; do not reset the branch across later work or restore an old database.
The active legacy model already remains the fallback. Candidate activation
requires a new dated evaluation demonstrating the intended stock/service tradeoff.

Tests: `npm test`, `npm run check:deploy`, and the isolated
`Forecast browser acceptance` workflow. Browser fixtures cover expected/safety
arithmetic, unknown returns, preservation of explicit manual plans on refresh,
editing and phone/tablet overflow. Browser profiles are not physical-device
user acceptance.
