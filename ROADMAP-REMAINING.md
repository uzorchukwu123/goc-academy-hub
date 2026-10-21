# G.O.C Academy Hub — Remaining Roadmap

> **Rule for anyone making changes:** Never remove or delete any file, folder, function, route, test, or feature unless the project owner explicitly asks for it to be removed. Every change is additive or corrective only. If something looks unused, redundant, or out of date, leave it in place and flag it — do not delete it. This applies to code, comments, test suites, documentation, data files, and configuration.

_Status as of **17 October 2026** — updated from a full code audit. Tests: **177 suites** in `test/run.js` (all pass when run with `GOC_FOUNDER_PW`, `GOC_ACADDIR_PW` and `GOC_PASSCODE` set; `test-appwrite-registration.js` also needs `npm install` for `dotenv`). Cache: **`goc-v178`**._

---

## Fully done (no remaining work)

- ✅ **Phase 0** — Launch readiness (service worker, 300 practice questions, tests)
- ✅ **Phase 1** — Practice sync + Bookmarks (server-authoritative, offline mirror, cross-device)
- ✅ **Phase 2** — Retention: Mistakes review, Streak freeze/repair, Daily & weekly quests, Spaced repetition, Study reminders (email; SMS stubbed; push deferred)
- ✅ **Phase 3** — Exam content: JAMB depth gate, sit rules (one-sit theory/objective; JAMB repeatable with fresh-first), JAMB /400 score, past questions by year, comprehension passages (end to end), question images (end to end)
- ✅ **Phase 3B** — Access tiers: GOC vs Open, all 23 parts including open sign-up, sign-up limits per address, registration approval flow
- ✅ **Phase 3C** — Tutors: accounts, hidden entrance, analytics, at-risk list, top performers, student detail, tutor questions & approval queue, tutor notes, tutor theory marking, class notices, audit log + console screen
- ✅ **Phase 3D** — Shielding: robots.txt, noindex, crawler refusal, obfuscated build, hidden tutor bundle, deploy script
- ✅ **Phase 3E.B** — Resit unblock via console-opened rounds (rounds open per section/subject, `roundId` stamped on attempts, `canSit` counts current-round attempts only)
- ✅ **Phase 3E.C** — Import answer fix: pure rules, preview, replace on re-import, bank checker
- ✅ **Phase 3F** — Registration approval: pending state, console approval/reject tab, sign-up-pending screen, readme section
- ✅ **Phase 4.A** — Ask a tutor (question flags: rules, routes, drivers, student screen, tutor card, console screen)
- ✅ **Phase 4.B** — Results export: CSV and PDF, per term, with JAMB /400 column, console screen
- ✅ **Phase 4.C** — Cohort challenges (team weekly goal → streak freeze per member; friend-invite teams parked)
- ✅ **Phase 4.D** — Tutor question-writing kit: `tutorKitInstructions` / `tutorKitTemplate` / `tutorKitColumns` in `goc-core.js`; "Copy instructions for an AI" + "Download template" card on the Import screen in the tutor dashboard
- ✅ **B#4** — Removed "Practise this topic" from note reader
- ✅ **UI — Console tile navigation** — the dropdown replaced with a tappable tile grid (3 cols mobile, 4+ wider); active tile highlighted; hidden `<select>` kept for programmatic `admOpen()` calls; cache `goc-v177`
- ✅ **B#1 slices (a), (b), (c) partial, (d), (e):**
  - (a) Pure role→capability map (`roleCan`, `capabilitiesOf`, `nextAdminId`, etc.)
  - (b) Capability guard on all ~98 console routes (`need:'console', cap:...` + `adminMayUse` in dispatcher; `test-roles-cap.js`)
  - (c) Managers panel: create, assign subjects, reset password (manager self-change + Founder reset), switch off/on, delete, Managers UI screen, forced password-change page, alert routing by role, study-time capability pinned to Student Affairs
  - (d) Console menu filtered by role (`consoleSectionsFor`, `CONSOLE_SECTIONS`, `admMenuApply`)
  - (e) Manager-action log: rules, server write (dispatcher, `db.managerLog`), `GET /api/audit/manager-actions`, Manager action log screen with CSV export
  - Scoped Overview: `GET /api/admin/overview` now `overview.own`; figures filtered by role capability (`OVERVIEW_FIGURE_CAPS`)

---

## Remaining work — in order

### 🟨 B#1 slice (c) — Second Founder-level account for Academic Director

**What is done:** `GOC-A-002` keeps full access in the code today (all existing titles map correctly). The plan flags that the Academic Director already holds a second Founder-level account.

**What is not done:** the plan asks for a deliberate owner decision to confirm this is intentional and to document it. No new code is required unless the owner wants `GOC-A-002` scoped to the Academic Director role rather than full access.

**Owner action needed:** confirm whether `GOC-A-002` should remain full-access (Founder-equivalent) or be capped to Academic Director role. If the latter, one targeted change in the seed and `adminMayUse` is all that is needed.

---

### ⬜ 3E.A — Clear attempts, keeping XP and performance _(deferred; superseded by rounds for most use cases)_

The owner chose not to build this workaround once rounds were available. Still logged here in case a bulk-clear need arises. No code has been written.

If revived: five slices — pure rules (carry-over record), server route (`POST /api/results/clear-attempts`), drivers, console button in *Results*, and proof tests. **Appwrite note:** needs an optional text attribute for the carry-over on `students`. Owner decisions still to confirm before slice 1.

---

### ✅ UI — Console tile navigation (done, cache goc-v177, 17 Oct 2026)

**What exists today:** the Management Console uses a single `<select id="admSelect">` dropdown (styled with a chevron, in `.adm-select-wrap`) to switch between all 25 sections. `admMenuApply()` filters the `<option>` list by role capability and `admOpen(section)` loads the panel. The section list and capability map live in `CONSOLE_SECTIONS` in `goc-core.js`.

**What the owner wants:** replace that dropdown with a tile grid — one tappable tile per allowed section — so the console landing looks like a dashboard rather than a form field.

**Decisions to confirm before building:**
- Tile layout: fixed grid (e.g. 3 columns on mobile, 4+ on wider screens) or wrap?
- Does each tile carry an icon, a label, or both? (SVG icons already exist for some areas in the codebase.)
- When a section is open, does the tile grid stay visible (sidebar-style) or collapse to show only the active tile + a back link?
- Should the `<select>` be kept hidden as a fallback (for programmatic `admOpen()` calls) or removed entirely?
- Any grouping of sections (e.g. "Content", "People", "Sittings", "Console")?

**Scope (frontend-only, no server changes, no new tests):**
1. Replace `.adm-select-wrap` in `index.html` with a tile-grid container (`id="admTileNav"` or similar).
2. Rewrite `admMenuApply()` in `app.js` to render tiles (one per `consoleSectionsFor(id, role)` entry) instead of filtering `<option>` tags; each tile calls `admOpen(section)` on click.
3. Update `admOpen()` to mark the active tile (add/remove an `active` class) instead of setting `select.value`.
4. Add CSS in `styles.css` for the tile grid (`.adm-tile-nav`, `.adm-tile`, `.adm-tile.active`).
5. Bump the service-worker cache string in `sw.js`.

**No new routes, no new rules, no new tests** — this is a pure UI reskin of the existing navigation.

---

### ⬜ A — Assignments

Auto-marked bank questions + tutor-marked written questions + file uploads; GOC students of the subject only; per-assignment leaderboard; weighted record section (weight 30). No code written.

**Decisions already recorded (owner):** assignment questions go live at once (new `assignment` section tag, kept out of exam/practice draw); file uploads (3 × 5 MB, images/PDF) in the first build; XP = `round(30 × final%)`, recalculated on re-mark.

**Open point to settle before slice 1:** alert routing — which role (Finance? Academic Director?) owns a "new assignment submitted" alert.

**Slices:**
1. ✅ **Pure rules** (`test/test-assignments.js`, M) — `validateAssignment`, `assignment` section tag, deadline/late (−20% flat within 3 days, then rejected, Lagos clock), marking totals + `marked` status, scaled-30 XP, leaderboard (top-10 + own rank, ties = earlier first), record weight 30, reuse-warning.
2. **Server store + create/list/edit** (L) — `db.assignments`/`db.submissions` in data file (no Appwrite collection); tutor (own subject) + console (any); live-at-once + alert; assignment-tagged tutor import **skips approval** (targeted `stampTutorQuestion` change).
3. **Submit/mark/XP/record/alerts** (L) — edit until deadline, late deduction, tutor + console marking (reuses theory-marking flow), auto-mark bank questions on submit, pay XP + update record when fully marked; **re-mark recomputes mark/leaderboard/record/XP/level/league**.
4. **File uploads** (M) — 3 × 5 MB images/PDF via the question-image path; generalise `validateImageUpload` for PDF; first-bytes check; `GOC_DATA_DIR` must persist; blob fetch with the session token; clean-up on removal.
5. **Drivers + parity** (M).
6. **Student screens** (L, cache bump) — Due/Submitted/Marked tabs, answer screen, marked view (answers only once fully marked), leaderboard.
7. **Tutor dashboard** (M, no cache bump) — assignment cards per subject.
8. **Console** (M, cache bump) — create, list, results, mark.

---

### 🟨 B#2 — Scholarship registration page

**Owner decisions settled (17 October 2026):**
- Form is a **dedicated screen inside the app** (`#scholarship`), linked from the homepage with a "Learn more" reference
- **30 places**, free scholarship; accepted applicants become GOC students automatically when the Founder approves
- **Form fields:** name, email, phone, state & city, exam status, subjects, parent/guardian name + email + phone/WhatsApp, pledge checkbox (form cannot submit without it)
- **No "school" or "target course" or "reason" or "device/hours" fields** — stripped from old form
- Public sees **"open" or "closed" only** — no remaining-place count shown
- When 30 places fill: **form closes, Cohort 2.0 waitlist opens** (one mode at a time)
- **Anyone can apply** — new visitors and existing Open students alike
- **One active application per email** — a rejected applicant may reapply; a pending or accepted one cannot submit again
- **Withdrawal hand-off:** Student Affairs marks a "withdrawal requested" note in the app; Finance or Founder carries out the deactivation. The note appears in the console.
- **₦5,000 fee:** Finance Manager records payments by hand in the console (no payment wall yet)
- **WhatsApp contact:** phone/WhatsApp field on the form; if parent/guardian email is missing, decision email goes to applicant only and the Coordinator contacts the parent by phone/WhatsApp herself
- **Deletion requests:** Student Affairs Coordinator handles; deletion appears in the manager-action log
- **Decision emails** from godsowncenterinfo@gmail.com; acceptances need Founder sign-off before sending; rejections go out directly from Student Affairs
- **Thank-you screen** shown after submit; confirmation email sent to applicant
- **CSV export** of all applications (Student Affairs + Founder + Academic Director)
- Capability map already covers this: `scholarship.decide` (SA), `scholarship.approve` (Founder only), `scholarship.view` (AD + SA), `scholarship.export` (SA), `scholarship.delete` (SA)

**Still to settle:**
- Exact wording of the thank-you screen and confirmation/decision emails
- Privacy notice update (covers Student Affairs, CSV downloads, visitor tracking, parent/guardian details of minors)
- How a "withdrawal requested" note surfaces in the console (which panel, what it looks like)

**Slices:**
1. ✅ **Pure rules** (`goc-core.js`, cache `goc-v178`, 17 Oct 2026) — `validateScholarApplication`, `scholarshipOpen`, `canApply`, `makeApplication`, `makeWaitlistEntry`, `scholarshipStatus`, `publicApplication`, `scholarshipCsv`, `scholarshipPlaces` (30), `waitlistOpen`, `NIGERIA_STATES`, `SCHOLARSHIP_EXAM_STATUSES`; `test/test-scholarship.js` (107 checks)
2. ✅ **Server store + routes** (17 Oct 2026) — `db.scholarshipApplications` + `db.scholarshipWaitlist` in data file; `POST /api/scholarship/apply`; `POST /api/scholarship/waitlist`; `GET /api/scholarship/status` (public: open/closed, place count for console); console-gated `GET /api/scholarship/applications`; `POST /api/scholarship/applications/:id/decide` (SA: accept/reject + message); `POST /api/scholarship/applications/:id/approve` (Founder: approve acceptance → creates GOC account); `DELETE /api/scholarship/applications/:id` (SA: deletion request → manager log); `GET /api/scholarship/applications/export` (CSV)
3. ⬜ **Drivers + parity** — `applyScholarship`, `applyWaitlist`, `getScholarshipStatus`, `listApplications`, `decideApplication`, `approveApplication`, `deleteApplication`, `exportApplications` on both drivers; offline demo says it needs a server
4. ✅ **Student-facing screen** (17 Oct 2026, cache goc-v179) — `#scholarship` in `index.html` + `app.js` — dedicated screen; homepage "Learn more" link; open state shows form (fields above + pledge); closed state shows "Applications are now closed"; waitlist state shows waitlist form (name + email + phone); thank-you screen after submit; existing-application notice if already applied
5. ⬜ **Student Affairs console panel** — applications list (filter by status: pending / accepted / rejected / waitlist); each row expandable; accept (type message, optional image) / reject (type message) actions; "Awaiting Founder approval" badge on accepted ones; CSV export button; withdrawal-requested flag on student records
6. ⬜ **Founder approval screen** — accepted applications pending sign-off; approve (sends email + creates GOC account) / send back to SA; appears in existing Approvals panel or its own section
7. ⬜ **Homepage reference** — "Learn more →" card/link on the homepage pointing to `#scholarship`; shows when the scholarship is open or on waitlist

---

### ⬜ B#3 — GOC extra-study-time request (Student Affairs)

Needs the role layer (done ✅). The `studytime.grant` capability is already in the capability map for Student Affairs.

**What remains:** a student-facing "Request extra study time" form (GOC only), a Student Affairs queue in the console to approve/deny, and the server route that grants a temporary window. Small (S) once the exact behaviour is specified.

**Owner decision needed:** what does "extra study time" grant exactly — a one-day XP cap lift, a timed practice window, something else?

---

### ⬜ 4.C slice 8 — Friend-invite teams and inter-team leaderboards _(parked)_

Cohort challenges are done. Friend-invite teams and leaderboards between teams are explicitly parked. No design work done. Pick up after Assignments.

---

## Owner tasks (not code)

These block a real launch and only you can do them:

1. **Set real secrets before first run** — `GOC_FOUNDER_PW`, `GOC_ACADDIR_PW`, `GOC_PASSCODE`. Delete `server/data.json` first if the shipped demo copy is present.
2. **Author real Web Test and JAMB questions** — seed has only thin samples (~6 objective, 2 theory, 1 JAMB per subject). Import via *Console → Import* and check *Console → Question bank* for empty papers.
3. **Phone walkthrough** — sign up, read a note, sit a practice run, sit a Web Test, check results.
4. **Switch on study reminders** (Phase 2) — set `GOC_PUBLIC_URL` and SMTP variables (see `DEPLOYMENT.md`), test with `GOC_REMINDER_DRY_RUN=1`.
5. **Set `GOC_TUTOR_DOOR`** (6+ characters) before giving tutors access.
6. **Confirm `GOC-A-002` access level** — full Founder-equivalent (current behaviour) or capped to Academic Director role? (See B#1 remaining item above.)
7. **Bump `CACHE` in `sw.js`** after any further file change.
8. **Re-import or correct every objective question file imported before 9 Oct 2026** — the import-answer fix (3E.C) repairs the logic but does not touch already-stored questions. Use *Console → Import* with "Replace matching questions" ticked.
9. **Appwrite owners — pending attributes to add:**
   - `tier` (string, optional, size 8) on `students`
   - `practiceCountDay` (string, optional, size 16) and `practiceCount` (integer, optional) on `students`
   - `questDay` (string, optional, size 16) on `students`
   - `weekQuest` (string, optional, size 80) and `streakFreezes` (integer, optional) on `students`
   - `imageId` (string, optional, size 60) and `imageAlt` (string, optional, size 400) on `questions`
   - `passageId` (integer, optional) on `questions`
   - `status` (string, optional) and `addedBy` (string, optional) on `questions` and `notes`
   - `roundId` (integer, optional) on `attempts`
   - `tierChangedBy` (string, optional, size 80) and `tierChangedAt` (string, optional, size 40) on `students`
   - Re-run `node server/setup-appwrite.js` to apply these

---

## Parked (not scheduled)

- **Dark mode**
- **Adjustable text size** (many CSS rules; sizeable effort)
- **Offline / low-data mode** — cache practice questions for no-signal use
- **Payments:** (1) manual "monthly fee paid" flag in console (₦2,000 rejoin fee); (2) online Paystack gateway with server-side confirmation; (3) reminders and receipts
- **Read/unread marking for broadcasts; per-broadcast "resend"; SMS provider**
- **Push notifications** — deferred until service worker is proven stable in the field
- **Contact message handling** — `contactHandling` capability is in the map; the route and screen are not built

---

## Honest limits worth knowing

- Open papers (`openPapers`) live in server memory — a restart or deploy mid-sitting loses in-progress answers. This is accepted for now; persisting open papers would be a targeted server change.
- The tutor question-writing kit generates instructions for an AI (copy/paste); there is no in-app AI integration — the tutor copies the text, pastes it into an AI of their choice, and imports the result.
- Question images and picture files uploaded for questions live in `GOC_DATA_DIR`, not Appwrite Storage. That directory must be a persistent mount in production.
- An uploaded question image that is never linked (or whose question is deleted) stays on disk. No clean-up is built yet.
- Saved questions (bookmarks) snapshots store only text and options — images and passages attached to those questions are not shown in Saved questions or the practice results review rows.
- Team challenges (4.C) fold contributions on the local-file path only; persisting challenge state on Appwrite needs a `challengeState` attribute on the students collection.
- The manager-action log is written synchronously — two requests finishing at the exact same instant could in rare cases lose one entry.
<<<<<<< HEAD

---

## Bug-fix queue (test failures — awaiting sequential application)

The following fixes are diagnosed and ready to apply, one at a time per session.
Fixes 1 and 2 have already been applied (see readme for details).

### Fix 3 — DONE
Seeded a live Chemistry question via admin before the practice-run assertion in `test/test-tutor-questions.js`. Batch import assertions resolved entirely by Fix 2 — no `goc-core.js` changes needed.

### Fix 4 — DONE
Exposed run timeout as `GOC_RUN_TIMEOUT` env var (`const GOC_RUN_TIMEOUT_SEC = Number(process.env.GOC_RUN_TIMEOUT) || (4 * 3600)`); sweep now uses `GOC_RUN_TIMEOUT_SEC` instead of hardcoded `4 * 3600`. Changed `openStudy.set(paper.id, paper)` → `openStudy.set(String(paper.id), paper)` to match the existing `String(body.paperId || '')` lookup on submit — both sides now explicitly coerce to string.

### Fix 5 — DONE
Root cause was manager login returning 401 in test environments, not a missing `role` field. When a manager has an `appwriteUserId`, `verifyAppwritePassword` throws immediately if `config.endpoint`/`config.projectId` are absent — before any network call. The `catch` block silently left `passwordOk = false`. Fix: added `if (account.pwHash) { passwordOk = verifyPassword(password, account.pwHash); }` in the catch, so Appwrite-less environments fall back to the local hash. The `roleKey` and capability enforcement were already correct.

### Fix 6 — DONE
Root cause: all five scholarship console routes used generic capability names instead of their proper `scholarship.*` caps. `GET /applications` used `approvals.review`; `GET /applications/export` used `results.export`; `POST .../decide` used `approvals.review`; `POST .../approve` used `approvals.review`; `DELETE .../:id` used `students.deactivate`. Because `FULL_ACCESS_IDS` (containing GOC-A-001 and GOC-A-002) bypasses cap checks entirely, the Academic Director (GOC-A-002) passed even the SA-only export check. Fix: aligned all five routes to `scholarship.view`, `scholarship.export`, `scholarship.decide`, `scholarship.approve`, and `scholarship.delete` respectively; added an explicit `core.roleCan(sess.data.roleKey, 'scholarship.export')` guard in the export handler (mirroring the Founder title check on approve) so full-access accounts that lack the role still get 403 on SA-only actions. `test-scholarship-route.js`: 57 passed, 0 failed.

### Fix 7 — test-landing-motion: CSS animated properties + reduced-motion guard
**Files:** `css/styles.css`, then rebuild `dist/`
**Diagnosis:** (a) `box-shadow` appears in a `transition:` or `animation:` rule — replace with `filter: drop-shadow(…)` which is GPU-compositable. (b) One `animation:` declaration is outside the `@media (prefers-reduced-motion: no-preference)` guard — move it inside.

---

## GOC_Fix6 Bug-fix queue (from GOC_Fix6_Diagnosis.txt — sequential application)

### GOC_Fix6 — Fix 01 — APPLIED (GOC_Fix6_Fix01.zip)
**Issue:** studyPool() section filter breaks test fixtures
**Root cause:** `studyPool()` filters `r.section !== 'practice'`; test fixtures lacked `section:'practice'` on objective questions.
**Files changed:** `test/test-study.js`, `test/test-study-window.js`, `test/test-quest-reward.js`, `test/test-p3.js`
**Tests fixed:** test-study.js, test-study-window.js, test-quest-reward.js, test-p3.js (partial — Pending C may remain after this fix)

### GOC_Fix6 — Fix 02 — PENDING
**Issue:** Manager creation unconditionally requires Appwrite Auth (CRITICAL — blocks 9+ tests)
**File:** `server/server.js` — POST /api/managers handler + deactivate/reactivate/password-reset/delete guards
**See:** GOC_Fix6_Diagnosis.txt FIX 02 for full proposed change

### GOC_Fix6 — Fix 03 — PENDING (after Fix 02)
**Issue:** Console route capability count mismatch (98 expected vs 109 actual; duplicate tags)
**Files:** `server/server.js` (add missing cap: fields), `test/test-roles-session.js`, `test/test-roles.js`
**See:** GOC_Fix6_Diagnosis.txt FIX 03

### GOC_Fix6 — Fix 04 — PENDING
**Issue:** CSS animation uses box-shadow (reflow)
**File:** `css/styles.css`
**See:** GOC_Fix6_Diagnosis.txt FIX 04

### GOC_Fix6 — Fix 05 — PENDING
**Issue:** Paper length zero/below-ceiling logic (test-p4)
**Files:** `js/goc-core.js` and/or `server/server.js`
**See:** GOC_Fix6_Diagnosis.txt FIX 05

### GOC_Fix6 — Fix 06 — PENDING
**Issue:** question-images-ui DOM position wrong (cbtImage / wtImage)
**File:** `index.html`
**See:** GOC_Fix6_Diagnosis.txt FIX 06

### GOC_Fix6 — Fix 07 — PENDING
**Issue:** Weekly quest tests hang (server not stopped)
**Files:** `test/test-quest-weekly-route.js`, `test/test-quest-weekly-reward.js`
**See:** GOC_Fix6_Diagnosis.txt FIX 07

### GOC_Fix6 — Pending A — PENDING (after Fix 02)
Console menu role filtering broken — inspect after Fix 02 applied

### GOC_Fix6 — Pending B — PENDING (after Fix 02)
academic-director second account refused — inspect after Fix 02 applied

### GOC_Fix6 — Pending C — PENDING (after Fix 01)
test-p3 demo-paper open fails — re-inspect after Fix 01 applied

### GOC_Fix6 — Pending D — PENDING
managerRoles() wrong set / shared reference (test-roles.js unit test)
=======
>>>>>>> origin/main
