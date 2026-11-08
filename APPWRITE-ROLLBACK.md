# Rollback

OneBit remains the production system throughout. Every step below returns control
to it. **Nothing in this migration deletes data.**

## Immediate rollback (frontend)

The OneBit deployment was never modified, so rollback is usually just "keep using
OneBit".

1. Stop routing test traffic to the generated Site domain.
2. Do **not** change DNS — `gocacademy.live` was never pointed at Appwrite.
3. Confirm OneBit still answers: `GET https://gocacademy.live/api/health`.

## Disable the Appwrite Function

1. Delete or disable the `goc-api` deployment in the Console.
2. The Site build will then fail its API calls. That is expected and safe: it is a
   separate origin from production.
3. OneBit is unaffected — it never imported anything from `functions/`.

## Roll back scheduled jobs

This is the only step where ordering matters, because two schedulers must never
mail the same person twice.

- **If jobs were cut over to Appwrite:** disable every Appwrite schedule **first**,
  then set `GOC_JOB_OWNER=onebit` and restart the OneBit process.
- **If jobs never left OneBit** (the current state): nothing to do. `GOC_JOB_OWNER`
  defaults to `onebit`.

Before restarting OneBit, check the delivery ledger for the affected window so a
re-run does not resend. The ledger is **not implemented yet**; until it exists,
do not cut jobs over at all.

## Roll back the session schema

The proposed `sessions` collection is new and additive.

1. Leave it in place — it costs nothing and OneBit does not read it.
2. If it must be removed, first confirm it contains only Function-created session
   documents and **no** application data, then delete it deliberately.
3. OneBit sessions live in its own process memory and are untouched by any of this.

Never delete or recreate `goc_academy`, `goc-data`, `academy-data-json`, existing
collections, or any Auth user as a rollback step.

## Roll back code

The change is confined to one branch.

```bash
git log --oneline origin/main..HEAD    # review what the branch adds
```

- To abandon the migration: close the PR and leave `main` alone. `main` was never
  modified by this work.
- To revert only the frontend base plumbing while keeping the Function: revert the
  four source edits listed in the change manifest in `APPWRITE-MIGRATION.md`.
  With `GOC_API_BASE` unset the OneBit build is already behaviourally identical,
  so this is normally unnecessary.
- Never force-push, rewrite history, or reset a shared checkout.

## Verify OneBit after any rollback

```bash
npm ci
npm test
npm run build
npm run deploy
npm start          # then GET /api/health
```

All five were green on this branch: 213 suites, build and deploy exit 0, health
`200`. See `APPWRITE-TEST-REPORT.md`.

## Data safety reminder

Do not enable `GOC_APPWRITE_OFF=1` against an empty data directory. `seed()` still
runs and writes demo content; `GOC_NO_DEMO_SEED=1` only changes classification.
The real `data.json` must already exist on the persistent volume.
