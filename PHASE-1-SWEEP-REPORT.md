# Phase 1 — FEATURE SWEEP CLEAN: completion report

**Branch:** `arena/1f98403a-goc-academy-hub`
**Base commit:** `950c276` — "Hostname entry replaces Website Mode Control (removed)"
**Sweep commit:** `bdac7f2` — "Phase 1 sweep: retire quests, timetable, web test entry, admin videos, guardian PIN, question approval and tutor analytics"
**Status:** sweep complete, suite green against baseline. **Stopped here** — Student Homepage work has not begun.

---

## 0. Summary in one paragraph

Every feature on the off-limits list is gone from both the screen and the server that backed it:
the standalone Timetable screen, the Web Test entry point, the Next Activity card, daily and weekly
quests, the Personal Notes feature (which did not exist in the codebase), admin video
upload/publish/delete, the Guardian PIN, tutor analytics, the console approval queue and tutor
question activation/approval/return. Everything on the keep list was checked feature by feature and
is still wired end to end. No data was destroyed: every retired surface was an *entry point or a
write path*, never a read of stored records, and the one place where a retired feature had left
data behind — tutor questions saved as `pending`/`returned` — was deliberately kept out of students'
papers rather than quietly released. `node test/run.js` gives **198 passed / 4 FAILED**, and those
four fail identically on the untouched base commit (see §6).

---

## 1. Removed — screens, navigation and functionality

### Student experience
| Removed | What actually came out |
|---|---|
| **Timetable (standalone)** | The whole `<section id="timetable">` (42 lines), its bottom-tab entry, its dashboard `dj` shortcut tile, its ~228-line `/* TIMETABLE */` JS block, its `renderDay()` guard, and every `#timetable` / `.week-strip` / `.wday` / `.tt-*` CSS rule. `grep -c timetable css/styles.css` is now `0`. |
| **Web Test (standalone nav)** | The entry points only: the `tut-webtest` tutorial step, the Web Test `sg-cell` on the Study grid, and the Web Test entries in `tabScreens`. Per your decision the **engine, routes, Results and Review stay** — see §4. |
| **Next Activity** | The `#dashNext` dashboard card, `dashPaintNext()`, `dashRow()` and every call site. |
| **Daily quests** | `#questCard`, the quest painters, `GOC.api` quest clients, `GET /api/me/quest`, the quest block in practice-submit, Appwrite `questDay` bookkeeping, all quest exports in `goc-core.js`, and the `sent.weekly` path in `server/lib/reminders.js`. |
| **Weekly quests** | `#weekCard`, `GET /api/me/weekly-quest`, the weekly-quest clients and painters, the Sunday digest. |
| **Personal notes (student)** | **Not present in the codebase.** There was no student-facing "My Notes" screen, model, route or API method to remove. Nothing to report beyond that — it is absent, not retired. |
| **Redo Mistakes** | Not a separate feature; `mistakes` is a review surface, and it is explicitly on the keep list. Left untouched. |

### Tutor
Removed: question **activation, approval, returning for approval and the approval queue**.

Concretely: `core.reviewQuestion`, `core.approveBatch`, `core.approvalQueue`, `core.pendingCount`,
`RETURN_REASON_MIN`/`MAX`; every `admAp*` console function and the console `approvals` panel;
`GOC.api.listApprovals` / `approveQuestion` / `returnQuestion` / `approveBatch` on all three drivers;
`POST /api/approvals/batch/approve` and `POST /api/approvals/:id/(approve|return)`; the
`statusCounts.pending/returned` row on the tutor dashboard; the status filter chips, the
"Awaiting approval" badges and the "Sent for approval" copy throughout `server/tutor/tutor-app.js`.

**Preserved and re-verified:** question creation, editing, CSV importing, tutor notes, publishing
(withdraw / put back live), class notices, and script marking. A tutor's typed or imported question
is now **live the moment it is saved**, which is the behaviour the owner asked for once the queue
was retired.

> **Deliberate safety decision.** `QUESTION_STATUSES` and `questionStatus()` were kept, and
> `stampTutorQuestion` now writes `'live'` instead of `'pending'`. A question saved *before* this
> sweep can still say `pending` or `returned`; because `listQuestions()` and `servablePool()` still
> test `questionIsLive()`, those rows stay **off students' papers** until a tutor edits them. Deleting
> the status field would have silently released every one of them the moment the queue disappeared.
> The tutor UI now calls such a row "Held back" and tells the tutor to edit and save it to publish.

### Admin
| Removed | Detail |
|---|---|
| **Separate console access portal** | **Kept — it is authentication, per your decision.** `#admin-gate`, the passcode flow and `POST /api/auth/unlock` are untouched. |
| **Video upload / publish / delete** | The console `videos` panel, `admLoadVideos`, `admRenderVideos`, `admSetVideoPublished`, `admDeleteVideo`, `admVideoFilePicked`, `admUploadVideo`, `handleVideoUpload()` (180 lines) and the four `/api/admin/videos*` routes. |
| **Guardian PIN** | The console PIN field + save button, `paintGuardianPin`, `admSetGuardianPin`, the `#windExtendWrap` overlay block, `swExtend()`, `POST /api/me/study-time/extend`, `core.normalizeGuardianPin`, `core.guardianPinMatches`, and `hasGuardianPin`/`guardianPin` from both `GET` and `PUT /api/settings`. |
| **Tutor analytics** | The "Tutor Analytics" card in the Tutors panel, `admTutAnalyticsLoad()` and `GET /api/admin/tutors/analytics`. **`GET /api/tutor/analytics` was kept** — that is the tutor's own subject dashboard (snapshot, weak topics, hardest questions), not admin analytics; removing it would have broken a retained tutor feature. |
| **Deployment notices** | **Not present in the codebase** — no "deploy note"/"deployment notice" UI, table, route or API method exists to remove. |

### Shared dependencies preserved (not blindly deleted)
- **`listPublishedVideos` / `playVideo` / `videoCard` / `GET /api/videos` / `GET /api/videos/:id/file`** — the *player* was kept. Students still watch every already-published recording; only management-side upload/publish/delete went away. `verify-media.js` still audits the stored files.
- **The Web Test engine** (`startTest`, `wtStart`, `wtRun`, `wtResult`, `/api/me/tests*`) — kept, per your decision. Only the nav entry points went.
- **`weekStart` / `weekEnd`** — kept; team challenges and `server/server.js:838` need them.
- **`hexA()`** — kept; results, resources and classes cards call it.
- **`stampTutorQuestion` / `tutorOwnsQuestion` / `tutorEditQuestion` / `tutorQuestions`** — kept (authorship and ownership checks), only the review half removed.
- **`EXTRA_TIME_GRANT_MIN` / `EXTRA_TIME_MAX_GRANTS_PER_DAY` / `studyBonusMinToday()`** — kept. Nothing can add to a day's bonus any more, but a day recorded before the retirement still carries minutes and the window must keep counting them honestly. The constants are now commented as such.
- The console **`notes`** section is academy Reading notes, not student personal notes — untouched.

---

## 2. Files deleted / modified

**Deleted (14 files, all test suites for the retired approval queue and quests):**
```
test/test-approvals-edit.js      test/test-approvals-ui.js
test/test-daily-quest.js         test/test-weekly-quest.js
test/test-quest-demo.js          test/test-quest-result.js
test/test-quest-reward-demo.js   test/test-quest-reward.js
test/test-quest-route.js         test/test-quest-ui.js
test/test-quest-weekly-demo.js   test/test-quest-weekly-reward.js
test/test-quest-weekly-route.js  test/test-quest-weekly-ui.js
```
Both approval suites were deleted rather than rewritten: `test-approvals-edit.js` tested "edit then approve" exclusively, and `test-approvals-ui.js` tested a console panel that no longer exists. Nothing retained was covered by them. (`test-approval.js` is a different suite — the **sign-up** approval flow — and is kept and passing.)

**Modified (30 files).** Application code:
`index.html`, `js/app.js`, `js/api.js`, `js/goc-core.js`, `server/server.js`,
`server/tutor/tutor-app.js`, `server/lib/reminders.js`, `css/styles.css`.

Generated / docs: `functions/goc-api/route-inventory.json`, `functions/goc-api/coverage.json`,
`readme.md`, `DEPLOYMENT.md`, `ROADMAP-REMAINING.md`.

Tests: `test/run.js` plus 18 suites updated to match the new behaviour
(`test-p1`, `test-p3`, `test-p6`, `test-persist`, `test-reminders`, `test-roles-session`,
`test-roles-cap`, `test-console-menu`, `test-migration-gateway`, `test-study-window`,
`test-tiers-classes`, `test-tutor-approval`, `test-tutor-questions`, `test-tutor-questions-ui`,
`test-tutors-ui`, `test-tutors-appwrite-source`, …).

Net: **693 insertions, 4,614 deletions.**

---

## 3. Backend / API changes

**Routes removed (253 → 241, regenerated with `functions/goc-api/tools/extract-routes.js`):**

| Route | Was |
|---|---|
| `GET /api/me/quest` | daily quest |
| `GET /api/me/weekly-quest` | weekly quest |
| `GET /api/approvals` | approval queue |
| `POST /api/approvals/batch/approve` | bulk approve an import |
| `POST /api/approvals/:id/(approve\|return)` | approve / return one question |
| `GET /api/admin/videos` | console video list |
| `PUT /api/admin/videos/:id/published` | publish / unpublish |
| `POST /api/admin/videos/upload` | video upload |
| `DELETE /api/admin/videos/:id` | video delete |
| `POST /api/me/study-time/extend` | guardian-PIN extra time |
| `GET /api/admin/tutors/analytics` | admin tutor analytics |

**Kept and explicitly re-verified:** `/api/videos`, `/api/videos/:id/file`, `/api/tutor/analytics`,
`/api/tutor/questions*`, `/api/tutor/notes*`, `/api/tutor/scripts*`, `/api/notes*`, `/api/notices*`,
`/api/broadcasts*`, `/api/alerts*`, `/api/flags*`, `/api/updates*`, `/api/classes`, `/api/resources*`,
`/api/league`, `/api/rounds*`, `/api/challenges*`, `/api/me/tests*`, `/api/results*`,
`/api/students/:id/approve` (sign-up approval ≠ content approval).

**Contract changes on retained routes** (each is a removal, never a redesign):
- `GET /api/tutor/subject` — `statusCounts` is now `{ live, held }` (was `{ live, pending, returned, other }`).
- `GET /api/tutor/questions` — `counts` is now `{ live, held }`; `status` on a saved question is `live`.
- `POST /api/tutor/questions/import` — response `status` is `live` (was `pending`).
- `GET /api/tutors/overview` — the per-subject `pending` count is gone; `lastUpload` stays.
- `GET`/`PUT /api/settings` — `hasGuardianPin` and `guardianPin` are gone.
- `GET /api/me/settings` — `hasGuardianPin` gone.

**Untouched, by instruction:** authentication, password hashing, role/permission maps (the capability
names `approvals.review` and `resources.publish` still exist and still guard `flags`/`resources`),
Appwrite integration, database accessors, storage, and the crawler/content-protection shield. No
migration, no API replacement, no schema change — the Appwrite questions collection still carries the
`status`/`addedBy`/`reviewedBy` attributes, so stored records read back exactly as before.

---

## 4. Student records and examination data — intact

Nothing in this sweep reads, rewrites, migrates or deletes a stored record. Specifically confirmed:

- **Student accounts / profiles** — untouched. `pendingApproval` (sign-up approval) is a different
  mechanism from question approval and is untouched; `test-approval.js`, the sign-up gating suite,
  passes.
- **Exam attempts / results** — untouched. Results, Review, performance analysis and JAMB
  weak/strong-topic analysis all still render; `test-p3` (241 checks), `test-p4` (363 checks) and the
  results/analysis suites pass.
- **Practice history** — untouched. Practice submit still credits XP and the streak; only the quest
  bookkeeping that hung off it was removed (`test-p1`, `test-p6` pass).
- **Question bank records** — no question was deleted. Retired rows keep their stored `status`, which
  is why they stay hidden rather than becoming live.
- **Academy notes / resources** — untouched, including the console Reading-notes section.
- **Tutor and admin accounts** — untouched.
- **Backups / persistent records** — the backup, hydration and cloud-persistence code was not
  modified. `server/data.json` was never edited or committed.
- **Videos already published** — records and stored files untouched; `verify-media.js` still audits
  them and students still play them.

---

## 5. Free UTME 2027 Tutorial Edition — untouched

`js/free2027-*.js`, `js/goc-free-2027.js`, `css/free2027.css`, `server/lib/free2027*`, the
`free-*` screens and the `free2027` route family were **not modified**. `git status` before the
commit showed no free2027 file. Its own question route, its console routes and its records are
exactly as they were; `test-migration-gateway.js` (which compiles the whole router) passes.

---

## 6. Tests executed and results

`node test/run.js` — **198 suites passed, 4 FAILED.**

The four failures are **pre-existing on the base commit** and reproduce identically in a clean
`git worktree` of `950c276`. They are not caused by, and were not touched by, this sweep:

| Suite | This branch | `950c276` baseline |
|---|---|---|
| `test-free2027-local` | 2 FAILED | 2 FAILED |
| `test-production-persistence` | 90 passed, 17 failed | 90 passed, 17 failed |
| `test-backup-integrity` | 158 passed, 34 failed | 158 passed, 34 failed |
| `test-migration-api-config` | 23 passed, 1 failed | 23 passed, 1 failed |

The failure names were diffed, not just the counts, and match name for name (e.g.
`404 is logged as "no blob yet"`, `a genuinely absent blob still allows the first-install seed`,
`Database works while Storage fails: the server reports all four states`, the `build.js` invocation
in `test-migration-api-config`).

**Suites fixed because the cleanup changed their subject** (not weakened, retargeted):
- `test-tutor-approval.js` — now asserts the authorship rules and, in the place of the review
  section, that a `pending`/`returned` row still cannot be served.
- `test-tutor-questions.js` — now asserts a saved question is live, that the four `/api/approvals*`
  routes return 404 for management as well, and that imported rows are live under one batch.
- `test-tutor-questions-ui.js` / `test-tutors-ui.js` — new copy, `Held back` filter, no analytics card.
- `test-tutors-appwrite-source.js` — the Appwrite-vs-empty-cache regression check is kept on the
  tutor route; the admin-analytics half was retired with its route.
- `test-roles-cap.js` — the four `/api/approvals` capability probes removed with the route.
- `test-persist.js` / `test-study-window.js` — guardian-PIN assertions inverted to assert absence.
- Pinned counts updated deliberately: `CONSOLE_ROUTES` 140 → 136, console sections 27 → 25,
  route table 253 → 241.

---

## 7. Unresolved dependencies and risks

1. **`test-free2027-local.js` now pins a defective behaviour.** It asserts
   `hubQuestions.status !== 200` for `GET /api/questions` *and* `stub.databaseHits > 0` — i.e. it
   requires the hub route to reach the Appwrite Database. Under the stand-in the route returns 200
   with a question list, so both assertions fail. This is the same on the base commit. It looks like
   a stand-in/stub mismatch rather than a real product bug, but I did not touch it because the file
   is the Free 2027 edition's own suite. **Recommend a separate look.**
2. **Adaptive difficulty relied on a live pool.** `core.adaptiveDepth` walks a student toward
   harder questions by observing a mixed pool. With no approval gate the pool is now bigger and
   arrives sooner, so the staircase will move faster than before. Behaviour is still correct, just
   different in tempo. Flagging it because it is a felt change, not a broken one.
3. **`questionStatus()` intentionally still returns `'pending'` for an unknown status** (fails
   closed). A future question created with a typo'd status would be invisible to students. That is
   the safe direction, but it is a trap worth a comment in any future question-creation route — the
   comment is in `goc-core.js` now.
4. **Two console capabilities are now used by fewer routes than their names suggest.**
   `approvals.review` still guards the `flags` section, and `resources.publish` still guards
   resources. Neither map changed; only the routes they guard shrank.
5. **Video management has no in-app replacement, by design.** Adding a lesson video now means
   writing an Appwrite record directly. `verify-media.js` remains the way to confirm files.
6. **The tutorial has six steps, not seven.** Both retired anchors in `TUT_STEPS`
   (`tut-webtest`, `dashJourney` positioning, the Timetable wording in the shortcuts copy) were
   cleaned up, so no step points at a missing element — but the rings itself was never pixel-checked
   on a real phone, which matches the standing device-pass caveat in `DEPLOYMENT.md`.
7. **Docs now carry a superseded note.** `readme.md`'s "Fix 2 — imported questions go to the
   approval queue" is kept for history with a clear `SUPERSEDED` block, since the behaviour it
   describes was deliberately reversed here. If you would rather the log be rewritten rather than
   annotated, say so.
8. **`#track` / study-tracking wording.** Study Plan, weekly timetable, study blocks and study-time
   tracking were kept and now live on the Classes screen with the new `#scheduleList`. `test-p6`
   (70 checks) drives them and passes, but the visual layout of the added schedule block inside
   Classes has not been reviewed on a device.

---

## 8. Explicitly not started

Student Homepage redesign: **not started**, as instructed. Awaiting your review of this report.
