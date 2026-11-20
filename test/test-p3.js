/* test-p3.js — the Web Test system (Priority 3) driven end to end inside
   minidom: the hub, the theory session, the objective session and the
   JAMB-oriented CBT session — plus the Priority 13 guarantees that no correct
   answer reaches the page before marking and no score is writable from it.
   Run:  node test/test-p3.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

/* ---- a document built from the real markup (same recipe as test-p6) ---- */
var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

/* The sandbox IS the window, and its clocks are stubbed: the paper's timer is
   driven by hand below so a test never has to wait a real second. */
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

/* This suite tests sitting mechanics on the thin seeded bank, so the JAMB depth
   bar (covered by test-jamb-ready-demo.js) is lowered to 1 up front. */
vm.runInContext('GOC.api._drivers.mock._setJambReadyMin(1)', ctx);

/* ---- tiny assertions ---- */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
var activeStudent = require('./active-student.js');
/* sign-up leaves the account pending; DEMO lets activeStudent.demo walk sign-up -> founder approves -> student signs in */
var DEMO = new Proxy({}, { get: function (_, n) { return run('GOC.api.' + n); } });
function text(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function markup(x) { var e = id(x); return e ? e.innerHTML : ''; }
function shown(x) { var e = id(x); return !!e && e.classList.contains('active'); }
function cards(x) { var e = id(x); return e ? e.querySelectorAll('.wt-sec') : []; }
function kids(x) { var e = id(x); return e ? e.children.length : -1; }
/* Let every queued promise callback drain before asserting. */
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 8) return done(); setImmediate(again); })();
  });
}
/* Answer-leak check: nothing a marker knows may travel with a live paper. */
function leaks(o) {
  var s = JSON.stringify(o || null);
  return /"answer"|"expected"|"explanation"|"isCorrect"|"markAwarded":\s*[0-9]/.test(s);
}

var SID; /* assigned once the real student below is registered */
var PW = 'bello#88';
var MINE = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];

/* There is no seeded demo roster any more (Priority: "the roll is closed to
   strangers"), so a real student is registered through the same public
   sign-up path a scholar would use, and the driver hands back the Scholar ID
   it actually assigned — nothing here is hard-coded. */
async function registerStudent(name, pw, subjects) {
  var r = await activeStudent.demo(DEMO, {
    signupCode: 'GOC-2027', name: name, password: pw,
    goal: 'JAMB / UTME', subjects: subjects
  });
  // every student now has full GOC access — no promotion step exists
  return r.student.id;
}

async function main() {
  SID = await registerStudent('Tunde Bello', PW, MINE);

  /* Clean sweep (Phase 2, 18 Nov 2026): the Web Test catalogue (#webtest), its
     Objective and Theory sittings and their runner (#wtRun) are retired. What
     this suite still covers: the shared result screen (#wtResult), the JAMB
     sitting in the data layer, the self-directed CBT, what a student cannot do,
     Results & Review, the dashboard, and sign-out. */
  head('the retired Web Test is gone; the shared result screen and CBT runner remain');
  ['webtest', 'wtLead', 'wtSections', 'wtHistory', 'wtRun', 'wtRunTitle', 'wtTimer', 'wtOpts',
   'wtTheory', 'wtAnswer', 'wtNav', 'wtSubmitBtn'].forEach(function (x) {
    ok('#' + x + ' is retired', !id(x));
  });
  ['wtResult', 'wtrTitle', 'wtrSub', 'wtrRing', 'wtrXp', 'wtrPending', 'wtrStats', 'wtrBrkWrap', 'wtrBrk',
   'wtrReviewWrap', 'wtrReview', 'cbtTitle', 'cbtMeta', 'cbtNav', 'cbtNum', 'cbtQ', 'cbtOpts'].forEach(function (x) {
    ok('#' + x + ' exists', !!id(x));
  });
  var src = read('index.html');
  ok('Study no longer opens a Web Test', src.indexOf('openWebTest()') < 0 && !id('sg-webtest'));
  ok('the logo symbol is untouched', src.indexOf('id="goc-mark"') > -1);
  ok('no in-app coins remain in the markup', src.indexOf('🪙') < 0);
  run('go')('webtest');
  ok('a stale go("webtest") lands on Home, not an empty page', shown('home'));
  run('go')('wtRun');
  ok('and so does a stale go("wtRun")', shown('home'));

  await run('GOC.api.login')(SID, PW);
  run('applyIdentity')({ id: SID, name: 'Tunde Bello', role: 'student', subjects: MINE, exam: 'JAMB / UTME' });
  var retired = await run('GOC.api.startTest')({ period: 'test', section: 'objective', subject: 'All subjects' })
    .then(function () { return '(opened!)'; }, function (e) { return e.message; });
  ok('the data layer refuses a new Objective sitting as retired', /have been retired/.test(retired), retired);

  /* This student's record from before the retirement: two Theory papers and one
     Objective sitting, opened through the demo driver's test-only
     _openLegacyPaper hook and submitted through the real submitTest path. */
  var THEORY_SUBS = ['Use of English', 'Physics'];
  for (var si = 0; si < THEORY_SUBS.length; si++) {
    var open = await run('GOC.api._drivers.mock._openLegacyPaper')('theory', THEORY_SUBS[si]);
    await run('GOC.api.submitTest')({ attemptId: open.attemptId, responses: {}, timeUsedSec: 60 });
  }
  var objOpen = await run('GOC.api._drivers.mock._openLegacyPaper')('objective', 'All subjects');
  var objResp = {};
  objOpen.questions.forEach(function (q) { objResp[q.id] = 0; });
  var objDone = await run('GOC.api.submitTest')({ attemptId: objOpen.attemptId, responses: objResp, timeUsedSec: 120 });
  ok('an earlier Objective paper is on the record, marked', objDone.status === 'marked', objDone.status);

  head('the shared result screen still opens a paper from the record');
  run('wtOpenResult')(objDone.id);
  await flush();
  ok('the result screen opens', shown('wtResult'));
  ok('it names the paper it shows', text('wtrTitle').length > 0 && text('wtrTitle') !== 'Test result', text('wtrTitle'));
  ok('its back buttons return to Results, never to the retired Web Test',
     /onclick="openResults\(\)"[^>]*>Back to results/.test(src) && src.indexOf("go('webtest')") < 0);

  head('the JAMB sitting is still in the data layer but is not offered on the website');
  /* Part Two retired the student-facing session. Nothing was deleted: the data
     layer still opens and catalogues it, so existing records stay readable and
     a sitting saved before the change can still be resumed. */
  var jm = await run('GOC.api.startTest')({ period: 'test', section: 'jamb', subject: 'Mathematics' })
    .then(function (p) { return p; }, function (e) { return { error: e.message }; });
  ok('the data layer opens a JAMB-oriented paper', jm && !jm.error && jm.section === 'jamb', JSON.stringify(jm));
  ok('it is a full-combination objective-style sitting on a clock',
     jm && jm.kind === 'objective' && jm.subject === 'All subjects' && jm.durationSec > 0 && (jm.total || 0) > 0,
     JSON.stringify(jm));
  await run('GOC.api.listMyTests')().then(function (r) {
    ok('the catalogue now lists the JAMB-oriented sitting once, over all subjects',
       r.tests.filter(function (t) { return t.section === 'jamb'; }).length === 1 &&
       r.tests.filter(function (t) { return t.section === 'jamb'; })
         .every(function (t) { return t.subject === 'All subjects' && t.durationSec > 0; }));
    ok('it lists no retired Objective or Theory sitting',
       !r.tests.some(function (t) { return t.section === 'objective' || t.section === 'theory'; }),
       r.tests.map(function (t) { return t.section; }).join(','));
    ok('every paper is filed under the one test', r.tests.every(function (t) {
      return t.period === 'test';
    }), r.tests.map(function (t) { return t.period; }).join(','));
  });
  ok('the page offers no JAMB-oriented session card or Start button (JAMB CBT is dormant)',
     !id('wtSections') && read('index.html').indexOf('jambStart(') < 0 && read('index.html').indexOf('jambConfirmStart(') < 0);

  /* Seed practice questions so studyPool() returns a non-empty pool when
     openCBT/openPractice calls studyCatalogue().  The seeded bank ships
     section:'objective' questions; studyPool() requires section:'practice'.
     We log in as the Founder, unlock the console, publish the questions,
     then log out and sign the student back in before the CBT screen opens. */
  await run('GOC.api.login')('GOC-A-001', 'founder2027');
  await run('GOC.api.unlockConsole')('2027');
  for (var pqi = 0; pqi < 10; pqi++) {
    await run('GOC.api.createQuestion')({
      subject: MINE[1], section: 'practice', topic: 'Waves',
      text: 'Practice seed ' + (pqi + 1) + ': The SI unit of frequency is',
      options: ['Hertz', 'Newton', 'Pascal', 'Joule'], answer: 0,
      difficulty: 'easy', explanation: 'Frequency is measured in hertz (Hz).'
    });
  }
  await run('GOC.api.logout')();
  await run('GOC.api.login')(SID, PW);


  head('a self-directed CBT run uses the same screen but never the record');
  run('openCBT')();
  await flush();
  ok('the set-up screen opens instead of a demo paper', shown('studySet'));
  ok('no real paper is open', run('cbtPaper') === null);
  var cat = run('studyCat');
  ok('the catalogue only offers papers this student sits', !!cat && (function () {
    var mine = run('mySubjectList()');
    return cat.subjects.every(function (e) { return mine.indexOf(e.subject) > -1; });
  })(), cat && cat.subjects.map(function (e) { return e.subject; }).join(','));
  run('suStart')();
  await flush();
  // suStart() now shows the pre-test instructions overlay first (Task 8) —
  // confirmTestInfo() is the "I understand — Start" button on it, and is
  // what actually fires the API call that used to happen on suStart() alone.
  run('confirmTestInfo')();
  await flush();
  ok('the configured run opened on the CBT screen', shown('cbt') && !!run('cbtStudy'));
  ok('it is as long as the questions it actually drew',
     run('cbtN') === run('cbtStudy.questions.length') && run('cbtN') > 0,
     run('cbtN') + ' vs ' + run('cbtStudy.questions.length'));
  ok('a study question carries no answer', run('cbtStudy').questions.every(function (q) {
    return q.answer === undefined && q.explanation === undefined;
  }));
  ok('the header names the paper and calls it a set-up',
     text('cbtTitle').indexOf('CBT set-up') > -1, text('cbtTitle'));
  run('confirmExit')();
  await flush();
  ok('leaving a study run returns to the set-up screen', shown('studySet'));
  ok('and submits nothing', run('cbtStudy') === null);

  head('what a student cannot do (Priority 13)');
  /* The Objective and Theory sittings are retired, so neither a foreign
     subject nor a written mathematics paper can be opened — for the same,
     honest reason. */
  var m1 = await run('GOC.api.startTest')({ period: 'weekly', section: 'theory', subject: 'Biology' })
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('a theory paper in a foreign subject is refused', /have been retired/.test(m1), m1);
  var mth = await run('GOC.api.startTest')({ period: 'test', section: 'theory', subject: 'Mathematics' })
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('a written mathematics paper is refused', /have been retired/.test(mth), mth);
  await run('GOC.api.listMyTests')().then(function (r) {
    ok('the catalogue lists no written mathematics paper',
       !r.tests.some(function (t) { return t.section === 'theory' && t.subject === 'Mathematics'; }));
  });
  var m2 = await run('GOC.api.submitTest')({ attemptId: 'A999-fake', responses: {}, timeUsedSec: 0 })
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('a fabricated attempt cannot be submitted', m2.indexOf('test session has ended') > -1, m2);
  var m3 = await run('GOC.api.myAttempt')(1)
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('another student\'s result is not readable', m3.indexOf('not on your record') > -1, m3);
  var m4 = await run('GOC.api.listQuestions')({})
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('the question bank is management-only', m4.indexOf('Management accounts only') > -1, m4);

  head('Results & Review reads the record by type of test sat');
  run('openResults')();
  await flush();
  await flush();
  ok('the Results screen opens', shown('results'));
  var perf = (run('rsData') && run('rsData').performance) || null;
  ok('it was given the student\'s own record', !!perf && Array.isArray(run('rsData').attempts));
  ok('the ring shows the weighted overall, not a fixed figure',
     perf.hasData ? text('rsRing').indexOf(String(Math.round(perf.overall))) > -1
                  : text('rsRing').indexOf('no marked paper yet') > -1, text('rsRing'));
  ok('there is a card for each of the three types of test', kids('rsSections') === 3, kids('rsSections'));
  var secs = markup('rsSections');
  ok('and each card is named', secs.indexOf('Objective') > -1 && secs.indexOf('Theory') > -1
     && secs.indexOf('JAMB-oriented') > -1);
  ok('the filter offers all papers and each type', kids('rsFilter') === 4, kids('rsFilter'));
  var allRows = kids('rsList');
  run('rsSetFilter')('theory');
  await flush();
  ok('filtering to one type retitles the screen',
     text('rsSub').indexOf('Theory papers only') > -1, text('rsSub'));
  ok('and the list only holds papers of that type',
     run('rsRows')().every(function (a) { return a.section === 'theory'; }));
  ok('which is no more than the whole record', kids('rsList') <= Math.max(1, allRows));
  run('rsSetFilter')('all');
  await flush();
  ok('going back to all papers restores the record', kids('rsList') === allRows, kids('rsList'));
  ok('no result screen figure is hard-coded in the markup',
     read('index.html').indexOf('Atomic Structure') < 0
     && read('index.html').indexOf('+120 Academy XP') < 0);

  head('the dashboard fills its own space from this account\'s record');
  /* The home screen used to end in blank space. Every panel below is drawn from
     GOC.api on the way in — nothing is held from a previous visit, and nothing is
     invented. */
  ok('the retired Next Activity card is gone (clean sweep)', !id('dashNext'));
  /* Phase 3: the standing and last-result panels left Home (they live on League and
     Results). Home now shows Overall Performance, Continue Learning and Announcements,
     each read from this account's record. */
  ['dashPerf', 'dbContinue', 'dbAnnounce'].forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  var homeHtml = (function (h) { var a = h.indexOf('id="home"'), b = h.indexOf('<!-- ============ STUDY HUB', a); return h.slice(a, b); })(read('index.html'));
  ok('the markup ships no figure of its own (the reference image\'s 2,480 XP, 5 Days and 78% are examples only)',
     homeHtml.length > 1000 && !/2,480|78%|5 Days/.test(homeHtml)
     && /id="dashXp">—</.test(homeHtml) && /id="dashPerf">—</.test(homeHtml) && /id="dashStreak">—</.test(homeHtml));
  run('go')('home');
  await flush();
  await flush();
  ok('the home screen is showing', shown('home'));
  var lg = await run('GOC.api.league')();
  ok('Overall Performance is the league\'s own assessed figure, or says it is not assessed',
     (lg.me && lg.me.assessed) ? text('dashPerf') === run('lgPct')(lg.me.performance)
                               : (text('dashPerf') === '—' && text('dashPerfNote') === 'Not assessed yet'),
     text('dashPerf') + ' / ' + text('dashPerfNote'));
  ok('Continue Learning resumes the newest practice run, or says there is none',
     /^Resume: /.test(text('dbContSub')) || /not finished a practice run yet/.test(text('dbContSub')), text('dbContSub'));
  ok('and no panel discloses how a paper is marked',
     !/by hand|hand[ -]mark|automatic/i.test(text('home')));

  head('signing out clears the papers');
  run('logout')();
  ok('no open JAMB paper survives the sign-out', run('cbtPaper') === null);
  var afterOut = await run('GOC.api.myResults')().then(function () { return '(read!)'; }, function (e) { return e.message; });
  ok('and the record is no longer readable without signing in', afterOut !== '(read!)', afterOut);

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

main().catch(function (e) {
  console.log('\nTHREW: ' + (e && e.stack || e));
  process.exit(1);
});

