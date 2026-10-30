# 0.14.0 — Supplier stocktake and documented packaging

The recipe register previously required one-material-at-a-time editing, and missing packing specifications omitted known purchase needs. This release adds a Stocktake tab under Recipes & Order Guy and restores the documented packing/roll conversions through an explicit authenticated update.

## Stocktake

- Supplier names are grouped without case differences. Enter purchase packs plus loose base units, with decimal commas accepted. Blank entries preserve uncounted/previous data; zero is an explicit count.
- Saves retain physical count date, actor, original pack conversion, and immutable register history. Requests are idempotent; stale revisions and cross-supplier changes are rejected. Owner access and same-origin checks remain in place.
- A later availability date requires explicit confirmation that earlier usage is covered by stock kept aside. The physical count is never redated; Order Guy uses only counts explicitly available for the chosen starting date. No automatic consumption ledger is claimed.
- Existing incoming deliveries stay outstanding unless the user explicitly marks them as already included in the physical count. Such receipts are removed from incoming to prevent double deduction; history retains the previous record.
- Unsaved entries stay on the screen after save errors. Reload saved data keeps entered values for review. Input controls are locked during save to prevent later keystrokes being discarded.

## Source-backed register update

Use **Review documented packaging update → Save documented update** once. The preview lists changes and any newer entries retained. No write occurs on GET or deployment. Ingredient formulas, prices and stock quantities are retained; new manufacturing allocations append recipe versions. The update is retry-safe and recorded once.

Sources read on 9 October 2026:

- Recipe Costing Summary: https://docs.google.com/document/d/1hb8pmHBz6Ijo_Ebf5rvzbXdYHq-VSAe8YU2PWrVK9ls
- Casing report: https://docs.google.com/document/d/1iH8xcqbpm_rlfl_Dbk-b4EcKiG6GGrWGMqASiWeh8Co
- Current Ordering Context: https://docs.google.com/document/d/1QCXeOa80hrU-0ODJKTuSC7kD9GeohChbvRCsxHmYThY
- Owner: 30 patty disks per roll, four per tray and five trays per bag. Existing costing specifies 3 kg per casing. Current recipe is 59 kg.

The current owner export produces 21 restored packing specifications, with per-line uncertainties retained. Russian bags use 150×250 vacuum bags, Vienna 150×200 and 300×450 outers, polony 450×600 outers. Polony gains four casings per approved 100 kg batch. Patty casings are purchased in packs of 25. The White Oval 2 material is corrected from a misleading label name to a tray, 200 per purchase pack.

Patty planning uses 590 disks per 59 kg batch: 147 complete trays and two loose disks, or 29.5 sales bags of equivalent contents. It requires 20 physical casings (19 full and one partial), not 20 full 3 kg rolls. Thirty bags therefore require two batches. Packing already frozen rolls consumes trays/film/bags but no new ingredient or casing demand. Earlier recipes are preserved; old 3% cooking-loss costing is not transferred.

Outer label stock allocation, film estimates, the mince-tray SKU, other unverified yields, bought-in SKU mappings and forecast gaps are not falsely certified. This update does not declare every supplier order ready.

## Verification and activation

122 automated tests passed, including real workerd/D1 saves, access controls, conflicts, retry handling, incoming preservation/receipt inclusion, and material arithmetic. Wrangler dry-run bundling passed. The update was also validated against the owner-provided revision-3 export without changing its source or stock.

Visual phone/tablet browser testing could not run: the local browser binary was unavailable and its download failed. Direct live app access remains blocked by the session browser security policy. Publication must be checked through the existing Cloudflare/GitHub build status; no live UI/data-save claim is made. The owner must apply the prepared register update in the published app and enter fresh counts.

Entry: https://fenmeat-sales-test.alexander-fenwick.workers.dev/recipes?view=stock

The screen displays App version 0.14.0. The existing draft PR and operational branch are retained; no merge or order submission is part of this release.
