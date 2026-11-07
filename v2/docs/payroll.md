# Native weekly payroll — 0.21.0

Staff → Payroll replaces the earlier placeholder with Friday wages, approved
payslips, payment recording and calendar-month wage/UIF reporting. The owner
confirmed on 23 October 2026 that Friday covers Monday through Friday and that
auditors provide the PAYE amount. Fen calculates UIF; Alex pays the auditors;
the auditors submit. No payment or filing API is called.

## First use

1. Pay setup: confirm legal employer name/address and the first Fen Friday.
2. Confirm each employee's rate, effective date, occupation, pay basis,
   break policy, bank/cash method and UIF default. Imported rates are dated
   suggestions only. Fixed weekly pay and hourly pay are separate.
3. For the first month, record each person's reconciled opening gross/net,
   UIF remuneration, both UIF shares, PAYE, bonuses and commission before
   the first Fen payday. Enter explicit zeros for a new worker. Source Google
   history is retained separately and is never replayed as new wages.
4. Load the Friday and refresh the draft. Review every person, including
   inactive people with work in this period. Exclusions require a reason.
5. Review recorded hours, breaks, paid leave, ordinary/OT allocation, special
   earnings, bonus, commission and authorised deductions. Enter auditor PAYE,
   including an explicit zero where applicable, and confirm the review.
6. Approve the week to freeze the payslips and include it in month totals.
   Print one or all payslips. Record payment only after everyone in that run
   has actually been paid externally.

The first release does not invent missing clock records or employment dates.
It accepts evidenced manual payroll hours without creating attendance events.
Open shifts block approval. Other clock warnings require an explicit recorded
review; a missing schedule is never silently treated as an absence or paid day.

## Calculation boundary

- Integer seconds and integer cents. Each earnings line is rounded once to a
  cent; totals add those lines. No rounding of worked time to tenths of hours.
- The legacy source's 45-hour week / 1.5× overtime is a **draft allocation**.
  Daily hours above nine, rate changes during a week and prior weekend shifts
  are flagged. Review the contractual/legal allocation rather than treating
  this initial split as automatic approval.
- Recorded breaks are deducted once. An explicitly selected driver policy
  subtracts 60 minutes only for a day with at least four completed hours and
  no recorded break. No employees or driver names are hardcoded.
- Approved half-day paid leave retains its actual paid minutes. Unpaid leave
  is zero. Fixed weekly pay does not pay approved leave a second time.
- Sunday/public-holiday hours and their reviewed special payment are explicit.
  No automatic holiday calendar, guessed Sunday entitlement or forecast
  clock-out is used. These hours must not also be paid as ordinary/OT hours.
- Bonuses and commission are separate. UIF remuneration excludes commission,
  includes bonuses, uses 1% for each party and the R17,712 monthly ceiling.
  Cumulative cents/ceiling reconcile across four/five Friday months, including
  verified opening deductions. Historic under-deductions are flagged for
  reconciliation rather than silently recovered from the employee.
- Casual UIF exemption is an explicit, reasoned monthly-hours review, never
  an inference from their Casual flag. Monthly reports flag exemptions again.
- PAYE is supplied and confirmed by the auditors; no automatic PAYE/SDL/ETI,
  EMP201, IRP5, bank upload or statutory submission is implied.

Primary sources verified 23 October 2026:

- SARS UIF overview: https://www.sars.gov.za/types-of-tax/unemployment-insurance-fund/
- SARS UIF guide (sections 6–8, remuneration exclusions and monthly payment):
  https://www.sars.gov.za/wp-content/uploads/Ops/Guides/UIF-GEN-01-G01-Guide-for-Employers-in-respect-of-the-Unemployment-Insurance-Fund-External-Guide.pdf
- Labour payslip contents:
  https://www.labour.gov.za/DocumentCenter/Pages/Basic-Guide-to-Pay-Slips.aspx

## Persistence, access and history

`v2_staff_payroll` is an additive, append-only D1 journal, with an entity key
for settings, each employee's opening and each Friday run. Initialization is
in PAYROLL_SCHEMA, included by STAFF_SCHEMA; it does not modify old tables or
the verified source archive. Every write records actor/time/action, consumes
an idempotency key and a global payroll revision. Staff revision and clock
row version are checked again inside the same D1 transaction. This prevents
simultaneous approvals from consuming the same monthly UIF headroom.

Drafts retain their source versions. Clock, Staff, settings or other payroll
changes invalidate a saved draft; refresh keeps manual inputs but clears all
reviews. Approved/Paid rows, employer details, rates, rules and amounts are
snapshots. Later rates, renamed employees or clock corrections never rewrite
a payslip. Only an unpaid Approved run can be voided, only from the latest
approved date backwards. Its old version stays in the journal. Paid runs
cannot be edited or voided in this release; corrections need a separately
reviewed workflow rather than a destructive rewrite.

Approvals proceed Friday by Friday from the configured cutover; a later
approved run blocks an earlier insertion. No future approvals. First-month
openings lock once used. Approval requires all rows reviewed and explicit
PAYE, a valid rate/profile and confirmed employment identity/start.

Only Alex/Alinda authenticated admin sessions can access payroll APIs.
The restricted kiosk cannot access wages, and the connected read plugin has
no new payroll write permission. CSRF, no-store and existing auth apply.
Public source and tests contain synthetic workers only, never actual HR data.

## Month reports and printing

Month is determined by Friday pay date. Approved and Paid wages count;
Draft/Voided runs do not. Paid net is also shown separately. Verified opening
amounts count once. Missing Fridays/openings and UIF reconciliations are
visible in the report. CSV amounts are currency units (not internal cents),
quoted and formula-safe. Earlier Google Sheet changes are not synchronized.

Payslips show employer/name/address, employee/code/occupation, period/payday,
ordinary/OT/Sunday/holiday hours, rates, earnings, itemised deductions, net,
and employer UIF separately. Native print selection persists through early
afterprint/re-pagination, using the existing print-document helper. PDF/print
is browser-native; no remote document service receives payroll data.

## Verification and operational limits

Domain tests cover cents, ordinary/OT/bonus/commission, UIF ceiling across
five Fridays, month reset, openings, fixed wages, leave and breaks. Real D1
tests cover permissions, duplicate/replayed/conflicting requests, concurrent
review saves, missing/stale source rejection, approval snapshots, payment and
clock-change invalidation. Local Chromium acceptance runs through actual
forms at desktop/390px widths, prints a one-page A4 payslip and month report,
downloads CSV and checks reload. This is not a physical Safari printer test.

The feature is available before business setup, but no actual wages are
approved during deployment. Reconcile initial pay results against paid source
periods during business setup. Roll back code only; keep the additive payroll
journal. Repeated deployment or reload must never create a payment event.
