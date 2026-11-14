/* test-free2027-math.js — Free Tutorial questions show their mathematics.
   ----------------------------------------------------------------------------
   Free Tutorial questions are written and imported as text. Where that text
   carries a formula — \frac{1}{2}mv^2, H_2SO_4, E=mc^2 — the candidate used
   to be shown the raw commands, because the Free screens printed question
   text with a plain escape while the original hub's screens set it with the
   hub's own renderer (GOC.core.renderMath). The fix reuses that renderer:
   importer and storage keep the raw text exactly as written, and only the
   moment of display changes.

   This suite checks, in order:
     1. The renderer itself, on the forms a UTME author actually writes.
     2. That prose and prices are never mistaken for formulas, and that no
        question text can put markup of its own on the screen.
     3. That every Free Tutorial surface that shows question text — the
        exam, its result review, the admin preview — goes through fmt().
     4. That the mode is settled before first paint: the last
        server-confirmed mode is remembered, a neutral veil covers the
        wait, and a failed request can never impose a mode.

   Run:  node test/test-free2027-math.js */
'use strict';
var fs = require('fs');
var path = require('path');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var core = require(path.join(APP, 'js/goc-core.js'));
var uiSrc = read('js/free2027-ui.js');
var adminSrc = read('js/free2027-admin.js');
var html = read('index.html');
var f27css = read('css/free2027.css');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var R = function (t) { return core.renderMath(t, { bare: true }); };

/* ------------------------------------------------ 1. the formulas -------- */
head('formulas are set, not spelled out');
ok('a delimited fraction becomes a fraction',
   /class="m-frac"/.test(R('Find $\\frac{1}{2}$ of 10')) && !/\\frac/.test(R('Find $\\frac{1}{2}$ of 10')));
ok('bare LaTeX is recognised the way the hub notes recognise it',
   /class="m-frac"/.test(R('Solve \\frac{3}{4} + \\frac{1}{4}')));
ok('a square root is set with its radicand',
   /class="m-sqrt"/.test(R('Simplify \\sqrt{16}')));
ok('an integral carries its limits',
   /class="m-bigop"/.test(R('Evaluate \\int_0^1 x dx')));
ok('E=mc^2 gains its superscript', /class="m-sup"/.test(R('E=mc^2')) && !/=mc\^2/.test(R('E=mc^2')));
ok('H_2SO_4 gains both subscripts',
   (R('H_2SO_4').match(/class="m-sub"/g) || []).length === 2);
ok('CaCO_3 in a sentence is set in place',
   /class="m-sub"/.test(R('Lime is CaCO_3 today')) && /Lime is/.test(R('Lime is CaCO_3 today')));
ok('a logarithm keeps its base', /class="m-fn">log<\/span><span class="m-sub">10/.test(R('\\log_{10} 100')));
ok('Greek letters become Greek', /α/.test(R('\\alpha + \\beta')) && /β/.test(R('\\alpha + \\beta')));
ok('two formulas in one stem both render',
   (R('If $x^2$ then $\\frac{x}{2}$').match(/class="mth"/g) || []).length >= 2);

/* --------------------------------------------- 2. prose stays prose ------ */
head('prose, prices and hostile text are untouched');
ok('plain prose passes through unchanged', R('Water boils at high temperature') === 'Water boils at high temperature');
ok('a price is not a formula',
   R('A shirt costs $5,000 and a bag $7,500') === 'A shirt costs $5,000 and a bag $7,500');
ok('question markup cannot reach the screen',
   R('<script>alert(1)</script>') === '&lt;script&gt;alert(1)&lt;/script&gt;');
ok('the one-line reading drops the commands',
   core.mathPlain('What is $\\frac{1}{2}$ of 8?') === 'What is 1/2 of 8?',
   core.mathPlain('What is $\\frac{1}{2}$ of 8?'));

/* -------------------------------------- 3. every surface goes through fmt  */
head('every Free Tutorial surface renders through fmt()');
ok('fmt() delegates to the hub renderer, bare, with esc() as the fallback',
   /function fmt\(v\) \{[\s\S]{0,200}?renderMath\(v == null \? '' : v, \{ bare: true \}\)/.test(uiSrc)
   && /function fmtPlain/.test(uiSrc));
ok('the exam stem is rendered', /qt\.innerHTML = q \? fmt\(q\.text\)/.test(uiSrc));
ok('the exam passage is rendered', /pass\.innerHTML = '<b>'[\s\S]{0,120}?fmt\(q\.passage\.text/.test(uiSrc));
ok('exam options are rendered, with a markup-free aria-label',
   /fmt\(o\)/.test(uiSrc) && /aria-label="Option ' \+ letter \+ ': ' \+ esc\(fmtPlain\(o\)\)/.test(uiSrc));
ok('the result review renders stem, passage, options and both answers',
   /'<p>' \+ fmt\(q\.text/.test(uiSrc) && /fmt\(q\.passage\.text/.test(uiSrc)
   && /fmt\(yourText\)/.test(uiSrc) && /fmt\(keyText\)/.test(uiSrc)
   && /letter \+ '\. ' \+ fmt\(text/.test(uiSrc));
ok('the admin preview renders exactly what the candidate will see',
   /function fmt\(v\)/.test(adminSrc) && /fmt\(d\.text/.test(adminSrc) && /fmt\(d\.options\[i\]/.test(adminSrc));
ok('storage is untouched: the rulebook CSV header keeps its raw contract',
   /CSV_HEADER = 'subject,topic,text,optionA/.test(read('js/goc-free-2027.js')));

/* ------------------------------------------ 4. the mode before paint ----- */
head('the correct mode is on screen before anything paints');
ok('applyMode records the server-confirmed mode, and only that',
   /MODE_HINT_KEY = 'goc\.free2027\.modeHint'/.test(uiSrc) && /saveModeHint\(mode, on\)/.test(uiSrc));
ok('the page reads the remembered mode before first paint',
   /localStorage\.getItem\('goc\.free2027\.modeHint'\)/.test(html)
   && /h\.mode === 'free2027'\) document\.body\.classList\.add\('f27-mode'\)/.test(html));
ok('a neutral veil covers the wait and lifts when the mode settles',
   /id="f27Veil"/.test(html) && /body\.f27-pending #f27Veil \{ display: flex; \}/.test(f27css)
   && /body\.classList\.remove\('f27-pending'\)/.test(uiSrc));
ok('a failed request never imposes a mode: boot falls back, then asks again',
   /function bootFallback\(\)/.test(uiSrc) && /scheduleBootRetry\(\)/.test(uiSrc)
   && /No answer is not an answer/.test(uiSrc));
ok('the landing fallback cannot force the original page over Free mode',
   /if \(document\.body\.classList\.contains\('f27-mode'\)\) return;/.test(html));
ok('the service worker serves the new shell', /const CACHE = 'goc-v220';/.test(read('sw.js')));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
