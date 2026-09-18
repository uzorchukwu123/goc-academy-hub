# Security & stability fixes — 4 September 2026

This note explains, in plain English, what was changed to make the Academy Hub
safe to launch, how each change was checked, and the few things **you** still
need to do before real students use it. Nothing about how the app looks or plays
was touched — only the server's safety.

Only one program file changed: **`server/server.js`** (the part that runs on the
computer hosting the app). Two test files were added so these problems can never
quietly come back. None of the phone/browser files changed, so the app's offline
cache version stays **goc-v12** — students will **not** be forced to re-download
anything.


## The four problems that were fixed

**1. The database could be downloaded through a capital-letter trick.**
The server tried to keep the `server/` folder (which holds `data.json` — every
password hash and the console passcode) off the web, but the check was
case-sensitive. On Windows, asking for `/SERVER/data.json` with capital letters
slipped past it and handed over the whole file. The check is now
case-insensitive, so every spelling is refused.

**2. Sensitive files were downloadable over the web.**
Anyone who knew the names could open `readme.md` (which lists the demo
passwords), `start-server.ps1`, the blueprint PDF, `server/schema.sql`, and the
import spreadsheets — straight from a browser. The server now serves **only** the
file types the app itself needs (`.html`, `.css`, `.js`, the icons, and the app
manifest). Everything else is refused by default, so any sensitive file added
later is protected automatically without anyone remembering to hide it.

**3. One bad web address could crash the whole server.**
A malformed address (a broken "%" code in the URL) made the server throw an
error that was never caught, which would kill the program — signing out every
student in the middle of their paper. Two things were added: the address is now
decoded safely (a bad one returns a tidy "400 Bad request" instead of crashing),
and a last-resort safety net keeps the server running even if anything else
unexpected ever goes wrong. It logs the problem and stays up.

**4. Account sign-up could be hammered without limit.**
Logging in and unlocking the console were already rate-limited — after 8 wrong
tries from the same place, further tries are held off for a few minutes. Sign-up
was not, even though it runs the same deliberately-slow password step, so it
could be used to tie the server up. Sign-up now uses the exact same limit. A
correct sign-up clears the counter, so an invited class is never locked out.


## How it was checked

The full automatic test suite — now **14 groups of tests, all passing** — was run
after the changes. A new group, `test/test-security.js`, starts a real copy of
the server and proves all four fixes over an actual web connection: it plants a
fake password file and confirms it cannot be downloaded, tries the capital-letter
trick, fires a malformed address and checks the server is *still answering*
afterwards, and confirms the 9th rapid sign-up attempt is held off. On top of the
automatic tests, the real server was started and each fixed address was checked
by hand — every sensitive path returned "not found", and the app's own pages
still loaded normally.


## What you must still do before a real cohort (not code — settings)

These were always meant to be your decisions, and the app now warns you about
them on first start:

1. **Set your own passwords before the very first launch.** When the server
   starts for the first time it creates `server/data.json`. If you set these
   Windows environment variables *first*, your own values are used and the
   published demo ones are never written:
   `GOC_FOUNDER_PW`, `GOC_ACADDIR_PW`, `GOC_PASSCODE` (console passcode), and
   `GOC_SIGNUP_CODE` (the code students need to open an account).
   `START-HERE.md` / `readme.md` show the exact lines to paste.

2. **The demo student accounts are still created on first start** (Amara, Tunde,
   and the rest, with the passwords printed in `readme.md`). That is on purpose,
   for showing the app. Before a real class relies on it, remove or reset those
   demo accounts and change the demo passwords — anyone who has read `readme.md`
   knows them.

3. **Passwords still travel in plain text today.** That is fine on one computer
   over your own hotspot, but the moment the app is reachable from the internet
   it **must** be behind HTTPS. See `DEPLOYMENT.md`.

4. **Never delete `server/data.json` once real students are on it.** It is the
   only copy of the roster, results, and XP. The new `.gitignore` already stops
   it from being uploaded to a code repository by accident.


## Files changed
- `server/server.js` — the four fixes above.
- `test/test-security.js` — new; proves the four fixes over real HTTP.
- `test/run.js` — added the new test group to the run.
- `.gitignore` — new; keeps `server/data.json` and secrets out of any repo.
- `server/data.json` — intentionally **not** included in this copy, so your first
  start creates it with *your* passwords.
