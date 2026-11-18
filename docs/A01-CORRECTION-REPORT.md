# A01 — Student Home Dashboard: visual-fidelity correction

Correction round on the A01 dashboard, against the approved desktop/mobile
reference. This report covers only that correction; the original build report is
`docs/A01-STUDENT-DASHBOARD-REPORT.md`.

Branch `arena/1f98403a-goc-academy-hub`, base `950c276`. Nothing merged, nothing
deployed, `server/data.json` untouched and untracked.

---

## 1. Root causes identified

**A1 — mobile bottom bar stacked vertically.**
`.side-nav{display:flex; flex-direction:column}` was declared with no media
query. That wrapper is the *desktop sidebar* — but the same `<nav>` is the
phone's bottom bar, so the column applied there too. Measured before the fix:
`Home@771-810, Study@810-849, Practice@849-888, Results@888-927, More@927-966`
against a 74px bar in an 844px viewport — three of five tabs were off-screen.

**A2 — hamburger invisible.**
The button was correct at 34×34, but its three bars measured **0×0**. The UA
stylesheet sets `align-items:flex-start` on `<button>`; in a column flex
container that makes an auto-width child shrink to zero. `height:2px` was
declared, `width` never was, so the bars had no cross-axis size to render.

**A3 — "More" in the desktop sidebar.**
More was a plain `.tab.tab-m` in the main nav list with no desktop rule to
remove it. It rendered as a 15th row between League and Support.

**B9 — third metric line.** Markup, CSS *and* `dashPaintMetrics()` all drew a
`detail` string ("Level 16 · Distinction Scholar", "Across 1 marked paper").
The reference has icon + value + label only.

**B12 — phone "View Plan" still showing after being hidden.**
`.dash-plan-view{display:none}` lost to `.dash-link{display:inline-flex}` —
equal specificity, and `.dash-link` came later in the file. The fix is a
higher-specificity selector, not a re-order.

**B4 — the illustration** was a flat maroon platform with a stray white ribbon.
It did not read as a cap on books.

---

## 2. Files changed

| File | Δ |
|---|---|
| `css/styles.css` | +273 / −90 |
| `index.html` | +208 / −37 |
| `js/app.js` | +21 / −6 |
| `test/test-home-dashboard.js` | +50 / −3 |
| `docs/stud-dash-desktop.png` | regenerated |
| `docs/stud-dash-mobile.png` | regenerated |
| `docs/stud-dash-tablet.png` | regenerated |

No schema change, no new API, no new screen, no data touched.

---

## 3. A1–A3, exact fixes

**A1.** The wrapper's direction is now responsive: `row` by default with an
explicit `flex-direction:column` re-declared *inside* the `min-width:900px`
sidebar block. At `max-width:899px` the bar is `flex:1 1 auto; flex-direction:
row; align-items:stretch; width:100%`, each `.tab-m` is `flex:1 1 0; width:auto`
so all five share the width equally, and the bar carries
`height:calc(74px + env(safe-area-inset-bottom))` so it clears the home
indicator. Content sits above it (`padding-bottom:88px` on the screen).

**A2.** `.dash-burger` gained `align-items:stretch` and the bars gained
`width:100%; flex:none` (plus `border-radius` and the padding that sets their
inset). Measured after: three bars at **20×2** each.

**A3.** `.tabbar .tab-m[data-t="more"]{display:none}` inside the `min-width:
900px` block. Desktop now renders **14 rows** — the approved list, ending
League → Support → Profile → Settings → Log Out. No page or handler removed;
More still exists in the markup and still works on a phone.

---

## 4. B1–B13, exact fixes

- **B1** Active row is a solid red pill: `linear-gradient(142deg,#DC2626,#B01818)`,
  `color:#fff`, `stroke:#fff` on the icon, `border-radius:11px`,
  `margin:2px 12px` (inset from both edges), `padding:12px 16px`. The flush
  `inset 4px 0 0` left bar is gone.
- **B2** Dashboard ground `#FEFEFE`; cards white; sidebar `#F9F6F6`. Measured:
  screen `rgb(254,254,254)`, sidebar `rgb(249,246,246)`.
- **B3** New `.dash-welcome-div` — 1px, 104px tall, translucent white gradient
  fading at both ends, `align-self:center`. Desktop only; the phone keeps the
  corner badge. Measured present at 1440, absent at 390/834.
- **B4** Illustration redrawn: black mortarboard (separate board-thickness and
  skull-cap volumes, rim light on the near edges), gold button/cord/tassel drawn
  *in front* of the books, open cream book with a fanned fore-edge and page-layer
  lines, plus a red-covered closed book leaning alongside. Layered contact
  shadows. Verified by rendering the SVG standalone before installing it.
- **B5** No chip: `background:none; border:0; padding:0`. Gold laurels flank the
  text at 26×58 desktop (were 13px slivers), 15×34 on the phone. Typography is
  per-breakpoint (21px/13px desktop, 13.5px/9.5px phone) so the phone no longer
  inherits the desktop scale.
- **B6** Continue Learning is `min-height:130px` with `.dash-continue-art` — red
  books bleeding from the lower-right corner, behind the copy, clear of the
  button, plus a soft radial wash. **Desktop only** — see the discrepancy list.
- **B7** `.dash-continue{flex:0 0 58%}` / `.dash-plan{flex:1 1 auto}`. Measured
  **578 / 400** at 1440 (59.1% / 40.9%). Stacks at tablet and phone.
- **B8** Tiles `min-height:148px` desktop (measured **170px** with content),
  `26px 16px 22px` padding, 44px icons. Subtitles are no longer `display:none`
  on a phone — measured visible at 390 and 834.
- **B9** The three `dash-metric-detail` elements were removed from the markup and
  `dashPaintMetrics()` no longer writes them (the engine still computes `detail`;
  it is simply not drawn). Phone is now `flex-direction:column` centred — icon,
  value, label; desktop `row`. Measured `hasMetricDetail: false`.
- **B10** `.dash-quick-ico` lost `background:#FEF1F1` and `border-radius`; icons
  are plain red at 44px desktop / 32px phone.
- **B11** Desktop is one row: megaphone, bold title, 1px rule, message, "View →".
  Phone: megaphone, title, two-line message, chevron (no "View →"). Both wrapped
  in `.dash-announce-body`, which is a column on a phone and a row on desktop.
- **B12** The phone card is `onclick="dashPlanGo()"` with a centred chevron; the
  separate "View Plan" link and the explanatory line are hidden there. Desktop
  keeps heading, goals, percent, bar, detail and "View Plan →".
- **B13** `.side-flourish` — three layered red curves, 72px tall, absolutely
  positioned behind the foot rows with `pointer-events:none`, so it never
  obstructs Log Out.
- **B14** No status bar added, as directed.

**One extra fix while verifying:** on a phone, Profile and League lit no visible
tab, because their own rows are the hidden sidebar ones. `setScreen()` now falls
back to More when the active section has no visible tab. Verified
`mob profile → ["More"]`, `mob league → ["More"]`, `desk profile → ["Profile"]`.

---

## 5. Section 4 elements preserved

All confirmed still live and reading the account's record: name `Ernest U.
Jesusanusi`, time-of-day greeting, `2,480` XP, Level 16 / Distinction Scholar,
`12 Days` streak, `78%` performance, `Mathematics – Quadratic Equations,
Indices`, the real class notice, the red banner, the three tinted colour
families, the four Quick Access destinations and labels, the announcements
content and desktop View action, the 14-entry sidebar order, the five mobile
labels, and the mobile View All affordance.

No `goc-core.js` change was needed this round — every number still comes from
the same engine functions as before.

---

## 6–8. Screenshots and viewports

| File | Viewport |
|---|---|
| `docs/stud-dash-desktop.png` | 1440 × 1000 |
| `docs/stud-dash-tablet.png` | 834 × 1112 |
| `docs/stud-dash-mobile.png` | 390 × 844 |

Chromium 119 (the bundled serverless build, with NSPR compiled from source),
over CDP against the running app and a live signed-in student. Every figure in
this report was read from the live DOM; none is estimated.

---

## 9. Navigation measurements (live DOM)

**Desktop 1440×1000** — 14 sidebar rows, all `231px` wide, `x=12`, 46px tall,
`y=91…758`, spacing 50px. No More row.

**Mobile 390×844** — 5 tabs, one row at `y=771`, each **78×67**:
`Home x=0, Study x=78, Practice x=156, Results x=234, More x=312`. Bar
`y=770–844` (74px), viewport height 844 → nothing clipped.
Hamburger bars `20×2` ×3. Drawer opens to `x=0, w=320` with 5 links, and closes.

**Tablet 834×1112** — same five tabs, one row at `y=945`, each 86×67, centred.

---

## 10. Test results

```
node test/run.js   →   201 passed, 4 failed
```

The four failures are `test-free2027-local`, `test-production-persistence`,
`test-backup-integrity`, `test-migration-api-config` — **the identical set** to
the baseline on `950c276`, compared as a set.

`test/test-home-dashboard.js` → **64 passed, 0 failed** (was 51; 13 added for
this round, and one pre-existing assertion was updated because it asserted the
metric detail line that B9 removes — the engine's own reason is still covered
separately).

Other screens were spot-checked in the browser for regression: Study, Results,
Profile and League all render with exactly one active tab at both widths, no
horizontal overflow, and the bar geometry intact at 256px (desktop) / 390px
(phone).

---

## 11. Remaining discrepancies

1. **Continue Learning corner art is desktop-only.** The prompt asked for both
   the tall card *and* the corner books, and also to reproduce the mobile
   reference. The approved phone card has no illustration; at 343px wide the
   books sat straight through the lesson line. I kept the mockup's mobile
   composition and the desktop art. Flagging it rather than hiding the choice.
2. **The illustration is hand-drawn SVG, not photography.** No image generation
   or stock art is used anywhere in the hub. It now reads correctly as a black
   cap with a gold tassel on cream books with a red-covered book, but it is
   flat-vector — the reference is a rendered 3D still. Closer than before, not
   identical.
3. **Level reads "Level 16", not "Level 2".** That is this account's real level,
   as instructed ("use the student's actual level").
4. **My Study Plan shows "No plan for today yet".** This account genuinely has no
   stored plan. Not seeded, because inventing "3 of 5 goals" would be fake data.
5. **Emoji is tofu in the captures** — the sandbox has no system emoji font. The
   harness injects Noto Emoji for the shot only; the app is unchanged.
6. **Quick Access tiles measure 170px, not 148px.** `min-height:148px` is set,
   but the two-line "Question Bank" subtitle pushes the row taller. I did not
   shrink the type to force 148.
7. **The sidebar flourish is a CSS/SVG sweep, not the reference's illustration.**
   Restrained by design and positioned clear of Log Out.

No visual approval is claimed. The comparison to the reference is the reviewer's
to make.
