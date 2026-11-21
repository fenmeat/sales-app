# Shop2Shop from saved Zoho receipts — 0.17.6

Shop2Shop received automatically displays the sum of this route/date's complete
saved Zoho payment allocations when the independent manual field is blank.
Current and older invoices are included once, using payment date and allocated
invoice route. Cash, Card, EFT and physical captures are unchanged.

The summary exposes `received.shop2shop` and `receipt_sources.shop2shop` (`zoho`,
`manual`, or null). Cash-up and Reconcile label the derived amount **Volgens Zoho**;
Cash-up shows the source read timestamp in SAST. Reloading derives the amount
from the same persisted snapshot. A subsequent complete Zoho read updates it.
This is not background sync or a new payment write.

An existing manually captured amount, including zero, always takes precedence.
An expandable statement check accepts an independent total. Clearing it restores
the automatic display. Manual JSON extracts, incomplete data or a wrong date/route
never trigger automatic filling. Missing data is not silently turned into zero.

The derived display does not overwrite `run.cash.shop2shop`, create a revision,
pretend to verify settlement, or change the existing close gate. Until a statement
total is captured, the Shop2Shop variance remains unknown and the interface says
**Statement not checked**. No day closes automatically. Deployment rollback needs
only the previous app version; there is no data migration.

Tests cover positive and zero totals, older-invoice collections, manual precedence,
snapshot refresh, missing data, source labels, reload and unchanged close checks.
The Worker integration test verifies save/reload without changing captures.
