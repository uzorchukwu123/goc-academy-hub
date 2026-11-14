# G.O.C Academy Hub — comprehensive improvements inspection (Workstream B)

**Status: inspection and planning only. No planned improvement has been
implemented.** The only code changed in this work is Workstream A (maintenance
mode), reported separately in `WORKSTREAM-A-REPORT.md` and documented in
`MAINTENANCE-MODE.md`.

Date of inspection: 14 November 2026.

---

## 0. Baseline — read this first

Two different snapshots exist in this clone, and the difference matters:

| Snapshot | Commit | Contains |
| --- | --- | --- |
| This session's branch | `90a1e85` — *Stage B: application-first registration* | The Stage B registration system (codes, applications, approval, setup links), 211/212 suites, the older homepage (**no** tier cards) |
| `origin/main` (PR #15 merged) | `17cc20f` — *Merge pull request #15* | The tier system (Open/GOC), **“Two ways in”**, `test-tiers-*`, 228 suites, but **not** Stage B registration |

`git merge-base` finds **no common ancestor** between the two; they are
unrelated histories with overlapping trees. That is a repository problem, not a
feature problem:

- The requirements below were written against **`origin/main`** — “Two ways in”
  and “Ready to study with purpose?” exist only there. All page/structure
  findings below are therefore verified against the `origin/main` tree (read via
  `git archive origin/main`), and labelled **main** where they differ from this
  branch.
- Everything shared by both snapshots (dashboard, Study hub, practice, Web Test,
  reminders, streak freeze, tutorial, notes, bookmarks, demo preview, service
  worker) was verified on this branch and cross-checked in main.
- **Do not start implementation until the two histories are reconciled** (see
  §22). Any improvement branch must start from one combined baseline, or the
  Stage B registration work and the tier work will silently undo each other.

What was actually examined: `server/server.js` (all routes), `server/lib/*`,
`functions/goc-api/*`, `js/app.js`, `js/api.js`, `js/goc-core.js`,
`js/onboarding.js`, `js/pwa.js`, `index.html`, `css/styles.css`,
`css/free2027.css`, `sw.js`, the test suite and deployment docs. Nothing below
was inferred from a component name alone.

---

## 1. Requirement 9A — mobile homepage navigation

### Current implementation (main and this branch)
- A hamburger (`<button class="lp-burger" id="lpBurger" onclick="openDrawer()">`)
  sits in `.lp-nav` and opens a **full-height slide-out drawer**
  (`<aside class="lp-drawer" id="lpDrawer">`) with a scrim (`#lpScrim`), brand,
  motto, six section links, Updates & News (with badge), a CBT Portal button, a
  Create-account button, Log in and contact links.
- Close handlers: `#lpScrim` click, `×` button, section click, Edge-drag
  gesture (`touchstart/move/end` on the landing screen).
- Breakpoints: under 900 px the inline `.lp-link` items are hidden and the
  drawer carries them; at ≥ 900 px `.lp-burger`, `.lp-drawer` and `.lp-scrim`
  are `display:none` and the inline links return.
- Accessibility today: `aria-controls`, `aria-expanded` maintained by JS,
  `aria-hidden` toggled, Escape not handled, no focus move, gesture-only path
  has no keyboard equivalent (the burger is the equivalent).

### Exact files
| File | What |
| --- | --- |
| `index.html` | `.lp-nav` (main lines ~79–101); drawer markup with `#lpDrawer` (main ~2220–2254); section ids `#lpFeatures`, `#lpSubjects`, `#lpTiers`, `#lpHow`, `#lpTry`, `#contact` |
| `js/app.js` | `drawerEls`, `openDrawer`, `closeDrawer`, `dwGo`, `dwGoTo`, edge-drag IIFE (`js/app.js` ~464–545 in this branch; ~500–570 in main) |
| `css/styles.css` | `#landing`, `.lp-nav`, `.lp-burger`, `.lp-scrim`, `.lp-drawer`, `.dw-*`, mobile rules (~738–770), desktop rules (~1058–1062) |
| `css/free2027.css` | Mode-scoped visibility that names **`#lpDrawer`** and `#lpBurger` selectors (~442–530) |

### Backend/routes/Appwrite
None — pure public-page UI. No API, no collection.

### Existing tests
`test/test-homepage-news.js` (nav labels and destinations, hero CTA),
`test/test-free2027-nav.js` (mode-scoped `#lpDrawer` button hiding),
`test/test/browser/free2027-recovery.js` (opens `#lpBurger`, asserts drawer
visible, clicks links, checks `aria-hidden`), `test/test-landing-layout.js`
(hero/logo height), `test/test-landing-motion*.js`.

### Missing tests
No assertion on the drawer’s geometry/presentation, Escape/outside-click,
focus order, or dropdown behaviour. No mobile screenshot test in CI.

### Recommended implementation
Keep **the ids and JS entry points** (`#lpBurger`, `#lpDrawer`, `openDrawer()`,
`closeDrawer()`, `dwGoTo()`) so the Free UTME 2027 mode CSS and every existing
test keep working, and change only the presentation and interaction:

1. `.lp-drawer` becomes an anchored dropdown: `position:absolute; top:calc(100% + 8px); left:12px; right:12px; width:auto; max-width:380px; height:auto; max-height:min(70dvh, 520px); overflow-y:auto; border-radius:18px; transform:translateY(-8px); opacity:0; visibility:hidden`, `.on` → `translateY(0); opacity:1; visibility:visible`. Keep it inside `#landing` so it scrolls with the page/nav as today.
2. Remove the full-height height/scrim behaviour or keep a very light scrim; the brief asks for a **compact dropdown**, so drop the edge-drag gesture and the scrim (or make the scrim transparent and non-blocking). If the scrim is removed, outside-click closes.
3. Add `Escape` to close and return focus to the burger; keep `aria-expanded`; add `role="menu"` semantics only if every child is a `menuitem` (otherwise keep a plain `<nav>` with buttons — recommended).
4. Use `max-height` + internal scroll so six links + two CTAs fit a 360×640 phone; keep `--goc-navh` scroll offset correct for `dwGoTo`.
5. Desktop CSS unchanged (`display:none` at ≥900 px).

**Dependencies:** 9D (section ids must survive reordering), Free UTME 2027 mode
CSS, the drawer’s account/CBT buttons, and the homepage tests. **Complexity:**
S–M (CSS + ~30 lines JS + tests). **Do not** rename `#lpDrawer`/`#lpBurger`
without updating `css/free2027.css` and three test files.

---

## 2. Requirement 9B — remove “Two Ways In” and its Create Account presentation

### Current implementation (main only)
`index.html` `#lpTiers` (main ~209–240) is literally the section the brief
names:

- eyebrow **“Two ways in”**;
- `<h2>Open or GOC? See what you get</h2>`;
- `#tierCompareLanding` with an **Open** card and a **GOC** card;
- `.tc-note` explaining that signing up creates an Open account and GOC means
  asking the academy;
- `.tc-cta` → **“Create account”** button (`go('signup')`).

The **sign-up screen** has its own collapsed `<details class="tier-compare"
id="tierCompare">` panel with the same Open/GOC wording (`index.html` ~731).
The actual registration functionality for the current process is the Stage B
application form (`#signup` in this branch; `#signup` + tier panel in main) and
`POST /api/registrations` — not this landing block.

### Dependencies before removal
| Dependency | Detail |
| --- | --- |
| `test/test-tiers-signup.js` | Eight landing-specific checks read `#lpTiers` and compare the landing cards/note verbatim with the sign-up panel; they will fail if the block is removed and must be rewritten to assert only the sign-up panel + that the landing reference is gone. |
| `test/test-homepage-news.js` | Asserts `id="lpTiers"` exists (“existing sections survive”) and that the top nav offers “Programmes” with `dwGoTo('lpTiers')`. Both must change (destination or nav item). |
| `css/free2027.css` | Hides hub sign-up buttons in Free Tutorial Mode using `#landing button[onclick="go('signup')"]` — this selector also matches the `.tc-cta` button. Removing the block removes one match; the rule should then be narrowed so it cannot accidentally hide unrelated sign-up entry points. |
| Navigation | `#lpDrawer` “Programmes” and desktop “Programmes” buttons scroll to `#lpTiers`. Removing the section leaves two dead links unless they are repointed to `#lpSubjects`/`#lpHow` or removed. |
| `js/app.js` | Landing motion selectors do not reference `#lpTiers`, so animation is unaffected. |

### Recommended implementation
- Remove **only the landing `#lpTiers` block** (including its Create account
  CTA and note). Keep the sign-up screen’s collapsed Open/GOC panel, the
  `#signup` screen and every registration route untouched.
- Repoint “Programmes” to `#lpSubjects` (or to `#lpHow`) and update the two
  tests above; add a test that the landing no longer contains “Two ways in”.
- If the academy still wants the Open/GOC explanation on the landing, the
  alternative is to keep a single sentence under “Programme” without the
  Create-account CTA — this needs an owner decision because it changes the
  brief.

**Complexity:** S. **Risk:** medium only because of the tier-copy tests; no
data or API risk. **Dependency:** 9D ordering; 10/11 do not depend on it.

---

## 3. Requirement 9C — move the Try G.O.C button and centre it

### Current implementation (main)
- `#lpTry` section at `index.html` ~374–381 with eyebrow “Try G.O.C”, heading,
  lead, a `button.lp-cta.lp-try-btn` → `demoOpen()`, and `.lp-try-note`.
- CSS `.lp-try{ text-align:left }`, `.lp-try-btn{ margin-top:14px }`
  (`css/styles.css` ~3476–3479) — so its CTA is currently **left-aligned**.
- The **Parents, schools & partners** section (`#lpParents`, main ~334–339) has
  a duplicate `button.lp-btn-light` “Try the free preview” → `dwGoTo('lpTry')`.
- The hero (main ~121) and the nav (main ~97) also offer “Try a free practice
  session” / “Try GOC free”. The brief only asks to remove the **Parents**
  placement and move that action into `#lpTry`, centred.

### Recommended implementation
- Delete the “Try the free preview” button from `#lpParents`; keep “Contact the
  academy” there.
- Keep the existing `#lpTry` CTA (it already calls `demoOpen()`); centre the
  section’s CTA: `.lp-try{ text-align:center }`,
  `.lp-try-btn{ margin:14px auto 0; min-width:240px }`, keep the note centred
  and readable (`max-width:56ch; margin-left:auto; margin-right:auto`).
- Do not add a second CTA to `#lpTry` (one button only). If the brief means the
  hero/nav button should be removed too, that is a separate owner decision; it
  is not what “remove its previous placement from the Parents … section” says.
- Keep the hero/nav entries: they are the primary public route into the
  preview, and `test/test-homepage-news.js` asserts both.

**Tests:** `test/test-homepage-news.js` (hero CTA, Try section), plus a new
assertion that `#lpParents` no longer contains `dwGoTo('lpTry')`.
**Complexity:** S.

---

## 4. Requirement 9D — homepage section order

### Current order (main, from the top of `#landing`)
1. `.lp-hero` (hero)
2. `.lp-logos` (delivery channels) and `.lp-stats`
3. `#lpFeatures` — About G.O.C (“Three parts working as one”)
4. `#lpSubjects` — “What you’ll master”
5. `#lpTiers` — **Two ways in / Open or GOC** (to be removed per 9B)
6. `#lpHow` — Independent Scholars System
7. `#lpScholarship` — hidden banner, revealed by `scholBannerInit()`
8. `#lpStage` — the academy promise quote
9. `#lpParents`
10. `#contact` — Get in touch
11. `#lpTry` — Try G.O.C
12. `#lpNewsIntro` — Stay informed
13. `.lp-band` — “Ready to study with purpose?” + Create free account
14. `.lp-foot`

### Requested order
1 hero → 2 about/intro (features, subjects, logos/stats) → 3 programme and
learning (`#lpHow`, scholarship, stage; tiers only if 9B keeps a version) → 4
**Ready to Study with Excellence** (`.lp-band`) → 5 **Stay Informed**
(`#lpNewsIntro`) → 6 Parents (`#lpParents`) → 7 Try G.O.C (`#lpTry`) → 8 Get in
touch (`#contact`) → footer.

### Dependencies
- **IDs and handlers:** `dwGoTo('lpFeatures'|'lpSubjects'|'lpTiers'|'lpHow'|'lpTry'|'contact')`, `scrollToContact()`, `#lpSchBtn`, `#lpNewsList` (`renderUpdates`), `scholBannerInit()`, landing motion observers (`js/app.js` `initLandingMotion` selectors at ~1839 and contact/feature observers ~2098–2140).
- **Free UTME 2027 mode CSS** hides/shows landing CTAs by selector, not position — safe under reordering.
- **Alternating `.alt` backgrounds:** currently `#lpSubjects` and `#contact`; after reordering, check visual alternation (give `#lpParents` or `#lpTry` the `alt` class if needed).
- **Sticky nav offset:** `dwGoTo` scrolls `block:'start'`; the sticky `.lp-nav` can cover the section heading — add `scroll-margin-top` to section ids (a pre-existing polish item exposed by reordering).
- **Motion:** `test-landing-motion*.js` observe `.lp-feat`, `.hw`, `#lpStage`, `.lp-foot`; position-independent but the observers run on scroll, so verify after the move.

### Recommended implementation
Move whole blocks in `index.html` (no JS change for the order itself), then:
- update the drawer/nav “Programmes” target if `#lpTiers` is removed;
- move `.lp-band` above `#lpNewsIntro` and keep it visually distinct;
- move `#contact` after `#lpTry`;
- add `#landing .lp-sec, #landing .lp-band { scroll-margin-top: calc(var(--goc-navh,66px) + 12px) }`;
- add a new test `test-homepage-order.js` asserting `indexOf` order of the ids
  and phrases, and that `#lpTry` precedes `#contact`, etc.

**Complexity:** S. **Risk:** visual rhythm + nav anchors, caught by the new
order test and the landing-motion suites.

---

## 5. Requirement 9E — motto

`index.html` (main ~401, this branch ~388) contains:

```html
<div class="lp-band">
  <h2>Ready to study with purpose?</h2>
  ...
</div>
```

Change to exactly:

```html
<h2>Ready to Study with Excellence.</h2>
```

No CSS depends on the string. No test currently asserts it (grep across `test/`
returns nothing), so add one to the new homepage-order test. Keep the hero
headline “Raising Smart Scholars for Academic Excellence” unchanged.

**Complexity:** S.

---

## 6. Part 3/10 — student dashboard and Study-hub removals

### Scope reality check (important)
The brief says “removed from the student dashboard homepage”, but four of the
named items are **not on `#home`** in either snapshot — they are on the **Study
hub** (`#study`) or its sub-screens:

| Requested removal | Where it actually is today |
| --- | --- |
| Next Up | `#home` |
| Your Subjects | `#home` |
| Study CBT | `#home` “Carry on” quick action |
| My Notes | `#home` “Carry on” **and** `#study` tile |
| Daily Quest | `#study` card `#questCard` |
| Weekly Quest | `#study` card `#weekCard` |
| Review Due | `#study` card `#rvCard` |
| Read / Learn | `#study` tile `#sg-reading` |
| JAMB-oriented session from Web Test | `#webtest` section card + `#home` `#dashJamb` + `#study` `#sg-jamb` |
| Recorded Live Classes | `#classes` block |

**Owner decision required:** remove these from **both** home and Study, or only
from `#home`? Removing both would orphan My Notes, Read/Learn and Study CBT
(see 10.4), so my recommendation is: simplify the **home** page as asked, keep
the features reachable from the Study hub/tab (except where the brief clearly
asks to remove the tile), and only then decide whether the Study tiles also go.

### 6.1 Item-by-item map

#### Next Up
- **UI:** `index.html` `#home` → `<div class="sec-head"><div class="section-t">Next Up</div></div>` + `#dashUp` (main ~955–956).
- **JS:** `dashPaintUp`, `dashUpFromTests`, `dashUpFromReview`, `dashWeakTopic`, `dashUpPick`, `dashUpFetch`, `dashUpGo`, vars `dashUpCurrent`, `dashUpWeakPick`; called from `renderDash()` (`js/app.js` ~10158).
- **APIs:** `GET /api/me/tests`, `GET /api/me/review`, `GET /api/me/practice` (via `GOC.api.listMyTests/listReview/listPractice`).
- **Data:** `attempts` (Appwrite `attempts`), `db.practiceRuns`, `db.reviewState` (local JSON).
- **Separate route/screen:** no.
- **Feature/data or UI?** A pure recommendation engine — **UI only**. The source routes are used by Web Test/Review/Practice and must stay.
- **Tests:** `test/test-dashboard-command.js` (Next Up priority, failures, weak-topic narrowing), `test/test-onboarding-student.js` (first tour target).

#### Your Subjects
- **UI:** `#home` `#dashSubjects` + its `sec-head`.
- **JS:** `dashPaintSubjects`; called from `renderDash()`.
- **API/data:** `GET /api/me` → `mySubjects` (already loaded at login); no separate route.
- **Tests:** `test/test-dashboard-command.js` (subject list), `test/test-p6.js` (combination surfaces).
- **UI only.** Remove the card + painter; leave the Study hub/timetable subject surfaces alone.

#### Study CBT
- **UI:** `#home` “Carry on” `<button onclick="openCBT()">Study CBT</button>` (main ~980–990).
- **JS:** `openCBT()` → `openStudySet('cbt')`; `suStart` → `POST /api/me/study/start`; `#cbt` screen; submit `/api/me/study/submit`; results `#studyRes`.
- **Data:** self-study attempts/results (no academic record); `db.practiceRuns`? Practice only; CBT is `study` attempts not league attempts.
- **Tests:** `test/test-study.js`, `test/test-study-window.js`, `test/test-p3.js` (runner), `test/test-practice-navigation.js`.
- **Critical:** the **formal CBT engine** is `#cbt` + study routes; the assessed engine is `#wtRun` + `/api/me/tests/*`. Removing the shortcut must touch neither.
- **UI only**; update the tutorial step “Formal CBT set-up” (it opens `openCBT`).

#### My Notes
- **UI:** `#home` quick action + `#study` `#sg-mynotes`; screen `#mynotes`.
- **JS:** `openMyNotes`, `myNotesLoad`, upload/replace/delete handlers.
- **Routes:** `GET /api/me/mynotes`, `POST /api/me/mynotes/upload`, `GET /api/me/mynotes/:id/file`, `POST …/:id/replace`, `DELETE …/:id`.
- **Data:** Appwrite collection **`studentnotes`** + file bytes in the storage bucket (`APPWRITE_BUCKET_ID`). Metadata includes `ownerId`; every route owner-checks and 404s another student.
- **Tests:** `test/test-student-notes.js`, `test/test-note-practice.js`, `test/test-note-reader.js`.
- **UI only. Never delete the collection or files.** Removing both entry points would make the feature unreachable; propose removing the **home quick action** only, or add a Profile/Study menu entry before removing the tile.
- **Tour:** step 11 (`openMyNotes` → `myNoteUploadBtn`) and step 4 (quick shortcuts).

#### Daily Quest
- **UI:** `#study` `#questCard` + text/progress/note ids.
- **JS:** `paintQuest`, `loadQuest` (js/app.js ~9032–9058); XP bonus applied server-side in `/api/me/practice` (`questBonus`); `core.dailyQuest`.
- **API:** `GET /api/me/quest`; data `db.students[].questDay`, `db.practiceRuns`.
- **Tests:** `test/test-daily-quest.js`, `test/test-quest-route.js`, `test/test-quest-ui.js`, `test/test-quest-demo.js`, `test/test-quest-reward*.js`.
- **UI only**; the quest still computes and pays XP on practice even if hidden — decide whether the reward should remain (recommended: keep, it is part of the streak/freeze economy).

#### Weekly Quest
- **UI:** `#study` `#weekCard`.
- **JS:** `paintWeekly`; `core.weeklyQuest*`, `weeklyReward`.
- **API:** `GET /api/me/weekly-quest`; reward paid during `/api/me/practice` submit; `db.students[].weekQuest`; earns streak freezes.
- **Tests:** `test/test-weekly-quest.js`, `test/test-quest-weekly-*` (route/reward/demo/ui).
- **UI only**, but it is the advertised way to **earn** a streak freeze. Remove the card and the economy loses its visible explanation; keep a one-line link in Profile or Study.

#### Review Due
- **UI:** `#study` `#rvCard` (Start review button → `#review`).
- **JS:** `paintReviewCard`, `loadReviewCard`; `#review` screen; `POST /api/me/review` marks one answer.
- **API:** `GET /api/me/review`; data `db.reviewState`, `db.practiceRuns`, `db.attempts` (mistakes), questions bank.
- **Tests:** `test/test-spaced.js`, `test-spaced-route/demo/ui.js`, `test/test-image-review.js`, `test/test-passage-review.js`.
- **UI only**; keep the `#review` screen and API (requirement 11 protects reviews).

#### Read / Learn
- **UI:** `#study` `#sg-reading`; screen `#reading`.
- **JS:** `openReading`, `loadStudyCat`, `loadReadingNotes`, `openNote`; `GET /api/me/study` (catalogue), `GET /api/me/notes`.
- **Data:** academy notes (server data / question-notes), `studentnotes` is different.
- **Tests:** `test/test-note-reader.js`, `test/test-note-practice.js`, parts of `test/test-p3.js`.
- **UI only**; but removing the tile needs another entry to `#reading` if reading is retained.

#### JAMB-oriented session from Web Test
- **UI:** `#webtest` card rendered from `WT_SECTIONS` entry `jamb` (`js/app.js` ~9364), plus `#home` `#dashJamb` and `#study` `#sg-jamb`.
- **JS:** `renderWebTest`, `wtRowEl`, `wtConfirmStart`, `dashPaintJamb`, `dashJambSit`, `openJambTest`; runner `#cbt`-style `wtRun` with JAMB mode; `#jtResume`.
- **API:** `GET /api/me/tests` (server adds a `jamb` row only when the dedicated bank is deep enough in every subject), `POST /api/me/tests/start`, `POST /api/me/tests/submit`; data: `questions.section='jamb'`, `attempts.section='jamb'`, settings `jamb*`, performance weight `DEFAULT_WEIGHTS.jamb = 30`.
- **Tests:** `test/test-jamb-dashboard.js`, `test/test-jamb-ready*.js`, `test/test-jamb-fresh.js`, `test/test-jamb-score.js`, `test/test-jamb-cbt-experience.js`, `test/test-p3.js`.
- **This is feature-level, not just a card.** Clarify the brief: “remove the JAMB-oriented session **from Web Test**” most safely means remove the duplicate **Web Test hub card**, leaving one entry point (Study tile) and the engine, bank, admin console and league weighting intact. Deleting the section entirely would change league maths, admin screens and student records — not authorised by a UI instruction. **Owner decision + explicit scope needed.**

#### Recorded Live Classes in Classes
- **UI:** `#classes` “🔴 Recorded live classes” heading, sub-lead, `#liveList`, `#liveEmpty` (main ~2004–2009).
- **JS:** `renderClasses` splits `videos` by `v.type === 'live'`; `videoCard`, `playVideo`; `loadPublishedVideos`; `GOC.api.listVideos`, `listClasses`.
- **API/data:** `GET /api/videos` (Appwrite **`videos`**, published, type `live`), file route `/api/videos/:id/file` (bucket); upcoming live classes `GET /api/classes` (Appwrite **`liveclasses`**), not recordings.
- **Tests:** no dedicated recordings UI suite; `test/test-media-stub.js`, `test/test-p6.js`, `test/test-free2027-nav.js` touch video/class surfaces indirectly.
- **UI only**; do **not** delete videos, the collection or the replay player. The upcoming-class list and lesson videos stay.

---

## 7. Requirement 11 — Review and Saves, My Questions, Recent Practice

These are the preservation-critical features. They are **separate** from the
cards proposed for removal.

### Review & saves (`#study` “Review & saves” row)
| Control | UI | Route | Store |
| --- | --- | --- | --- |
| Saved | `#sg-bookmarks` → `#bookmarks` | `GET/POST /api/me/bookmarks`, `DELETE /api/me/bookmarks/:key` | `db.bookmarks[scholarId]` in **`server/data.json`** |
| Mistakes | `#sg-mistakes` → `#mistakes` | `GET /api/me/mistakes` | derived from `db.practiceRuns` + `attempts` |
| My questions | button → `atMyOpen()` overlay | `GET/POST /api/me/flags` | `db.flags` in `server/data.json` |

### Recent practice
- UI `#pracHist`; JS `refreshPracHistory`, `renderPracHistory`, `savePracResult`; route `GET/POST /api/me/practice`; store `db.practiceRuns[scholarId]` + `localStorage['goc.practiceHistory.<scholarId>']` mirror.

### Answers to the brief’s questions
- **Survives logout/login?** Yes, because the server keys each record by Scholar ID, not the session. The client cache is only a mirror and is reloaded with `refreshPracHistory()`.
- **Recent practice preserved?** Yes, capped by `core.studentLimits().practiceHistory` and `dropOldRuns`.
- **Reviews remain accessible?** Yes — `GET /api/me/review` reads the same mistakes.
- **Student records lost by removing cards?** No: none of these routes or collections is touched by a UI removal. The cards to remove (`#questCard`, `#weekCard`, `#rvCard`, dashboard tiles) do not own their data.
- **Data risk found:** bookmarks, practice runs, flags and review state live in **`server/data.json` even when Appwrite Database is configured for students**. On a host with an ephemeral filesystem and no `GOC_DATA_DIR` mount, they are lost on redeploy. This is a **critical data-preservation finding** and should be fixed (Appwrite collections or guaranteed persistent volume) **before** any dashboard simplification. Appwrite’s `attempts` and `studentnotes` are safe; these four are not.
- **Shared logic:** `core.capList`, `dropOldRuns`, `sanitizeBookmark`, `mergeMistakes`, `srQueue`, `flagsForStudent` are shared with demo-mode (`js/api.js`). Any change to shapes must update both drivers and `test-driver-parity.js`.

**Missing tests:** cross-device bookmark/practice persistence with an Appwrite-configured server; restart persistence when `GOC_DATA_DIR` is unset; data preservation after each UI removal (a test that asserts routes still work after the HTML no longer contains the card).

---

## 8. Requirement 12 — Daily Affirmation timing

### Current implementation
- The affirmation is the **login flyer**: `#flyerOverlay` (`index.html` ~2287 in
  main, ~2240 here), `openFlyer()` (`js/app.js` ~1398 in main, ~1434 here),
  opened **350 ms after every successful student login** (`loginSubmit` success
  path), **700 ms after a direct account creation** that returns a session, and
  manually from the Profile “Preview” button (`index.html` ~1517). It picks
  `affirmations[date % length]`, with a hard-coded fallback list in `js/app.js`
  and a server pool via `GET /api/affirmations` (`loadAffirmations`).
- The tour is independent: `renderDash()` calls
  `GOCOnboarding.maybeAutoStart('student', studentId)` after 900 ms. State is
  `localStorage['goc.tour.v2.<tour>.<userId>'] = {status, step, at}` in
  `js/onboarding.js`; `goc_tut_done_v1` is honoured as done. A finished,
  skipped or interrupted tour never auto-starts again; Help & tutorial
  (`tourRestart`) forces a replay.
- Therefore **today the affirmation appears first and the tour starts second**
  — the opposite of the requirement. There is no deployment/release version in
  the tour key, so an old completion would still suppress a new tour.

### Recommended design
1. Add a **tour release id** (one constant, e.g. `TOUR_RELEASE = '2026-11'`)
   and include it in the key: `goc.tour.v3.student.<release>.<userId>`. Old
   keys are ignored for auto-start but still readable for the “resume” label;
   bumping the release is how a redeploy re-runs the updated tour.
2. Gate the flyer: `openFlyer()` checks
   `GOCOnboarding.isCompleteForRelease('student', studentId)`. If not complete,
   do not show it now; schedule it **once** after the tour closes with status
   `done` (add an `onDone` callback/`CustomEvent` to the engine — it currently
   has none). If the student skips or exits, do not show it on that login; show
   it on the next login only after completion (otherwise it would interrupt
   exactly the student who asked not to be toured).
3. Keep it **per user, per device** (localStorage), matching the tour. Do not
   move tour state to the server unless the requirement becomes cross-device;
   that would need a student attribute/collection and a migration.
4. Do not tie this to the service-worker cache name alone: the release id must
   change when the *tour content* changes, which may be independent of asset
   caching.
5. Add `GOCOnboarding.completion(name,userId)` and version-aware tests.

**Tests:** `test/test-onboarding-student.js` (state machine) must be extended
for release keys; add `test/test-affirmation-timing.js` with a fake DOM and
clock: affirmation suppressed before completion, shown after completion once,
never repeated on refresh, shown again after a release bump. **Complexity:** M.
**Dependency:** tutorial rewrite (15) must land in the same release.

---

## 9. Requirement 13 — Study Reminders and genuine push notifications

### What exists today
- **Email only.** `server/lib/reminders.js` composes and sweeps;
  `server/server.js` wires `createReminderService` (~2597) and
  `startReminderSchedule` (30-min default interval, Lagos day/hour window,
  `GOC_REMINDERS=0` off, dry-run outbox `reminders-outbox.jsonl`).
- Preferences `GET/POST /api/me/reminders`; Profile row `paintReminders` /
  `toggleReminders`; per-student `db.reminderState` (local JSON).
- Opt-out token `GET /api/unsubscribe` (no login required).
- SMTP via `nodemailer`; **SMS is a stub** (`sendSmsStub`).
- Broadcast emails use the same reminder service (`broadcastSweep`).
- **No push:** `sw.js` has no `push` or `notificationclick` listener; `js/pwa.js`
  only registers the worker; there is no `Notification.requestPermission`, no
  `PushManager.subscribe`, no VAPID key, no `web-push` dependency, no
  subscription collection, no server sender.

### What genuine push requires (missing infrastructure)
1. **VAPID keypair** and server-side `web-push` (or Appwrite Function equivalent)
   — new secrets in `.env.example`, never in the Sites build.
2. **Push subscription storage**: per Scholar ID per device (endpoint, keys,
   user-agent, created/updated). Appwrite collection (`pushsubscriptions`) or a
   persistent local store; must be owner-scoped and pruned on 404/410.
3. **Service worker handlers** in `sw.js`: `push` (show notification) and
   `notificationclick` (focus/open the right screen), plus `pushsubscriptionchange`.
4. **Client permission UX** in Profile (“Study reminders”): request permission
   only on an explicit tap, explain browser/iOS limits, show state (granted /
   denied / unsupported), and never re-prompt on every load.
5. **Backend scheduling/delivery** on the tier that owns jobs
   (`GOC_JOB_OWNER`): reuse `core.reminderPlan` so email and push share one
   decision, and add an idempotency ledger per student/day/kind so a retry does
   not double-notify.
6. **Platform reality:** Chrome/Edge/Firefox desktop and Android support Web
   Push; iOS/iPadOS requires 16.4+ and a Home-Screen-installed PWA; in-app
   browsers (Instagram/WhatsApp) do not. Fall back to email honestly.

**This is a separate infrastructure decision, not a small feature.** It needs
VAPID ownership, a subscription store, Appwrite collection permissions, and a
scheduler/worker. **Complexity: L.** Do not present the current email sweep or
a local `new Notification()` as “push”.

**Tests to add:** rules parity with email; subscription validation; sender
payload shape; 410 pruning; SW `push` handler unit test in Node; permission
state machine; idempotency ledger; iOS-unsupported messaging.

---

## 10. Requirement 14 — Streak Freeze correctness

### How it works today
- Constants `STREAK_FREEZE_COST_XP = 500`, `STREAK_FREEZE_MAX = 2`
  (`js/goc-core.js` ~79–82).
- `core.streakAfterActivity(prevStreak, prevDay, today, freezes)`:
  same day → unchanged; yesterday → `+1`; **exactly one missed day
  (`prevDay === dayBefore(dayBefore(today))`) and a freeze held → `+1`, spend
  one, `frozen:true`**; anything older → reset to 1 and keep freezes.
- `bumpStreakRecord()` (`server/server.js` ~1797) is called from test submission
  and study/practice submission (`/api/me/tests/submit`, `/api/me/study/submit`,
  `/api/me/practice`); never from login or staff marking.
- Buying: `POST /api/me/streak-freeze` under `withDataLock` → `core.buyStreakFreeze`.
- Earning: weekly quest (`weeklyReward`) and team challenge (`challengeReward`)
  pay freezes, capped at 2, with a “blocked at cap, carry until room” rule.
- Display: `GET /api/me` shows a preserved `streak` when `prevDay` is two days
  ago and a freeze is held (`displayStreak`, server ~6085) — **without
  consuming it**.
- Data: `streak`, `streakDay`, `streakFreezes` on the student record (local or
  Appwrite `students` doc; attributes may be optional); day stamps use
  `core.lagosDay()` (Africa/Lagos), not the host timezone.
- Tests: `test-streak-freeze.js` (pure), `-route`, `-buy`, `-demo`, `-ui`.

### Findings / defects to fix
1. **Display-only preservation can mislead.** A student who missed exactly one
   day sees their streak preserved, but no freeze is consumed and `streakDay`
   is not advanced. If they then miss another day, the next activity resets the
   streak (two missed days) even though the app previously showed preservation
   and the freeze was never spent. Either (a) consume the freeze at the next
   successful activity **and** show “a freeze will be used when you return”, or
   (b) apply the freeze proactively at day rollover (needs a scheduled job and
   an idempotency guard). Do **not** leave the current silent display-only
   behavior without an owner decision.
2. **Streak freeze persistence on Appwrite when the attribute is absent.**
   `createAppwriteStudent` only sends `streakFreezes` when > 0, and
   `freezePatch` writes 0 when a freeze is spent. If the `students` collection
   lacks the integer attribute, the whole patch (including streak/day) fails
   and the freeze is not recorded. Add a schema/preflight check and a migration
   note; test a patch failure path.
3. **Same-run award/spend ordering.** Weekly quest/challenge rewards and the
   freeze spent by the same practice run are folded into different writes. The
   current Appwrite code writes the weekly reward first, then the XP patch with
   `freezePatch(stu.streakFreezes, finalFreezes)`; a failed second patch leaves
   the streak update unapplied even though the weekly write succeeded. Make the
   streak/freeze update one patch (or re-order and test partial failure).
4. **No concurrency test.** Buying and submitting are both under
   `withDataLock`, but Appwrite read-modify-write is not transactional. Add a
   test that two concurrent practice submissions cannot spend two freezes for
   one missed day.
5. **Day-boundary test gap.** Core tests use explicit stamps; add a test at
   23:59:59 Lagos on the UTC host and after midnight, and a restart test
   (streak data must survive).
6. **Weekly freeze earning is invisible if the Weekly Quest card is removed**
   (see 6.1) — keep an explanation somewhere.

### Test plan
Pure: yesterday/same day/two-day gap/no streak/bad counts/clamp (exists) +
display semantics. Route: buy (cap/XP/409), spend on practice, spend on test
submission, no spend on login/staff marking, retry idempotency, concurrent
requests. Storage: local restart, Appwrite patch success/missing attribute/
partial failure. UI: Profile row state (exists) + a “freeze used” explanation.
**Complexity:** M; **Priority:** critical (it protects a core student reward).

---

## 11. Requirement 15 — Help and Tutorial

### Current implementation
- `js/onboarding.js` is a real navigation engine, not tooltips: each step
  navigates (`go`, named opener, admin section, tutor bridge), waits up to
  1.5 s for the target to be visible, scrolls it into view, spotlights it, and
  skips missing targets with a log. Controls: Back, Next, Skip, Escape,
  arrow keys; progress pips; completion card.
- State: `goc.tour.v2.<tour>.<userId>`, statuses `in-progress|skipped|done`;
  `maybeAutoStart` never re-runs a saved state; `restart` forces step 0.
- Tours: **student** (18 steps), **tutor** (8), **console** (generated from the
  role’s allowed sections). Student auto-start from `renderDash`; Profile has
  `#tourHelpBtn` → `tourRestart`; console/tutor auto-start in their shells.
- Tests: `test/test-onboarding-student.js` (full journeys, fake DOM, no exam
  started), `test/test-onboarding-console.js`; no browser-level tour test.

### Steps that conflict with the planned removals
| Step | Target | Problem |
| --- | --- | --- |
| 1 | `dashUp` | Next Up removed |
| 2 | `dashJamb` | JAMB card removed/consolidated |
| 4 | `tut-jump` | copy names My Notes and Study CBT |
| 7 | `suStart` via `openCBT` | Study CBT shortcut removed |
| 8 | `sg-jamb` | JAMB entry scope |
| 9 | `sg-reading` | Read/Learn tile removal |
| 11 | `myNoteUploadBtn` via `openMyNotes` | My Notes entry removed |
| 17 | `classes` copy names recordings | Recorded block removed |
| 5/13/14/15/16/18 | practice/mistakes/bookmarks/results/league/profile | still valid |

### Recommended implementation
1. Define a single `STUDENT_FEATURES` capability map in `js/onboarding.js`
   (mirroring `core.studentFeatures()`), and **generate the student steps** from
   it so a removed feature cannot leave a dead step.
2. Re-order steps to the new home/Study layout; every step keeps
   `go`/`call` + a real, visible target id. Update copy to the actual screen.
3. Add a **release id** to the tour key (same as 12) and bump it when content
   changes.
4. Add an `onDone`/`onSkip` callback or `CustomEvent` so the affirmation (12)
   and redeploy notice (16) can react without polling.
5. Ensure “open the relevant menu” on mobile: for destinations behind the
   drawer/tabbar, call `openDrawer()` (or `go`/tab) before pointing, and wait
   for the target to be visible; the engine already supports named calls.
6. Permissions: all students share the same entitlement set today
   (`core.studentFeatures()`), but the tutor/console tours are already
   role-filtered. If tier limits are shown, keep GOC-only steps out of an Open
   account’s tour using the same map.
7. Add tests that (a) every `STUDENT_STEPS.target` exists in `index.html` and is
   not inside a removed block, (b) every `call` is a defined function, (c) no
   step starts an exam/submits, (d) mobile and desktop paths both resolve, (e)
   resume/skip/release-bump behavior.

**Complexity:** M. **Dependency:** must land **after** the dashboard/home
removals; otherwise the tour will be immediately stale.

---

## 12. Requirement 16 — one-time redeployment notice

### Current versioning
- `sw.js` has a manually bumped cache name (`CACHE = 'goc-v222'` here,
  `goc-v206` in main) and an `install`/`activate` that deletes other caches.
- `js/pwa.js` registers it on `load`; no update prompt, no `updatefound`
  handling.
- `GET /api/health` returns `version: 1` — a constant, not a release id.
- Build strips test hooks and minifies; it does not inject a build timestamp or
  version.
- There is **no** one-time notice component or storage.

### Recommended design
- Introduce one **release id** that changes only on deployment. Options:
  - reuse the `sw.js` cache name (`goc-v223`) and expose it through a small
    public endpoint or a build-generated constant; or
  - add `GOC_RELEASE` as a build-time define in `js/app.js` (like the existing
    `GOC_API_BASE` injection in `js/api.js`) and optionally to `/api/health`.
- On app boot (not on the maintenance page), read
  `localStorage['goc.updateNotice.<userId|anon>']`; if it differs from the
  release id, show a dismissible banner/card (`#appUpdateNotice`) with the exact
  message, a **Dismiss** button, and a **Refresh** action. Store the id on
  dismiss so it never repeats for that release; a new deploy shows it once
  again.
- Do not block the app, do not auto-reload, and do not show it to a user who is
  mid-exam (check `role`, active screen).
- Service-worker interaction: with cache-first, the new worker may activate
  while an old page is open (`skipWaiting`/`claim`); the notice should say
  “refresh” rather than assuming assets already updated. Bump the cache name in
  the same release.
- Tests: same release on refresh → no notice; release bump → one notice;
  dismiss → gone; second refresh → gone; new release → returns; no notice on
  maintenance page; mobile layout.

**Complexity:** S–M. **Dependency:** release id shared with 12/15 so one bump
drives tour + notice.

---

## 13. Requirement 17 — anonymous Try G.O.C preview

### What exists today
- A dedicated `#demo` screen (`index.html` ~600–625) with intro, question card,
  options, palette, Prev/Next, result/review, “Try again” and “Unlock the full
  G.O.C experience” → `go('signup')`.
- Client: `demoOpen/demoStart/demoRender/demoPrev/demoNext/demoSubmit`
  (`js/app.js` ~12281–12390).
- Server: `GET /api/demo/questions` and `POST /api/demo/submit`
  (`server/server.js` ~4436–4490), pool `server/lib/demo-questions.js`
  (15 original questions, no bank id), 30-minute in-memory token, per-IP draw
  limit, answers/explanations withheld until a single-use submit.
- Isolation is already strong: no Auth user, no student doc, no attempt, no XP,
  no leaderboard, no analytics write; student endpoints stay closed.
- Tests: `test/test-demo-preview.js` (draw size, marking, single use, limits,
  isolation, client wiring).

### Gaps against the brief
1. It is a **separate UI**, not the actual Practice/JAMB CBT interface. It
   shares some CSS classes, but rendering/navigation/marking are a parallel
   implementation.
2. **Five questions are random on each attempt** (`shuffled.slice(0,5)`), so the
   visitor does not get “the same five questions every time”.
3. Registration invitation exists in the result, but the CTA/placement should be
   reviewed after 9C.
4. No server-side guarantee that the set is stable across deploys; no test for
   repeat-attempt equality.
5. In the Free UTME 2027 mode, the preview entry/CTA behaviour is mode-aware;
   do not break `free2027-ui.js` handlers.

### Recommended implementation
**Reuse the real practice components, don’t clone them.**
- Extract/reuse the practice renderer and navigation from `js/app.js`:
  `renderPractice` / `pracRender`, `OPT_KEYS`, palette (`prac-pal-*`), option
  selection, Prev/Next, submit, review. The cleanest path is a small
  **preview adapter**: a session object `{ mode:'preview', questions, answers,
  onSubmit }` that the existing practice renderer consumes, with a
  `previewMode` flag that suppresses save/bookmark/ask-tutor/XP UI and routes
  submission to `/api/demo/submit`.
- **Fixed set:** replace the random draw with a constant `PREVIEW_SET` of five
  stable ids from `server/lib/demo-questions.js` (same order, same option
  order) returned by `GET /api/demo/questions` every time. Optionally version
  the set so a deploy can change it deliberately; the same visitor retrying
  must see identical questions.
- Keep answers/explanations server-side until single-use submit; keep the
  in-memory token, rate limit and “no writes” guarantees.
- Extend the result screen with a clear **“Register for full G.O.C access”**
  CTA (the Stage B application flow may mean “apply”, not a direct account).
- Guard: never call `/api/me/*`, never send a student token, never write
  `practiceRuns`, `attempts`, `bookmarks`, flags or XP.
- Consider using the JAMB CBT runner (`#wtRun`-style) if the brief wants the
  exact JAMB experience; it brings the calculator/palette but is tightly
  coupled to real attempts. The safer reuse is the Practice renderer plus the
  JAMB visual shell. **Owner decision:** which real interface is the reference?
- Tests to add: same five ids/options on two consecutive draws; same questions
  after a server restart; no `data.json`/Appwrite write; no token accepted on
  student routes; repeated attempts allowed within the rate limit; UI reuses
  the real renderer (assert shared functions/ids, not a second copy);
  registration CTA presence; mobile palette.

**Complexity:** M–L (UI refactor), **risk:** touching the practice renderer can
regress real practice — do it behind an adapter and keep the existing
`test-practice*` suites green.

---

## 14. Requirement 18 — pre-exam practice page: no scroll, fixed Start

### Current implementation
- The pre-exam set-up is `#studySet` (`index.html` ~1085–1155): header, a
  scrollable `.wrap` with subject chips/dropdown, topics, years, question
  count, time allowed, note, then a `.bottom-bar` with **Cancel** and
  **Start** (`#suStart` → `suStart()`).
- `.screen` is `position:absolute; inset:0; overflow-y:auto` — the **whole
  screen scrolls**. `.bottom-bar` is `position:sticky; bottom:0`, but because
  it sits after a long content flow, it is **below the initial viewport** on
  phones; the student must scroll to reach Start. There is `padding-bottom:96px`
  to keep content above the bar once reached.
- The separate **pre-test instructions overlay** `#testInfoOverlay`
  (`.test-info`, max-width 380, centered, `.ti-actions` at the bottom) has no
  `max-height`/`overflow`, so on a short device or large text the Start button
  can go off-screen with no way to scroll.
- `#suStart` → `suStart()` → `suAskStart`/`testInfo` → start route. The actual
  exam runner (`#practice`/`#cbt`/`#wtRun`) is separate and out of scope.

### Recommended implementation (CSS/layout only)
1. `#studySet{ display:flex; flex-direction:column; height:100%; overflow:hidden }`.
2. `#studySet > .wrap{ flex:1 1 auto; min-height:0; overflow-y:auto; overscroll-behavior:contain; padding-bottom:24px }` (keep safe-area).
3. `#studySet > .bottom-bar{ position:sticky; bottom:0; flex:0 0 auto; padding-bottom:calc(14px + env(safe-area-inset-bottom)); z-index:2 }` — it is now always visible without scrolling.
4. `.hdr` `flex:0 0 auto`; guard `.hdr.solid::after` decoration.
5. `@media (max-height:640px)` compress paddings/type and ensure the Start label is visible.
6. For `#testInfoOverlay`: `.test-info{ max-height:calc(100dvh - 32px); display:flex; flex-direction:column }`, body part `overflow-y:auto`, `.ti-actions{ flex:0 0 auto; position:sticky; bottom:0; background:#fff; padding-top:10px }`; or convert to a full-height sheet on small screens.
7. Use `100dvh` (with `100vh` fallback) not fixed px; test iOS Safari URL-bar resize, landscape 320×480, and Android keyboard opening on the numeric input.
8. Do **not** change the runner or the start route.

**Tests:** CSS assertions + a Playwright-style viewport check is ideal; at
minimum add `test/test-preexam-viewport.js` asserting the flex/overflow rules
and that `#suStart` is inside `.bottom-bar`. **Complexity:** S–M. **Dependency:**
none, but verify after any Study-hub removal.

---

## 15. Shared components and cross-cutting risks

| Shared thing | Why it makes changes interact |
| --- | --- |
| `#landing` + `.lp-*` CSS | Mobile nav, section reorder, Two Ways In, Try placement and motto all touch one file/stylesheet; one PR per group avoids conflicts. |
| `#lpDrawer` / `css/free2027.css` | Free UTME 2027 hides hub sign-up entries by selector; renaming ids or removing the Create-account block can silently change the free mode. |
| `#study` ids (`sg-*`, `questCard`, `weekCard`, `rvCard`) | Dashboard removals, tour steps and UI tests all read these ids. |
| `dashPaint*` functions | `renderDash()` calls all of them; removing one card must remove its call or guard by id (functions already guard, so a missing element is safe). |
| `js/onboarding.js` steps | Depend on every target id; update in the same PR as any UI removal. |
| `sw.js` cache name | Release notice, tour release, affirmation timing and “refresh” guidance share one version concept; bump deliberately. |
| `js/api.js` drivers | Every new/changed route must be mirrored in **both** HTTP and demo drivers; `test-driver-parity.js` enforces method parity. |
| Route inventory | `functions/goc-api/route-inventory.json` + `coverage.json` + `test-migration-gateway.js` carry route/capability counts. Any new endpoint (e.g., push subscription) needs an inventory/coverage update, not just a handler. |
| Appwrite schemas | Students optional attributes (`streakFreezes`, practice counters), `attempts`, `studentnotes`, `videos`, `liveclasses`, `sessions`; adding a collection (push subscriptions) needs schema, permissions and a preflight test. |
| Local JSON-only records | Bookmarks, practice runs, flags, review state and reminder prefs **do not move to Appwrite** today even when students do. Fix before ephemeral redeploys. |

---

## 16. Data-preservation matrix (critical)

| Student data | Where it lives now | Survives logout | Survives redeploy on ephemeral host |
| --- | --- | --- | --- |
| Account, XP, streak, freezes, subjects | Appwrite `students` (when configured) or `data.json` | Yes | Yes on Appwrite; local only with `GOC_DATA_DIR` |
| Attempts / results | Appwrite `attempts` | Yes | Yes |
| Bookmarked questions | `data.json` `bookmarks` | Yes | **Only with a persistent `GOC_DATA_DIR`** |
| Practice history / mistakes source | `data.json` `practiceRuns` (+ localStorage mirror) | Yes | **Only with persistent `GOC_DATA_DIR`** |
| Spaced-review state | `data.json` `reviewState` | Yes | **Only with persistent `GOC_DATA_DIR`** |
| My questions / flags | `data.json` `flags` | Yes | **Only with persistent `GOC_DATA_DIR`** |
| Private uploaded notes | Appwrite `studentnotes` + bucket | Yes | Yes |
| Reminder preferences | `data.json` `reminderState` | Yes | **Only with persistent `GOC_DATA_DIR`** |
| Free UTME 2027 records | `data.json` `free2027` + archive files | Yes | **Only with persistent `GOC_DATA_DIR`** |
| Question banks, notes, videos, classes | Appwrite collections / bucket | n/a | Yes |

Recommendation: before any UI simplification, either (a) guarantee and document
`GOC_DATA_DIR` on the production host, or (b) migrate bookmarks/practice
runs/review state/flags/reminder prefs into Appwrite collections with owner
permissions. Do not “fix” this by deleting the local records.

---

## 17. Prioritisation groups

**Critical functionality and data preservation**
1. Reconcile the two histories / establish one baseline (§22).
2. Streak-freeze semantics and persistence defects (§10).
3. Data-preservation matrix (§16) — local-only student records.
4. Tutorial targets must match the final UI (§11).

**Security and infrastructure**
5. Maintenance mode (done — Workstream A).
6. Release/version identity for notice + tour + cache (§12).
7. Push notification infrastructure (separate approval, §9).

**Student dashboard and UX**
8. Home removals (Next Up, subjects, Study CBT, My Notes shortcut, JAMB card) (§6).
9. Study-hub removals (quest cards, review card, reading tile, recordings) with entry-point preservation.

**Homepage and public experience**
10. Mobile dropdown nav (§1).
11. Two Ways In removal (§2).
12. Try G.O.C placement/centring (§3).
13. Section order + motto (§4–5).

**Practice preview** — 14. Reuse the real interface + fixed five (§13).

**Notifications and reminders** — 15. Genuine push (§9).

**Tutorial and onboarding** — 16. Rewrite + affirmation gating (§11–12).

**Visual/responsive** — 17. Pre-exam viewport (§14), `scroll-margin` for anchors,
alternating backgrounds after reorder.

---

## 18. Recommended staged sequence (minimises regressions)

**Stage 0 — repository reconciliation (blocking).**
Merge the Stage B history and the main/tier history into one branch; run the
combined suite; tag the baseline. No feature work until this is green.

**Stage 1 — maintenance mode.** Already implemented and tested on this branch;
port it onto the reconciled baseline (single gate + module + docs + test). Merge
independently once reviewed; do not deploy.

**Stage 2 — data + streak integrity (server first, no UI).**
Move or protect the local-only student records; fix freeze display/consumption,
Appwrite optional-attribute failure paths, concurrent spend, and add the
fixed-date/Lagos-boundary tests. No visual change.

**Stage 3 — homepage (one PR, no student data touched).**
Mobile dropdown (9A) → remove Two Ways In landing block + update tier tests
(9B) → Try placement (9C) → reorder + motto (9D/E) → new order/nav tests. Free
UTME 2027 mode CSS and browser test must be re-run.

**Stage 4 — dashboard/Study simplification (UI only).**
Remove home Next Up/subjects/Study CBT/My Notes shortcut/JAMB duplicate; decide
Study-hub cards; keep every route and record; update dashboard tests and the
tutorial targets in the same PR. Verify bookmarks/mistakes/flags/practice with
`test-bookmarks`, `test-mistakes`, `test-practice`, `test-spaced*`.

**Stage 5 — tutorial + affirmation + release notice.**
Rewrite steps from the final feature map, bump the tour release, gate the
affirmation behind completion, add the one-time update notice. All three share
one release id — ship together.

**Stage 6 — Try G.O.C preview.**
Refactor to reuse the real practice renderer with a preview adapter, fix the
five-question set, add the registration CTA and isolation tests.

**Stage 7 — push notifications.**
Separate approval: VAPID, subscriptions, service-worker push handlers,
scheduler, permissions, iOS messaging. Email remains the fallback.

**Stage 8 — pre-exam viewport polish + residual visual QA.**
No-scroll set-up, fixed Start, overlay scroll, device testing.

Each stage: `npm test` green, no data migration without a backup, no route
removed without updating the inventory/coverage, no UI id removed without
updating `test/run.js` suites.

---

## 19. Owner decisions required before implementation

1. **Baseline:** how should the Stage B branch and `origin/main` (tier work) be
   combined? (Blocking.)
2. **Two Ways In:** confirm the landing `#lpTiers` block and its Create-account
   CTA are what “Two Ways In” means; keep the sign-up panel. Yes/no.
3. **Dashboard scope:** several items live on the Study hub, not `#home`.
   Remove from home only, or from both? (This decides whether My Notes,
   Read/Learn and Study CBT need new entry points.)
4. **JAMB-oriented session:** remove only the duplicate Web Test hub card, or
   remove the feature? (Feature removal changes league weights, admin screens
   and records — not recommended without a separate specification.)
5. **Streak freeze semantics:** consume on next activity with an explicit
   “freeze will be used” message, or consume proactively at midnight?
6. **Push provider:** Web Push via VAPID on the Node server, an Appwrite
   Function scheduler, or defer? Who owns the keys/subscription store?
7. **Try preview reference:** Practice UI or the JAMB CBT runner (or the
   Practice renderer inside the JAMB visual shell)?
8. **Data storage:** move bookmarks/practice/flags/review/reminder prefs to
   Appwrite, or guarantee a persistent `GOC_DATA_DIR`?

---

## 20. Complexity summary

| Work item | Complexity | Risk |
| --- | --- | --- |
| Mobile dropdown nav | S–M | Low/medium (Free 2027 selectors) |
| Two Ways In removal | S | Medium (tier tests) |
| Try placement | S | Low |
| Section order + motto | S | Low/medium (visual rhythm) |
| Dashboard removals | M | Medium (tour/tests/orphans) |
| Preservation audit/migration | M–L | **High (data)** |
| Affirmation gating | M | Medium |
| Push notifications | L | High (new infra) |
| Streak freeze fixes | M | **High (reward correctness)** |
| Tutorial rewrite | M | Medium |
| Release notice | S–M | Low |
| Preview reuse | M–L | Medium (practice regression) |
| Pre-exam viewport | S–M | Low |

## 21. Acceptance for this inspection

Every handwritten requirement has been mapped to its current implementation
(files, routes, data, permissions, tests), the gaps are identified, the missing
tests are proposed, the data-preservation risks are explicit, exact files are
named, and a staged order is recommended. **No homepage, dashboard, practice,
notification, tutorial or streak change has been implemented.** That remains
blocked on the owner’s decisions in §19 and explicit approval.

---

## 22. What is needed to proceed

1. Resolve the unrelated-history baseline (§0): one branch containing both
   Stage B and the tier work, with a green combined suite.
2. Approve or amend the scope decisions in §19.
3. Approve Stage 1 (maintenance) as an independent merge and the Stage 2–8
   plan (or a subset).

Only then should implementation begin, one stage per focused PR, with the
maintenance switch available to take the platform offline during the cutover.
