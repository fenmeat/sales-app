# Full-pack stocktake — 0.17.5

Supplier stock is entered only as the number of full purchase packs. There is one quantity input per material. The known purchase-pack size converts this integer to kg, units, rolls or sales packs for calculations. A new count replaces the previous count; it never adds a previous total.

- Blank means not counted; an explicit zero means no full packs. Fractions and unknown pack sizes cannot be saved.
- The stocktake API rejects non-zero loose quantities, including submissions from an old browser. Omitted, null or zero legacy `loose` fields are compatible; new records always retain `count.loose: 0` for history compatibility.
- The Materials editor no longer offers a raw stock-total/date/source input. It preserves the saved physical count while editing prices, pack sizes, allocations and incoming deliveries.
- Historical records are not rewritten, rounded or cleared during deployment. Mixed full/loose counts require an explicit new full-pack count. Order Guy keeps their net/order quantities unknown until that confirmation.
- Old unsaved drafts retain their entries for review but their old request bodies are never retried. Changed pack sizes require re-entry against the current size. Revision, retry, user identity and receipt-deduplication protections remain in force.
- Existing reserves remain visible/read-only in Stocktake and are preserved; admins manage allocations in Materials. Expected receipts are not silently marked received.

This release does not migrate or rewrite saved operating data. Historical mixed counts require confirmation through the full-pack input before they can be used for net-order calculations.

Verification: stocktake state/view/domain and real Worker tests cover legacy carry-over, explicit zero, fractions, unknown/changed packs, old local drafts, availability dates, authenticated staff/admin saves, stale writes, retry replay, audit identity and isolation from other operating data. Run `npm test` and `npm run check:deploy` before publication. Runtime tests use isolated synthetic databases, never live operating data.
