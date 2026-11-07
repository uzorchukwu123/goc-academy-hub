# Correction — original student registration and login restored

Branch: `arena/577ff09f-goc-academy-hub` · Pull request: **[#10](https://github.com/uzorchukwu123/goc-academy-hub/pull/10)**

Status: **open for owner review. Not merged. Not deployed.**

## What I got wrong

The instruction was to remove the homepage **"Start Free UTME Bootcamp"** CTA and
add a direct **CBT Portal** button. I went further than that and disconnected the
original student account experience. Specifically:

| Change I made | Commit | Effect |
|---|---|---|
| Introduced `F.freeAccountEntry()` and pointed **"I already have an account"** at it | `f9310b0` | In Free Tutorial Mode it opened the edition's OTP screen (`free-register`) instead of the **original** `login-v2`. The original login was rerouted. |
| Added `body.f27-mode #landing .hero-btns .hero-original-cta { display: none !important; }` | `f9310b0` | **Hid** the original hero sign-up action in Free Tutorial Mode. |
| Added `body.f27-mode .dw-btns .dw-original` and `body.f27-mode #landing .lp-actions .dw-original { display: none !important; }` | `b131972` | **Hid** the original drawer "Create free account" / "Log in" and the nav "Log in" / "Get started" in Free Tutorial Mode. |

There was also a pre-existing blocker that would have defeated the restored
buttons: the edition's `hookGo()` allowlist rewrote any non-edition destination to
`free-home`, and `css/free2027.css` hid every non-edition `.screen`. So `signup`,
`login-v2`, `signup-pending` and the post-login `home` dashboard could not be
reached in Free Tutorial Mode even when linked.

None of this was requested. Direct CBT access does not require removing accounts.

## How it was restored

The original implementation was **not rewritten, replaced or reimplemented**.
`js/app.js`, `js/api.js`, `server/server.js`, the auth routes, the session
handling, the student roster and the account data structures are **byte-for-byte
untouched** by this correction. Only the edition's interference was removed.

1. **`index.html`** — "I already have an account" is back to its original
   `onclick="go('login-v2')"`. "Get started" keeps the original `go('signup')`.
   The nav and drawer account buttons were never deleted and are unchanged.
2. **`css/free2027.css`** — deleted all three rules that hid `.dw-original` and
   `.hero-original-cta`. Added the original account screens (`login-v2`, `signup`,
   `signup-pending`, `change-password`) and the signed-in student's own screens
   (`home`, `profile`, `results`, `study`, `practice`, `cbt`, …) to the show-list so
   they render in Free Tutorial Mode. While one of those student screens is open,
   `body.goc-original-area` restores the hub's own tab bar / sidebar.
3. **`js/free2027-ui.js`** — removed `F.freeAccountEntry` entirely (the homepage
   now calls the original route directly). `hookGo()` allows the original account
   screens through instead of rewriting them to `free-home`, and toggles
   `goc-original-area`. The edition's own guest CBT card uses its pre-existing
   `freeHomeCta()`, not an account reroute.
4. **`sw.js` / `DEPLOY-CHECKLIST.md`** — cache bumped to `goc-v196` so returning
   visitors actually receive the corrected homepage.

### The only homepage CTA change that remains

- **Removed:** "Start Free UTME Bootcamp" (`grep -ci` → `0`).
- **Added:** "CBT Portal", going directly into the existing CBT Portal.
- **Kept, visible and working in every mode:** "Get started" (original sign-up)
  and "I already have an account" (original login), plus the original nav and
  drawer account actions.

## Verification

| Gate | Result |
|------|--------|
| `npm test` | **exit 0 — 198 suites, 0 failed** |
| `npm run build` | **exit 0** |
| `git diff --check` | clean |
| Real-browser harness | **169/169 checks, exit 0, 0 uncaught JS errors** |

The browser harness now drives the **real original forms** end to end in Free
Tutorial Mode, and all of these passed:

- "Get started" opens the original `signup` screen, actually rendered, with the
  original fields and validation (`signName`, `signEmail`, `signPhone`, `signGoal`,
  `signPw`, `signConsent`, `subjGrid`).
- A new student registers through the **existing** implementation and receives a
  Scholar ID via the existing pending/approval flow; the record is persisted.
- The existing approval call activates the account.
- "I already have an account" opens the original `login-v2` (no edition reroute).
- The registered student **logs in** and reaches the original `home` dashboard,
  which is visible, with the hub's navigation chrome restored.
- The student can open their existing profile; the Scholar ID persists unchanged.
- The homepage is reachable afterwards, Free Tutorial Mode is still active, the
  **CBT Portal still opens directly**, and the bootcamp CTA has not returned.

All previously fixed PR #10 behaviour was re-verified in the same run: activity
deletion preserving attempts/answers/scores/results, activity history tombstones,
question-bank history, individual/bulk/delete-all deletion, bank separation,
weekly accumulation, the editor input-loss fix, CBT Back/Home, Website Mode
Control, Founder authentication and the console.

### Tests changed, and why

No test was removed or weakened. Three groups of assertions **encoded the
unauthorised behaviour** and now assert the opposite, more strongly:

- `test-free2027-nav.js` previously required the CSS that hid the original drawer
  and nav actions. It now requires that **no rule hides them**, in any mode.
- `test-free2027-ui.js` previously required the mode-branching account reroute. It
  now proves `signup`, `login-v2`, `signup-pending`, `home` and `profile` are all
  reachable in **both** modes, that the chrome is restored, and that the reroute
  no longer exists.
- `test/browser/free2027-recovery.js` previously asserted the original actions
  were hidden in Free mode. It now asserts they are visible **together with** the
  CBT Portal, and adds the full registration/login flow above.

One unrelated fragile assertion was made precise: `test-free2027-route.js` scanned
the raw audit JSON for the four-digit passcode `2027`, which also matched harmless
epoch-millisecond timestamps (e.g. `1793952027000`) and failed intermittently on a
clean audit trail. It now checks every text field of every entry and separately
asserts each timestamp is a number — strictly stronger, with no false positive.

## Limitations

- Browser verification is **emulation** (headless Chromium 131, Android 390×844
  and desktop 1366×900). **No physical device was tested.**
- Registration/login were exercised against the **local JSON store**, not a live
  Appwrite instance. No account data structure was changed.
- SMTP used the repository's isolated capture adapter, not a live relay.
- The **Vercel check failure is pre-existing** — identical on `main` and every
  earlier head of this branch.

## Handoff

Committed and pushed to the existing PR #10 branch. **The PR remains open. Nothing
was merged, nothing was deployed, no force-push and no reset were used.** No
student record, Student ID, credential, attempt, result, question bank, activity,
Appwrite structure or local data file was deleted, reset or migrated.
