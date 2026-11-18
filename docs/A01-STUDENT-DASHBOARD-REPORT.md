# Student Home Dashboard (A01) — delivery report

Branch `arena/1f98403a-goc-academy-hub`, based on `950c276`, on top of round 5 (`eac9919`).
Working tree only: **nothing in this round has been committed, deployed or merged.**

Scope as instructed: A01 only. No other screen was redesigned, no new screen was invented,
no record, collection or stored file was touched, no schema changed, and the JAMB CBT engine,
results, attempts, practice history, question bank, auth and permissions are untouched.

---

## 1. Files changed

| File | Change |
|---|---|
| `js/goc-core.js` | **+197** — the A01 rules block (`dashGreeting`, `dashFirstName`, `dashInitials`, `dashScholarTitle` + `DASH_TITLE_BANDS`, `dashNum`, `dashMetrics`, `dashContinue`, `dashStudyPlan`), 10 new exports. Shared with the server, so no side owns a second copy of the rules. |
| `index.html` | **+430 / −127** — `#home` rebuilt as the A01 composition (desktop header, mobile header, welcome banner, three metrics, Continue Learning + My Study Plan, Quick Access, Announcements), and `#tabbar` rebuilt as the approved 14-entry sidebar with five `.tab-m` primary tabs. Every hook the rest of the app already used (`#tut-hero`, `#dashBroadcasts*`, `#dashNotices*`, `#dashStand`, `#dashLast`, `#dashJourney`, `#idStrip`, `#dashWindow`, `#tut-jump`) is kept. |
| `js/app.js` | **+262** — the dashboard painters and `dashLoad()` (`dashPaintIdentity`, `dashPaintMetrics`, `dashPaintContinue`/`dashContinueGo`, `dashPaintPlan`, `dashPaintAnnounce`, `dashPaintWindow`) plus `dashJambGo`/`dashPlanGo`/`dashSupportGo`; `renderDash()` now calls `dashLoad()`; `paintStudyWindow()` repaints the plan and window panels; `updateFocus()` made null-safe against the retired `#tut-focus` ring; `setScreen`'s tab map rewritten for the new nav. |
| `css/styles.css` | **+402** — the A01 composition mobile-first, then the app's own 900px breakpoint for desktop, and the sidebar/bottom-bar rules. |
| `test/test-home-dashboard.js` | **new** — 51 checks (see §5). |
| `test/run.js` | registers the new suite. |
| `test/test-p3.js`, `test/test-study-window.js` | updated where they asserted on markup this round legitimately replaced (see §6). |
| `docs/stud-dash-desktop.png`, `docs/stud-dash-tablet.png`, `docs/stud-dash-mobile.png` | the screenshots in §7. |

`server/data.json` is not tracked and is not in this change.

## 2. Components created / reused

**Created** — only what the reference shows and nothing existed for: the page header, the
compact phone header, the welcome banner with its inline SVG open-book-and-cap art, the three
metric cards, Continue Learning, My Study Plan (bar + goals), the four Quick Access tiles, the
one-line Announcements strip, and the sidebar brand block.

**Reused** — the app shell and `.screen` router (`go`), the login/session and `role`/`previewing`
gates, `applyIdentity`'s existing identity hooks, the tier/feature engine, the study-window state
(`state.used`, `state.studyLeftSec`), the planner engine (`planDayProgress`, `planDayKey`,
`planDayIndex`), `openPractice`, `openStudySet`, `openWebTest`, `openPastQuestions`,
`openResults`, `openReading`, the old dashboard's detailed panels (position, last result,
journey, full notices/broadcasts with Show more), `esc`/`toast`/`go`, and the tutorial shell.

The old dashboard was not deleted: its detailed panels moved below the new summary, so no
information a student had before was taken away.

## 3. Data sources / APIs connected

Everything is read from the signed-in account. No name, greeting, level, XP, streak,
performance figure, subject, lesson, plan percentage or announcement is hardcoded.

| Panel | Source |
|---|---|
| Greeting, first name, initials, full name | `GET /api/me` → `name` (via the engine's `dashGreeting(hour)`, `dashFirstName`, `dashInitials`) |
| Academy XP | `GET /api/me` → `xp`, `level`, `xpIntoLevel`, `xpPerLevel` |
| Study Streak | `GET /api/me` → `streak` |
| Overall Performance | `GET /api/me` → `performance` / `performanceDetail` (`hasData`, `markedAttempts`) — a dash and an honest line when no paper has been marked |
| Level badge + title | `GET /api/me` → `level`, mapped through `dashScholarTitle` |
| Continue Learning | `GET /api/me/practice` → `runs` (`resume`, `done`, `subject`, `topics`); three honest outcomes, then the first step |
| My Study Plan | the planner engine over this account's blocks + `state.used` / `GET /api/me/study` minutes |
| Announcements | `GET /api/me/notices` + `GET /api/me/broadcasts`, whichever the academy sent |
| Study window detail | `GET /api/me/study` → the same numbers the timer uses |

Loading, empty and failure states are per panel: a service that is down blanks its own card with
a sentence, never the whole screen. Each request is sequential off `/api/me` so a slow endpoint
cannot hold the rest of the page.

**Destinations are all existing screens:** Continue Learning → `openStudySet('practice', subject)`
falling back to `openPractice()`; My Study Plan → `go('classes')` (the retained Study Plan
destination); JAMB CBT → `openWebTest()`; Question Bank → `openPastQuestions()`; Support → the
public homepage's `#contact`. No new screen, no dead-end tile.

## 4. Responsive details

- **Mobile (< 900px, the app's existing phone frame).** Compact header (menu, brand, bell,
  avatar), compact banner with the level badge top-right, three compact metric cards in one row,
  Continue Learning, My Study Plan with a chevron, Quick Access with "View All", the
  Announcements card, then the detailed panels, and the five-tab bottom bar
  (Home · Study · Practice · Results · More). The desktop composition is never shrunk into this.
- **Desktop (≥ 900px).** Fixed 256px sidebar with the approved entries, page header with the
  notification bell and the student's name/avatar/chevron, full-width red banner with the level
  badge in its right column, the three metrics across one row, Continue Learning and My Study
  Plan side by side, Quick Access as four tiles with their descriptions, then Announcements and
  the retained detail panels in a centred reading column.
- **Between them (600–899px).** The dashboard stays in the phone composition *inside the app's
  own phone frame*. A viewport breakpoint was tried and rejected: at 834px it squeezed the two
  cards and three metrics into a 430px frame and read as broken (see §6). At ≥ 900px the app is
  a full-width web layout and the dashboard expands with it. So the three ranges are 390 / 834 /
  1440 as captured in §7.

## 5. Tests executed and actual results

`node test/run.js` over **212** suites, run on Node v22.22.3 in this checkout:

```
201 passed, 4 failed
```

The four failures are **exactly the documented baseline set**, unchanged from base `950c276`
(compared as a set, not by count):

- `test-free2027-local.js`
- `test-production-persistence.js`
- `test-backup-integrity.js`
- `test-migration-api-config.js`

New suite `test/test-home-dashboard.js` — **51 passed, 0 failed**, covering: the approved sidebar
order and the fact that every entry it names is a screen `go()` can actually show; Study Plan no
longer being its own entry; the standalone Timetable screen and any video screen still being
gone; exactly five `.tab-m` tabs (Home/Study/Practice/Results/More); a brand-new account showing
its own name and initials with **dashes, not zeros**, for XP/streak/performance/plan, and the
reason under each; Continue Learning starting at the first step and, after a real practice run is
recorded, naming that subject and topic and offering to continue; the Announcements strip
appearing for an account that was sent one and hiding again when it was not; the study-window
panel reading the server's numbers; all four destinations landing on existing screens; and the
engine's greeting, initials, metric formatting and plan-percentage rules.

Four existing suites were updated only where they asserted on markup this round replaced —
`test-p9` (null-safe `updateFocus`), `test-p4` (the "Read / Learn" label), `test-p3` (the Study
screen no longer offers a Web Test tile; the engine and Results/Review remain), and
`test-study-window` (the focus ring ids gave way to `state.studyLeftSec` plus checks on
`#dashWindow`). Every one of them passes.

**Verified in a real browser, not asserted from code.** All three screenshots in §7 are Chromium
renders of the running app against a live signed-in account, and the values on them were read
back from the DOM: `Ernest 👋` / `Good morning,` / `2,480 XP · Level 16 · Distinction Scholar` /
`12 Days` / `78% · Across 1 marked paper` / `Mathematics – Quadratic Equations, Indices` /
`Continue Studying` / announcements line present / five visible tabs below 900px and fifteen at
1440px.

## 6. Discrepancies from the reference

1. **No persisted study plan exists yet.** The dashboard reads the planner's blocks for the
   account; with none stored it says "No plan for today yet — build your week on the Study Plan
   page" instead of showing the mockup's illustrative 65%. This is the honest-empty rule, not a
   missing wire, and it will fill in by itself once a plan is stored.
2. **Three reference labels map onto existing screens** rather than the screens of those names:
   "Question Bank" → past-paper questions (the hub has no question-search screen), "Support" →
   the public homepage's contact block, "Examinations" → the existing Test hub. No new screens
   were built for them.
3. **The phone bar shows five of the fourteen destinations.** That is the approved mobile
   composition; the other nine are one tap away behind **More**, and all fourteen are in the
   desktop sidebar.
4. **Wall-clock state, not a design choice:** the greeting reads "Good morning" because the
   capture ran at 05:44 UTC, and the account's own numbers (`2,480 XP`, `12 days`, `78%`, one
   notice) come from a seeded test student on the local server, not from production data.
5. **Emoji.** This sandbox has no system emoji font, so the 👋 the app already renders would
   capture as a tofu box. The screenshot harness injects a Noto Emoji font *for the capture
   only*; the application is unchanged. On any real device the system font supplies it.
6. **The tutorial overlay still describes the previous dashboard** (it anchors on the retired
   `#tut-focus` ring and uses the old nav wording). It still runs and can be skipped, and the
   null-safe `updateFocus` means it can no longer throw, but its copy is stale. The tutorial's
   own redesign was not in scope for A01 and is left for a follow-up.
7. **Two defects found by the browser pass and fixed in this round** (they were not visible from
   reading the code): the Announcements card rendered even when empty, because `display:flex`
   beat the `hidden` attribute — it now has an explicit `[hidden]{display:none}` rule, verified
   by probing the computed style in the browser; and the dashboard's 600px breakpoint was
   reshaping the app's fixed 430px phone frame at tablet widths, which the 834px capture showed
   as a cramped single column — it now switches at the app's own 900px breakpoint.

## 7. Screenshots

| | File |
|---|---|
| Desktop 1440 × 1000 | `docs/stud-dash-desktop.png` |
| Tablet 834 × 1112 | `docs/stud-dash-tablet.png` |
| Mobile 390 × 844 | `docs/stud-dash-mobile.png` |

Captured with headless Chromium (119) driving the running app over CDP. Getting a browser in
this sandbox took some work — `playwright install` cannot download here, so the build ships in
`@sparticuz/chromium`, whose bundled libraries lack NSPR; NSPR 4.35 was built from source
(`mozilla/nspr`) and supplied through `LD_LIBRARY_PATH` alongside the bundled NSS. Chromium then
runs headless with a CDP endpoint that `playwright-core` drives.

**Visual approval is not claimed.** The screenshots show what was built; the comparison against
the mockup, and the decision to accept it, are yours.
