# Financial

Financial replaces the supplier workbook's day-to-day registers. Home shows the
entry only for the named Alex and Alinda accounts. Every API read, write, source
page, attachment, export and PDF independently enforces that same restriction.
The existing sales, stock, payroll and invoicing data are not modified.

## Workflow

- Monthly accounts: capture invoices and negative credits against a supplier and
  account month. Totals apply the settlement discount once to the month's net
  invoices. Conditional discounts remain labelled. Enter an actual statement
  total to compare it against the register.
- Weekly payments: keep supplier invoices, planned dates, purchase orders and
  payment evidence. Record payment supports partial amounts and actual dates.
  Paid balances derive from recorded payments; unknown opening balances stay
  unknown. Recording information does not send a bank transaction.
- Debt collection and credit warnings: keep route reports, driver feedback,
  verification and explicit decisions. Repeated warnings count distinct invoices
  for the same customer and route within 60 days. Historical balances do not
  imply that an invoice remains unpaid today. Credit decisions do not alter the
  invoicing account automatically.
- Garden Route Deli: separate purchases, stock counts, transfers, sales/receipts
  and profit. Missing cost or stock inputs stay unknown. Historical aggregate
  summaries remain in the source archive to avoid double counting.
- Each register supports search, date filters, edits, PDF reports and CSV export.
  Records support HTTPS document links and private JPG/PNG/PDF attachments up to
  500 KB. Images are resized before upload. Original source history is read-only.

## Integrity and migration

Amounts use integer cents. Each save requires the current revision and an exact
retry identifier. A transactional audit records the actor, reason and full saved
revision. Conflicts and uncertain responses keep the draft. Archiving preserves
history and removes entries from active totals; restoration is another revision.

The initial workbook is supplied privately as native Google CellData, never as a
public repository file. SHA-256 verified chunks preserve source values, formulas,
notes and links. All records and the completion marker commit in one transaction.
An identical retry is safe. A new initial import cannot overwrite existing data.
Duplicate weekly documents retain all original source rows and links, but count
once. Document dates and account months remain separate.

After capturing the latest source, run from `v2`:

```
node scripts/verify-financial-import.mjs /private/workbook.json /private/report.pdf
```

This isolated workerd/D1 check imports every record, reads every payload back,
checks source hashes and all monthly control totals, and can generate a PDF.
It cannot contact external services. The connector's Financial writes require
the existing explicit owner write scope. Production import readback must match
the same verified hash and counts before marking migration complete.

The exported JSON contains current records and import metadata; it is not a full
database backup. Source cells and revision history remain in the private database.
Rollback of code must retain all `v2_finance_*` tables and source chunks.

## Validation

Runtime tests cover named-account isolation, CSRF, exact retries, concurrent
updates, duplicate invoices, real D1 persistence, partial payments, attachments,
source checksums, import atomicity and PDF generation. DOM tests cover navigation
and retaining a draft after an interrupted save. Connector tests verify that a
read-only grant cannot write Financial. Physical mobile/print behaviour requires
a browser/device check in an environment supporting the existing Worker app.
