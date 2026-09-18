# test-study.js — fix report

## 1. Which test was fixed
`test/test-study.js` (Priorities 28, 29, 30 — self-directed study: the
practice run and the student's own CBT set-up, plus the rule that a
practice question travels with its answer while an examination question
never does), driven through the real console inside minidom.

## 2. Why it was failing
The same obsolete demo-data assumption already documented for
`test-p3.js`, `test-p4.js`, `test-p78.js`, `test-p9.js` and `test-p10.js`:
the suite opened with `GOC.api.login('GOC-S-001', 'amara2027!')` and later
`GOC.api.login('GOC-S-002', 'bello#88')`, two hard-coded Scholar IDs that
no longer exist. The mock driver now starts with zero students, so the
first login threw immediately (`That ID and password do not match.`) and
took the whole suite down with it — nothing past that point had ever run.

Staff accounts (`GOC-A-001`, the Founder) are not affected by this —
`server/data.json` still seeds two real staff records — so the
`FOUNDER` / `FPW` / `PASS` login used later in the suite was never the
problem.

## 3. Obsolete demo assumption or genuine bug?
**Obsolete-assumption / stale-test**, not a production bug — the same
class of issue as the five suites fixed before this one. Nothing in
`js/` or `server/` needed to change; the study-mode rules, the XP
arithmetic, the daily allowance, and the practice/CBT screens all worked
correctly once real students were behind the calls.

## 4. What files were changed
- `test/test-study.js` only. No production code (`js/`, `server/`) was
  touched.

## 5. What exactly was changed
- Added a `registerStudent(name, pw, subjects)` helper (same shape as the
  one already used in `test-p3.js`) that calls `GOC.api.createStudent`
  with the public sign-up code (`GOC-2027`) and hands back the Scholar ID
  the driver actually assigned.
- Added `MINE`, the subject combination the suite's comments already
  described but never actually built: `Use of English, Physics,
  Chemistry, Biology` — English plus three sciences, deliberately
  excluding Mathematics, which is what the "a paper outside her
  combination is refused" assertions depend on.
- `SID` (the student the whole suite runs as) is now assigned at the top
  of `main()` by registering a real student ("Amara Obi") with that
  combination and the same password the test always used
  (`amara2027!`), instead of being a literal `'GOC-S-001'`.
- A second, independent student ("Kelechi Bello", `SID2`) is registered
  the same way, with the same subject combination, to stand in for the
  suite's "one student cannot finish another student's run" check. The
  hard-coded `GOC.api.login('GOC-S-002', 'bello#88')` now logs in as
  `SID2` — the password is unchanged (it was always just the password
  chosen for that student, not a demo assumption), only the ID is now the
  one the driver assigned.
- No assertion's meaning was changed or weakened. Every check — the study
  rules, the XP arithmetic, the daily cap, the practice/CBT set-up
  screens, the review, and the "never reaches the record" guarantees —
  is exercised exactly as it was written, just against students created
  through the same sign-up API a real scholar would use.

## 6. How the fix supports real students
The practice run, the CBT set-up, the daily XP allowance, and the
guarantee that study never becomes an examination result are now all
exercised against students created through the same public sign-up flow
a real scholar would use, with Scholar IDs the driver assigned rather
than ones assumed to exist. The subject-combination rule (English plus
three sciences, no more, no fewer) is exercised the same way it would be
for anyone signing up today, rather than relying on a demo record that
predates that rule's current shape.

## 7. Tests run after the fix
- `node test/test-study.js` (the fixed suite, in isolation)
- The other suites, run individually to check for regressions:
  `test-rules.js`, `test-p1.js`, `test-p2.js`, `test-p6.js`, `test-p3.js`,
  `test-p4.js`, `test-p78.js`, `test-p9.js`, `test-p10.js`,
  `test-driver-parity.js`, `test-launch.js`, `test-math.js`
- `test-server.js`, `test-security.js` and
  `test-appwrite-registration.js` were run to confirm they fail for the
  same environment reason as before (no network access in this sandbox,
  so `npm install` cannot fetch `node_modules` — `test-server.js` cannot
  reach a server it cannot start, `test-security.js` and
  `test-appwrite-registration.js` fail at `require(...)` before any
  assertion runs). This is an environment limitation, not a regression,
  and is unchanged from every prior session's report.

## 8. Test results
- `test-study.js`: **144 passed, 0 failed** (was crashing immediately
  before the fix; nothing past the first login had ever run).
- All other runnable suites: green, with their pre-existing pass counts
  unchanged (`test-rules.js` 293/0, `test-p1.js` 78/0, `test-p2.js` 31/0,
  `test-p6.js` 70/0, `test-p3.js` 240/0, `test-p4.js` 338/0, `test-p78.js`
  124/0, `test-p9.js` 109/0, `test-p10.js` 76/0, `test-driver-parity.js`
  8/0, `test-launch.js` 48/0, `test-math.js` 162/0). No regressions.
- `test-server.js`, `test-security.js`, `test-appwrite-registration.js`:
  not verified in this sandbox (no network access to install
  dependencies); unchanged from every prior report.

## 9. What remains to be fixed
As of this session, every test suite in `test/` that can run inside this
sandbox has been fixed and is green:

- `test-rules.js`, `test-p1.js`, `test-p2.js`, `test-p6.js`, `test-p3.js`,
  `test-p4.js`, `test-p78.js`, `test-p9.js`, `test-p10.js`,
  `test-study.js`, `test-driver-parity.js`, `test-launch.js`,
  `test-math.js` — all passing, no known regressions.
- `test-server.js`, `test-security.js`, `test-appwrite-registration.js` —
  still cannot be verified in this sandbox because it has no network
  access, so `npm install` cannot fetch the packages these suites
  `require(...)` (including `dotenv`). This is not a code defect; it
  needs to be run in an environment with network access (or with
  `node_modules` pre-installed) before it can be confirmed green or
  broken.
- No other suite is queued behind these. If new production features are
  added to `js/app.js` or elsewhere, it is worth checking — the same way
  this session's predecessor did for `sortDayBlocks()` — for any
  whole-file-scoped assertion in the existing suites that a legitimate,
  unrelated addition could trip.

## 10. The next test to address
None queued. The remaining open item is purely environmental: get
`test-server.js`, `test-security.js` and `test-appwrite-registration.js`
running somewhere with network access so their real pass/fail status can
be confirmed, since they currently fail before a single assertion runs.
