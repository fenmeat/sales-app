# 0.14.3 — Readable supplier selection with the correct selected name

Alex's screenshots showed version 0.14.2 displaying Brito's after another supplier was selected, and an expanded native select whose text was too small to read.

The selected supplier and the options came from separate calls to supplierGroups. Comparing those objects by identity could never mark the matching option as selected, so the native select displayed its first option. Selection now uses each supplier's stable key. The supplier heading, active choice, material cards and save destination remain aligned.

The native select is replaced by a native details disclosure containing ordinary buttons, with explicit 16 px text, a minimum 48 px button height and a scrollable list. The selected supplier is also named in the page heading. Escape closes the list and restores focus. Changing supplier while there are unsaved quantities is blocked with an explanation beside the picker, preserving the current input. Save/reload locks include the supplier buttons.

Verification: all 11 focused tests passed (stocktake view, stocktake state and real Worker asset routing), and Wrangler deployment dry-run passed. Tests cover Brito's to Margot Swiss and back, direct Margot opening, matching save payload and supplier cards, save/reload selection, and unsaved-input protection. View tests use the documented DOM test double, not a real browser layout engine. No browser binary was available for visual QA, and live app access remains blocked by this session's browser security policy. No live stock read or write is claimed.

This is a code-only release; it does not migrate inventory or require an activation button. Publish on the existing build/sales-v2-cloudflare branch and verify its exact Cloudflare deployment check. Keep draft PR #2 unmerged. No supplier message or order is sent.

Visible version: 0.14.3. Stock entry: https://fenmeat-sales-test.alexander-fenwick.workers.dev/recipes?view=stock&supplier=margot%20swiss . The expected heading is Voorraadtelling: Margot Swiss. Keep any old tab with unsaved input open when opening the updated page.
