# Round 2 — data preservation, question banks, homepage and CBT entry

Branch: `arena/577ff09f-goc-academy-hub` · Pull request: **[#10](https://github.com/uzorchukwu123/goc-academy-hub/pull/10)**

Status: **prepared for owner review. Not merged. Not deployed to production or OneBit.**

This round corrects the existing implementation. It is not a rebuild: the
architecture, the persistence model (Appwrite relationships / local JSON), the
CSV format, the G.O.C branding and every working feature are retained. All
changes are at function/component level.

---

## 1. Defects found and corrected

| # | Defect | Correction |
|---|--------|------------|
| 1 | **Deleting an activity cascaded into student data.** `deleteActivity` filtered `session.attempts`, destroying every attempt, submitted answer, score and result for that activity. | Non-cascading delete. Exactly one activity record is removed; the attempts collection is never filtered. |
| 2 | **No confirmation on activity deletion.** The route accepted a bare `DELETE`. | `confirm: true` is now required server-side, and the console dialog states precisely what is kept. |
| 3 | **Deleted activities orphaned historical results.** Results and the admin paper view resolved the title/kind from the live activity only. | Additive `session.activityHistory` identity tombstone; results, result lists and attempt detail resolve through it. |
| 4 | **Question deletion was blocked once referenced**, so an administrator could not clear a bank that had ever been used. | Referenced questions are deletable. The full record is snapshotted into `ed.questionHistory` **before** removal, so marking and paper display stay accurate. |
| 5 | **"Start Free UTME Bootcamp" was still the homepage hero CTA**, and CBT Portal entry bounced a guest into registration. | CTA removed from the markup outright; a direct **CBT Portal** action added; guests land in the portal itself. |
| 6 | **Activity editor silently discarded typed input.** *(found during this round)* The async availability reply rebuilt the subject-distribution grid, wiping values the administrator had already typed and sometimes detaching an input mid-edit. | The draft is read out of the DOM before the grid is rebuilt, and a late reply for a closed/replaced editor is ignored. |

Defect 6 was a genuine product bug, not a test artefact. It presented as an
intermittent harness failure (distribution lost, or the save refused because the
distribution no longer summed to the question count) and is now covered by a
dedicated regression check.

---

## 2. The deletion-preservation mechanism

`deleteActivity(id, body)` in `server/lib/free2027.js`:

1. Requires `body.confirm === true`, otherwise `400` and **nothing changes**.
2. Counts the attempts and submitted results belonging to the activity.
3. **Appends** one identity tombstone to `session.activityHistory`
   (`id`, `kind`, `title`, window, duration, `maxAttempts`, `questionCount`,
   `deletedAt`, `attemptsKept`, `resultsKept`).
4. Removes exactly one entry from `session.activities` — the only destructive
   line in the function.
5. Returns `{ ok, deleted, attemptsKept, resultsKept, preserved[] }`.

The attempt keeps its own `activityId`, so the activity↔attempt relationship
survives as a historical reference rather than being orphaned and destroyed.
Participants, other activities, both question banks, `records` and the audit
trail are never touched.

Read paths that now resolve a deleted activity:

- `resultOf()` — adds `activityDeleted: true`; score, max, percent, title and kind
  are unchanged. Ranking position is only computed for a **live** competition.
- `activityResults()` — serves the historical rows with `state: 'deleted'`.
- `attemptDetail()` — returns the tombstone identity plus a `deleted` flag, so the
  console can still open the exact paper and its answers.

### Question banks

`archiveBankQuestions()` copies the full question record (options included, plus
`bank` and `deletedAt`) into `ed.questionHistory` before it leaves the live bank.
`questionsInBank()` resolves **live first, then history, within the same bank
only** — never the other bank, never `db.questions`. Individual delete, bulk
delete and delete-all all report `preservedForHistory`, `referencedByActivities`
and `attemptsAffected: 0`.

`updateBankQuestion` still refuses to *edit* a referenced question, which
protects historical marking. `questionSeq` still never re-issues a deleted id.

### Migration safety

`ensureEdition` adds `ed.questionHistory` and per-session `activityHistory` as
**empty arrays only when absent**. No existing record is rewritten, no data is
reset, and an older data file opens unchanged.

---

## 3. Homepage and CBT entry

- `Start Free UTME Bootcamp` is **removed from the markup**, not hidden with CSS.
  `grep -ci 'start free utme bootcamp' index.html` → `0`. No nav, drawer, hero or
  dynamic CTA renders it, and no obsolete handler or route remains.
- **"I already have an account" is kept** and is mode-aware through
  `F.freeAccountEntry()`: Free Tutorial Mode opens the edition's own email
  verification; Original Mode opens the original `login-v2`. (In Free Mode the
  navigation allowlist would otherwise redirect `login-v2` back to the edition.)
- A visible **CBT Portal** button sits beside it and calls `F.freeCbtPortal()`,
  which goes **straight to the portal** — no account creation, registration,
  login, Get Started, onboarding or account-selection step.
- New public route `GET /api/free2027/catalogue` (`need: null`) serves published,
  non-archived activity **metadata only**: no question ids, options, answers,
  marks or participant data. A guest browses real weekly and competition
  listings; the single "verify email to sit this paper" action reuses the
  **existing** OTP identity. **No second account system was created.**
- The exam header carries working **← Back** and **Home** controls on mobile and
  desktop; the header wraps at ≤480px instead of overlapping.

---

## 4. Website Mode Control

Founder-only, confirmed, and persisted in the edition record. Verified in both
directions: Original Mode restores the original homepage, drawer account actions
and Updates & News destination; Free Tutorial Mode restores the edition. A switch
changes **no** participant, activity, attempt, result or bank record — it only
appends to the session audit trail, which is the intended behaviour. The mode
survives a server restart.

---

## 5. Accumulation

`saveActivity` already appended correctly (`'F27-Q' + (++activitySeq)` then
`push`; edits use `Object.assign`; a client-supplied `questionIds` is rejected).
It was **not** rewritten — it is now covered by tests proving Week 1, Week 2 and
Week 3 coexist with unique stable ids and that creating a later week leaves the
earlier one byte-for-byte unchanged.

---

## 6. Tests executed

| Gate | Result |
|------|--------|
| `npm test` | **exit 0 — 198 suites, 0 failed** |
| `npm run build` | **exit 0** — 1,760,988 → 1,086,226 bytes (38% smaller) |
| `git diff --check` | clean |
| Real-browser harness | **145/145 checks, exit 0, 0 uncaught JS errors** — run **twice consecutively** on fresh isolated state |
| Secret / artefact scan | no `.env`, credentials, `server/data.json`, local databases or test data in the diff |

### New and updated automated tests

- **`test/test-free2027-data-safety.js` (new, registered in `test/run.js`)** — runs
  against the real HTTP server and the real persisted data file. Covers the
  mandatory sequence end to end: create → register → attempt → answer → submit →
  score → delete → activity gone from store/console/student list → attempt
  **byte-for-byte identical** → answers intact → score/result intact and still
  served → unrelated students, activities, banks and records untouched. Also
  covers Week 1/2/3 accumulation, competition-deletion independence, bank
  individual/bulk/delete-all isolation, confirmation refusal, mode-switch
  preservation, the public catalogue's guest safety, and survival across a
  server restart.
- **`test/test-free2027-ui.js`** — homepage CTA removal, direct guest entry
  (never registration/signup/login), guest listings on both tabs, mode-aware
  account routing, and CBT Back/Home behaviour.
- **`test/test-free2027-nav.js`** — the drawer CBT action now asserts **direct
  portal entry**; the previous assertion encoded the registration wall.
- **`test/test-free2027-banks.js`** — referenced-question deletion now asserts
  history preservation and intact attempts instead of the old `409` refusal.
- **`test/test-landing-layout.js`** — asserts the bootcamp CTA is absent from the
  markup, the account action is preserved, and the CBT action is not a signup route.
- **`test/browser/free2027-recovery.js`** — extended with homepage CTA checks,
  mobile exam-header Back/Home and overlap checks, the typed-draft regression,
  activity accumulation, the full deletion-preservation flow through the admin
  UI, bulk/delete-all through the UI, and guest direct entry in **separate
  browser runs for mobile and desktop**.

No test was removed or weakened to obtain a pass. Where a contract deliberately
changed, the assertion was replaced with a **stronger** one that proves the new
guarantee. Two harness assertions that encoded the old registration-wall
behaviour were corrected to the required direct-entry behaviour.

### Environment note

An initial `test-free2027-local.js` failure was traced to missing
`node_modules/appwrite` and `node_modules/node-appwrite` in the sandbox, not to
source. `npm ci` resolved it; no source or test change was made for it.

---

## 7. Limitations — please read before approving

- **Browser coverage is emulation, not physical devices.** Mobile results come
  from headless Chromium 131 with a 390×844 Android viewport/user agent; desktop
  from 1366×900. **No physical Android or iOS device was tested.** A real-device
  smoke test is still recommended before release.
- **SMTP was exercised through the repository's isolated test capture adapter**,
  not a live Brevo/SMTP relay. OTP generation, hashing, expiry and verification
  are the real implementation; actual deliverability to a real inbox was not
  tested here.
- **Appwrite-backed persistence was not exercised against a live Appwrite
  instance.** Verification used the local JSON store. The changes are additive
  to the existing structures, but a live-Appwrite smoke test remains advisable.
- **The Vercel check on PR #10 fails for a pre-existing reason** — it fails
  identically on `main` and on every earlier head of this branch. It is unrelated
  to these changes and was not "fixed" by adding deployment configuration.
- GitHub's Copilot review could not run (quota exhausted).
- Secondary "Bootcamp" wording still exists **outside the homepage** — the
  Original-mode signup aside, the contact lead text and a news fixture. These
  were deliberately left alone as out of scope for the homepage requirement.

---

## 8. Handoff

Pushed to the existing PR #10 branch. **The pull request remains open. Nothing
was merged and nothing was deployed to production or OneBit.** Deployment waits
for explicit owner approval; `DEPLOY-CHECKLIST.md` and the service-worker cache
are aligned at `goc-v195`.
