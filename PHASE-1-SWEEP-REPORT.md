# Phase 1 — FEATURE SWEEP CLEAN: completion report (revision 4)

**Branch:** `arena/1f98403a-goc-academy-hub`
**Base commit:** `950c276` — "Hostname entry replaces Website Mode Control (removed)"
**Sweep commit:** `c130a40` — "Phase 1 review corrections: preserve the planner engine for Study Plan, retire student video playback"
**Video-exclusion commit:** `7de66c7` — "Exclude video from the student resource interface entirely (Phase 1 review)"
**Route-order commit:** `7335762` — "Check video before the tier and download/view decisions on the resource file route"
**Status:** sweep complete + all review corrections applied, including the full video exclusion. **Stopped here** — Student Homepage work has not begun.

> **Revision 4** supersedes revision 3. The only change is the **order of checks** on
> `GET /api/resources/:id/file`: the video refusal now happens straight after the record is
> retrieved and validated, **before** the resource-view tier check and **before** the
> download/view decision (§2.1). Revision 3 had it after both, which meant an Open student asking to
> *open* a video was told "this is for GOC students — download it instead" about a file that is not
> offered at all, and the video answer only arrived if you already passed the tier gate. Nothing
> else changed: no record, file, route or protection was touched. Revisions 2 and 3 still hold and
> are restated here so this document stands on its own.

---

## 0. Summary in one paragraph

Every feature on the off-limits list is gone from both the screen and the server that backed it:
the standalone Timetable screen, the Web Test entry point, the Next Activity card, daily and weekly
quests, the Personal Notes feature (which did not exist), admin video upload/publish/delete, the
Guardian PIN, tutor analytics, the console approval queue, and tutor question
activation/approval/return. Video is **excluded from the app entirely** — a `.mp4` is not played,
not listed and **not downloadable** as a student resource, enforced in one shared rule, on the
screen and on the route that serves the bytes (refused before the tier check and before the
download/view decision, so every tier and every request shape gets the same answer) — while the
stored records and files are untouched
and still served by their own tier-guarded routes. The weekly planner is preserved as a
**screen-independent engine** in `js/goc-core.js` rather than living on any page, because its
permanent home is the redesigned Study Plan page. No data was destroyed: every retired item was an
entry point or a write path, never a read of stored records. `node test/run.js` gives
**200 suites passed / 4 FAILED**, and those four fail identically on the untouched base commit (§5).

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

## 2. CORRECTION 2 — Video is excluded from the app entirely: not playable, not downloadable

Revision 2 retired the *player* but left the *file* reachable: the resource viewer's video branch was
gone, yet a `.mp4` resource was still listed, still had an open and a download button, and the route
behind those buttons still served the bytes. That is not exclusion, it is removal of one way in.
Revision 3 excluded video as a **student resource**, everywhere the list and the bytes are decided.
Revision 4 fixes **where in the handler** that refusal sits (below).

### 2.1 The order of checks on `GET /api/resources/:id/file` (revision 4)

The refusal has to be the same answer whichever tier asks and whichever button is pressed, so the
record is retrieved and validated **first** and video is refused **before** the tier check and
**before** the download/view decision:

| # | Step | What answers |
|---|---|---|
| 1 | Retrieve the resource record | — |
| 2 | Confirm it exists and is published | `404` "That resource is not available." |
| 3 | Confirm its stored file reference exists | `404` "The resource file is missing." |
| 4 | **Reject video** via `resourceStudentAccessible()` | **`403`, `reason: 'video-excluded'`** |
| 5 | Resource-view tier restriction (`resourceView`) | `403`, `reason: 'tier'` |
| 6 | Download/view handling and file delivery | `200`, `inline` or `attachment` |

**Why the order matters.** In revision 3 the video gate sat *after* the tier branch. Two defects
followed, and only one of them was about bytes:

- An Open student asking to **open** a video got `403 reason: 'tier'` — "Opening files in the app is
  for GOC students. Tap the download icon to save this file instead" — advice to download a file that
  is deliberately not offered at all. The video answer was only reachable by callers who had already
  passed the tier gate.
- A **download** of a video is not tier-restricted at all, so `?download=1` reached the video gate by
  a different path than the open request. Same refusal, different route through the handler — two
  paths to audit instead of one.

With the gate at step 4 there is exactly **one** answer for video, and it precedes every branch that
could vary by tier or by request shape. Non-video resources fail out of step 4 untouched and take
steps 5–6 exactly as they did before: the tier restriction, the `inline`/`attachment` decision, the
MIME map and the `Cache-Control` header are unchanged.

**One consequential cleanup:** the `mp4: 'video/mp4'` entry came out of the route's MIME map. It
became unreachable the moment the gate moved to step 4, and leaving it would have been a second,
dormant answer for a video on a route that refuses video. `GET /api/videos/:id/file` keeps its own
`video/mp4` handling — that route serves stored records and is untouched.

**Proved two ways**, because a source-position assertion alone can be satisfied by code that does
not behave (`test/test-video-excluded.js`, §3 and §3b):

- **Source:** each step is located by a string that belongs to it and only to it, and the positions
  are compared — record retrieved < published < file-ref < **video gate** < tier lookup < tier
  refusal < download/view decision < file read < delivery. A further check rejects the shape
  `(wantsDownload|canUse|tier) … resourceStudentAccessible`, i.e. a gate wrapped in a tier or
  download condition.
- **Live:** a real server against the in-memory Appwrite stand-in. A video answers `403
  video-excluded`, **not** `403 tier`, for all four combinations of {GOC, Open} × {open, download},
  with no file bytes. A PDF still answers `403 tier` for an Open student's *view*, still downloads
  as an attachment for an Open student, and still opens inline for a GOC student. An unpublished
  video and a video with no stored file still answer `404`, not `403` — confirming steps 2–3 come
  first. A stranger still gets `401`.
- **Able to fail:** putting the gate back after the tier branch makes **8 checks** fail, including
  the live one that catches the actual defect — "an Open student opening a video is NOT told it is a
  tier problem".

### The six requirements, one by one

**1. Inline MP4 playback is not restored.** Nothing in the app can play a video. There is no
`playVideo`, no `videoCard`, no `loadPublishedVideos`, no `#liveList`/`#lessonList`, no `<video>`
element and no `video/mp4` media type anywhere in `js/`, `index.html` or `css/`;
`resourceViewerKind` returns only `pdf`/`image`/null. The stored video routes were **not** ungated to
compensate. `test-video-excluded.js` asserts each of these.

**2. MP4 is not downloadable as a student resource either.** Three layers, so no single one is the
only thing standing between a student and the file:

| Layer | Where | What it does |
|---|---|---|
| **The rule** | `js/goc-core.js` — `resourceStudentAccessible()` / `isVideoResource()` | Decides on the **real file extension**, deliberately not on the record's category badge (the badge is a category relabel: an "other" resource can be an `.mp4`, and a badge can read "PDF" over a `.docx`). `.mp4 .m4v .mov .webm .avi .mkv .ogv .wmv .flv .3gp` are excluded. |
| **The screen** | `js/app.js` — `renderResources()` | A video is dropped before it is counted or drawn, so it is never listed. Both the open **and** the download handler re-check at the click and toast the exclusion message — a list built before the rule existed still cannot open or fetch a video. |
| **The route** | `server/server.js` | `GET /api/resources` filters video out of the list. `GET /api/resources/:id/file` answers **403** `video-excluded` at **step 4** of the handler (§2.1) — after the record is retrieved and validated, and **before** the tier check, the download/view decision and any file read. One answer for every tier and every request shape. |

Unknown or blank extension is treated as a **document**, not as video: hiding a legitimate file
because its type string is missing would be a real loss, and a file we cannot identify is not
evidently a video.

**3. Video records and bucket files are preserved.** Nothing was deleted, moved or rewritten. Every
`videos` record and every stored file is where it was; `APPWRITE_VIDEOS_COLLECTION_ID` still
declares the collection, `GET /api/videos` and `GET /api/videos/:id/file` are still registered and
still tier-guarded by `core.videoAllowed` / `core.videoLockMessage`, and `server/verify-media.js`
still audits every stored video file. The change is only in what a *student resource surface* offers.
No admin video route was brought back in exchange.

**4. Documents, PDFs and images are untouched.** The rule only ever *excludes* — it never widens a
tier's access. PDF, `.doc/.docx`, `.xls/.xlsx`, `.ppt/.pptx`, `.jpg/.png/.gif`, `.zip` and plain text
all still pass `resourceStudentAccessible()`, still list, still open in the viewer with
zoom/full-screen, and still download. `test-resource-download.js` still passes, and the rule is
asserted format-by-format. The comment on `RESOURCE_VIEW_LOCK_MESSAGE` was reworded so the Open-tier
"download instead" message speaks about documents, PDFs and images only — it is not an invitation to
a video.

**5. A regression test proves it.** `test/test-video-excluded.js` — 36 checks in five sections: the
rule, the student screen, the student route, records preserved, and no player returned. It is
registered in `test/run.js`. It was verified to be able to fail: disabling the core rule makes 5
checks fail, removing the server gate makes 3 fail, removing the screen filter makes 2 fail. A test
that cannot fail would prove nothing.

**6. Student Homepage work has not begun.** No Phase 2 file, screen or route was created or touched.

### Also retired with the player (revision 2, unchanged)

| Surface | Detail |
|---|---|
| **Classes screen shelves** | The "🔴 Recorded live classes" and "🎬 Lesson videos" sections, `#liveList`, `#lessonList`, `#liveEmpty`, `#lessonEmpty`. The screen is now "Live classes" with the scheduled list only. |
| **Playback entry points** | `videoCard()` (the thumbnail/play-badge card), `playVideo()` (external-link hand-off and the streaming overlay), and the `vcard.onclick` that opened them. |
| **The fetch that fed them** | `loadPublishedVideos()`, its `videos` array, `videosLocked`, `publishedVideosLoaded`, `videoGradient()`, `VIDEO_GRADIENTS`, and both call sites in the login/preview hydration arrays. |
| **Client API** | `GOC.api.listPublishedVideos` and `GOC.api.getVideoFile` on all three drivers (demo, HTTP, facade re-export). |
| **Inline video in the resource viewer** | The `kind === 'video'` branch of `openResourceMediaViewer` and the `mp4 → 'video'` case in `resourceViewerKind`. |
| **Video-only CSS** | `.vthumb`, `.vplay`, `.vbadge`, `.vbadge.live`, `.vdur`, `.player-stage`, `.player-stage .vplay`. `.vcard` / `.vmeta` / `.vtag` were kept because the interim scheduled-class rows use them. |
| **Promises on public copy** | "Live classes, lesson videos and class replays" on the landing page and the sign-up tier cards, and "lesson videos" in the scholarship copy. |

> **Decision still open for the owner.** The stored video records and files are now unreachable from
> the app by design — preserved, not offered. Deleting either the records or the bucket files needs
> separate approval, so both stay exactly as they are.

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
**Added in revision 3:** `test/test-video-excluded.js` (extended to 67 checks in revision 4).

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

**Shared rule added (revision 3), in `js/goc-core.js`, used by both the screen and the server:**
`resourceStudentAccessible()`, `isVideoResource()`, `resourceFileExtension()`,
`VIDEO_FILE_EXTENSIONS`, `VIDEO_EXCLUDED_MESSAGE`. Both routes keep their paths and their tier
guards; only their answer to a student changes.

**Kept and re-verified:** `/api/videos`, `/api/videos/:id/file`, `/api/tutor/analytics`,
`/api/tutor/questions*`, `/api/tutor/notes*`, `/api/tutor/scripts*`, `/api/notes*`, `/api/notices*`,
`/api/broadcasts*`, `/api/alerts*`, `/api/flags*`, `/api/updates*`, `/api/classes`,
`/api/me/study-time/ping`, `/api/resources*`, `/api/league`, `/api/rounds*`, `/api/challenges*`,
`/api/me/tests*`, `/api/results*`, `/api/students/:id/approve`.

**Contract changes on retained routes** (all removals, never redesigns):
- `GET /api/resources/:id/file` — check order changed (revision 4, §2.1): video is refused at step 4,
  before the tier restriction and the download/view decision. The path, the tier rule, the
  `inline`/`attachment` behaviour and the header set for non-video files are all unchanged. The
  now-unreachable `mp4: 'video/mp4'` entry was removed from this route's MIME map; the `/api/videos`
  file route keeps its own MP4 handling.
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

`node test/run.js` — **200 suites passed, 4 FAILED**, unchanged by revision 4 (revision 2 reported
199; `test-video-excluded.js` is the one addition).

The four failures reproduce **identically against the original base commit `950c276`**, re-verified
in a clean `git worktree` after these corrections:

| Suite | This branch | `950c276` baseline |
|---|---|---|
| `test-free2027-local` | 2 FAILED | 2 FAILED |
| `test-production-persistence` | 90 passed, 17 failed | 90 passed, 17 failed |
| `test-backup-integrity` | 158 passed, 34 failed | 158 passed, 34 failed |
| `test-migration-api-config` | 23 passed, 1 failed | 23 passed, 1 failed |

Failure **names** were diffed, not just totals: identical in all four suites once the checkout path
and the ephemeral test ports are normalised out of the message text (e.g. `lhost:38647` vs
`lhost:42669`, `/home/user/goc-academy-hub/build/build.js` vs `/tmp/base/build/build.js`). The one
`test-migration-api-config` failure is the same check failing for the same reason in both trees —
`[both hosting builds complete] — Command failed: node build/build.js`.

**New:** `test/test-study-plan-engine.js` — 50 checks, all passing (revision 2).
**New in revision 3, extended in revision 4:** `test/test-video-excluded.js` — **67 checks**, all
passing, registered in `test/run.js`. It covers the rule format-by-format, the screen filter **and**
the click-time guards, the server list filter, records/routes/audit-tool preservation, and the
absence of any player.

Revision 4 replaced the two loose positional assertions with a **step-by-step order proof** plus a
**live-server section** (§2.1). Proven able to fail: core rule disabled → 5 checks fail; the video
gate put back after the tier branch → **8** checks fail, including the live one that catches the
real defect (an Open student opening a video being told it is a tier problem); screen filter removed
→ 2.

**Requirement 4 verified directly:** `test-resource-download.js` passes unchanged, and
`resourceStudentAccessible()` returns `true` for `pdf/doc/docx/xls/xlsx/ppt/pptx/jpg/png/gif/zip/txt`
and `false` only for the ten video containers.

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
- **Revision 4 touched no data.** One handler's check order changed in `server/server.js`, plus the
  tests and this report. No record was read, written or migrated, and no bucket file was touched —
  the live section of the test writes a throwaway seed to a temp directory that only the stand-in
  Appwrite knows about, and removes it afterwards.
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
   (§2). They are preserved, not offered: the app answers 403 `video-excluded`, it does not delete.
5. **Video management has no in-app replacement, by design** — adding a lesson video would mean
   writing an Appwrite record directly, and it would still not appear to a student: the resource
   interface refuses video by file extension, before the record's category, title or tier is
   considered. That is the intended behaviour, not a gap to close.
6. **The video answer is now the first thing a caller can learn about a video resource.** Anyone
   probing `GET /api/resources/:id/file` with an unguessable id learns "video" from a published
   record even without passing the tier gate. That is the intended consequence of putting the refusal
   first — it is the same answer a student needs — but it is a slightly wider disclosure than
   revision 3's ordering, where a tier failure came first. IDs are unguessable and the fact disclosed
   is only a file type.
7. **No device pass.** The tutorial's six steps, the interim schedule block on Classes and the
   trimmed Classes layout have not been checked on a real phone; this carries the standing caveat in
   `DEPLOYMENT.md`.
8. **`readme.md` keeps a `SUPERSEDED` note** on the "imported questions go to the approval queue"
   entry, because that behaviour was deliberately reversed. Say the word and the log can be rewritten
   instead of annotated.

---

## 8. Not started

Student Homepage implementation: **not started.** Stopping here for final review.
