# GOC Academy Hub — Remaining Tasks (after this pass)

`node test/run.js` is now fully green: 18/18 test files passing, including
`test-server.js` and `test-persist.js`, which were the two open items from
the previous pass (slice14). No source (`server/`, `js/`) files were
changed this pass — every fix was in the test suite itself, plus one
housekeeping deletion.

## Fixed this pass

- **`test/test-server.js` — the grinder XP assertion (`rG.xp >= 80`) was a
  stale magic number.** It assumed a Physics objective pool size from an
  earlier pass; the actual pool at that point in the suite now serves 9
  questions per practice draw, so 7 grinds + one badly-sat paper total 73
  XP, not 80+. Rewritten to stop guessing a total and instead sum the
  actual `xpAwarded` the server returned for the sit and for each grind,
  then assert `rG.xp` equals that sum exactly, plus a separate assertion
  that both the sit and the grinding each contributed something greater
  than zero (the real intent behind the test's name — effort is not
  ignored). This is no longer sensitive to pool size, question-bank
  changes, or XP-constant tuning elsewhere in the suite.

- **`test/test-persist.js` — three cascading failures, one crash, all from
  two test bugs (not server bugs):**
  1. The persistence student was enrolled with `subjects: ['Physics']`
     only. `validateSubjects()` in `js/goc-core.js` requires Use of
     English plus exactly three sciences for a UTME combination — this
     has been the rule all along, the fixture just never supplied a valid
     combination. Enrollment therefore failed with a 400, which cascaded:
     no student token → the pre-restart test submission got a 401 → the
     record checks and the post-restart re-login (line 182) all failed or
     crashed reading `.id` off an error body.
  2. The Physics objective-count-survives-restart check read
     `physicsRow.questions`, a field that has never existed on
     `/api/objective/blueprint` rows — the actual field is `want` (with
     `available` and `serving` alongside it). This assertion could not
     have passed regardless of what the console persisted.

  Fixed by giving the enrollment a valid combination
  (`['Use of English', 'Physics', 'Chemistry', 'Biology']`) and reading
  `physicsRow.want` instead of the non-existent `.questions`. All 14
  assertions in the file now pass, and the line-182 crash is gone because
  `student.student.id` is now a real id rather than undefined from an
  error body.

## Housekeeping

- Deleted `server/server.js.before-topic-fix-20260917-112249`, the stray
  backup flagged (but left in place) in the previous pass's notes. Diffed
  it against the live `server.js` first to confirm it was an unreferenced
  pre-fix snapshot, not something anything depends on.

## Still open (unchanged from previous pass — none of this was touched)

- **Task 2** — code-level audit complete; real-device/browser visual
  confirmation still outstanding, still cannot be done from this sandbox.
- **Task 4** — regression test written; the Appwrite-credentials question
  still needs your input.
- **Task 5** — toast sweep: 4 of 173 calls converted; 169 remain,
  unchanged this pass.
- **Task 6 — the actual refresh-logout fix (student session survives a
  refresh) is still NOT verified in a real browser.** This pass only
  fixed the test *suite* so it could run and pass truthfully; it did not
  touch `js/api.js`, `js/app.js`, or the session-handling code itself, so
  it makes no new claim about whether the refresh bug is fixed — only
  that the tests which were supposed to catch regressions in that area
  now actually run and are green.
- **A genuine function-by-function admin click-through pass still needs a
  browser.** Not attempted, same reason as before.
- `npm install && node test/run.js` has not been run anywhere with real
  `node_modules` present (this sandbox has no network) — worth doing once
  at the actual deployment target, since `dotenv`/`node-appwrite`/
  `nodemailer`/`appwrite` are still real dependencies for the code paths
  the test suite doesn't exercise (Appwrite storage, email relay, file
  uploads).

## Suggested order

1. Real-device click-through: student refresh (Task 6), admin console
   sideways-scroll (Task 2), tier icons (Tasks 3/5).
2. Confirm the Appwrite-credentials question (Task 4).
3. Continue Task 5's toast sweep (169 calls remain) using the `formMsg()`
   pattern already established.
4. `npm install && node test/run.js` at the real deployment target, to
   confirm nothing environment-specific was masked by this sandbox's lazy
   busboy fix or lack of network/node_modules.
5. A full manual admin-console QA pass once a browser is available — go
   through every function and fix anything broken, incomplete, or
   placeholder-looking.

## Files changed this pass

- `test/test-server.js` — grinder XP assertion rewritten to check against
  the server's own reported `xpAwarded` values instead of a hardcoded
  magic number.
- `test/test-persist.js` — enrollment fixture given a valid UTME subject
  combination; blueprint-row field name corrected from `.questions` to
  `.want`.
- `server/server.js.before-topic-fix-20260917-112249` — deleted (stray
  backup, not referenced by anything).
