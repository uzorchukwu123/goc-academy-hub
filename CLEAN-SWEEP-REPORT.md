# G.O.C Academy Hub — Clean-Sweep Report (Phase 2)

**Implementation agent:** Claude · **For review:** ChatGPT · **For approval:** Ernest Uzorchukwu Jesusanusi
**Date:** 18 November 2026 · **Status:** COMPLETE, awaiting review. Nothing has been pushed, merged or deployed.

| Item | Value |
|---|---|
| Source | `116dba27-GOC-Academy-Hub-main.zip`, SHA-256 `978865ff…13e2e7f1` — **unchanged** (re-verified after the work) |
| Working copy | local Git; branch `baseline` = untouched import `8bd8e49`; branch `clean-sweep` = 10 commits on top |
| Backup taken before implementation | `backup-before-phase2.tgz` (whole working copy) |
| Product-owner decisions applied | Phase 2 instruction (18 Nov 2026) + "Keep it dormant" for the JAMB CBT entry (asked during implementation, see §8) |

**Commits on `clean-sweep`** (one per stage, each with a passing full suite):
```
6d30f58 retire: Next Activity dashboard card
85bbdd1 retire: Guardian PIN study-time extension
7e7c7bb retire: standalone Timetable screen and its navigation
025be51 retire: Web Test catalogue and Objective/Theory sittings; separate JAMB CBT
3456ede retire: student video library/playback and admin video management
49beb18 retire: Console approval queue and tutor approve/return workflow; publish from Question Bank
4c87fc9 retire: Tutor Analytics inside the Admin Console
12347b8 clean sweep: remove orphaned CSS, bump service-worker cache, regenerate route inventory, update docs
(+ this report)
```

---

## 1. Updated project folder
Delivered as `GOC-Academy-Hub-clean-sweep.zip`. It contains the full working copy, **including the `.git` folder**, so every stage can be inspected (`git log`, `git diff baseline clean-sweep`) or reverted on its own. There is no `node_modules`, no `.env` and no `server/data.json`.

## 2. Retired features (by descriptive name)

| # | Feature | Category | What was removed |
|---|---|---|---|
| 1 | **Next Activity** — Home "Waiting for you" card | A | `#tut-webtest`/`#dashNext` markup, `dashPaintNext()`, `dashRow()`, its tour step |
| 2 | **Guardian PIN** — "Add 15 min" study-time extension | A | Wind-down PIN field and `swExtend()`; console Study-window PIN control (`paintGuardianPin`, `admSetGuardianPin`); `POST /api/me/study-time/extend`; guardianPin handling in `GET/PUT /api/settings` and `effectiveSettingsFor`; `setGuardianPin`/`extendStudyTime` (all 3 drivers); core `normalizeGuardianPin`, `guardianPinMatches`, `EXTRA_TIME_*` |
| 3 | **Standalone Timetable** page | B | `#timetable` (week strip, day view, "Add a study block" form) and its renderers (`buildWeek`, `renderDay`, `toggleAddBlock`, `populateAddBlockSubjects`, `submitStudyBlock`) |
| 4 | **Standalone Timetable navigation** | B | Home "Carry on" Timetable shortcut, `go()` tab/section entries, tour copy, Free UTME original-area entry |
| 5 | **Web Test catalogue** | B | `#webtest` (sessions list, history, lead), `openWebTest`, `wtLoad`, `renderWebTest`, `WT_SECTIONS`, `wtRowEl`, `wtNoTheorySubjects`, `wtLoadHistory` |
| 6 | **Objective/Theory sitting selection and start** | B | `wtStart` (non-JAMB), `wtConfirmStart`, `wtInstructions`; server and demo driver now refuse `objective`/`theory` at `POST /api/me/tests/start` (410) and list only JAMB in `GET /api/me/tests` |
| 7 | **Objective/Theory examination runner** | B | `#wtRun` (clock, palette, theory answer box, submit), `wtPaintHead`, `wtBuildGroups/Nav`, `wtGroupAt/Done`, `wtOpenSubject`, `wtPaintSubjects`, `wtAnswered`, `wtRender`, `wtPick`, `wtTyped`, `wtGo`, `wtMove`, `wtStartClock`, `wtNoClock`, `wtUnanswered`, `wtSubmit`, `wtExit`, the question-panel `'wt'` mode |
| 8 | **Web Test student entry points** | B | Study-hub "Web Test" tile, the dashboard link, tour steps, Web Test wording in student copy (practice note, league note, empty results) |
| 9 | **Student video playback** | B / Part 5 | `playVideo`, `videoCard`, the on-disk playback cache and range streaming (`ensureVideoCached`, `streamVideoFile`, `clearCachedVideo`, `VIDEO_CACHE_DIR`) |
| 10 | **Student-facing video resource library** ("Classes" tab = Lesson videos) | B / Part 5 | `#classes`, the tab-bar tab, the Home shortcut, `renderClasses`, `renderClassFilters`, `setClassFilter`, `loadPublishedVideos`; routes `GET /api/videos`, `GET /api/videos/:id/file`; `listPublishedVideos`, `getVideoFile` |
| 11 | **Admin video management interface** | F | Console → Videos (tile, option, markup, tour copy, `CONSOLE_SECTIONS` entry); `admLoadVideos`, `admRenderVideos`, `admSetVideoPublished`, `admDeleteVideo`, `admVideoFilePicked`, `admUploadVideo`; routes `GET/PUT/POST/DELETE /api/admin/videos*`, `handleVideoUpload`; `listVideos`, `uploadVideo`, `setVideoPublished`, `deleteVideo`; manager-log `video-delete` |
| 12 | **Console approval queue** | F | Console → Approvals (tile, option, markup, badge, tour step, `CONSOLE_SECTIONS` entry), all `admAp*` functions; routes `GET /api/approvals`, `POST /api/approvals/batch/approve`; core `approvalQueue`, `approveBatch`, `pendingCount` |
| 13 | **Tutor question approval operation** | E | `POST /api/approvals/:id/approve` ("approve" and "edit then approve"); `approveQuestion` (all 3 drivers); core `reviewQuestion` → replaced by `publishQuestion` (§8) |
| 14 | **Tutor question return operation and return-reason workflow** | E | `POST /api/approvals/:id/return`; `returnQuestion` (all 3 drivers); core `RETURN_REASON_MIN/MAX` and the return branch; the tutor app's "Returned: <reason>" display; "approval" wording in the tutor app |
| 15 | **Tutor Analytics inside the Admin Console** | F | Card in Console → Tutors, `admTutAnalyticsLoad()`, `GET /api/admin/tutors/analytics`, `adminTutorAnalytics` (all 3 drivers) |
| 16 | Retired-feature **permissions/flags** | — | `STUDENT_FEATURES.videos`, `.classRecordings`, `.webTestObjective`, `.webTestTheory` (now refused, fail-closed); core `videoFeature`, `videoAllowed` |

**Direct and hidden access closed.** `go()` now carries a `RETIRED_SCREENS` guard (`timetable`, `webtest`, `wtRun`, `classes`), so a stale handler, cached page or deep link lands on Home instead of an empty screen. All 11 retired routes answer 404, verified live. The service-worker cache was bumped (`goc-v224` → `goc-v225`) so installed PWAs drop the old shell. A comment-stripped grep of every shipped JS/HTML file for 51 retired identifiers, routes and element ids finds **zero** live references.

## 3. Selected features preserved
Everything not listed in §2. In particular:
- **Student:** Home dashboard (identity, Scholar ID, level/XP/streak, study-window ring, broadcasts, notices, journey/Continue Learning, "Where you stand", "Your last result", Carry-on shortcuts to Practice, Resources and Profile), tab bar / desktop sidebar (Home · Study · League · Profile), Study hub, Read/Learn notes, PDF reader, My notes, Practice, self-directed CBT, Results & Review (including historical Objective/Theory papers), Bookmarks, Mistakes, Spaced review, Resources (including mp4 resources, see §11), League, Profile, streak freeze, quests, reminders, affirmations, wind-down overlay and daily study window, Ask a tutor / flags, public demo.
- **JAMB CBT** (dormant, no entry, per owner decision): engine, JAMB question pool and readiness gate, sessions, timer, palette, calculator, keyboard controls, submission confirmation, session recovery, scoring (/400), historical results.
- **Tutor:** sign-in and setup, dashboard, own analytics, at-risk, top performers, student lookup, audit, question creation / editing / import / withdraw / delete, notes, notices, flag replies, theory marking (historical scripts), kit, tour.
- **Console:** all 25 remaining sections, including Students, registrations, Question Bank (now with Publish), Import, Notes, Passages, Resources, Live classes, Broadcast, Homepage, Affirmations, Results, Mark theory, Leaderboard, Objective sitting, JAMB sitting, Study window, Tutors (plus Subjects & tutors and the access log), Managers, Flags, Challenges, Access & firewall, Site analytics, Scholarship, Overview, Cohorts.
- **Communication (C)** and **Scholarships (D):** untouched.
- **Free UTME 2027 (G):** untouched and separate. `server/lib/free2027.js`, `js/goc-free-2027.js`, `js/free2027-api.js` and `js/free2027-admin.js` have **0 diff lines**. `js/free2027-ui.js` only drops the retired hub screen ids from its hub-screen list. `css/free2027.css` only drops 4 retired-id selectors.
- **Infrastructure (H):** all of it, including H15/H16 candidates (§13).

## 4. Files removed
| File | Why |
|---|---|
| `test/test-approvals-ui.js` | Tested only the retired Console approval-queue screen |
| `test/test-approvals-edit.js` | Tested only the retired "edit then approve" route |

No application file was deleted, and no data file exists in the project.

## 5. Files modified (61) and added (2)
- **Added:** `test/legacy-attempts.js` (fixture helper: writes historical Objective/Theory attempts into a sandbox with the same core rules the old submit used) and `test/test-question-publish.js` (new suite for the replacement publish path).
- **Application:** `index.html`, `sw.js`, `css/styles.css`, `css/free2027.css`, `js/app.js`, `js/api.js`, `js/goc-core.js`, `js/onboarding.js`, `js/tutor-app.js`, `js/free2027-ui.js`, `server/server.js`, `build/build.js` (adds `_openLegacyPaper` to the stripped test hooks).
- **Generated by the project's own tools:** `functions/goc-api/route-inventory.json`, `functions/goc-api/coverage.json`.
- **Docs:** `readme.md` (new "Clean sweep" section, retired descriptions replaced, cache version and the stale "data.json ships" step corrected), `DEPLOY-CHECKLIST.md`.
- **Tests (44 suites edited):** each retired-feature assertion was converted to a "retired" or "refused" assertion. Shared coverage was kept and re-pointed: integrity checks now run on JAMB papers, marking/league/analytics run on historical records, and planner filtering runs on the kept planner model. Plus `test/run.js`.
- Full list: `git diff baseline clean-sweep --name-status`. Totals: 65 files, +1,345 / −4,702 lines.

## 6. API routes removed (11)
| Route | Tier / capability | Feature |
|---|---|---|
| `POST /api/me/study-time/extend` | student | Guardian PIN |
| `GET /api/videos` | student | Student video library |
| `GET /api/videos/:id/file` | student | Student video playback |
| `GET /api/admin/videos` | console / resources.publish | Admin video management |
| `PUT /api/admin/videos/:id/published` | console / resources.publish | Admin video management |
| `POST /api/admin/videos/upload` | console / resources.publish | Admin video management |
| `DELETE /api/admin/videos/:id` | console / resources.publish | Admin video management |
| `GET /api/approvals` | console / approvals.review | Approval queue |
| `POST /api/approvals/batch/approve` | console / approvals.review | Approval queue |
| `POST /api/approvals/:id/(approve\|return)` | console / approvals.review | Approve / return operations |
| `GET /api/admin/tutors/analytics` | console / tutors.accounts | Admin tutor analytics |

**Added (1):** `POST /api/questions/:id/publish` — console / approvals.review (the required replacement, §8).

**Changed behaviour, route kept:** `GET /api/me/tests` lists only the JAMB sitting. `POST /api/me/tests/start` answers **410** for objective/theory. `POST /api/me/tests/submit` is unchanged, so a paper already open at deploy can still be handed in. `GET /api/settings` no longer sends `hasGuardianPin`/`guardianPin`. `PUT /api/settings` ignores `guardianPin` and leaves the stored value alone.

## 7. API routes preserved
**255 of the original 266** routes, plus the new publish route, makes **256**. Re-extracted with `functions/goc-api/tools/extract-routes.js`; the full table is in `functions/goc-api/route-inventory.json`. By family: auth 7 · me 36 · students 6 · registrations 11 · admin 16 · staff 3 · updates 3 · demo 2 · affirmations 2 · contact 1 · unsubscribe 1 · settings 6 · objective 1 · jamb 1 · rounds 3 · challenges 3 · tutor 29 · audit 2 · notices 2 · flags 2 · broadcasts 4 · alerts 2 · tutors 6 · managers 5 · passages 5 · notes 8 · league 1 · topics 2 · questions 13 · import 1 · results 4 · resources 2 · question-images 1 · classes 1 · scholarship 8 · free2027 53 · analytics 2 · health 1. The capability count is unchanged at 33.

## 8. Shared functionality separated or preserved
| Dependency | How it was handled |
|---|---|
| **JAMB CBT ↔ Web Test** | JAMB was reachable only through Web Test code. Separated: result screen `#wtResult`, `wtShowResult`, `wtOpenResult` and `wtPaint*` kept, with back buttons now going to Results. Leaving a JAMB paper returns to Study (was `go('webtest')`). The recovery banner `#jtResume` moved to the Study hub and appears only when an interrupted sitting is saved. `jambInstructions`, `jambConfirmStart` and `jambStart` are kept with **no caller** (owner chose "dormant"). Shared helpers kept: `OPT_KEYS`, `wtSectionLabel`, `wtPeriodLabel`, `mmss`, `wtMinutes`, `wtWhen`, `wtPapersLine`, **`paintPassage`, `paintQImage`, `qImgSeq/qImgUrls`**. Those last helpers lived in the Web Test section but are used by the CBT runner; they were briefly lost during Stage 4, caught by `test-study.js`, and restored before the commit. |
| **Study Plan ↔ Timetable** | DOM-free planner model kept and not run at boot: `week`, `dayKeys`, `dayNums`, `curDay`, `loadUpcomingClasses()` (GET /api/classes, Zoom link and lock state kept), `dayBlocks()`, `addStudyBlock()` (the data step separated from the retired form), `timeInputTo12`, `blockSortKey`, `sortDayBlocks`. `GET /api/classes` and `liveclasses` are untouched. No planning data existed to preserve: student blocks were always memory-only. |
| **Tutor publication ↔ approval queue** | Tutor questions still arrive `pending` (`stampTutorQuestion` unchanged) and reach no student. Management publishes from the **Question Bank**: a status tag and a **Publish** button on pending cards (`admQStatusTag`, `admQPublish`) call `POST /api/questions/:id/publish`. That route uses the **same `approvals.review` capability** (Academic Director and Founder, as before) and `core.publishQuestion`: management only, pending only, never one's own. **Nothing is auto-published.** Each action is logged as `content-publish`. |
| **Question flags ↔ approvals.review** | Capability kept; flag suites and the new suite confirm flags still work. |
| **Tutors-overview pending count** | It was computed by the removed `approvalQueue`; now computed inline with `core.questionStatus` (same result). |
| **Resources ↔ video** | `resources.publish` kept; Resources upload and file delivery untouched (the video cache/stream helpers were video-only). |
| **Tutor-owned analytics ↔ admin analytics** | `GET /api/tutor/analytics` and the shared calculations (`tutorSnapshot`, `tutorActivity`, `tutorTheoryStats`, `rankWeakTopics`, `rankHardestQuestions`) are untouched. |
| **Study window ↔ Guardian PIN** | `studyBonusMinToday` kept: bonus minutes already granted today still count. The window, the wind-down overlay and the shared login throttle are untouched. |
| **Theory marking, results, league, analytics ↔ Objective/Theory attempts** | All keep reading historical attempts. Tests that need such records now write them as historical fixtures (`test/legacy-attempts.js` for server sandboxes; the build-stripped mock hook `_openLegacyPaper` for the demo driver). No production backdoor re-opens a retired sitting. |

## 9. Data-preservation verification
Method (`cleansweep/tools/verify-data.js`, outside the project):
1. Boot the **untouched baseline** server and build a record through its own API: 2 students, 2 Objective + 1 Theory attempts, tutor questions live / returned-with-reason / pending, a Guardian PIN (`4321`), a granted extension (+15 min), and settings.
2. Boot the **clean-sweep** server on the **same data directory**. Sign in, read results and the bank, save settings while still sending `guardianPin: '9999'`, and hit every retired route.
3. Compare every collection.

**Result:** all **33 collections identical** (SHA-256 per collection). The only change is `_savedAt`, the file's own timestamp.
- `settings.guardianPin` is still `4321`, and the student's `studyBonusMin`/`studyExtendCount` are still `15`/`1`.
- 3 of 3 attempts are unchanged.
- Question statuses are unchanged (live / `returned (Needs a clearer stem)` / pending). Nothing was auto-published.
- The `free2027` record is unchanged.
- Every earlier backup is still present (a new one was added by the boot, as designed).
- Retired routes: extend / videos / approvals / admin videos / admin tutor analytics all return 404.

**Appwrite data (videos, files, liveclasses):** a static check shows no code path deletes them. There is no `deleteDocument` on the videos collection and no collection, database or bucket deletion anywhere. The only remaining reference to the videos collection is the read-only Overview count. `deleteFile` calls went from 6 to 5, the removed one being the admin video delete. No delete call was added anywhere. No migration was run and no production data was touched.

Limitation: the flag fixture in step 1 used the wrong payload shape (400), so flags weren't in that data set. They're covered by the passing flag suites.

## 10. Test results
| | Baseline (untouched) | After clean sweep |
|---|---|---|
| Registered suites | 222 | 221 (−2 queue-only, +1 new) |
| Suites passed | 217 | **216** |
| Suites failed | 5 | **5 — the same five; no new failure** |
| Individual checks passed / failed / skipped | 9,424 / 64 / 11 | 9,189 / **63** / 11 |

- The drop in passing checks is the assertions removed with retired features. Every retired feature gained explicit "retired" or "refused" assertions instead.
- The 5 remaining failures are all missing dependencies: `node-appwrite` for test-free2027-local, test-production-persistence and test-backup-integrity, `busboy` for test-student-notes, and `esbuild` for the build check in test-migration-api-config.
- **Correction to my Stage 1 baseline report:** `test-migration-api-config.js` also contained one **genuine** pre-existing failure. It pinned the service-worker cache to `goc-v223` when the file said `goc-v224`; I had classified the whole suite as dependency-only. That pin now tracks the current cache, which is why failing checks went from 64 to 63.
- `npm install` was not possible in this environment (package registry blocked). **Before release, run `npm ci && npm test` on a machine with registry access**; the 5 suites should then pass.
- The silent-skip count is unchanged (11). One silent skip introduced during Stage 4 (`test-tutors-analytics`) was found and replaced with an explicit assertion.

## 11. Known issues and remaining limitations
1. **No real-browser or device check was possible here** (no browser in this environment). Layout after removing a tab-bar item (now 4 items), the Study hub without the Web Test tile, and the desktop sidebar should be checked by hand at phone and desktop widths.
2. **Live-class Zoom links have no student surface now.** The Timetable was their only view. The data, `GET /api/classes` and the console Live-classes section are kept for the future Study Plan.
3. **mp4 files in Resources** can still be opened in the Resources viewer. Resources is a selected feature and its upload accepts `.mp4`, so I did not treat it as "student video". **Please decide** whether video-type resources should be hidden.
4. **Objective/Theory dependents kept, now historical-only:** console *Objective sitting* configuration, *resit rounds*, console and tutor *theory marking*, the tutor *at-risk* and *top performers* "Web Tests" figures. These were not named for retirement; some may be among the unmapped F/E IDs (§12).
5. **Leftover wording in preserved features:** the console Question Bank still calls its assessed bank "Web test", and there are "Web test rounds" / "Web test results" cards and the tutor's "Web Tests" tab. The scholarship page promises "Web Tests, live classes, lesson videos" (category D, left untouched). The console Overview's "lessons published" figure still counts published video records. All are left for the redesign or the owner's call.
6. **Returned questions:** records the old queue returned stay `returned`. Management cannot publish one as it stands; its tutor edits it, which makes it pending. The return reason stays stored but is no longer shown.
7. **CSS:** one rule removed by the orphan sweep (`.continue .play`) was already dead before this sweep.
8. **Build/deploy** (`npm run build`, `npm run deploy`) could not run here (esbuild missing). `test-build.js` asserts the new `_openLegacyPaper` test hook is stripped, but that check is skipped without esbuild.
9. **Security findings from Stage 1 are untouched, as instructed:** the `X-Forwarded-For` login/sign-up throttle bypass, `ctaAction` from news updates injected into `onclick`, and missing CSP/HSTS headers. They are recommended as a separate, approved change.
10. The 22 orphaned `test-tiers-*.js` suites (old tier system, unregistered, failing) are left as found.
11. The functions/goc-api port is still 1 of 256 routes implemented.

## 12. Unmapped exclusions still requiring identification
No feature catalogue exists in the ZIP, its docs or the Project; a second full search during Phase 2 confirmed this. The names below are therefore **not** asserted to be those IDs, and **nothing else was retired on a guess.**

| Range | IDs | Retired by name in this sweep (probable mapping) | Still unresolved |
|---|---|---|---|
| A (30) | A06, A08, A10, A25 | Next Activity, Guardian PIN | **2 IDs** |
| B (84) | B02, B06–B09, B24, B40, B76–B77 (9) | Timetable page, Timetable nav, Web Test catalogue, Objective/Theory selection & runner, Web Test entry points, student video playback, student video library | **≈2** (depends on how Web Test and video split into IDs) |
| E (30) | E17–E20 | Tutor approval operations, tutor return operations, return-reason workflow, tutor-side approval status view | **0–1** |
| F (90) | F02, F44–F46, F67, F71, F90 (7) | Console approval queue, admin video management, admin tutor analytics | **4 IDs** |

**Most plausible candidates for the unresolved IDs:** console Objective-sitting config, resit rounds, console Mark theory, Live classes, Cohorts, Team challenges, Site analytics, the public demo, League, Badges/quests/streak freeze. All of these are **kept** until the catalogue confirms otherwise.

## 13. H15/H16 security assessment status
**Not touched. Identities not confirmed.** Byte-level checks show these unchanged: the copy-guard (contextmenu block, `.protected` user-select), the reading watermark, the static-file rate limit, the login, contact, Founder and tutor throttles, `X-Frame-Options`, `serveStatic`, password hashing, and the default-secret boot refusal. The strongest candidates remain the **reading watermark** and the **copy-guard**, shown in the profile as "Content protection — Watermark & copy-guard"; the next is the static-file rate limit. The full assessment is in `CLEAN-SWEEP-AUDIT.md` §7. A separate security review and approval is needed before either is retired.

## 14. Summary
All 16 confirmed unselected features named in the Phase 2 instruction are retired, together with their navigation, screens, JavaScript, CSS, routes, API methods, permissions, tour steps, tests and docs. Each retired screen or route is also closed to direct access. The JAMB CBT was cut loose from the Web Test and kept dormant as decided. Tutor questions publish through the Question Bank under the same publishing control as before. Every stored record was verified unchanged, and the test suite shows no new failures.

**Open for ChatGPT review / Ernest's decision:**
- (a) the unresolved catalogue IDs (§12)
- (b) H15/H16 identities (§13)
- (c) mp4 resources (§11.3)
- (d) the historical-only Objective/Theory console and tutor features (§11.4)
- (e) the leftover Web Test wording in preserved features (§11.5)
- (f) a device walk-through and a dependency-installed test run before any deploy

Per the instruction, the Student Home Dashboard redesign has **not** been started.
