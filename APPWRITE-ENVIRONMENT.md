# Environment configuration by target

Three targets, three scopes. **Never put a privileged value in the Sites build.**
`.env.example` contains placeholders only; no real credential is committed.

## 1. OneBit (Node.js server) — unchanged

Set in the OneBit dashboard as **runtime** variables. Existing names and existing
behaviour are preserved; nothing here was renamed by the migration.

| Variable | Notes |
| --- | --- |
| `NODE_ENV=production` | |
| `GOC_DATA_DIR` | Absolute path on a persistent volume, outside the checkout |
| `GOC_TRUST_PROXY=1` | Behind the host proxy |
| `GOC_NO_DEMO_SEED=1` | Production classification. **Does not gate `seed()`** — the real `data.json` must already exist on the volume |
| `GOC_FREE_2027=1` | Enables the Free Tutorial edition |
| `GOC_FOUNDER_PW`, `GOC_ACADDIR_PW`, `GOC_PASSCODE` | Non-default values, or production refuses to boot |
| `APPWRITE_ENDPOINT`, `APPWRITE_PROJECT_ID`, `APPWRITE_API_KEY` | Existing project |
| `GOC_SMTP_*`, `GOC_FREE_2027_OTP_SECRET` | Existing email/OTP; secret ≥ 32 chars |
| `GOC_APPWRITE_OFF` | Leave **unset** for normal operation |
| `GOC_MAINTENANCE_MODE` | Leave **unset** (or `0`) for normal operation. `1` serves only the maintenance page. See **MAINTENANCE-MODE.md** |
| `GOC_API_BASE` | Leave **unset** so the build keeps the relative `api` base |
| `GOC_JOB_OWNER=onebit` | Default. OneBit owns the scheduled jobs |

If OneBit starts via `ecosystem.config.cjs`, note that its `env` block hardcodes
`GOC_DATA_DIR=/home/ubuntu/goc-data`, which overrides a dashboard value for that
key. Use `npm start` if the dashboard must control the data directory.

## 2. Appwrite Sites (static frontend build) — PUBLIC

Only one variable, and it is public by design because it is baked into shipped
JavaScript.

| Variable | Example | Rule |
| --- | --- | --- |
| `GOC_API_BASE` | `https://<function>.appwrite.global/api` | Absolute http(s), ends in `/api`, no trailing slash |

```bash
GOC_API_BASE=https://<function>.appwrite.global/api npm run build
# output: dist/
```

A malformed value **fails the build** rather than shipping a broken base.
Never set `APPWRITE_API_KEY`, `GOC_SMTP_PASS`, `GOC_FOUNDER_PW`,
`GOC_ACADDIR_PW` or `GOC_FREE_2027_OTP_SECRET` in the Sites build environment.
`test-migration-api-config.js` asserts none of these appear in the output.

## 3. Appwrite Functions (`goc-api`) — PRIVILEGED

Set as Function variables in the Appwrite Console. These reuse the OneBit names
so the same values can be copied across.

| Variable | Default | Purpose |
| --- | --- | --- |
| `APPWRITE_ENDPOINT` | — | Required |
| `APPWRITE_PROJECT_ID` | — | Required; **existing** project |
| `APPWRITE_API_KEY` | — | Required; server key, never shipped to a browser |
| `GOC_DATABASE_ID` | `goc_academy` | Existing database |
| `GOC_BUCKET_ID` | `goc-data` | Existing bucket |
| `GOC_BACKUP_FILE_ID` | `academy-data-json` | Existing JSON backup file |
| `GOC_SESSIONS_COLLECTION` | `sessions` | Durable sessions; apply the schema first |
| `GOC_ALLOWED_ORIGINS` | empty | Comma-separated exact Site origins. No wildcard |
| `GOC_MAX_BODY_BYTES` | `1048576` | Request body cap |
| `GOC_STAFF_SESSION_MINUTES` | `480` | Matches the server's 8-hour staff session |
| `GOC_STUDENT_SESSION_MINUTES` | `90` | Server default; per-cohort settings still apply once ported |
| `GOC_JOB_OWNER` | `onebit` | Set to `appwrite` **only** when cutting jobs over |
| `GOC_APPWRITE_OFF` | unset | When set, the Function refuses Appwrite work |
| `GOC_MAINTENANCE_MODE` | unset | `1` closes every route except a minimal `GET /api/health`. See **MAINTENANCE-MODE.md** |

### Least-privilege API key scopes

Grant only what the ported routes need. Starting point in `appwrite.json`:
`documents.read`, `documents.write`, `files.read`, `files.write`, `users.read`.
Do not grant project-level admin scopes.

The `sessions` collection must grant **no** client permissions — see
`functions/goc-api/schema/sessions.json`. Only the server key may touch it.

## Job ownership: preventing double sends

Exactly one environment may run scheduled work.

- OneBit active, Appwrite testing → `GOC_JOB_OWNER=onebit` everywhere.
- Cutting over → set `appwrite` on the Functions **and** disable the OneBit
 timers (stop the OneBit process or its scheduler) in the same change window.

Never leave both set to `appwrite`, and never enable Appwrite schedules while
OneBit is still mailing. See `APPWRITE-ROLLBACK.md`.
