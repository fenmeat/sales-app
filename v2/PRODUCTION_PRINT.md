# Production staff PDF (0.22.2)

Print staff sheet now follows a direct authenticated PDF link. The server
reads the latest saved production revision without refreshing route needs or
writing plans. Unsaved screen edits are excluded. The existing staff model
retains chosen quantities, shared recipes, label rules, manual trolleys,
review warnings and blank Actual cells for handwriting.

Ordinary plans fit one A4 page. Large plans continue on readable pages with
repeated context and table headings; rows and notes are not clipped. Print or
share from the PDF viewer on iPhone/iPad. No new dependency or migration.
Detailed production and trolley print retain their existing workflow.

243 tests pass, including real Worker authentication, latest-revision reads,
no production writes, unsaved-input protection and overflow/text retention.
Worker dry-run passes. One-page and overflow PDFs were visually inspected.
Physical Safari/AirPrint remains a device acceptance check. Rollback uses
the previous application commit; production data needs no reversal.
