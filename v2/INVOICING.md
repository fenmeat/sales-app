# Route invoicing — 0.24.1

Open **Invoices** in the existing app or `/invoicing/`. Alex and Alinda use their existing personal username/key. Tapiz and Musa use a six-digit PIN on their registered road phone. Deployment creates no actual PINs or invitations and does not change access secrets. All new UI text is English. Musa retains the existing internal username `mosa` so his audit history stays consistent.

## Register the two road phones

1. On the owner's phone, sign in as Alex or Alinda. Open **Invoices → Route options / More → Rep phones**, or `/invoicing/phones`.
2. Choose **Tapiz** or **Musa** and **Create activation code**. Finish and sync any existing route for that rep first. One active phone registration is allowed per rep.
3. On that rep's road phone, open `/invoicing/` in the browser they will use on the road. Under **Set up this road phone**, enter the activation code and choose/confirm a private six-digit PIN. A copied activation link can prefill the code. Codes expire after 15 minutes and work once.
4. Repeat for the second phone. Sign in online before leaving, start the prepared route and check offline setup on the actual phone. The app lists only routes with prepared invoice-store data; this release does not import or approve additional routes.

The owner never needs to know the rep's PIN. ID numbers and date-of-birth clock PINs are not used. **Forgot your PIN?** uses an owner-generated reset code on the same registered phone. **Lock app** first syncs pending transactions, then ends the PIN session. Keep unsynced work on its original phone; do not clear site data to resolve a sign-in problem.

## Invoice-only access and phone recovery

PIN sessions last 24 hours from PIN sign-in, covering a 05:00–21:00 route day. A currently signed-in route can cold-start offline during that window. After expiry, reconnect and enter the PIN; queued invoices and receipts remain unchanged. Phone registration lasts 90 days. Browser cookies are the device credential, so use the same browser/profile for registration and daily work.

Tapiz, `mosa` and the legacy alias `musa` are restricted at the server to invoice APIs. Production, Order Guy, recipes, Staff, Sales management, imports and other non-invoice business APIs deny them; direct module pages redirect to Invoices. Only Alex and Alinda can manage phones, refresh Zoho opening balances, approve credit terms or export the server ledger. Once a rep enrolls a phone, their old long-key sessions cannot bypass the phone requirement, including after revocation. Other staff access is preserved.

**Rep phones → Block phone** revokes online access immediately, including the authorization condition inside financial writes. It does not remotely erase cached offline records or cancel already issued invoices. Unsynced work on a lost phone needs owner reconciliation; this release deliberately has no silent route takeover. **Reset PIN** retains the phone identity and pending transaction identifiers. A replacement or expired registration needs the old registration blocked, its existing route resolved, and a new activation code. A revoked/expired cookie can be replaced without clearing IndexedDB.

Additive authentication tables are `v2_invoice_phones` and `v2_invoice_phone_audit`. Random device/session credentials use Secure, HttpOnly, SameSite=Strict host cookies; only their hashes are stored. PIN verification is keyed by the separate random device credential, with a random salt and five attempts per device per 15-minute bucket. Activation also has an IP rate limit. Codes, PINs and raw credentials never enter financial state, audit events, exports or localStorage. The offline invoice store is not encrypted by the PIN. Owner phone actions use revision checks and an audit trail.

## Route operation

While online, load Riversdale. Opening balances must be complete and dated. **Refresh all Zoho balances** updates only accounts that have not started in the app. Unknown balances cannot become zero. Draft Zoho invoices remain separate for review. Opening balances represent remaining issued-invoice debt, excluding unallocated customer credits.

Check the handover box and **Start today’s route on this phone**. Record subsequent sales and collections here only; they do not go back to Zoho. One person/phone holds the active route. Existing saved events lock that account’s opening snapshot. Alex/Alinda reviews each shop’s **Credit terms** once: seven-day credit or full Cash/Shop2Shop. Unknown terms permit full-payment sales but cannot grant credit. Current credit withdrawals cannot be inferred from invoice history. Reps confirm provisional names as they visit.

**Check offline setup** installs the shell and requests persistent storage. On the actual phone, close/reopen in airplane mode and reconnect before leaving. A cached shell alone does not prove device storage retention. Do not clear browser/site data with pending transactions. Prepare each new day online.

Outstanding debt is above the order and links to the invoice. **Receive payment** records actual Cash and/or successful Shop2Shop receipts with a reference; there is no paid toggle. Settle previous debt before completing a new invoice. New quantities require delivery ticks. Partial payment leaves seven-day debt only for approved credit shops. **Save draft** records no payment.

Completing an invoice first commits its account and exact queued command to IndexedDB. The screen distinguishes phone-only work from synced records. Retries keep their unique identifier. Shared D1 events and route sequence advance atomically. Conflicts/storage failures preserve pending work and stop unsafe continuation. Reauthentication preserves the queue.

**Edit items** supports additions and reductions on the same visit/day. Original versions and receipts remain. Reductions require confirmation that goods were not delivered or were returned. Changes requiring refunds are blocked for owner resolution; this pilot has no refund/credit-note ledger. New credit from an edit is due seven days from the original invoice date.

Invoice view supports browser Print/Save PDF and WhatsApp text previews for saved contacts. The user sends from WhatsApp; no PDF is attached automatically. Multiple contacts, verified GPS pins and Maps directions are supported. No contact details, pack specifications, VAT rates or registration details are invented. There is no automatic tax/discount/withholding calculation in this pilot.

**Sync**, clear/complete draft items, then **Finish route** on the same phone. Finish rejects unsynced work. In Sales → Reconcile, select the date/route and **Load app invoices and receipts**. This includes revised quantities and actual receipts collected that day, including old debt. Cash counts and independent payment-statement totals remain separate checks. Save/close follows the existing route workflow.

## Storage and recovery

Additive D1 tables: `v2_invoice_balances`, `v2_invoice_sessions`, `v2_invoice_events`. Immutable events retain actor, capture/save timestamps, revision, full account snapshot and unique request hash. Private catalogue `invoice_stores` holds opening snapshots; ordinary staff bootstrap omits them. Customer IDs remain strings; one customer belongs to one invoice route. Existing catalogue revision/audit controls apply. Deployment does not rewrite Zoho, historical sales, production or staff records.

Prepared sessions freeze catalogue prices. Historical lines retain their own names, units and prices. Route totals expose a phone backup and admin server-ledger export; pending transactions are not yet in the server export. There is no automatic takeover of an unsynced lost phone. Preserve its local backup and resolve that session before assigning another phone.

## Verification and remaining acceptance

251 automated tests and deployment dry-run passed. Tests include workerd/D1 authorization, zero versus missing debt, old/partial receipts, full Shop2Shop payment, delivery checks, server prices, due dates, audited reductions, refund rejection, stale/concurrent/replayed requests, ordered offline replay, reload persistence, finish and reconciliation with forged-comparison rejection. Fixtures are isolated; no live financial test records exist.

Browser checks used the actual Worker and asset router with synthetic D1: split debt collection, current partial payment, reload and item-edit history worked. Input replacement was verified with actual selection bounds. The browser tool then stopped responding. Subsequent small copy, offline-status and reauthentication updates received syntax/automated checks, not physical-device browser verification. Before a working route, check the first real invoice against goods delivered, money received, shared saved records, phone offline cold startup and WhatsApp handoff.


## 0.23.1 — simpler route entry

The start screen now presents one primary Start route action, followed by a short explicit handover confirmation. The shop/order view appears after starting; View stores and balances remains available read-only beforehand. During a visit, More contains sync, reload, offline setup and route finish. Store administration and balance-source details are collapsed. Unknown payment terms have a clear Set payment terms action with no preselected approval. No account, receipt, balance or credit permission is changed by this UI update.

The shell update activates without reloading the page or touching IndexedDB. A phone with an older cached shell may need to reopen or refresh after its background update; never clear its site data with pending work. Isolated UI-state checks cover start, unconfirmed handover, read-only browsing, active work, terms selection, an unfinished previous day, another phone and reauthentication. Offline-shell checks cover versioned navigation/assets and exclude private APIs. Existing invoice/asset tests pass. Physical-phone visual acceptance remains to be checked.

## 0.24.0 verification

The automated test suite and Cloudflare deployment dry-run passed, including the real Worker/D1 phone registration, one-time concurrent code consumption, PIN/session rotation, expiry, per-device throttling, legacy rep restrictions, direct module redirects, bearer import denial, owner/staff access preservation, atomic revocation during an invoice write, and exact replay after PIN renewal. UI execution tests cover the actual PIN form and application code, unsynced queue retention, expired offline sign-in, valid offline cold startup, activation fragment removal and protection against discarding another identity's drafts. Tests use synthetic records only. Actual road-phone registration and mobile browser/offline acceptance still require the physical phones; no staff PINs or production invitations were created by deployment.

## 0.24.1 — long route days

Rep PIN sessions now last 24 hours from registration, PIN reset or PIN sign-in. A sign-in at 05:00 remains valid until 05:00 the following day, allowing a 16-hour route with intermittent signal. Online contact continues the existing sync/replay flow and does not silently extend the sign-in period. Owner key-session policy and invoice-only permissions are unchanged. Existing sessions retain their issued expiry; sign in with the PIN again to start a new 24-hour session. Stored invoices, receipts and pending sync identifiers are preserved.

Verification covers the server-issued expiry and secure cookie lifetime, access after 16 elapsed hours, expiry after 24 hours, and offline cold startup late in the shift. No live financial records or credentials are changed.
