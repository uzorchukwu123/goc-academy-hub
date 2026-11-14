/* test-competition-desktop.js — the competition exam desk, desktop only.
   ----------------------------------------------------------------------------
   On wide screens a Free Tutorial COMPETITION paper becomes a JAMB-style
   desk: full-width header, question card left, persistent palette right.
   Weekly Assessments and every screen below 1024px must be exactly as
   they were. This suite proves the isolation rather than admiring the
   layout:

     1. The palette host exists in the page, hidden, with its grid + count.
     2. paintExam() fills it ONLY for competitions, from the same state and
        the same freeExamJump() buttons the Question Navigator modal uses.
     3. Every desktop rule lives inside ONE @media (min-width: 1024px)
        block scoped to .f27-exam-competition; outside it, the palette is
        display:none at every width.
     4. The pre-existing mobile rules are still present verbatim — the
        block above was appended, nothing above it was edited.

   Run:  node test/test-competition-desktop.js */
'use strict';
var fs = require('fs');
var path = require('path');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html');
var uiSrc = read('js/free2027-ui.js');
var css = read('css/free2027.css');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ------------------------------------------------------ 1. the host ------ */
head('the palette host is in the page');
ok('the aside exists, hidden, inside the exam body',
   /<aside class="f27-cbt-side" id="freeExamSide" hidden/.test(html));
ok('it carries the palette grid and the answered count',
   /id="freeExamSideGrid"/.test(html) && /id="freeExamSideCount"/.test(html));
ok('it reuses the navigator legend (answered / unanswered / current)',
   (html.match(/f27-cbt-dot (answered|unanswered|current)/g) || []).length >= 3);

/* ------------------------------------------------- 2. the fill ----------- */
head('paintExam fills it for competitions only, from the same state');
ok('the fill is gated on the competition kind',
   /var comp = F\.exam\.kind === rules\.KIND_COMPETITION;\s*side\.hidden = !comp;/.test(uiSrc));
ok('the palette buttons are the navigator\'s own (freeExamJump, navq classes)',
   /sideGrid\.innerHTML = F\.exam\.questions\.map/.test(uiSrc)
   && /onclick="freeExamJump\(' \+ i \+ '\)"/.test(uiSrc)
   && /'f27-cbt-navq'/.test(uiSrc));
ok('answered and current come straight from the exam state',
   /F\.exam\.answers\[q2\.id\] != null/.test(uiSrc) && /i === F\.exam\.index \? ' current'/.test(uiSrc));
ok('the count line counts the same answers',
   /sideCount\.textContent = done \+ ' of ' \+ n \+ ' answered'/.test(uiSrc));
ok('a missing host can never break the exam (guarded lookup)',
   /var side = \$\('freeExamSide'\);\s*if \(side\) \{/.test(uiSrc));

/* ------------------------------------------- 3. desktop-only styling ----- */
head('every desktop rule is behind the one desktop gate');
var marker = css.indexOf('COMPETITION CBT — DESKTOP EXAMINATION DESK');
ok('the desktop block is present and commented as such', marker > -1);
var before = css.slice(0, marker);
var block = css.slice(marker);
ok('the palette is display:none before the desktop gate (every smaller screen)',
   /body\.f27-mode #freeExamSide \{ display: none; \}/.test(block));
var mediaAt = block.indexOf('@media (min-width: 1024px)');
ok('the gate is exactly min-width: 1024px', mediaAt > -1);
var gated = block.slice(mediaAt);
ok('nothing after the gate leaks outside it (the block runs to end of file)',
   !/@media \(max-width/.test(gated) && gated.lastIndexOf('}') === gated.trimEnd().length - 1);
ok('every gated selector is competition-scoped',
   (gated.match(/body\.f27-mode #free-exam\.f27-exam-competition/g) || []).length >= 8
   && !/body\.f27-mode #free-exam \{/.test(gated.replace(/body\.f27-mode #free-exam\.f27-exam-competition/g, '')));
ok('the desk uses the width (1400px) instead of the 860px reading column',
   /max-width: 1400px/.test(gated) && /grid-template-columns: minmax\(0, 1fr\) 308px/.test(gated));
ok('the palette sits in its own grid area, sticky beside the question',
   /grid-area: side/.test(gated) && /"subjects subjects" "card side"/.test(gated) && /position: sticky/.test(gated));
ok('options keep their two desktop columns, question type steps up',
   /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(gated) && /\.f27-cbt-question \{ font-size: 18px/.test(gated));

/* --------------------------------------- 4. the mobile CSS is untouched -- */
head('the pre-existing stylesheet above the block is verbatim');
ok('the 860px reading column still governs below desktop',
   /\.f27-cbt-body \{[^}]*max-width: 860px/.test(before));
ok('the phone-first competition fit rules are unchanged',
   /body\.f27-mode #free-exam\.f27-exam-competition \.f27-cbt-body \{ display: flex; flex-direction: column; gap: 8px; padding: 10px 14px; \}/.test(before)
   && /body\.f27-mode #free-exam\.f27-exam-competition \.f27-cbt-question \{ flex: 0 0 auto; font-size: clamp\(14px, 1\.1vh \+ 9px, 17px\); line-height: 1\.45; \}/.test(before));
ok('the existing 640px two-column step is unchanged',
   /@media \(min-width: 640px\) \{\s*body\.f27-mode #free-exam\.f27-exam-competition \.f27-cbt-options \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}\s*\}/.test(before));
ok('the modal Question Navigator is untouched and still the mobile palette',
   /\.f27-cbt-modal \{/.test(before) && /id="freeExamPanel"/.test(html) && /onclick="freeExamPanel\(\)"/.test(html));
ok('the service worker serves the new shell', /const CACHE = 'goc-v222';/.test(read('sw.js')));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
