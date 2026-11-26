# Task conversations — 0.55.0

The Deli plan and PA conversation are separate. Task details open without the PA
transcript; expanding Gesprek met PA fetches the latest 30 messages. Keyset
pagination loads older messages without polling or loading entire history.
Safe formatting, links, evidence and SAST timestamps are supported. Unknown
historical dates/authors stay unknown. The existing hourly PA work queue processes
questions; this release does not add a synchronous model endpoint.

The new message table has a task/chronological index and stable IDs. Task event,
question/answer, attachments and validated task_updates share one D1 batch.
Request retries are idempotent. The composer preserves text and an uncertain
save's request ID; Alex's drafts remain memory-only. This is not a new offline
background queue. Existing offline behaviour remains unchanged.

Reads require fullTaskAccess on the current task at the API. Step-only delegates
do not receive the parent's discussion. Report-origin copies remain owner-only
unless directly on their PA task identity; other users also recheck current source
register and linked task access. Shared searches/inbox do not query message content.

Use conversation_migrate through Alex's PA scope with a current revision, stable
request_id and verified backup_reference. Original task backups and replacement
are atomic. Work/feedback IDs are deterministic. Exact append events preserve
recorded actor/time; ambiguous mixed text remains whole with a review flag.
Documents, completion evidence and unrelated notes survive. Review current
summaries after migration. Repeat conversions do not duplicate messages.

PA result task_updates may change the summary, update/add open steps, or complete
an open step with explicit confirmation and normal proof/dependency checks.
Completed steps and existing requirements are protected. Status/progress follow
the steps. Ordinary tasks retain their existing status actions. The PA skill and
hourly/daily prompts enforce this workflow; the database does not infer intent.

Validation uses npm test and a browser synthetic fixture at 320/390/768/1024 CSS
pixels. This is not hardware/Safari coverage. Live verification separately checks
version/assets, owner reads and migration receipts. Policy-only role diagnostics
must never be described as authenticating in other users' sessions.
