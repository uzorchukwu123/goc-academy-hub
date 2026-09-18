# Phase 3 — Completion notes

Closes out `PHASE3-PROGRESS-AND-REMAINING.txt`. Read that first for the
accessibility/contrast/reduced-motion work that was already done before
this session — this document only covers what was still open.

## Responsive QA

No real browser or screenshot tool is available in this environment, so
this was a static-analysis pass, not a visual one — worth a real-device
spot-check before calling it fully closed, same caveat the contrast pass
already carries.

**Found and fixed:** the landing-page footer's three link columns
(`.lp-qcols` — Explore / Get started / Legal) had no small-screen
override anywhere in the file, unlike every other multi-column section on
the page. At 320-360px that's ~80px per column, wrapping labels like
"Updates & News" and "UTME Bootcamp" onto three or four lines each. Added
a `max-width:480px` rule (the breakpoint already used elsewhere in the
file) stacking it to one column, matching how the rest of the page
already behaves at that width.

**Checked, no change needed:**
- The main app's content column already caps at `max-width:980px` (900px+)
  and `1060px` (1280px+), fluid below that — this is what keeps 1440px and
  1920px from stretching content edge-to-edge; nothing hardcodes a wider
  fixed width anywhere.
- Every other `max-width` value in the file is a cap, not a fixed `width`,
  so nothing else forces overflow below 320px.
- The remaining `repeat(3,1fr)` / `repeat(4,1fr)` grids (`.adm-kpis`,
  `.gate-pad`, `.badges`, `.lp-stats`) all hold short numeric/icon content,
  not link-length text — lower risk than `.lp-qcols` was, and `.adm-kpis`
  specifically is already visible working cleanly at real phone width in
  a screenshot from this project's own chat history.
- `--gray` vs `--card` (the one open flag from the contrast notes): still
  unconfirmed as a real occurrence, unchanged from before this session.

## iOS / Android install path

There was no install-prompt UI at all before this session, for either
platform — confirmed by the previous session's notes and re-confirmed by
reading `index.html`/`js/app.js` directly. This was new UI, not a fix.
Built as a permanent, non-intrusive entry in the Profile screen's Settings
list ("Install this app") rather than a banner, so it doesn't nag on every
visit and doesn't need any dismissal state — nothing to store, no
`localStorage` (the codebase's own stated convention: state is in-memory
only).

- **Android/Chrome**: `beforeinstallprompt` is captured at the top level of
  `js/app.js` (must happen early, or the browser's own infobar takes over
  and the event can't be re-triggered for that page load) and deferred.
  The Profile row shows an "Install" button that fires the deferred
  prompt on tap.
- **iOS Safari**: has no such event at all. Detected separately by user
  agent; the row shows a "How to install" toggle that reveals the manual
  Share → Add to Home Screen steps inline, including the caveat that this
  only works from Safari itself, not an in-app browser (Instagram/WhatsApp
  webviews hide the option entirely).
- **Already installed**: detected via `display-mode: standalone` /
  `navigator.standalone`, shows a plain "Installed" chip, no action.
- **Neither applies** (desktop browser with no install support, e.g.
  Firefox): shows "Not offered by this browser" — honest rather than a
  dead button.

## sw.js version bump

Bumped last, per the roadmap's own instruction, after every other Phase 3
file change had landed: `goc-v29` → `goc-v30`.

Full suite re-verified 15/15 green after all of the above (same
network-less busboy-stub trick as every prior session; stub created,
`node test/run.js` run, deleted immediately after — never shipped in the
zip).

## Phase 3 status: DONE
