# Sales App performance review — 24 September 2026

Review branch: `review/sales-app-2026-09-24`. Baseline: `c729310`.

## Problem and change

Startup previously waited for the window load event (including external resources), loaded the PDF library for every visit, and fetched stock followed by forecast, saved load and saved sales for each route sequentially. The screen was rendered only after every route finished.

The review version starts at DOM readiness, defers local scripts in order, loads fonts without blocking startup, and downloads the unchanged jsPDF version only when a PDF is requested. Stock and each route's independent reads run concurrently (at most 10 startup reads on a three-route day). No extra ping request is needed. The active route becomes editable as soon as its own complete data is available. Another route completing does not redraw inputs already being edited.

Reads are applied in the existing logical order: forecast, confirmed OUT, saved SOLD to reconstruct IN, then stock suppression. Product catalog, prices, route rotation, commissions, write payloads, and print layouts are unchanged. No backend code, business data, or production deployment has been updated.

Date changes clear route state, cancel outstanding startup reads and invalidate old responses. Late Evening Zoho and Cash Up responses are scoped to the view that requested them. Reads have a 45-second deadline. A failed stock or saved-log read blocks capture for the affected route with a Retry button; failures are not presented as valid zero quantities. A confirmed missing log still uses the existing forecast behavior. The weekly forecast fallback remains supported. There is no automatic retry of saves and no persistent cache of quantities.

## Verification

The real `getLoadLog` endpoint was read without writing, confirming the `status`, boolean `found`, and `products` array contract for a saved route. Remaining correctness/performance testing uses simulated responses so it cannot alter production data.

Browser regression command:

```
npm install --no-save playwright
npx playwright install chromium
node tests/loading.cjs
```

An existing Chromium executable can be supplied via `CHROME_PATH`.

The test serves the baseline and review app locally and intercepts all external traffic. With an equal 150ms delay per simulated API read, an initial run measured baseline readiness at 1,183ms and review readiness at 200ms. This is a controlled frontend comparison, NOT a live iPad or Apps Script benchmark. Fonts/PDF are also tested for absence from the startup critical path. Actual improvement depends on Google Apps Script latency and concurrent request behavior.

Coverage: saved OUT/IN, hidden loaded records, stock suppression, first-route readiness while another route is slow, preservation of edits, failed saved-log reads and retry, rapid date changes on the same routes, missing logs, stock failure/retry, weekly forecast fallback, late Cash Up responses, PDF request deduplication, and mobile Evening rendering.

## Before merging

1. Open this branch on a separate test origin, with the existing Apps Script endpoint. A GitHub branch link is a code view, not a running preview.
2. On the actual iPad/connection, compare cold and repeat visits with the same route/date. Confirm saved OUT/IN against the current app, especially zero sales and no-stock products already loaded.
3. Check Morning/Evening, Cash Up, COM, Stock, prints and English/Xhosa PDF output. The automated PDF test verifies loading, not the final PDF content or native iPad share behavior.
4. Test genuine saves only as part of authorised operations; the review frontend points to the SAME live backend. Do not enter fake sales as a test.
5. Merge only after Alex's review/approval. The Apps Script backend is not included here apart from a print helper, so server-side consolidation remains a separate possible improvement if real latency is still excessive.
