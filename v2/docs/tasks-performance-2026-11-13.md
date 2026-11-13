# FenMeat Tasks: performance verification, 13 November 2026

Release: 0.41.0. Tested code: `6147530e84acf5a729946d0de2923d94bafdb6ad`.
Existing production application: https://fenmeat-sales-test.alexander-fenwick.workers.dev/tasks

## Measured cause

The old initial load awaited the full app task list and then the full PA report before rendering. With 66 app tasks, 222 PA rows, 63 feedback records and 26 visible alerts, an owner-only, read-only production profile recorded:

| Read | Wall time | Database round trips | Response |
| --- | ---: | ---: | ---: |
| App task list | 1,393 ms | 4 | 111,340 bytes |
| PA report | 14,300 ms | 55 | 299,689 bytes |

Inside the PA report, alert validation repeated register/report reads 47 times. Those round trips took 12,829 ms, while their aggregate SQL execution time was only 97 ms. This is a round-trip bottleneck, not a 20-second sort or a PA sync job. The initial UI does not invoke external PA or Zoho synchronization.

Two connector-level repetitions took 19.6–20.9 seconds for the old sequential pair. These include connector overhead and are **not** an authenticated browser click-to-paint measurement. No authenticated production browser session was available; the live app displayed its ordinary sign-in page.

Sorting/unification on an actual captured 65-app-task/222-PA-row snapshot, locally for 1,000 runs: median 0.80 ms, p95 2.61 ms, maximum 24.51 ms. Cloudflare's wall clock does not reliably measure CPU-only intervals, so a reported zero there is not treated as zero processing cost.

## Implemented

- Static Tasks shell paints before data; one bundled module removes the import waterfall.
- One batched workspace read selects Pending first. Scheduled and Completed use independent requests with 25-item pages; an explicit deep link can additionally include its target.
- Existing event tables and the existing PA mirror remain authoritative. The server still reads the bounded current task/register snapshots to compute accurate cross-list counts and workflow state; it does not send all those records to the browser.
- Memory-only, per-identity list caching renders previously loaded data immediately. Conditional ETags return 304 for unchanged pages. Mutations clear caches; stale in-flight replies are discarded. Changed pagination snapshots restart safely.
- Details, original editors, evidence, audit history, conversation history, task options and email metadata load on demand. Notifications load independently and do not block Pending.
- PA alert visibility reuses a batched register/report snapshot instead of fetching the register for every alert. Existing privacy, reminder and closed-task rules remain enforced.
- Added indexes for recent feedback and per-user unread alerts after query-plan inspection. Existing task revision/latest and notification indexes were already used.
- Existing PA incremental sync, canonical identities, optimistic revisions, permission checks, workflow completion controls and original-task editing are retained. No production task data is modified by the performance work.

## Automated validation

All **500** Node tests passed; deployment dry-run passed. Tests cover role isolation, original editor/save/readback, evidence changes and protected business controls, workflow steps, documents, audit history, stale PA overlays, pagination, conditional reads, cache races, feedback and incremental sync.

Browser acceptance: https://github.com/fenmeat/sales-app/actions/runs/43425490824

The shipped UI and real Worker/D1 code were exercised against isolated synthetic fixtures matching the measured live volume (66 app tasks and 222 PA rows). A 250 ms delay was added to every API call. These are emulated profiles, not physical devices or production network timings.

| Profile | Shell | Pending | Scheduled | Completed | Cached list | Details |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| chromium-desktop | 73 ms | 354 ms | 283 ms | 277 ms | 17 ms | 317 ms |
| chromium-android | 57 ms | 323 ms | 284 ms | 280 ms | 16 ms | 818 ms |
| webkit-iphone | 79 ms | 368 ms | 290 ms | 288 ms | 27 ms | 340 ms |
| webkit-ipad | 78 ms | 354 ms | 286 ms | 291 ms | 32 ms | 349 ms |

The tests also verify no initial report/history fetch, load-more paging, server-confirmed 304 revalidation, original editing from PA conversations, PA assignee options, new-task forms, ordinary text caret behavior, mobile widths and no browser script errors. The existing editor acceptance suite saves and reads back evidence settings, audit changes and completion in the isolated test database.

## Production verification

Cloudflare completed successfully at **12:35:59 UTC on 13 November 2026**. The live authorised connection returned **0.41.0**. The production branch points to the exact tested commit above; its repeated browser run also passed: https://github.com/fenmeat/sales-app/actions/runs/43425925937

Live measurements at 12:36–12:38 UTC:

| Read | Before | After |
| --- | ---: | ---: |
| Full PA report, including schema/read path | 14,300 ms / 55 DB trips | 1,117 ms / 3 DB trips |
| New Pending workspace page | Not available separately | 368–874 ms, 25 of 42 rows, 72,725 bytes |
| New Scheduled workspace page | Not available separately | 568–574 ms, 1 row, 6,919 bytes |
| New Completed workspace page | Not available separately | 571–894 ms, 25 of 184 rows, 38,445 bytes |
| One existing task detail | No separate baseline | 179–191 ms |

Workspace and detail timings measure the actual production service functions with existing data, separately from the connector/OAuth wrapper and schema initialization. They are not handset end-to-end timings. The connector itself took 2.68–3.85 seconds per workspace diagnostic because each call also includes tool transport, schema setup and a separate detail read; the Tasks browser uses the direct workspace endpoint instead.

The database had 66 app tasks and 224 PA rows during verification. The PA mirror grew from 222 to 224 through other activity during the session; this performance work did not publish register changes or run a full sync. All 66 app IDs were unique and all app revisions matched their pre-release values. The previously completed authorised test case still read back as Complete, revision 4, evidence disabled, with its existing PA link and acknowledged sync. Its PA conversation and answers remained present.

The new workspace responses contain only the selected page and no conversation or audit history. Existing detail, edit, evidence and audit endpoints remain unchanged. No production task, answer, date, evidence file or business transaction was created, edited or deleted by this optimization.

Physical iPhone/iPad/Android devices and an authenticated live browser click-to-paint session were not available. Production service read timings and emulated browser timings are reported separately; they do not guarantee a particular handset/network result.
