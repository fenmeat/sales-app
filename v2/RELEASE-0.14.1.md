# 0.14.1 — Margot Swiss purchase packs and maintenance minimums

The supplier stocktake lacked purchase sizes already documented in Alinda's source sheet. This release adds an explicit authenticated update for all 34 listed products, without replacing the live register with an older export.

## Evidence and mapping

Alinda's email `link`, sent 9 October 2026 at 13:46 SAST, points to https://docs.google.com/spreadsheets/d/1g1hk9oMD2h4NlISgFMysAbaM8DCy3eptT0Lvs9e7YEg/edit#gid=656937722 . Margot Swiss A4:B37 was freshly read. Product pack descriptions retain row-specific source links. Alex subsequently confirmed that vinegar uses 1 litre = 1 kg, and that blades, ribbon elements and Teflon tape are bought singly with a minimum of two each.

- Aprons, mop caps and beard caps: 100 each. Bleach: 100 × 30 g sachets. Toilet paper: 48 rolls.
- Pine Gel: one 5 L container. Jumbo Wipes: one 200 mm × 550 m roll. Grease: one 400 g cartridge. Spray: one 400 ml can. These contents do not multiply the existing stock unit.
- Polony casings: one roll. Patty casings: 25. Film: one 330 mm × 1,400 m roll.
- Handy/Midi carriers: 100. Black 71M trays: 250 per the linked sheet; the visible note distinguishes other 125-tray sleeves. White Oval 2: 200; Black Patty 8: 50; Black Oval 2: 200. Correct the two misleading tray names that said Labels; retain the separate CIBA material.
- Vacuum bags 150×200 and 150×250: 1,000. Poly bags 300×450, 350×450 and 450×600: 250. Keep the visible 25-versus-30-micron discrepancy for 350×450; do not silently change its specification.
- Vinegar: 5 L = 5 kg per Alex's operating conversion. Salt: 50 kg. Ground coriander, nutmeg, peri-peri, ground black pepper, brown sugar and ground cloves: 1 kg each.
- Blades, ribbon elements and Teflon tape: one per purchase unit; minimum stock two each.

The reviewed revision-3 export gains 19 missing numeric sizes (17 if the earlier documented packaging update was already applied). Five other register entries have no matching pack size in this sheet: ground ginger, crushed chillies, coarse black pepper, Meatballs Tray Box and the unresolved mince-tray material. They are listed for separate review rather than inferred or merged.

## Behaviour and preservation

Use **Werk Margot Swiss se pakgroottes by → Stoor Margot Swiss se pakgroottes**. GET only previews. The POST uses current saved data, owner authentication, same-origin protection, a revision guard, retry-safe request ID and an append-only audit event. Deployment alone does not apply private data changes. Save any current stocktake before refreshing or applying the update.

Existing counts, physical dates, availability dates, allocations, incoming deliveries, original count conversion metadata, prices, recipe versions and packaging recipes are retained. Newer material identities, suppliers or conflicting sizes are skipped visibly. Later manual pack-size edits clear stale descriptive metadata.

Stocktake labels explain full packs and loose quantities outside those packs in Afrikaans, with a calculated example and product-specific units. Users can alternatively enter the complete total in the second field, without double counting.

The three maintenance products appear in Order Guy even without recipe demand. Their shortage replenishes the minimum of two; no 15% buffer applies to the minimum. Existing larger ordinary reserves still apply; smaller reserves are not counted twice. Unknown stock is not treated as zero. Unrelated missing recipe coverage does not block an independent maintenance minimum, while referenced production materials retain the original coverage checks.

## Verification and activation limits

124 automated tests passed. Real workerd/D1 tests cover preview versus save, owner/staff/anonymous access, cross-origin refusal, stale writes, repeated requests, audit persistence and preserved current stock. Domain tests cover pack conversion, single-container units, the owner-confirmed vinegar ratio, minimum replenishment, outstanding deliveries and unknown counts. Applying the update to both forms of the owner export passed validation and preserved all stock, prices and recipes. JavaScript syntax and whitespace checks passed. Wrangler dry-run bundling passed.

The session browser policy blocks direct live app access. No live data application or visual browser verification is claimed. Verify publication through the GitHub/Cloudflare build; the owner applies the prepared private-data update through the app. Version 0.14.1 appears above the navigation. Retain the operational build branch and draft PR; no merge, supplier message or purchase order is part of this change.
