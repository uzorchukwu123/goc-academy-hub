# Local development in Chrome — no Appwrite required

This is the procedure for running the **2027 Free Tutorial Edition** (and the rest
of the hub) on your own machine, in Chrome, while **the Appwrite Database API is
unavailable** — allowance exhausted, API suspended, or simply no network. Nothing
here touches production: no production credentials, no production data file, and a
separate data folder that cannot overwrite anything real.

The edition stores **everything** in a local JSON file. It never reads or writes
the Appwrite Database, on any deployment — see "What is local and what is not".

---

## 1. Install dependencies

From the repository root:

```bash
npm install
```

`node-appwrite`, `appwrite`, `nodemailer`, `dotenv` and `busboy` are all in
`package.json`. Nothing else is needed to run locally.

## 2. Configure the local run

The server reads a `.env` file in the repository root, but **you do not need one**
for local development. The safest way to run is to pass the variables on the
command line, so nothing is written into the repository at all.

```bash
# linux / macOS
export GOC_FREE_2027=1                    # the edition's master switch
export GOC_FREE_2027_DEV_OTP=1            # show the one-time code on screen (development only)
export GOC_DATA_DIR=./local-test-data     # a scratch data folder — ignored by git
export PORT=8080
export GOC_APPWRITE_OFF=1                 # never contact Appwrite, even if .env has credentials
export GOC_FOUNDER_PW='local-founder-2027' # a LOCAL password — never the production one
export GOC_ACADDIR_PW='local-acaddir-2027'
export GOC_PASSCODE='481516'
```

```powershell
# Windows PowerShell
$env:GOC_FREE_2027="1"; $env:GOC_FREE_2027_DEV_OTP="1"; $env:GOC_DATA_DIR="./local-test-data"
$env:PORT="8080"; $env:GOC_APPWRITE_OFF="1"
$env:GOC_FOUNDER_PW="local-founder-2027"; $env:GOC_ACADDIR_PW="local-acaddir-2027"; $env:GOC_PASSCODE="481516"
```

| Variable | What it does here |
|---|---|
| `GOC_FREE_2027=1` | Opens the hub in 2027 Free Tutorial Mode. Unset or `0` ⇒ Original Mode and every `/api/free2027/*` route is a 404. |
| `GOC_FREE_2027_DEV_OTP=1` | Hands the one-time code back to the page instead of emailing it. **Ignored whenever `NODE_ENV=production`.** |
| `GOC_DATA_DIR` | Where `data.json` and `free2027-archives/` are written. Point it away from `server/` so a test run can never touch a real file. |
| `GOC_APPWRITE_OFF=1` | The whole server runs local-only: no Appwrite client is built, so no request is made even if `.env` still carries `APPWRITE_*`. |
| `GOC_FOUNDER_PW` / `GOC_ACADDIR_PW` / `GOC_PASSCODE` | Local console credentials, hashed with scrypt into the **local** data file on first boot. Use throwaway values. |

> **Why `GOC_APPWRITE_OFF`?** Your `.env` may still hold the production Appwrite
> keys. Without this switch the server tries to mirror every write to Appwrite
> Storage and logs an error each time the suspended API refuses. With it, nothing
> leaves the machine. It has no effect unless you set it, and production must
> never set it.

If you *do* want a `.env`, copy the keys above into one — `.env` is already in
`.gitignore` and must never be committed.

## 3. Start the server

```bash
node server/server.js
```

You should see:

```
  G.O.C Academy Hub is running
  Open:  http://localhost:8080
  Storage: local file (server/data.json)
  2027 Free Tutorial: ON — records in .../local-test-data/data.json (no Appwrite Database).
  Free tutorial archives: .../local-test-data/free2027-archives
```

If that "2027 Free Tutorial: ON" line is missing, `GOC_FREE_2027` did not reach
the process. Check `/api/health` — it reports `free2027.on`, `free2027.mode`,
`free2027.storage` (`local-json`) and the exact file in use.

## 4. Open it in Chrome

```
http://localhost:8080
```

You land on the edition's homepage (Original Mode is one switch away in the
console). Use a normal window first, then DevTools → device toolbar at **360 px**
for the phone layout.

For the console, five **quick** clicks (each within 2.5 s) on the homepage's
"**4** Science subjects" card open the administrator sign-in. That is the only
entrance in the edition; it reuses the hub's own staff login and passcode.

## 5. Test the student experience

1. Homepage → **Register free**.
2. Full name, a real-looking email (e.g. `ada@example.com`), intended course.
   No password is ever asked for.
3. **Send code** → the code appears on screen in a box beginning *"This site has
   no email sender configured yet…"* (that is the development OTP).
4. Enter it → you get a participant ID (`GOC-F27-0001`) and land in the CBT
   Portal.
5. The **programme card** at the top shows your ID, course, access status, lesson
   progress and quiz average. Tick a lesson **Mark done** — it turns green and the
   count moves.
6. Sit nothing yet: an activity has to be created first (step 6 below). Once one
   exists, open it from **Weekly Assessments**, answer, leave mid-paper and come
   back (the same attempt resumes with the **server's** remaining time), then
   submit — the result appears immediately and a weekly result is private.
7. **Competitions** work the same way; its **Competition Leaderboard** is public
   only after the administrator approves **and** publishes it, and shows the top
   ten only.

## 6. Test the Founder and Academic Director experience

Five quick clicks on the "4 Science subjects" card → sign in:

| Account | Staff ID | Password | Role |
|---|---|---|---|
| Founder | `GOC-A-001` | `local-founder-2027` | full console |
| Academic Director | `GOC-A-002` | `local-acaddir-2027` | academic + programme management |

Then the console passcode (`481516`). Open the **2027 Free Tutorial** tile:

- **Website mode** — switch to 2027 Free Tutorial Mode (confirm), stay in the
  console, switch back to Original Mode. The hub must be exactly as it was.
- **Activities** — **Load questions** now reads the **local** bank (not Appwrite).
  Create a weekly assessment, set its window, publish it, then sit it as the
  student. The same tab manages **Programme lessons** (add/remove).
- **Participants** — masked emails, switch-off, CSV export, and each candidate's
  lesson progress.
- **Results** / **Leaderboards** — approve then publish a competition board.
- **Session records** — the event list **and the programme audit records** (who
  changed what).
- **Sessions & archive** — archive the session to a local JSON file and start a
  fresh, empty one.

The Academic Director can do the academic work (activities, lessons, results,
progress, audit) and is refused the Founder-only actions (session archiving,
website mode). A signed-in student or a free-tutorial participant cannot reach any
console route: the server refuses them, not the page.

## 7. Restart and confirm persistence

```bash
# stop the server with Ctrl+C, then start it again with the same GOC_DATA_DIR
node server/server.js
```

Then check, without touching anything else:

- the student re-verifies with a code and keeps the **same participant ID**;
- **Session records** and the **programme audit records** still list what happened;
- **Participants** still lists everyone, with their lesson progress;
- **Sessions & archive** still lists the archive file, and it opens;
- `local-test-data/data.json` holds everything under `db.free2027`, and
  `local-test-data/free2027-archives/` holds one JSON file per archived session.

A quick machine check:

```bash
curl -s http://localhost:8080/api/health
# "free2027":{"on":true,"mode":"free2027","storage":"local-json","storageFile":".../local-test-data/data.json", ...}
```

## 8. Start clean

Stop the server, delete the scratch folder, start again:

```bash
rm -rf local-test-data
```

Nothing outside that folder is affected. `local-test-data/`, `*.local-data/` and
`free2027-archives/` are all in `.gitignore`, so a test roster can never be
committed.

---

## What is local and what is not

| Data | Where it lives | Appwrite Database used? |
|---|---|---|
| Registrations, profiles, access, course enrolment | `db.free2027` → `$GOC_DATA_DIR/data.json` | **No** |
| Lessons, lesson completion, learning progress | `db.free2027` → same file | **No** |
| Activities, attempts, quiz results, leaderboards | `db.free2027` → same file | **No** |
| Programme settings, session records, audit trail | `db.free2027` → same file | **No** |
| Archived sessions | `$GOC_DATA_DIR/free2027-archives/*.json` | **No** |
| The question bank the edition's papers draw on | `db.questions`, read **locally** by `/api/free2027/admin/questions` | **No** |
| Console authentication (Founder, Academic Director) | `db.staff`, scrypt hashes in the local file | **No** |
| The **original** hub (student portal, CBT, resources, videos, tutors) | unchanged: Appwrite when configured, local file otherwise | unchanged |

The edition does **not** disable Appwrite, remove it, or change the original
hub's persistence. It simply never calls it. With `GOC_APPWRITE_OFF=1` the whole
process goes local; without it, the hub behaves exactly as it always has and the
edition still stays local.

**Known limitations**

- The edition's question picker reads the **local** `db.questions`. A machine
  whose collection lives only in Appwrite will show an empty picker until the
  bank is present locally — the console says so instead of failing silently.
- Participant tokens are in memory, as before: a restart signs candidates out and
  they verify again with a code (their records are untouched).
- The development OTP is a development convenience. Production needs a real SMTP
  sender; without one, registration stops at the code step and the page says so.
