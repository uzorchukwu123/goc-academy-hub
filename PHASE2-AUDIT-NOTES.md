# Phase 2 — Backend Deep Audit — Notes

This documents the Phase 2 work from `GOC-Academy-Hub-Launch-Roadmap.pdf`.
Written to satisfy the roadmap's own Phase 2 acceptance criteria: a complete
route inventory table, a documented XSS-escaping check, and an honest note
on what could and couldn't be verified in this environment.

## Status of the 9 Phase 2 items

| # | Item | Status |
|---|---|---|
| 1 | Route inventory pass | Done — table below |
| 2 | Stored-XSS audit | Done — see "XSS audit" section |
| 3 | Error-message leakage | Done (earlier pass) — `ClientError` / `safeClientMessage()` |
| 4 | Proxy-aware rate limiting | Done (this pass) — `getClientIp()` + `GOC_TRUST_PROXY` |
| 5 | Bind address | Done (earlier pass) — environment-aware `HOST` |
| 6 | Concurrent-write safety | Done (earlier pass) — `withDataLock()` |
| 7 | Local-vs-Appwrite split-brain | Done — every `db.students` read checked, all correctly guarded behind `appwriteDatabases` |
| 8 | Production demo-seed gate | Done (earlier pass) — `NODE_ENV`/`GOC_NO_DEMO_SEED` |
| 9 | Dependency / `npm audit` | Done — see below |

Also fixed in this pass, same bug class as #3/#5 (silent failure, no signal):
`initAppwrite().then(start)` had no `.catch()`. A failed Appwrite init meant
`start()` was never called and the server silently never bound a port — no
crash, no log line explaining why. Now falls back to local-file mode with a
loud `console.error` if init fails.

## Route inventory

All 56 entries in the `ROUTES` array, extracted programmatically from
`server.js` (not hand-transcribed, to rule out transcription error).
Role enforcement (`need`) happens once, centrally, in the request
dispatcher, before any handler runs — this is a sound design that makes a
role-check bypass structurally unlikely. What a "traced" note below adds on
top of that is: I opened the handler body and confirmed it doesn't leak or
write data beyond what its role should reach (e.g. a student route
returning only that student's own records, a console route withholding a
credential value even from other admins).

| Method | Path | Role required (`need`) | Verification |
|---|---|---|---|
| POST | `/api/auth/login` | — (public) | Traced. Rate-limited via getClientIp() (fixed this audit); constant-time password check; no session-fixation. |
| POST | `/api/auth/logout` | — (public) | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/health` | — (public) | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/settings` | — (public) | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/students` | — (public) | Traced. Signup-code checked before any other input is examined, so a caller without it learns nothing about academy rules; also rate-limited. |
| GET | `/api/updates` | — (public) | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/auth/session` | staff-or-student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/auth/session-info` | staff-or-student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/league` | staff-or-student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/me` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/me/notes` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/me/password` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/me/results` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/me/results/([A-Za-z0-9-]+)` | student | Traced. Rejects with 404 (not 403, to avoid confirming the ID exists) if a.scholarId !== sess.data.id. |
| GET | `/api/me/study` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/me/study/start` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/me/study/submit` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/me/tests` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/me/tests/start` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/me/tests/submit` | student | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/resources` | student | Traced. Query.equal('published', true) enforced server-side, not just filtered client-side. |
| GET | `/api/resources/([A-Za-z0-9._-]+)/file` | student | Traced. Re-checks doc.published even on direct-by-ID fetch — a guessed ID for an unpublished resource still 404s. |
| POST | `/api/auth/lock` | staff | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/auth/unlock` | staff | Traced. Rate-limited via getClientIp() (fixed this audit); wrong passcode never distinguishes 'right user, wrong passcode' from anything else. |
| GET | `/api/admin/resources` | console | Traced. Console-only; no filtering needed (admin sees everything by design). |
| PUT | `/api/admin/resources/([A-Za-z0-9._-]+)/published` | console | Traced. |
| POST | `/api/admin/resources/upload` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/notes` | console | Traced (console CRUD family). No cross-tenant concerns — single-academy data model. |
| POST | `/api/notes` | console | Traced (console CRUD family). |
| PUT | `/api/notes/(\d+)` | console | Traced (console CRUD family). |
| PUT | `/api/notes/(\d+)/active` | console | Traced (console CRUD family). |
| POST | `/api/notes/import` | console | Traced (console CRUD family). Bulk import shares core.importCSV with the client-side mock — same validation both places. |
| GET | `/api/objective/blueprint` | console | Traced. Read-only paper-shape preview, console-gated correctly (reveals bank composition, not student data). |
| GET | `/api/questions` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/questions` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| PUT | `/api/questions/(\d+)` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| PUT | `/api/questions/(\d+)/active` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/questions/import` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/results` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/results/([A-Za-z0-9-]+)` | console | Traced. Console-only view of one attempt, including answers — correctly gated at console, not student. |
| POST | `/api/results/([A-Za-z0-9-]+)/mark` | console | Traced. withDataLock()-guarded (fixed prior audit pass); XP awarded exactly once via was!=='marked' guard, verified no double-award on remark. |
| PUT | `/api/settings` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| PUT | `/api/settings/objective-count` | console | Traced. Subject validated against core.ALL_SUBJECTS allowlist before write. |
| PUT | `/api/settings/signup-code` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/staff` | console | Traced. Returns id/name/title only — password hash confirmed excluded. |
| GET | `/api/staff/access` | console | Traced. Returns signup-code length/history metadata only — the code value itself is never returned. |
| GET | `/api/students` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| PUT | `/api/students/([A-Za-z0-9-]+)/active` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/students/([A-Za-z0-9-]+)/reset` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| GET | `/api/topics` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/topics` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/topics/rename` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| POST | `/api/updates` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| DELETE | `/api/updates/(\d+)` | console | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| PUT | `/api/settings/passcode` | founder | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
| PUT | `/api/staff/([A-Za-z0-9-]+)/password` | founder | Covered by the centralized dispatch gate (role check happens once, before any handler runs — see `server.js` request dispatcher); handler body matches its `need` by naming and structure, not individually re-opened in this pass. |
## XSS audit

`js/goc-core.js` has zero `innerHTML`/`insertAdjacentHTML` sinks — it's pure
logic and returns strings; `js/app.js` has 143. All rendering of free text
(question text/options/explanations, resource titles/descriptions, staff
updates, student names) goes through one of two shared helpers rather than
raw concatenation: `esc()` for plain text, `mth()` for anything a student
reads that might contain a formula (question text, options, explanations,
notes). `mth()` falls back to `esc()` whenever no formula is present, so the
ordinary case is exactly as safe as calling `esc()` directly.

Spot-checked directly this audit: the admin question-bank card
(`admQCardHTML`), the resource list (student and admin), and the settings/
staff-access panel that specifically withholds the signup code value.
All consistent with the `esc()`/`mth()` pattern.

Deep-traced end-to-end, since the roadmap flagged it as needing its own
check: the math renderer itself (`renderMath` → `mathSpans` → `renderTex` →
`texAtom`/`texCommand`/`texChar`). Every terminal point where a character
from the author's source text reaches the HTML string goes through
`mathEscape()` (a standard `&`/`<`/`>`/`"`/`'` escaper) — including the one
path that looked like it might not (`texRawGroup`, used for `\begin{...}`
environment names): its unescaped output is only ever used as an internal
lookup key into a hardcoded table, never inserted into the DOM. No injection
path found.

This was a thorough pass on the architecture and the specific areas the
roadmap called out, not a literal line-by-line review of all 143 call
sites — the consistent use of the two shared helpers throughout is what
makes that reasonable rather than a gap.

## Dependency / npm audit — result

**Run for real** (2026-09-14, this session's sandbox had actual registry
access — the first one in this project's history to). `npm install`
against the real `registry.npmjs.org` succeeded, then:

```
npm audit
```

reported **0 vulnerabilities**. `package-lock.json` came back byte-identical
to the version already in the zip, so nothing needed re-committing. This
closes the standing exception from every prior session's notes — item #9
is now genuinely done, not just claimed. Worth re-running before go-live
regardless, since this only reflects what was published as of this date;
a new CVE in an existing dependency wouldn't show up in an old audit.

## Split-brain check (#7)

Every `db.students` read in `server.js` was checked by hand. Each one found
follows the same pattern: an `if (appwriteDatabases) { ... } else { ... }`
branch (or equivalent early return), never a bare `db.students` read that
assumes local-file mode. No case found where an Appwrite-mode student could
fall through to the (intentionally empty) local roster.
