# Resource viewer — real fix for the leftover gray space (js/app.js, sw.js)

The previous fix (v21→v22, see the original notes file) addressed a real but
different problem — the overlay being sized to a stale viewport height — and
that part is fine. It did not fix what's actually causing the gray band the
user is seeing, because that's a separate bug in the PDF branch.

## Root cause (confirmed by rendering the real `openResourceMediaViewer`
## output in a browser, not just reading the code)

For PDF-kind resources (which is what "GOC weekly timetable template" is),
the canvas wrapper's inline style was:

```
#gocPdfCanvasWrap { flex:1; min-height:0; overflow:auto; display:flex;
                     justify-content:center; padding:14px 0; }
```

`align-items` was never set, so it defaulted to `stretch`. The `<canvas>`
inside always gets an **explicit** `style.width/height` from `renderPage()`,
so stretch can't actually stretch it — but an unstretched item under
`align-items:stretch` is positioned at the **start** of the cross axis, not
the center. Visually: the canvas sits right under the 14px top padding, and
everything below it down to the bottom of the viewer is dead space — exactly
the gray band in the screenshots, present whether or not full screen is on,
because it has nothing to do with full screen at all.

Verified in a headless-Chromium repro of the exact markup: canvas landed at
y≈72–272 in a 58–780 wrap (top-pinned) before the fix, and y≈319–519 (dead
center) after adding `align-items:center`.

The image and video branches already had `align-items:center` on their
stage divs, which is why only PDFs showed the problem.

## What changed

- **`js/app.js`** — added `align-items:center` to `#gocPdfCanvasWrap`'s
  inline style. One-line fix, no layout math elsewhere touched.
- **`js/app.js`** — `onFsChange()` now also calls `syncViewerHeight()`.
  This is a defensive addition on top of the real fix: entering/exiting full
  screen changes how much of the physical screen is available (address bar
  hides/reappears), so the px height captured before the transition can be
  stale; re-measuring after the transition keeps the overlay's height
  accurate in both directions instead of relying only on the resize
  listener to catch up.
- **`sw.js`**: `goc-v22` → `goc-v23`, since `js/app.js` content changed.

## Verification

- `node -c js/app.js` — syntax OK.
- Reproduced the bug and the fix directly by loading the real `index.html`
  + `js/app.js` in headless Chromium and calling `openResourceMediaViewer`
  with a synthetic image and, separately, building the exact PDF-wrap markup
  from the current source and rendering it — confirmed centered before/after
  in both cases post-fix.
- `node test/run.js` not re-run in this pass (network-restricted sandbox,
  no `node_modules`); no test in `test/` touches the viewer render path per
  the original notes, so this is a pure targeted fix.
