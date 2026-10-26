# Riversdale invoicing pilot — 0.23.0

Open **Invoices** in the existing app or `/invoicing/`, using the existing personal username/key. Access is limited to Alex, Alinda and Mosa; deployment does not create credentials or change access secrets. New UI text is English.

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

The shell update activates without reloading the page or touching IndexedDB; versioned entry links load the new UI from an older cached shell. Isolated UI-state checks cover start, unconfirmed handover, read-only browsing, active work, terms selection, an unfinished previous day, another phone and reauthentication. Offline-shell checks cover versioned navigation/assets and exclude private APIs. Existing invoice/asset tests pass. Physical-phone visual acceptance remains to be checked.
