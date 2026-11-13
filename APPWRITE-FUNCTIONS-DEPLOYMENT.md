# Deploying the `goc-api` Function

> **Not yet deployable.** `appwrite.json` has a placeholder `projectId`, one
> route is implemented, and no schema has been applied. Run preflight first:
>
> ```bash
> node functions/goc-api/tools/preflight.js
> ```
>
> It exits non-zero while the project id is a placeholder or the proposed
> session schema is publicly readable. That is intentional.

## Prerequisites

1. Access to the **existing** Appwrite project (this migration creates none).
2. Confirm database `goc_academy` and bucket `goc-data` exist. Do not recreate.
3. Create a server API key with the minimal scopes listed in `appwrite.json`.
4. Inspect whether a `sessions` collection already exists. **If one exists for
   another purpose, stop** — do not rename, delete or repurpose it.

## 1. Verify the runtime

`appwrite.json` declares `node-22`. Confirm that identifier against the runtimes
your Appwrite instance actually offers before deploying:

```bash
appwrite functions listRuntimes
```

If `node-22` is not listed, change `runtime` to a supported Node runtime and
re-run the tests. The Function source uses only stable Node APIs (CommonJS,
`node:crypto`, global `fetch`), so any Node ≥ 18 runtime should work, but this has
**not** been verified against a live instance.

## 2. Apply the proposed session schema (manual, reviewed)

`functions/goc-api/schema/sessions.json` is a **proposal**. Review the attributes
and indexes, confirm no collection with that id exists, then create it.

All permissions are `[]`: only the server key can read or write sessions. Do not
grant `read("any")` or `read("users")` — the tokens are bearer credentials.

Until this collection exists, every protected route fails closed with a
configuration error naming the schema file. There is no in-memory fallback.

## 3. Configure variables

Set the privileged variables from `APPWRITE-ENVIRONMENT.md` in the Console.
Include `GOC_ALLOWED_ORIGINS` with the exact generated Site origin, and leave
`GOC_JOB_OWNER=onebit` while OneBit is live.

## 4. Install and deploy

```bash
cd functions/goc-api
npm install --omit=dev

cd ../..
appwrite push functions --function-id goc-api
```

`execute = ["any"]` is required so anonymous visitors can reach the public
endpoints. **It does not grant application access**: every protected route
validates the bearer token and the account tier in code.

## 5. Smoke check

```bash
curl -i https://<function>.appwrite.global/api/health
```

Expected once the state reader is implemented: `200` with
`{ service, version, passcodeLength, storage: "appwrite-storage", free2027 }`.

Until then `health` returns a **configuration error** because no state reader is
wired. That is an honest failure, not a stub success.

Unported routes return **501** with
`This endpoint is not yet migrated to Appwrite Functions (METHOD path).`
They never return a fake success payload.

## 6. Track coverage

```bash
node functions/goc-api/tools/coverage-report.js
```

This reads the live router, not comments, so the number cannot drift upward by
editing prose. Commit the regenerated `coverage.json` with each batch of routes.

## Scheduled Functions (not yet built)

The plan is four Functions — `goc-reminders`, `goc-backups`, `goc-maintenance`,
`goc-broadcasts` — each honouring `GOC_JOB_OWNER`, writing a per-delivery ledger
document before sending, and skipping anything already recorded so a retry or a
double schedule cannot send twice. Batching must respect the academy timezone.
**None of this is implemented**; do not enable any Appwrite schedule yet.
