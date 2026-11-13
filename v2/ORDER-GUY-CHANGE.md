# Recipes and Order Guy — 0.12.0

The selected Sales V2 app needs its own recipe, material, packaging and costing
records. The legacy Master and old production app are no longer operating
sources. This change adds an authenticated register and an export built from
the saved V2 production plan.

- `/recipes`: recipe versions, material prices and dated stock, incoming delivery
  references, packaging, reviewed private JSON import and saved history.
- `/api/recipes`: Alex/Alinda session access. Writes append a revision with
  optimistic concurrency, source/reason and retry ID. Quantity or batch-basis
  changes require a new recipe version. Previous records are retained.
- `/api/import/recipes`: same admin checks, optionally existing bearer access.
- `/api/order-guy?from=YYYY-MM-DD&to=YYYY-MM-DD`: session read.
- `/api/sync/order-guy`: same output via session or existing admin bearer key.
  Maximum 31 production dates. Includes register/revision, live catalogue,
  latest saved plan per day, demand checks, coverage, contributions and warnings.
- Private operating data is imported after deployment, not bundled with public
  source or assets. No new credentials, account permissions or public data route.

The calculation uses `groups[].planned` once for new manufacturing. Shared
Russian/polony groups are not multiplied per size, and trolley allocations are
checked rather than added. Vienna halves scale the full recipe. Babalas uses the
saved plan's batch basis. Cutting frozen patties and packing cooked stock use
packing materials only. Unavailable current products are excluded via the
existing production view. Drafts and missing dates/decisions are explicit.

Price amounts are per material unit including VAT with original source date,
status and optional expiry. Missing/expired/uncertain prices cannot produce a
complete cost. Recipe costs exclude finished packing, labour and overhead.
Unknown material counts/reserves stay blank. A stock count must precede the
first production day; incoming deliveries only cover demand from their arrival
date. Pack rounding is a proposal, never a submitted PO.

Validation uses synthetic data for shared/half batches, recipe version/effective
date selection, unknown versus zero, expiry, units, late deliveries, packing
from existing stock, private access, CSRF, conflict/retry handling and preservation
of sales and production event rows. The existing Worker/runtime suite remains
required. No live plan or selling price is changed by migration.
