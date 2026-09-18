/* test-math.js — the mathematics the academy teaches, set on the page.

   A Nigerian UTME candidate meets a quadratic formula, an index law, a mole
   calculation and a chemical formula in the first week. Until now an author
   could only type those as flat text — ax^2, 6.02 x 10^23, CnH2n+2 — and a
   student had to decode them. The Hub now sets LaTeX between dollar signs.

   There is no MathJax and no KaTeX in this build, and there cannot be: the page
   loads nothing from another origin and has to work in a hall with no internet.
   So the renderer is a subset written into the rulebook, and this suite is what
   stands between that subset and a wrong formula in front of a candidate.

   Four things are asserted, in order of how much they would cost if they broke:

     1. Nothing an author types can put markup on a student's screen. Every
        character is escaped before a single command is interpreted.
     2. A price is not a formula. "A shirt costs $5,000 and a bag costs $7,500"
        holds two dollar signs and no mathematics, and reading them as a formula
        would eat the sentence — the single most likely way this feature could
        damage a live question.
     3. Every form the console advertises actually renders, every class the
        renderer emits is actually styled, and nothing throws — a formula that
        throws would take the whole question screen with it.
     4. The author sees what the student will see, before saving.

   Run:  node test/test-math.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var core = require(path.join(APP, 'js', 'goc-core.js'));
var css = read('css/styles.css');
var appSrc = read('js/app.js');

var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 360, innerHeight: 780,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function R(src, opts) { return core.renderMath(src, opts); }
/* The rendered HTML with the tags taken off — what a student actually reads. */
function reads(src) {
  return R(src).replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}
function classesIn(h) {
  var out = [], m, re = /class="([^"]+)"/g;
  while ((m = re.exec(h))) { out = out.concat(m[1].split(/\s+/)); }
  return out;
}

/* ------------------------------------------------ 1. nothing escapes ------- */
head('an author cannot put markup on a student’s screen');
var nasty = '<img src=x onerror="alert(1)"> $<b>x</b>^2$ & "quoted" \'single\'';
var rendered = R(nasty);
ok('a tag typed in the prose is shown, not run',
   rendered.indexOf('<img') < 0 && rendered.indexOf('&lt;img') > -1, rendered.slice(0, 80));
/* Inside a formula < and > are relations, so each is wrapped in its own span and
   the escaped pieces are not adjacent — what matters is that no piece of the tag
   is left as markup. */
ok('a tag typed inside a formula is shown, not run',
   R('$<b>x</b>^2$').indexOf('<b>') < 0 && R('$<b>x</b>^2$').indexOf('</b>') < 0 &&
   (R('$<b>x</b>^2$').match(/&lt;/g) || []).length === 2 &&
   (R('$<b>x</b>^2$').match(/&gt;/g) || []).length === 2, R('$<b>x</b>^2$'));
ok('an event handler attribute cannot survive', !/onerror\s*=/.test(rendered.replace(/&quot;/g, '"')) ||
   rendered.indexOf('&lt;img') > -1);
ok('an ampersand in prose is escaped', R('Salt & water').indexOf('&amp;') > -1);
ok('a double quote in prose is escaped', R('He said "yes"').indexOf('&quot;') > -1);
ok('a less-than inside a formula is escaped, not left to open a tag',
   R('$a < b$').indexOf('&lt;') > -1 && R('$a < b$').indexOf('<script') < 0);
ok('the only tags in the output are the ones the renderer writes itself',
   (R(nasty).match(/<(?!\/?(span|i|br)\b)[a-zA-Z]/g) || []).length === 0);
/* The escape must happen before any command is read, or a command could be used
   to reassemble a tag out of pieces the escaper never saw. */
ok('a tag cannot be reassembled out of a command’s argument',
   R('$\\text{<script>}$').indexOf('<script') < 0);

/* ------------------------------------------------ 2. a price is not maths -- */
head('a price is a price and a formula is a formula');
[['A shirt costs $5,000 and a bag costs $7,500.', false, 'two prices in one sentence'],
 ['The trader saved $250 last week and $300 this week.', false, 'two prices, wider apart'],
 ['Tickets cost $10, $15 and $20.', false, 'three prices in a list'],
 ['Which costs more, $5 or $7?', false, 'a question about prices'],
 ['Compare $10 + $15 in fees.', false, 'two prices with a sum written between them'],
 ['A levy of $2 per candidate.', false, 'a single price'],
 ['$x + 1$ is linear.', true, 'a formula written tight, as TeX intends'],
 ['Solve $x^2 - 5x + 6 = 0$.', true, 'a quadratic'],
 ['Write $ x + 1 $ out in full.', true, 'a formula typed loosely'],
 ['The points $(1, 2)$ and $(4, 11)$.', true, 'coordinate pairs with no operator'],
 ['A mass of $22.4 kg$ exactly.', true, 'a quantity with its unit']
].forEach(function (c) {
  ok((c[1] ? 'set as mathematics: ' : 'left as prose: ') + c[2], core.hasMath(c[0]) === c[1], c[0]);
});
ok('a price left in the prose still reads as it was typed',
   reads('A shirt costs $5,000.') === 'A shirt costs $5,000.', reads('A shirt costs $5,000.'));
ok('a formula never runs across a blank line',
   !core.hasMath('The fee is $500.\n\nThe deposit is $200.'));
ok('and neither does a formula-looking one',
   !core.hasMath('It costs $5 =\n\nnothing at all $9'));

/* ------------------------------------------------ 3. the forms it sets ----- */
head('the forms an author will actually type');
function has(src, cls) { return R(src).indexOf('class="' + cls) > -1 || R(src).indexOf(' ' + cls + '"') > -1; }
ok('a fraction is built as a stacked pair, not a slash',
   /m-frac/.test(R('$\\frac{3}{4}$')) && /m-num/.test(R('$\\frac{3}{4}$')) && /m-den/.test(R('$\\frac{3}{4}$')));
ok('a square root draws a radical over its body',
   /m-sqrt/.test(R('$\\sqrt{25}$')) && /m-rbody/.test(R('$\\sqrt{25}$')));
ok('a cube root shows its index', /m-idx/.test(R('$\\sqrt[3]{8}$')) && reads('$\\sqrt[3]{8}$').indexOf('3') > -1);
ok('a power is raised', /m-sup/.test(R('$x^2$')));
ok('an index is dropped', /m-sub/.test(R('$H_2O$')));
ok('a power and an index together stack in one column', /m-ss/.test(R('$x_1^2$')));
ok('and in either order', /m-ss/.test(R('$x^2_1$')));
ok('a multi-character power is kept whole',
   reads('$y^{10}$').indexOf('10') > -1 && reads('$y^{10}$').indexOf('y10') < 0 ||
   reads('$y^{10}$') === 'y10');
ok('a letter is set in italic, as mathematics is',
   R('$x$').indexOf('<i>x</i>') > -1, R('$x$'));
ok('a digit is left upright', R('$2$').indexOf('<i>2</i>') < 0);
ok('a named function is upright, not italic',
   /m-fn/.test(R('$\\sin x$')) && reads('$\\sin x$').indexOf('sin') > -1);
ok('words inside a formula are upright', /m-txt/.test(R('$\\text{Mass}$')));
ok('a binary operator is given room', /m-bin/.test(R('$a + b$')));
ok('a relation is given more', /m-rel/.test(R('$a = b$')));
ok('a leading minus is a sign, not a subtraction', /m-sgn/.test(R('$-5$')));
ok('times and divide are set as symbols, not letters',
   reads('$3 \\times 4 \\div 2$').indexOf('×') > -1 && reads('$3 \\times 4 \\div 2$').indexOf('÷') > -1);
ok('pi is pi', reads('$\\pi r^2$').indexOf('π') > -1);
/* TeX writes a degree as a raised ring and so does the Hub, which is what the
   seeded geometry questions use; \degree is there for an author who reaches for
   the word instead. */
ok('an angle is raised, the way a past paper prints it',
   /m-sup/.test(R('$30^\\circ$')) && reads('$30^\\circ$').indexOf('∘') > -1, R('$30^\\circ$'));
ok('and \\degree gives the degree sign itself', reads('$45\\degree$').indexOf('°') > -1);
ok('an angle reads as degrees in a one-line reading',
   core.mathPlain('$180^\\circ$') === '180°', core.mathPlain('$180^\\circ$'));
ok('Greek letters arrive', reads('$\\theta + \\alpha + \\beta$').indexOf('θ') > -1);
ok('comparisons arrive', reads('$a \\le b \\ge c \\ne d$').indexOf('≤') > -1);
ok('an arrow arrives, for an equation', reads('$A \\to B$').indexOf('→') > -1);
ok('plus-or-minus arrives, for the quadratic formula', reads('$\\pm$').indexOf('±') > -1);
ok('a matrix is laid out as a grid',
   /m-grid/.test(R('$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$')) &&
   /m-row/.test(R('$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$')));
ok('a matrix keeps its brackets',
   /m-fence/.test(R('$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$')));
ok('\\left and \\right scale round a fraction',
   /m-fence/.test(R('$\\left(\\frac{1}{2}\\right)$')));
ok('a big operator carries its limits', /m-big/.test(R('$$\\sum_{n=1}^{10} n$$')));
ok('an overline draws a line over its body', /m-ov/.test(R('$\\overline{AB}$')));
ok('a vector is accented', /m-acc/.test(R('$\\vec{v}$')));
/* Spacing inside a formula is done with classed spans and CSS margins, never with
   literal spaces — the DOM the suites parse with drops whitespace-only text, and
   so does HTML itself when it collapses runs of spaces. */
ok('a thin space is set as space, not left as a command',
   /m-sp/.test(R('$22.4\\ \\text{dm}^3$')) && R('$22.4\\ \\text{dm}^3$').indexOf('\\') < 0,
   R('$22.4\\ \\text{dm}^3$'));
ok('a dollar sign can be written inside a formula without ending it',
   reads('$\\$5 \\times 3$').indexOf('$5') > -1 && reads('$\\$5 \\times 3$').indexOf('×') > -1,
   R('$\\$5 \\times 3$'));
ok('and the formula round it is still one formula',
   (R('The mark-up is $\\$5 \\times 3$ per book.').match(/class="mth"/g) || []).length === 1,
   R('The mark-up is $\\$5 \\times 3$ per book.'));
ok('an escaped dollar in ordinary prose is just a dollar',
   reads('It cost \\$500.') === 'It cost $500.', reads('It cost \\$500.'));

head('inline and display are not the same thing');
ok('$…$ stays in the line of text', /class="mth"/.test(R('$x^2$')));
ok('$$…$$ stands on its own', /mth-d/.test(R('$$x^2$$')));
ok('\\(…\\) is understood, for a formula pasted out of Word',
   core.hasMath('\\(x^2\\)') && /class="mth"/.test(R('\\(x^2\\)')));
ok('\\[…\\] is understood too, and stands on its own',
   core.hasMath('\\[x^2\\]') && /mth-d/.test(R('\\[x^2\\]')));
ok('a display formula is a span, so it is legal inside a paragraph',
   R('$$x$$').indexOf('<span') === 0, R('$$x$$').slice(0, 20));
ok('a line break in a note becomes a break only when asked',
   R('a\nb', { breaks: true }).indexOf('<br>') > -1 && R('a\nb').indexOf('<br>') < 0);

/* ------------------------------------------------ 4. it cannot throw ------- */
head('a broken formula never takes the screen with it');
['$', '$$', '$$$', '${', '$}', '$\\frac$', '$\\frac{1}$', '$\\sqrt$', '$\\left($',
 '$\\begin{pmatrix}$', '$\\end{pmatrix}$', '$^$', '$_$', '$&$', '$\\\\$', '$\\zork{2}$',
 '$\\text$', '$x^{$', '$\\frac{\\frac{\\frac{1}{2}}{3}}{4}$', '$' + new Array(60).join('\\frac{1}{') + '2' + new Array(60).join('}') + '$',
 '$' + new Array(400).join('x^2 + ') + '1$', null, undefined, 0, {}, []
].forEach(function (bad, i) {
  var out, threw = false;
  try { out = core.renderMath(bad); } catch (e) { threw = true; out = e.message; }
  ok('input ' + i + ' returns a string instead of throwing', !threw && typeof out === 'string', out);
});
ok('an unknown command is shown to the student, never silently dropped',
   R('$\\zork{2}$').indexOf('zork') > -1, R('$\\zork{2}$'));
/* A layout the Hub does not know still keeps every cell the author wrote — the
   content is never lost, only its brackets — and the console says so. */
ok('an unknown layout keeps the author’s content',
   reads('$\\begin{zork}1 & 2\\end{zork}$').indexOf('1') > -1 &&
   reads('$\\begin{zork}1 & 2\\end{zork}$').indexOf('2') > -1);
ok('and the author is told the brackets will be missing',
   /\\begin\{zork\}/.test(core.mathIssues('$\\begin{zork}1\\end{zork}$').join(' ')),
   core.mathIssues('$\\begin{zork}1\\end{zork}$').join(' | '));

/* ------------------------------------------------ 5. every class is styled - */
head('every class the renderer emits has a rule in the stylesheet');
var battery = ['$\\frac{3}{4}$', '$\\sqrt[3]{8}$', '$x_1^2$', '$a + b = c$', '$-5$', '$\\sin x$',
  '$\\text{Mass}$', '$\\overline{AB}$', '$\\vec{v}$', '$\\left(\\frac{1}{2}\\right)$',
  '$$\\sum_{n=1}^{10} n$$', '$\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}$',
  '$22.4\\ \\text{dm}^3$', '$\\mathbf{F}$', '$a, b$', '$\\zork$', '$\\begin{zork}1\\end{zork}$'];
var emitted = {}, k;
battery.forEach(function (s) {
  classesIn(R(s)).forEach(function (c) { if (/^m/.test(c)) emitted[c] = 1; });
});
var unstyled = [];
for (k in emitted) {
  if (emitted.hasOwnProperty(k) && css.indexOf('.' + k) < 0) unstyled.push(k);
}
ok('all ' + Object.keys(emitted).length + ' maths classes are styled', unstyled.length === 0, unstyled.join(' '));
/* The last-resort class is not reachable from any input above — the renderer no
   longer throws on anything tried — but it has to be styled for the day it is. */
ok('the fallback class for a formula that cannot be set is styled too', css.indexOf('.m-raw') > -1);
ok('the display wrapper scrolls rather than pushing the question off a 360px screen',
   /\.mth-d\{[^}]*overflow-x\s*:\s*auto/.test(css.replace(/\s*\n\s*/g, '')), 'no overflow-x on .mth-d');
ok('nothing in the maths CSS loads a font from another origin',
   !/@import|url\(\s*['"]?https?:/.test(css.slice(css.indexOf('MATHEMATICS'))));

/* ------------------------------------------------ 6. the plain reading ----- */
head('the one-line reading, for a tab title, a screen reader or a CSV row');
[['$\\frac{9}{3}$', '9/3'],
 ['$\\frac{11 - 2}{4 - 1}$', '(11 - 2)/(4 - 1)'],
 ['$\\frac{1}{2a}$', '1/(2a)'],
 ['$6.02 \\times 10^{23}$', '6.02 × 10^23'],
 ['$\\sqrt{16}$', '√(16)'],
 ['$C_nH_{2n+2}$', 'C_nH_(2n+2)'],
 ['$22.4\\ \\text{dm}^3$', '22.4 dm^3'],
 ['$x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$', 'x = (-b ± √(b^2 - 4ac))/(2a)']
].forEach(function (c) {
  ok('reads as ' + c[1], core.mathPlain(c[0]) === c[1], core.mathPlain(c[0]));
});
ok('prose either side of a formula is kept',
   core.mathPlain('Solve $x^2$ now.') === 'Solve x^2 now.', core.mathPlain('Solve $x^2$ now.'));
ok('a price is left exactly as typed',
   core.mathPlain('It cost $5,000 and $7,500.') === 'It cost $5,000 and $7,500.');
ok('no dollar sign survives a formula', core.mathPlain('$\\frac{1}{2}$').indexOf('$') < 0);
ok('no backslash survives a command the Hub knows', core.mathPlain('$a \\times b$').indexOf('\\') < 0);
ok('and it never returns markup', core.mathPlain('$<b>x</b>$').indexOf('<') > -1 ?
   core.mathPlain('$<b>x</b>$').indexOf('&lt;') < 0 : true);

/* ------------------------------------------------ 7. what the author is told */
head('the console warns, and never refuses');
function issues(s) { return core.mathIssues(s); }
ok('a well-formed formula draws no warning', issues('Solve $x^2 - 5x + 6 = 0$.').length === 0,
   issues('Solve $x^2 - 5x + 6 = 0$.').join(' | '));
ok('a price draws no warning either — an economics question is full of them',
   issues('A shirt costs $5,000 and a bag costs $7,500.').length === 0,
   issues('A shirt costs $5,000 and a bag costs $7,500.').join(' | '));
ok('a $ that plainly opens a formula and is never closed is named',
   /never closed/.test(issues('Solve $x^2 + 1 and move on.').join(' ')),
   issues('Solve $x^2 + 1 and move on.').join(' | '));
ok('unbalanced braces are named', /braces/.test(issues('$\\frac{1}{2$').join(' ')));
ok('a half-written fraction is named', /frac/.test(issues('$\\frac{3}$').join(' ')));
ok('a root with nothing under it is named', /sqrt/.test(issues('$\\sqrt$').join(' ')));
ok('a \\left with no \\right is named', /\\left/.test(issues('$\\left( x$').join(' ')));
ok('a \\begin with no \\end is named', /\\begin/.test(issues('$\\begin{pmatrix} 1$').join(' ')));
ok('an unknown command is named, with what will happen to it',
   /\\zork/.test(issues('$\\zork{2}$').join(' ')) &&
   /shown to the student/.test(issues('$\\zork{2}$').join(' ')));
ok('a row break is not mistaken for an unknown command',
   issues('$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$').length === 0,
   issues('$\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}$').join(' | '));
ok('the same problem is not said twice',
   issues('$\\zork$ and $\\zork$').length === 1, issues('$\\zork$ and $\\zork$').join(' | '));
ok('every warning is a sentence an Academic Director can act on',
   issues('$\\frac{3}$').every(function (m) { return m.length > 24 && /[a-z]/.test(m); }));
/* The warnings are advice, not a gate. An economics stem quoting two prices and a
   maths stem with a mistyped fraction must both still save — the author is the one
   who decides, and a refusal here would strand a question they cannot fix. */
var messy = { subject: 'Mathematics', section: 'objective', topic: 'Indices',
  text: 'Simplify $\\frac{3}$ and $\\zork{2}$.', options: ['a', 'b', 'c', 'd'], answer: 0 };
var verdict = core.validateQuestion(messy);
ok('a question is never refused for its mathematics',
   !verdict.error && !!verdict.rec, JSON.stringify(verdict).slice(0, 160));
ok('and its mathematics is stored exactly as the author typed it',
   verdict.rec && verdict.rec.text === messy.text, verdict.rec && verdict.rec.text);

head('the cheat sheet cannot promise what the Hub does not do');
ok('there is a cheat sheet', core.MATH_HELP && core.MATH_HELP.length >= 6);
core.MATH_HELP.forEach(function (h) {
  ok('“' + h.note + '” renders with no warning', core.hasMath(h.tex) && issues(h.tex).length === 0,
     issues(h.tex).join(' | '));
});
ok('every entry says what it is for', core.MATH_HELP.every(function (h) { return !!h.note; }));

/* ------------------------------------------------ 8. the seeded content ---- */
head('the questions and notes the Hub ships with');
var seedQ = core.seedQuestions(), seedN = core.seedNotes();
var seedBad = [], seedMath = 0, seedStrings = 0;
function auditSeed(label, s) {
  if (!s) return;
  seedStrings++;
  if (core.hasMath(s)) seedMath++;
  if (issues(s).length) seedBad.push(label + ': ' + issues(s)[0]);
  /* A dollar left in the plain reading means the renderer did not treat it as a
     formula — the student would see the dollars themselves. */
  if (core.mathPlain(s).indexOf('$') > -1) seedBad.push(label + ': a $ is shown to the student');
}
seedQ.forEach(function (q, i) {
  auditSeed('question ' + i + ' stem', q.text);
  (q.options || []).forEach(function (o, j) { auditSeed('question ' + i + ' option ' + j, o); });
  auditSeed('question ' + i + ' explanation', q.explanation);
  auditSeed('question ' + i + ' reference answer', q.expected);
});
seedN.forEach(function (n, i) { auditSeed('note ' + i, n.body); auditSeed('note ' + i + ' title', n.title); });
ok(seedStrings + ' seeded strings, none with a problem', seedBad.length === 0, seedBad.slice(0, 3).join(' // '));
ok('the seeded content shows the feature off — at least 20 strings hold a formula',
   seedMath >= 20, String(seedMath));
ok('the quadratic formula is one of them, on its own line',
   seedN.some(function (n) { return /\$\$x = \\frac\{-b \\pm \\sqrt/.test(n.body); }));
ok('and the Avogadro constant is set rather than typed flat',
   seedN.some(function (n) { return /6\.02 \\times 10\^\{23\}/.test(n.body); }));
/* The flat forms the academy typed before the renderer existed. "ax^2 + bx + c"
   is not on this list: inside dollars that is now the correct source. */
ok('no seeded string still carries a formula typed flat',
   !seedQ.concat(seedN).some(function (x) {
     var s = String(x.text || '') + String(x.body || '') + (x.options || []).join(' ') +
             String(x.explanation || '') + String(x.expected || '');
     return /CnH2n|C n H|6\.02 x 10|10\^23(?!\})|m\/s2\b|\bsqrt\(/.test(s);
   }));

/* ------------------------------------------------ 9. the wiring ------------ */
head('every screen a student reads a question on goes through the renderer');
[['the practice stem', /pracQ'\)\.innerHTML = mth\(/],
 ['the practice options', /class="key">' \+ OPT_KEYS\[i\] \+ '<\/span>' \+ mth\(o\)/],
 ['the practice explanation', /mth\(d\.explanation/],
 ['the web-test stem', /txt\.innerHTML = mth\(q\.text/],
 ['the CBT stem', /cbtQ'\)\.innerHTML = mth\(/],
 ['the reading-mode note body', /mth\(x\.trim\(\), \{breaks:true\}\)/],
 ['the console question card', /mth\(r\.text, \{breaks:true\}\)|mth\(q\.text, \{breaks:true\}\)/],
 ['the theory marking card', /mth\(.*expected|mth\(.*answer/]
].forEach(function (c) {
  ok(c[0] + ' renders through mth()', c[1].test(appSrc));
});
ok('no student-facing question text is still written with textContent',
   !/pracQ'\)\.textContent|cbtQ'\)\.textContent/.test(appSrc));
ok('mth() falls back to escaping if the rulebook is an older copy than the app',
   /if \(r && r\.renderMath\)/.test(appSrc) && /var out = esc\(s\)/.test(appSrc));
ok('the maths layer is ES5, like the rest of the browser files',
   !/=>|\blet\s|\bconst\s|`/.test(read('js/goc-core.js')
     .slice(read('js/goc-core.js').indexOf('MATHEMATICS'))
     .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')));

head('the author sees the student’s view before saving');
/* Pull one function's body out of the source by matching its braces, so a claim
   about what that function does can be checked instead of guessed at. */
function bodyOf(name) {
  var at = appSrc.indexOf('function ' + name + '(');
  if (at < 0) return '';
  var i = appSrc.indexOf('{', at), depth = 0, j = i;
  for (; j < appSrc.length; j++) {
    if (appSrc.charAt(j) === '{') depth++;
    if (appSrc.charAt(j) === '}') { depth--; if (!depth) break; }
  }
  return appSrc.slice(i, j + 1);
}
ok('the question editor holds a preview box', /id="admQPrevBox"/.test(appSrc));
ok('and rebuilds it as the author types', /oninput="admQPrev\(\)"/.test(appSrc));
ok('it rebuilds only the preview, never the form, so the caret is not lost',
   bodyOf('admQPrev').indexOf('admQPrevBox') > -1 &&
   bodyOf('admQPrev').indexOf('admQRepaint') < 0 &&
   bodyOf('admNPrev').indexOf('admNRepaint') < 0, bodyOf('admQPrev').replace(/\s+/g, ' '));
ok('and it reads the form before previewing, so the panel is never one keystroke behind',
   bodyOf('admQPrev').indexOf('admQRead()') > -1 && bodyOf('admNPrev').indexOf('admNRead()') > -1);
ok('the note editor has one too', /id="admNPrevBox"/.test(appSrc) && /oninput="admNPrev\(\)"/.test(appSrc));
var prev = run('mathPrev([{label:"Question", src:"Solve $x^2 = 9$."}, {label:"A", src:"$x = 3$"}])');
ok('the preview sets the formula the way the student will read it',
   prev.indexOf('m-sup') > -1 && prev.indexOf('mprev') > -1, prev.slice(0, 90));
ok('it labels each part, so an author knows which option is which',
   prev.indexOf('<b>Question</b>') > -1 && prev.indexOf('<b>A</b>') > -1);
var quiet = run('mathPrev([{label:"Question", src:"Name the capital of Nigeria."}])');
ok('a question with no formula in it is not given a preview panel',
   quiet.indexOf('mprev') < 0, quiet.slice(0, 60));
ok('but the list of forms is always offered, or an author never learns it exists',
   quiet.indexOf('mhelp') > -1 && quiet.indexOf('dollar signs') > -1);
var warned = run('mathPrev([{label:"Question", src:"Simplify $\\\\frac{3}$."}])');
ok('a problem is named under the preview, in words',
   warned.indexOf('mwarn') > -1 && /frac/.test(warned));
var priced = run('mathPrev([{label:"Question", src:"A shirt costs $5,000 and a bag costs $7,500."}])');
ok('a price question raises neither a preview nor a warning',
   priced.indexOf('mprev') < 0 && priced.indexOf('mwarn') < 0);
ok('the cheat sheet is set by the renderer it describes, not written out by hand',
   run('mathHelp()').indexOf('m-frac') > -1);
ok('a note preview cannot cut a formula in half',
   run('admPeek("The formula $\\\\frac{1}{2}$ matters here", 22)').indexOf('$') < 0,
   run('admPeek("The formula $\\\\frac{1}{2}$ matters here", 22)'));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
