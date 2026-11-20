# Phase 3: Study Hub — Implementation Report
**Date:** 19 November 2026  
**Session:** https://claude.ai/code/session_01BDdcu3PjkiFtG6Efi57esq  
**Branch:** clean-sweep

---

## Overview

This report covers the two implementation tasks that complete the Study Hub phase:

- **Task #25** (previous session): Server-side reading progress (`noteReads`) API  
- **Task #26**: Shared student header between Home and Study screens  
- **Task #27**: Full Study Hub redesign — subject tabs, progress ring, topic accordion, Continue Learning, Recent Lessons, and Practice tools strip  
- **Task #28**: New test suite for `noteReads` routes + tour step updates + full test run  
- **Task #29**: This report, commit, and ZIP build  

---

## What Changed

### 1. Reading Progress API — `server/server.js`

Two new routes added under the `student` guard:

| Route | Purpose |
|---|---|
| `GET /api/me/reading` | Returns `{ reads: { [noteId]: { first, last, done? } } }` for the signed-in student |
| `POST /api/me/reading` | Records an open `{ noteId }` or completion `{ noteId, done: true }`. Idempotent: `done` is never unset; `first` is never moved. |

**Subject gate:** The note must be active and belong to one of the student's enrolled subjects — otherwise `403`.  
**Cap:** At most as many records as there are live notes (belt-and-braces against unlimited growth).  
**Schema:** `db.noteReads[ScholarID][noteId] = { first, last, done? }` — timestamps only; percentages are calculated at paint time, never stored.

Three API layers updated:

- **Mock** (`js/api.js` — `GOC.mock`): `getMyReading()` / `recordReading()` backed by an in-memory `_reads` map  
- **HTTP** (`js/api.js` — `GOC.http`): hits the real routes above  
- **Delegate** (`js/api.js` — `GOC.delegate`): forwards to whichever layer is active  

### 2. Shared Popover Layer — `index.html` + `css/styles.css`

**Problem:** `#dbAcctMenu` and `#dbNotif` were inside `#home > .db` which is `display:none` while Study is active, making popovers invisible from the Study screen.

**Fix:**  
- Moved both popovers to a new `<div id="dbPops">` immediately before `</body>`, outside every screen.  
- Changed `.db-pop` from `position: absolute` (relative to hidden parent) to `position: fixed` (relative to viewport).  
- Adjusted mobile `top` from `4px` to `70px` to clear the 66px mobile top bar (12px padding + 42px button + 12px padding).  
- Desktop offsets (`top: 76px` at ≥580px and ≥900px) were already viewport-relative — unchanged.  
- `#dbPops` wrapper: `position:fixed; inset:0; pointer-events:none` so it doesn't block underlying content; individual `.db-pop` elements keep `pointer-events:auto`.

### 3. Study Hub Redesign — `index.html` + `css/styles.css` + `js/app.js`

**HTML (`#study` section):**

- Added shared mobile top bar (`.db-mtop`) with menu, logo, bell, and avatar buttons — matching Home.  
- Added shared desktop header (`.db-head`) with "Study Hub" title, bell, and account button.  
- Subject tabs strip (`#stTabs`), scrollable body (`.st-body`) containing:  
  - `#stCard` — subject progress card with SVG ring  
  - `#stTopics` — topic accordion  
  - `#stContinue` — Continue Learning card  
  - `#stRecent` — Recent Lessons list  
  - `.st-hub` — Practice, Results, Resources, Mistakes, Bookmarks tile strip (with existing `sg-*` IDs for tour targets)

**CSS (Study Hub block appended to `css/styles.css`):**

- Screen shell: `display:flex; flex-direction:column; overflow:hidden`  
- Subject tabs: horizontal scroll, pill shape, red active state  
- Scrollable body: `flex:1; overflow-y:auto; padding-bottom:100px`  
- Progress ring: 72×72px mobile / 84×84px desktop SVG, `r=30`, `C=188.5` (2π×30), `stroke-dashoffset = C − (C × pct/100)`  
- Topics: numbered circles (28×28px), green when done, chevron rotates on expand  
- Lesson rows: dot indicator (grey/red/green), done state  
- Continue Learning: left red border card  
- Recent Lessons: stacked list separated by thin lines  
- Responsive: `@media (min-width:900px)` enlarges ring and switches to two-column hub grid

**JS (Study Hub module inserted in `js/app.js`):**

| Function | Purpose |
|---|---|
| `stPaintStudy()` | Entry point — called by `go('study')`. Fetches reading progress then delegates to subject panels. |
| `stPaintTabs(subs)` | Renders `.st-tab` buttons, marks the active one. |
| `stSelectSubject(subj)` | Switches active tab + reloads subject panels. |
| `stLoadSubject(subj)` | Calls `GOC.api.listNotes({subject})` then paints all panels. |
| `stPaintSubjectCard(subj)` | Renders SVG progress ring from `stReads`. |
| `stGetTopics()` | Derives `[{name, notes}]` groups from `stNotes`. |
| `stPaintTopics(subj)` | Numbered topic accordion — tap header to expand, tap lesson to open. |
| `stToggleTopic(el)` | Toggles `[open]` attribute on a topic row. |
| `stOpenLesson(noteId)` | Sets `rdSubj`/`rdNotes` globals then calls `openNote()`. |
| `stPaintContinue()` | Most recently read lesson by `stReads[*].last`. |
| `stPaintRecent()` | Up to 5 latest reads sorted by `last` descending. |
| `stRelTime(iso)` | Relative time string — "just now", "2h ago", "yesterday", "3 days ago". |

**Avatar/name sync:** `stUserName`, `stAva`, `stAvaM` now populated from `refreshMe()` and cleared on logout.

**`openNote()` integration:**  
- On open: `GOC.api.recordReading({ noteId })` — sets `first` and `last`.  
- On scroll-to-end: `IntersectionObserver` watches the last `<p>` element; fires `GOC.api.recordReading({ noteId, done: true })` when it becomes 90% visible.

### 4. Tour Step Updates — `js/onboarding.js`

The first Study-screen tour step now targets `#stTabs` and describes the subject tabs + progress ring, replacing the former generic "workshop" copy. A new intermediate step spotlights `#sg-practice` with its own explanation. This brings the tour to 14 student steps (was 13).

### 5. Service Worker Cache Bump — `sw.js`

`goc-v227` → `goc-v228`

---

## Tests

| Suite | Result |
|---|---|
| `test/test-server.js` | **395 passed, 0 failed** |
| `test/test-reading-progress.js` | **31 passed, 0 failed** (new) |
| `test/test-free-practice-desktop.js` | **23 passed, 0 failed** |
| `test/test-driver-parity.js` | **8 passed, 0 failed** |
| `test/test-free2027-ui.js` | **all passed** |

### `test-reading-progress.js` coverage

1. `GET /api/me/reading` — 200 for authenticated student, empty reads for new account  
2. Auth guards — `GET` and `POST` both return 401 without a token  
3. Staff token blocked — 403 (student-only route)  
4. First read — creates record with `first` + `last`, no `done`  
5. Second read — `first` unchanged, `last` updated  
6. `done: true` — sets `done` timestamp  
7. `done: true` again — idempotent; `done` timestamp unchanged  
8. GET after POSTs — note appears in reads with `done` present  
9. Validation — missing `noteId` → 400; non-existent noteId → 404  
10. Subject isolation — Biology note blocked for a Mathematics/Physics/Chemistry student → 403  
11. Account isolation — student B's reads are empty after student A's POSTs  

---

## Files Modified

| File | Change |
|---|---|
| `server/server.js` | `GET` + `POST /api/me/reading` routes |
| `js/api.js` | `getMyReading()` + `recordReading()` in mock, http, delegate layers |
| `index.html` | `#study` section rewritten; `#dbPops` global layer added |
| `css/styles.css` | Popover fix (`position:fixed`); full Study Hub CSS block |
| `js/app.js` | Study Hub JS module; avatar sync; `openNote()` progress call; IntersectionObserver completion; `go('study')` trigger |
| `js/onboarding.js` | Tour steps updated for Study Hub redesign |
| `sw.js` | Cache version `goc-v227` → `goc-v228` |
| `test/test-free2027-ui.js` | SW version assertion updated |
| `test/test-reading-progress.js` | New — 31 tests for `noteReads` routes |

---

## Workflow

> **Claude implements → ChatGPT reviews → Ernest approves → next design phase begins.**
