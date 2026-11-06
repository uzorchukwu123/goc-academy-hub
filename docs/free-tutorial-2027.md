# G.O.C Academy Hub — 2027 Free Tutorial Edition

This document describes the corrected Free Tutorial workflow. It is an edition of the existing hub, not a separate application.

## Activity categories

Free Tutorial administration has exactly two activity categories:

- `WEEKLY ASSESSMENT`
- `COMPETITION`

There is no theory/objective/JAMB-oriented/practice-only activity classification in the Free Tutorial console. Internally, bank questions may still carry `section: "objective"` as a compatibility default for the shared question validator; it is not a user-facing category and it never selects a bank.

## Question banks

The edition keeps two independent banks:

- `questionBanks.weekly` — Weekly Assessment Question Bank (`WQ-…` IDs)
- `questionBanks.competition` — Competition Question Bank (`CQ-…` IDs)

The destination bank is always the bank panel/import route explicitly selected by the administrator. It is never inferred from the filename, subject, CSV contents, or activity title.

## CSV import format

Use this exact 14-column header, saved as UTF-8 CSV:

```csv
subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId
```

Column rules:

| Column | Rule |
| --- | --- |
| `subject` | Required. One of `Use of English`, `Mathematics`, `Physics`, `Chemistry`, `Biology`. |
| `topic` | Optional. Blank defaults to `General`. |
| `text` | Required question text. Quote cells containing commas, quotes, or line breaks; double embedded quotes. |
| `optionA` | Required. |
| `optionB` | Required. |
| `optionC` | Required. |
| `optionD` | Required. |
| `optionE` | Optional. Leave blank for a four-option question. |
| `answer` | Required letter `A`, `B`, `C`, `D`, or `E`. It must point to a filled option. `E` is invalid when `optionE` is blank. |
| `difficulty` | `Easy`, `Medium`, or `Hard`; blank defaults to `Medium`. |
| `explanation` | Optional. |
| `active` | `TRUE` or `FALSE`; blank defaults to `TRUE`. |
| `year` | Optional four-digit examination year metadata. |
| `passageId` | Optional positive integer passage metadata. |

Import behaviour:

- Maximum 500 question rows per upload, excluding the header.
- One file may contain all five subjects.
- Preview is available before saving.
- Invalid rows and duplicates are reported by line number and skipped.
- Duplicate detection is scoped to the destination bank.
- The old `section`, `expected`, and `maxMark` columns are not part of the Free Tutorial CSV contract.

Example row:

```csv
Mathematics,Statistics,Which of the following is a measure of central tendency?,Range,Mean,Variance,Standard deviation,,B,medium,The mean is the sum of the values divided by their number.,TRUE,,
```

## Manual question entry

Both bank panels use the same manual form:

- subject
- topic
- large question textarea
- separate labelled inputs for Option A, B, C, D, and optional E
- Correct Answer dropdown `A`–`E`; empty `E` cannot be selected
- difficulty
- optional explanation
- active flag
- live exam-style preview before saving

The frontend converts the selected letter to the backend’s zero-based option index. Editing uses the same form and preserves the question’s bank identity.

## Activity creation and automatic allocation

Workflow:

1. Choose **Create Activity**.
2. Choose **WEEKLY ASSESSMENT** or **COMPETITION**.
3. Configure settings. The server automatically retrieves questions from the corresponding bank.

There is no individual question picker and no manual question selection.

Settings:

- title
- instructions
- opens/closes window
- duration
- maximum attempts
- number of questions
- optional subject distribution
- question randomisation
- option randomisation per attempt
- publication status

The editor shows the available eligible question count for the selected bank. A requested count cannot exceed the eligible pool. If a subject distribution is supplied, its positive counts must add up to the requested question count and each subject count must be available in that bank.

The server generates and persists `questionIds` on the activity. Attempts snapshot the assigned paper. Resuming an attempt returns the same paper and remaining time. When option randomisation is enabled, the server persists a per-attempt option order, serves shuffled options, maps displayed choices back to original indices for storage/marking, and maps saved responses back to displayed indices on resume. Student payloads never include correct answers or explanations.

## Student CBT portal

The portal has three destinations:

- Weekly Assessments
- Competitions
- Competition Leaderboard

Published weekly assessments appear only under Weekly Assessments. Published competitions appear only under Competitions. Only competition results can feed the competition leaderboard, and a board is public only after administrator approval and publication.

The CBT runner uses a light background, dark readable text, white question cards, separated answer cards, red accents, and mobile-first spacing. Option letters are separate visual elements, for example `[ A ]` beside the option text. The header shows title, category, question number/total, and countdown. Navigation provides Previous, Question Navigator, Next, and Submit. The navigator distinguishes answered, unanswered, and current questions. Submission opens a confirmation dialog showing answered, unanswered, and total counts.

## Navigation and mobile behaviour

- The original homepage remains the first screen. Its branding, hero, ecosystem,
  subjects, how-it-works, contact section and drawer destinations are preserved.
  A homepage-scoped flex guard prevents the hero/logo strip from being clipped by
  the fixed-height screen shell on phones.
- In 2027 Free Tutorial Mode the homepage drawer and desktop header expose the
  CBT Portal entry instead of the original account actions. In Original Mode the
  original account actions and Updates & News destination return. The drawer
  still carries the ecosystem, subjects, how-it-works, contact, Updates & News,
  and contact information.
- The Free Tutorial landing, registration, portal, result and leaderboard screens
  have visible mobile Back/Home actions. Back uses an internal navigation stack,
  refreshes portal/home data on arrival, and never exits the site by falling
  through to browser history.
- Leaving an active CBT paper asks for confirmation. Resuming returns the same
  attempt, paper, saved answers and server countdown.

## Website Mode Control

The Founder console has a separate **Website Mode Control** tile/panel. It uses
the existing confirmed, reversible mode API; programme settings are not duplicated
inside the 2027 Free Tutorial panel. Switching modes does not delete question
banks, activities, attempts, participant records or original-hub data. Academic
Directors and students cannot change the website mode.

## Founder contact entrance and removed entrances

The Founder entrance is the existing homepage contact form: the configured exact
gate word in Message plus the explicit configured Founder email. The server
verifies it, rate-limits attempts, and opens the existing staff login flow; the
Founder then signs in with `GOC-A-001` and the Founder password and unlocks the
console with the separate passcode. The gate word is not stored in the page,
contact records, email, or browser storage, and there is no separate gate input.
Ordinary contact messages continue through the normal contact route.

The five-click science-card entrance, Scholar-ID tutor secret-word entrance, and
their obsolete public triggers/configurations stay removed. Legitimate staff
authentication, roles and console passcode protection remain intact.

## SMTP diagnostics

`GET /api/free2027/admin/email-status` is guarded by the Founder site-configuration
capability. It reports only variable names/booleans and `missing`, `incomplete`,
or `configured`; `?verify=1` attempts a live transport check and reports `ready`
or `unreachable` without exposing secrets. Registration availability messaging
uses the same safe classification.

## Verification

Run the full automated suite and production build:

```bash
npm ci
npm test
npm run build
```

The optional real-browser harness is
[`test/browser/free2027-recovery.js`](../test/browser/free2027-recovery.js). Setup
and isolation requirements are in [`LOCAL-DEVELOPMENT.md`](../LOCAL-DEVELOPMENT.md).
It exercises the mobile drawer, Free landing, registration/OTP, banks/CSV/manual
questions, activities, CBT save/resume/submit, leaderboard publication, Founder
entrance, staff login/passcode, reversible mode switching, removed entrances and
desktop fit. It is Android viewport/user-agent emulation in headless Chromium;
a physical Android/Chrome smoke test is still recommended before release.
