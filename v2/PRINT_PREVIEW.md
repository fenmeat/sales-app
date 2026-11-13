# Print preview controls (0.23.3)

## 28 October 2026 — Safari loading and browser printing

The iPad screenshot's `undefined is not a function (near '...t of e...')`
matches PDF.js `getTextContent()` iterating a ReadableStream. Some shipping
Safari versions provide `getReader()` but no stream async iterator. The real
renderer regression test reproduced this failure with that capability removed;
it passes after consuming `streamTextContent()` with an explicit reader. All
pages and their accessible text are retained, without changing the PDF library
or adding global browser polyfills.

On an Apple Home Screen app, Print now opens a separate HTML browser print page.
The user taps Print there after the page images have decoded. This avoids relying
on `window.print()` in the Home Screen container and avoids navigating into a
bare PDF viewer. Regular browsers keep the direct synchronous Print call. If no
`beforeprint` event arrives, an explicit browser-page link is offered; absence of
that event is not treated as proof that printing failed or succeeded. Share PDF
remains separate, and the original app and unsaved entries stay mounted.

The browser page carries only a validated document kind, date, route and saved
revision. Both PDF endpoints authenticate normally, expose their selected
revision in a response header, and can read that exact historical revision. A
missing revision fails rather than silently changing to the latest plan. No
access tokens, cookies, PDF bytes or business writes are used for this handoff.
Safari may use a separate sign-in session from a Home Screen app; in that case
the page retains Retry and a link to open FenMeat in that browser. The app cannot
force iOS to show AirPrint or select a printer. If iOS keeps the new page in a
nonprinting container, it must be opened in Safari.

Validation: regression without stream async iteration; real PDF pages/text;
synchronous normal printing; Home Screen link dispatch; silent no-op guidance;
no automatic sharing; close/cancel/retry and unsaved-input preservation; separate
page history; document-selector validation; authenticated revision-pinned PDF
reads without writes; real Worker asset routing. All 258 Node/workerd tests and
the Worker deployment dry-run passed. Physical iPhone/iPad Safari and
AirPrint, including the OS's handling of a new browser page, remain unverified.
There is no schema migration. Rollback uses the preceding application version.

## Original preview implementation (0.23.2)

Opening a PDF directly could trap an installed iPhone app in a native viewer
without Print, Share or Back controls. Sales stock sheets and Production staff
sheets now open an in-app preview with persistent Back to app, Print and Share
PDF buttons. The app DOM and unsaved entries remain mounted beneath the preview.

The preview fetches the existing authenticated, read-only PDF endpoint and
renders every page using pinned, self-hosted PDF.js and local fonts. Print is
enabled only after every page image has decoded and the print layout is mounted.
Both native Print and file sharing are invoked synchronously from a separate user
tap, preserving transient activation. Share receives the original PDF bytes.
There is no automatic PDF navigation, third-party viewer or CDN. The existing
Content Security Policy is unchanged; rendering uses font paths without eval.

Back, browser Back and Escape close the preview, cancel pending work and restore
focus without rerendering the app or saving business data. Failed loading offers
Retry with Back always available. Cancelling print or sharing keeps the preview
open. Browsers without file sharing can still print. Only the saved document is
included; unsaved changes are explicitly identified as excluded.

Validation covers real PDF rendering with local fonts, a simulated DOM with
actual page-image decoding, synchronous print/share calls, cancellation, retry,
failed reads, unsupported sharing, multi-page output and preservation of unsaved
entries. Existing authenticated PDF endpoint and business-model tests also run.
The simulated DOM does not reproduce an actual iPhone or its native print/share
sheet. Physical iPhone acceptance remains a device check.

PDF.js and font license files are copied alongside the renderer during the build.
Generated renderer assets are not checked into source control.
