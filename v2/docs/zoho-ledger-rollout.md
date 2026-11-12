# Zoho mirror and Britos close rollout

The pre-change release is `13cdc0e7041d7cef4e1b8b442b5cb80b3b84aa15` on the existing `build/sales-v2-cloudflare` branch. Do not change main, the app audience, credentials, financial transactions, route history or unrelated scheduled tasks.

Rollback: disable the mirror through its revision-checked control first; deploy the pre-change source through the existing Cloudflare build. All new tables are additive and retained on rollback. No down migration, DELETE of business records, or restoration over newer business data is allowed. Uncommitted mirror runs remain invisible to reporting. Bootstrap source and every accepted version remain available for audit and resumption.

Rollout order: isolated D1 tests and R02 replay; full regression tests and deploy dry run; publish tested source; verify live version; import the private checked baseline by hash in bounded chunks; verify counts and amounts; run bounded read-only Zoho delta and verify source contract; enable 22:00 Africa/Johannesburg only after success. The existing five-minute cron resumes work; it does not start a fresh history scan. Never put baseline customer data, tokens or payment evidence in Git.

Reports must remain incomplete when source coverage, settlement linkage, product ownership or app/Zoho migration overlap is unresolved. No staff payment instructions may be sent in that state. A scheduled task being enabled is not proof of a successful report or email.

## Connector operations

Read `get_zoho_data({query:{resource:"status"}})` for mirror revision, enabled flag, successful watermark, counts, errors and current job. For the cached Britos report use `resource:"status", date:"YYYY-MM-DD"` (sales cutoff). Retain `mirror.report.snapshot_id`; page the immutable report with `resource:"status",job_id:snapshot_id,page:2` etc. Monetary report fields are integer cents. The report records the actual receipt cutoff separately. Keep PDF, supporting workbook and source snapshot linked in the existing PA cycle.

The existing admin-only Financial transport accepts `save_app_data` with `target:"financial"`, current mirror `revision`, unique retry-safe `request_id`, authority in `reason`, and `data.operation`:

- `zoho_import_start`: `import_id`, `manifest:{id,parts:[sha256...]}`.
- `zoho_import_chunk`: `import_id`, zero-based `part`, UTF-8 JSON `payload` (at most 100,000 characters).
- `zoho_import_finish`: `import_id`. Verifies all hashes and reconciliation before a single atomic promotion. A second baseline cannot overwrite the first.
- `zoho_run` starts/resumes a bounded source-read job; `zoho_resume` continues it. No Zoho writes.
- `zoho_arm` explicitly authorises the existing five-minute cron to finish a started initial catch-up and activate the daily schedule only after its atomic validation succeeds. It never starts another run while pending. `zoho_disable` cancels pending activation as well.
- `zoho_enable` requires a successful delta; `zoho_disable` stops scheduled work. Already staged versions remain available.
- `zoho_owner_settlement`: only on actual confirmation, supply `evidence` and allocated `lines:[{invoice_id,key,owner,amount}]`. Never infer payment from a report or use guessed FIFO. Partial owner transfers are supported in cents. Uses the existing PA record as evidence, not a competing bank register.
- `zoho_review`: actual `owner_confirmed_through`, verified `evidence`, and exact `resolved_exceptions` if applicable. This is not a means to suppress unreviewed gaps.

New details use Zoho modification filters with a two-day overlap and stable source IDs. Pages and details have durable checkpoints; a whole completed generation and its watermark promote atomically. Old invoice refreshes follow changed payment allocations. An initial and weekly bounded header-only inventory detects missing source IDs; retained evidence is never deleted. Unknown fields, ignored filters, unknown product ownership, credits and changed settled lines stop final payment instructions. The inventory reads headers within the existing report scope; it does not repeatedly download historical lines or payment details. Source API contracts must be verified live before activation.

The existing PA Monday automation still creates the PDF and workbook and applies its signature, Sent and duplicate-send checks. It consumes the cached report, not a complete fresh Zoho export. No test mail is sent during rollout.

R02 records whose source modification precedes the checked export boundary by more than two hours reuse the baseline even when their CSV has no API timestamp. New IDs and changed records still load details. App/POS checks use the catalogue’s Zoho item links, reconcile receipts and line totals, and keep opening Zoho-credit receipts visible. Non-Britos native sales do not falsely block the Britos migration check; relevant or unknown lines still require duplicate reconciliation.

Each immutable report page carries separate `lines`, `invoices` and `receipts` arrays (100 rows each). Continue until `has_more` is false. Do not sum whole invoice totals or whole payment amounts across line/allocation rows; use unique invoice/payment IDs and allocated cents. Source hashes and allocation counts remain attached to the snapshot.
