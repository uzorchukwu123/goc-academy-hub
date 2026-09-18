# Deployment — G.O.C Academy Hub

This is the single canonical deployment reference for this project. It supersedes
`DEPLOY-RENDER-RAILWAY.md`, `HOSTING-WHEN-READY.md`, and `HOSTING-STEP-2-Local-Test.md`,
which have been retired.

The app is ready for an always-on host such as Railway or Render. Use Appwrite Storage
for the production data file — do not deploy with the local `server/data.json` as the
production database.

See [`PHASE2-AUDIT-NOTES.md`](./PHASE2-AUDIT-NOTES.md) for the backend security audit
(route inventory, XSS review, dependency-audit caveat) referenced in the go-live
checklist below.

## Before deployment

1. Keep the GitHub repository **private**. Confirm `server/data.json` and `.env` are not tracked.
2. Create an Appwrite Storage bucket:
   - Bucket name: `GOC Academy Data`
   - Bucket ID: `goc-data`
   - File security: enabled
3. Create a server API key with Storage read and write permission. Keep it private, and
   rotate it if it's ever been exposed (committed, shared in a file, pasted anywhere public).
4. Keep the API key, project ID, and all academy passwords in the host's environment
   variables — never in a committed file.

## Step 1 — Test Appwrite Storage locally

Before deploying, confirm the app can load and save its data through Appwrite.

In PowerShell, from the project folder:

```powershell
$env:APPWRITE_ENDPOINT = "https://cloud.appwrite.io/v1"
$env:APPWRITE_PROJECT_ID = "YOUR_PROJECT_ID"
$env:APPWRITE_API_KEY = "YOUR_SERVER_API_SECRET"
$env:APPWRITE_BUCKET_ID = "goc-data"
$env:APPWRITE_FILE_ID = "academy-data-json"
node server\server.js
```

The first start creates the seeded `academy-data-json` file. Later starts load that file.
Look for `Storage: Appwrite Storage (cloud)` in the startup log.

Then open `http://localhost:8080`, sign in, and confirm that a new or changed record
remains after restarting the server.

If the app reports a `404`, confirm the bucket ID, API key permissions, project ID, and
endpoint. If it reports a permission error, update the API key's Storage read/write
scopes and the bucket's file security.

## Step 2 — Deploy

### Required environment variables

```text
NODE_ENV=production
APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
APPWRITE_PROJECT_ID=<your-project-id>
APPWRITE_API_KEY=<your-server-api-secret>
APPWRITE_BUCKET_ID=goc-data
APPWRITE_FILE_ID=academy-data-json
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
required once you're behind Render's or Railway's edge proxy — otherwise
every visitor looks like the same address to the throttle. Leave this unset
for a bare local run with no reverse proxy in front of it, since trusting
that header without one would let a caller forge their own rate-limit
identity.

### Railway (recommended path)

1. Push this folder to a private GitHub repository.
2. In Railway, create a new project and choose **Deploy from GitHub repo**.
3. Select the repository. Railway will use `railway.json` and run `node server/server.js`.
4. Add the environment variables above as service variables.
5. **Pin the Node version.** `package.json`'s `"node": ">=18"` is an
   unbounded range, which resolves to whatever Node release is newest at
   deploy time and drifts silently — it isn't really "pinned" despite
   looking like one. Railway's `railway.json` schema has no inline slot for
   this the way Render's Blueprint spec does, so set it as a Railway
   dashboard service variable instead: `NIXPACKS_NODE_VERSION=20`.
6. Generate a Railway public domain and open the HTTPS URL.
7. Confirm `https://YOUR-DOMAIN/api/health` returns a healthy JSON response.

Railway terminates TLS at its own edge and proxies to this process over
plain HTTP, the same as Render (see below) — this is why `GOC_TRUST_PROXY=1`
above matters, and why nothing further needs configuring for HTTPS itself.

### Render

1. Push this folder to a private GitHub repository.
2. In Render, choose **New > Blueprint** and select the repository.
3. Render will read `render.yaml`. The blueprint uses the always-on Starter plan;
   change the plan only if you understand the sleep and data implications.
   `render.yaml` already pins `NODE_VERSION=20` and sets `GOC_TRUST_PROXY=true`
   — nothing further to add for either.
4. Fill every environment variable marked `sync: false` in the Render dashboard, using
   new production secrets.
5. Deploy and confirm `https://YOUR-DOMAIN/api/health` returns a healthy JSON response.

Render also terminates TLS at its own edge and proxies to this process over
plain HTTP — the app itself never handles a TLS certificate on either
platform. That's why `GOC_TRUST_PROXY` (above) exists: without it, the
rate limiter would see every visitor as Render's/Railway's own proxy
address instead of the real client IP.

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
- [ ] `GOC_TRUST_PROXY=1` set once behind Render's/Railway's edge proxy, so login/
      signup/console-unlock rate limiting keys off the real visitor IP, not the
      platform's proxy IP.
- [ ] Node version pinned on whichever host is used (`render.yaml`'s
      `NODE_VERSION`, or Railway's `NIXPACKS_NODE_VERSION` dashboard variable) —
      `package.json`'s own `>=18` range is unbounded and drifts on its own.
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
