# Stocktake PDF Summary - 0.25.2

The Stocktake screen offers **PDF Summary** beside its existing navigation.
It opens a single portrait A4 page for the selected supplier and physical count
date. Each product occupies one line with two columns: Product and Stock count.
The full supplier group is included even when the screen's search hides cards.

The report uses saved physical counts. Explicit zero remains zero; a missing
count, or a count from another date, is shown as **Not counted** for the selected
date. The header states how many products have a saved count for that date and
the footer explains that earlier counts are not carried forward. The existing
records and their dates are unchanged. Quantities use the recorded purchase-pack
basis where supported; reserves, incoming deliveries and order estimates are not
added to or subtracted from a physical count.

Unsaved count or date edits block the summary with a message to save first.
Opening, printing, sharing and closing the report never save a count or complete
a task. Alex, Alinda, Xavier and Xalinda have the same report access as Stocktake;
invoice-only accounts and other users cannot retrieve the PDF. Prices, recipes,
source notes and unrelated register fields are excluded.

The existing authenticated PDF preview provides Back to app, Print and Share PDF.
Stocktake opens with the whole page fitted to the available screen. Zoom in uses
the existing larger view; Fit page restores the overview. Other report previews
retain their previous display. The Apple Home Screen browser handoff carries
the supplier, date and saved register revision. The selected register revision
pins stored counts; resale membership follows the current catalogue, as it does
in Stocktake. Browser printing remains an explicit user action.

There is no schema migration or operating-data rewrite. The report rejects a
supplier list that cannot fit one readable A4 page rather than truncating rows
or shrinking the text indefinitely. Rollback is the preceding app version.

Validation uses synthetic domain, screen and real Worker tests, a one-page PDF
render check, and the existing print-preview regressions. Native AirPrint and
sharing still depend on the device and browser; simulated tests do not certify
a physical iPhone or iPad printer connection.
