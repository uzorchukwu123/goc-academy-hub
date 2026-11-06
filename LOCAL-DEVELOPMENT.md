# Local development — 2027 Free Tutorial Edition

Use a scratch data directory and an SMTP capture service to test the 2027 Free
Tutorial Edition without touching production records or exposing verification
codes through the browser/API. The original G.O.C Academy Hub homepage remains
the first page visitors see; the edition does not replace it.

## 1. Install and run Mailpit

Install the repository dependencies:

```bash
npm ci
```

Run Mailpit locally (or use another SMTP capture provider):

```bash
docker run --rm -p 8025:8025 -p 1025:1025 axllent/mailpit
```

Open the captured inbox at `http://127.0.0.1:8025`. The app sends normal SMTP
messages to Mailpit's SMTP listener; the code is read from the captured email,
not from an API response or server log.

## 2. Configure a separate local data directory

Linux/macOS:

```bash
export PORT=8080
export GOC_FREE_2027=1
export GOC_DATA_DIR=./local-test-data
export GOC_APPWRITE_OFF=1              # optional: do not contact configured Appwrite in this local run
export GOC_FOUNDER_PW='local-founder-2027'
export GOC_ACADDIR_PW='local-acaddir-2027'
export GOC_PASSCODE='481516'
export GOC_FOUNDER_EMAIL='REPLACE_ME'              # replace with a valid local test email to enable the entrance
export GOC_FOUNDER_GATE_WORD='REPLACE_ME'          # replace with a private 12–200 character exact phrase
export GOC_SMTP_HOST=127.0.0.1
export GOC_SMTP_PORT=1025
export GOC_SMTP_SECURE=false
export GOC_SMTP_FROM='G.O.C Academy Hub <test@gocacademy.test>'
export GOC_FREE_2027_OTP_SECRET='local-test-otp-secret-0123456789abcdef'
node server/server.js
```

Windows PowerShell:

```powershell
$env:PORT='8080'; $env:GOC_FREE_2027='1'; $env:GOC_DATA_DIR='./local-test-data'
$env:GOC_APPWRITE_OFF='1'
$env:GOC_FOUNDER_PW='local-founder-2027'; $env:GOC_ACADDIR_PW='local-acaddir-2027'; $env:GOC_PASSCODE='481516'
$env:GOC_FOUNDER_EMAIL='REPLACE_ME'; $env:GOC_FOUNDER_GATE_WORD='REPLACE_ME'
$env:GOC_SMTP_HOST='127.0.0.1'; $env:GOC_SMTP_PORT='1025'; $env:GOC_SMTP_SECURE='false'
$env:GOC_SMTP_FROM='G.O.C Academy Hub <test@gocacademy.test>'
$env:GOC_FREE_2027_OTP_SECRET='local-test-otp-secret-0123456789abcdef'
node server/server.js
```

`GOC_APPWRITE_OFF=1` is optional and only for an intentionally isolated local
run. It disables Appwrite for that process; it is not part of the Free Tutorial
implementation and must not be set in production. Without this flag, the
existing Appwrite integrations for original G.O.C Academy Hub modules are left
as configured.

The Free Tutorial namespace is `db.free2027` in the scratch data file. Set
`GOC_DATA_DIR` to a separate, ignored directory so testing cannot overwrite the
normal `server/data.json` or production records. No `.env`, provider credentials,
JSON data, or backups should be committed.

| Variable | Purpose |
|---|---|
| `GOC_FREE_2027=1` | Enable the testing edition on this local run. |
| `GOC_DATA_DIR=./local-test-data` | Scratch storage for local data and session archives. |
| `GOC_SMTP_HOST`, `GOC_SMTP_PORT`, `GOC_SMTP_SECURE` | Mailpit/local SMTP address and TLS settings. |
| `GOC_SMTP_FROM` | Sender shown in captured verification messages. |
| `GOC_FREE_2027_OTP_SECRET` | At least 32 random characters; HMAC pepper for persisted code hashes. Keep stable in production and store only in the environment/secret manager. |
| `GOC_SMTP_USER`, `GOC_SMTP_PASS` | Optional; omit both for a local capture service. Configure both for an authenticated provider. |
| `GOC_FOUNDER_PW`, `GOC_ACADDIR_PW` | Throwaway local passwords for the seeded management accounts. They are hashed in the local data store. |
| `GOC_PASSCODE` | Throwaway local console unlock passcode. |
| `GOC_FOUNDER_EMAIL` | Explicit Founder email checked by the contact entrance. Required to enable that entrance; no derived/staff-record fallback. Use a local test address here, never a production address. |
| `GOC_FOUNDER_GATE_WORD` | Exact, case-sensitive phrase typed into the contact form's Message field. 12–200 characters, no leading/trailing whitespace or control characters. Server-only; never sent to the browser, stored as a contact message, emailed, or printed in logs. |
| `GOC_APPWRITE_OFF=1` | Optional local-only switch to prevent Appwrite calls from this process. |

If SMTP is not configured or delivery fails, registration returns a clear
configuration/delivery error. The app never pretends an email was sent and
never returns the verification code to the browser. Do not enable any local
code-display bypass; none exists.

## 3. Open the original homepage and Admin Console

Open `http://localhost:8080`. The original G.O.C Academy Hub homepage, branding,
content, navigation, and Science Subjects Statistics card remain visible. The
**4 Science subjects** card is an ordinary statistic — it opens nothing (the old
hidden entrance was removed in PR #9).

### Founder authentication sequence (all layers stay separate)

1. **Founder identity request** — on the homepage, scroll to **Get in Touch**
   and submit the contact form with your full name, the exact value of
   `GOC_FOUNDER_EMAIL`, and the exact value of `GOC_FOUNDER_GATE_WORD` in the
   Message field. The phrase is case-, space- and punctuation-sensitive. The
   server validates it, checks the email, and rate-limits these attempts. A
   match only routes you to the existing staff login (`free-admin`) — it grants
   no access by itself. The gate word is not stored as a contact message and is
   not emailed.
2. **Staff login** — sign in with the Founder staff credentials (`GOC-A-001` +
   `GOC_FOUNDER_PW` locally).
3. **Admin Console Gate** — enter the console passcode (`GOC_PASSCODE` locally).
4. **Admin Console** opens.

### Founder contact configuration

`GOC_FOUNDER_EMAIL` is the only email identity source for this entrance. There
is no predictable derived address and no silent fallback to a staff-record
email. If it is unset or invalid, an exact gate-word request returns a safe
configuration error and grants nothing. If `GOC_FOUNDER_GATE_WORD` is unset or
invalid, the Founder entrance is closed (no phrase can match); ordinary
contact messages still work. Neither value is exposed by `/api/health`,
`/api/free2027/config`, or any other public configuration endpoint, and
neither is printed in server logs. Keep production values in the environment
or secret manager, not in Git or frontend JavaScript.

To test the complete flow locally, replace the two `REPLACE_ME` placeholders
with your own throwaway local values, then sign in with `GOC-A-001` /
`GOC_FOUNDER_PW`, then unlock with `GOC_PASSCODE`. A failed identity request
stays on the contact form with an error; it never opens staff login or the
Admin Console Gate.

| Local account | Staff ID | Password | Role |
|---|---|---|---|
| Founder | `GOC-A-001` | value of `GOC_FOUNDER_PW` | Full administrative access, including system controls |
| Academic Director | `GOC-A-002` | value of `GOC_ACADDIR_PW` | Academic/programme management and relevant reports; no Free Tutorial system settings or session archives |

Enter the local `GOC_PASSCODE` to unlock the console. These are local throwaway
values only. Existing deployments retain their already-configured password
hashes and authentication mechanisms; do not copy local test credentials to
production.

## 4. Test student registration and verification

1. From the original homepage, use an existing public onboarding link to enter
the Free Tutorial student experience while the edition is enabled.
2. Enter a name, email, and intended course.
3. Open the Mailpit inbox, select the message for the registered address, and
   copy its six-digit verification code. The email identifies G.O.C Academy Hub
   and states the expiry period.
4. Enter the code on the verification page. The student is registered only
   after the server accepts a valid, unexpired, unused code.
5. Use **Resend verification code** to test resend behavior. The cooldown and
   hourly rate limit apply; a resend invalidates older codes.
6. Verify that the dashboard shows a permanent `GOC-F27-` ID, enrolment,
   learning progress, and quiz summary. The ID is generated from secure random
   bytes, is not sequential, and remains associated with the verified email
   across logout, re-verification, and tutorial sessions.

The code is salted-hash persisted only. It is never in a browser response,
console log, plaintext data file, or student dashboard. Local capture is the
supported way to inspect the actual email.

## 5. Test programme and role controls

From the Founder account, open the **2027 Free Tutorial** console panel:

- Manage the independent Weekly Assessment and Competition question banks.
  Import the exact 14-column CSV contract or enter A–E questions manually;
  preview before saving. Option E is available only when filled.
- Create and publish the two activity categories. The server allocates questions
  automatically from the bound bank, with optional subject distribution,
  question/option randomisation, scheduling, duration and attempt limits. There
  is no individual question picker.
- Complete assessments/competitions as a student and inspect participant
  progress, attempts/results, reports, and the audit trail. Competition boards
  require explicit approval and publication; weekly results stay private.
- Use the separate Founder-only **Website Mode Control** panel to switch between
  Original Mode and 2027 Free Tutorial Mode. Switching is reversible and does not
  delete either programme or original-hub records. Programme edition/session
  settings remain in the 2027 Free Tutorial panel; archives are written under
  `local-test-data/free2027-archives/`.
- Sign in as Academic Director and verify academic programme management works,
  but website-mode/edition changes and session archive routes are rejected by
  the server.
- Try a student token against another student's record or an administrative
  route; the server must reject access.

On a phone, check the homepage drawer (ecosystem, subjects, how it works,
contact, Updates & News, contact details, and the mode-appropriate account/CBT
action), the Free Tutorial landing/registration/portal Back and Home actions,
and the CBT navigator/countdown/submit confirmation. Leaving an active paper
asks for confirmation; resuming restores the same paper, answers and server
countdown. Internal Back navigation must not exit the site.

Unrelated original student modules are disabled while the testing edition is
active, not deleted. The original homepage and its content remain visible. The
original Appwrite integration is not globally changed; the optional local-only
switch above is the only way to suppress Appwrite calls for a development run.

## 6. Verify persistence and restart behavior

Stop the server and restart it with the same `GOC_DATA_DIR`. Confirm:

- Free Tutorial profiles, permanent IDs, enrolments, independent question banks,
  progress, activities, attempts/results, settings, and audit records remain.
- A student's ID is unchanged after they re-verify.
- Session archives remain readable from the Founder console.
- The original store is not overwritten by the isolated Free Tutorial tests.

## 7. Optional real-browser regression

`test/browser/free2027-recovery.js` drives the real pages in headless Chromium
with an Android-sized viewport/user agent. It is optional and is not part of
`npm test`, because it needs a browser binary and a fresh isolated server. It
checks the homepage/drawer, Free landing, registration/OTP validation and resend
cooldown, verified-session refresh, contact/Founder entrance, staff login and
passcode, both banks, invalid/valid CSV, manual A–E entry, activity allocation,
CBT navigation/save/resume/submit, leaderboard approval/publication, reversible
website-mode switching, removed hidden entrances, and desktop fit.

It also covers the round-2 contract: the homepage has no bootcamp CTA, a guest
enters the CBT Portal directly (mobile and desktop, in separate browser runs),
the exam header's Back/Home controls do not overlap, a slow availability reply
preserves the typed activity draft, assessments accumulate, deleting an activity
keeps every attempt/answer/score/result, and bank bulk/delete-all is bank-scoped
and leaves historical results readable. Screenshots and a JSON result file are
written outside the repository by default.

Install the browser tooling separately so the app dependency tree is unchanged:

```bash
mkdir -p /tmp/goc-browser-tools
npm --prefix /tmp/goc-browser-tools install playwright-core
export PLAYWRIGHT_CORE_PATH=/tmp/goc-browser-tools/node_modules/playwright-core
export CHROMIUM_EXECUTABLE_PATH=/path/to/chrome-or-chromium
```

For this automated run, use the repository's test-only SMTP capture rather than
Mailpit: start a fresh isolated copy/export of the app **without installed app
`node_modules`**, set `NODE_PATH=./test/stubs`, and set `GOC_TEST_MAIL_FILE` to a
file outside the repository. The stub records the actual message handed to
Nodemailer so the harness can read the emailed code; the server's OTP generation,
hashing, expiry and verification remain the real implementation. This capture
adapter is for isolated tests only, never production.

Then run the harness with the same isolated environment plus:

```bash
export GOC_BROWSER_ISOLATED=1
export GOC_BROWSER_DATA_FILE="$GOC_DATA_DIR/data.json"
export GOC_BROWSER_BASE=http://127.0.0.1:8080
# GOC_FOUNDER_GATE_WORD, GOC_FOUNDER_PW and GOC_PASSCODE must match that server.
node test/browser/free2027-recovery.js
```

The harness refuses to run unless `GOC_BROWSER_ISOLATED=1`, the data file is
outside the repository, and the banks/activities/contact inbox are empty. It
never prints the configured gate word. `GOC_BROWSER_ARTIFACTS` can set an
explicit output directory; `GOC_BROWSER_CHROME_ARGS` can supply extra Chromium
flags as a JSON array (or comma-separated simple flags) for constrained CI
environments. This is browser emulation,
not a substitute for a final smoke test on a physical Android device.

The local JSON and archive paths are ignored by Git. To remove this local test
installation, stop the server and delete only `local-test-data/`.
