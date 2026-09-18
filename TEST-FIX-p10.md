# test-p10.js — fix report

## 1. Which test was fixed
`test/test-p10.js` (Priorities 10, 11, 12 — the Scholar League screen: the
podium, the standings table, the student's own standing card, and the rule
that the screen never re-orders what the data layer hands it), driven
through the real console inside minidom.

## 2. Why it was failing
Two independent problems, both hit before any fix:

- **Crash.** The last section of the suite — "the demo driver's league obeys
  the same rule" — logged in with a hard-coded account,
  `GOC.api.login("GOC-S-001", "amara2027!")`, that no longer exists. Same
  demo-data assumption already documented for `test-p3.js`, `test-p4.js`,
  `test-p78.js` and `test-p9.js`: the mock driver now starts with zero
  students, so this threw immediately and took the rest of that section
  down with it.
- **A stale assertion, found while fixing the above.** Independently of the
  crash, `js/app.js contains no .sort( call anywhere` was already failing.
  It isn't a league bug: `js/app.js` gained a legitimate, unrelated
  `sortDayBlocks()` function for the weekly class-schedule feature, which
  sorts a day's own blocks by time and has nothing to do with league
  ordering. The assertion's own comment says the intent is narrower than
  what it checks: *"If a sort ever appears in js/app.js the league can
  disagree with the server"* — i.e. it only ever meant to guard the league
  rendering path, but it was written as a whole-file string search, so an
  unrelated feature added later tripped it.

## 3. Obsolete demo assumption or genuine bug?
Both fixes are **obsolete-assumption / stale-test**, not production bugs:
- The login crash is the same obsolete demo-data assumption as the other
  fixed suites.
- The `.sort(` assertion was checking more than its own stated intent ever
  meant to cover. `renderLeague`, `paintLeague` and `paintMyStanding` — the
  entire league rendering path — still contain no sort of any kind; the
  match was coming from `sortDayBlocks()`, a different screen's local
  concern (ordering one day's timetable blocks by time), not a case of the
  league disagreeing with the server.

## 4. What files were changed
- `test/test-p10.js` only. No production code (`js/`, `server/`) was
  touched — `sortDayBlocks()` is legitimate and was left exactly as it was.

## 5. What exactly was changed
- Added a `registerStudent(name, pw)` helper (same shape as the one already
  used in `test-p3.js`, `test-p9.js` and `test-p78.js`) that calls
  `GOC.api.createStudent` with the public sign-up code and hands back the
  Scholar ID the driver actually assigned.
- In "the demo driver's league obeys the same rule": registered **two**
  students (the league needs more than one row to prove ordering) — the
  first becomes the signed-in scholar, using the same password the test
  always used (`amara2027!`); the second exists only so the league is not
  a league of one. Every assertion that used to check the ID literally
  (`'GOC-S-001'`) now checks it against the ID the driver assigned.
- Narrowed `js/app.js contains no .sort( call anywhere` to
  `the league rendering path contains no .sort( call anywhere`: the
  source is sliced from `function renderLeague()` up to the start of the
  unrelated CBT section that follows it in the file, so the check still
  guards exactly what its own comment says it guards, without being
  tripped by a legitimate sort somewhere else in the same file. Added one
  companion assertion confirming that slice genuinely contains
  `paintMyStanding` (so the check can't silently pass by matching nothing).
- No assertion's meaning was weakened — the league-ordering guarantee is
  checked exactly as before, just scoped to the code that could actually
  violate it.

## 6. How the fix supports real students
The podium, the standings table, and the student's own standing card are
now all exercised against students created through the same sign-up API a
real scholar would use, with Scholar IDs the driver assigned rather than
one assumed to exist. The guarantee that the league screen never
re-sorts server data is still enforced at full strength for the actual
league code — it's now just immune to unrelated screens gaining their own,
legitimate, local sorting.

## 7. Tests run after the fix
- `node test/test-p10.js` (the fixed suite, in isolation)
- The other suites, run individually to check for regressions:
  `test-rules.js`, `test-p1.js`, `test-p2.js`, `test-p6.js`, `test-p3.js`,
  `test-p4.js`, `test-p78.js`, `test-p9.js`, `test-driver-parity.js`,
  `test-launch.js`, `test-math.js`
- `test-server.js` and `test-security.js` could not be run for real in this
  sandbox (no network access here, so `npm install` could not fetch
  `node_modules`); they fail at `require(...)` before any assertion runs,
  which is an environment limitation, not a regression — unchanged from the
  prior sessions' reports.
- `test-study.js` was run to confirm it still fails exactly as before
  (untouched, next in the queue).

## 8. Test results
- `test-p10.js`: **76 passed, 0 failed** (was crashing before the fix, with
  one additional pre-existing failure on top of the crash).
- All other runnable suites: green, with their pre-existing pass counts
  unchanged (`test-rules.js` 293/0, `test-p1.js` 78/0, `test-p2.js` 31/0,
  `test-p6.js` 70/0, `test-p3.js` 240/0, `test-p4.js` 338/0, `test-p78.js`
  124/0, `test-p9.js` 109/0, `test-driver-parity.js` 8/0, `test-launch.js`
  48/0, `test-math.js` 162/0). No regressions.
- `test-study.js` still fails, as expected — it is next in the queue and
  has not been touched.
- `test-server.js`, `test-security.js`: not verified in this sandbox (no
  network access to install dependencies); unchanged from the prior
  report.

## 9. What remains to be fixed
- `test-study.js`

Per the prior sessions' status notes, this is expected to need the same
treatment: replace hardcoded demo student IDs/passwords with real students
registered through `GOC.api.createStudent`, capturing the Scholar ID the
driver actually assigns. Worth checking, while there, for any other
whole-file-scoped assertions (like the `.sort(` one here) that might have
been overtaken by legitimate features added elsewhere in `js/app.js` since
they were written.

## 10. The next test to address
`test-study.js`, per the required sequence — **not started**. Waiting for
instruction to continue.
