# Product availability and recipe planning — 0.11.0

The Products dialog in Sales and Production lets Alex or Alinda switch active catalogue products between Available and Not available. A saved switch choice survives catalogue imports and is shared between sessions. Catalogue revisions reject conflicting writes.

Current and future load planning, production suggestions and printouts use availability. Existing positive loads remain visible for returns and reconciliation; unavailable products cannot receive a larger new load. Historical dates use their saved product snapshot. Availability does not delete events, change quantities, or move stock. Reactivating a product restores its saved decisions; use Refresh route needs to include products absent from an existing production plan.

The three owner-identified unavailable chicken products default off until a manager explicitly changes their switches. No schema migration or direct operational-record rewrite is performed.

The revised cooked recipe uses a versioned planning basis. New plans use its larger batch size and a provisional doubled sales-unit yield; actual output must verify that reference. Existing plans retain their old interpretation until the explicit Update recipe action. That action converts cooked stock, preserves physical stock/packing/actual quantities, records the prior basis, and clears only the affected new-batch choice and trolley positions. Old revisions remain intact. This app maintains planning yields, not a full ingredient-recipe registry; the source recipe document remains separate.

Missing cooked stock remains unknown, distinct from zero. A prominent message beside the missing batch suggestion tells the operator which count is required. Decimal commas and decimal points continue to work.

Validation: 100 automated tests; isolated Worker/D1 browser checks of the switches, persistence, failed saves, recipe update, reload, returns, cash preservation, and fresh availability in stock and production printing. Layouts checked at 320, 390, 768 and 1024 pixels. The generated staff sheet was verified as one readable A4 page. Physical iPhone acceptance remains with the operator.

Deployment is limited to the existing V2 test branch and Worker. The original app, main branch and Master data remain unchanged. Code rollback alone must not reinterpret plans already saved using the new recipe version; preserve those saved payloads when preparing a rollback.
