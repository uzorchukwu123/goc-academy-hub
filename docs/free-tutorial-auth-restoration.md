# Free UTME Tutorial student accounts and sessions

This note records the correction that gave the **2027 Free UTME Tutorial** its own
complete registration and login system, with student accounts and records that
outlive the login session. It is a correction to the existing implementation, not
a new system: the edition's screens, styling, routes, data file and question banks
are the ones the programme already used.

The **original G.O.C Academy Hub account system is a different system** and was
not touched. `js/app.js`, `js/api.js` and `css/styles.css` are byte-for-byte
unchanged by this work, and the only edit to `server/server.js` is inside the
`/api/free2027/*` route block.

## 1. What was wrong

The edition's registration was the early **code-only** draft: name, email, course
and a one-time code, with the page promising *"There is no password to
remember."* There was no login page and no way to come back to an existing
account. Three consequences followed:

| Problem | Effect on a student |
| --- | --- |
| No password, no `POST /api/free2027/login` | Nothing to log in **with**. Returning meant registering again. |
| Sessions held in an in-memory `Map` | Every server restart signed everybody out. |
| Token in `sessionStorage` | Closing the browser signed the student out even while the session was valid. |
| Random `GOC-F27-<20 hex>` identifiers | Not the programme's `GOC-F-001` student numbers. |

The password/login implementation existed on the sibling PR #9 line
(`002034f` → `bcb590b` → tip **`71e9ebb`**). It was **never on this branch**:
`git merge-base --is-ancestor 002034f HEAD` is false, and `id="free-login"` appears
in none of the 34 commits reachable from this branch. Nothing had been deleted
here — the work had simply never been ported. This change ports it at function
level, keeping every later PR #10 fix.

## 2. What a student does now

**Register** (`#free-register`): full name, email address, **password**, intended
course → a 6-digit code is emailed → entering it verifies the address, creates the
account and signs them in.

**Log in** (`#free-login`): the registered email address and password. This is the
real authentication mechanism; a code on its own never authenticates anybody
permanently.

The two pages link to each other, and the login page also offers the code-only
route for students who registered before passwords existed.

Password policy is defined **once**, in `js/goc-free-2027.js` (`cleanPassword`),
and shared by the page and the server so they cannot disagree: at least 8
characters, at most 72, containing both letters and numbers. Each failure names
itself ("…at least 8 characters.", "Use a password containing both letters and
numbers.").

Passwords are stored only as `scrypt$<salt>$<key>` — a 16-byte random salt per
password and a 64-byte scrypt key, compared with `timingSafeEqual`. The chosen
password travels with the pending email code **already hashed** (`otp.pwHash`), so
an account is only created once the address is proved. No plaintext password is
written to the data file, returned by any route, or logged.

Login answers identically for an unknown address, an unverified account, a
switched-off account, an account with no password yet and a wrong password
(`403 That email address or password is not right.`), so the route cannot be used
to enumerate accounts. It is guarded by the **same** per-address password-guessing
throttle (`tooManyAttempts` / `noteFailure`) the hub's other password routes use.

## 3. Student numbers

New students receive **`GOC-F-001`, `GOC-F-002`, `GOC-F-003`, …** — zero-padded to
three digits, growing past 999.

* `rules.studentId(n)` formats it; `rules.idSeqOf(id)` reads the number back.
* `nextStudentId(ed)` is the only allocator and runs **inside the data lock**, so
  two simultaneous registrations cannot collide.
* `ed.studentIdSeq` lives on the **edition**, so it survives a session archive.
* `ed.studentIds` remembers every number ever issued, so a removed student's
  number is never handed out again.
* `ed.studentIdsByEmail` returns a returning student their original number.

**Identifiers issued by the earlier random scheme are preserved.** `ID_RE` accepts
`GOC-F-\d{3,}` and `LEGACY_ID_RE` still accepts `GOC-F27-[A-F0-9]{20}`, so an
existing `GOC-F27-…` student keeps their identifier, and every attempt, answer and
result stays attached to it. Nothing is renumbered, and the two schemes coexist.
On a data file that has no counter, `ensureEdition` seeds `studentIdSeq` from the
identifiers already issued (legacy identifiers contribute 0), so the sequence
resumes rather than restarting.

## 4. Accounts belong to the student, sessions do not

Two separate stores in `db.free2027`:

* **`sessions[].participants[]`** — the account: identifier, name, email, course,
  `passwordHash`, enrolment, access, progress. Attempts, answers, scores and
  results live beside it in `sessions[].attempts` and the leaderboards.
* **`authSessions[]`** — the login sessions: `tokenHash` (SHA-256 **digest** of the
  token, never the token), `participantId`, `sessionId`, `createdAt`,
  `lastSeenAt`, `expiresAt`.

`logout()` deletes **one** `authSessions` entry and writes. It does not read,
change or remove a participant, an attempt, an answer, a score, a result, a
progress sheet or a registry entry. Logging back in looks the account up by email
and returns it; it never creates one.

Because only a digest is stored, a copy of the data file contains no usable
token. Because the store is on disk, a **server restart** no longer signs anyone
out. The store is bounded (expired entries pruned, `AUTH_SESSION_MAX` 5000).

`dropToken` / `dropTokensFor` accept the edition the caller already loaded, so a
deactivation or removal and its session cleanup are persisted in **one** write.
`readData()` returns a fresh snapshot each call; re-reading inside the helper
would clobber the caller's pending edit and their write would then restore the
sessions. `test-free2027-auth.js` §K fails against that mistake.

## 5. Inactivity, refresh, and signing out

The window is an **inactivity** timeout, configured in one place:
`rules.SESSION_IDLE_MIN` (default **480 minutes / 8 hours**), overridable per
deployment with **`GOC_FREE_2027_SESSION_IDLE_MIN`**. Values are clamped to 5
minutes…30 days; a missing or nonsense value falls back to the default.

| Event | Result |
| --- | --- |
| Page refresh | Still signed in |
| Close and reopen the browser | Still signed in while the session is valid |
| Server restart | Still signed in |
| Keeps working | Window slides forward; never interrupted |
| Inactive past the window | Must log in again |
| Explicit sign out | Session ends immediately |
| Log in again | Same account, same identifier, same records |

`sessionFromReq` checks `expiresAt` on every protected request and, while the
session is live, slides it forward — persisted at most once a minute
(`SESSION_TOUCH_MS`) so ordinary clicking does not rewrite the file per request.
An expired or signed-out token gets `401` on `/me`, `/activities`, `/programme`,
`/results` and `/attempts/:id`; the page drops the dead token and shows
`#free-login` with *"Your session has expired. Log in again to continue — all your
records are saved."*

The browser keeps the token in **`localStorage`**, not `sessionStorage` — that is
what makes closing the browser survivable. A token left in the old per-tab
location is adopted once and moved, so nobody already signed in was interrupted.
Sign out sends the request **while the token is still held** (otherwise the server
cannot tell which session to end) and clears both stores afterwards, even if the
request fails.

## 6. Students who registered with a code only

They are not locked out and are not asked to create a new account.
`startRegistration` refuses a re-registration only when the existing verified
account **already has a password** (`409 … Log in with your password instead.`).
An account with no `passwordHash` is allowed through the same email-code flow, and
`verifyRegistration` attaches the newly proved hash to the **existing** record:

```js
if (!p.passwordHash && otp.pwHash) p.passwordHash = otp.pwHash;
```

The identifier, name, email, course, enrolment, access, progress, attempts,
answers, scores and results are untouched. Once a password exists the account is
protected normally and the code-only route closes for it. This is the one
deliberate departure from `71e9ebb`, which had no reachable path for a
pre-password account; it is what makes the upgrade possible without a second
account system.

## 7. Navigation: one entry point, one authentication decision

Corrected after live testing. Every public **CBT Portal** entry point — the
homepage button near the motto, the desktop navigation link and the mobile
sidebar button — calls `freeCbtPortal()`, which opens the edition's **landing
page** (`#free-home`). That page is unchanged in appearance and offers exactly
three choices: **Register free**, **Student log in**, **Enter the CBT Portal**.

The entry itself makes no account decision. The decision happens one step later:

| Control | Behaviour |
| --- | --- |
| **Register free** | Opens `#free-register` directly, always |
| **Student log in** / **Enter the CBT Portal** | `freePortalEnter()` — valid session → `#free-portal`; no/expired/signed-out session → `#free-login` |

`#free-login` links straight back to `#free-register`, so an unregistered student
is never stranded. No step routes a Free UTME student to the hub's `login-v2`,
`signup`, or any other account page.

### The homepage hero adapts to the active mode

Two homepage hero controls are mode-aware. Nothing else on the homepage changed.

| Hero control | Original Mode | Free Tutorial Mode |
| --- | --- | --- |
| **Get started** | Visible; opens `#signup` (unchanged) | Not displayed — registration belongs to the edition's **Register free** |
| **I already have an account** | Opens `#login-v2` (unchanged) | Opens `#free-login` |
| **CBT Portal** | Not displayed | Opens the edition landing page via `freeCbtPortal()` |

"Get started" is **hidden, never deleted**: the button and its `go('signup')`
handler stay in `index.html`, and one mode-scoped rule
(`body.f27-mode #landing .hero-btns .hero-original-cta`) hides it in Free Tutorial
Mode only. Switching back to Original Mode removes the body class and the button
returns exactly as it was.

"I already have an account" keeps its text, class, styling, position, size and
visibility in both modes. Only its `onclick` changed, to `heroAccount()` — a
three-line navigation action that picks `#free-login` in Free Tutorial Mode and
`#login-v2` otherwise, including the offline fallback where the mode answer never
arrives. It creates no authentication system and changes no auth behaviour.

The hub's **nav** "Get started" and the drawer's **Create free account** are
untouched and still shown in Free Tutorial Mode, so the original account system
remains independently usable in either mode.

**Navigation links removed:** the duplicate `Log in` link in the edition landing
page's own nav bar (its hero still carries **Student log in**), and the hub's
`Log in` shortcut in the homepage nav and mobile drawer, which **stands down in
Free Tutorial Mode only** (`body.f27-mode .dw-hub-login`). That shortcut pointed a
free-tutorial student at an account they never created. It is not deleted:
Original Mode shows it exactly as before, `#login-v2` is untouched, and the hub's
"Get started" / "Create free account" actions remain visible in every mode.

**The public catalogue is unchanged.** `GET /api/free2027/catalogue`,
`publicActivities()` and the guest rendering still work exactly as before and
still expose public metadata only — never a question, option, answer, mark or
student record. Only the navigation route to the portal changed. The removed
"Start Free UTME Bootcamp" homepage CTA has not returned.

## 8. Migration safety

Every addition is additive; an older data file simply gains empty stores:

* `ed.authSessions = []`
* `ed.studentIdSeq` seeded from identifiers already issued
* `participant.passwordHash` added only when a password is proved

No existing field is rewritten, no record is removed, no identifier is changed,
and no student is invalidated. The permanent registry (`studentIds`,
`studentIdsByEmail`) already existed on this branch and is reused as-is.

## 9. Verification

| Gate | Result |
| --- | --- |
| `npm test` | **200 suites, all passed** (exit 0) |
| `npm run build` | exit 0 — 1777690 → 1093714 bytes (38% smaller) |
| `node test/test-free2027-auth.js` | **94 assertions passed** |
| `node test/test-free2027-session-client.js` | **all passed** |
| Real-browser harness (fresh isolated install) | **292/292 checks passed**, 0 page JS errors |
| `git diff --check` | clean |

`test/test-free2027-auth.js` runs against the real HTTP server and the real data
file and covers: registration and the password rules; scrypt storage with no
plaintext anywhere; login (wrong/missing/unknown/code-as-password); sign-out
leaving every owned byte identical; logging back in restoring the same identifier
with no duplicate; a **real server restart** keeping the session; the inactivity
window sliding and then expiring; the timeout override and its fallbacks; a
pre-password student with a **legacy identifier** and existing history setting a
password without losing anything; the sequence continuing without collisions;
deactivation ending sessions atomically and reversibly; and the public catalogue
staying open.

`test/test-free2027-session-client.js` runs the real `js/free2027-api.js` in a vm
with realistic storage objects: durable token storage, adoption from the old
location, sign-out request ordering, offline sign-out, and a refused login storing
nothing.

The browser harness registers a student through the page, sits papers, then signs
out through the real control, checks the data file byte-for-byte, logs back in
through `#free-login`, and finally **closes the browser completely and opens a new
one** carrying only durable storage — the student is still signed in as the same
account with their results intact.

It also verifies the corrected navigation on **both mobile and desktop**: all
three public CBT Portal entries open the same landing page; the separate Log in
links are not displayed in Free Tutorial Mode; Register free opens the edition
registration page; Enter the CBT Portal sends an unauthenticated visitor to the
edition login; that page's registration link works; a valid session enters the
portal directly; an **expired session** returns to the edition login and logging
back in restores every record; and Original Mode brings the hub's Log in shortcut
back with the hub's own registration and login still working.

The hero is verified by **clicking it for real** through two complete
Original → Free → Original round trips on **each** layout (mobile 390×844 and
desktop 1366×900), driven by the Founder's actual Website Mode Control panel:
Get started hidden/shown correctly, its handler never deleted, the account link
unchanged and opening the right login page each time, the CBT entry shown only in
Free Mode, no accumulated `f27-mode`/`goc-original-area` class, and student
records intact after every switch.

Limits, stated plainly: the browser run is headless Chromium 131 emulating
390×844 and desktop viewports, not physical devices; the data store is the local
JSON file, not a live Appwrite Database; email uses the SMTP capture adapter. The
Vercel check on this PR fails identically on `main` and on every earlier head —
it is pre-existing and unrelated.

## 10. Files changed

`js/goc-free-2027.js`, `server/lib/free2027.js`, `server/server.js`,
`js/free2027-api.js`, `js/free2027-ui.js`, `index.html`, `css/free2027.css`,
`js/free2027-admin.js` (console wording only), `sw.js` (now `goc-v198`),
`DEPLOY-CHECKLIST.md`, and the tests.

The follow-up navigation correction touched only `index.html`,
`css/free2027.css`, `js/free2027-ui.js`, `sw.js`, `DEPLOY-CHECKLIST.md` and four
test files. No server code, authentication logic, data structure or hub file was
modified by it.

The final homepage-hero correction is smaller still: **one `onclick` attribute**
in `index.html`, **one mode-scoped CSS rule**, and **one navigation function**
(`heroAccount`) in `js/free2027-ui.js`, plus the `goc-v199` cache bump and the
tests that encode the new contract.

Two changes sit just outside the authentication code and were necessary:

1. **`css/free2027.css`** — one rule scoped to `.f27-form .pw-wrap input` (plus the
   toggle colour) so the restored Show/Hide control does not cover the last
   characters a student types. It cannot match anything outside these two forms.
2. **`js/free2027-admin.js`** — the console description said
   `GOC-F27-… participants`; it now names the `GOC-F-001` student numbers the
   programme actually issues. No behaviour changed.
