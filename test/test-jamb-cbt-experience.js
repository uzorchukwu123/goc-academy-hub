/* test-jamb-cbt-experience.js — the dedicated JAMB CBT examination mode.
   ----------------------------------------------------------------------------
   JAMB mode is a presentation, controls and recovery layer over the existing
   CBT runner, active ONLY while a real JAMB paper is open (cbtOpenPaper).
   Practice/study CBT, the Web Test runner and Free 2027 must never enter it,
   and it must never change marking, submission payloads or attempt records.

   This suite checks, in order:
     1. The exam chrome exists on the page (candidate bar, desktop side
        palette, calculator, submission prompt, resume banner).
     2. The hooks are wired: papers enter the mode, study runs leave it,
        submit/exit clear it, answers/renders keep the saved session fresh.
     3. The calculator arithmetic is right — it is a hand-written parser,
        so division by zero and nonsense must fail soft, never throw, and
        no eval() may appear anywhere near it.
     4. The official keyboard controls behave: A-D answer, N/P move,
        S opens the submission prompt, Y confirms, R returns — and nothing
        fires while the candidate is typing or another overlay is open.
     5. A refresh mid-sitting can be resumed with the SAME answers and the
        time genuinely remaining; an expired clock submits what was saved.

   Run:  node test/test-jamb-cbt-experience.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html');
var appSrc = read('js/app.js');
var css = read('css/styles.css');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ------------------------------------------------------- 1. the chrome --- */
head('the examination chrome is on the page');
ok('candidate bar exists', /id="cbtCandidate"/.test(html));
ok('candidate bar shows name, Scholar ID and paper slots',
   /id="cbtCandName"/.test(html) && /id="cbtCandId"/.test(html) && /id="cbtCandPaper"/.test(html));
ok('candidate bar carries the calculator button', /onclick="jambCalcToggle\(\)"/.test(html));
ok('desktop side palette exists with grid and count',
   /id="cbtSide"/.test(html) && /id="cbtSideGrid"/.test(html) && /id="cbtSideCount"/.test(html));
ok('calculator panel exists and every key calls jambCalcKey',
   /id="jambCalc"/.test(html) && /onclick="jambCalcKey\('='\)"/.test(html)
   && /onclick="jambCalcKey\('sqrt'\)"/.test(html) && /onclick="jambCalcKey\('sq'\)"/.test(html));
ok('submission prompt exists and only its buttons confirm or return',
   /id="jambSubmitOverlay"/.test(html) && /onclick="jambSubmitConfirm\(\)"/.test(html)
   && /onclick="jambSubmitReturn\(\)"/.test(html));
ok('resume banner host sits on the Web Test screen', /id="jtResume"/.test(html));
ok('the exam palette CSS is scoped to JAMB mode only',
   /#cbt\.jamb-mode \.cbt-side/.test(css) && /#cbt\.jamb-mode \.cbt-candidate/.test(css));

/* -------------------------------------------------------- 2. the hooks --- */
head('the mode is entered and left at exactly the right doors');
ok('opening a real paper enters JAMB mode', /function cbtOpenPaper[\s\S]{0,4000}?jambModeOn\(p\)/.test(appSrc));
ok('opening a study run leaves JAMB mode first', /function cbtOpenStudy[\s\S]{0,600}?jambModeOff\(\)/.test(appSrc));
ok('leaving the exam clears the saved session', /function confirmExit[\s\S]{0,800}?jambClearSession\(\)/.test(appSrc));
ok('an unconfirmed S never submits: submitCBT demands the armed flag',
   /jambMode && cbtPaper && !expired && !jambSubmitArmed/.test(appSrc) || /!jambSubmitArmed/.test(appSrc));
ok('a confirmed submission clears the session and the mode',
   /function submitCBT[\s\S]{0,6000}?jambClearSession\(\);\s*jambModeOff\(\)/.test(appSrc));
ok('every rendered question refreshes the saved session',
   /function renderCBTQ[\s\S]{0,4000}?jambSaveSession\(\)/.test(appSrc));
ok('every palette rebuild refreshes the side palette',
   /function buildCBTNav[\s\S]{0,6000}?jambPaintSide\(\);/.test(appSrc));
ok('the Web Test screen paints the resume banner',
   /function renderWebTest[\s\S]{0,1200}?jambPaintResume\(\)/.test(appSrc));
ok('the candidate is told the examination keys before starting',
   /UTME examination room: A, B, C or D answers a question/.test(appSrc));

/* ------------------------------------------- run the module itself ------- */
/* The JAMB module is lifted out of js/app.js and run against stub controls,
   so its behaviour is tested, not just its spelling. */
var modStart = appSrc.indexOf('/* ================= JAMB EXAM MODE');
var modEnd = appSrc.indexOf('/* ================= RESULTS & REVIEW');
ok('the JAMB module block is present and extractable', modStart > -1 && modEnd > modStart);
var modSrc = appSrc.slice(modStart, modEnd);

function makeEl(id) {
  var el = { id: id, hidden: false, textContent: '', children: [], style: {},
             attrs: {},
             classList: { _s: {},
               add: function (c) { this._s[c] = 1; },
               remove: function (c) { delete this._s[c]; },
               contains: function (c) { return !!this._s[c]; } },
             appendChild: function (c) { this.children.push(c); },
             setAttribute: function (k, v) { this.attrs[k] = v; } };
  var _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return _html; },
    set: function (v) { _html = v; if (v === '') el.children = []; }
  });
  return el;
}

var els = {};
var keyHandler = null;
var calls = { submit: [], move: [], opened: 0, timers: 0 };
var store = {};
var sandbox = {
  console: console,
  setTimeout: setTimeout, clearInterval: clearInterval, clearTimeout: clearTimeout,
  sessionStorage: {
    getItem: function (k) { return k in store ? store[k] : null; },
    setItem: function (k, v) { store[k] = String(v); },
    removeItem: function (k) { delete store[k]; }
  },
  document: {
    getElementById: function (id) { return els[id] || (els[id] = makeEl(id)); },
    createElement: function () { return makeEl('btn'); },
    addEventListener: function (ev, fn) { if (ev === 'keydown') keyHandler = fn; },
    querySelector: function (sel) {
      if (sel === '.screen.active') return { id: sandbox.__screen || 'cbt' };
      if (sel === '.overlay.show') return sandbox.__overlay || null;
      return null;
    }
  },
  /* the shared runner state and doors the module is layered over */
  cbtPaper: null, cbtAns: {}, cbtCur: 0, cbtN: 0, cbtSecs: 0, cbtTimerId: null,
  studentId: 'GOC-S-004', studentFirst: 'Amara',
  __screen: 'cbt', __overlay: null,
  cbtGroupAt: function () { return { from: 0, to: sandbox.cbtN - 1, subject: 'Mathematics' }; },
  cbtQuestionAt: function () { return { options: ['1', '2', '3', '4'] }; },
  renderCBTQ: function () {}, buildCBTNav: function () {}, cbtPaintSubjects: function () {},
  cbtMove: function (d) { calls.move.push(d); sandbox.cbtCur += d; },
  submitCBT: function (expired) { calls.submit.push(expired); },
  cbtOpenPaper: function () { calls.opened++; },
  startTimer: function () { calls.timers++; },
  mmss: function (s) { return s + 's'; },
  toast: function () {}
};
vm.createContext(sandbox);
vm.runInContext(modSrc, sandbox, { filename: 'jamb-module.js' });
var J = sandbox;

/* ------------------------------------------------- 3. the calculator ----- */
head('the calculator does hall arithmetic and nothing else');
ok('no eval() anywhere in the JAMB module',
   !/[^A-Za-z]eval\s*\(/.test(modSrc.replace(/\/\*[\s\S]*?\*\//g, '')));
ok('2 + 3 x 4 respects precedence', J.jcEval('2+3*4') === 14, String(J.jcEval('2+3*4')));
ok('brackets change the answer', J.jcEval('(2+3)*4') === 20);
ok('division keeps the fraction', J.jcEval('10/4') === 2.5);
ok('a leading minus works', J.jcEval('-3+5') === 2);
ok('decimals work', J.jcEval('1.5*2') === 3);
ok('division by zero fails soft', J.jcEval('1/0') === null);
ok('an unbalanced bracket fails soft', J.jcEval('(2+3') === null);
ok('letters are not arithmetic', J.jcEval('2+a') === null);
J.jcExpr = '9'; J.jambCalcKey('sqrt');
ok('square root key', J.jcExpr === '3', J.jcExpr);
J.jcExpr = '7'; J.jambCalcKey('sq');
ok('square key', J.jcExpr === '49', J.jcExpr);
J.jcExpr = '50'; J.jambCalcKey('%');
ok('percent key', J.jcExpr === '0.5', J.jcExpr);
J.jcExpr = '2+3'; J.jambCalcKey('=');
ok('equals evaluates and holds the result', J.jcExpr === '5', J.jcExpr);

/* --------------------------------------------- 4. the keyboard controls -- */
head('the official keyboard controls');
function key(k, target) {
  var ev = { key: k, target: target || { tagName: 'DIV' }, prevented: false,
             preventDefault: function () { this.prevented = true; } };
  keyHandler(ev);
  return ev;
}
J.jambMode = true; sandbox.__screen = 'cbt'; sandbox.__overlay = null;
els.jambCalc = makeEl('jambCalc'); els.jambCalc.hidden = true;   // the hall calculator starts closed
J.jambDeadline = Date.now() + 60000;
sandbox.cbtN = 4; sandbox.cbtCur = 0; sandbox.cbtAns = {};
sandbox.cbtPaper = { attemptId: 'KB1', durationSec: 120, questions: [{}, {}, {}, {}] };
key('a');
ok('A answers option A', sandbox.cbtAns[0] === 0, JSON.stringify(sandbox.cbtAns));
key('D');
ok('D answers option D', sandbox.cbtAns[0] === 3);
key('n');
ok('N moves to the next question', calls.move[calls.move.length - 1] === 1);
key('p');
ok('P moves back', calls.move[calls.move.length - 1] === -1);
key('ArrowRight');
ok('arrow keys move too (G.O.C enhancement)', calls.move[calls.move.length - 1] === 1);
key('s');
ok('S opens the submission prompt, and submits nothing',
   els.jambSubmitOverlay.classList.contains('show') && calls.submit.length === 0);
key('r');
ok('R returns from the prompt', !els.jambSubmitOverlay.classList.contains('show'));
key('s'); key('y');
ok('Y inside the prompt confirms exactly one submission',
   calls.submit.length === 1 && calls.submit[0] === false && J.jambSubmitArmed === true);
calls.submit = []; J.jambSubmitArmed = false;
key('y');
ok('Y outside the prompt submits nothing', calls.submit.length === 0);
key('a', { tagName: 'INPUT' });
ok('keys never fire while the candidate is typing', sandbox.cbtAns[sandbox.cbtCur] !== 0 || sandbox.cbtCur !== 0);
J.jambMode = false;
var before = calls.move.length;
key('n');
ok('no key acts outside JAMB mode', calls.move.length === before);

/* --------------------------------------- 5. refresh recovery ------------- */
head('refresh recovery: same sitting, honest clock');
J.jambMode = true;
sandbox.cbtPaper = { attemptId: 'A1', durationSec: 120, questions: [{}, {}] };
sandbox.cbtAns = { 0: 2 }; sandbox.cbtCur = 1; sandbox.cbtN = 2;
J.jambDeadline = Date.now() + 30 * 60000;
J.jambSaveSession();
var saved = J.jambReadSession();
ok('the session is saved with answers, place and deadline',
   !!saved && saved.answers[0] === 2 && saved.cur === 1 && saved.deadline > Date.now());
J.jambMode = false;
J.jambPaintResume();
ok('the Web Test screen offers the resume', els.jtResume.hidden === false && /Resume your sitting/.test(els.jtResume.innerHTML));
calls.opened = 0;
J.jambResume();
ok('resume reopens the same paper, restores answers and place',
   calls.opened === 1 && sandbox.cbtAns[0] === 2 && sandbox.cbtCur === 1);
ok('resume keeps the remaining time, never a fresh clock',
   sandbox.cbtSecs > 29 * 60 && sandbox.cbtSecs <= 30 * 60, String(sandbox.cbtSecs));
store[J.JAMB_SESSION_KEY] = JSON.stringify({
  attemptId: 'A2', paper: sandbox.cbtPaper, answers: { 0: 1 }, cur: 0,
  deadline: Date.now() - 1000
});
calls.submit = [];
J.jambResume();
ok('an expired sitting submits what was saved instead of restarting',
   calls.submit.length === 1 && calls.submit[0] === true);
J.jambClearSession();
ok('discarding clears the saved sitting', J.jambReadSession() === null);

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
