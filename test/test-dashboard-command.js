/* test-dashboard-command.js — Stage 5: Dashboard Command Centre.

   Proves:
     1. the initial dashboard HTML carries no placeholder identity or stats
        (no borrowed name, level, XP or streak) — only a neutral loading
        state until the account's own data arrives;
     2. Next Up follows the fixed priority from existing data only —
        (1) an unfinished available exam paper, (2) due review,
        (3) weakest-topic practice from the student's own practice record;
     3. new/empty accounts get an honest starting action, and a source
        failure that could hide a higher priority yields an honest
        "not available" card instead of a guess;
     4. the dashboard surfaces JAMB, subjects, formal CBT, resources,
        notes, practice, progress and results without a redesign;
     5. the weakest-topic action narrows the practice set-up to that topic.
   Run:  node test/test-dashboard-command.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
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

head('no placeholder identity or stats in the initial HTML');
var dashHtml = index.slice(index.indexOf('id="home"'), index.indexOf('id="dashJourney"'));
ok('no borrowed student name before sign-in data arrives', !/Amara/.test(dashHtml) && /id="dashName">Loading…</.test(index));
ok('no placeholder level, XP or streak', !/Lv 8/.test(dashHtml) && !/1,240/.test(dashHtml) && !/🔥 12</.test(dashHtml)
  && /id="dashLevel">—</.test(index) && /id="dashXp">—</.test(index) && /id="dashStreak">—</.test(index));
ok('the status line makes no subject claim before the account loads', /id="dashExamLine">UTME 2027</.test(index));
ok('signing out blanks the hero stats as well as the name', /'dashLevel','dashXp','dashStreak','dashStreakChip'/.test(app));
ok('Next Up starts from a neutral loading card', /id="dashUp"><div class="wt-none">Working out your next step…<\/div>/.test(index));

/* ---- pure decision logic ---- */
function fakeEl() {
  var el = { innerHTML: '', textContent: '', style: {} };
  return el;
}
var els = { dashUp: fakeEl(), dashSubjects: fakeEl() };
var calls = [];
var apiStub = {};
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (s) { return String(s == null ? '' : s); },
  wtMinutes: function (s) { return Math.round(s / 60) + ' min'; },
  openWebTest: function () { calls.push('webtest'); },
  openJambTest: function () { calls.push('jamb'); },
  openPractice: function () { calls.push('practice'); },
  openStudySet: function (m, s) { calls.push('studyset:' + m + ':' + s); },
  go: function (id) { calls.push('go:' + id); },
  GOC: { api: apiStub },
  mySubjects: ['Physics', 'Chemistry'],
  Promise: Promise
};
var ctx = vm.createContext(sandbox);
vm.runInContext('var dashUpCurrent = null, dashUpWeakPick = null;\n'
  + 'function dashSet(id, html){ var e = document.getElementById(id); if(e) e.innerHTML = html; }\n'
  + grab('dashUpFromTests') + '\n' + grab('dashUpFromReview') + '\n' + grab('dashWeakTopic') + '\n'
  + grab('dashUpPick') + '\n' + grab('dashUpFetch') + '\n' + grab('dashPaintUp') + '\n'
  + grab('dashUpGo') + '\n' + grab('dashPaintSubjects'), ctx);

var PAPER = { section: 'objective', subject: 'Objective', questions: 100, durationSec: 3600, completed: false, attempts: 0 };
var DONE = { section: 'objective', subject: 'Objective', questions: 100, durationSec: 3600, completed: true, attempts: 1 };
var THEORY = { section: 'theory', subject: 'Physics', questions: 5, durationSec: 0, completed: false, attempts: 0 };
var RUNS = [
  { subject: 'Physics', topics: [{ topic: 'Thermodynamics', percent: 30, band: 'weak' }, { topic: 'Optics', percent: 90, band: 'strong' }] },
  { subject: 'Physics', topics: [{ topic: 'Thermodynamics', percent: 50, band: 'developing' }] },
  { subject: 'Chemistry', topics: [{ topic: 'Acids', percent: 60, band: 'developing' }] }
];

head('Next Up priority: paper, then due review, then weakest topic');
var p1 = sandbox.dashUpPick({ testsOk: true, rows: [THEORY, PAPER], reviewOk: true, review: { review: { dueCount: 4 } }, practiceOk: true, runs: RUNS });
ok('an unfinished paper beats due review and weak topics', p1.kind === 'paper' && p1.section === 'objective', JSON.stringify(p1));
var pTheory = sandbox.dashUpPick({ testsOk: true, rows: [THEORY], reviewOk: true, review: { review: { dueCount: 0 } }, practiceOk: true, runs: [] });
ok('an unfinished theory paper is offered by subject', pTheory.kind === 'paper' && /Physics theory/.test(pTheory.title), JSON.stringify(pTheory));
var pLocked = sandbox.dashUpPick({ testsOk: true, rows: [{ section: 'jamb', questions: 10, durationSec: 600, completed: false, locked: true, attempts: 0 }], reviewOk: true, review: { review: { dueCount: 2 } }, practiceOk: true, runs: RUNS });
ok('a locked sitting is never the recommendation', pLocked.kind === 'review', JSON.stringify(pLocked));
var p2 = sandbox.dashUpPick({ testsOk: true, rows: [DONE], reviewOk: true, review: { review: { dueCount: 4 } }, practiceOk: true, runs: RUNS });
ok('due review comes second', p2.kind === 'review' && /4 questions are due/.test(p2.sub), JSON.stringify(p2));
var p3 = sandbox.dashUpPick({ testsOk: true, rows: [DONE], reviewOk: true, review: { review: { dueCount: 0 } }, practiceOk: true, runs: RUNS });
ok('weakest-topic practice comes third, from the student\u2019s own runs', p3.kind === 'practice' && p3.topic === 'Thermodynamics' && p3.subject === 'Physics' && p3.percent === 40, JSON.stringify(p3));
var p4 = sandbox.dashUpPick({ testsOk: true, rows: [], reviewOk: true, review: { review: { dueCount: 0 } }, practiceOk: true, runs: [] });
ok('a new, empty account gets a starting action and no invented data', p4.kind === 'start' && !/\d+\s*(questions|%)/.test(p4.sub), JSON.stringify(p4));

head('honest failure instead of guessing');
var f1 = sandbox.dashUpPick({ testsOk: false, rows: [], reviewOk: true, review: { review: { dueCount: 9 } }, practiceOk: true, runs: RUNS });
ok('if papers cannot be ruled in or out, review is not guessed ahead of them', f1.kind === 'unavailable', JSON.stringify(f1));
var f2 = sandbox.dashUpPick({ testsOk: true, rows: [DONE], reviewOk: false, review: null, practiceOk: true, runs: RUNS });
ok('if due review cannot be read, a weak topic is not guessed ahead of it', f2.kind === 'unavailable', JSON.stringify(f2));
var f3 = sandbox.dashUpPick({ testsOk: false, rows: [], reviewOk: false, review: null, practiceOk: false, runs: [] });
ok('total failure is unavailable, never a fabricated recommendation', f3.kind === 'unavailable');

head('painting and actions');
apiStub.listMyTests = function () { return Promise.resolve({ tests: [DONE] }); };
apiStub.listReview = function () { return Promise.resolve({ review: { dueCount: 3 } }); };
apiStub.listPractice = function () { return Promise.resolve({ runs: RUNS }); };
sandbox.dashPaintUp();
setTimeout(function () {
  ok('the card paints the due-review recommendation', /Review what is due/.test(els.dashUp.innerHTML) && /dashUpGo\(\)/.test(els.dashUp.innerHTML), els.dashUp.innerHTML.slice(0, 140));
  sandbox.dashUpGo();
  ok('its action opens the review screen', calls.indexOf('go:review') >= 0, calls.join(','));

  apiStub.listMyTests = function () { return Promise.reject(new Error('offline')); };
  sandbox.dashPaintUp();
  setTimeout(function () {
    ok('Appwrite failure shows the honest unavailable card', /not available right now/.test(els.dashUp.innerHTML), els.dashUp.innerHTML.slice(0, 140));

    /* weak-topic action narrows the practice set-up */
    sandbox.dashUpCurrent = p3;
    calls = [];
    sandbox.dashUpGo();
    ok('the weakest-topic action stores the pick and opens its subject set-up',
      sandbox.dashUpWeakPick && sandbox.dashUpWeakPick.topic === 'Thermodynamics' && calls.indexOf('studyset:practice:Physics') >= 0,
      JSON.stringify(sandbox.dashUpWeakPick) + ' ' + calls.join(','));
    ok('the practice set-up consumes the pick only for a matching subject/topic',
      /dashUpWeakPick[\s\S]{0,420}suPick\[dashUpWeakPick\.topic\] = true/.test(app));

    sandbox.dashPaintSubjects();
    ok('the subjects card lists only the signed-in combination', /Physics/.test(els.dashSubjects.innerHTML) && /Chemistry/.test(els.dashSubjects.innerHTML) && !/Biology/.test(els.dashSubjects.innerHTML), els.dashSubjects.innerHTML.slice(0, 160));

    head('command-centre surfaces, no redesign');
    ['dashNext', 'dashJamb', 'dashStand', 'dashLast', 'dashUp', 'dashSubjects', 'dashJourney'].forEach(function (id) {
      ok('#' + id + ' is on the dashboard', index.indexOf('id="' + id + '"') >= 0);
    });
    ok('formal CBT and Resources are reachable from Carry on', /onclick="openCBT\(\)"/.test(index) && /onclick="go\('resources'\)"/.test(index));
    ok('notes and practice stay reachable', /onclick="openMyNotes\(\)"/.test(index) && /onclick="openPractice\(\)"/.test(index));
    ok('renderDash paints Next Up and subjects with the rest', /dashPaintUp\(\);\s*\n\s*dashPaintSubjects\(\);/.test(app));
    ok('formal CBT engine and screens are untouched by the dashboard work', /id="cbt"/.test(index) && /onclick="submitCBT\(\)"/.test(index));

    console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'dashboard command centre: all checks passed'));
    process.exit(fails ? 1 : 0);
  }, 30);
}, 30);
