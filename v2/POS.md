# Factory POS — 0.29.1

## Receipt presentation — 3 November 2026

Receipts use the original logo extracted without modification from the approved `FenMeat_Official_Letterhead_PDF_Master.pdf`, together with its black header/footer, royal-blue rule, navy panels, legal name and margins. The source and PNG hashes are retained in `src/fenmeat-receipt-brand.js`. A4 output keeps product rows together and repeats the table headings and receipt number on continuation pages. The document is labelled **Sales receipt**; no new VAT calculation or tax-invoice claim is introduced.

The PDF, on-screen receipt and WhatsApp handoff show only payment methods with a positive saved amount. Cash tendered and change appear when cash was handed over. Split payments retain every used method. Cashier names display as Alex, Alinda, Xavier and Xalinda; saved account identities remain unchanged. Reopening an existing receipt uses the current presentation without changing the original sale or its stock/payment records. Daily totals continue showing every payment channel, including zeroes.

Factory POS is a counter-sales module at `/pos`, separate from delivery routes. Alex approved this workflow on 3 November 2026: Alex, Alinda, Xavier and Xalinda serve customers concurrently; every sale is paid immediately with Cash, Card on the existing Capitec terminal, Shop2Shop, or a split. Server access is limited to those exact four accounts. Reps and other accounts cannot read or write the POS, customers, reports or receipts.

## Counter workflow

Open **Factory POS** from Home. Choose products in the catalogue's existing sale units, then **Pay**. Choose **Cash**, **Card**, **Shop2Shop**, or **Split payment**. Cash tendered and change are separate from cash applied to the sale. For a card payment, operate the Capitec terminal and confirm **Approved** in the POS. This release records that confirmation; it does not integrate with or charge the terminal. Shop2Shop requires its successful payment reference. **Complete sale** requires full payment, with no credit.

Use **Walk-in customer**, choose a saved customer, or **Add customer** with an optional phone number. Customer history shows completed sales. Each completed sale has a unique `POS-` invoice number and immutable product, price, customer, payment, cashier and capture/save snapshots. **Print / Share PDF** uses the existing mobile PDF viewer. **WhatsApp** prepares a message for the user to review and send. **New sale** starts a fresh basket. **Home** returns to the main app.

## Drafts, concurrency and connection loss

There is no Start route, Finish route, global till lock or single-user session. Each sale is independent. Draft writes use revisions and belong to their named creator. Staff share paid history, customers and daily reports. **My drafts** includes this device's drafts and paged server drafts belonging to the current person. Edits are locally retained; **Save draft** makes the draft available on another device. No payment or stock movement is recorded for a draft or a cancelled draft.

Checkout needs an internet connection. Before sending a payment save, the exact request is retained in browser storage. A lost response remains **Check saved sale**; retrying uses the same identifier, body and capture timestamp. Do not charge the card again. A saved payment, invoice and stock movement commit atomically. Same-sale concurrent writes have a single winner; changed retries are rejected. The capture date uses South African time and is distinct from the server save time, so a delayed retry does not silently move a payment to another day. A fully paid sale cannot be edited or deleted through this release; refunds require a separately reviewed workflow.

## Reports and stock

**Daily totals** separates Cash, Card (Capitec), Shop2Shop and change, with totals per cashier and product quantities sold. Totals cover the full day independently of paged sales history. Comparison fields help compare physical cash, the Capitec terminal and successful Shop2Shop receipts; those fields do not book receipts or certify a cash-up. The existing PA read connection accepts `get_access_status({pos:{date:"YYYY-MM-DD"}})` for the saved POS totals.

Every completed sale creates one immutable stock issue per product in the same database transaction. Retrying cannot issue stock twice. Production displays Factory POS stock sold for its selected day to the four authorised users. Physical counts and existing opening/produced/closing records are not rewritten: the existing system uses physical count snapshots, not a continuous finished-goods balance. A later count must not have earlier sales subtracted again.

## Existing records and rollout

The legacy `R12` catalogue entry, customer balances, events and sessions remain intact. Old Factory screens link to Factory POS and show previous records. New legacy factory sessions are refused; existing sessions can still replay their original pending queue and finish. No existing payments are marked paid or written off. Legacy pooled debt is not assigned to new walk-in customers. Delivery route workflow, forecast and scheduled production stay separate.

Schema changes are additive: `v2_pos_sales`, `v2_pos_events`, `v2_pos_customers`, `v2_pos_stock`, `v2_pos_payment_refs` and their indexes. No credentials, external services, prices, business records or route histories are changed by deployment. Code rollback does not remove these tables; retain them and inspect any paid POS work before a rollback. Financial tests use isolated synthetic D1 records only.

Validation: real Worker/D1 tests cover four simultaneous cashiers, full/split/declined payments, changes, drafts, customer history, exact retry, races, permissions, PDF reads and atomic stock issues. DOM tests execute the actual POS app through checkout, reload after a lost response, input approval reset and identity isolation. The synthetic PDF is rendered and inspected. Physical iPhone/iPad printing and real Capitec cash-up remain on-device acceptance checks. No real sale, payment or customer is created for testing.
