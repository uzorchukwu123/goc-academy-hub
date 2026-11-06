# Project-wide regression recovery and verification

Branch: `arena/577ff09f-goc-academy-hub`

Scope: cumulative recovery from `main` (`fa9a794`) through the retained branch work and this recovery patch.

Status: prepared for review. **No merge and no deployment were performed.**

Process note: the historical report was requested before modifications. In this
session, source recovery had already begun before the consolidated historical
findings were delivered; the findings below are based on Git/PR evidence and
rendered historical comparisons, not on that ordering being satisfied.

## 1. Historical timeline and the “10:40” commit

Git commit timestamps below are UTC. Lagos is UTC+1. A device/browser display set
to UTC+8 would show the `aeceb81` commit at about 10:41.

| Commit / PR | UTC | Lagos | UTC+8 | Meaning |
| --- | --- | --- | --- | --- |
| `fa9a794` (`main`) | baseline | baseline | baseline | Original main baseline used for the cumulative PR diff. |
| `aeceb81eb85a66b69e4b4a6c8c65c2f8f935d5f0` | 2026-11-06 02:41:20 | 03:41:20 | 10:41:20 | “Complete Free Tutorial 2027 banks, allocation, and mobile CBT”. This is the only close match to a displayed ~10:40 timestamp if the display was UTC+8. |
| `3360c7ba0133bf3b0f46e267157488350982cff3` | 2026-11-06 03:23:01 | 04:23:01 | 11:23:01 | “Recover PR #9 Founder contact entrance and remove obsolete hidden gates”. |
| Sibling PR [#9](https://github.com/uzorchukwu123/goc-academy-hub/pull/9) tip `71e9ebb2b5ab0db7397dfbc1a2330f0c567d69f6` | 2026-11-05 19:19:49 | 20:19:49 | 2026-11-06 03:19:49 | Later sibling-line corrections that were not fully integrated into the active branch. |
| PR [#8](https://github.com/uzorchukwu123/goc-academy-hub/pull/8) | opened 2026-11-05 11:23:39 | 12:23:39 | 19:23:39 | Original Free Tutorial implementation PR against `main`; still open. |

There is **no commit at 10:40 Lagos time** on 2026-11-06. If “10:40” was meant as
Lagos local time, the timestamp does not identify `aeceb81`; if it was a UTC+8
display, `aeceb81` at 10:41 is the matching commit.

### What `3360c7b` did and did not change

`aeceb81..3360c7b` changes 19 files (+745/−432), focused on the Founder contact
entrance, removal of obsolete hidden gates, auth/server wiring, tests and docs.
It contains **zero** changes to the homepage hero/sections, `css/styles.css`,
mobile drawer markup, Free Tutorial landing, registration UI, or CBT runner.
Therefore the visible homepage/drawer/Free-screen regressions were not introduced
by that Founder commit. They were missing integrations from the sibling PR line,
plus one latent mobile layout defect already present in the older baselines.

Sibling-line introductions relevant to the recovery:

| Missing/altered behaviour | Introducing sibling commit(s) | Recovery decision |
| --- | --- | --- |
| Mobile Back/Home visibility and drawer CBT swap | `bcb590b` | Ported/adapted to current OTP/random-ID screens. |
| Internal Back stack, drawer-only mobile CBT, SMTP diagnostics | `53d71cc` | Ported/adapted; Back now shares the same arrival refresh as direct navigation. |
| Separate Website Mode Control panel | `002034f` | Recovered as a Founder-only tile using the existing confirmed mode API; not duplicated in programme settings. |
| Independent banks / bank-bound allocation / CSV | `4cd1460` | Already retained in `aeceb81`; kept the newer 14-column contract and automatic allocation. |
| Founder contact entrance hardening | `3ab242f`, `71e9ebb` | Already retained in `3360c7b`; kept server-side exact gate, rate limiting and staff-login route. |
| Admin/email/nav regression suites | `002034f`, `bcb590b`, `53d71cc`, `71e9ebb` | Adapted to the newer passwordless OTP/random-ID architecture instead of copying obsolete tests wholesale. |

Rendered comparison at 390×844 against isolated exports of `aeceb81` and
`71e9ebb` confirmed the same brand, hero text and section headings. `aeceb81`
lacked the Free-mode drawer CBT action and Free-screen Back/Home navigation;
`71e9ebb` had those corrections. The final branch keeps the newer OTP wording and
adds a homepage-scoped flex guard because all three older renders compressed the
hero (`overflow:hidden` inside the fixed-height flex screen shell) and clipped the
lower headline/copy/buttons on mobile.

## 2. Recovered and retained work

Retained in the clean cumulative PR:

- Original homepage branding, hero, ecosystem, subjects, how-it-works, contact,
  typography/spacing and destinations; mobile drawer destinations and contact
  info; mode-appropriate account/CBT actions.
- Homepage mobile clipping fix: `#landing > * { flex-shrink: 0; }`, scoped to the
  homepage so the original hero/logo content is not compressed by the screen shell.
- Free Tutorial landing, registration entry, CBT entry, Weekly Assessments,
  Competitions, Competition Leaderboard, availability messaging, mobile Back/Home.
- Internal navigation stack: Back never exits the site; portal/home arrival data
  refreshes through the same `navigate()` path; active-paper leave confirmation;
  server-countdown persistence/resumption.
- Registration with full name/email/course, real OTP generation/verification,
  validation, resend cooldown, random permanent `GOC-F27-…` IDs, verified student
  creation and tab-session refresh persistence.
- Independent weekly/competition banks; exact 14-column CSV validation/preview;
  manual A–D with optional E; two activity categories; automatic bank-bound
  allocation, subject distribution, randomisation, scheduling, attempts and
  publication; mobile CBT navigator/countdown/confirmation/save/resume.
- Founder-only Website Mode Control, reversible through the existing confirmed
  mode API without deleting programme or original-hub records.
- Founder contact entrance: configured exact gate word in Message + explicit
  configured Founder email → existing staff login → `GOC-A-001`/Founder password
  → separate console passcode. Server-side verification/rate limiting/RBAC; no
  gate-word storage/email and no separate gate input. Founder email unchanged.
- Safe SMTP diagnostics (`server/lib/mailstatus.js` and the guarded
  `/api/free2027/admin/email-status` route), nodemailer test-stub `verify()`, and
  adapted admin/email/nav/landing regression suites.
- Optional reproducible browser harness: `test/browser/free2027-recovery.js`.
- Updated deployment/local-development/Free Tutorial docs and service-worker
  cache bump (`goc-v194`).

Explicitly excluded / kept removed:

- Five-click science-card hidden admin entrance.
- Scholar-ID tutor secret-word entrance and obsolete public triggers/configs.
- Obsolete sequential-ID/password Free Tutorial login architecture.
- Obsolete 17-column CSV documentation/contract.
- Local scratch data, mail captures, screenshots, credentials and gate words.

No wholesale older-file copy or whole-app revert was used. Newer working
implementation wins where the sibling line was obsolete; data structures and API
compatibility were preserved.

## 3. Main affected files

- Homepage/layout: `index.html`, `css/styles.css`, `css/free2027.css`, `sw.js`.
- Free UI/admin: `js/free2027-ui.js`, `js/free2027-admin.js`.
- Server/diagnostics: `server/server.js`, `server/lib/mailstatus.js`.
- Tests: `test/run.js`, `test/test-free2027-route.js`,
  `test/test-roles-session.js`, `test/stubs/nodemailer/index.js`,
  `test/test-free2027-admin.js`, `test/test-free2027-email.js`,
  `test/test-free2027-nav.js`, `test/test-landing-layout.js`,
  `test/browser/free2027-recovery.js`.
- Docs: `readme.md`, `DEPLOYMENT.md`, `LOCAL-DEVELOPMENT.md`,
  `docs/free-tutorial-2027.md`, this report.

The cumulative PR also includes the earlier retained branch commits from
`main..3360c7b` (Free Tutorial edition, local persistence, security/roles, banks,
allocation, mobile CBT, Founder entrance recovery and obsolete-gate removal).

## 4. Verification evidence

Final automated validation on the recovery tree:

```text
npm test       exit 0 — 197 suites passed, 0 failed
npm run build  exit 0 — dist 1,753,223 → 1,082,603 bytes (38% smaller)
git diff --check  clean
```

Logs in the workspace:

- `/home/user/goc-recovery-full-tests-final2.log`
- `/home/user/goc-recovery-build-final2.log`

Final real-browser validation used the committed harness
`test/browser/free2027-recovery.js` against a fresh isolated server/data/mail
capture, headless Chromium with a 390×844 Android viewport/user agent, then a
1366×900 desktop pass:

```text
92/92 checks passed
uncaught page JavaScript errors: 0
```

Evidence directory: `/home/user/goc-browser-recovery/run-uqXyv0/`
(`verify-committed.log`, `artifacts/results.json`, screenshots). Covered flows:
homepage, drawer, internal navigation, Free landing, registration/OTP, portal,
ordinary contact, removed entrances, Founder entrance, staff login, passcode,
admin console, banks, CSV, manual questions, activities, CBT, leaderboard,
mode control, persistence, desktop fit.

Historical rendered comparison evidence:
`/home/user/goc-browser-history/comparison.json`,
`/home/user/goc-browser-history/pixel-comparison-final.json`, and the
`current-*`, `aeceb81-*`, `71e9ebb-*` screenshots. The structural fingerprints
match for brand/hero/sections; drawer actions match the corrected sibling line;
Free landing differs only where the newer OTP/passwordless wording is retained.
The homepage pixel difference is the intentional clipping fix.

Limitation: this is Android browser emulation in headless Chromium, not a
physical Android handset test. A final physical Android/Chrome smoke test is
recommended before release. SMTP was exercised through the isolated test capture
adapter; production provider credentials were not used or committed.

## 5. Handoff

- Branch: `arena/577ff09f-goc-academy-hub`
- Base: `main`
- Delivery: one clean cumulative PR containing all retained recovery work.
- Merge: **not performed**.
- Deployment: **not performed**.

The exact recovery commit hash and PR URL are recorded in the final handoff/PR
description after push.