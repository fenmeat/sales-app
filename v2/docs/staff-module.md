# Native Staff core — 0.21.0

## Weekly payroll

Version 0.21.0 adds Friday wages, reviewed and locked payslips, payment recording
and monthly UIF reports. See [Payroll setup, calculation and persistence](payroll.md).
Imported source rates still require confirmation; native hours alone are not
approved wages. Payroll does not submit UIF or execute bank payments.

## Casual PINs

Version 0.20.4 adds Staff → Casuals. Add casual captures the individual's name,
work/team and verified employment start, then creates a permanent UUID/code.
The server assigns the lowest available slot from 1–9999 and pads it to four
digits (0001 onwards). A slot is a reusable clock credential, never a worker
identity. A missing DOB does not block a configured casual PIN. Regular staff
retain MMDD PINs; existing imported individuals only change PIN type when an
administrator explicitly chooses Assign casual PIN or edits Staff type.
Original source profiles and the original imported register are unchanged.

Active casual slots are unique in each private register revision. Admin-only
responses display the current PIN; the kiosk still receives only id/name/state,
and the read connector's explicit field list excludes slots and PINs. PIN
verification retains the configured server secret, UUID salt, PBKDF2 and rate
limits. Assignment requests use the register revision and idempotency key:
concurrent creates cannot allocate the same active slot. Caller-supplied slots
are ignored. Existing birthday data is retained when switching to Casual.

Make inactive clears the active slot and removes the person from the kiosk.
The API first requires all shifts to be closed, then checks again inside the
transaction. Together with the punch register guard, this prevents a racing
clock-in from leaving an inactive worker with an open shift. The same checks
apply to edits and PIN-type changes. Old inactive employee IDs cannot verify,
punch or replay a successful punch. Activate again preserves the UUID, original
employment start, original profile, clock history and leave ledger, assigning
the lowest currently free slot. Shared imported casual labels are rejected;
each individual needs a separate record. No automatic end-date processing or
termination is implied by the active/inactive switch.

Tests cover allocation, leading zeros, inactive denial, release/reuse,
reactivation, concurrent registrations, clock-in/deactivation races, restart,
separate historical time ownership and kiosk/admin access separation. Local
phone-width Chromium exercises the actual forms and registered-device flow.
There is no new database migration. Do not delete historical people to recycle
PINs. The existing bounded register limits still apply. A rollback retains data
but older code cannot authenticate casual PINs; prefer a forward fix and review
the register before re-enabling casual administration on a restored version.

Version 0.20.2 introduced the employee's saved date of birth for a four-digit clock
PIN (MMDD), as Alex requested on 20 October: 15 June is 0615. Alex/Alinda enter
or correct Date of birth in Add/Edit employee or People → Birthday / PIN.
Saving a date immediately determines the PIN, including leading zeros and
29 February. A changed date changes the PIN; a missing date blocks clocking.
Do not infer birth dates from identity numbers or ambiguous imported cells.

Version 0.20.1 added a separately consented, admin-only, read-only connector.
See [Staff connector access](../PA_STAFF_READ_ACCESS.md). Existing general
connector scopes still confer no Staff access.

## Private source transfer

On 19 October Alex authorised transferring the existing personnel records and
clarified UIF responsibility: Fen calculates, Alex pays the auditors, and the
auditors submit. Staff exposes an initial import through the existing admin
session only. An empty register is required; deployment itself imports no data.
Only the separately approved `fenmeat:staff:read` connector scope can read
these source archives. General connector scopes, API bearer permissions, clock
credentials and public assets confer no Staff access. No connector can write HR.

Two additive tables retain immutable import manifests/chunks and completion
evidence. Each chunk and the complete source are SHA-256 verified. The final
employee-register revision and completed-import status commit atomically.
Choosing the identical source file safely resumes an interrupted upload or a
lost completion response. A second initial import cannot replace existing data.
Original source rows are available in Staff → Imported records; their formulas
are shown as text and never executed. Employee details include source rate,
banking, UIF, start dates, current weekly pay and source leave balances.

Identity matching uses exact names after whitespace/case normalization only.
Distinct historical names remain separate and inactive; a shared casual label
also remains inactive. Historical absence totals, negative adjustments, current
source balances and clock logs are preserved without creating native leave
deductions, approved balances or live punches. The Hours screen explicitly
directs users to Imported records for source clock history. Native schedules,
pay rules and approved opening balances still need reconciliation. Imported
employment dates preserve the actual source value and display its original text;
an explicit, audited confirmation is required before clock activation. Missing
or ambiguous dates remain unknown. Source rates have a capture date and no
invented historical effective date. Original private source details are retained
even after a manager confirms an operational date.

Limits: 20 source imports, 120 chunks of at most 120,000 characters, 40 sheets,
40,000 populated source rows and 200 derived employee identities. Source history
is paged 50 rows at a time. In this first migration implementation a history read
loads and verifies the bounded archive; normalize/index the historical sources
before expanding these limits. No deletion or archive replacement is exposed.
The source capture timestamp is shown prominently; the old clock continues
independently and later records are not automatically synchronized.

Runtime tests verify access denial, CSRF, incomplete uploads, corrupt chunks,
duplicate retries, simultaneous completion, complete source equality, preserved
zero-prefixed account fields, negative leave, immutable source formulas, and
Worker-restart persistence. `scripts/qa-staff-import.mjs` uses synthetic data to
verify the real file-upload UI and safe retry after a lost commit response.

## Original core implementation

This replaces the memory-only Staff design preview with an integrated Worker/D1
module. It adds `/staff` administration and a separately authenticated
`/staff-clock` yard-phone screen. The intended end state is native Fen Meat HR
and payroll, replacing SimplePay. There is no SimplePay dependency or export
workflow in this implementation.

Status: implemented and tested locally; public-repository publication and the
existing test-Worker deployment explicitly approved by Alex on 19 October 2026.
Verify the live version separately after deployment. Real staff import, clock
cutover, wage payments and statutory submissions are not part of this release.
Existing Sales and Production data is not migrated or rewritten.

## Included

- Permanent employee UUID and immutable code/start date; name, team and active
  status; effective-dated weekly paid-minute schedules with source notes.
- Alex/Alinda-only Staff read/write APIs. Existing stocktake accounts, PA
  connector scopes, bearer integrations and yard-device credentials do not
  acquire HR permissions.
- Admin-created, single-use 10-minute device codes; independently scoped,
  HttpOnly/Secure/SameSite=Strict clock cookies; 90-day device expiry and immediate
  server-side revocation. Enrolment invalidates any app session on that phone.
- Exactly four-digit MMDD birthday PINs. Valid birthdays such as 11 November
  (1111) are accepted. The selected employee UUID disambiguates shared birthdays.
  The private date is the source of truth: compare verifiers using HMAC with the
  separate server secret, PBKDF2-SHA256/100,000 iterations and the employee UUID
  as a unique salt. No separately editable PIN/verifier can drift from that date.
  The birth date is kept in admin-only employee/audit state; neither birth dates
  nor derived PINs are sent to the kiosk or placed in browser storage. A DOB is
  predictable to someone who knows it, so this identifies a person on an already
  authorised clock device; it never grants management access. The existing
  five-failure employee limit, shared-device limit and device revocation remain.
  Birth dates can be saved before the server secret is configured; clocking
  fails closed until it is configured, then becomes ready without another reset.
- Server-timestamped clock-in/out and recorded breaks. Per-employee revisions
  and atomic D1 writes prevent conflicting clocks and repeated saves. The phone
  shows only active names, current status and the verified employee's last action.
- Online clocking with durable recovery metadata for an uncertain response.
  Recovery retains the same action ID across reloads, asks for the PIN again and
  never duplicates an accepted event. This is not offline time capture. A storage
  failure prevents a new punch; a network failure never displays a successful save.
- Review of up to 31 days including Saturdays and Sundays. Exact recorded
  intervals are retained; display formatting does not change underlying seconds.
  No automatic lunch, overtime, rounding or public-holiday multiplier is assumed.
- Open, overnight and unusually long shifts are flagged. Only confirmed intervals
  are shown as time under review; missing punches do not create guessed hours or
  automatic leave deductions. Alex/Alinda may correct and explicitly verify a
  complete shift with a reason; all previous versions remain in the audit trail.
- One-day/half-day leave requests, approval/decline/cancellation, verified opening
  balances, documented adjustments/accrual entries and reversals. Approval uses
  the schedule in effect on the leave date and snapshots its paid minutes.
  Half of a 9-hour day is 270 minutes. Unpaid leave adds zero paid minutes.
- Approval checks available balances on the leave date and every future ledger
  date, so backdated changes cannot silently consume reserved future leave.
- Shared readable mobile UI, decimal comma/point inputs, select-all behaviour,
  form protection, explicit save confirmation and retry handling.

Attendance, paid leave and wages remain separate. Work and leave on the same
date is surfaced for review; the app does not infer the time of a half-day leave
from a date-only request. A historical schedule change does not rewrite the
paid-minute snapshot of previously approved leave.

## Data and concurrency

Migration `0007_staff_core.sql` only creates new tables and indexes. The same
schema is also initialized repeat-safely by the Worker. Existing databases and
sessions remain valid; no destructive migration is required.

| Table | Purpose |
| --- | --- |
| `v2_staff_register` | Append-only admin revisions and audited employee/leave state |
| `v2_staff_requests` | Request fingerprint and exact accepted response for safe retries |
| `v2_staff_pins` | Legacy verifiers retained for rollback; unused from 0.20.2 |
| `v2_staff_devices` | Hashed enrolment/session credentials, expiry and revocation |
| `v2_staff_time` | Append-only versions of individual shift records |

Each shift version has an employee revision, independent of the register
revision. A conflicting clock, correction or admin save returns 409 rather
than overwriting a saved record. Clock writes recheck the register revision and
device validity inside the same transaction. Their guard deliberately creates
a duplicate request key on stale authorization, causing the complete batch to
roll back. Corrections also check overlapping shifts. All replay responses are
behind the current authentication and PIN checks.

The initial register is bounded at 200 employees and 600 KB of current state.
History is never automatically deleted. Before substantial history accumulates,
move ledger projections to normalized indexed tables with a verified migration
and archival policy; hitting the current guard returns a visible error. Device
registration is bounded at 20 non-revoked devices. Revoke expired unused devices.
Audit UI returns the most recent 100 admin and clock versions; older versions
remain in D1.

## Source findings and migration

The source Apps Script deployment and current head were read and privately
archived on 19 October 2026. No source employee names, bank details, identifiers,
rates, spreadsheet extracts or copied original payroll scripts are bundled in
this repository. Synthetic fixtures are used in every test.

The source review identified full-day treatment of fractional leave, paid hours
for unpaid/no-work leave labels, ignored Saturday shifts, replacement of a first
clock-in by a later duplicate, and an unmatched overnight clock that could count
34 hours. The native tests cover those failure modes. Historical aggregate leave
imports are not individual dated absences and must not be replayed as new usage.
Some source balance formulas refer to bounded ranges shorter than the current
log, so their displayed result is not automatically a verified opening balance.

The current source employee tab contains 17 named rate rows; the casual tab has
additional records. Confirm aliases, employment dates, active/casual status and
the source-to-UUID mapping before importing. Do not silently merge similar names.
Verified schedules, opening balances and future reservations need a dated
reconciliation. None of these records has been imported by the code change.

## Enable after deployment approval

1. Keep the existing D1 database binding and existing app access secrets. Deploy
   the reviewed code through the established app repository/Cloudflare process.
   This work does not establish a second hosting project or use a new subscription.
2. Set a new independent `STAFF_PIN_PEPPER` secret in the Worker using a password
   manager-generated random value of at least 32 characters. Never put it in
   `wrangler.jsonc`, a command argument, a source file or a screenshot. The clock
   setup and clock verification fail closed without it; other Staff preparation works.
3. Reconcile/import employee identities and schedules; save each verified date
   of birth to enable the automatic MMDD PIN. The imported records have no native
   birth dates, so they remain pending until an admin enters the actual dates.
   Load verified balances with dates and source notes. No guessed dates or
   statutory leave balances are created.
4. Register the yard phone under Staff → Devices. Test a designated synthetic
   record before clocking any real employee. Confirm the actual phone's storage,
   connectivity, lock-screen and app-switch behaviour.
5. Reconcile attendance and leave with the existing records before an explicit
   clock cutover date. Maintain the existing source snapshot and rollback route.

A corrected birth date immediately replaces the accepted birthday PIN; previous
random six-digit PINs are no longer accepted. Changing the server secret does
not change a birthday PIN, but affects request fingerprints, so reconcile any
pending clock retries before secret rotation. Clock history remains intact.
Revoking a device prevents new actions and retries through that credential;
managers can still review its previously accepted actions. A rollback before
0.20.2 restores the older PIN policy and would require managed PIN setup again;
do not treat deployment rollback as a seamless credential migration.

## Payroll development boundary

The first payroll workflow is implemented in 0.21.0; see [Payroll](payroll.md)
for its explicit review steps and limits. Automatic PAYE/SDL/ETI, statutory
filing, paid-run adjustments and banking integrations remain separate work.
The auditors supply PAYE and submit UIF. Source histories remain dated evidence,
not approved payroll inputs.

## Verification

- `npm test`: full Sales/Production/access/Staff regression suite. Staff domain
  cases cover half-day/unpaid leave, balances, reservations, weekends, explicit
  breaks, invalid sequences, missing clocks, midnight splitting and corrections.
- Real Miniflare/D1 runtime tests cover roles, CSRF, PIN verification/throttling,
  one-time enrolment, admin-session removal, kiosk isolation, conflicting saves,
  duplicate retries, append-only corrections, ledger approval and persistence
  after a complete Worker restart using `resourcePersistencePath`.
- `scripts/qa-staff.mjs`: local-only Chromium acceptance run using synthetic data,
  desktop and 390px mobile viewports and non-South-African browser timezones. It
  exercises the actual UI, comma decimals, select-all, leave approval, device/PIN
  setup, a deliberately lost server response, reload/retry without duplication,
  clock-out and correction. Screenshots are internal QA evidence.
- `npm run check:deploy`: Worker/asset deployment dry run only.

Browser QA requires Playwright and a local Chromium executable; set
`STAFF_PLAYWRIGHT_MODULE` and `STAFF_BROWSER_EXECUTABLE` when they are not locally
discoverable. Optional `STAFF_QA_SCREENSHOTS` chooses an internal evidence folder.
Actual iPhone/Safari and physical yard-phone testing remain deployment checks.

## Historical source refresh and employee history (0.22.0)

People → History and the Employee history tab show one exact source identity's
archived clock events, weekly gross/UIF records, dated pay snapshots, leave log,
source leave balances and original rows. Inactive identities remain selectable.
The source snapshot selector retains earlier captures independently; rows from
overlapping captures are never added together. Shared/checklist rows and rows
without a name remain available in Imported records. Missing names are counted
explicitly in each new import's coverage report.

`POST /api/staff/imports/finish` with `mode: history` requires a complete initial
import from the same spreadsheet and the current Staff revision. It saves a new
immutable archive, appends a register audit revision and changes only the source
history references and any genuinely new identities. Existing people (including
name corrections, birthdays, PIN slots, schedules and employment dates), native
clock records, leave/ledger and payroll records are preserved. New source
identities are inactive. Exact source-name IDs are stable; ambiguous matches to
another existing record fail for review. An older capture cannot displace the
latest capture. Default/initial mode still requires an empty register.

The existing chunk hashes, whole-file checksum, resumability, transaction and
revision conflict protection apply to refreshes. Replaying the same file cannot
create a second register revision or a second payment. The previous archive is
not deleted on a refresh. To inspect an earlier state choose its snapshot; a
code rollback must not delete migration data. Source files and real staff data
must never enter the public repository.

History is evidence, not approved payroll. Source UIF rows are grouped by exact
employee and pay date; equal cent amounts count once, while differing versions
are all displayed and excluded from subtotals. Missing money stays missing and
explicit zero stays zero. Current hourly rates have no invented effective dates.
Current Week/Payslips/Payments flags are not proof that a payment happened.
Recorded work-time subtotals use complete same-day clock sequences after recorded
breaks only; automatic lunch/leave/holiday adjustments are not reconstructed.
Duplicate, incomplete or overnight clock days require review. Full leave-log
totals are compared with the source balance sheet and truncated formula ranges
are identified. Neither historical usage nor source balances post to the native
leave ledger automatically.

The admin-only history API is `/api/staff/imports/history?employee_id=UUID`, with
an optional completed archive `id`. Staff read consent remains separate from
business access. Connector summary verifies the original register import and
the latest history checksum independently; default source-row reads use the
latest history capture. It remains read-only.

Tests cover exact-name association after a display-name correction, source
date/time handling, missing versus zero amounts, conflicting/duplicate UIF rows,
leave reconciliation, foreign-source rejection, concurrent replay, preservation
of confirmed edits/payroll/PINs/leave, inactive new identities, old snapshot reads,
permissions and complete Worker restart persistence. No new payroll approvals,
payments or historical clock actions are generated by this migration.
