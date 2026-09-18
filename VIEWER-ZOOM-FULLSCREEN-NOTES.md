# Resource viewer — full screen + zoom (js/app.js, `openResourceMediaViewer`)

Bug fix, not a Phase 3 roadmap item — same category as the earlier
pdf.js resources-viewer swap, so it gets its own cache bump rather than
waiting on the phase-3 batch.

## What was wrong

The overlay itself was already `position:fixed;inset:0` — genuinely
full-viewport, no gap. Two real problems underneath that:

1. No way to see the browser's own chrome (address bar / tab strip)
   out of the way — the viewer only ever fills the space the browser
   leaves it, never the whole physical screen.
2. `index.html`'s viewport meta sets `user-scalable=no,
   maximum-scale=1.0` app-wide, which also disables pinch-zoom inside
   the viewer overlay. Combined with the pdf.js canvas only ever
   rendering at fit-to-width, there was no way to enlarge a detail
   (small print, a diagram) past the normal view — for either PDFs or
   images.

## What changed

- **Full screen toggle** — a button in the viewer header
  (`\u26F6` / `\u2913`) calls `requestFullscreen()` on the overlay
  element. Only rendered when `document.documentElement.requestFullscreen`
  exists, so it's simply absent on iOS Safari (no Fullscreen API there
  for arbitrary elements). Has to be a direct click handler, not
  triggered automatically when the viewer opens — `getResourceFile()`
  resolves asynchronously, and browsers refuse `requestFullscreen()`
  once it's no longer inside the original user gesture. Exits
  fullscreen on close.
- **Zoom controls** — a "−  100%  +" control bottom-right, shown for
  `image` and `pdf` kinds (not `video`, which has its own native
  controls). Range 0.5×–4×, steps of ×1.25, tap "100%" to reset.
  - PDF: `zoomLevel` multiplies into the existing fit-to-width scale
    calculation in `renderPage()`; page re-renders on each zoom step.
  - Image: captures the fitted (100%) box size once via
    `frame.dataset.baseW/baseH`, then sets explicit pixel width/height
    scaled by `zoomLevel` (a CSS `transform: scale()` was considered
    and rejected — it doesn't grow the element's layout box, so the
    `overflow:auto` container wouldn't have picked up any new
    scrollable area).
  - Both cases switch the container's `justify-content`/`align-items`
    from `center` to `flex-start` once zoomed, so scrolling reaches
    every edge instead of overflowing symmetrically off both sides.

## Cache version

`sw.js`: `goc-v19` → `goc-v20`.

**Flag for whoever picks up Phase 3 next:** `PHASE3-CLOSEOUT-PLAN.txt`
had already earmarked `goc-v20` as the single bump to land *after*
the contrast pass (done, see `CONTRAST-AUDIT-NOTES.md`, still uncached
at v19) and the install-onboarding UI (not started) land together.
This fix just spent that version number. A second standalone bug fix
(admin resources UX, below) has since spent `goc-v21` too. When item 3
is done, that combined bump should go out as `goc-v22`, not `goc-v20`
— update the closeout plan's Item 4 section accordingly before doing
it.

## Verification

`node test/run.js` — same 13/15 as before this change (`test-server.js`
/ `test-security.js` fail only for the pre-existing offline/no-busboy
reason, unrelated to this fix).

---

# Admin console — resources UX gaps (js/app.js)

Two small fixes to the admin Resources tab, following up on the
resources-not-showing-up investigation. Not a data or publish-logic
bug — the drafts-until-published behavior was already correct — just
missing feedback.

## What changed

1. **Auto-refresh after upload** — `admUploadResource()` now calls
   `admLoadResources()` in its success handler. Previously the newly
   uploaded file didn't appear in "Uploaded resources" below until the
   admin switched tabs away and back, which looked like the upload had
   silently failed.
2. **Clearer empty-state messaging** — `admRenderResources()` now
   distinguishes "nothing has been uploaded at all" from "resources
   exist, just not for the subject currently selected." The latter
   case now names the other subjects and their counts (e.g. "3
   resources exist under other subjects — switch the subject above to
   view them: Chemistry (2), Physics (1)"), instead of a flat "No
   resources uploaded for Physics yet" that reads the same either way.
3. Tightened the post-upload status line to say the resource needs
   publishing before students see it, instead of just "saved as a
   draft" (true, but easy to skim past).

## Cache version

`sw.js`: `goc-v20` → `goc-v21`.

## Verification

`node test/run.js` — same 13/15 as before (see above).
