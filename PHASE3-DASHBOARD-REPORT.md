# PHASE 3 — STUDENT HOME DASHBOARD: IMPLEMENTATION REPORT

**Project:** G.O.C Academy Hub · **Date:** 18 November 2026
**Implementer:** Claude · **Design and review:** ChatGPT · **Approval:** Ernest

**Branch:** `clean-sweep` (local only; nothing pushed, merged or deployed)

| | Commit |
|---|---|
| Starting commit | `0a11c8b` docs: add FINAL-PROJECT-CLEANUP-REPORT.md |
| Implementation | `37688fa` Phase 3: Student Home Dashboard (desktop, tablet, mobile) |
| Final commit | the commit that adds this report (see `git log -1`) |

**Design reference:** `Red and Cream Student Dashboard Mockups.png` (desktop and mobile).

---

## 1. Summary

The student Home screen was rebuilt to the reference at desktop, tablet and phone widths. The student navigation was reshaped to match:
- **Desktop:** a sidebar.
- **Phone:** a five-item bottom bar plus a full menu sheet.

Every name, figure and message comes from the signed-in account through the existing API. Nothing from the reference image is hard-coded. A new student sees honest empty states:
- 0 XP and 0 Days;
- "Not assessed yet" for performance;
- "You have not finished a practice run yet";
- "No announcements from the academy yet";
- My Study Plan marked Coming soon.

No retired feature returned. The JAMB CBT stays dormant. No stored record, schema or API changed.

### Owner decisions taken before building (Ernest, 18 Nov)

| Question | Decision applied |
|---|---|
| JAMB CBT, which is dormant | Shown in the sidebar and Quick Access as **Not open yet**. It cannot be opened. |
| Question Bank, Study Plan, Support, Settings, which have no student screen | Shown as **Coming soon**. They cannot be opened. |
| Old Home panels the reference does not have | **Folded in:** class notices and academy broadcasts moved into the bell, and study-window minutes moved into the banner. The level journey path, Scholar ID card, league standing and last result left Home. |
| Announcements source | **Academy broadcasts** (the newest one). "View" opens the full list. |

## 2. Files created, modified and removed

**Created**
- `test/test-student-dashboard.js`: 54 checks, registered in `test/run.js`.
- `PHASE3-DASHBOARD-REPORT.md`: this report.

**Modified**

| File | Change |
|---|---|
| `index.html` | New `#home` markup (desktop header, phone top bar, banner, statistics, learning cards, Quick Access, Announcements, notifications panel, account menu). New student navigation (`#tabbar`) and menu sheet (`#navSheet`). An icon sprite (`<symbol id="i-…">`). |
| `css/styles.css` | Phase 3 block: design tokens; phone, tablet (≥640px) and desktop (≥900px, 900–1199px, short-height) layouts. 99 selectors and 10 keyframes of the retired Home panels removed. A one-line fix so the closed homepage drawer no longer casts a shadow onto phone screens. |
| `js/app.js` | New dashboard module (`dbPaintPerformance`, `dbPaintContinue`, `dbNotifRefresh`, `dbPaintAnnounce`, `dbPopShow/Close`, `navSheetOpen/Close`, `dbReset`). `renderDash` now paints the new sections. `refreshMe` writes "Level N" and "N Days". `applyIdentity` fills the header name and initial. `go()` closes panels and has a new tab map. `updateFocus` is null-safe. `copyId` no longer reads the retired Home ID card. The journey path, `dashPaintStanding`, `dashPaintLast`, `dashSet` and `dashStat` were removed. |
| `js/onboarding.js` | The four Home steps of the student tour now point at the new sections. |
| `sw.js` | Cache `goc-v226` → `goc-v227`. |
| `readme.md`, `DEPLOY-CHECKLIST.md` | Phase 3 section; cache version. |
| `test/*` (12 suites, plus `test/run.js`) | `test-dashboard-command`, `test-p1`, `test-p3`, `test-broadcast-card`, `test-notices-ui`, `test-onboarding-student` and `test-jamb-dashboard` updated to the new contract, keeping each check's intent. Five suites updated for the cache pin only. |

**Removed:** no files.

## 3. Routes and components changed

- **Screen routes:** no new screen. Home is still `go('home')`.
  - The new navigation opens only screens that already exist: `home`, `study`, `openPractice()` (→ `studySet`), `openResults()` (→ `results`), `resources`, `league`, `profile`, and `logout()`.
  - `go()`'s highlight map now marks the matching sidebar item on sub-screens (practice set-up and runner → Practice; results → Results; resources → Resources; reading, bookmarks, mistakes, review → Study).
- **Server and API routes:** none added, changed or removed.
- **Components:**

| Component | Notes |
|---|---|
| Banner (`.db-banner`) | |
| Statistic cards (`.db-stat`) | |
| Learning cards (`.db-card`) | |
| Quick Access tiles (`.db-q`) | |
| Announcement bar (`.db-ann`) | |
| Popovers (`.db-pop`: notifications and account menu) | |
| Student navigation (`.tabbar`) | Shared by every student screen. |
| Menu sheet (`.nav-sheet`) | Built from the sidebar's own items, so the two lists cannot drift apart. |

## 4. Data sources per section

| Section | Source (existing) | Shown when there is no data or the read fails |
|---|---|---|
| Name, initial, header name | `GOC.api.login` → `applyIdentity(user)` | "Loading…", then the account name |
| Greeting | The device's local clock (`greetingWord()`, unchanged) | — |
| Scholar level | `GOC.api.myProfile()` → `me.level` (`core.levelFor`) | "Level —" |
| Study-window minutes | `getMySettings` / study-time ping → `updateFocus()` (unchanged logic) | "—" |
| Academy XP | `myProfile()` → `me.xp` | "—" |
| Study Streak | `myProfile()` → `me.streak` | "—", then "0 Days" |
| Overall Performance | `GOC.api.league()` → `me.performance` for an assessed scholar, formatted by `lgPct` (the figure the League screen shows) | "—" with "Not assessed yet", or "Unavailable right now" |
| Continue Learning | Practice history: `pracHistCache` / `GOC.api.listPractice()` (with the offline mirror). Newest run's subject plus its most frequent topic; resumes with `openStudySet('practice', subject)`. | "You have not finished a practice run yet…", with **Start Practising** opening the Practice set-up |
| My Study Plan | None: no Study Plan data or API exists yet | "Coming soon" with an empty bar; **View Plan** is not a link |
| Quick Access | Practice → `openPractice()`; Resources → `go('resources')` | JAMB CBT: Not open yet. Question Bank: Coming soon. |
| Announcements | `GOC.api.listMyBroadcasts()`, newest by `at` | "No announcements from the academy yet." / "could not be loaded" |
| Notifications (bell) | `listMyBroadcasts()` plus `listMyNotices()`; existing renderers restyled | "You have no notifications yet…" / "could not be loaded" |
| Unread dot | Compares each item's `at` with a per-student "last seen" time in `localStorage` (`goc.notifSeen.<ScholarID>`) | No dot |

**About the unread state:** the server keeps no read state for students. Rather than add a schema field, read state is kept on the device. As a result, it does not follow the student to another device. See §5.

## 5. Missing APIs, data fields and unresolved decisions

1. **Study Plan.**
   - There is no Study Plan screen, goal model or API, so the card shows Coming soon and no figures.
   - The planner model kept in Phase 2 (`week`, `dayBlocks`, `addStudyBlock`) has no goals or completion field.
   - The storage decision belongs to the Study Plan design stage, as the brief says.
2. **Question Bank (student), Support and Settings.**
   - None of these has a student screen. Profile holds the existing preferences, and the guided tour lives under Help & tutorial.
   - They stay Coming soon until their pages are designed.
3. **JAMB CBT.** It stays dormant and is shown as Not open yet. Opening it needs Ernest's approval and its own page.
4. **Overall Performance needs an assessed paper.**
   - With the Web Test retired and JAMB CBT dormant, a new student has no way to sit an assessed paper, so this card will read "Not assessed yet" for every new student.
   - Practice accuracy could feed it instead, but that would be a product decision.
5. **Notification read state is per device.** A server-side "seen" field would follow the student across devices. It would be the smallest safe addition if wanted, but it needs a schema change, so it was not made.
6. **"Examinations" in the reference.**
   - The desktop reference lists an Examinations item between JAMB CBT and Results. It was **not** added: it is not in the brief's navigation list, and the only feature it could open (Web Test) is retired.
   - Flagged for ChatGPT.
7. **Brand mark.** The reference shows a graduation-cap logo. The app's own registered mark (book and star, `#goc-mark`, the same as the PWA icons) was kept, so the brand identity did not change silently. Flagged for ChatGPT and Ernest.
8. **"Independent Scholar" under the level.**
   - This is the academy's tagline ("Independent Scholars"), shown as a fixed label, as in the reference.
   - It is not a level title: the app has no level names. Only the number comes from the account.
9. **Typeface.** The app ships no web fonts and loads nothing from the internet, so the dashboard uses the existing system font stack at heavier weights. The reference's rounded display face would need a bundled font file.
10. **Earlier clean-sweep corrections.**
    - The direct tutor-to-Question-Bank change and the unused-file and dependency audit were implemented in the final cleanup (commits `c9c9a00` and `a382253`, report `FINAL-PROJECT-CLEANUP-REPORT.md`).
    - They are **awaiting ChatGPT's review and Ernest's approval**. This stage does not mark them approved.
    - Neither affects the dashboard, except that Question Bank stays Coming soon on the student side.

## 6. Tests and checks run (actual results)

| Check | Result |
|---|---|
| `node test/run.js` (222 suites) | **217 passed, 5 failed.** The 5 are the same suites that fail on the untouched baseline: `test-backup-integrity`, `test-free2027-local`, `test-migration-api-config`, `test-production-persistence` and `test-student-notes`. They need `node-appwrite`, `busboy` or `esbuild`, which cannot be installed here (package installs are blocked in this environment). **No new failures.** |
| Individual checks (same counting as earlier reports) | 9,247 passed / 63 failed / 8 skipped. Before Phase 3: 9,193 / 63 / 8. |
| New `test-student-dashboard.js` | 54 / 54 passed |
| `node --check` on every JS file (app, server, build, service worker) | All pass |
| Duplicate element IDs in `index.html` | None |
| `node build/build.js` (production build) | **Not run.** It requires `esbuild`, which is not installed and cannot be installed here. Run `npm ci && npm run build` with registry access. |
| Type checking and linting | The project has neither. |
| Real-browser click-through (headless Chrome, demo data driver) | Desktop 1440px: 21/21. Phone 390px: 18/18. Tablet 768px: 17/17, plus 1 skipped by design. Results below. |
| Horizontal overflow (headless Chrome) | None at 500, 600, 640, 768, 899, 900, 1024, 1280, 1440 and 1920px (`scrollWidth == clientWidth`). 320, 360, 390 and 414px were checked visually from screenshots, because the headless DOM dump cannot go below 500px. |
| Console errors during the click-through | None at any width. |

What the click-through verified:
- Continue Studying opens the practice set-up for the last subject (Mathematics).
- Quick Access Practice and Resources open their screens.
- The JAMB CBT tile does nothing.
- Announcements → View opens the academy messages.
- The bell opens notifications and clears the unread dot; Escape closes the panel.
- The account menu shows Profile and Log out, and Profile opens.
- Every sidebar item opens its screen (Study, Practice, Results, Resources, League, Profile).
- All five not-open items do nothing.
- On phones, the bottom bar's Study, Practice and Results work, and More opens all 13 items.
- In the menu sheet, League navigates and closes the sheet, and Question Bank does nothing.
- Escape closes the sheet.
- View All works on phones; it is hidden on tablets by design.
- Log out returns to the homepage and blanks the header name.

**How the screenshots and click-through were produced:** the in-memory demo driver ran in headless Chrome. A preview-only helper signed in as the demo founder, enrolled one demo student, sent one academy broadcast and completed one practice run, all through the app's own `GOC.api` calls. The XP, streak and Continue Learning shown are what the app computed from that run. None of this code is in the project.

## 7. Screenshots

Supplied alongside this report (`phase3-screenshots/` in the ZIP):

| File | Shows |
|---|---|
| `01-desktop-1440.png` | Desktop at the reference proportions, with activity |
| `02-desktop-1280.png` | Laptop |
| `03-desktop-1024.png` | Small desktop (intermediate breakpoint) |
| `04-tablet-768.png` | Tablet |
| `05-mobile-390.png` | Phone at the reference's width |
| `06-mobile-360.png` | Small phone |
| `07-desktop-1440-new-student.png` | Honest empty states, desktop |
| `08-mobile-390-new-student.png` | Honest empty states, phone |
| `09-desktop-notifications.png` | Bell panel |
| `10-mobile-menu-sheet.png` | More / menu sheet |
| `11-mobile-account-menu.png` | Account menu |

## 8. Known limitations

- The production build and the 5 dependency-bound suites were not run (no package registry here).
- Not tested on real devices or in Safari or Firefox. Only Chromium (headless) was used.
- Headless Chrome freezes the existing entrance animation, so screenshots were taken with reduced motion. Real browsers animate normally.
- The menu sheet is a new small component, written because the existing homepage drawer is tied to the public homepage. It reuses that drawer's focus-trap and Escape pattern.
- When there are many notifications, the panel scrolls at 70% of the viewport height.
- Pre-existing and out of scope, left untouched:
  - the Read / Learn (`reading`) and My Notes screens still have no student entry, as in the original import;
  - the public Updates & News page is not linked from the dashboard (Announcements uses academy broadcasts, by decision).

## 9. Feature-selection protection

All of these were checked by `test-student-dashboard.js`, `test-dashboard-command.js` and `test-jamb-dashboard.js`:
- No Next Activity, Guardian PIN or study-time extension.
- No Timetable, Web Test, Objective or Theory entry.
- No video library.
- No Open Students, tiers or tier switching.
- No Examinations entry.
- No live JAMB CBT entry.

The Study, Practice, Results, Resources, League and Profile screens keep their existing layouts. Only the shared navigation around them changed. No tutor, admin or Free UTME 2027 file was touched.

**Stopping here for ChatGPT's review against the reference and Ernest's approval. The next page has not been started.**
