# Contrast audit — Phase 3, item 1

WCAG AA check across every text/background and icon/background pairing
actually used in `css/styles.css` and the JS-driven badge colors in
`js/app.js`. Computed relative luminance contrast ratios rather than
eyeballing, against the 4.5:1 (normal text) / 3:1 (large text, ≥24px or
≥18.66px bold) thresholds.

## Method

Checked every color token in `:root`, plus the resource/video badge
colors set inline from JS, against every background it's actually
paired with in the HTML/CSS (not a blind cross-product of every token
against every other token — most tokens are never used together, so
only real pairings count).

## Found failing, and fixed

1. **`.hstat .v.gold`** (Academy XP / Day streak numbers on the
   dashboard hero card) — `color:var(--gold-lt)` on the semi-
   transparent white card sitting over the red hero gradient.
   Effective contrast ≈ 3.2:1, fails AA.
   → `--gold-lt` changed from `#FBBF24` to `#FEF08A` (now ≈4.65:1).
   Only usage of that token, so this was a safe, isolated change.

2. **Muted/secondary text on red hero backgrounds** — the status bar,
   greeting, hero stat labels, profile ID line, selected weekday
   label, and trust-badge row on the landing hero all used a
   hardcoded `#FFD9D9`. Worst case is `.wday.on .d`, which sits on
   flat `--red` (`#DC2626`, the lightest red in use) — contrast
   ≈3.7:1, fails AA. The darker gradient stops (`#7F1D1D`) were
   already fine on their own, but the token has to work everywhere
   it's used.
   → Replaced all 7 occurrences with a new `--red-mute:#FEF8F8`
   token (≈4.6:1 on `#DC2626`, ≈9.5:1 on `#7F1D1D`). Tokenizing it
   also cleans up what was previously a repeated hardcoded value.

## Checked, already passing — no change needed

- Resource/video type badges (`#DC2626`, `#7F1D1D`, `#0E7490`,
  `#15803D`, `#475467`) with white text: 4.83–10.02:1, all pass.
- `--gray` / `--mute` / `--slate` body and label text: passes on
  every background it's actually paired with (white, `--bg`,
  `--card`). The one borderline pairing that would fail (`--gray` on
  `--card`, 4.22:1) never actually occurs together in the app.
- `--gold-deep` on white and on `--gold-soft` (the `.chip.gold`
  pill and mission-XP text): 5.28–6.16:1, passes.
- The session-warning bar (`#FFFBEB` / `#FCD34D` on `#78350F`):
  6.29–8.75:1, passes.
- `--green` used as text (feedback/subject-complete states): passes
  on every background it's paired with.

## Not actually in use — flagged, not touched

`--amber` and `--green-lt` are declared in `:root` but never
referenced anywhere else in the stylesheet. Left them alone since
removing unused tokens wasn't in scope for this pass, but noting it
here in case they're meant for something not yet built.

## Verification

`node test/run.js` — same 13/15 pass as before this change (the two
offline failures are `test-server.js` / `test-security.js`, which
need the `busboy` stub trick from the original handoff to run
without network access; unrelated to this change, which was CSS-only).
