# Owner-authorised ChatGPT writes — 0.16.0

**0.17.4 update:** Alex and Alinda have equal admin
authority. Each authorises their own OAuth connection and writes are audited
under the actual account; see [ADMIN_ACCESS.md](ADMIN_ACCESS.md). No repeated
Alex approval is required for Alinda's authorised work. Actual connection
verification remains separate from local tests and deployment.

The owner's 13 October 2026 instruction authorises sufficient access to change
the existing app's data (step 1). This release extends the existing Worker and
MCP endpoint. It does not certify or migrate the business data (step 2), expand
the app into a complete management system (step 3), or send supplier orders.

## Connect

Reconnect the **existing FenMeat connector** in ChatGPT. On the FenMeat consent
screen, sign in as the owner if necessary, select **Laat ook skryftoegang toe**,
and confirm the selected access. Keep the same MCP endpoint:
`https://fenmeat-sales-test.alexander-fenwick.workers.dev/mcp`.

OAuth grants are explicit. Old read grants and their refresh tokens retain read
access only. Publishing new tools does not upgrade them. A write request with a
read token returns a standards-based insufficient-scope challenge. An owner may
grant writes during the new consent flow even when the client initially requests
only the baseline read scope. Read-only consent remains available.

The management page `/pa-access` shows each connection as **Slegs lees** or
**Lees en skryf** and supports revocation. Revocation, expiry, owner-key rotation,
PKCE, exact ChatGPT callbacks and browser-bound consent continue to apply.

After linking, the assistant must call `get_access_status`, verify
`write_access: true`, and call `test_app_write_access`. That tool writes, reads
back, removes and verifies removal of a random isolated diagnostic record. It
never changes a material, recipe, stock count, production plan or sales record.
Until those checks succeed through the actual user's connection, live assistant
write access is **pending**, even if the release is deployed and tests pass.

## Authorised business operations

Existing seven read tools are retained. Additional tools:

- `get_access_status`: actual token scope and release version.
- `get_app_edit_context`: current native editable data, revisions and usage hints.
- `get_app_change_history`: latest 50 connector changes or a single change's
  complete before/after snapshots.
- `save_app_data`: register patches (materials, pack specifications, prices,
  stock/incoming entries, recipe versions and packaging), catalogue patches,
  availability, supplier counts, production plans/actuals and sales runs.
- `restore_app_change`: restore an immediately preceding saved value as a new
  revision, subject to the normal business rules and current-revision check.
- `test_app_write_access`: isolated persisted diagnostic, with cleanup.

All writes require `fenmeat:read` **and** `fenmeat:write`, an owner identity tied
to the current owner credential, and authorised work. There is no arbitrary SQL,
URL, file, account, import-history, external sending or Zoho-write tool.
Ordinary app HTTP APIs still do not accept OAuth bearer tokens.

Register/catalogue updates merge entries by their stable identity. Omitted
entries and fields survive; nested objects merge, supplied arrays replace.
Sales/production use the complete native run/plan from the edit context. Every
save goes through the existing app validation and workflow. Forecasts remain
computed; these tools cannot manufacture a forecast as actual sales or a count.
Changes to old recipe quantities require a new version; previous versions and
material identities cannot be deleted. Missing values remain distinct from zero.

## Atomic audit and recovery

The native business mutation and its connector audit snapshot commit in one D1
transaction. The audit contains actor, instruction/evidence, request identifier,
target, resource, revision, time and before/after values. An audit failure rolls
back the business write. Catalogue compare-and-swap updates additionally require
exactly one affected row inside the transaction. Sales close/reopen history
changes share that same transaction. Browser/native history is retained.

Each save requires the current revision. The same request identifier and exact
arguments return the previous receipt without a second write. Reusing an ID for
different data is rejected. A receipt describes its saved revision; read current
data before further edits. Following an uncertain response, inspect history and
retry the identical request identifier rather than creating another request.

Restore creates an additional audited revision and cannot overwrite later work.
It is intentionally subject to existing domain validation: newly added material
identities or recipe versions cannot be erased, and closed sales require their
normal explicit correction workflow. In these cases use the retained snapshot
to prepare a reviewed correction instead of deleting history.

Schema additions are limited to private D1 connector change records, their index,
and a diagnostic table. Credentials and tokens are excluded from audit records.
No operational business data is bundled in source or public assets.

## Verification

Synthetic Workerd/D1 integration tests exercise explicit consent, old-grant
isolation and refresh, revocation, the write/read/remove probe, native validation,
partial patch preservation, zero/null counts, incoming delivery handling,
idempotency, concurrent saves, browser-versus-connector conflicts, atomic audit
failure rollback, saved snapshot recovery and sales/production phase rules.
The existing OAuth and all original app tests remain regression gates. A build
dry-run verifies deployment packaging. Actual owner-link verification is a
separate final acceptance step; it is not inferred from synthetic tests.
