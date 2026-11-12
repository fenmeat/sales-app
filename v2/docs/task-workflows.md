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
