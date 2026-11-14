/* test-practice-navigation.js — Stage 2: JAMB-style Learning Practice navigation.

   Runs the real practice functions from js/app.js against a stub DOM and
   proves:
     1. a numbered palette with answered / unanswered / current states and an
        answered count, matching the run's marks at every step;
     2. Previous / palette navigation never loses, changes or duplicates an
        answer — revisiting an answered question restores its chosen option,
        the correct option, its feedback and its locks;
     3. Next on the last question routes to the first unanswered question,
        and the review opens only when every question is answered;
     4. instant feedback, explanations, XP-shaped review data and the local
        (unassessed) result contract are unchanged;
     5. formal CBT is untouched (its screen, palette and submit remain, and
        no practice code references it).
   Run:  node test/test-practice-navigation.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var css = fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('missing function ' + name);
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
  throw new Error('unterminated ' + name);
}

function fakeEl() {
  var classes = {};
  var el = { children: [], textContent: '', disabled: false, _html: '', attrs: {} };
  el.classList = {
    add: function (c) { classes[c] = true; },
    contains: function (c) { return !!classes[c]; }
  };
  Object.defineProperty(el, 'className', {
    get: function () { return Object.keys(classes).join(' '); },
    set: function (v) { classes = {}; String(v).split(/\s+/).forEach(function (c) { if (c) classes[c] = true; }); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return el._html; },
    set: function (v) { el._html = v; if (v === '') el.children = []; }
  });
  el.appendChild = function (c) { el.children.push(c); return c; };
  el.setAttribute = function (k, v) { el.attrs[k] = v; };
  el.querySelectorAll = function (sel) {
    if (sel === '.opt') return el.children.filter(function (c) { return c.classList.contains('opt'); });
    return [];
  };
  return el;
}

var els = {};
['pracSub', 'pracNum', 'pracQ', 'pracOpts', 'pracFb', 'pracProg', 'pracPalette', 'pracNavCount', 'pracPrevBtn', 'pracBtn']
  .forEach(function (id) { els[id] = fakeEl(); });

var shown = [], toasts = [];
var sandbox = {
  document: {
    getElementById: function (id) { return els[id] || null; },
    createElement: function () { return fakeEl(); }
  },
  OPT_KEYS: ['A', 'B', 'C', 'D'],
  mth: function (s) { return String(s == null ? '' : s); },
  paintPassage: function () {}, paintQImage: function () {},
  bmButton: function () { return ''; }, askTutorButton: function () { return ''; },
  go: function () {}, toast: function (m) { toasts.push(m); }, refreshMe: function () {},
  srShow: function (r) { shown.push(r); },
  GOC: { api: { rules: { topicBreakdown: function () { return []; } },
                submitStudy: function () { return Promise.reject(new Error('should not be called for a local paper')); } } },
  Promise: Promise
};
var ctx = vm.createContext(sandbox);
vm.runInContext('var pracPaper = null, pracI = 0, pracAnswered = false, pracMarks = [];\n'
  + grab('pracQ') + '\n' + grab('pracAnsweredCount') + '\n' + grab('pracAllAnswered') + '\n'
  + grab('pracFirstUnanswered') + '\n' + grab('pracFbHtml') + '\n' + grab('pracPaintChrome') + '\n'
  + grab('pracGo') + '\n' + grab('pracPrev') + '\n' + grab('renderPrac') + '\n'
  + grab('answerPrac') + '\n' + grab('pracNext') + '\n' + grab('pracFinish') + '\n'
  + grab('pracLocalResult') + '\n' + grab('pracTopicBands'), ctx);

function qs(n, base) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ id: base + i, topic: 'Topic', text: 'Question ' + (i + 1) + '?',
    options: ['w', 'x', 'y', 'z'], answer: i % 4, explanation: 'Because the note says so.' });
  return out;
}
sandbox.pracPaper = { subject: 'Physics', questions: qs(5, 100), xpPerCorrect: 0 };
sandbox.pracI = 0; sandbox.pracMarks = [];
sandbox.renderPrac();

function pal() { return els.pracPalette.children; }
function opts() { return els.pracOpts.querySelectorAll('.opt'); }

head('palette and progress at the start');
ok('one numbered button per question', pal().length === 5 && pal().map(function (b) { return b.textContent; }).join(',') === '1,2,3,4,5');
ok('the first question is current, none answered',
  pal()[0].classList.contains('cur') && !pal().some(function (b) { return b.classList.contains('ans'); }));
ok('the count reads 0 of 5 answered', els.pracNavCount.textContent === '0 of 5 answered', els.pracNavCount.textContent);
ok('Previous is disabled on the first question, Next waits for an answer',
  els.pracPrevBtn.disabled === true && els.pracBtn.disabled === true && els.pracBtn.textContent === 'Select an answer');
ok('the progress strip marks only the current question',
  els.pracProg.children.filter(function (s) { return s.classList.contains('cur'); }).length === 1);

head('answer, then jump away and back — nothing is lost');
var q1 = sandbox.pracPaper.questions[0];
var wrongAt = (q1.answer + 1) % 4;
sandbox.answerPrac(wrongAt, opts()[wrongAt]);
ok('instant feedback still shows at once', /Not quite/.test(els.pracFb.innerHTML) && /Because the note says so/.test(els.pracFb.innerHTML));
ok('the palette marks question 1 answered and still current',
  pal()[0].classList.contains('ans') && pal()[0].classList.contains('cur'));
ok('the count moves to 1 of 5', els.pracNavCount.textContent === '1 of 5 answered');
sandbox.pracGo(2);
ok('palette navigation lands on question 3', sandbox.pracI === 2 && /Question 3 of 5/.test(els.pracNum.textContent));
ok('question 3 is current and unanswered in the palette',
  pal()[2].classList.contains('cur') && !pal()[2].classList.contains('ans') && pal()[0].classList.contains('ans'));
var q3 = sandbox.pracPaper.questions[2];
sandbox.answerPrac(q3.answer, opts()[q3.answer]);
ok('a correct answer elsewhere is marked correct', /Correct/.test(els.pracFb.innerHTML));
sandbox.pracGo(0);
var back = opts();
ok('revisiting question 1 restores the chosen (wrong) option', back[wrongAt].classList.contains('wrong'));
ok('and the correct option alongside it', back[q1.answer].classList.contains('correct'));
ok('and its feedback', /Not quite/.test(els.pracFb.innerHTML));
ok('and every option is locked again', back.every(function (o) { return o.disabled; }));
sandbox.answerPrac(q1.answer, back[q1.answer]);
ok('tapping again cannot change or duplicate the mark',
  sandbox.pracAnsweredCount() === 2 && sandbox.pracMarks.filter(Boolean).length === 2
  && sandbox.pracMarks[0].given === wrongAt);

head('Previous / Next behaviour');
sandbox.pracPrev();
ok('Previous on the first question stays put', sandbox.pracI === 0);
sandbox.pracGo(4);
ok('Previous becomes available after moving', els.pracPrevBtn.disabled === false);
var q5 = sandbox.pracPaper.questions[4];
sandbox.answerPrac(q5.answer, opts()[q5.answer]);
ok('on the last question with gaps, Next offers the unanswered route',
  els.pracBtn.textContent === 'Next unanswered →', els.pracBtn.textContent);
sandbox.pracNext();
ok('Next routes to the first unanswered question (question 2)', sandbox.pracI === 1, sandbox.pracI);
var q2 = sandbox.pracPaper.questions[1];
sandbox.answerPrac(q2.answer, opts()[q2.answer]);
sandbox.pracGo(3);
var q4 = sandbox.pracPaper.questions[3];
sandbox.answerPrac(q4.answer, opts()[q4.answer]);
sandbox.pracGo(4);
ok('with everything answered the last question offers the review',
  els.pracBtn.textContent === 'See your review', els.pracBtn.textContent);
ok('the count reads 5 of 5 answered', els.pracNavCount.textContent === '5 of 5 answered');
sandbox.pracNext();
ok('the review opens with the full local result',
  shown.length === 1 && shown[0].total === 5 && shown[0].answered === 5 && shown[0].correct === 4 && shown[0].wrong === 1
  && shown[0].assessed === false, JSON.stringify(shown[0] && { t: shown[0].total, a: shown[0].answered, c: shown[0].correct }));

head('formal CBT is untouched');
ok('the CBT screen, its palette and its Submit are unchanged',
  /id="cbtSide"/.test(index) && /onclick="submitCBT\(\)"/.test(index) && /id="cbtOpts"/.test(index));
ok('no practice navigation code references the CBT screen',
  !/cbt/.test(grab('pracGo') + grab('pracPaintChrome') + grab('renderPrac')));
ok('the practice palette styles are scoped to #practice only',
  /#practice \.prac-pal\{/.test(css) && !/\.prac-pal\{/.test(css.replace(/#practice \.prac-pal/g, '')));

console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'practice navigation: all checks passed'));
process.exit(fails ? 1 : 0);
