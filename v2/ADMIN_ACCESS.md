# Alex and Alinda — equal app administrators (0.17.4)

Authority: Alex's explicit instruction, 14 October 2026, 11:16 SAST:
Alinda must have the same access as Alex; she is also an administrator and
does not need Alex's approval for each action.

Release verification: 175 local tests and the Worker deployment dry-run pass.
Alex explicitly approved publication to the existing public repository and
Cloudflare app on 14 October 2026 at 11:30 SAST. Live rollout must be checked
through `get_access_status` (0.17.4) separately from Alinda's own connection.
Neither a code release nor local tests establish that she has connected.

## Scope

Both existing primary accounts, `alex` and `alinda`, independently authorise
and manage their own ChatGPT OAuth grants, select read-only or read/write
consent, read the operational app, and use the same validated app-edit tools.
The actual signed-in identity is retained in each grant and app audit record.
Admin parity also applies to existing Zoho connection management, read-only
FEN invoice/payment access, reconciliation reads and app mappings.
No Zoho write scope, external sending tool, new secret, staff privilege or
business-data change is introduced by this release.

## One-time connection after deployment

1. In Alinda's ChatGPT web account, open Plugins. Reuse/refresh an existing
   FenMeat connection; if absent, choose + → Add custom MCP server.
2. Name: FenMeat Leestoegang. Server URL:
   `https://fenmeat-sales-test.alexander-fenwick.workers.dev/mcp`.
   Authentication: OAuth. Dynamic registration needs no pasted client secret.
3. On the FenMeat consent page select Alinda and enter her existing app password
   there, never in chat/email. Check the displayed identity; use
   “Gebruik ander admin” if a different administrator is signed in.
4. Select “Laat ook skryftoegang toe” and “Bevestig gekose toegang”. Install
   the plugin if ChatGPT requires it, then select it in her conversation.
5. Read `get_access_status`: username/owner `alinda`, role `admin`,
   read_access true and write_access true. Read current catalogue, recipe and
   supplier-stock data before claiming her live read access is verified.

This is her own one-time consent, not Alex approving her work repeatedly.
Old read-only grants stay read-only until explicit write consent. ChatGPT's
confirmation controls still apply to Alinda herself. Ordering, sending,
receiving and payment remain distinct; no unspecified purchase is approved.

## Security and verification

- Xavier/Xalinda retain their existing stocktake/sales/production permissions,
  not admin OAuth or Zoho-management privileges.
- Each administrator lists/revokes their own OAuth grants. Revocation or key
  rotation invalidates only that identity's grants. Existing Alex grants work
  without reconnecting. App logout does not revoke OAuth grants.
- Writes require explicit OAuth scope, current revisions and an audit reason.
  Save identifiers cannot be replayed as a different actor.
- `npm test` covers synthetic Workerd/D1 auth, all Alinda read/write targets,
  restore, audit identity, staff denial, scope, refresh, grant isolation and
  independent key rotation. UI tests cover identity selection and switching.
- Local tests do not prove Alinda completed a real connection. No live
  business mutation is needed for verification; an isolated write probe
  requires explicit diagnostic authorisation.

No schema migration is required. Rollback is a normal code revert on the
existing deployment branch. The old owner-only rule would stop Alinda's
connector without erasing data. Alex's existing grants remain compatible.
