# Staff connector read access — 0.20.1

Alex authorised separate Staff read access on 19 October 2026. The existing
connector and Worker keep their identities. There is no new service, shared
password, public HR file or browser credential extraction.

## Owner connection

Reconnect the existing FenMeat Leestoegang connection in ChatGPT. On FenMeat's
own consent page, sign in as Alex or Alinda using that person's own account and
select **Laat Staff-leestoegang toe**, then **Bevestig gekose toegang**. Keep
**Laat ook skryftoegang toe** selected if existing Sales/Production editing is
still wanted. Staff access itself remains read-only. Manage or revoke grants
at `/pa-access`; each grant shows its actual Staff permission.

Staff consent covers profiles, identity and bank details, source rates, clock
records, leave and imported payroll history. Only the independent OAuth scope
`fenmeat:staff:read` grants this access. An old read/write grant cannot acquire
it by token refresh, publishing this release, supplying a tool parameter or
using another data target. Existing admin-only identity, key rotation, exact
callback, audience, PKCE, browser-bound consent and revocation checks apply.

## Read contract

`get_staff_data({query:{resource:...}})` supports:

- `summary`: import metadata, current counts, source capture timestamp and
  original source checksum. Reassembles and hashes the saved source, rederives
  its summary and employee records, and checks the original import revision.
  Current operational revisions may legitimately differ from original source.
- `people`: pages of 50 operational profiles. Bulk results omit private source
  bank/ID/rate details. A specific `employee_id` includes its original profile.
- `source_rows`: requires a `sheet_id` from summary; optional `q`, `offset` and
  `import_id`. Returns up to 50 original cells/row numbers without executing
  formulas or interpreting historical aggregates as native leave usage.
- `hours`: `from`/`to`, at most 31 calendar days, using native clock/leave logic.
- `leave`: one `employee_id`, paged native requests and approved ledger.

`get_access_status` reports `staff_read_access` without returning HR data.
Its documented optional `staff:{resource:"summary"}` query offers the same
protected verification while a client refreshes its cached tool list. Both
entrypoints require the separate scope before any Staff database read. A
missing-scope OAuth challenge prompts reconnection; this is never evidence of
data migration completion.

The adapter passes every database access through a SELECT-only wrapper. It
does not initialize business schemas or read PIN/device credential tables.
There are no Staff write, generic SQL/URL, payment or submission tools.
All results retain dates, revisions, unknown balances and payroll limitations.
The UIF workflow remains Fen calculation, payment to auditors by Alex, auditor
submission. Native weekly payroll is available in Staff administration; its write operations are not exposed by this connector. Confirm its setup and reconcile source openings before approval.

## Verification

Runtime tests use synthetic source archives and real local OAuth/D1/Worker
requests. They cover old-token denial, explicit separate consent, Alex/Alinda
identity, ordinary-account rejection, bounded reads, exact source verification,
corrupt-source failure, secret exclusion, data immutability, refresh without
scope escalation, revocation and preserved existing business access.

After deployment, check the live version and unchanged old-grant rights first.
Only report Staff access or migration verification after a successful call with
the owner's newly approved Staff scope. Never treat a build, generic access
status or the user's upload acknowledgement as source readback.
