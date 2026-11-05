# G.O.C Academy Hub — Independent Codebase Audit

Audited commit: `388ba06` ("Fix five live defects: empty Practice bank, missing year picker, unreachable console sections, tutor analytics, manager roles"), branch `arena/34f626d7-goc-academy-hub`.
Audit date: 2026-11-04. Environment: Node v22.22.3, npm 10.9.8, Linux sandbox (UTC), dependencies installed with `npm ci`.

---

## 1. Executive Summary

The codebase is in substantially better shape than the reported problem list suggests. Several headline defects (empty Practice seed bank, missing year picker, unreachable console sections) were **already fixed in the audited commit** and could not be reproduced. The full test suite — 182 suites, 6,907 assertions — **passes completely** (exit code 0), with one deliberately skipped live-Appwrite check.

Confirmed, still-present defects:

1. **Streak freeze price is 100 XP, not the intended 500 XP** (`js/goc-core.js:79`). UI and server agree with each other (both read the same constant) — the constant itself is wrong.
2. **Daily streak/XP/quest calculations use the machine's local timezone** (`core.dayStamp()`), while daily practice/review allowances use `core.lagosDay()` (Africa/Lagos). On a UTC host the streak day rolls over at 01:00 Lagos time, and the demo driver rolls it over in the *device's* timezone. Two different "days" govern the same student.
3. **The declared tier rule `streakFreezes: false` for Open students is enforced nowhere** — the purchase route, the demo driver and the Profile UI all let an Open student buy freezes.
4. **Cookie banner**: its "Privacy policy" link calls `go('privacy')` but no screen with that id exists (the legal screen is `id="legal"`); "Dismiss" never persists, and the show-logic checks for `id === 'home'` while the public landing screen is `id="landing"`.
5. **Registration consent is decorative**: the checkbox is pre-checked, has no id, and is never read by `signupSubmit()`; the server accepts registration without any consent and records no policy version or timestamp.
6. **The visitor analytics beacon fires for every visitor regardless of consent**, while the admin dashboard claims it is "Only collected from visitors who accepted cookies."
7. **Tutor subject status counts and admin tutor-analytics subject list read the local `db.questions` blob even in Appwrite mode**, where the authoritative bank lives in the Appwrite `questions` collection — so those numbers can be empty/stale in production.
8. **Review initialization is expensive and duplicated**: opening the Study hub fires ~7 parallel API calls; `GET /me/review` and `GET /me/mistakes` each rebuild the full mistakes list, and in Appwrite mode `summariseOwn()` performs one `getDocument` per answer row (N+1) for up to 20 marked papers. Tapping "Start review" immediately re-fetches the same payload the hub card just fetched.
9. **Practice/CBT open runs and sessions are in-memory** (`openStudy`, `sessions` Maps): a server restart or the 4-hour sweep produces `409 "That study run has ended. Set it up again."` In Practice the UI silently falls back to a local, 0-XP review; in CBT the message is toasted.
10. **Local JSON remains authoritative for a large share of the product** even when Appwrite is configured: practice runs, mistakes/spaced-review state, quests/challenge state, tutor notes, notices, flags, alerts, audit logs, settings and reminders all live in `data.json`, mirrored to an Appwrite Storage blob fire-and-forget. A failed upload is logged and lost until the next write.

The old motto appears in 5 tracked places (3 in `index.html`, `start-server.ps1`, one test fixture). No merge-conflict markers, no tracked secrets, all JavaScript parses, and `npm run build` produces a clean `dist/`.

Per the owner's instruction ("Implement all the fix on the PR"), the confirmed defects above are fixed on this branch in small, testable commits; the report below records the pre-fix verification.

---

## 2. Verification Matrix

| # | Issue | Status | Evidence (file · function) | Root cause | Recommended fix | Tests needed |
|---|-------|--------|---------------------------|------------|-----------------|--------------|
| A1 | Test suite cannot run / fails | **NOT REPRODUCED** | `test/run.js`; full run exit 0 | Dependencies were simply not installed in the fresh checkout | `npm ci` before `npm test` (documented) | Full suite (done) |
| A2 | Helpers continue after failed setup | **CONFIRMED (latent)** | `test/active-student.js` · `founderFor`, `demo` | Founder login/unlock/approve failures are not checked; the walk continues and later assertions fail with confusing messages | Abort on founder **sign-in/unlock** failure (infrastructure); **preserve approval-step continuation** — `test-results-export.js` asserts the console stays locked and `test-tiers-route.js` restarts the server (stale session), both reading `data.json` directly. A blanket throw broke those intentional designs and was reverted. Signup-rejection returns intact | Existing suites + new consent suite (full re-run green) |
| A3 | Unreliable test assumptions | **PARTIALLY CONFIRMED** | `test/test-appwrite-registration.js` (excluded from runner, throws without live creds — deliberate); `test-streak-freeze-demo.js` silently skips its success path when XP can't be earned | Manual walk-through mixed into test folder; graceful-skip hides coverage loss | Keep exclusion documented; make the demo freeze fixture deterministic (test-only XP hook) | `test-build.js` hook-strip assertion |
| B1 | Practice runs fail to start ("No questions … published for Physics yet") | **NOT REPRODUCED at HEAD** (seed fixed in 388ba06) | `js/goc-core.js` · `QUESTIONS` (60 active `section:'practice'` rows, 12/subject); `server/server.js` · `/api/me/study/start` | Historically the seed had no Practice-section questions; `studyPool()` requires `section==='practice'` | Keep modes separate; in Appwrite production, publish Practice questions via console import (`stampSection`) — code cannot fix empty production data | `test-study.js`, `test-server.js` (pass) |
| B2 | "That study run has ended. Set it up again." | **CONFIRMED (design)** | `server/server.js:1756` `openStudy` Map; `:6119` submit lookup; `:1872` sweep; `js/app.js` · `submitCBT`, `pracNext` | Open runs + sessions are in-memory; restart, 4-h sweep, or double submit ⇒ 409. Practice UI hides the failure (0 XP, no explanation) | Keep server authority; make the Practice fallback explicit to the student; document restart behaviour. Persisting open papers is a later phase | `test-study.js` expiry tests; new fallback-toast assertion |
| B3 | Tests create Practice sessions with incompatible questions | **NOT REPRODUCED** | `test/test-study.js:127-132` (fixtures are `section:'practice'`); `test-server.js` uses seed bank | Earlier fixtures predated the exclusive Practice pool | None | — |
| B4 | Mode separation Practice/Web Test/JAMB | **CONFIRMED intact** | `core.studyPool` (practice-only), `core.eligible` (theory/objective/jamb), `forPractice` vs `forStudent` | — | Preserve; do **not** mix pools. Stale comment in `goc-core.js:393-398` contradicts the code — fix comment | `test-rules.js`, `test-study.js` |
| C1 | Done / Another run overlap recent content | **UNVERIFIED (device)** | `index.html` `#studyRes`; `css/styles.css` `.bottom-bar` (sticky), `.screen.pad` (88px pad); `js/app.js` · `go()` hides tabbar on `studyRes` | Layout is correct by inspection at HEAD; 100dvh used | Real-device (Android Chrome) check; no speculative CSS change | Manual browser/device test |
| C2 | Practice button needs scroll-up to respond | **UNVERIFIED (device)** | `index.html` `#study` `.sg-cell`; `go()`; tabbar z-index 50 | Not reproducible statically; possibly stale-cache (old SW) or device-specific | Verify on device after SW cache bump | Manual device test |
| C3 | Start Review slow | **CONFIRMED (code)** | `server/server.js` · `mistakesFor` → `summariseOwn` (per-answer `findQ` = Appwrite `getDocument`), `attemptsFor`, `listQuestions` full-bank pagination | N+1 document fetches ×2 endpoints, on every hub visit and again on session open | Resolve questions from one bank fetch (Map) in `mistakesFor`; reuse hub payload in `rvOpen` | `test-spaced-route.js`, `test-mistakes-route.js`, new perf-shape assertion |
| C4 | Duplicate review requests | **CONFIRMED** | `js/app.js` · `go('study')` fires `refreshReview()`; `rvOpen()` re-fetches `GET /me/review` immediately | No reuse of the fresh hub payload | Short-TTL reuse in `rvOpen` (still refetches when stale) | `test-spaced-ui.js` |
| C5 | Loading/error/empty/expiry handling | **PARTIALLY CONFIRMED** | `rvOpen`/`refreshPracHistory` have loading + offline states; `pracNext` error path silent; session expiry handled by `ssExpired()`/`go()` | Practice submit failure not surfaced | Toast on failed practice submit | `test-study.js` / new UI assertion |
| D1 | Freeze price 100 vs intended 500 | **CONFIRMED** | `js/goc-core.js:79` `STREAK_FREEZE_COST_XP = 100`; UI `paintFreeze`, server `/api/me/streak-freeze` both read it | Wrong constant | Set 500; update fixtures that hardcode 100 | `test-streak-freeze*.js` |
| D2 | Streak counted once/day; qualifying activity | **CONFIRMED correct** | `core.streakAfterActivity`; `server/server.js` · `bumpStreakRecord` (study submit, test submit only — never login) | — | None | `test-streak-freeze.js` |
| D3 | Timezone for daily math | **CONFIRMED inconsistent** | `core.dayStamp()` (local) vs `core.lagosDay()` (UTC+1); streak/XP/quest use former, allowances latter | Two clocks | `dayStamp()` defaults to Lagos day; explicit-argument behaviour unchanged | Full suite (date-sensitive suites) |
| D4 | Missed days / warnings | **CONFIRMED implemented** | `streakAfterActivity` (1 freeze bridges exactly 1 missed day); `server/lib/reminders.js` "streak ends tonight" email; `/api/me` display streak decay | Email delivery depends on SMTP env (not verifiable here) | None in code; verify SMTP in production | `test-reminders*.js` (pass) |
| D5 | Server enforces freeze eligibility/affordability | **PARTIALLY CONFIRMED** | `/api/me/streak-freeze` runs `core.buyStreakFreeze` under `withDataLock` (cap + balance server-side ✔); **tier feature `streakFreezes:false` for Open enforced nowhere** | Missing `canUse` gate in route, demo driver and UI | Enforce gate server-side + demo + hide UI row for Open | `test-streak-freeze-buy/demo/ui` + new refusal assertions |
| E1 | Cookie banner persistence & broken link | **CONFIRMED** | `index.html:2177-2218` — `go('privacy')` (no such screen), `cookieDismiss()` not persisted, `maybShow` checks `'home'` vs actual `'landing'` | Copy-paste ids | Remove banner entirely (owner's request); keep disclosures in legal + signup | New `test-privacy-consent.js` markup checks |
| E2 | Tracking gated by consent | **CONFIRMED absent** | `js/app.js` · `visitBeacon` (fires unconditionally); admin copy at `:2690`, `:3404` claims cookie-gating | Beacon never checks consent | Gate beacon on recorded privacy acceptance; fix admin copy | New suite source checks |
| E3 | Registration consent front+back, versioned | **CONFIRMED absent** | `index.html:709` (pre-checked, no id); `js/app.js` · `signupSubmit` (never reads it); `server/server.js:3180` `POST /api/students` (no consent field) | Never implemented | Required unchecked box; API 400 without consent; record `{version, at}` server-side | New suite + all signup fixtures |
| E4 | Policy accuracy (purposes incl. publicity) | **PARTIALLY CONFIRMED** | `index.html` legal §4-6: no analytics/beacon disclosure, no publicity purpose | Policy text lagged features | Update policy text + effective date; version constant | New suite |
| F1 | Old motto occurrences | **CONFIRMED** | `index.html:59,428,1709`; `start-server.ps1:13`; `test/test-landing-motion-3.js:172` | — | Replace all 5; bump SW cache; rebuild `dist/` at deploy | `test-landing-motion-3.js`, `test-build.js` |
| G1 | Tutor status counts / admin analytics read local blob in Appwrite mode | **CONFIRMED** | `server/server.js:4143` (`db.questions` loop in `/api/tutor/subject`), `:4210` (subjects from `db.questions` in `/api/admin/tutors/analytics`) | Wrong source after Appwrite migration | Use the already-fetched `listQuestions()` rows | `test-tutors-stats.js`, `test-tutors-analytics.js` |
| G2 | Blob writes fire-and-forget | **CONFIRMED (design risk)** | `writeData` → `scheduleBlobUpload` (errors logged only); hydrate guard `_savedAt` | Durability gap between local write and mirror | Keep single-instance; phased migration of blob entities to collections (plan below) | `test-persist.js`, `test-migrate-appwrite.js` |
| G3 | Tutor at-risk / top-performers "not reflecting the Appwrite students" | **CONFIRMED (schema gap), read-source NOT REPRODUCED** | `server/server.js` `/api/tutor/atrisk` + `/api/tutor/top` already read `listAppwriteStudents()`/`listAttempts()`; `core.tutorAtRisk`/`tutorTopPerformers` filter `cleanTier(tier)==='goc'`; `server/setup-appwrite.js` `ensureStudentAttributes()` never provisioned `tier` | The lists are GOC-only. Without the optional `tier` attribute the boot `migrateAppwriteTiers()` cannot stamp existing students GOC (every update refused), so they read as Open and are excluded — empty lists despite students being in Appwrite | Provision `tier`/`tierChangedBy`/`tierChangedAt` in `ensureStudentAttributes()` (idempotent); re-run setup + restart so the migration finishes. Read-source locked by new Appwrite-stub regression | New `test-tutors-appwrite-students.js` (9); `test-tiers-appwrite.js` |
| H1 | Syntax / build / conflict markers / secrets | **NOT REPRODUCED** | `node --check` all pass; `npm run build` OK; no markers; `git ls-files` clean of `.env`/`data.json` | — | Bump `sw.js` CACHE on release (v184→v185) | `test-build.js`, `test-deploy.js` |

---

## 3. Test Results (actual runs)

| Command | Result |
|---------|--------|
| `npm ci --no-audit --no-fund` | exit 0 |
| `npm test` (`node test/run.js`) — **COMPLETE run** | **exit 0 · 182/182 suites passed · 6,907 assertions passed · 0 failed · 1 skipped** |
| `node --check` on all JS (app, api, core, server, tutor-app, sw, build scripts) | exit 0 |
| `npm run build` | exit 0 — `dist: 1,527,392 → 944,507 bytes (38% smaller)` |

The single skip is `test-media-stub.js`'s live-Appwrite section: *"Appwrite not configured (APPWRITE_ENDPOINT/PROJECT_ID/API_KEY unset) — nothing to verify."* This is an environment limitation, not a defect. `test/test-appwrite-registration.js` is deliberately excluded from the runner (a half-finished manual walk-through that requires a live, empty Appwrite project); it was **not** executed.

No test results in this report are invented; the baseline log was captured in full (`/tmp/test-baseline.log` during the audit session).

### Post-fix verification (after all phases, on this branch)

| Command | Result |
|---------|--------|
| `npm test` (`node test/run.js`) — **COMPLETE re-run** | **exit 0 · 185/185 suites passed · 6,952 assertions passed · 0 failed · 1 expected skip** (`/tmp/test-atrisk-fix2.log`) |
| `node --check` sweep (app, api, core, pwa, server, lib/appwrite, lib/reminders, setup-appwrite, build/build, sw, run.js, active-student, the new suites) | exit 0 — `ALL_SYNTAX_OK` |
| Conflict-marker scan (`^<{7}` / `^={7}` / `^>{7}`) over js, server, index.html, sw, build, test | none |
| `npm run build` | exit 0 — `dist: 1,533,235 → 945,368 bytes (38% smaller)` |

The added suites are `test-privacy-consent.js` (23 checks), `test-tutors-appwrite-source.js` (7 checks) and `test-tutors-appwrite-students.js` (9 checks, at-risk/top reading the Appwrite roster). Three fixtures needed consent/robustness updates that the first post-fix re-run surfaced and that are now resolved: `test-p78.js` (three direct demo sign-ups now inject consent), and `test-tiers-route.js` / `test-results-export.js` (the `active-student.js` approval-step continuation was preserved — see A2 — because both deliberately exercise a locked/stale founder session and read `data.json` directly).

**Follow-up (G3, tutor at-risk / top-performers).** The read-source was verified correct (both routes already read `listAppwriteStudents()`/`listAttempts()`); the new `test-tutors-appwrite-students.js` locks that in and was shown to fail if the routes are pointed back at the empty local roster. The actionable gap was that `server/setup-appwrite.js` never provisioned the optional `tier` attribute, so the boot-time tier migration could not stamp existing students GOC and the GOC-only lists came back empty. `ensureStudentAttributes()` now adds `tier` / `tierChangedBy` / `tierChangedAt` (idempotent). **Deploy step:** re-run `node server/setup-appwrite.js` against the live project, then restart so `migrateAppwriteTiers()` finishes; the lists then reflect the Appwrite students. The single remaining skip is the live-Appwrite section of `test-media-stub.js` (env limitation, not a defect). Note: a sandbox reset mid-session wiped `node_modules`; `npm ci` was re-run so the build/deploy/upload checks execute rather than skip.

---

## 4. Root-Cause Analysis — Practice / session failures

**Question selection.** `core.studyPool()` serves only `active && kind==='objective' && section==='practice'` rows for the chosen subject/topics/years. Web Test draws via `core.eligible()` (`theory|objective|jamb`), JAMB CBT via the jamb-ready pool — three deliberately disjoint pools. The seed now carries 60 Practice questions (12 per subject). In an **Appwrite deployment the seed is never used**: the bank is whatever staff imported. If production holds no `section:'practice'` rows for a subject, `POST /api/me/study/start` correctly returns `404 "No questions have been published for <subject> yet."` The remedy is editorial (import Practice questions with the console's `stampSection` CSV flow), **not** mixing Web Test/JAMB rows into Practice.

**Session lifecycle.** `POST /me/study/start` registers a paper in the in-memory `openStudy` Map and returns questions (Practice rows carry answers via `forPractice`; CBT rows are stripped via `forStudent`). `POST /me/study/submit` looks the paper up, re-marks server-side, awards capped XP, updates streak/quests, and deletes the paper. The map is lost on restart (sessions are in-memory too), swept after 4 h (untimed) or duration+10 min (CBT), and a paper cannot be submitted twice. Any of these yields `409 "That study run has ended. Set it up again."` — surfaced as a toast in CBT, silently swallowed in Practice (local 0-XP review shown). Finished runs are persisted separately (`POST /me/practice` → `db.practiceRuns`, mirrored to the Storage blob), so history survives even when the open paper does not.

**Review latency.** `mistakesFor()` = stored practice runs + up to 20 marked Web Test attempts, each summarised by `summariseOwn()`, which resolves every answer row through `findQ()` — one Appwrite `getDocument` per row in Appwrite mode — then `GET /me/review` additionally paginates the entire bank to attach images/passages. The Study hub triggers this twice (`/me/mistakes` and `/me/review`), and tapping *Start review* triggers it a third time. Fix: one bank fetch per request resolved through a Map, and reuse of the hub's fresh payload when opening the session.

---

## 5. Appwrite Persistence Map (as audited)

| Feature | Read source | Write destination | Authoritative store | Stale/inconsistent risk |
|---|---|---|---|---|
| Students, tiers, XP, streaks | Appwrite `students` (when configured) else `db.students` | same | **Appwrite DB** (or local JSON) | Optional attributes (`tier`, `streakFreezes`, `questDay`, `weekQuest`, `practiceCount*`) written only when held; a schema missing them silently degrades features (by design) |
| Questions | Appwrite `questions` (paginated 100/page) else `db.questions` | same | **Appwrite DB** | Local blob copy can be stale; persistence-guard syncs `questionSeq` at boot |
| Web Test attempts | Appwrite `attempts` else `db.attempts` | same | **Appwrite DB** | `Query.limit(5000)` ceiling |
| Tutor accounts & permissions | Appwrite `tutors` (whole record as JSON string) else `db.tutors` | same (+local cache push at login) | **Appwrite DB** | `record` string attribute (1 MB) — no per-field indexes |
| Open practice/CBT papers, sessions | in-memory Maps | in-memory | **RAM** | Lost on restart ⇒ 409s; single-instance PM2 required |
| Practice runs & answer history | `db.practiceRuns` | `writeData` → blob mirror | **Local JSON + Storage blob** | Upload failure logged only; hydrate guarded by `_savedAt` |
| Spaced-review state/counts, quests, challenge state | `db.reviewState/reviewCount`, student fields, `db.challengeState` | blob (quests partly on student doc) | **Local JSON + blob** (quests: Appwrite student) | Same durability gap |
| Tutor notes / notices / flags / alerts | `db.notes/notices/flags/alerts` | blob | **Local JSON + blob** | Same |
| Tutor audit / manager log | `db.tutorAudit`, `db.managerLog` | blob (audit written under lock before response) | **Local JSON + blob** | Same |
| Privacy-consent record (added on this branch) | `db.consentLog[id]` → `{at, version}`; exposed on `/api/me` as `privacyConsent` | `writeData` → blob mirror, in **both** Appwrite and local modes | **Local JSON + blob** | Server-stamped at sign-up; deliberately kept out of the Appwrite `students` schema so it needs no migration. Same blob durability gap |
| Subject/question answer stats | `db.answerStats` | blob (recorded on submit) | **Local JSON + blob** | Tutor analytics read it; **status counts/subject list wrongly read `db.questions` in Appwrite mode (fixed on this branch)** |
| Settings / feature config / reminders | `db.settings`, `db.reminderState` | blob | **Local JSON + blob** | Same |
| Resources / videos / live classes / cohorts | Appwrite collections + Storage | same | **Appwrite DB/Storage** | — |
| Question images | `DATA_DIR/question-images` | local disk | **Local disk** | Not in blob; needs persistent volume |

**Consequences.** Appwrite is the intended backend, but the blob is a single-writer, whole-file mirror: it requires `instances: 1` (already set in `ecosystem.config.cjs`), a persistent `GOC_DATA_DIR`, and it loses any write whose upload failed if the disk is wiped before the next successful upload. The frontend can show stale tutor numbers whenever the blob lags Appwrite.

**Phased migration plan (preserves records & permissions):**
1. **Phase 0 (this PR):** fix wrong read sources; keep blob authoritative for unmigrated entities; document durability requirements.
2. **Phase 1:** provision missing optional attributes via `server/setup-appwrite.js` (idempotent) against a *scratch* project first; verify production schema with a read-only introspection before assuming parity. Add `privacyConsentAt`/`privacyPolicyVersion` to `students` when ready.
3. **Phase 2:** move high-churn entities (practice runs, review state) into their own collections with `scholarId` indexes and server-key-only write permissions; dual-read (collection first, blob fallback) during cutover; backfill with a one-shot migration script that never deletes blob records.
4. **Phase 3:** move notes/notices/flags/audit; keep the blob for settings until last; retire the mirror only after a full export/verify cycle.
5. Every phase: run the existing Appwrite stub suites plus a scratch-project smoke test; never assume the production schema matches the setup script.

---

## 6. Prioritized Implementation Plan (implemented on this PR)

| Phase | Change | Depends on | Regression risk |
|---|---|---|---|
| 1 | Freeze price 500 XP; `dayStamp()` → Lagos; tier gate on freeze purchase (server + demo + UI) | — | Date-sensitive suites; freeze fixtures (updated) |
| 2 | Privacy: remove cookie banner; required unchecked consent box; server + demo consent enforcement with versioned, timestamped record; beacon gated on consent; policy text updated; analytics copy corrected | core `PRIVACY_POLICY_VERSION` | All signup fixtures (helper + direct posts updated) |
| 3 | Motto replacement (5 files); SW cache v185 | — | Landing-motion fixture (updated) |
| 4 | Review latency: single bank fetch in `mistakesFor`; `rvOpen` reuses fresh hub payload; tutor status counts & admin analytics read the fetched bank; Practice submit-failure toast; stale comment fix | — | Spaced/mistakes/tutor suites |
| 5 | Test hardening: founder sign-in/unlock aborts in `active-student.js` (approval continuation preserved, see A2); new `test-privacy-consent.js` (23) and `test-tutors-appwrite-source.js` (7, Appwrite-stub with empty local cache); deterministic demo freeze fixture (`_grantXp` hook, stripped by build) | Phases 1-2 | Build hook-strip assertion; full re-run |

**Not implemented (needs owner/device/production input):** persisting open papers/sessions across restarts; blob→collection migration; Android rendering verification (C1/C2); SMTP delivery verification; publishing Practice questions into the production Appwrite bank.

## 7. Uncertainties (cannot be verified from the ZIP/checkout)

- Production Appwrite schema, records, indexes and permissions (no credentials; none requested). The optional-attribute degradation paths are verified only against the in-repo stub.
- Whether the production question bank contains Practice-section questions (the 404 message is correct behaviour for an empty bank).
- Real-device rendering (Done/Another-run overlap, Practice tap target) — needs Android Chrome testing; the stale service-worker cache (v184) is a plausible cause of "old" UI behaviour on devices.
- Deployed environment variables (`GOC_DATA_DIR` persistence, SMTP, `NODE_ENV`, secret rotation) and PM2 behaviour on the host.
- Live Appwrite registration walk-through (`test-appwrite-registration.js`) — intentionally not run.
- Legal compliance: removing the banner and gating tracking improves the posture but **does not by itself make the app legally compliant**; counsel should review the updated policy text.