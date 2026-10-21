# G.O.C Academy Hub — web app files

The prototype used to be one giant HTML file. It is now split so you can open and
read each part on its own — and it now has a real backend behind it.

## Rule for anyone making changes

**Never remove or delete any file, folder, function, route, test, or feature unless the project owner explicitly asks for it to be removed.** Every change is additive or corrective only. If something looks unused, redundant, or out of date, leave it in place and flag it — do not delete it. This applies to code, comments, test suites, documentation, data files, and configuration.

## What is where

| File | What it holds |
|---|---|
| `index.html` | The structure only — every screen, button, and piece of text. No styling, no logic. |
| `css/styles.css` | Everything about how it looks: colours, spacing, the phone frame, the desktop layout. |
| `js/goc-core.js` | **The rules, written once.** Marking, XP, levels, performance, the league order, the study set-up limits. The browser and the server both use this same file, so neither can drift from the other. |
| `js/api.js` | **Where data comes from.** The only file that knows. Holds two drivers: demo data, and a real server. |
| `js/app.js` | Everything it does: screen switching, login, the console, the timetable, the Web Test, practice and reading mode. Never touches data directly — it asks `js/api.js`. |
| `js/pwa.js` | Six lines that register the service worker so the app can be installed. Skipped when opened from a file. |
| `sw.js` | The offline cache list. Bump `CACHE` (currently `goc-v176`) whenever you change a file, or phones keep the old copy. |
| `manifest.webmanifest` | The app's name, colours, and icons for "Add to home screen". |
| `icons/` | The app icons. |
| `start-server.ps1` | Right-click → Run with PowerShell. Starts the server and opens the app. |
| `server/server.js` | The backend. Real accounts, hashed passwords, expiring logins. Uses local JSON or Appwrite Storage in production. |
| `server/data.json` | The database — written on first run. Passwords are hashed here, never plain. |
| `server/schema.sql` | The same database as Postgres tables, for when you move to Supabase. |
| `server/supabase.md` | The step-by-step map for moving to Supabase later. |
| `server/export-questions.js` | Writes the question bank out as a spreadsheet you can edit and re-import. |
| `test/` | The checks. One command tells you whether anything is broken — see below. |

## Checking it still works

```powershell
node test\run.js
```

176 suites and thousands of separate checks. Set `GOC_FOUNDER_PW`, `GOC_ACADDIR_PW` and `GOC_PASSCODE` first (the server refuses the published demo passwords), and run `npm install` once so the Appwrite and upload checks can run. It drives the
real screens and the real server: signing in, sitting a paper, marking it in the
console, the league order, practice runs, the mathematics renderer, the offline
cache list. Every suite must say `passed`. If one says `FAILED`, the lines above it
name exactly what broke.

Run it before you give the app to anyone. It is faster than clicking through.

## Two ways to run it

**Offline mode — no server.** Double-click `index.html`. Everything works, data
lives in memory (starting empty, no demo accounts), and a refresh puts it back
to the start. Good for showing people the interface without any real data.

**Real mode — with the server.** Right-click `start-server.ps1` → *Run with
PowerShell*. It opens http://localhost:8080. Now sign-ups are saved, passwords are
hashed, and logins expire after 8 hours. Press Ctrl+C in the black window to stop.

The app works out for itself which mode it is in: on startup it asks the server if
it is there, and quietly falls back to demo mode if not. You never have to
configure anything.

## First-run logins

There is no demo student roster — this is a live deployment, not a prototype, so
`server/data.json` is seeded with zero students. The only accounts created on
first run are the two management consoles:

| ID | Password | Opens |
|---|---|---|
<<<<<<< HEAD
| `GOC-A-001` | `<set GOC_FOUNDER_PW>` (or `GOC_FOUNDER_PW` if set) | Console access portal (Founder) |
| `GOC-A-002` | `<set GOC_ACADDIR_PW>` (or `GOC_ACADDIR_PW` if set) | Console access portal (Academic Director) |

Console passcode: `<set GOC_PASSCODE>`. Configure all three securely through environment variables.
=======
| `GOC-A-001` | `founder2027` (or `GOC_FOUNDER_PW` if set) | Console access portal (Founder) |
| `GOC-A-002` | `acaddir2027` (or `GOC_ACADDIR_PW` if set) | Console access portal (Academic Director) |

Console passcode: `2027` (or `GOC_PASSCODE` if set). Change all three from
>>>>>>> origin/main
Console → Access & firewall before a cohort registers — the server refuses to
boot in production with any of them still at the published default. Any ID
not on the roster is refused; students are created when anyone signs up (an
**Open** account) or when management adds them from the console (GOC by default).

## Open sign-up (there is no access code)

**Anyone can create an account.** Every self-made account is **Open**; only the
console makes someone a **GOC student** (*Console → Students*). The old academy access
code is gone, so `GOC_SIGNUP_CODE` and `GOC-2027` no longer do anything.

What stops one person making account after account is a limit on **successful sign-ups
per connection** (network address): 5 an hour and 20 a day to begin with. A person who
is turned away gets a plain message and a `Retry-After` header. Raise the numbers
when a school or a shared phone network is registering many students at once:
*Console → Access & firewall → Sign-ups per connection* (Founder and Academic Director).
The counts live in the server's memory, so a restart resets them. Behind a reverse proxy
set `GOC_TRUST_PROXY=1`, or every visitor looks like the same address.

## Registration approval

**Every self-registered account starts inactive.** A sign-up does not log the
person in: the account is created with `active: false` and `pendingApproval: true`,
and the sign-up screen shows a "Registration received" page with the new Scholar ID
and a note to wait for approval. Trying to log in before approval is refused with a
plain "awaiting approval" message — no password is checked.

A **Founder** or **Academic Director** approves or rejects from
*Console → Students → Pending approval* tab (pending accounts show there only, not
under *Active* or *Everyone*, each with an amber card):

- **Approve** activates the account at once (`active: true`, `pendingApproval` cleared)
  and records who approved it and when. The student can then log in immediately with
  the Scholar ID and the password they chose.
- **Reject** deletes the pending record entirely — no account, no history is kept.
  The person would have to register again.

The pending state is stored in `data.json` (or Appwrite), so it **survives a server
restart**: an unapproved account is still waiting after the server comes back up.
Accounts the console adds directly (*Console → Add student*) are never pending — they
are active GOC students from creation.


## Mathematics in questions and notes

Formulas are written between dollar signs, in ordinary LaTeX, anywhere an author
types: a question, its options, the reference answer, the explanation, a reading
note. `$x^2 - 5x + 6 = 0$` sets as a proper equation, `$\frac{-b \pm
\sqrt{b^2 - 4ac}}{2a}$` as a real fraction with a real square root, `$C_nH_{2n+2}$`
with its subscripts down where they belong. `$$...$$` puts a formula on its own
centred line. Fractions, roots, powers, indices, Greek letters, `\times`, `\div`,
`\pm`, arrows, `\sin`/`\cos`/`\log`, matrices and `\text{words}` are all set.

Two things worth knowing:

- **A price is still a price.** "A shirt costs $5,000 and a bag costs $7,500" holds
  no formula and is left exactly as typed. Write `\$` if you want a dollar sign
  inside a formula.
- **The console shows you before you save.** Type a formula in *Console →
  Questions* or *Console → Notes* and a panel appears underneath showing it set the
  way the student will read it, with anything doubtful named in plain words. It
  warns; it never refuses. Underneath it is a short list of the forms you can type.

There is no MathJax and no KaTeX here, and there cannot be — the app loads nothing
from the internet, because it has to work in a hall with no signal. The renderer is
part of `js/goc-core.js` and is covered by `test/test-math.js`.

## Before real students use it

<<<<<<< HEAD
Management passwords and the console passcode must never be published in this file. They
=======
The three passwords above and the passcode are published in this file, so they
>>>>>>> origin/main
are not secrets. In real mode all four can be replaced, and the two console
passwords must be — set them **before the very first run**, because that is when
`server/data.json` is written:

```powershell
$env:GOC_FOUNDER_PW  = "something-only-you-know"
$env:GOC_ACADDIR_PW  = "something-only-she-knows"
$env:GOC_PASSCODE    = "a-passcode-only-staff-know"
node server\server.js
```

`start-server.ps1` has a commented line showing where these go. If you start
without them, the server prints a warning saying so. After the first run the two
console passwords are changed from the console instead (Founder only), and the
sign-up code from the console by either account — the environment variables are
only read while seeding.

If you have already run the server once with the defaults, delete
`server/data.json` and start again, or change the passwords from the console.
**These files ship with a `server/data.json` already in them** — the demo roster,
so the app has something to show. So for a real cohort, delete it first, or the
lines above are read by nothing.

## What a student can do today

**Read / Learn** — notes written by the academy, for the subjects that student is
registered for, chosen by subject then topic.

**Practice** — pick a subject, pick topics, pick how many questions. Untimed, and
each answer is marked the moment it is tapped, with the correct answer and an
explanation. It earns XP up to 120 a day, and it never goes on the academic
record — it is study, not assessment.

**Web Test** — the assessed one. A theory paper per subject, and one objective
sitting covering the whole subject combination, with a clock shown in hours. A
student may move between subjects during the objective sitting. Objective papers
are marked by the server the moment they are submitted; theory papers wait for a
human in the console. Students are never shown which is which — that is the
academy's business, not theirs.

**Results & Review** — every paper sat, its score once marked, weak topics, and
the explanations.

**League** — position is decided by academic performance across marked papers
first; XP only separates two scholars on the same performance. Activity alone
cannot outrank stronger results.

Not open yet: the timed CBT mock set-up (built and tested, but no tile until the
question bank is deep enough) and the JAMB-oriented session on the Web Test
screen, which says so when tapped. Nothing else on the Study screen is advertised
without opening something real.

## Before you launch

1. **Delete `server/data.json` first.** A seeded demo copy ships with these
   files, and the passwords below are already hashed into it — which means the
   environment variables in the next step would be ignored. Deleting it makes
   the next start a first start.
2. Set the two console passwords and the passcode as environment variables, then
   start the server (see *Before real students use it* above). Sign-up is open, so
   check the per-connection limits in *Console → Access & firewall*.
3. `node test\run.js` — every suite must say `passed`.
4. Load real questions and notes. The console imports a spreadsheet:
   *Console → Import*. Then check *Console → Questions* — it lists what the bank
   actually serves, subject by subject, and warns you about any paper with
   nothing live, so nobody discovers an empty paper by sitting it. Write any
   formula between dollar signs and check the preview panel before saving.
5. Open it on your own phone and walk through it once: sign up with the code, read
   a note, sit a practice run, sit a Web Test, look at the results. This is the one
   check no test can do for you.
6. Bump `CACHE` in `sw.js` if you changed any file after step 3.

## Two things worth knowing

**"Reveal password" only works in demo mode.** With the server running, passwords
are stored as hashes, which cannot be turned back into the original. That is the
point. Use *Reset password* instead — it issues a one-time temporary password.

**Delete `server/data.json` to start the roster over.** The next run recreates it
from the demo list. Do not do this once you have real students in it.

## Adding to the backend

Search `js/app.js` for `BACKEND:` — each comment marks a spot where the browser is
doing something a server should eventually own. The big ones (login checks, the
passcode, password storage, Scholar ID numbering) are already handled by
`server/server.js`.

When you are ready to go online, read `server/supabase.md`. The short version:
only `js/api.js` changes. `app.js`, `index.html`, and the CSS are untouched.

## Planned fix — Web Test runner showing blank screen

**Symptom.** When the app is opened (or a tab is reloaded) while the server has
restarted, the Web Test runner (`id="wtRun"`) can appear with an empty question
area — no text, no options — and the header still shows the default "Web Test" /
"Loading your papers…" placeholder. The timer is running but nothing is there to
answer.

**Root cause.** The server keeps active (in-progress) test papers in an in-memory
`openPapers` map. A server restart wipes that map. If a student had already called
`startTest` (which called `go('wtRun')` and stored the paper object in the JS
variable `wtPaper`), then the tab was refreshed *after* the server restarted, the
session restore (`restoreSession`) correctly calls `go('home')` — but the `wtPaper`
JS variable is still set from the previous JS execution context. Any code path that
then calls `go('wtRun')` again (or re-enters the runner) finds `wtPaper.questions`
populated but the matching server record gone, leaving `wtRender()` rendering a
question object whose content is empty, and `wtPaintHead()` never updating
`wtRunSub` because `wtPaper` is considered valid.

**Planned fix (client-side guard in `js/app.js`).**

1. **`wtRender()` — guard against an undefined question.** At the top of the
   function, after `var q = wtPaper.questions[wtCur];`, add a check:
   ```js
   if (!q) { wtPaper = null; wtResp = {}; go('webtest'); return; }
   ```
   This means: if the question slot is missing for any reason, wipe the stale
   paper state and send the student back to the Web Test hub rather than rendering
   a blank screen.

2. **`wtPaintHead()` — clear `wtRunSub` when `wtPaper` is absent.** The function
   already guards with `if(!wtPaper) return;`, but that leaves `wtRunSub` holding
   whatever it was last set to. Add a fallback before the guard so the subtitle
   is always accurate:
   ```js
   var s = document.getElementById('wtRunSub');
   if (!wtPaper) { if (s) s.textContent = '\u00a0'; return; }
   ```

3. **`restoreSession()` — reset `wtPaper` on every page restore.** The function
   already sets `wtCatalogue = null`. Add `wtPaper = null; wtResp = {};` alongside
   it, so a session restore can never inherit a stale exam state from a previous
   JS context.

**No server-side change is needed** — the `openPapers` in-memory design is
intentional (a restart signs everyone out of in-progress papers, which is correct
behaviour). The fix is purely defensive client-side hygiene.
<<<<<<< HEAD

---

## Applied fixes (session log)

### Fix 1 — Tutor dashboard status counts scoped to own questions
**File:** `server/server.js` — `GET /api/tutor/subject` handler (~line 4006)
**Change:** Added `if (q.addedBy !== sess.tutor.id) return;` inside the `statusCounts` forEach loop so a tutor only sees counts for their own questions. The depth grid above it still shows system-wide live counts — that is correct and unchanged.

### Fix 2 — Imported questions go to approval queue (not auto-live)
**File:** `server/server.js` — `POST /api/tutor/questions/import` handler (~line 4236)
**Change:** Removed `st.rec.status = 'live'` so bulk CSV imports land as `pending` and wait in the admin approval queue, exactly like individually submitted tutor questions. The `okJson` response now returns `status: 'pending'` (or `''` if nothing was added). The admin approves the whole batch at once via `POST /api/approvals/batch/approve`.

### Fix 3 — test-tutor-questions.js: practice run + batch import assertions
**File:** `test/test-tutor-questions.js`
**Change:** Seeded one live Chemistry question via admin (`ZQXSEED`) immediately before the "practice run never contains a pending question" assertion. Without this seed the practice pool was empty (all tutor questions are `pending`), the server returned 404, and the test's `status === 200` check failed. The batch import assertions (`good rows imported as Awaiting approval`, `each imported question is stamped`, `import waits in the queue`, `admin approves in one go`) are fully resolved by Fix 2 — no core changes were needed; the server already builds the `IMP-` batch ID itself and returns it in `okJson`.

### Fix 4 — Failing tests: Group B (test-p1, test-p3, test-p4, test-study, test-study-window, test-streak-freeze-route, test-quest-*, test-tiers-today)
**Root cause:** Nearly every failure is `"That study run has ended. Set it up again."` on the first submit of a fresh run. Two causes addressed: (a) the open-runs expiry timeout is now configurable — a new `GOC_RUN_TIMEOUT` environment variable sets the max lifetime (in seconds) of an untimed practice run in the `openStudy` map (default: 14400 = 4 hours); (b) the run ID is now stored with an explicit `String()` cast (`openStudy.set(String(paper.id), paper)`) to match the existing `String(body.paperId || '')` lookup on submit — belt-and-suspenders against any future JSON coercion.
**File:** `server/server.js`
**Changes:**
- Added `const GOC_RUN_TIMEOUT_SEC = Number(process.env.GOC_RUN_TIMEOUT) || (4 * 3600);` above the sweep `setInterval`.
- Updated the sweep to use `GOC_RUN_TIMEOUT_SEC` instead of the hardcoded `4 * 3600`.
- Changed `openStudy.set(paper.id, paper)` → `openStudy.set(String(paper.id), paper)` in the study-start handler.

---

### Fix 5 — Failing tests: Group C (test-roles, test-roles-session, test-roles-cap, test-managers-*, test-manager-signin, test-manager-password, test-manager-admin, test-alert-owners, test-manager-log, test-managers-ui, test-console-menu, test-overview-scope)
**Root cause (actual, from code inspection):** Manager login was failing with 401 in test environments. When a manager has an `appwriteUserId`, the login handler calls `verifyAppwritePassword`, which immediately throws because `config.endpoint` / `config.projectId` are not set in the test environment — before any network call is made. The `catch` block silently set `passwordOk = false`, so the correct password was rejected. The session was never created, making `roleKey` and capability enforcement irrelevant — all Group C tests failed at the login step, not the capability step.
**File:** `server/server.js` — login handler, non-seeded manager branch (~line 2861).
**Change:** In the `catch` block for `verifyAppwritePassword`, added a local `pwHash` fallback: `if (account.pwHash) { passwordOk = verifyPassword(password, account.pwHash); }`. When Appwrite is unreachable or not configured, the manager authenticates against the hash stored at account-creation time. In production with Appwrite live, the try-block succeeds and the fallback is never reached. The capability enforcement (`adminMayUse`, `roleKey`, `Your role does not include this.`) was already correct and needed no changes.

---

### Fix 6 — Failing tests: Group D (test-scholarship-route)
**Root cause (actual):** All five scholarship console routes were registered with generic capability names instead of the proper `scholarship.*` caps — `GET /applications` used `approvals.review`, `GET /applications/export` used `results.export`, `POST .../decide` used `approvals.review`, `POST .../approve` used `approvals.review`, `DELETE .../:id` used `students.deactivate`. This made the failing assertion obvious on the export check: the test asserts the Academic Director gets 403 on the export endpoint, but `FULL_ACCESS_IDS` (which includes GOC-A-002) bypasses the route-level cap gate entirely — so the AD was served a 200 CSV response instead.
**File:** `server/server.js` — scholarship route handlers.
**Changes:** Corrected all five route `cap:` fields to their semantic scholarship caps. Added an explicit `core.roleCan(sess.data.roleKey, 'scholarship.export')` guard inside the export handler body (same pattern as the Founder title-check on the approve route), so accounts in `FULL_ACCESS_IDS` that do not hold the `scholarship.export` role cap still receive a 403. `test-scholarship-route.js`: **57 passed, 0 failed**.

---

## Remaining fixes (not yet applied — awaiting go-ahead)

### Fix 7 — Failing tests: Group E (test-landing-motion — CSS)
**Root cause:** Two issues in `css/styles.css`: (a) `box-shadow` appears as an animated property — only `transform` and `opacity` are GPU-compositable; (b) one `animation:` declaration sits outside the `@media (prefers-reduced-motion: no-preference)` guard.
**File:** `css/styles.css` (then rebuild `dist/`).

---

### GOC_Fix6 — Fix 01: studyPool() section filter breaks test fixtures

**Root cause:** `studyPool()` in `js/goc-core.js` (line 1629) filters `r.section !== 'practice'`, so any question without `section: 'practice'` is excluded from the practice pool. Test fixtures either used inline BANK arrays without a `section` field, or seeded questions via `createQuestion` with `section: 'objective'` — both returning empty pools, causing downstream crashes.

**Files changed:**
- `test/test-study.js` — Added `section: 'practice'` to all four `kind:'objective'` rows in the inline `BANK` array.
- `test/test-study-window.js` — Changed `section: 'objective'` → `section: 'practice'` in the `createQuestion` setup call.
- `test/test-quest-reward.js` — Added a Founder login + console unlock + 10× `POST /api/questions` (section: 'practice', subject: Physics) seed block before the student sign-up, so the server's practice pool is non-empty when `sit()` calls `/api/me/study/start`.
- `test/test-p3.js` — Added a Founder login + `createQuestion` loop (10× Physics section:'practice') before the self-directed CBT section, followed by logout + student re-login, so `studyCatalogue()` returns a non-empty subject list when `openCBT()` is called.

**Regression tests:** `node test/test-study.js`, `node test/test-study-window.js`, `node test/test-quest-reward.js`, `node test/test-p3.js`

**Status:** APPLIED — GOC_Fix6_Fix01.zip

**Pending fixes (Fix 02–07 + A–D):** See ROADMAP-REMAINING.md.
=======
>>>>>>> origin/main
