# 0.14.2 — Keep saved supplier counts visible and usable

Alex reported entering and saving Margot Swiss stock four times, seeing empty fields after each save, finding no stock in Order Guy, and seeing no effect from Reload saved data. The live account could not be inspected because the session's browser security policy blocks direct app access. No claim is made about which prior attempts reached D1.

## Confirmed causes and corrections

- The previous UI deliberately cleared input fields after save and rendered blank fields again after reload. It only showed counts in the separate Last saved text. The form now fills fields from the saved count, preserves explicit zero, and shows how many supplier materials have a persisted quantity.
- Original packs and loose quantities reappear when they still match the material's current pack size. Otherwise the saved total is shown directly, avoiding a second conversion after a pack correction.
- The actual save error was below the sticky save bar. It now appears inside the bar, receives focus and identifies the specific refusal. Physical count dates in the future are caught before the request. The dates are labelled in Afrikaans and explained as count/availability dates, not an ordering period.
- A confirmed stock save and its retry now return the persisted register snapshot, receipt ID and authenticated owner. Rendering the successful save no longer requires a second GET that could fail after the UI cleared its draft.
- Reload fetches the current stock register, visibly restores saved fields, and retains unsaved edits. If the last receipt matches an earlier timed-out request, the UI recognises that it was saved. If a pack size changed, pending input is retained as its original total quantity.
- Pending edits and the save request are copied into sessionStorage under the authenticated owner's key. They survive refresh within that tab. They are not presented as saved server stock, and are cleared only after acknowledgement or deliberate discard. This cannot recover client drafts lost before this release.
- Date-only corrections can save the existing displayed supplier quantities without retyping them. The screen explicitly says date changes apply to its filled counts. Other suppliers remain unchanged.
- Gaan na Order Guy carries the stock availability date into the first production day; the user still selects the final production day. An availability mismatch now explicitly says the count is saved and names both dates instead of implying the stock is missing. No stale count is silently accepted for a different date.
- Material price/description edits retain existing stock availability and count metadata when quantity and physical count date were not edited.

## Verification

131 automated tests passed; Wrangler dry-run bundling passed. Tests exercise the real view event handlers with a documented DOM test double, saved values after save/reload, failed requests, visible validation, pending draft persistence, ownership scoping, zero versus blank, original pack conversion and date-only changes. Real workerd/D1 tests verify saved snapshots, retry handling, a fresh login reading the same stock, and Order Guy deducting that saved stock on its confirmed availability date. A wrong date preserves the visible saved quantity and explains the mismatch. Asset routing includes the new browser module.

No browser binary was available for visual QA; no live user-data save/read was performed. The GitHub/Cloudflare deployment status must confirm publication. This release changes code only, not the stored inventory. The owner should open the updated supplier stocktake in a new tab while keeping the old tab open, so any existing in-memory input remains available.

Version displayed: 0.14.2. Entry: https://fenmeat-sales-test.alexander-fenwick.workers.dev/recipes?view=stock&supplier=margot%20swiss . Keep the existing operational build branch and draft PR. No supplier message or purchase order is sent.
