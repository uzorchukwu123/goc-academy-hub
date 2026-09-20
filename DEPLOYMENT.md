# Deployment — G.O.C Academy Hub

This is the single canonical deployment reference for this project. It supersedes
`DEPLOY-RENDER-RAILWAY.md`, `HOSTING-WHEN-READY.md`, and `HOSTING-STEP-2-Local-Test.md`,
which have been retired.

The app is ready for any always-on Node host you manage (a VPS, a bare-metal box,
anything running `node server/server.js` under a process manager like PM2 or systemd).

**Do not deploy with `server/data.json` sitting on an ephemeral/rebuilt filesystem.**
There are two ways to make the data durable, and you can use them together:

- **Persistent data directory (baseline).** Set `GOC_DATA_DIR` to a directory outside
  your deployed code checkout, on a disk that survives redeploys, so a fresh
  `git pull`/`git clone`/rebuild never wipes `server/data.json`. See
  "Step 1 — Persistent data directory". This alone is enough on a VPS you fully control.
- **Appwrite persistence (recommended for questions & attempts).** With the
  `APPWRITE_*` variables set, **questions** and **student test attempts** live in their
  own Appwrite Database collections, and the remaining settings blob
  (settings/notes/topics/contactMessages/affirmations/importLog) is mirrored to Appwrite
  Storage and re-hydrated at boot. This survives a redeploy even if the code folder is
  replaced and no persistent disk is mounted. See
  "Step 3 — Appwrite persistence & migration". The student roster and uploaded
  resource/video files already live in Appwrite.

When Appwrite is **not** configured, questions/attempts fall back to `server/data.json`
exactly as before (durability then comes from `GOC_DATA_DIR`). Nothing about the local
path changed.

See [`PHASE2-AUDIT-NOTES.md`](./PHASE2-AUDIT-NOTES.md) for the backend security audit
(route inventory, XSS review, dependency-audit caveat) referenced in the go-live
checklist below.

## Before deployment

1. Keep the GitHub repository **private**. Confirm `server/data.json` and `.env` are not tracked.
2. Decide where `server/data.json` will physically live on your host — see Step 1.
3. (Recommended) Set up Appwrite for durable storage:
   - An Appwrite Database (`goc_academy`) with a `students` collection (see
     `server/server.js`'s `APPWRITE_STUDENTS_COLLECTION_ID` and related constants).
   - The `questions` and `attempts` collections — you do **not** create these by hand;
     `node server/setup-appwrite.js` provisions them (see "Step 3 — Appwrite persistence
     & migration").
   - A Storage bucket for uploaded resource/video files **and** the settings blob —
     Bucket name: `GOC Academy Data`, Bucket ID: `goc-data`, File security: enabled.
     The blob is stored as file id `academy-data-json` (`APPWRITE_FILE_ID`).
   - A server API key with Database and Storage read/write permission. Keep it private,
     and rotate it if it's ever been exposed (committed, shared in a file, pasted anywhere
     public).
4. Keep any Appwrite API key, project ID, and all academy passwords in the host's
   environment variables (or a gitignored `.env` file) — never in a committed file.

## Step 1 — Persistent data directory

`server/data.json` must live somewhere that survives a redeploy — outside your git
checkout, on disk that isn't recreated when you pull new code.

```bash
mkdir -p /var/lib/goc-academy-hub/data
```

Set `GOC_DATA_DIR` to that path (add it to the project's `.env` file, or export it in
whatever starts the process — PM2 ecosystem file, systemd unit, shell profile):

```text
GOC_DATA_DIR=/var/lib/goc-academy-hub/data
```

Leave `GOC_DATA_DIR` unset only for local development, where the default
(`server/data.json` next to the code) is fine.

Confirm it's working: start the server, sign in, make a change (import a question,
change a setting), restart the process, and confirm the change is still there.

## Step 2 — Deploy

### Required environment variables

```text
NODE_ENV=production
GOC_DATA_DIR=/var/lib/goc-academy-hub/data
GOC_FOUNDER_PW=<new-founder-password>
GOC_ACADDIR_PW=<new-academic-director-password>
GOC_PASSCODE=<new-console-passcode>
GOC_SIGNUP_CODE=<new-student-signup-code>
GOC_NO_DEMO_SEED=1
GOC_TRUST_PROXY=1
```

### Optional environment variables

```text
GOC_BACKUP_INTERVAL_MIN=360   # minutes between local data.json backups (default 360 = 6h; 0 disables)
GOC_BACKUP_KEEP=28            # how many timestamped backups to retain before pruning (default 28)
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1   # only if using Appwrite (see "Before deployment")
APPWRITE_PROJECT_ID=<your-project-id>
APPWRITE_API_KEY=<your-server-api-secret>
APPWRITE_BUCKET_ID=goc-data
APPWRITE_FILE_ID=academy-data-json               # the settings-blob file inside the bucket
```

Every boot takes a rotating, timestamped copy of `server/data.json` into
`server/backups/` (one immediately at startup, then on the interval above),
pruning down to the most recent `GOC_BACKUP_KEEP` copies. `server/backups/`
is blocked from being served over HTTP the same way `server/data.json`
already is (see `PHASE2-AUDIT-NOTES.md`).

This only backs up the **local-file** data — staff, settings, questions,
notes, attempts, and (on a non-Appwrite install) students. On an
Appwrite-Database install, student records live in Appwrite and never touch
`data.json`, so this rotation does not cover them. Back those up with
Appwrite's own export/backup tooling, or a separate scheduled script that
pulls a snapshot of the Students collection using the Appwrite SDK — that
needs real Appwrite credentials this project's sandbox never had, so it's
left as an operator decision rather than guessed at here.

### Shipped default secrets

The server checks the *actual stored* Founder/Academic Director passwords,
console passcode, and signup code against the published demo values on every
boot (not just at first seed, so an old, never-rotated `data.json` is caught
too):

- **`NODE_ENV=production` or `GOC_NO_DEMO_SEED=1` set** (i.e. this looks like
  a real deploy): the process **refuses to start** and exits if any of those
  four are still the published default. Fix the ones it lists, then restart.
- **Otherwise** (local dev): it prints a loud, boxed warning to the console
  and keeps running, so a bare `node server/server.js` still works for
  trying the app out.

Use new production secrets everywhere — never the demo/development values.

`HOST` no longer needs to be set by hand: the server now binds `0.0.0.0`
automatically whenever a platform `PORT` or Appwrite config is present, and
`127.0.0.1` for a bare local run. Only set `HOST` explicitly if you need to
override that.

`GOC_TRUST_PROXY=1` tells the server to read the real visitor IP from
`X-Forwarded-For` for login/signup/console-unlock rate limiting, which is
required once you're behind a reverse proxy (nginx, Caddy, a load balancer) —
otherwise every visitor looks like the same address to the throttle. Leave
this unset for a bare local run with no reverse proxy in front of it, since
trusting that header without one would let a caller forge their own
rate-limit identity.

### Deploying on a self-managed VPS

1. Push this folder to a private GitHub repository (or copy it to the server directly).
2. On the server: `git clone` (or `git pull`) the repository, `npm install`.
3. Complete Step 1 above (persistent `GOC_DATA_DIR`) and fill in the environment
   variables from Step 2, either in the project's `.env` file or in your process
   manager's own environment config.
4. Run it under a process manager so it survives reboots and restarts on crash:
   - **PM2**: `pm2 start server/server.js --name goc-academy-hub`, then `pm2 save`
     and `pm2 startup` so it comes back after a server reboot.
   - **systemd**: a unit file with `ExecStart=node server/server.js`,
     `WorkingDirectory=` your app folder, and `Restart=on-failure`.
5. Put a reverse proxy (nginx, Caddy, etc.) in front of it for TLS/HTTPS, and set
   `GOC_TRUST_PROXY=1` once that's in place (see above).
6. Confirm `https://YOUR-DOMAIN/api/health` returns a healthy JSON response.

Redeploying new code (`git pull`, or however you update it) never touches
`GOC_DATA_DIR`, so `server/data.json` and everything in it survives every
redeploy and restart.

## Step 3 — Appwrite persistence & migration (questions, attempts & the settings blob)

This is the durable-storage path from `implementation-map.txt`. Do it once, in order,
and only after verifying on a **throwaway** Appwrite project first.

### 3.1 Provision the collections (one-off)

With the `APPWRITE_*` variables set in `.env` (endpoint, project id, and an API key with
`databases.write`), run:

```bash
node server/setup-appwrite.js
```

This creates two collections in the existing `goc_academy` database — `questions` and
`attempts` — with their attributes and the indexes that back the queries
(`subject`/`section`/`kind`/`active` on questions; `scholarId`, the compound
`scholarId+section+subject`, and `status` on attempts). It is idempotent: an
already-existing collection/attribute/index is skipped, so re-running it is safe. It
never deletes anything and never touches students/resources/videos/liveclasses/cohorts.

### 3.2 Migrate the live data (one-off)

The migration is triggered from the running app so it reads the real data that exists in
the live process. With the app deployed and the collections provisioned, sign in to the
console (Founder/Academic Director) and POST once:

```
POST /api/admin/migrate-appwrite     (console-authenticated)
```

It upserts every question and attempt from `server/data.json` into the collections and
pushes the remaining blob up to Appwrite Storage. It is **safe to run twice** (every
write is an upsert — no duplicates), it **never** writes to or truncates `data.json`, and
it refuses to report success unless the read-vs-written counts reconcile. A successful
response looks like `{ ok: true, questions: { read, written }, attempts: { read, written },
blobUploaded: true, errors: [] }`.

### 3.3 Cutover

Once the migration reports a clean run, the app is already reading questions/attempts from
Appwrite (the accessors dispatch to Appwrite whenever it is configured). From that point,
`data.json`'s `questions`/`attempts` arrays are frozen historical artifacts — still in the
file, never written again.

### 3.4 Rollback

Because the migration never touches `data.json`, rolling back is just redeploying the
previous commit: the older code reads questions/attempts from the local blob, which was
never modified. The one edge case is an attempt submitted **after** cutover but discovered
**later** — a plain rollback would stop the app from seeing it (it is in Appwrite, and the
rolled-back code doesn't look there). Cover that gap by (a) not cutting production over
until Step 5's verification is clean on a throwaway project, and (b) keeping a small
read-only export script ready to pull anything written to Appwrite during a rollback
window back out by hand. Creating the two collections is not destructive to anything
already working — if abandoned, they simply sit unused.

### 3.5 Verify on a throwaway project first (the gate)

Point `APPWRITE_*` at a **disposable** project, run `node server/setup-appwrite.js`, then
run the migration/persistence test:

```bash
node test/test-migrate-appwrite.js
```

It seeds a sandbox blob with a known question + marked attempt, boots in Appwrite mode,
runs the migration twice, and asserts every field survives the conversion and a repeat run
creates no duplicates. With no `APPWRITE_*` set it skips cleanly, so `node test/run.js`
stays green offline.

## Go-live checks

- [ ] Host uses HTTPS and the app listens on its supplied `PORT`.
- [ ] Sign-up, login (student + both admin titles), practice, mock exams, admin/console
      access, logout, and the legal page all tested on the live HTTPS URL.
- [ ] `https://YOUR-DOMAIN/api/health` responds successfully.
- [ ] Every demo password, console passcode, and signup code replaced with new values —
      none of the values used during development/testing carry into production.
- [ ] Demo account seeding confirmed off (`GOC_NO_DEMO_SEED=1` or `NODE_ENV=production`).
- [ ] `sw.js` cache version bumped to the final value for this release.
- [ ] Private backup of existing student data taken before any hosting change.
- [ ] Contact details and legal page content accurate for the academy.
- [x] `npm audit` run with real registry access and any known CVEs resolved — done
      2026-09-14, 0 vulnerabilities found (see `PHASE2-AUDIT-NOTES.md`). Re-run
      before go-live regardless, since a new CVE could surface after this date.
- [ ] `GOC_TRUST_PROXY=1` set once behind your reverse proxy, so login/
      signup/console-unlock rate limiting keys off the real visitor IP, not the
      proxy's own IP.
- [ ] Node version pinned on the host (`package.json`'s own `"node": ">=18"` range is
      unbounded and drifts on its own — pin an actual version in however you manage
      Node on the server, e.g. nvm or your process manager's config).
- [ ] `GOC_DATA_DIR` points at a directory outside the git checkout, on disk that
      survives a redeploy — confirmed by making a change, redeploying, and checking
      the change is still there (see Step 1).
- [ ] Confirm the boot-time default-secret check passed (server log shows no
      "SHIPPED DEFAULT SECRET(S) STILL ACTIVE" banner) — in production it will
      refuse to start at all until this is clean, so this should be automatic,
      but check the deploy log once anyway.
- [ ] `server/backups/` is accumulating rotating local copies of `data.json`
      (`GOC_BACKUP_INTERVAL_MIN` / `GOC_BACKUP_KEEP` — see above). If this is an
      Appwrite-Database install, confirm student data has its own backup plan
      too, since this rotation doesn't reach Appwrite.

## Accessibility & responsive QA (Phase 3)

Static-analysis pass only — this sandbox has no real browser. What it covers
and what it doesn't:

- Accessibility: alt text, ARIA, focus states, and form labels were audited
  and fixed; WCAG AA contrast was audited and fixed; `prefers-reduced-motion`
  is fully honored. One flag remains open: a `--gray` vs `--card` contrast
  pairing with no confirmed real occurrence in any actual rule — likely a
  non-issue, but worth a real-browser sanity check rather than more static
  analysis (see `CONTRAST-AUDIT-NOTES.md`).
- Responsive: found and fixed one real bug (the landing-page footer's
  3-column link grid had no small-screen breakpoint and would wrap badly at
  320–360px). Other multi-column grids were spot-checked and are lower risk
  (short numeric/icon content, not link-length text); the admin KPI grid was
  already confirmed clean on a real phone from an earlier screenshot in this
  project's history.
- PWA install: built from scratch this phase — a permanent "Install this
  app" row in Profile > Settings, a real captured `beforeinstallprompt` on
  Android, inline Share-sheet steps for iOS (Safari only, not an in-app
  browser), and a plain "Installed" state once it's added.

**Not done, by design:** a real device/browser pass. Every static-analysis
finding above should be re-checked on an actual phone before calling Phase 3
fully closed — that caveat has carried through every session's notes on this
item and still holds.

## Check your resources and videos once Appwrite is configured

After the credentials are in `.env` and the resource/video files are uploaded from the Console:

    node server/verify-media.js

It changes nothing. For every resource and video record it confirms the stored file exists in the bucket and is not empty, and tells you which files open inside the app (PDF, JPG/PNG/GIF, MP4) and which download (Word, Excel, zip). It exits 1 and lists each problem if anything is missing.

`node test/test-media-stub.js` (part of `npm test`) exercises the same routes against an in-memory stand-in for Appwrite, so it never touches your live project.
