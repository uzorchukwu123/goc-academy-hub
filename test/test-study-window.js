/* test-study-window.js — the daily study window's heartbeat, driven to
   exhaustion inside minidom (Task 6).

   swPing() is the same function the real page's once-a-minute timer calls
   (see js/app.js's sw.timer / STUDY_PING_MS) — this suite calls it directly,
   enough times through the mock driver to cross a deliberately low daily
   limit, and checks that the exact same things a real student would see
   actually update: state.studyExhausted flips, the focus ring reads zero
   and turns red, the wind-down overlay is shown, and a screen whose Start
   button depends on the window repaints itself without a fresh navigation.
   Run:  node test/test-study-window.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

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
  innerWidth: 430, innerHeight: 924,
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
/* ---- tiny assertions (same shape as test-study.js) ---- */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function text(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 12) return done(); setImmediate(again); })();
  });
}
function api(name) { return run('GOC.api.' + name); }
function shown(x) { var e = id(x); return !!e && e.classList.contains('show'); }
function screenNow() {
  var out = '';
  doc.querySelectorAll('.screen').forEach(function (s) {
    if (s.classList.contains('active')) out = s.getAttribute('id') || out;
  });
  return out;
}

var FOUNDER = 'GOC-A-001', FPW = 'founder2027', PASS = '2027';
var MINE = ['Use of English', 'Physics', 'Chemistry', 'Biology'];

async function registerStudent(name, pw, subjects) {
  var r = await run('GOC.api.createStudent')({
    signupCode: 'GOC-2027', name: name, password: pw,
    goal: 'JAMB / UTME', subjects: subjects
  });
  return r.student.id;
}

async function main() {
  head('a deliberately low daily window, set the same way an administrator would');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  /* One published objective question, so the Web Test screen actually has a
     row to gate — an empty catalogue would let the exhausted branch of
     wtRowEl() go untested by never reaching it. */
  var q = await api('createQuestion')({
    subject: 'Physics', section: 'objective', topic: 'Waves',
    text: 'A wave with a longer wavelength has a — frequency, at the same speed.',
    options: ['higher', 'lower', 'the same', 'undefined'], answer: 1
  });
  ok('the question is published and live', q.active === true);
  var setTo = await api('setDailyLimit')(30);
  ok('the window is now the minimum the admin screen allows, thirty minutes',
     setTo.dailyLimitMin === 30, setTo.dailyLimitMin);
  /* A guardian PIN set before the student ever signs in — this is the
     plumbing gap left open after Task 4/5: a real student session's
     getMySettings() now has to carry the yes/no flag (never the digits)
     so the wind-down overlay knows to show its PIN field. */
  var pinSet = await api('setGuardianPin')('4321');
  ok('the academy now has a guardian PIN set', pinSet.guardianPin === '4321', pinSet.guardianPin);
  await api('logout')();

  var SID = await registerStudent('Ngozi Eze', 'ngozi#77', MINE);
  await api('login')(SID, 'ngozi#77');

  head('before a single ping, the window reads as freshly opened');
  await run('loadSettings')();
  await flush();
  ok('nothing is exhausted yet', run('state.studyExhausted') === false);
  ok('and the wind-down overlay is not showing', shown('windOverlay') === false);
  ok('a real student session now learns a guardian PIN is set, not just the console',
     run('state.hasGuardianPin') === true, run('state.hasGuardianPin'));
  ok('but never the digits themselves — those stay console-only',
     run('state.guardianPin') === undefined || run('state.guardianPin') === '',
     run('state.guardianPin'));

  /* Open the practice set-up screen first, the same way a student would
     before starting a run — this is the screen whose Start button
     paintStudyWindow() repaints in place once the window closes, with no
     fresh navigation in between. */
  run('openPractice')();
  await flush();
  ok('the practice set-up is the screen on show', screenNow() === 'studySet', screenNow());
  ok('and its Start button is live, not pre-gated',
     id('suStart').disabled === false, text('suStart'));

  head('pinging the mock driver, exactly the way the real timer would');
  var guard = 0, lastWin = null;
  while (guard++ < 40 && !run('state.studyExhausted')) {
    await run('swPing')();
    await flush();
    lastWin = run('state.studyLeftSec');
  }
  ok('thirty minutes of one-minute heartbeats is enough to cross it',
     guard <= 31, guard + ' pings');
  ok('state.studyExhausted flips true, from the server\'s own answer, not a guess',
     run('state.studyExhausted') === true);
  ok('and there is nothing left of today\'s window',
     lastWin === 0, lastWin);

  head('the ring updates without anything else being touched');
  ok('the minutes-left figure reads zero', text('focusMin') === '0', text('focusMin'));
  ok('the arc turns to the low-time warning colour',
     id('focusArc').getAttribute('stroke') === '#D97706',
     id('focusArc').getAttribute('stroke'));
  ok('the dash offset is pulled all the way round, an empty ring',
     id('focusArc').getAttribute('stroke-dashoffset') ===
       id('focusArc').getAttribute('stroke-dasharray'),
     id('focusArc').getAttribute('stroke-dashoffset') + ' of ' +
       id('focusArc').getAttribute('stroke-dasharray'));

  head('the wind-down overlay opens itself, unasked');
  ok('it is shown', shown('windOverlay') === true);
  ok('and it names the window that was just used up',
     /30-minute daily limit/.test(text('windMsg')), text('windMsg'));
  ok('and, since the academy has a guardian PIN set, its extend-time field shows',
     id('windExtendWrap') && id('windExtendWrap').style.display === 'block',
     id('windExtendWrap') && id('windExtendWrap').style.display);

  head('a Start button already on screen relabels itself, without a fresh navigation');
  ok('the practice screen is still what is on show', screenNow() === 'studySet', screenNow());
  ok('its Start button is now disabled',
     id('suStart').disabled === true, text('suStart'));
  ok('and says why, in the same words the server would refuse it with',
     text('suStart') === 'Today\u2019s study window is used up', text('suStart'));

  head('and the server side of the same gate agrees');
  ok('starting a run is refused outright, not just hidden behind a disabled button',
     /study window is used up/.test(
       await (function () {
         return api('startStudy')({ mode: 'practice', subject: 'Physics', count: 2 })
           .then(function () { return null; }, function (e) { return e.message || 'refused'; });
       })()));

  head('the Web Test screen gates its own Start button the same way, not just Practice/CBT\u2019s');
  run('openWebTest')();
  await flush();
  ok('the web test screen is now on show', screenNow() === 'webtest', screenNow());
  var objRow = null;
  doc.querySelectorAll('#wtSections .wt-row').forEach(function (row) {
    if (!objRow && /All subjects/.test(row.textContent)) objRow = row;
  });
  ok('the objective session\u2019s row is on the page, already exhausted when it first renders',
     !!objRow, 'no wt-row matched "All subjects"');
  if (objRow) {
    var wtBtn = objRow.querySelector('.wt-start');
    ok('its Start button is disabled', !!wtBtn && wtBtn.disabled === true);
    ok('and reads the same way Practice/CBT\u2019s does', !!wtBtn && wtBtn.textContent === 'Window used up',
       wtBtn && wtBtn.textContent);
    ok('and, being disabled with no handler attached, nothing here can open a paper',
       !!wtBtn && wtBtn.onclick == null);
  }
  ok('calling startTest() directly (as a stale handler from before exhaustion might) is also refused',
     /study window is used up/.test(
       await (function () {
         return api('startTest')({ period: 'objective', section: 'objective', subject: run('GOC.api.rules.OBJECTIVE_SUBJECT') })
           .then(function () { return null; }, function (e) { return e.message || 'refused'; });
       })()));

  await api('logout')();

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  if (fails) process.exit(1);
}

main().catch(function (e) {
  console.log('\nTHREW: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
