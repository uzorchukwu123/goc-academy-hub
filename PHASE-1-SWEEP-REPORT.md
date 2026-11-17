# Phase 1 — FEATURE SWEEP CLEAN: completion report (revision 2)

**Branch:** `arena/1f98403a-goc-academy-hub`
**Base commit:** `950c276` — "Hostname entry replaces Website Mode Control (removed)"
**Sweep commit:** `7427fca` — "Phase 1 review corrections: preserve the planner engine for Study Plan, retire student video playback"
**Status:** sweep complete + the four review corrections applied. **Stopped here** — Student Homepage work has not begun.

> **Revision 2** supersedes revision 1. Two things changed after ChatGPT's review: the weekly
> planner is no longer owned by the Classes screen (§1), and student-facing video playback is
> retired (§2). Everything else in the first report still holds and is restated here so this
> document stands on its own.

---

## 0. Summary in one paragraph

Every feature on the off-limits list is gone from both the screen and the server that backed it:
the standalone Timetable screen, the Web Test entry point, the Next Activity card, daily and weekly
quests, the Personal Notes feature (which did not exist), admin video upload/publish/delete, the
Guardian PIN, tutor analytics, the console approval queue, and tutor question
activation/approval/return. Video is now retired as a *student-facing medium* as well — no surface
in the app plays a video — while the stored records and files are untouched and still served by
their routes. The weekly planner is preserved as a **screen-independent engine** in `js/goc-core.js`
rather than living on any page, because its permanent home is the redesigned Study Plan page. No
data was destroyed: every retired item was an entry point or a write path, never a read of stored
records. `node test/run.js` gives **199 suites passed / 4 FAILED**, and those four fail identically
on the untouched base commit (§5).

---

## 1. CORRECTION 1 — The weekly planner belongs to the Study Plan page, not to Classes

**What was wrong in revision 1.** The sweep deleted the standalone Timetable screen (correct) and
then rebuilt its week listing *inside* the Classes screen, which read as though Classes had become
the planner's home. It had not been intended that way, but the code said otherwise.

**What is now true.** The planner is a rule engine with no owner. It lives in `js/goc-core.js` — the
shared module both the browser and the server load — and is exported for the redesigned Study Plan
page to mount directly:

| Exported | What it gives the Study Plan page |
|---|---|
| `PLAN_DAYS`, `PLAN_DAY_LABELS`, `PLAN_BLOCK_KINDS`, `PLAN_SHARED_SLOTS` | Monday-first week, the words for each day, the block kinds (`study` / `class` / `rest`), and the two non-subject slots every student may plan (Revision, Review) |
| `planDayKey(date)`, `planDayIndex(key)`, `planTimeLabel(when)`, `planTimeFromInput(hhmm)`, `planMinutesOf(label)` | Turning timestamps and typed times into the planner's own vocabulary, and back |
| `planSortBlocks(blocks)` | A day in the order a student reads it, rest marker last, input never mutated |
| `planValidateBlock(block, subjects)` | The full accept/refuse rule for a block a student plans: day, subject **against the papers they actually sit**, time, 5–240 minutes, topic required, topic capped at 120 chars. Returns `{ block }` normalised or `{ error }` with a sentence a surface can show |
| `planDurationLabel(mins)`, `planClassBlock(cls)` | `30m` / `1h` / `1h30m`, and a live class expressed as a planner block (day, time, join lock and timestamp carried) |
| `planWeek(classes, blocks, show)` | The grouped week: all seven days present, each sorted, each with a study-block count and a planned-minutes total; `show(block)` is the surface's own filter |
| `planDaySummary(blocks)`, `planDayProgress(planned, studied)` | "2 blocks planned"; and how much of a plan is met, capped at 100% so a long session never reads as 140% |

**The interim Classes surface holds no planner logic.** It calls `GOC.core.planWeek()` and renders
the result; it does not re-implement grouping, sorting, day keys, time labels or block validation.
`blockSortKey`, `timeInputTo12`, `sortDayBlocks` and `dayBlocks` are gone from `js/app.js`. That is
deliberate: when the Study Plan page lands it mounts the same engine and **the whole Classes block is
deleted — nothing has to be ported, because nothing is implemented there.** The markup comment says
this in as many words.

**Unchanged:** the standalone old Timetable screen and its navigation remain retired. It is not
coming back, and the new suite pins that (`no id="timetable"`, no `go('timetable')`, no
`<option value="timetable">`).

**Study-time tracking** is untouched and still server-enforced (`POST /api/me/study-time/ping`,
`core.studyWindowStatus`). Only the guardian-PIN *grant* was retired; bonus minutes already recorded
on a day are still counted and still disclosed on the wind-down card.

**Pinned by a new suite:** `test/test-study-plan-engine.js` (50 checks) tests the engine directly —
day arithmetic including the Sunday/Monday boundary, time labels at midnight and afternoon, sort
order, every validation branch, duration shorthand, class mapping, week grouping, and that the engine
is not screen-owned. It passes or fails on the rules alone, so it survives the Classes block being
deleted.

---

## 2. CORRECTION 2 — Video is excluded, so student playback is retired

**Retired (student-facing):**

| Surface | Detail |
|---|---|
| **Classes screen shelves** | The "🔴 Recorded live classes" and "🎬 Lesson videos" sections, `#liveList`, `#lessonList`, `#liveEmpty`, `#lessonEmpty`. The screen is now "Live classes" with the scheduled list only. |
| **Playback entry points** | `videoCard()` (the thumbnail/play-badge card), `playVideo()` (external-link hand-off and the streaming overlay), and the `vcard.onclick` that opened them. |
| **The fetch that fed them** | `loadPublishedVideos()`, its `videos` array, `videosLocked`, `publishedVideosLoaded`, `videoGradient()`, `VIDEO_GRADIENTS`, and both call sites in the login/preview hydration arrays. |
| **Client API** | `GOC.api.listPublishedVideos` and `GOC.api.getVideoFile` on all three drivers (demo, HTTP, facade re-export). |
| **Inline video in the resource viewer** | The `kind === 'video'` branch of `openResourceMediaViewer` and the `mp4 → 'video'` case in `resourceViewerKind`. A `.mp4` **resource** now downloads like a Word file instead of playing inline. |
| **Video-only CSS** | `.vthumb`, `.vplay`, `.vbadge`, `.vbadge.live`, `.vdur`, `.player-stage`, `.player-stage .vplay`. `.vcard` / `.vmeta` / `.vtag` were kept because the interim scheduled-class rows use them. |
| **Promises on public copy** | "Live classes, lesson videos and class replays" on the landing page and the sign-up tier cards, and "lesson videos" in the scholarship copy. |

**Deliberately NOT deleted — stored data and records:**
- Every video **record** in the Appwrite `videos` collection, and every **stored file** in the bucket.
- `GET /api/videos` and `GET /api/videos/:id/file` remain registered and **still tier-guarded** by
  `core.videoAllowed` / `core.videoLockMessage` (Open cannot read them, GOC can). The routes were
  left in place precisely so nothing had to be deleted while the storage decision is pending. No
  client method calls them any more; the code says why.
- `server/verify-media.js` still audits every stored video file, and `DEPLOYMENT.md` now documents
  video as excluded-but-preserved, with the file check as the way to confirm integrity.

**Preserved unchanged:** all non-video resources and documents — past questions, notes, formula
sheets, syllabus, PDFs and images still open in the app viewer with zoom/full-screen, and downloads
are untouched.

> **Decision needed from the owner.** The stored video records and files are now unreachable from the
> app by design. Deleting either the records or the bucket files needs separate approval, so both are
> left exactly as they are. Say the word and that is a separate, explicit piece of work.

---

## 3. Removed in the sweep (revision 1, unchanged)

### Student experience
| Removed | What actually came out |
|---|---|
| **Timetable (standalone)** | The whole `<section id="timetable">`, its bottom-tab entry, its dashboard shortcut tile, its ~228-line JS block, its `renderDay()` guard and every `#timetable` / `.week-strip` / `.wday` / `.tt-*` CSS rule. `grep -c timetable css/styles.css` is `0`. |
| **Web Test (standalone nav)** | The `tut-webtest` tutorial step, the Web Test `sg-cell` on the Study grid, and its `tabScreens` entry. **Engine, routes, Results and Review kept** — see §4. |
| **Next Activity** | `#dashNext`, `dashPaintNext()`, `dashRow()` and every call site. |
| **Daily quests** | `#questCard`, the quest painters, the quest clients, `GET /api/me/quest`, the quest block in practice-submit, the Appwrite `questDay` bookkeeping, all quest exports, and the weekly path in `server/lib/reminders.js`. |
| **Weekly quests** | `#weekCard`, `GET /api/me/weekly-quest`, its clients and painters, the Sunday digest. |
| **Personal notes (student)** | **Not present in the codebase** — no screen, model, route or API method existed. Reported as absent, not as removed. |
| **Redo Mistakes** | Not a separate feature; `mistakes` is a review surface and is on the keep list. Untouched. |

### Tutor
Removed: question **activation, approval, returning for approval and the approval queue** —
`core.reviewQuestion`, `core.approveBatch`, `core.approvalQueue`, `core.pendingCount`,
`RETURN_REASON_MIN`/`MAX`; every `admAp*` console function and the console `approvals` panel; the four
approval client methods on all three drivers; `POST /api/approvals/batch/approve` and
`POST /api/approvals/:id/(approve|return)`; the `statusCounts.pending/returned` row; the status filter
chips, "Awaiting approval" badges and "Sent for approval" copy.

**Preserved:** creation, editing, CSV importing, notes, publishing (withdraw / put back live), class
notices, script marking. A saved question is live at once.

> **Safety decision, still in force.** `QUESTION_STATUSES` and `questionStatus()` were kept, and
> `stampTutorQuestion` writes `'live'`. A question saved *before* the sweep can still say `pending` or
> `returned`; because `listQuestions()`/`servablePool()` still test `questionIsLive()`, those rows stay
> **off students' papers** until a tutor edits them. Deleting the field would have silently released
> every one of them. The tutor UI labels such a row "Held back" and asks for an edit-and-save.

### Admin
| Removed | Detail |
|---|---|
| **Separate console access portal** | **Kept — it is authentication.** `#admin-gate`, the passcode flow and `POST /api/auth/unlock` untouched. |
| **Video upload / publish / delete** | The console `videos` panel, `admLoadVideos`, `admRenderVideos`, `admSetVideoPublished`, `admDeleteVideo`, `admVideoFilePicked`, `admUploadVideo`, `handleVideoUpload()` (180 lines) and the four `/api/admin/videos*` routes. |
| **Guardian PIN** | Console field + save button, `paintGuardianPin`, `admSetGuardianPin`, `#windExtendWrap`, `swExtend()`, `POST /api/me/study-time/extend`, `normalizeGuardianPin`, `guardianPinMatches`, and `hasGuardianPin`/`guardianPin` from `GET`/`PUT /api/settings` and `GET /api/me/settings`. |
| **Tutor analytics** | The "Tutor Analytics" card, `admTutAnalyticsLoad()` and `GET /api/admin/tutors/analytics`. **`GET /api/tutor/analytics` kept** — the tutor's own subject dashboard, a retained feature. |
| **Deployment notices** | **Not present in the codebase** — no UI, table, route or API method to remove. |

### Shared dependencies preserved
- **The Web Test engine** (`startTest`, `wtStart`, `wtRun`, `wtResult`, `/api/me/tests*`) — kept.
- **`weekStart`/`weekEnd`** — kept; team challenges and `server/server.js:838` need them.
- **`hexA()`** — kept; results, resources and classes cards call it.
- **`stampTutorQuestion` / `tutorOwnsQuestion` / `tutorEditQuestion` / `tutorQuestions`** — authorship and ownership kept; only the review half removed.
- **`EXTRA_TIME_GRANT_MIN` / `EXTRA_TIME_MAX_GRANTS_PER_DAY` / `studyBonusMinToday()`** — kept and commented: nothing can add to a day's bonus now, but a day recorded before the retirement still carries minutes.
- **`videoAllowed` / `videoLockMessage` / `TIER_FEATURES.videos` / `.classRecordings`** — kept; they still guard the routes over stored records.
- The console **`notes`** section is academy Reading notes, not student personal notes — untouched.

---

## 4. Files, backend and API

**Deleted (14 — all suites for retired quests/approval):**
```
test/test-approvals-edit.js      test/test-approvals-ui.js
test/test-daily-quest.js         test/test-weekly-quest.js
test/test-quest-demo.js          test/test-quest-result.js
test/test-quest-reward-demo.js   test/test-quest-reward.js
test/test-quest-route.js         test/test-quest-ui.js
test/test-quest-weekly-demo.js   test/test-quest-weekly-reward.js
test/test-quest-weekly-route.js  test/test-quest-weekly-ui.js
```
`test-approval.js` (the **sign-up** approval flow) is a different suite, kept and passing.

**Added (2):** `test/test-study-plan-engine.js`, `PHASE-1-SWEEP-REPORT.md`.

**Modified (33):** `index.html`, `js/app.js`, `js/api.js`, `js/goc-core.js`, `server/server.js`,
`server/tutor/tutor-app.js`, `server/lib/reminders.js`, `css/styles.css`,
`functions/goc-api/route-inventory.json`, `functions/goc-api/coverage.json`, `readme.md`,
`DEPLOYMENT.md`, `ROADMAP-REMAINING.md`, `test/run.js` + 18 suites.

Net against base: **1,443 insertions, 4,856 deletions.**

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

**Client methods removed:** `listVideos`, `uploadVideo`, `setVideoPublished`, `deleteVideo`,
`listPublishedVideos`, `getVideoFile`, `listApprovals`, `approveQuestion`, `returnQuestion`,
`approveBatch`, `setGuardianPin`, `extendStudyTime`, `adminTutorAnalytics`, plus the quest clients.

**Kept and re-verified:** `/api/videos`, `/api/videos/:id/file`, `/api/tutor/analytics`,
`/api/tutor/questions*`, `/api/tutor/notes*`, `/api/tutor/scripts*`, `/api/notes*`, `/api/notices*`,
`/api/broadcasts*`, `/api/alerts*`, `/api/flags*`, `/api/updates*`, `/api/classes`,
`/api/me/study-time/ping`, `/api/resources*`, `/api/league`, `/api/rounds*`, `/api/challenges*`,
`/api/me/tests*`, `/api/results*`, `/api/students/:id/approve`.

**Contract changes on retained routes** (all removals, never redesigns):
- `GET /api/tutor/subject` — `statusCounts` is `{ live, held }`.
- `GET /api/tutor/questions` — `counts` is `{ live, held }`; a saved question's `status` is `live`.
- `POST /api/tutor/questions/import` — response `status` is `live`.
- `GET /api/tutors/overview` — per-subject `pending` gone; `lastUpload` stays.
- `GET`/`PUT /api/settings`, `GET /api/me/settings` — guardian-PIN fields gone.

**Untouched:** authentication, password hashing, role/permission maps (`approvals.review` and
`resources.publish` still exist and still guard `flags`/`resources`), Appwrite integration, DB
accessors, storage, crawler/content-protection. No migration, no API replacement, no schema change.

---

## 5. Tests executed and results (correction 3)

`node test/run.js` — **199 suites passed, 4 FAILED.**

The four failures reproduce **identically against the original base commit `950c276`**, re-verified
in a clean `git worktree` after these corrections:

| Suite | This branch | `950c276` baseline |
|---|---|---|
| `test-free2027-local` | 2 FAILED | 2 FAILED |
| `test-production-persistence` | 90 passed, 17 failed | 90 passed, 17 failed |
| `test-backup-integrity` | 158 passed, 34 failed | 158 passed, 34 failed |
| `test-migration-api-config` | 23 passed, 1 failed | 23 passed, 1 failed |

Failure **names** were diffed, not just totals, and match name for name.

**New this revision:** `test/test-study-plan-engine.js` — 50 checks, all passing, and registered in
`test/run.js`.

**Suites retargeted by these corrections** (loosened nowhere, only re-pointed at what now exists):
- `test-tiers-videos.js` — the rules block is kept; the "screen" block now asserts that **no**
  playback surface came back (no `videoCard`, no `playVideo`, no `loadPublishedVideos`, no
  `#liveList`/`#lessonList`) instead of asserting the shelf read the locked flag.
- `test-p6.js` — subject personalisation is now proved through the scheduled-classes list, which
  shares `studiesSubject()`; added a check that no video shelf is on the Classes screen. 69 checks.
- `test-tiers-signup.js` — the GOC tier cards must still promise live classes and must **not**
  promise lesson videos or replays.
- `test-manager-change-ui.js` — hydration stub updated to `renderSchedule`.

Earlier retargets (unchanged): `test-tutor-approval`, `test-tutor-questions`,
`test-tutor-questions-ui`, `test-tutors-ui`, `test-tutors-appwrite-source`, `test-roles-cap`,
`test-persist`, `test-study-window`, plus the pinned counts (`CONSOLE_ROUTES` 140 → 136, console
sections 27 → 25, route table 253 → 241).

---

## 6. Protection (correction 4)

- **No student record, examination attempt, result or question-bank record was modified.** Every
  change is to interface code, route registration or test expectations. No data file was edited or
  committed; `server/data.json` is untouched. Retired rows keep their stored `status` and stay hidden
  rather than being released.
- **No migration, no schema change, no API replacement, no storage operation.**
- **Free UTME 2027 Tutorial Edition untouched** — no `free2027` file, screen or route modified; its
  suite result is identical to baseline.
- **Student Homepage not started.**
- **Nothing deleted from storage** — video records and files included.

---

## 7. Open items carried forward

1. **`test-free2027-local.js` pins a defective assertion** — it requires `GET /api/questions` to
   *fail* and reach the Appwrite stub; under the stand-in it returns 200. Identical on base. Left
   alone because it belongs to the 2027 edition's own suite. Recommend a separate look.
2. **Adaptive difficulty will feel faster** — its staircase needs a mixed pool, and with no approval
   gate that pool arrives fuller and sooner. Still correct, different tempo.
3. **`questionStatus()` still fails closed to `'pending'` for an unknown status.** A future question
   created with a typo'd status would be invisible to students — the safe direction, but a trap worth
   remembering in any future creation route. Commented in `goc-core.js`.
4. **Stored video records and files are now unreachable from the app** and await a separate decision
   (§2).
5. **Video management has no in-app replacement, by design** — adding a lesson video would mean
   writing an Appwrite record directly, though nothing in the app plays one now.
6. **No device pass.** The tutorial's six steps, the interim schedule block on Classes and the
   trimmed Classes layout have not been checked on a real phone; this carries the standing caveat in
   `DEPLOYMENT.md`.
7. **`readme.md` keeps a `SUPERSEDED` note** on the "imported questions go to the approval queue"
   entry, because that behaviour was deliberately reversed. Say the word and the log can be rewritten
   instead of annotated.

---

## 8. Not started

Student Homepage implementation: **not started.** Stopping here for final review.
