# FenMeat read access — 0.15.0

**0.17.4 update:** Alex and Alinda are both authorised
administrators under Alex's 14 October instruction. With live 0.17.4, use
the person's own account and consent; see [ADMIN_ACCESS.md](ADMIN_ACCESS.md).
The Alex-only flow below records the original implementation, not the new policy.

Owner instruction, 12 October 2026: continue building permanent read access for
ChatGPT without repeated sign-in during conversations (PA task TSK-00110).

Release status, 12 October 2026: implemented and locally verified.
146 tests and the Worker dry-run build pass. The owner explicitly approved
publication to the public `fenmeat/sales-app` repository and the app update.
The instructions below apply after the branch deployment is verified; they do
not establish that the owner has completed the separate ChatGPT connection.

## Connect once

In ChatGPT on the web, open Plugins → + → Add custom MCP server. Name it
**FenMeat Leestoegang**, set the server URL to
`https://fenmeat-sales-test.alexander-fenwick.workers.dev/mcp`, and select OAuth.
Dynamic client registration is supported; no manual client secret is required.
On FenMeat's own authorization page, use Alex's existing sign-in if needed,
then choose **Laat leestoegang toe**. Credentials are entered only on that page,
never in a conversation or document.

The owner connection remains a final user action. Publishing the endpoint and
passing local tests do not prove that ChatGPT has been connected. Verify a live
`get_catalog` call through the installed connector before marking TSK-00110 complete.

Seven read tools cover the current catalogue, saved sales, live forecasts,
production/trolleys, recipe/cost register, material counts and Order Guy windows.
They return dates, revisions and warnings. Missing data stays unknown, saved
zero remains zero, and unsaved suggestions remain distinguished from saved plans.
Dates use Africa/Johannesburg. Sales and Order Guy windows are bounded to 31 days.
No Zoho credentials, application sessions, raw SQL or arbitrary URL tool is exposed.

Manage/revoke each connection at
`https://fenmeat-sales-test.alexander-fenwick.workers.dev/pa-access`, also linked
from Alex's Setup & Zoho page. Only Alex may create or revoke these grants.

## Authentication and storage

`connected-worker.js` wraps the existing app entrypoint. Existing routes still use
their previous application authentication. An MCP access token cannot authorize
an existing app GET/POST API or become an app login. Every MCP tool has read-only
annotations and a fixed validated schema. Business reads receive a database wrapper
that permits SELECT and refuses writes/batches; they reuse the existing calculation
functions and do not save generated forecasts or modify business tables.

Cloudflare's pinned OAuth provider handles authorization-code + S256 PKCE, exact
registered redirects, browser-bound single-use consent, encrypted grant properties,
token hashing, token refresh and revocation. DCR accepts only official HTTPS
ChatGPT callback forms. No external identity-provider proxy, upstream tokens,
client-credentials grant, anonymous data access or arbitrary client-metadata fetch
is enabled. The callback allowlist is separate from the registered exact URI check.

Access tokens last 15 minutes. Refresh grants renew while used and expire after
90 idle days; their registered client has no automatic expiry. App logout does not
disconnect the grant. Revoking the grant or changing/removing Alex's app key stops
access. The owner-key fingerprint is inside the provider-encrypted properties.
No existing APP_ACCESS_KEYS, APP_STAFF_ACCESS_KEYS or Zoho secret is changed.

The provider's KV interface is implemented by `pa-storage.js` over two isolated
D1 authentication tables using the existing DB binding, so no new Cloudflare
binding or owner-created secret is required. Only text/JSON get, put, delete and
cursor/prefix list operations used by the pinned provider are implemented.
Expiration is enforced on reads and lists. Successful token exchange cleans
expired auth records. Recheck this adapter if upgrading the OAuth provider.
No cleartext access/refresh token or app key is retained in these records.
Do not log request bodies, Authorization headers or tokens.

Same-origin owner management/consent, cross-origin MCP restrictions, request
size bounds, registration/auth/read rate limits and no-store headers are enforced.
The owner pages use escaped text, CSP, frame denial and cross-origin referrer suppression.

## Verification and release

`npm test` runs the existing app regression suite plus six workerd/D1 integration
cases for discovery, the SDK transport, all seven business reads, preservation of
saved data, unknown/zero distinctions, rejected writes, PKCE/callback/CSRF checks,
token renewal, logout, revocation, key rotation and expiry. Synthetic credentials
and data are used; no real app key is part of the repository or test output.

`npm run check:deploy` verifies the complete production entrypoint bundles with
the existing Cloudflare bindings. Deployment uses the established
`build/sales-v2-cloudflare` branch. Health identifies build 0.15.0.

Rollback: restore the previous branch revision through the normal deployment
workflow. Existing business tables and user keys need no reversal. Leaving the
additive auth tables does not expose access when the connector routes are absent.

Official implementation references:
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/deploy/connect-chatgpt
- https://github.com/cloudflare/workers-oauth-provider
- https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
