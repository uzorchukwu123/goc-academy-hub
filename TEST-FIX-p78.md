# test-p78.js — fix report

## 1. Which test was fixed
`test/test-p78.js` (Priority 7 — closing a student account without losing
its record — and Priority 8 — only the Founder may change management
credentials), driven through the real console inside minidom.

## 2. Why it was failing
The suite hard-coded four account IDs that no longer exist: `GOC-A-001` /
`GOC-A-002` (staff — these two *are* still seeded, so those references were
fine) and `GOC-S-002` / `GOC-S-003` (students — these are not seeded any
more). The very first call, `api('login')('GOC-S-002', 'bello#88')`, threw
immediately because no such student had ever been registered, crashing the
whole suite before a single assertion ran. Deeper in, section 7 also
expected a roster of exactly ten students (`everyone === 10`) and a
deactivated student with `xp > 0` and at least one result on file — all
demo-data assumptions from when the app shipped with a seeded roster.

## 3. Obsolete demo assumption or genuine bug?
**Obsolete demo assumption**, not a production bug — the same pattern
already documented for `test-p3.js` and `test-p4.js`. The project now
starts with zero students, so every account and every sitting the console
pages through has to come from the real sign-up and test-taking APIs. The
two staff accounts (Founder, Academic Director) are still seeded in
`server/data.json`, so `GOC-A-001` / `GOC-A-002` and their original
passwords needed no change.

## 4. What files were changed
- `test/test-p78.js` only. No production code (`js/`, `server/`) was
  touched.

## 5. What exactly was changed
- Added a `registerStudent(name, pw)` helper (same shape as the one already
  used in `test-p3.js`) that calls `GOC.api.createStudent` with the public
  sign-up code and hands back the Scholar ID the driver actually assigned.
- Registered ten real students through that helper before the console
  section runs, so "every scholar has a card" / `Everyone (10)` reflects a
  genuine roster instead of an assumed one.
- The first two registered students keep the original test's passwords
  (`bello#88` and `nwosu2026`) and are captured as `MINE` and `SID` by their
  real, driver-assigned IDs rather than the old hard-coded `GOC-S-002` /
  `GOC-S-003`.
- Both `MINE` and `SID` now sit and submit a real objective Physics paper
  through `GOC.api.startTest` / `GOC.api.submitTest` before the console
  section begins. `MINE`'s sitting is what the original test already built;
  `SID`'s is new — it's required because section 7 asserts the deactivated
  account's `xp > 0` and that it has a result on file, which only holds if
  `SID` has sat something first.
- `FOUNDER`, `DIRECTOR`, and `PASS` are untouched — those accounts and that
  passcode are still seeded in `server/data.json` and matched the test as
  written.
- No assertion text, no expected values, and no admin-facing behavior were
  changed — only the data the test seeds before checking that behavior.

## 6. How the fix supports real students
Every ID on the roster the console exercises — the ten students, the two
staff accounts, the closed-and-reopened account's XP and results — now
comes from the same registration and test-taking APIs a real scholar or
Founder would use. The assertions verify that closing an account preserves
exactly what is genuinely on file, and that credential changes are enforced
against real, driver-assigned accounts, not an assumed demo set.

## 7. Tests run after the fix
- `node test/test-p78.js` (the fixed suite, in isolation)
- The other suites, run individually to check for regressions:
  `test-rules.js`, `test-p1.js`, `test-p2.js`, `test-p6.js`, `test-p3.js`,
  `test-p4.js`, `test-driver-parity.js`, `test-launch.js`, `test-math.js`
- `test-server.js` and `test-security.js` could not be run for real in this
  sandbox (no network access here, so `npm install` could not fetch
  `node_modules`); they fail at `require(...)` before any assertion runs,
  which is an environment limitation, not a regression — the prior
  session's report notes these two need `npm install` to run at all.
- `test-p9.js`, `test-p10.js`, and `test-study.js` were run to confirm they
  still fail exactly as before (untouched, next in the queue).

## 8. Test results
- `test-p78.js`: **124 passed, 0 failed** (was crashing before the fix).
- All other runnable suites: green, with their pre-existing pass counts
  unchanged (e.g. `test-p3.js` 240/0, `test-p4.js` 338/0,
  `test-driver-parity.js` 8/0). No regressions.
- `test-p9.js`, `test-p10.js`, `test-study.js` still fail, as expected —
  they are next in the queue and have not been touched.
- `test-server.js`, `test-security.js`: not verified in this sandbox (no
  network access to install dependencies); unchanged from the prior report.

## 9. What remains to be fixed
- `test-p9.js`
- `test-p10.js`
- `test-study.js`

Per the prior session's status notes, these are expected to need the same
treatment: replace hardcoded demo student IDs/passwords with real students
registered through `GOC.api.createStudent`, capturing the Scholar ID the
driver actually assigns. `test-p10.js`'s inline mock arrays that feed
UI-rendering functions directly (league tables, etc.) are a separate matter
and were noted as not needing to change.

## 10. The next test to address
`test-p9.js`, per the required sequence — **not started**. Waiting for
instruction to continue.
