# Private PA security — 0.54.1

Private means Alex only. Administrator status does not grant access. PA acts
only through Alex's authenticated, appropriately scoped connection. Private
tasks and PA identities cannot be converted back to shared work, including by
historical restoration or register republication.

## Repairs and reproducible evidence

- A historical task restore bypassed the input-only visibility check. The final
  resulting task now must retain private visibility before any event is saved.
- Register publication could change an unlinked private identity to shared.
  Both full and incremental publication now preserve existing private scope.
- Alinda's administrator shortcut trusted a stale shared PA row even when its
  native task was private. Linked native privacy now precedes administrator access.
- Private and nonexistent document IDs produced different errors. Task files
  and report evidence now return indistinguishable 404 responses. Missing-task
  mutations and owner-scoped save receipts also retain the visibility boundary.
- Alex's PA drafts were saved in sessionStorage. They now live only in memory;
  legacy Alex draft entries are moved out of browser storage. Authentication
  loss clears private drafts, cached reports and open task dialogs. Identity
  changes close the old dialog. Cached workspace data is authenticated before reuse.
- A push subscription could outlive a login on a shared device. Push payloads
  include the recipient; the service worker checks the current server session
  before displaying a notification. Offline, expired and different-user sessions
  suppress it. The task inbox remains authoritative. Existing devices must receive
  the updated service worker; already displayed notifications cannot be recalled.
- A private task-linked report item placed in the shared Rabbi section could
  disclose its title/text. Shared Rabbi now contains standalone non-action readings
  only; task-linked entries remain available in Alex's full report. Existing reading
  dates and ordinary standalone readings remain available to the intended readers.

## Automated verification

`test/private-pa-security.test.js` uses the real Worker in isolated workerd/D1,
synthetic access keys and registered synthetic rep-phone sessions. Musa enrolls
as the existing canonical identity `mosa`; no second production user is created.
It checks Alex, Alinda, Xavier, Xalinda, Tapiz, Musa/Mosa, an additional account
and unauthenticated requests. Coverage includes task lists, search, deep-link
resolution, counts, inbox, report/history, conversations, both attachment APIs,
audit, mutation/delegation denial, identical missing/private responses, PA sync,
email request denial, no-store responses, private drafts and push display checks.
Existing integration tests verify authorised Alex/PA work and ordinary task flows.

Three original server regressions and the attachment error/Rabbi disclosure
were reproduced as failing assertions before their repairs. The dedicated
`.github/workflows/private-pa-security.yml` runs security suites on future changes.
Local fixtures are disposed after each test. No real credentials, private task
contents or production test records are needed for these tests.

## Live verification boundary

Alex's existing `daily_report: {resource: 'summary', id: 'task-access'}` diagnostic
now evaluates every configured account plus the canonical reps, reporting only
counts and SQL/policy agreement. It remains Alex-only and explicitly labels itself
`server_policy_evaluation_not_user_login`. This checks deployed code against live
records; it does not authenticate as another user and is not a substitute for
their authorised browser/phone/OAuth session tests.

External Drive/Gmail permissions, previously exported files, historical copies
in shared workbooks, physical device caches and OS notifications need separate
verification. This release does not change external permissions or erase history.
No database migration, access-key rotation, account grant or business record
rewrite is part of the repair. Do not roll back to 0.54.0 without accounting for
the reopened privacy defects; preserve the append-only data on any code rollback.
