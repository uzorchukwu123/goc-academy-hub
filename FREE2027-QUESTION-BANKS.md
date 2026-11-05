# 2027 Free Tutorial Edition — Question Banks, Assessments & Founder Entry

This document describes the PR #9 architecture for the temporary 2027 Free
Tutorial Edition. The original G.O.C Academy Hub is untouched by all of it.

## 1. Two independent question banks

Free Tutorial questions live in the edition's own slice of the local JSON data
file — **never** in the shared `db.questions` collection and never in Appwrite:

```
db.free2027.questionBanks = {
  weekly:      { questions: [], questionSeq: 0 },   // IDs WQ-001, WQ-002, …
  competition: { questions: [], questionSeq: 0 }    // IDs CQ-001, CQ-002, …
}
```

- Each bank is a separate storage with its own ID sequence, so IDs can never
  collide across banks.
- Each bank has independent CRUD, independent CSV import, independent bulk
  deletion and its own **Delete All**.
- Both persist across server restarts (they are part of the same data file the
  edition already uses). `db.questions` and Appwrite are never read or written
  for edition activities.

## 2. How questions are resolved (bank binding is server-enforced)

The activity kind decides the bank, and the server enforces it at every step:

| Activity kind | Question bank |
| --- | --- |
| Weekly Assessment | `questionBanks.weekly` |
| Competition | `questionBanks.competition` |

Enforced when an activity is created/edited (question IDs must exist in the
activity's own bank), when an attempt starts (IDs that don't resolve in the
bank are rejected as forged), when answers are saved, resumed, submitted,
marked, when results and attempt details are produced, and when competition
rankings/leaderboards are calculated. Client-side filtering is never trusted.
Student-facing payloads never contain the correct answer (`core.forStudent`
strips it).

## 3. CSV import

- One CSV file may mix all five subjects; the `subject` column of each row
  decides the category. Separate files per subject are **not** required.
- The destination bank is chosen explicitly in the console (Weekly Assessment
  Question Bank or Competition Question Bank) before upload. The destination is
  never inferred from the subject or the filename, and an import into one bank
  never touches the other.
- Format (compatible with the hub's existing question CSV):

  `subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation,active,year,passageId`

- The hub's own parser (`core.importCSV` in `js/goc-core.js`) is reused, so
  quoted commas, escaped double quotes, multiline fields, UTF-8 BOM, header
  normalisation, answer formats (letter `A`–`H`, number `1`–`8`, or the option
  text), difficulty validation, duplicate detection (against the destination
  bank only, and within the file itself) and row-level error reports all behave
  exactly as in the main hub.
- **Maximum 500 question rows per CSV.** Larger files are refused.
- A **preview** is shown before the final import; the completion report shows
  rows read, questions imported, skipped duplicates, and per-line errors.

## 4. Manual question creation and editing

Each bank panel has **Add question**: subject (the five supported subjects:
Use of English, Mathematics, Physics, Chemistry, Biology), topic, text,
2–5 options, the correct option, difficulty and an optional explanation.
Editing reuses the same validation as CSV rows.

## 5. Deletion policy (safety)

- Individual delete, **Delete selected** and **Delete all** are separate per
  bank and always ask for confirmation in the UI; the **server also requires
  `confirm: true`**, and delete-all errors name the bank and the exact number
  of questions that would be removed.
- The bank identifier is validated against the allowlist `weekly` /
  `competition` — no request can address an arbitrary collection, and a
  delete-all on one bank can never delete the other bank's questions.
- A question that is referenced by **any** activity (current or archived
  session) **cannot be deleted or edited** — the server refuses with 409.
  This protects existing attempts, historical results, competition
  submissions and leaderboards from corruption. Delete-all is refused entirely
  while any question in the bank is referenced.
- Per-bank ID sequences only move forward, so deleted IDs are never re-issued.

## 6. Where Free Tutorial data is persisted

Everything the edition owns lives in `db.free2027` inside the hub's local JSON
data file (`server/data.json`, or `$GOC_DATA_DIR/data.json`), riding the
existing persistence and backup path. Archived sessions are written as their
own JSON files under `<data dir>/free2027-archives/`.

## 7. Backups

Back up the whole data file (and the `free2027-archives/` folder) exactly as
you already back up the hub's data file. Never edit `data.json` by hand while
the server is running; never commit it.

## 8. Founder entry

The hidden homepage statistics-card entrance was removed. The Founder uses the
public **Get in Touch** contact form with the exact message `GOC FOUNDER`. The
server checks the submitted email against the configured Founder account
(`GOC-A-001`; set `GOC_FOUNDER_EMAIL` to override the derived
`goc-a-001@gocacademy.com` address). Only a matching identity is routed to the
existing staff sign-in (`admin-gate`). The phrase alone never grants access,
no token is ever issued by the contact route, and ordinary messages are handled
exactly as before.

## 9. Admin console layout

The 2027 Free Tutorial Management console (Founder / Academic Director) has a
**Question Banks** tab with two clearly separated panels — Weekly Assessment
Question Bank and Competition Question Bank — each with its own count, subject
chips, search, subject filter, CSV import (preview + report), Add question,
edit, delete, bulk delete and Delete all. The activity editor's question picker
always reads the bank matching the activity's kind.

## 10. Verification email (Brevo SMTP)

Registration OTPs are delivered through the existing SMTP transport. Required
environment variables (set them in `.env`, never in source control):
`GOC_SMTP_HOST=smtp-relay.brevo.com`, `GOC_SMTP_PORT=587` (STARTTLS — leave
`GOC_SMTP_SECURE` unset), `GOC_SMTP_USER` (Brevo SMTP login), `GOC_SMTP_PASS`
(Brevo SMTP key), `GOC_SMTP_FROM` (an authorized Brevo sender), and
`GOC_FREE_2027_OTP_SECRET` (≥32 random characters). For local development a
dummy capture listener (e.g. Mailpit on :8025) may be used with
`GOC_SMTP_HOST`/`GOC_SMTP_PORT` only — it is never reported as real delivery.
The Founder can check the state safely at
`GET /api/free2027/admin/email-status[?verify=1]`, which distinguishes
`missing` / `incomplete` / `configured` / `unreachable` / `ready` and never
exposes any secret value.
