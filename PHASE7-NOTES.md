# Phase 7 — Notes

Status against the two roadmap items:

| # | Item | Status |
|---|---|---|
| 1 | Fresh-eyes pass on `readme.md`'s example passwords/codes | Done — found and fixed two issues, see below |
| 2 | `LAUNCH-CHECKLIST.md` vs folding into `DEPLOYMENT.md` | Decided: fold — kept as `DEPLOYMENT.md`'s existing "Go-live checks" section, no new file |

## Item 1 — readme.md fresh-eyes pass

Read `readme.md` in full, specifically looking for anything that could be
mistaken for a real secret rather than a placeholder, separate from the
Phase 4 pass (which checked the content was accurate, not this).

Two real issues found and fixed:

- **`GOC_PASSCODE = "863104"`** in the "Before real students use it"
  example block stood out from its three neighbours. The other three
  example values are unmistakably prose placeholders
  (`"something-only-you-know"`, `"something-only-she-knows"`,
  `"whatever-you-told-the-cohort"`) — nobody would type those in verbatim.
  A bare six-digit string reads like a suggested real passcode, and
  someone skimming the block could plausibly copy it in as-is rather than
  replacing it, which is the exact failure mode the surrounding section is
  warning against. Confirmed it isn't wired to any actual default check
  (`grep` for `863104` across the whole tree — the only hit was this one
  doc line) before changing it, so this was a docs-only fix. Replaced with
  `"a-passcode-only-staff-know"`, matching the placeholder style of the
  other three lines.
- **"Thirteen suites, about 2,090 separate checks"** was stale — it dates
  from before Phase 2's `test-security.js` and Phase 6's
  `test-driver-parity.js` were added. Re-ran the real suite this session
  (see Phase 2 addendum below) and counted straight from its own output:
  **15 suites, 2,122 checks**. Updated the line accordingly rather than
  re-rounding by hand.

Everything else in the file was re-read against the same question and
found fine: the demo logins table is explicit that those three passwords
and the console passcode are published and not secret, explains why, and
the "Before real students use it" / "Before you launch" sections both
already tell an operator to replace all four before real students arrive.
No other value in the file reads as a plausible real secret.

## Item 2 — LAUNCH-CHECKLIST.md decision

Kept the existing "Go-live checks" section inside `DEPLOYMENT.md` rather
than splitting it into a new file. Reasoning: the checklist's items
(env vars, `GOC_TRUST_PROXY`, Node-version pinning, the backup rotation,
the boot-time secret check) are each explained in detail a few sections
above the checklist, in the same document — splitting the checklist out
would either strip it of that context or duplicate the explanations in a
second file that then has to be kept in sync with the first by hand.
`DEPLOYMENT.md` is already organized as one linear read from "before you
deploy" through "go live", and the checklist is that read's natural last
stop. No new file created.

## Phase 2 addendum, closed out this session

Not a Phase 7 item on the roadmap, but directly relevant to both items
above and worth recording here rather than silently: **this session's
sandbox had real `registry.npmjs.org` access**, the first one in this
project's history to. Ran `npm install` for real (succeeded, no stub),
then `node test/run.js` — genuine **15/15 green**, not via the
network-less busboy-stub trick every prior session had to use. Then ran
`npm audit` for real: **0 vulnerabilities**. `package-lock.json` came
back byte-identical to the version already in the zip.

This closes Phase 2 roadmap item #9, the one standing exception noted in
every prior session's handoff. Updated `PHASE2-AUDIT-NOTES.md`'s status
table and caveat section, and checked off the corresponding line in
`DEPLOYMENT.md`'s Go-live checklist. Treat this as current as of
2026-09-14, not permanent — a new CVE in an existing dependency wouldn't
show up in an old audit, so it's still worth a real re-run close to
go-live.

## What Phase 7 did NOT touch

Nothing in Phases 0-6 or Phase 8 beyond the one Phase 2 line-item above.
The Phase 8 hard blockers (real Appwrite key rotation, the two manual
smoke tests, tagging a release commit, the Appwrite-side student-data
backup) are unchanged — none of them were actionable from a sandbox
before this session and the registry access this session had doesn't
change that; it's unrelated to those four blockers.
