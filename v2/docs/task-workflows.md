# Tasks 0.38.0

## Data and migration

The existing D1 `v2_task_events` remains the authoritative app event log. Steps are additive JSON fields on the same task, not separate tasks or a second register. IDs, PA links, PO links, instruction attachments, original completion and prior payloads remain intact. There is no deployment-time mass rewrite. Existing closed tasks remain closed. Existing unlinked general reminders are app-only; existing PA links retain their identity and integration.

`task_type=reminder` is the new default for general work without PA links. `repeat` is none/daily/weekly/monthly; completing an occurrence saves its actor/time/note, advances to the next future occurrence and preserves the original calendar anchor. Missed dates are skipped, not falsely completed. Explicit `start_workflow` retains the ID and records the reason. Historical completed steps require an admin and recorded evidence/confirmation; nothing infers receipt or payment.

Workflow steps have stable IDs, description, assignee, date, status, required flag, dependencies, notes, document URL and completion evidence. Graph validation rejects cycles and missing dependencies. Completion cannot bypass incomplete predecessors or required evidence. Only required steps determine final completion. Reopening preserves earlier events. The existing stocktake verification stays intact.

## Runtime

The same date projection runs in the Worker and browser using Africa/Johannesburg dates. Future ready work is Scheduled; blocked child steps cannot make a task Pending. A waiting step names the dependency and follow-up date. At that date it becomes Pending automatically. Open pages recalculate at date rollover and focus; the existing five-minute Cloudflare scheduler queues durable notifications. No ChatGPT call changes a daily status. Push requires the device's existing permission; in-app notifications remain available.

Named admins manage all work. Existing assignees can act on their steps. A delegated step grants access to its containing FenMeat task and its documents; unrelated staff and private PA records remain isolated. Manual status corrections require a reason, and deferred corrections require an expiry/follow-up date. They never mark incomplete required work Complete.

## PA bridge

`pending_sync` excludes app-only reminders and workflows without PA involvement. Only meaningful task changes newer than the acknowledged revision enter the queue; personal reminder/follow-up preferences do not requeue acknowledged work. Stable task/request/step IDs and existing optimistic revisions prevent duplicates. Acknowledgements do not create another task event.

`save_app_data(target=daily_report, data.operation=register_patch)` accepts complete changed PA rows only. It merges by permanent ID and retains every omitted row, including closed/private rows. It requires the current register revision, source timestamp, canonical row URLs and existing Alex PA write permission. Full register publication remains available for the daily reconciliation. The hourly automation reads bounded queues first and returns when no relevant work exists.

## Rollout and recovery

1. Run `npm test` and `npm run check:deploy` on the exact tree.
2. Publish only to existing `build/sales-v2-cloudflare`; Cloudflare's existing build pipeline owns deployment. Verify commit check and live health/connector version 0.38.0.
3. Read the target task immediately before migration. Use `start_workflow` with the latest revision and a stable request ID. Read back status, steps, old completion, IDs and documents. No synthetic business records go to live D1.
4. Reconcile only the existing PA row and publish a guarded register patch, then acknowledge the verified app revision.
5. A bad conversion can be undone through admin `restore_task_revision` with current revision, earlier `restore_revision`, request ID and reason. This appends a new event and preserves both the conversion and all subsequent history/files. Never bulk replace the database or silently restore over a concurrent edit.
6. For a runtime incident, set `TASK_WORKFLOWS_READ_ONLY=true` to pause step edits (audited admin restore remains available), then deploy a forward fix. Do not roll back to a pre-step writer while users can edit workflows: old code cannot enforce the new dependencies. The original pre-release code commit is c5c999f22eec0323cbeb65739ae1a7b7e69d9c16; database rollback is a separate, explicit operation.

## Validation

Real workerd/D1 tests cover reminder completion/repetition, multi-step work, future follow-up and midnight projection, dependency blocking, waiting, evidence, full closure, assignee privacy, guarded writes/replays, deduplication, PA exclusions, incremental register publication, preserved dispatch history and restoration. UI DOM tests cover actual form actions and submitted values. The browser acceptance script is `scripts/qa-task-workflow.mjs`; Chromium launch was blocked in this environment by its socket restriction, so no physical Safari/iPhone/iPad or rendered-width success is claimed.

## PA conversations 0.39.0

The existing private `v2_pa_report_feedback` remains the question/event source.
Additive `v2_pa_report_answers` stores one immutable, structured answer per
feedback ID; `v2_pa_report_attempts` retains retryable processing failures. No
existing question, investigation outcome, attachment, task event or source row
is rewritten at deployment. Legacy acknowledged `respond` events without an
answer return to the bounded PA queue; agents must respect the existing
PA-REPORT markers and never repeat completed external actions.

`daily_report` writes support `answer` and `feedback_error`. An answer requires
the original feedback hash, freshly read current subject hash, current register
revision, verified source and `{kind,text,recommendation,next_action,responsible,
follow_up_date,task_status}`. For a permanent task the action, person, status and
review date must match the current read model. Source changes must be reconciled
first using existing workflow actions and `register_patch`. D1 atomically guards
the register revision, inserts the unique answer, acknowledges the feedback and
adds the existing private notification. A reply never changes a business task.
`acknowledge` cannot resolve a respond event or question-mark-bearing note.

`summary` with `id:<subject_key>` returns the authorised conversation in pages
of 50; `id:report-context` gives current action/answered/scheduled/waiting/closed
report categories against the last report cutoff. The browser exposes this at
`GET /api/pa-report/conversation`. Private report replies linked to a task are
visible in that conversation only to Alex. All current subject permissions apply.

Cards and dialogs display the actual PA answer, owner, date and next action in
Afrikaans, with chronological history, preserved earlier investigation notes,
paging, follow-up links and explicit refresh. Workflows retain their step-list
button and gain the PA conversation button. On return or reconnection, the page
refreshes PA data at most once per minute (no timer-based full sync). A draft and
uncertain request survive reload in the same tab using per-user sessionStorage;
retry preserves the exact original request ID and body. Private reports and
attachment bytes are never offline cached. A cold offline app start and recovery
after closing the tab are not provided. Server-saved questions and answers remain
durable independently of the device. Existing numeric-only selection is intact.

Processing remains the existing hourly ChatGPT automation; no immediate model
service or one-hour response guarantee is implied. The daily report must use
current follow-up categories and recent answers instead of presenting old tasks
as new work. Original sent reports are retained; current answers appear beside
linked historical report items without rewriting that historical text.

Validation: Node/DOM/workerd/D1 tests cover answer atomicity, unique retries,
stale register/source rejection, failed processing recovery, legacy review repair,
full history paging, same-task follow-ups, private access and report selection.
`scripts/qa-pa-conversations.mjs` exercises the shipped UI with synthetic HTTP
fixtures, offline drafting, reload and a lost successful POST response in mobile
Chromium/WebKit profiles. No synthetic live business data or emails are required.
Rollback should be a forward fix: old writers allow acknowledgement without an
answer. Retain all additive tables and original data; never bulk restore D1.

## Original task editing 0.40.0

Admins Alex and Alinda can open **Wysig oorspronklike taak** from the current
PA workspace lists, linked Daily Report items, a task conversation and the
original task dialog, including completed work. The link resolves existing
app/PA identities only. Unlinked private PA rows never become shared app tasks.
A targeted authenticated GET reads the latest revision before opening the form.
Save uses the existing guarded task event API and reads the saved task back.

Admin metadata corrections to closed tasks retain their status, completion,
attachments, PA identity and immutable prior events. Completed workflow steps
allow metadata corrections with a reason; changing their status/dependencies
uses the existing explicit reopen flow. Task-level evidence applies to ordinary
tasks; workflows edit evidence on the selected step, without changing others.
A reason is required to reduce an evidence/required-step/dependency control or
correct completed work. PO sending confirmation, stocktake count receipts and
workflow completion/dependency checks remain enforced on the server.

Each edit records actor, server time, prior revision, reason and field-level
before/after values in the existing event payload. History also computes field
diffs for older events. The optional `evidence_url` is a prospective completion
link; historical completion evidence is preserved. Existing API clients remain
supported; no new tables or deployment-time business-data edits are needed.

Meaningful linked edits enter the existing incremental pending_sync queue.
While waiting for PA, an edited single general app task supplies its current
view to the task list; PO dispatch remains a distinct step of its parent cycle.
The PA bridge must update the same source row, preserving notes and confirmed
answers, publish only the verified row through register_patch, then acknowledge
the exact revision. No full Zoho/register sync or new automation is introduced.

Regression coverage: task-editing.test.js (Worker/D1 permissions, evidence,
readback, replays, revisions and retained completions), existing workflow/sync
and UI suites, and qa-task-editing.mjs (real Worker/D1 saves through shipped
browser forms on desktop, phone, iPhone and iPad profiles). Device profiles do
not certify physical Apple hardware. Rollback is a forward fix retaining all
new events, evidence links and prior data; do not bulk restore the database.


## Scanning throughout a task — 0.46.3

PA conversation replies, completion confirmations, assignment requests, update
requests and reminder forms now use the same Take Photo / Scan Document / Photo
Library / Choose Files controls as task creation. Task edits, notes, direct PA
requests and answers to PA also use that picker. Existing completion and workflow
step evidence continue to use it.

Every task detail screen offers “Scan Document / voeg lêers by”, including
Scheduled, Waiting, Complete and Cancelled tasks. The `attach` action adds reference
documents without reopening the task or replacing its recorded completion. Edits
and notes may supply `files` atomically with their existing action. Append-only
revisions, request replay and the existing visibility checks apply; conflicting or
invalid files roll back with the task event. Up to 12 new files can be selected at
a time, with a bounded total of 120 reference documents. Reference documents never
satisfy required completion evidence. No schema migration is needed.

PA conversation files retain their existing 500 KB limit and private report
storage; the scanner respects that limit before attaching a PDF. Task files retain
their 6 MB document limit and the combined 6 MB limit for atomic task saves. The
form explains its applicable limit. Existing uploaded files are preserved.

Validation: all 519 automated checks and the deployment dry run passed. Coverage
includes DOM form coverage at every stage, real scanner image-to-PDF
conversion inside a PA reply, Worker/D1 persistence, private reads, unchanged
completion, stale revisions, atomic rollback and identical retries after a lost
response. The local Chromium visual run could not start because the execution
host disallows its socket creation. Physical iPad/iPhone/Android camera and layout
acceptance remain unverified; no live test tasks or messages were created.


## Continuous task search — 0.46.4 (18 November 2026)

The PA task search keeps the same connected input and ancestors while loading,
filtering, and receiving background updates. Previously the 220 ms search delay
replaced the whole page, temporarily removed focus, and later forced the caret
back to an older position. Slow typists could lose characters between requests.
The surrounding content is now updated without detaching the input, and old
requests are invalidated as soon as the query changes. Responses never refocus
the search or overwrite the user's current text selection.

The browser acceptance script `scripts/qa-task-speed.mjs` covers slow word typing,
spaces, middle-of-word replacement, delayed overlapping queries, selection
preservation, leaving the field, clearing, and correct matching task results on
Chromium desktop/Android and WebKit iPhone/iPad profiles. A DOM regression checks
retained element identity, ancestor identity, notifications, clearing, and view
navigation. Test fixtures are isolated; no task data or schema changes are needed.

## Delegated steps and final approval — 0.47.0

A workflow can be created atomically with 1–100 individual steps in `data.steps`.
Each retains its stable ID, assignee, date, notes, reference files and status.
`In Progress` is now supported. Reference files (including scans) can be supplied
at creation, with step_add/step_update, or with step_note; completion evidence
remains separate and records the actor and server time. Existing permissions,
optimistic revisions, retry keys and append-only D1 events are unchanged.

Completing the last required step leaves the parent Pending with
`ready_for_approval:true`. Only Alex or the parent's assigned person can use
`approve_workflow`; open PA work still blocks final closure. Previously closed
workflows retain their original completion. Adding/reopening work clears the
approval. No mass rewrite or schema migration occurs. `step_delete` needs a reason
and explicit confirmation, cannot remove a referenced dependency or last required
step, and leaves old events/files intact. `step_reorder` accepts every current
step ID exactly once. Administrators retain delegation rights; staff retain
access to their own assigned parent/steps and may add notes or completion evidence.

The form supports adding all steps before saving; each has its own scanner.
Lists show compact progress, remaining/overdue counts, next responsible person
and the viewer's own steps. Full details load on opening the existing parent.
The existing notification queue sends assignment and completion messages to the
relevant people. Each step independently chooses due-date + first-overdue alerts,
daily alerts, or off. Stable IDs deduplicate scheduler retries; changing dates,
assignees or completion withdraws stale alerts. No parent due alert duplicates
step alerts. Delivery still depends on the existing device push permission.

PA's existing authenticated MCP tools expose the new contract. The same parent
enters pending_sync; children do not create separate PA register rows. Daily
`report-context.task_steps` reads current progress directly. Continue its
next_offset with `summary`, id `task-steps`; pages have 25 parents. Use current
step status over an older mirrored parent row, merge the same existing PA ID, and
report meaningful changes or overdue work without repeating completed items.

Validation includes isolated Worker/D1, OAuth/MCP, UI form and mobile browser
acceptance (`scripts/qa-task-steps.mjs`). Test traffic has no external transport
and cannot notify live staff. Roll back with a forward fix; retain these events
and approval checks, never revert to automatic parent completion or restore D1.

## Simple new-task screen — 0.47.1

The initial form offers one choice: Gewone taak or Taak met stappe. A separate
Voorraadtelling button opens the supplier count form, with a clear explanation
that this counts our stock from that supplier. Only this form shows a required
supplier and Teldatum. Switching back retains title, notes and draft steps.
Hidden fields are disabled and excluded from saves. Existing kind/task_type
values and all server permissions/count-receipt requirements remain intact.
No schema or data migration. Ordinary recurrence, step delegation and scanners
remain available. DOM and Chromium/WebKit acceptance exercise all three saves
and verify that a stocktake cannot complete without its saved count.
