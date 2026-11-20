# FINAL PROJECT CLEANUP REPORT — G.O.C Academy Hub

**Date:** 18 November 2026 · **Implementer:** Claude · **Reviewer:** ChatGPT · **Approver:** Ernest

**Branch:** `clean-sweep` (local only). Commits on top of the approved Phase 2 clean sweep (`684c111`):

| Commit | Step |
|---|---|
| `2777b58` | 1/3 Open Students material retired |
| `c9c9a00` | 2/3 Tutor questions go directly into the Question Bank |
| `a382253` | 3/3 Verified-unnecessary files and dependency removed |

Nothing was pushed, merged or deployed. No production data was touched. No database migration was run. `server/data.json` is not tracked. The original ZIP is unchanged. The `baseline` branch still holds the untouched import.

---

## 1. Open Students functionality removed

**What was found.** The Open Student tier had already been retired from the application in an earlier stage ("Stage A"). `test/test-no-open-student.js` guards that retirement and still passes. The live code contains:
- no Open Students navigation, screen, list, directory or registration flow;
- no tier route, permission or configuration.

Every student is a GOC Student with one entitlement set. The tutor dashboard shows only a "GOC students" count.

**What remained, all test-only, now removed:**
- 22 `test/test-tiers-*.js` suites. They tested the removed tier, were not registered in `test/run.js`, and failed.
- `test/legacy-limits.js`, a helper used only by those suites.
- An obsolete `openStudents: 0` field in seven tutor UI test stubs.

**Preserved.**
- Student authentication and accounts.
- Older student records that still carry a stored `tier` value. They load and work with full access; the value is ignored, not deleted.
- Student management in the console (enrol, approve sign-ups, reset passwords, activate or deactivate).

## 2. Tutor approval workflow removed

The approval queue, return-with-reason and batch approval were retired in Phase 2. Phase 2 left an interim "Publish from Question Bank" step; that step is now gone too:

| Retired | Where |
|---|---|
| `POST /api/questions/:id/publish` | `server/server.js` (routes 256 → **255**) |
| `core.publishQuestion` | `js/goc-core.js` |
| `publishQuestion` in the demo, HTTP and delegate API layers | `js/api.js` |
| `admQPublish()` and the **Publish** button on Question Bank cards | `js/app.js` |
| The `content-publish` manager-log action | `js/goc-core.js` |
| `reviewerOf()`, which only the publish route used | `server/server.js` |
| The "pending" count in `GET /api/tutors/overview` (never displayed) | `server/server.js` |
| All "awaiting publication / sent for publication / wait for the admin" wording | tutor app, console, tutor guided tour |
| `test-tutor-approval.js` and `test-question-publish.js` | replaced by the suites below |

The old approval-queue routes (`/api/approvals*`) still answer 404, and the console has no Approvals section.

**Kept on purpose:**
- **`approvals.review` capability.** It is not approval-only: the console's **Question flags** routes and section use it. Renaming it would be a permissions refactor, so it was left as is.
- **Appwrite question attributes** `status`, `addedBy`, `addedByName`, `addedAt`, `editedAt`, `batch`, `reviewedBy`, `reviewedAt` and `returnReason`. These are kept so existing data and the schema stay valid. The helper names changed from `APPROVAL_KEYS`/`approvalPatch` to `QUESTION_META_KEYS`/`questionMetaPatch`; the behaviour is identical.

## 3. Direct tutor-to-Question-Bank workflow verified

The workflow is now **tutor creates a question → it is validated → it is stored live in the Question Bank → it is served.**

- A question that passes the existing checks is saved with `status: 'live'`, stamped with the tutor, name and time. The checks are `core.validateQuestion`, the passage-link and image-link checks, and the own-subject scope. Imported rows also get a batch id.
- Edits by the owning tutor stay live.
- Invalid rows in an import are skipped, reported and never stored.

What `test/test-question-direct.js` (43 checks, real server over HTTP) proves:

| Requirement | Result |
|---|---|
| A tutor creates a question, and it is stored live | ✅ |
| A student is served it immediately | ✅ |
| Subject, topic, section, difficulty, year, answer, options and explanation are kept | ✅ |
| It appears in the console Question Bank, and the subject and section filters work | ✅ |
| Validation refuses missing text, an out-of-range answer, too few options and an unknown section, and stores nothing | ✅ |
| A tutor cannot add to another subject, edit another tutor's question, or forge a status, author or review mark | ✅ |
| Students, strangers and management (on the tutor route) cannot create tutor questions | ✅ |
| Edits stay live and are served | ✅ |
| An import stores valid rows live and skips invalid rows | ✅ |
| Seeded questions are unchanged | ✅ |
| A historical pending record is preserved exactly, is not served, and goes live only when its tutor edits it | ✅ |
| The publish, approval, approve, return and batch routes all answer 404 | ✅ |
| Question flags still work | ✅ |
| The console card has no Publish button and labels historical records | ✅ |

Supporting suites:
- `test/test-tutor-question-rules.js` (35 checks, pure rules).
- `test/test-tutor-questions.js` (55 checks) and `test/test-tutor-questions-ui.js` (31 checks), both updated.

**Historical `pending` and `returned` records.** Records the retired process left behind are **not migrated**, because that would need an approved migration plan.
- They stay exactly as stored and are not served, as before.
- The tutor app and console label them "Not shown to students".
- Their tutor can make one live by editing and saving it.
- Ernest decides whether to bulk-release them (see §12).

## 4. Files deleted

Each file was checked against every reference type before removal: references, imports and exports, dynamic loading, HTML, build and deploy lists, tests, docs, and selected-feature use.

| File | Why it is unnecessary | References found |
|---|---|---|
| `GOC-Weekly-Class-Schedule-updated.png` (292 KB) | Artwork for the retired Timetable ("My Study Timetable") | none |
| `docs/jamb-cbt-screenshots/*.png` (9 files, 1.07 MB) | Screenshots that no document links to | none |
| `REMAINING_TASKS_3C.txt` | Stale October task log | none |
| `ROADMAP-REMAINING.md` | Roadmap from 17 Oct that still lists retired features | readme link only, updated |
| `server/lib/demo-questions.js` | Superseded sample pool; the homepage preview draws from the real bank | none (never required) |
| `server/export-questions.js` | Script that exports the seed bank as SQL for a Supabase setup that was never adopted | `build/deploy.js` list, `test-deploy.js` fixture and readme rows, all updated |
| `test/test-appwrite-registration.js` | Unfinished script against the **live** Appwrite project ("will be completed in the next step"); never run by `test/run.js` | `run.js` comment and AUDIT.md (historical), comment updated |
| 22 × `test/test-tiers-*.js` and `test/legacy-limits.js` | Tested the removed Open Student tier; not run | none outside themselves |
| `test/test-tutor-approval.js` and `test/test-question-publish.js` | Covered the retired approval and publish behaviour | replaced in `run.js` |

The tracked file count went from 350 to 313: 40 removed, 2 suites added, and this report.

## 5. Files retained (checked and still required)

- **Application:**
  - `index.html`, `css/styles.css`, `css/free2027.css`, `sw.js`, `manifest.webmanifest`, `robots.txt`, `sitemap.xml`
  - `icons/*`, all four of which are referenced by the manifest, sitemap or service worker
  - every file in `js/`
- **`js/vendor/pdfjs/`:** loaded dynamically with `import()` by the Resources and notes PDF viewer.
- **Server:**
  - `server/server.js` and every `server/lib/*` module, which are all required;
  - `server/pdf-writer.js`, for the results export.
- **Operational and recovery tools:**
  - `server/setup-appwrite.js` and `server/verify-media.js`, both in the deploy list;
  - `server/migrate-tutor-ledger.js` and its runbook `docs/tutor-appwrite-ledger.md`.
- **Appwrite integration:**
  - `appwrite.json`;
  - all of `functions/goc-api/`, including the route inventory and coverage, both regenerated.
- **Build and deploy:** `build/build.js`, `build/deploy.js`, `ecosystem.config.cjs`, `start-server.ps1`.
- **Configuration templates:** `.env.example` and `.gitignore`.
- **Docs:**
  - readme, DEPLOYMENT, DEPLOY-CHECKLIST, LOCAL-DEVELOPMENT, MAINTENANCE-MODE;
  - the APPWRITE-* guides; APPWRITE-TEST-REPORT, which is referenced by the migration and rollback guides and by `preflight.js`;
  - `docs/free-tutorial-*.md`;
  - CLEAN-SWEEP-REPORT.md.
- **Test infrastructure:**
  - `test/run.js` and all 221 registered suites;
  - the helpers `active-student.js`, `legacy-attempts.js` and `minidom.js`;
  - `test/appwrite-stub/`, `test/stubs/` and `test/browser/free2027-recovery.js`, which LOCAL-DEVELOPMENT documents.
- **The Free UTME 2027 application:** retained in full, as a surviving application.

## 6. Dependencies removed

| Package | Evidence |
|---|---|
| `appwrite` ^17 (browser SDK) | No `require`/`import` anywhere; the server and functions use `node-appwrite`. Removed from `package.json` and `package-lock.json`. It had no sub-dependencies, so no other lock entry changed. |

## 7. Dependencies retained

| Package | Used by |
|---|---|
| `node-appwrite` | `server/lib/appwrite.js`, `server/server.js` (Query, InputFile) and `functions/goc-api` |
| `busboy` | multipart uploads in `server/server.js` |
| `dotenv` | `server/lib/appwrite.js` and setup scripts |
| `nodemailer` | the mail relay in `server/server.js` (loaded lazily) |
| `esbuild` (dev) | `build/build.js` minification |

## 8. Shared modules protected

- `js/goc-core.js`: the question status functions are kept and are still used by every serving path: `questionStatus`, `questionIsLive`, `liveQuestions`, `stampTutorQuestion`, `tutorOwnsQuestion`, `tutorEditQuestion`, `tutorQuestions` and `lastTutorUpload`.
- `approvals.review` is kept because Question flags use it.
- Question metadata storage mapping is kept, renamed only.
- From Phase 2, still intact:
  - the dormant JAMB CBT engine;
  - the planner model;
  - the shared question-rendering helpers;
  - the H15/H16 protections, which were not touched.

## 9. Data preservation checks

`tools/verify-data.js` boots the **original** code, builds realistic records, then boots the **final** code on the same data directory. The records include students, marked Objective attempts, a theory script awaiting marking, live, returned and pending questions, a Guardian PIN with bonus minutes, notes, Free 2027 data and backups.

- **All 33 collections are identical**, comparing record counts and content hashes. This includes questions (107 → 107), attempts, students, tutors, notes, settings, Free 2027 data and the manager log.
- Question statuses after: Q1 `live`, Q2 `returned` (its reason kept), Q3 `pending`. Nothing was published automatically.
- Guardian PIN `4321` and the bonus minutes are preserved.
- Every earlier backup is still present.
- No code path deletes video records or files.
- No secrets were found in tracked files: `.env.example` holds placeholders only.

The demo driver's published default staff passwords and console passcode (`js/api.js`) are already known. The real server refuses them.

## 10. Test results

`node test/run.js`, with the same environment and counting method as the Phase 2 report:

| | Phase 2 end | **Final** |
|---|---|---|
| Suites passed / failed | 216 / 5 | **216 / 5** |
| Checks passed / failed / skipped (same counting) | 9,189 / 63 / 8 | **9,193 / 63 / 8** |
| New failures | none | **none** |

Phase 2's report gave 11 skipped; counted the same way on the same log, the figure is 8.

The 5 failing suites are the same ones that fail on the untouched baseline. They need `node-appwrite`, `busboy` or `esbuild`, which this offline environment cannot install:
- `test-backup-integrity`
- `test-free2027-local`
- `test-migration-api-config`
- `test-production-persistence`
- `test-student-notes`

**Run `npm ci && npm test` with registry access before release.**

## 11. Remaining unused or uncertain files

Retained, for Ernest's decision:
- **`AUDIT.md`:** a 4 Nov audit whose security findings may still matter. CLEAN-SWEEP-REPORT.md references it.
- **`docs/round2-verification.md`, `docs/recovery-verification.md`, `docs/account-restoration.md`:** verification records for earlier pull requests. They are historical rather than operational; delete them if you don't want project history in the tree.
- **The readme's long "Fix 1–6" changelog:** historical. Some lines still name tests that have since been retired.
- **Pre-existing unused functions:** `openLesson`, `mthPlain`, `openCBT`, `openPastQuestions`, `suToggleYear`, `refreshReview` and `openMyNotes` in `js/app.js`, and `touchSession` in `js/api.js`.
  - None of them is called from application code, but they were already unused in the original import, so they are not remnants of the retired features.
  - Several are referenced by tests.
  - They were left alone because removing them would be the unrelated refactoring the brief rules out.
- **`jambConfirmStart` and the rest of the JAMB CBT:** dormant, by Ernest's earlier decision.

## 12. Outstanding risks and decisions

1. **Historical pending or returned tutor questions stay hidden.** No migration was run. If production holds any, they stay invisible to students until each tutor re-saves them. A bulk release needs a separately approved migration plan.
2. **Content now reaches students without review.** Validation still blocks malformed questions but not factually wrong ones. Teachers' mistakes are corrected after the fact, by tutor withdraw or edit, admin deactivate, and Question flags.
3. **Not verified here:** the full test suite with real dependencies, and a hands-on device walk-through of the tutor and console screens.
4. **Still open from Phase 2:**
   - the unresolved catalogue IDs;
   - the identities of H15/H16;
   - mp4 files in Resources;
   - live-class Zoom links that students can no longer see;
   - leftover "Web Test" wording;
   - scholarship copy that still promises retired features.

**Stopping here for ChatGPT's review and Ernest's approval. No redesign has been started.**
