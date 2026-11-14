# Workstream A — Temporary full-platform maintenance mode

**Status:** implemented on branch `arena/be3c2044-goc-academy-hub`, tests green,
not deployed. No production deployment was performed or authorised.

**Companion documents:** `MAINTENANCE-MODE.md` (enable / disable / restore,
exact procedure) · `IMPROVEMENTS-INSPECTION.md` (Workstream B, inspection only).

---

## 1. What was built

One switch, one gate, one page, one restoration procedure.

| Piece | File | What it does |
| --- | --- | --- |
| The switch and the page | **`server/lib/maintenance.js`** (new) | Reads `GOC_MAINTENANCE_MODE`; owns the announcement HTML, the API refusal, the health/robots answers and the cache-clearing service worker. |
| The request gate | **`server/server.js`** | Requires the module, computes `MAINTENANCE_MODE` once at boot, and calls `maintenance.intercept()` inside `http.createServer` after the security headers and **before** the tutor shell, the setup link, static files, session lookup and every route. |
| Boot visibility | `server/server.js` | Prints a clear `MAINTENANCE MODE IS ON …` banner (and how to restore) at startup. |
| Email pause | `server/server.js` | Study-reminder sweeps do not start while maintenance is on, so no email points students at a platform that is down. Backups still run. |
| Static hosting | **`build/build.js`** | With the variable set, emits **only** `dist/index.html` + `dist/sw.js` (the announcement and the cache-clearing worker). No app JS, CSS, icons or manifest are copied. Unsetting it and rebuilding restores the full app. |
| Appwrite API tier | **`functions/goc-api/src/config.js`**, **`functions/goc-api/src/index.js`** | Same variable closes every Function route except a minimal `GET /api/health`, before the body is parsed or a session is resolved. |
| Configuration | `.env.example`, `APPWRITE-ENVIRONMENT.md` | Documented as `GOC_MAINTENANCE_MODE`, with the per-target instructions. |
| Operator procedure | **`MAINTENANCE-MODE.md`** (new) | Enable, disable, verify, rollback, and what stays available — exact commands. |
| Proof | **`test/test-maintenance-mode.js`** (new), wired into `test/run.js` | 80 checks over real HTTP, the Function handler and both build paths. |

Nothing else in the application was edited. There are no scattered
`if (maintenance)` checks, no redirects, no deleted files, no schema or data
migration, and no change to authentication, Appwrite, Free UTME 2027, the
question banks, the service-worker cache name or any student record.

## 2. The experience

The announcement uses the exact requested headline, supporting message and
closing line. It is a self-contained page (inline CSS + inline SVG, no scripts,
no remote fonts/images), branded in the existing G.O.C red/cream/ink palette,
responsive from 320 px phones to desktop, keyboard/screen-reader sane, and
prints sensibly. It has no navigation, no login/registration button, no
reopening date, no application data and no hint of a bypass.

Served as **HTTP 503** with `Retry-After: 3600`, `Cache-Control: no-store` and
`X-Robots-Tag: noindex, nofollow` — the correct signal for a temporary outage.

## 3. Coverage and bypass resistance

Every entry point in the brief is gated by the same branch, including:

- `/`, `/index.html`, bookmarks and refreshes;
- student registration, login, dashboards, profile, practice, Web Test, CBT,
  resources, videos, classes and every hash/path the client can navigate to;
- the Management Console, Founder and staff screens, `/tutor`;
- the Free UTME 2027 interface and its API;
- password-setup links (`/setup/<token>`);
- static assets (`/js/app.js`, `/css/styles.css`, icons, manifest);
- every `/api/` route, any unknown deep link, any non-GET/HEAD request;
- a different `Host` header, a stale `Authorization: Bearer …` token, or a
  replayed request — the gate runs before sessions, so none of them helps;
- the browser cache: during maintenance `/sw.js` is a self-destroying worker
  that deletes every cache and unregisters itself, so a previously cached app
  shell cannot be navigated back into.

Deliberately still available (infrastructure only):

| Path | Answer |
| --- | --- |
| `GET/HEAD /api/health` | `200 {"service":"goc-academy-hub","version":1,"maintenance":true}` — no passcode length, programme state or roster. |
| `GET/HEAD /robots.txt` | `Disallow: /` |
| `GET/HEAD /sw.js` | The cache-clearing/self-unregistering worker. |

## 4. Evidence

`node test/test-maintenance-mode.js` — **80/80 checks pass**. It boots the real
server twice against the same throwaway data folder (maintenance on, then off)
and proves:

- the announcement on `/`, 14 deep links, assets, `/tutor`, a setup link, a
  POST, a foreign `Host` header and `HEAD`;
- login/`/api/me`/Free 2027/console/student routes all 503; no cookie or token
  is issued;
- health is minimal and reveals no internals; robots disallows all; the worker
  clears caches;
- the data file and roster are unchanged while maintenance is on;
- with the switch off: the real homepage, real health payload, real service
  worker and tutor shell return; a bad login is **401, not 503**; the same
  records are still there;
- the Appwrite Function gate refuses routes and keeps health minimal, while
  CORS preflight and the origin allow-list still behave;
- a maintenance build emits only `index.html` + `sw.js`, and a normal build
  restores the full app.

Full regression on the reconciled baseline: **229/229 suites pass** (main's 228
suites plus the new maintenance suite), exit 0. `node build/build.js` still
builds the full app normally.

## 5. Acceptance criteria (Part 10, maintenance)

| # | Criterion | Evidence |
| --- | --- | --- |
| 1 | Public site replaced by the maintenance page | Gate on every page path; test asserts the exact page |
| 2 | Direct routes cannot bypass | 14 deep links + assets + tutor/setup links, all 503 |
| 3 | Ordinary student/staff access unavailable | Login, `/api/me`, console, bearer-token test |
| 4 | Works on mobile and desktop | Responsive CSS, `clamp()` type, 560 px breakpoint, viewport meta |
| 5 | Data and functionality intact underneath | File hash + roster unchanged; full app returns when off |
| 6 | Can be disabled centrally | One variable; one gate; one page owner |
| 7 | Original app restorable without a rewrite | Unset + restart (Node) or rebuild (Sites); full regression green |
| 8 | Restoration documented | `MAINTENANCE-MODE.md` |
| 9 | Automated tests for both modes | `test/test-maintenance-mode.js` (80 checks) |

## 6. Deployment posture

- **Node-hosted** (OneBit / Render / Railway / VPS / PM2): set
  `GOC_MAINTENANCE_MODE=1` and restart. No rebuild, no redeploy of code.
- **Appwrite Sites** (static): `GOC_MAINTENANCE_MODE=1 npm run build`, deploy
  `dist/`. Rebuild without it to restore.
- **Appwrite Function** (`goc-api`): set the same variable on the Function.
- Enable it on **every** tier that serves traffic. This branch has not been
  deployed anywhere.

## 7. Baseline note (reconciled)

The branch originally sat on `90a1e85` (Stage B — application-first
registration), an **unrelated history** to `origin/main` `17cc20f` (PR #15, the
Open/GOC tier system). The two trees also described incompatible products:
Stage B removed the tier model and required an application code; main has open
sign-up with Open/GOC tiers and 23 tier suites.

The branch has now been reconciled onto **`origin/main`** (see
`RECONCILIATION.md`):

- `origin/main` is a parent of this branch, so a normal pull request now shows
  only the maintenance work and the two reports — no mass deletion.
- The working tree is main's application (tier system, “Two ways in”, 228
  suites) plus the maintenance module/gate/build/Function/docs/test and the
  reports.
- Stage B is preserved in history at `90a1e85` but is **not** part of the
  reconciled baseline. Its product direction (one student identity, no tiers)
  contradicts main and could not be combined without deliberately reverting the
  tier system — an owner decision, not a merge.
- Maintenance is still one switch and one gate; porting it required only
  re-inserting the same calls into main's dispatcher and build.

No PR was opened and nothing was deployed.
