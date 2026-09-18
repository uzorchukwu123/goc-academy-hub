# Resource viewer — full-height gap fix + CSS polish (js/app.js, css/styles.css)

Bug fix + visual polish, not a Phase 3 roadmap item — same category as the
earlier pdf.js / zoom-fullscreen fixes, so it gets its own cache bump.

## What was wrong

`openResourceMediaViewer`'s overlay used `position:fixed;inset:0` with no
explicit `height`. On some Android/Chrome builds that leaves the overlay
sized to a stale layout viewport instead of the actual visible area once the
address bar has settled, so the image/PDF/video stage rendered short and a
band of dead space was left at the bottom, above the zoom controls.

`.phone` already solves this exact problem elsewhere in the app with
`height:100dvh` (see `css/styles.css`) — the viewer overlay just never got
the same treatment.

## What changed

- **`overlay.style.cssText`** now sets `height:100vh;height:100dvh;` — the
  second declaration wins in browsers that understand `dvh` (dynamic
  viewport height, toolbar-aware) and is silently ignored (leaving `100vh`)
  in ones that don't.
- **Belt-and-braces:** a `window.visualViewport` listener (`resize`) plus an
  `orientationchange` listener pin `overlay.style.height` to the actual
  visible viewport height in px, for the handful of older/quirky WebViews
  where `dvh` isn't fully reliable. Both listeners are removed in
  `closeViewer()` so nothing leaks after the overlay is dismissed.
- **CSS polish, additive only:** the JS now also stamps class names
  (`goc-viewer`, `goc-viewer-header`, `goc-viewer-btn`, `goc-zoom-bar`,
  `goc-zoom-btn`, `goc-pager-btn`, `goc-viewer-dl`, `goc-viewer-stage`,
  `goc-viewer-title`) onto elements that already carry their real inline
  layout styles. `css/styles.css` only adds hover/press feedback, a subtle
  shadow on the zoom bar, disabled-state opacity for the pager, and a calm
  `prefers-reduced-motion`-gated fade-in — no inline style, ID, or existing
  class was touched, so the layout math (`flex:1`, `min-height:0`, etc.)
  that actually makes the stage fill the space is unchanged.
- **Resources tab (`#resList .rcard`)** got the same treatment: a hover
  lift + shadow (guarded with `@media (hover:hover)` so it never sticks on
  touch), a filter-chip hover state, and a light staggered fade-in on
  render, all reduced-motion-gated the same way `.screen.active` already
  is.

## Cache version

`sw.js`: `goc-v21` → `goc-v22`. No new asset paths — only existing cached
files (`css/styles.css`, `js/app.js`) changed content.

## Verification

`node test/run.js` — same 13/15 as before this change (`test-server.js` /
`test-security.js` fail only for the pre-existing offline/no-busboy reason,
unrelated). No test in `test/` touches the viewer or the resources render
path, so this was also checked with `node -c js/app.js` for a plain syntax
sanity check.
