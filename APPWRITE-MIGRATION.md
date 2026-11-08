# Appwrite Sites + Functions migration

**Status: PARTIALLY IMPLEMENTED — MANUAL CONFIGURATION REQUIRED.**

This branch adds an Appwrite Functions API gateway and a dual-target frontend
build **without changing the application's design, academic logic, or the OneBit
deployment**. It is a foundation, not a finished migration: 1 of 253 routes has a
handler so far. Read `APPWRITE-TEST-REPORT.md` for the honest coverage number.

## Architecture

```
                 GitHub repository
                        |
          ┌─────────────┴─────────────┐
          |                           |
        ONEBIT                     APPWRITE
   node server/server.js       Sites (static dist/)
   unchanged, still default          |
          |                    Functions: goc-api
          └─────────────┬─────────────┘
                        |
              EXISTING Appwrite project
                 Auth · Database · Storage
```

Both targets are independently deployable and share the **existing** project.
No second project, database or bucket is created.

## What is implemented

| Component | State |
| --- | --- |
| Central frontend API base (`GOC.apiBase`) | Implemented, tested |
| Dual-target build (OneBit relative / Appwrite absolute) | Implemented, tested |
| Route inventory extracted from the server (253 routes) | Implemented, tested |
| API gateway: routing, 404/405 parity, explicit 501 gaps | Implemented, tested |
| Authorization guards ported from the server | Implemented, tested |
| Durable session store (Appwrite-backed) | Implemented, tested; **schema not applied** |
| scrypt credential compatibility shim | Implemented, tested |
| CORS allow-list, body cap, error sanitisation | Implemented, tested |
| `GET /api/health` handler | Implemented; **needs a state reader** |
| Remaining 252 route handlers | **Not started** |
| Scheduled Functions (reminders/backups/maintenance/broadcasts) | **Not started** |
| Persistence adapters (Storage/Database) | **Not started** |
| Live schema inspection / deployment | **Blocked — no Appwrite access** |

## Corrected inventory

The pre-migration audit reported 240 routes. That was **wrong**: its parser
missed multi-line entries and entries with RegExp flags. The verified total is:

- **253 routes**, 38 families, 9 auth tiers, 33 capabilities
- GET 113 · POST 77 · PUT 41 · DELETE 22

Reproduce it with `node functions/goc-api/tools/extract-routes.js`. A line-based
`grep -c "{ method: '"` returns 250 because three entries span lines.

Each route keeps its **original RegExp source and flags**. Translating to
Express-style patterns would be lossy: some groups are capture params
(`([A-Za-z0-9._-]+)`) while others are action alternations (`(reply|close)`), and
existing handlers read them positionally.

## Change manifest

Every changed file, its justification and its compatibility impact.

### Modified (5 files, +35 / −6)

| File | Change | Migration requirement | Compatibility impact | Tests |
| --- | --- | --- | --- | --- |
| `js/api.js` | Add `GOC.apiBase`; `var base = GOC.apiBase`; health probe uses it | Single API configuration point for two hosts | None for OneBit: unset injection keeps `'api'` | `test-migration-api-config.js`, full suite |
| `js/free2027-api.js` | One line: request URL reads `GOC.apiBase` | Free Tutorial must reach the Function too | Falls back to `'api'` if the global is absent | same |
| `js/free2027-ui.js` | One line: health probe reads `GOC.apiBase` | Mode detection must work on Sites | Same fallback | same |
| `build/build.js` | Read `GOC_API_BASE`, validate it, pass esbuild `define` | Build the same source for either host | Unset ⇒ identical behaviour; invalid ⇒ build refused | same |
| `test/run.js` | Register 3 new suites | New tests must actually run | Additive only; no suite removed or weakened | full suite |

### Created

| File | Purpose |
| --- | --- |
| `functions/goc-api/package.json` | Function manifest; reuses `node-appwrite` |
| `functions/goc-api/src/index.js` | Entry point + Appwrite adapter |
| `functions/goc-api/src/config.js` | Env config, names only in logs |
| `functions/goc-api/src/router.js` | Dispatch, coverage, explicit 501 |
| `functions/goc-api/src/lib/passwords.js` | Existing scrypt format compatibility |
| `functions/goc-api/src/lib/tokens.js` | Token generation + at-rest hashing |
| `functions/goc-api/src/middleware/errors.js` | One error mapper; no internal leakage |
| `functions/goc-api/src/middleware/authorization.js` | Server guards ported verbatim |
| `functions/goc-api/src/services/appwrite.js` | Lazy privileged client |
| `functions/goc-api/src/services/sessions.js` | Durable sessions; fails closed |
| `functions/goc-api/src/routes/health.js` | `GET /api/health` |
| `functions/goc-api/route-inventory.json` | Generated 253-route inventory |
| `functions/goc-api/coverage.json` | Generated, router-derived coverage |
| `functions/goc-api/schema/sessions.json` | **Proposed** schema, not applied |
| `functions/goc-api/tools/extract-routes.js` | Reproducible inventory |
| `functions/goc-api/tools/coverage-report.js` | Honest coverage from the router |
| `functions/goc-api/tools/preflight.js` | Refuses unsafe/placeholder deploys |
| `appwrite.json` | Function config; **projectId is a placeholder** |
| `.env.example` | Placeholders only |
| `test/test-migration-*.js` | 3 suites, 146 assertions |
| `APPWRITE-*.md` | This documentation set |

### Deliberately untouched

`index.html`, all CSS, all branding/icons, `js/goc-core.js`, `js/goc-free-2027.js`,
`js/app.js`, `js/free2027-admin.js`, `js/pwa.js`, `sw.js`,
`manifest.webmanifest`, **`server/server.js` and everything under `server/`**,
`build/deploy.js`, `ecosystem.config.cjs`, `package.json`, `package-lock.json`,
all 210 pre-existing test suites, and all historical documentation.

`sw.js` needed no change: it only pre-caches a static asset list and never writes
API responses to a cache, so authenticated responses stay uncached on Sites.

## Identity boundaries preserved

Four identity systems remain separate, and the gateway refuses cross-tier tokens:

| System | Credential | Tier it can satisfy |
| --- | --- | --- |
| `appwrite-auth` | Appwrite Auth (original students) | `student` |
| `local-staff` | scrypt in the JSON blob | `staff`, `console`, `founder` |
| `local-tutor` | scrypt in the JSON blob | `tutor`, `tutor-setup` |
| `free2027` | scrypt, own participant records | `free` |

Existing scrypt hashes are **not** transferable to Appwrite Auth and are **not**
converted. The Function verifies them with the identical KDF, so no password
reset is required.

## Next implementation order

1. Apply `schema/sessions.json` after verifying no `sessions` collection exists.
2. Implement the state reader (Appwrite Storage blob) so `health` and the
   Free Tutorial mode switch work against real data.
3. Port `auth` (7 routes) against the durable session store.
4. Port remaining families, re-running `coverage-report.js` each time.
5. Add the scheduled Functions with `GOC_JOB_OWNER` ownership.

See `APPWRITE-FUNCTIONS-DEPLOYMENT.md`, `APPWRITE-SITES-DEPLOYMENT.md`,
`APPWRITE-ENVIRONMENT.md`, `APPWRITE-ROLLBACK.md`, `APPWRITE-TEST-REPORT.md`.
