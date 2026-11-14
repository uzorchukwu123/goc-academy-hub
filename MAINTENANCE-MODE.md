# Temporary maintenance mode (Workstream A)

G.O.C Academy Hub can be taken off the public internet **temporarily** while the
improvements are built, without deleting, editing or migrating anything. The
whole application stays in the repository and on the data volume underneath a
single switch. This is a presentation layer, not a second application.

- **Switch:** `GOC_MAINTENANCE_MODE`
- **Truthy:** `1`, `true`, `on`, `yes` (case-insensitive)
- **Off:** unset, empty, `0`, or any other value
- **Owner of the gate:** `server/lib/maintenance.js` (Node server), plus the
  same variable in `functions/goc-api` and in `build/build.js` for the two
  Appwrite deployment targets.

## What visitors get

Every user-facing page is replaced by one announcement (HTTP **503**, with
`Retry-After: 3600` and `X-Robots-Tag: noindex, nofollow`):

> **G.O.C Academy Hub is Under Several Improvements**
>
> We are working behind the scenes to improve G.O.C Academy Hub and make your
> learning experience even better.
>
> Several improvements are currently underway. We are preparing an enhanced
> platform and look forward to welcoming you back when everything is ready.
>
> Thank you for your patience and understanding.
>
> **Please check back later.**

The page is self-contained (inline CSS and SVG, no scripts, no network assets),
carries the G.O.C red/cream identity, works on phone and desktop, and has no
login, registration, navigation or reopening date.

## What stays open (deliberately)

| Path | Answer | Why |
| --- | --- | --- |
| `GET/HEAD /api/health` | `200 {"service":"goc-academy-hub","version":1,"maintenance":true}` | Hosting health checks must still pass. It reveals no passcode length, programme state or version detail. |
| `GET/HEAD /robots.txt` | `Disallow: /` | Keep crawlers out of the maintenance notice. |
| `GET/HEAD /sw.js` | A self-destroying service worker | Clears the app's offline cache and unregisters itself so a cached copy of the app cannot be navigated into while the platform is down. |

Everything else — homepage, sign-up, login, dashboards, Management Console,
Founder/staff screens, `/tutor`, password-setup links (`/setup/<token>`), Free
UTME 2027, JAMB practice, Web Tests, formal CBT, resources, videos, recorded
and live classes, every other `/api/` route, bookmarks and deep links typed by
hand — answers `503` (the page, or `{"error":…,"maintenance":true}` for `/api/`).

The gate runs **before** any session lookup, so an existing signed-in session,
an old token or a replayed request cannot bypass it. There is no bypass secret,
no hidden URL and nothing in the page that identifies the deployment.

Study-reminder emails are paused while the switch is on (a link to a platform
that is down would be misleading). Backups continue as normal.

## Enable it

Pick the row that matches where the platform is hosted.

### 1. Node server (OneBit / Render / Railway / a VPS / PM2)

Set the variable in the host's environment panel (or in `.env`):

```
GOC_MAINTENANCE_MODE=1
```

Then **restart** the server process (`pm2 restart goc-academy-hub`, or stop and
run `npm start` again). No rebuild and no redeploy of code is required: the
switch is read once at boot from `process.env` after `.env` is loaded.

The boot log states it plainly:

```
⚠  MAINTENANCE MODE IS ON (GOC_MAINTENANCE_MODE). The application is NOT reachable…
```

With PM2, add it to `ecosystem.config.cjs` → `env` **or** export it in the
process environment; `ecosystem.config.cjs` overrides the shell for keys it
declares, so change the key it already owns if you use that file.

### 2. Appwrite Sites (static front end: `dist/`)

There is no Node process to gate requests, so the switch is applied at build
time and restored at build time:

```bash
GOC_MAINTENANCE_MODE=1 npm run build      # emits dist/index.html + dist/sw.js only
```

Deploy `dist/` to the Site as usual. The maintenance build copies **no**
application JS, CSS, icons or manifest — only the announcement page and the
cache-clearing `sw.js`. The source tree is untouched.

### 3. Appwrite Function (`goc-api`, the API tier)

Set `GOC_MAINTENANCE_MODE=1` in the Function's variables and save. Every route
except `GET /api/health` answers `503`, so even a stale Site shell cannot read
student data or perform an action. Set it at the same time as the Site build so
the two never disagree.

> If both a Node deployment and an Appwrite deployment are live, enable the
> switch in **every** place that serves traffic. The gate is per tier.

## Keep the application intact

Maintenance mode does not:

- delete or rename pages, routes, APIs or collections;
- touch `server/data.json`, Appwrite collections, student records or backups;
- disable Appwrite, authentication, Free UTME 2027 or the question banks;
- change the service-worker cache name or version.

It only answers requests earlier than usual.

## Disable it — the exact restoration procedure

1. **Node server:** remove the variable (or set `GOC_MAINTENANCE_MODE=0`) in the
   host's environment / `.env`, then restart the process. No rebuild, no
   re-import, no data step.
2. **Appwrite Sites:** rebuild and redeploy without the variable:

   ```bash
   npm run build            # (GOC_API_BASE=… as usual for Sites)
   ```

   Deploy the new `dist/` (which now contains the full app again).
3. **Appwrite Function:** remove `GOC_MAINTENANCE_MODE` (or set `0`) and save.
4. The service worker served during maintenance has already cleared caches and
   unregistered itself. Visitors may need one normal refresh; after that the app
   installs the normal `sw.js` again and creates the current `goc-vNNN` cache.
5. Confirm the normal homepage, then a real student login, then the routes in
   the checklist below.

Nothing needs reverting in Git, and no redirect or per-route condition exists
that could be left behind: the only branch is the single one in the request
dispatcher.

## Verify restoration

```bash
# 1. Normal homepage (should be 200 HTML containing "Raising Smart Scholars")
curl -s -o /dev/null -w '%{http_code}\n' https://YOUR-HOST/
curl -s https://YOUR-HOST/ | grep -c 'Raising Smart Scholars'

# 2. Health reports normal operation (no "maintenance":true)
curl -s https://YOUR-HOST/api/health

# 3. The real service worker is back (contains the goc-vNNN cache name)
curl -s https://YOUR-HOST/sw.js | grep -c "goc-v"

# 4. Student/staff sign-in answers 401 (not 503) to a wrong password,
#    which proves the auth route is open again:
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://YOUR-HOST/api/auth/login \
  -H 'Content-Type: application/json' -d '{"id":"GOC-S-000000","password":"wrong"}'
```

Then, in a browser: open the homepage → sign in with a real Scholar ID → open
the dashboard and one study screen → open `/tutor` → (if used) enter the Free
UTME 2027 portal. On Appwrite, repeat step 2–4 against the Function origin and
open the Site in a private window.

**Expected when maintenance is ON:** all four commands answer either the 503
announcement / `maintenance: true`, except `/api/health`, which is a minimal 200.

## Automated proof

`node test/test-maintenance-mode.js` (part of `npm test`) starts a real server
twice against a throwaway data folder and proves:

- with the switch on: the homepage, every deep link, static assets, the tutor
  shell, setup links and the whole API answer 503; health is minimal; the
  service worker clears caches; requests from a different `Host` header and with
  an existing bearer token are refused exactly the same way; the data file is
  untouched;
- with the switch off: the real homepage, real health payload and real service
  worker return, a bad login is 401 (not 503), and the same data survives;
- the Function gate refuses routes and keeps health minimal;
- a maintenance build emits only `index.html` + `sw.js`, and a normal build
  emits the full app again.

## Rollback

Set the variable to `0`/unset and restart (Node/Function), or rebuild without
it (Sites). That is the whole rollback. If a bad maintenance release must be
fully withdrawn, redeploy the previous `dist/` — the data volume and Appwrite
project were never modified.
