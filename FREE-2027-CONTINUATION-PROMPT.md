# Continuation prompt — 2027 Free Tutorial Edition

Paste everything between the lines below as the opening message to the next agent.

---

You are finishing a nearly-complete feature in the repository at
`/home/user/goc-academy-hub`, on the **existing** branch
`arena/492657f1-goc-academy-hub`. Do not create another branch and do not rename
this one. There is already an **open** PR for it:

    https://github.com/uzorchukwu123/goc-academy-hub/pull/8
    title: "Implement 2027 Free Tutorial Edition"   (base: main)  — KEEP IT OPEN, never merge it.

The previous agent implemented the whole feature and left an honest handover in
`FREE-2027-REMAINING.md` at the repo root, plus the same content in the PR body.
Read that file first; this message is the working plan that goes with it.

## What the feature is (do not change its design)

A temporary, switchable **2027 Free Tutorial Edition** of the G.O.C Academy Hub:
Original Mode (the whole existing app) versus 2027 Free Tutorial Mode (a homepage
plus a CBT Portal with Weekly Assessments, Competitions and a Competition
Leaderboard only). One class on `<body>` (`f27-mode`) plus `css/free2027.css`
does the hiding — nothing is deleted, so Original Mode restores the hub exactly.
Students register with name/email/course + email OTP (no passwords); the CBT
engine, question bank and marking are the hub's own; competition leaderboards are
public only after admin approve **and** publish, top 10 only, everyone else sees
their own rank privately; sessions archive to JSON files under
`$GOC_DATA_DIR/free2027-archives/`; the admin entrance is five quick clicks on the
"4 Science subjects" card.

Hard constraints, from the original request — keep every one:
adapt, don't rebuild; smallest reliable changes; hide, never delete; never touch
or overwrite original G.O.C records or core data; no manager roles/permissions for
this programme; server-side authorisation on every route; mobile compatible;
reversible via the console's mode switch.

## Where it stands (verified, do not re-litigate)

- `node test/test-free2027.js` → 42 checks, **passes** (rules module).
- `node test/test-free2027-route.js` → 110 checks, **passes** (server end to end).
- `node test/test-free2027-ui.js` → 61 checks, **passes** (page, hand-rolled DOM).
- `node test/run.js` (== `npm test`) → **entire repository suite passes**; the
  rules and route suites are wired in, the UI suite is deliberately not yet.
- `node build/build.js /tmp/distcheck` → clean, 1,676,860 → 1,031,908 bytes.
- Working tree is committed and pushed; PR #8 is open and green.

## Your job, in order

**1. Close the one real behaviour gap — the hidden entrance.**
In the edition, five quick clicks are counted correctly but the administrator
sign-in never opens. Cause: `revealAdminGate()` in `js/free2027-ui.js` (~line 685)
still guards on `#landing` being the active screen, while the edition puts the
visitor on `#free-home`. The guard was right for the original landing page and
wrong for the edition. Fix it as a guard on the mode only — the card only exists
on the landing page, so the screen check adds nothing:

```js
function revealAdminGate() {
  if (!F.on || F.mode !== rules.MODE_FREE) return;
  global.go('free-admin');
  var note = $('freeAdminNote');
  if (note) note.textContent = 'The console keeps its own passcode. Attempts are limited and logged.';
}
```

Then restore the real assertion in `test/test-free2027-ui.js` (the gate block
around line 264; there is a `KNOWN GAP` comment to replace):

```js
ok('the fifth click reveals the administrator sign-in',
   w.calls.go.indexOf('free-admin') > -1, w.calls.go.join(','));
```

and add two assertions while you are in there: (a) a click sequence that is
interrupted by a pause longer than `GATE_WINDOW_MS` (2500 ms) never opens it —
the counter assertions for that already exist and pass, keep them; (b) in
**Original Mode** the gate never opens (`F.on` is false). Delete the now-unused
`KNOWN GAP` comment. Verify `hookGo()` still lets `free-admin` through — it is in
the allowed list.

**2. Wire the UI suite in.** In `test/run.js`, append `'test-free2027-ui.js'` to
the end of the `suites` array and delete the comment block there that says it is
not listed yet. Then run `node test/run.js` and confirm the whole thing is green.

**3. One manual pass in a real browser.** Nothing in this branch has ever been
clicked by a human. Start the app with the switch on (copy the repo to /tmp, or
use `GOC_DATA_DIR` pointing at a temp folder — never let a test run write
`server/data.json` into the repo):

```
GOC_FREE_2027=1 GOC_FREE_2027_DEV_OTP=1 GOC_DATA_DIR=/tmp/f27data PORT=8231 node server/server.js
```

Development OTP only appears when `NODE_ENV !== 'production'` and
`GOC_FREE_2027_DEV_OTP=1`. Walk: homepage → register → code on screen → CBT
Portal → sit a weekly paper → interrupt and resume (answers and the **server's**
remaining time must survive) → submit → competition leaderboard. Then check the
console: the "2027 Free Tutorial" tile appears once (it is injected by wrapping
`admMenuApply`, not via `ADM_TILE_META` — do not "fix" that, `SECTIONS = 27` and
the capability map depend on it), all seven tabs load, and the mode round trip
(switch to the edition with `{stay:true}`, switch back) leaves the hub exactly as
it was. Check 360 px width on the edition's six screens.

**4. Confirm archiving once against a real folder.** `POST
/api/free2027/admin/sessions/new` with `{label, confirm:true}` must write
`<GOC_DATA_DIR>/free2027-archives/free2027-archive-<session>.json` (temp file +
rename) and the new session must start empty. The route suite proves this against
a temp folder; check the real one and read it back through the console.

**5. Update the documentation, then finish.** Empty the list in
`FREE-2027-REMAINING.md` — when every item is done and the suites are green,
**delete the file** and say so in a PR comment (it is branch scaffolding, not
product). Add a short section to `DEPLOYMENT.md` covering `GOC_FREE_2027`,
`GOC_FREE_2027_DEV_OTP`, `GOC_DATA_DIR`, the `free2027-archives/` folder (and
that temporary deployment storage is not permanent, so archives must be copied
off the box), and the hard requirement of an SMTP sender in production — without
one, registration stops at the code step. Commit to `arena/492657f1-goc-academy-hub`,
push to that branch only, and comment on PR #8 with what you verified. **Do not
merge PR #8 and do not close it.**

## Traps that cost the previous agent time — believe these

- Free-tutorial route handlers must read `req.free2027.data`, **not** `sess.data`:
  the dispatcher sets `sess` to null for free participant tokens.
- `require('./server/server.js')` in a scratch script starts the real server and
  writes `server/data.json` into the repo. Always run from a temp copy or set
  `GOC_DATA_DIR`.
- `test/test-build.js` failed with "server did not start" until
  `js/goc-free-2027.js` was copied beside `server/` in its sandbox, exactly like
  `js/goc-core.js`. That is a test-fixture need, not a product bug.
- Attempt tests must pass an explicit clock: `openAttempt(list, now)` — a
  hard-coded past `startedAt` is "expired" against the real clock.
- `publicLeaderboard` correctly requires published **and** approved **and**
  `status === 'published'`; building test objects with `Object.assign` over an
  already-published activity makes those checks vacuous. Build fresh objects.
- Never add the panel to `ADM_TILE_META`/`CONSOLE_SECTIONS`: `test-console-menu.js`
  pins `SECTIONS = 27`.
- Pinned counts you may need to bump **deliberately, and only if a change really
  requires it**: `CONSOLE_ROUTES = 110 + 20` in `test/test-roles-session.js`,
  `SECTIONS = 27`, and `sw.js` `CACHE='goc-v186'` (bump it whenever you add or
  rename an asset the service worker caches).
- `test/test-free2027-ui.js` uses a hand-rolled DOM and a **stub** `GOC.free` for
  the screen tests, and drives the real `js/free2027-api.js` against a stubbed
  `fetch` in its last section. Keep that split; do not try to load both.
- The suite's `settle()` awaits `GOC.freeUI.ready()` (the boot promise the UI
  exposes). Do not replace it with a sleep — that is what made the mode look
  like it never settled.

## Definition of done

`node test/test-free2027.js`, `node test/test-free2027-route.js`,
`node test/test-free2027-ui.js` and `node test/run.js` all green;
`node build/build.js /tmp/distcheck` clean; the gate opens on the fifth click in
the edition and never opens in Original Mode or after a pause; the manual browser
pass done; `FREE-2027-REMAINING.md` deleted with `DEPLOYMENT.md` updated; PR #8
still **open** with a comment listing what was verified, and its link reported
back to the user.
