# ChatGPT Tasks write contract — 0.46.1

The 18 November 2026 create failure was reproduced through the live ChatGPT
connector. Both OAuth read and write access and the isolated database write probe
worked. In 0.46.0 `save_task` exposed an untyped `task` record, while `saveTask`
required both `request_id` and `task_id` to match `^[a-zA-Z0-9-]{8,90}$`, even
on create. One combined check returned “Use a valid save identifier” for either
missing/invalid field. `save_app_data(target:"tasks")` reached the same check;
changing transport could not resolve an absent or malformed identifier.

The connector schema now describes the envelope and task context returns
`save_contract`, including for clients whose tool descriptions are cached.
Create may omit `task_id`: the writer derives a stable ID from the authenticated
owner and request ID. Updates still require the existing task ID and latest
revision. Identifier errors name the failing field and how to correct it.
No table migration, account permission change or task backfill is required.

## Safe use from any connected conversation

1. Read `get_app_edit_context({target:"tasks"})` or `get_tasks`, including all
   `next_offset` pages, and find the existing obligation before creating.
2. Create with `save_task({task:{action:"create",revision:0,request_id,data}})`.
   Use a UUID request ID. Task data uses `title`, `details`, existing
   `assigned_to`, `due_date`/`review_date`, `priority`, `reminder_mode` and
   `reminder_at`. An explicit valid task ID remains supported.
3. Retry an uncertain write with the same request ID and unchanged content.
   PA request comparison ignores object-key order, preserves array order, and
   rejects changed content. Historical fingerprints remain replayable. Concurrent
   identical writes read the existing event after a unique-key conflict.
4. Read back with `get_tasks({query:{task_id:result.task.id}})`. Check the saved
   fields, actual revision and history before reporting success. The read returns
   the latest 50 event summaries; full payload history remains in the app.
5. Update the same ID with the freshly read revision and a new request ID.
   Use `complete`, `reopen`, `wait` or `cancel` for status, not `data.status`.
   `wait` takes `note` and `review_date`; `reopen` takes `note`. Workflow,
   stocktake, PO and evidence restrictions remain enforced.

`save_app_data` uses the same writer, with revision/request ID/reason at the top
level and `{task_id?,action,data,...action_fields}` inside `data`. Its existing
request ID format remains 16–80 letters, digits or hyphens; UUIDs work on both
transports. Task IDs are not request IDs. A new request ID is a new command, so
search-before-create remains necessary across separate conversations.

The schema intersects the typed envelope with the original record to preserve
incoming property order when checking pre-0.46.1 fingerprints. Action-specific
fields are passed through to the existing business validators.

## Dates, status and reminders

Use Africa/Johannesburg for user dates. `reminder_mode:"once"` requires a future
UTC ISO timestamp with milliseconds: 23 November 2026 at 07:00 SAST is
`2026-11-23T05:00:00.000Z`. The existing five-minute scheduled Worker queues the
notification. Actual phone push also depends on a valid device subscription and
permission; a saved timestamp alone is not evidence of device delivery.

Existing date-aware rules place future open reminders in Scheduled, then Pending
on their due date. Do not convert a simple reminder into a legacy PA task just to
force a different list. Simple reminders stay app-only; the existing PA sync
automation and linked task rules remain unchanged.

## Validation

MCP/OAuth → Worker → D1 → browser API tests cover create without ID, typed schema,
read-only denial, both write transports, reordered/identical/concurrent retries,
changed-content rejection, old fingerprints, assignment/date/reminder edits,
stale revisions, evidence, complete/reopen/wait, audit preservation and one-time
07:00 SAST queuing. Live acceptance is recorded separately after deployment.

Rollback is a code deployment of the prior release. Keep all append-only events,
including tasks created with generated IDs; those IDs satisfy the older format.

## Tasks access from 0.48.0

Create ordinary team work with `data.visibility="operational"`. Alex, Alinda,
Xalinda and Xavier can manage it. They can delegate the parent and its steps to
registered Tasks users. Ordinary workflows still require explicit final approval.
Private PA report items remain Alex-only. The administrator-only PO dispatch
confirmation and PA processing permissions continue to apply.

Use `assigned` for restricted assignments or `confidential` for Alex and Alinda.
Existing unclassified records keep assignment-based access. Supplier stocktakes
are operational. An administrator can classify a reviewed record in place with
`set_visibility`, its current revision and a reason. This appends a history event
and preserves the original task, attachments, completion and PA sync position.
The owner can check current role counts using daily report summary `task-access`.
