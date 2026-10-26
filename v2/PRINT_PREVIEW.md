# Print preview controls (0.23.2)

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
