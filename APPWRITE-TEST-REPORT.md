# Appwrite migration — test report

All numbers below were produced by commands actually executed on branch
`arena/0d3c141f-goc-academy-hub`, base `d02d7afa8290983b72fd4450eff4485aef112004`
(`origin/main`, service worker `goc-v206`). Nothing here is estimated.

## Verdict

**PARTIALLY IMPLEMENTED — MANUAL CONFIGURATION REQUIRED**

The foundation is real and tested. The API surface is not: **1 of 253 routes**
has a handler. Do not treat this as a deployable migration.

## 1. Baseline before any change

| Command | Exit | Result |
| --- | --- | --- |
| `npm ci --no-audit --no-fund` | 0 | 11 packages |
| `npm test` | 0 | **210 suites, 0 failed** |
| `npm run build` | 0 | 1828002 → 1116171 bytes (39% smaller) |
| `npm run deploy` | 0 | 34 files, 4225046 bytes, audit passed |

## 2. After the change — OneBit regression

| Command | Exit | Result |
| --- | --- | --- |
| `npm test` | **0** | **213 suites, 0 failed** (210 pre-existing + 3 new) |
| `npm run build` | **0** | 1828769 → 1116330 bytes |
| `npm run deploy` | **0** | 34 files, 4225205 bytes, **Audit passed** |
| `npm start` (isolated temp data dir) | **0** | `GET /api/health` → **200** |
| `GET /` app shell | — | **200** |

`npm start` evidence: `service: goc-academy-hub`, `free2027` present,
`storageFile` inside the isolated temp directory, and the `GOC_APPWRITE_OFF`
banner printed as before. The Node server never imported a Functions-only file.

**No pre-existing test was deleted, skipped or weakened.** `test/run.js` only
gained three entries.

## 3. New suites

| Suite | Assertions | Failed |
| --- | --- | --- |
| `test/test-migration-api-config.js` | 38 | 0 |
| `test/test-migration-gateway.js` | 60 | 0 |
| `test/test-migration-sessions.js` | 48 | 0 |
| **Total** | **146** | **0** |

All three are offline: no Appwrite credentials, no network, no live project.
They run inside `npm test`.

### What is actually covered

- **API config:** single `GOC.apiBase` definition; feature modules read it; script
  order guarantees it is defined first; unset `GOC_API_BASE` keeps the relative
  `'api'` base; a valid absolute base is injected; an invalid base **exits 1**;
  `dist`/`deploy` contain no `server/` or `functions/`; no privileged variable
  name appears in built output.
- **Gateway:** all 253 inventory routes parse as valid RegExps with zero
  duplicates; family and tier counts match the extractor; 404 and 405 strings
  match the server exactly; unported routes return **501**; authorisation runs
  **before** the 501 so anonymous callers cannot enumerate protected gaps; CORS
  rejects unapproved origins with 403; oversize bodies return 413; errors do not
  leak internals.
- **Sessions:** the scrypt shim verifies hashes produced by an independent
  reimplementation of the on-disk format and rejects empty, null, bcrypt,
  truncated, non-hex and empty-salt inputs; tokens are stored hashed; document
  ids stay within Appwrite's 36-character limit while the full digest is still
  compared; expiry and revocation are enforced on every read; `revokeAccount`
  clears only the matching identity system; the four identity systems cannot
  satisfy each other's tiers; a missing collection raises a configuration error
  instead of falling back to memory.

## 4. Build matrix

| Build | Exit | Expected | Observed |
| --- | --- | --- | --- |
| `GOC_API_BASE` unset | 0 | relative `api` preserved | pass |
| `GOC_API_BASE=https://example-fn.appwrite.global/api` | 0 | URL injected | pass |
| `GOC_API_BASE=not-a-url` | **1** | build refused | pass |

## 5. Tooling

| Tool | Result |
| --- | --- |
| `tools/extract-routes.js` | 253 routes, 9 tiers, 33 capabilities, 38 families, 0 duplicates |
| `tools/coverage-report.js` | **1/253 implemented (0.4%)** — derived from the live router |
| `tools/preflight.js` | **exit 1 — REFUSED**, placeholder `projectId`. Nothing deployed |

Independent cross-check: a separate Python scanner also counted 253, while
`grep -c "{ method: '"` returned 250 — it misses three multi-line entries
(`server/server.js` lines 4575, 5244, 5256). The 240 figure from the earlier audit
was an undercount.

## 6. Route coverage detail

Implemented: **`GET /api/health`** only — and it still requires a state reader, so
in the real entry point it raises a configuration error rather than returning a
fabricated payload.

Not started (252 routes across 38 families), including every one of:
`api/admin` (22), `api/auth` (7), `api/rounds`, `api/questions`, `api/results`,
`api/students`, `api/tutor`, `api/broadcasts` (4), `api/free2027` (12),
`api/settings`, `api/approvals`, `api/audit`, `api/analytics`, `api/challenges`,
`api/affirmations`, `api/alerts`, `api/classes`, `api/contact` and the rest.
Exact per-family counts are in `functions/goc-api/coverage.json`.

## 7. Not executed — and why

| Check | Status | Reason |
| --- | --- | --- |
| Live Appwrite schema / bucket / Auth inspection | **NOT RUN** | Appwrite connector returned `unsupported`; no credentials available |
| Apply `sessions` schema | **NOT RUN** | Deliberately a proposal; existence must be verified first |
| Function deploy (`appwrite push`) | **NOT RUN** | Placeholder project id; preflight refuses |
| Sites deploy | **NOT RUN** | No generated domain yet |
| Function runtime `node-22` availability | **NOT VERIFIED** | Requires the live instance's runtime list |
| End-to-end browser login on Sites | **NOT RUN** | Needs a deployed Function |
| Scheduled Functions / delivery ledger | **NOT BUILT** | Stage 8 not started |
| SMS delivery | **STUB** | No working SMS provider; none invented |
| Production behavioural baseline | **UNRELIABLE** | `gocacademy.live` serves `goc-v183` and returns `No such endpoint.` for `/api/free2027/config`, i.e. older than both commits |

## 8. Security checks performed

- No `.env`, `server/data.json`, key file or backup staged (verified via
  `git status`).
- No secret-shaped literal in `.env.example`, `appwrite.json`, Function source,
  `build/build.js` or `js/api.js` (pattern scan returned nothing).
- `sessions` schema declares `[]` for every permission; preflight fails if any
  session permission is made public.
- Privileged client is constructed lazily and only inside `functions/`.
- CORS is an exact allow-list with no wildcard.
- Session tokens are hashed at rest; raw tokens never persisted or logged.

## 9. Minimal-diff audit

Modified tracked files: `build/build.js`, `js/api.js`, `js/free2027-api.js`,
`js/free2027-ui.js`, `test/run.js` — **+35 / −6 lines total**.

Zero changes to HTML, CSS, branding, layout, academic/marking/XP/leaderboard
logic, question content, `server/`, `sw.js`, `package.json`, or any existing
documentation. Every addition is justified in the change manifest in
`APPWRITE-MIGRATION.md`.
