# G.O.C Academy Hub — web app files

The prototype used to be one giant HTML file. It is now split so you can open and
read each part on its own — and it now has a real backend behind it.

## What is where

| File | What it holds |
|---|---|
| `index.html` | The structure only — every screen, button, and piece of text. No styling, no logic. |
| `css/styles.css` | Everything about how it looks: colours, spacing, the phone frame, the desktop layout. |
| `js/goc-core.js` | **The rules, written once.** Marking, XP, levels, performance, the league order, the study set-up limits. The browser and the server both use this same file, so neither can drift from the other. |
| `js/api.js` | **Where data comes from.** The only file that knows. Holds two drivers: demo data, and a real server. |
| `js/app.js` | Everything it does: screen switching, login, the console, the timetable, the Web Test, practice and reading mode. Never touches data directly — it asks `js/api.js`. |
| `js/pwa.js` | Six lines that register the service worker so the app can be installed. Skipped when opened from a file. |
| `sw.js` | The offline cache list. Bump `CACHE` (currently `goc-v12`) whenever you change a file, or phones keep the old copy. |
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

Fifteen suites, about 2,120 separate checks, no installing anything. It drives the
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
| `GOC-A-001` | `founder2027` (or `GOC_FOUNDER_PW` if set) | Console access portal (Founder) |
| `GOC-A-002` | `acaddir2027` (or `GOC_ACADDIR_PW` if set) | Console access portal (Academic Director) |

Console passcode: `2027` (or `GOC_PASSCODE` if set). Change all three from
Console → Access & firewall before a cohort registers — the server refuses to
boot in production with any of them still at the published default. Any ID
not on the roster is refused; students are created only when they sign up
with the academy access code, or when management adds them from the console.

## The academy access code

**Only somebody the academy gave a code to can create an account.** The sign-up
page asks for it before it asks for anything else, and a wrong code stops the
sign-up there — the name, the subjects and the password are never even looked at.

The code ships as **`GOC-2027`**. Only the letters and the numbers are compared, so
a scholar who types `goc 2027`, `goc-2027` or `GOC2027` is let in either way — the
dashes and spaces are a way of writing it down, not part of it. It is stored hashed,
exactly like a password, and no screen and no reply from the server ever contains
it — the console shows only its length and when it was last changed.

**Change it before a cohort registers.** Both console accounts can, Founder and
Academic Director alike: *Console → Access & firewall → Create-account code*. Give
the new one out by whatever means you already use to reach students, and change it
again after registration closes — that is what shuts the door.

To set it before the very first run instead, alongside the passwords below:

```powershell
$env:GOC_SIGNUP_CODE = "whatever-you-told-the-cohort"
```

Like the passwords, that is read only while `server/data.json` is being seeded.
After that, change it from the console.

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

The three passwords above and the passcode are published in this file, so they
are not secrets. In real mode all four can be replaced, and the two console
passwords must be — set them **before the very first run**, because that is when
`server/data.json` is written:

```powershell
$env:GOC_FOUNDER_PW  = "something-only-you-know"
$env:GOC_ACADDIR_PW  = "something-only-she-knows"
$env:GOC_PASSCODE    = "a-passcode-only-staff-know"
$env:GOC_SIGNUP_CODE = "whatever-you-told-the-cohort"
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
2. Set the two console passwords, the passcode and the sign-up code as environment
   variables, then start the server (see *Before real students use it* above).
   **Change the sign-up code from `GOC-2027` before you tell anyone to register** —
   until you do, anybody who has seen this file can create an account.
3. `node test\run.js` — every one of the thirteen suites must say `passed`.
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
