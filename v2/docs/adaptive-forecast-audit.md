# Follow-up adaptive selection audit

This audit does not change any production prediction or plan. It extends the
13 November comparison after its holdout results had already been inspected.
It is exploratory, not another independent holdout or evidence of optimality.

Run `node scripts/audit-adaptive-stock.mjs PRIVATE_DIR BASELINE.json OUTPUT.json`.
Use the frozen private evidence and baseline result from the first audit. Do
not commit the input, output, route metrics or business observations here.

The product selector requires at least three prior comparable visits both
locally and across its route. An alternative is eligible only if it reduced
prior excess and did not worsen shortage units, shortage frequency, or the
10% and 25% additional censored-demand scenarios, at both levels. A separate
route selector tests the same rule without the product-level gate. These are
historical gates, not guarantees of future service. Candidate policies and
their original safety floors remain those in `balanced-forecast.js`.

Each selection replays the outcomes actually available before 05:00 SAST.
Eventual corrected targets in the baseline file cannot train the selector.
Unknown returns, invalidations and alternative route cycles are respected.
Three products on one visit do not count as three independent visits.

The script reports deterministic paired route-cluster bootstrap intervals
(10,000 draws, seed 20261113, percentile endpoints). Whole routes are sampled
so repeated observations within a route remain together. Eleven routes and
common calendar shocks limit interpretation. These intervals do not establish
causality, account for model-search multiplicity or replace future validation.

Neither selector passed the private service/inventory comparison. Keep both
offline. Production remains 0.39.5 with the existing forecast formula. The
physical-device acceptance gap also remains: browser emulation is not proof
that the owner's own phone/tablet has been tested.
