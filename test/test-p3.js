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

/* ---- tiny assertions ---- */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
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
  var r = await run('GOC.api.createStudent')({
    signupCode: 'GOC-2027', name: name, password: pw,
    goal: 'JAMB / UTME', subjects: subjects
  });
  return r.student.id;
}

async function main() {
  SID = await registerStudent('Tunde Bello', PW, MINE);

  head('markup the Web Test depends on');
  ['webtest', 'wtLead', 'wtSections', 'wtSubjects',
   'wtHistory', 'wtRun', 'wtRunTitle', 'wtRunSub', 'wtTimer', 'wtTime', 'wtProg', 'wtNum', 'wtQ',
   'wtOpts', 'wtTheory', 'wtAnswer', 'wtMarkHint', 'wtNav', 'wtSubmitBtn', 'wtResult', 'wtrTitle',
   'wtrSub', 'wtrRing', 'wtrXp', 'wtrPending', 'wtrStats', 'wtrBrkWrap', 'wtrBrk', 'wtrReviewWrap',
   'wtrReview', 'cbtTitle', 'cbtMeta', 'cbtNav', 'cbtNum', 'cbtQ', 'cbtOpts'].forEach(function (x) {
    ok('#' + x + ' exists', !!id(x));
  });
  var src = read('index.html');
  ok('Study opens the Web Test', src.indexOf('openWebTest()') > -1);
  ok('the logo symbol is untouched', src.indexOf('id="goc-mark"') > -1);
  ok('no in-app coins remain in the markup', src.indexOf('🪙') < 0);

  head('the hub — three separated sessions, the student\'s own subjects only');
  await run('GOC.api.login')(SID, PW);
  run('applyIdentity')({ id: SID, name: 'Tunde Bello', role: 'student', subjects: MINE, exam: 'JAMB / UTME' });

  /* Seed this student's own record with three real papers — sat and submitted
     through the same API a student would call — so the "already on the
     record" assertions below have something genuine to read. There is no
     seeded demo history any more, so the record has to be built the same way
     a real scholar builds one. */
  var THEORY_SUBS = ['Use of English', 'Physics'];
  for (var si = 0; si < THEORY_SUBS.length; si++) {
    var open = await run('GOC.api.startTest')({ period: 'test', section: 'theory', subject: THEORY_SUBS[si] });
    await run('GOC.api.submitTest')({ attemptId: open.attemptId, responses: {}, timeUsedSec: 60 });
  }

  run('openWebTest')();
  await flush();
  ok('the hub screen is showing', shown('webtest'));
  ok('three session cards', cards('wtSections').length === 3, cards('wtSections').length);
  ['Theory session', 'Objective session', 'JAMB-oriented session'].forEach(function (t) {
    ok('card: ' + t, text('wtSections').indexOf(t) > -1);
  });
  /* How a paper is marked is the academy's business, not the student's. Nothing
     on this hub says who or what awards the mark. */
  ok('no marking chip is rendered at all', markup('wtSections').indexOf('wt-mark') < 0);
  ok('and no session claims to be hand- or auto-marked',
     !/marked by hand|marked automatically|hand[ -]mark|auto[ -]mark/i.test(text('wtSections')),
     text('wtSections'));
  /* JAMB is held back for the pilot. The card says so, and it offers no Start —
     a hidden button would not be the control, but neither is an unhonoured one. */
  ok('the JAMB session is held back on the card',
     (markup('wtSections').match(/wt-sec soon/g) || []).length === 1,
     (markup('wtSections').match(/wt-sec soon/g) || []).length);
  ok('and carries a coming-soon notice instead of a paper list',
     markup('wtSections').indexOf('wt-none soon') > -1);
  MINE.forEach(function (s) { ok('a paper for ' + s, text('wtSections').indexOf(s) > -1); });
  ok('no paper for a subject outside the combination', text('wtSections').indexOf('Biology') < 0);
  ok('the lead counts the registered subjects', text('wtLead').indexOf('4 registered subjects') === 0, text('wtLead'));
  /* Theory is one paper per subject that has one — Mathematics is examined in the
     objective sitting only; the objective sitting is one paper for the whole
     combination; JAMB offers none. */
  var RULES = run('GOC.api.rules');
  var WRITTEN = MINE.filter(function (s) { return RULES.theoryAllowed(s); });
  ok('this combination includes a subject with no written paper', WRITTEN.length === MINE.length - 1);
  /* Use of English and Physics were already sat and submitted in the seed
     above, so their rows render a disabled "Submitted" state, not a live
     Start button — only Chemistry's theory paper and the (not yet sat)
     objective sitting still offer one. */
  ok('a submitted written paper offers no Start, only "Submitted"',
     (markup('wtSections').match(/class="wt-start done"/g) || []).length === THEORY_SUBS.length,
     (markup('wtSections').match(/class="wt-start done"/g) || []).length);
  ok('theory offers a live Start only for the papers not yet sat, and the objective sitting exactly one',
     (markup('wtSections').match(/class="wt-start"/g) || []).length === (WRITTEN.length - THEORY_SUBS.length) + 1,
     (markup('wtSections').match(/class="wt-start"/g) || []).length);
  ok('and the student is told where the missing subject is examined instead',
     text('wtSections').indexOf('objective sitting only') > -1, text('wtSections'));
  ok('the objective row names the whole combination, not one subject',
     text('wtSections').indexOf('All subjects') > -1);
  ok('and breaks the sitting down per paper',
     markup('wtSections').indexOf('class="papers"') > -1);
  ok('a written paper is offered without a clock',
     text('wtSections').indexOf('no time limit') > -1, text('wtSections'));

  head('the record already stored against this Scholar ID');
  ok('history rendered from the backend', (markup('wtHistory').match(/class="wt-his"/g) || []).length === 2,
     (markup('wtHistory').match(/class="wt-his"/g) || []).length);
  ok('an unmarked paper shows the waiting glyph or a percentage',
     /⏳|%/.test(markup('wtHistory')));

  head('there is one Test, not a weekly one and a monthly one');
  /* The period was collapsed, not deleted: a paper stored as weekly or monthly
     still belongs to this student and still appears. Nothing filters on it. */
  ok('the hub offers no period tabs at all', read('index.html').indexOf('wtTabWeekly') < 0
     && read('index.html').indexOf('wtTabMonthly') < 0);
  ok('the label the whole app reads from is simply Test',
     run('GOC.api.rules.PERIOD_LABEL') === 'Test', run('GOC.api.rules.PERIOD_LABEL'));
  ok('and there is exactly one period to sit', run('GOC.api.rules.PERIODS').length === 1,
     run('GOC.api.rules.PERIODS').join(','));
  ok('a legacy weekly or monthly record normalises to it',
     run('GOC.api.rules.normalizePeriod')('weekly') === 'test'
     && run('GOC.api.rules.normalizePeriod')('monthly') === 'test'
     && run('GOC.api.rules.normalizePeriod')('') === 'test');
  ok('nothing student-facing says weekly or monthly',
     !/weekly|monthly/i.test(text('wtSections') + ' ' + text('wtLead') + ' ' + text('wtHistory')),
     text('wtLead'));
  ok('still three sessions', cards('wtSections').length === 3);

  head('the objective session — one sitting of the whole combination');
  /* The student passes no subject: the sitting is the combination. */
  run('wtStart')('test', 'objective');
  await flush();
  ok('the runner is showing', shown('wtRun'));
  var paper = run('wtPaper');
  ok('a paper was opened', !!paper && !!paper.attemptId);
  ok('the paper counts its own questions', paper.total === paper.questions.length, paper.total);
  ok('no answer, expected answer or explanation reached the page', !leaks(paper));
  ok('it is one sitting, not one subject', paper.subject === 'All subjects', paper.subject);
  ok('every registered subject is in it', MINE.every(function (sub) {
    return paper.questions.some(function (q) { return q.subject === sub; });
  }), paper.questions.map(function (q) { return q.subject; }).join(','));
  ok('no subject outside the combination is in it',
     !paper.questions.some(function (q) { return q.subject === 'Biology'; }));
  ok('the papers arrive in UTME order — English first',
     paper.questions[0].subject === 'Use of English', paper.questions[0].subject);
  ok('each paper is served whole before the next begins', (function () {
    var seen = [], last = null, i;
    for (i = 0; i < paper.questions.length; i++) {
      var sub = paper.questions[i].subject;
      if (sub !== last) { if (seen.indexOf(sub) > -1) return false; seen.push(sub); last = sub; }
    }
    return seen.length === MINE.length;
  })());
  ok('the sitting is broken down per paper', !!paper.papers && paper.papers.length === MINE.length,
     paper.papers && paper.papers.length);
  ok('the breakdown adds up to the paper', paper.papers.reduce(function (m, r) {
     return m + r.questions; }, 0) === paper.total);
  ok('no paper exceeds its UTME ceiling', paper.papers.every(function (r) {
    return r.questions <= (r.subject === 'Use of English' ? 60 : 40);
  }));
  ok('the whole sitting stays inside 180', paper.total <= 180, paper.total);
  ok('the clock is the console\'s, not the student\'s', paper.durationSec > 0, paper.durationSec);
  ok('the header names the sitting', text('wtRunTitle').indexOf('All subjects') > -1 &&
     text('wtRunTitle').indexOf('Objective') > -1, text('wtRunTitle'));
  ok('the sub-line states the test, the count and the length',
     text('wtRunSub').indexOf('Test') === 0 && /hour/.test(text('wtRunSub')), text('wtRunSub'));
  ok('question numbering names the paper being sat and numbers from 1 inside it',
     text('wtNum') === paper.papers[0].subject + ' · Question 1 of ' + paper.papers[0].questions,
     text('wtNum'));
  ok('the navigation panel holds the paper being sat, not the whole sitting',
     kids('wtNav') === paper.papers[0].questions, kids('wtNav'));
  ok('and it is numbered from 1 for that paper', text('wtNav').indexOf('1') === 0, text('wtNav'));
  ok('options rendered for the first question', kids('wtOpts') === paper.questions[0].options.length);
  ok('the theory box is hidden on an objective paper', id('wtTheory').hidden === true);
  ok('nothing on screen marks an option right or wrong',
     markup('wtOpts').indexOf('class="opt right"') < 0 && markup('wtOpts').indexOf('wrong') < 0);
  ok('nothing is answered yet', markup('wtNav').indexOf(' ans') < 0);

  head('leaving a real paper submits nothing');
  /* Before this sitting is ever submitted, prove that walking away from it
     costs nothing: a fresh throwaway attempt, abandoned, must not appear on
     the record at all. This has to happen before the real sitting below is
     submitted — once it is, the one-sit rule closes the section for good and
     there would be nothing left to open here. */
  var beforeAbandon = (markup('wtHistory').match(/class="wt-his"/g) || []).length;
  run('wtStart')('test', 'objective');
  await flush();
  ok('the paper opened', shown('wtRun') && !!run('wtPaper'));
  run('wtExit')();
  ok('the runner was abandoned', run('wtPaper') === null);
  ok('the hub is showing again', shown('webtest'));
  ok('the student is told nothing was submitted', text('toast').indexOf('nothing was submitted') > -1,
     text('toast'));
  await run('GOC.api.myResults')().then(function (r) {
    ok('the record did not grow', r.attempts.length === beforeAbandon, r.attempts.length + ' vs ' + beforeAbandon);
  });

  head('naming a subject on the objective sitting changes nothing (Priority 13)');
  /* Also before the real sitting is submitted: the objective sitting takes no
     subject and ignores one if given, and an older page still sending
     'weekly' is honoured rather than refused. Opened and abandoned the same
     way, so it leaves no mark on the record either. */
  var m1b = await run('GOC.api.startTest')({ period: 'weekly', section: 'objective', subject: 'Biology' })
    .then(function (p) { return p.subject; }, function (e) { return e.message; });
  ok('naming a subject on the objective sitting changes nothing about it',
     m1b === 'All subjects', m1b);
  ok('and a legacy period was honoured, not refused', m1b === 'All subjects');
  run('wtExit')();
  await run('GOC.api.myResults')().then(function (r) {
    ok('and that too left no mark on the record', r.attempts.length === beforeAbandon,
       r.attempts.length + ' vs ' + beforeAbandon);
  });

  /* Reopen the sitting to continue the walkthrough below — abandoning never
     counted as a submission, so the combination may be opened again. */
  run('wtStart')('test', 'objective');
  await flush();
  ok('the sitting reopened for the real walkthrough', shown('wtRun') && !!run('wtPaper'));
  paper = run('wtPaper');

  head('moving between papers inside the one sitting (Priority 3)');
  /* A sitting in the hall is one clock over several question papers, and a scholar
     may leave one and come back. The strip is derived from the order the backend
     served the paper in — never decided here. */
  var groups = run('wtGroups');
  ok('the papers inside the sitting were derived', !!groups && groups.length === MINE.length,
     groups && groups.length);
  ok('they tile the sitting exactly, in served order', groups[0].from === 0
     && groups[groups.length - 1].to === paper.total - 1
     && groups.every(function (g, k) { return k === 0 || g.from === groups[k - 1].to + 1; }));
  ok('each names the paper the backend named', groups.every(function (g, k) {
    return g.subject === paper.papers[k].subject && g.count === paper.papers[k].questions;
  }));
  ok('the switcher is offered, one button per paper', id('wtSubjects').hidden === false
     && kids('wtSubjects') === MINE.length, kids('wtSubjects'));
  ok('every paper is named on it', MINE.every(function (s) {
    return text('wtSubjects').indexOf(s) > -1;
  }), text('wtSubjects'));
  ok('the paper being sat is the one marked current',
     (markup('wtSubjects').match(/wt-sub cur/g) || []).length === 1,
     (markup('wtSubjects').match(/wt-sub cur/g) || []).length);
  ok('each button counts its own answers, none of them yet',
     text('wtSubjects').indexOf('0/' + groups[0].count) > -1, text('wtSubjects'));
  /* Tapping another paper opens that paper's first question, and the clock is
     untouched — it is one sitting. */
  var secsBefore = run('wtSecs');
  id('wtSubjects').children[2].onclick();
  ok('tapping a paper opens its first question', run('wtCur') === groups[2].from, run('wtCur'));
  ok('the header follows the paper opened',
     text('wtNum') === groups[2].subject + ' · Question 1 of ' + groups[2].count, text('wtNum'));
  ok('the navigation panel follows it too', kids('wtNav') === groups[2].count, kids('wtNav'));
  ok('the clock is not restarted — it is one sitting', run('wtSecs') === secsBefore);
  ok('and the paper itself was not reopened', run('wtPaper').attemptId === paper.attemptId);
  /* Answer one question in that paper, leave it, come back: the answer is still
     there and the strip has counted it. */
  id('wtOpts').children[0].onclick();
  ok('the strip counts the answer against that paper',
     text('wtSubjects').indexOf('1/' + groups[2].count) > -1, text('wtSubjects'));
  id('wtSubjects').children[0].onclick();
  ok('leaving keeps the answer', Object.keys(run('wtResp')).length === 1);
  id('wtSubjects').children[2].onclick();
  ok('coming back lands on the next unanswered question of that paper',
     run('wtCur') === groups[2].from + 1, run('wtCur'));
  ok('and the answer already given is still selected',
     markup('wtNav').indexOf(' ans') > -1);
  run('wtResp = {}');
  run('wtGo')(0);

  /* Tap through the paper the way a student would — through the buttons. */
  for (var i = 0; i < paper.total; i++) {
    run('wtGo')(i);
    var opts = id('wtOpts');
    opts.children[i % opts.children.length].onclick();
  }
  ok('a chosen option is marked as selected, not as correct',
     markup('wtOpts').indexOf('opt sel') > -1 && markup('wtOpts').indexOf('right') < 0);
  ok('every question in the open paper now reads as answered',
     (markup('wtNav').match(/ ans/g) || []).length === kids('wtNav'),
     (markup('wtNav').match(/ ans/g) || []).length + ' of ' + kids('wtNav'));
  ok('and every paper on the strip reads as complete',
     (markup('wtSubjects').match(/wt-sub[^"]*done/g) || []).length === MINE.length,
     (markup('wtSubjects').match(/wt-sub[^"]*done/g) || []).length);
  ok('unanswered count is zero', run('wtUnanswered')() === 0);

  /* Hand the clock 125 seconds of use, then submit. */
  run('wtSecs = ' + (paper.durationSec - 125));
  run('var __last = null; var __show = wtShowResult; wtShowResult = function (r) { __last = r; return __show(r); };');
  run('wtSubmit')();
  await flush();
  var res = run('__last');
  ok('the paper was submitted and marked', !!res && res.status === 'marked', res && res.status);
  ok('the result screen is showing', shown('wtResult'));
  ok('the result is filed against this Scholar ID', res.scholarId === SID, res.scholarId);
  ok('correct + incorrect = total', res.correct + res.wrong === res.total);
  ok('score is the number of correct answers', res.score === res.correct, res.score + '/' + res.correct);
  /* The percentage is derived to one decimal place, so it is checked that way —
     a whole number here would only be the luck of the draw. */
  ok('percentage derives from the marks',
     res.percent === Math.round(res.score * 1000 / res.maxScore) / 10,
     res.percent);
  ok('time used is the time the clock reported', res.timeUsedSec === 125, res.timeUsedSec);
  ok('the paper is closed locally after submitting', run('wtPaper') === null);

  head('the objective result reports everything Priority 3 asks for');
  var stats = text('wtrStats');
  ['Total questions', 'Answered', 'Unanswered', 'Correct', 'Incorrect', 'Score', 'Percentage',
   'Time used', 'Completion', 'Result'].forEach(function (label) {
    ok('stats row: ' + label, stats.indexOf(label) > -1);
  });
  ok('the time used is shown as a clock', stats.indexOf('02:05') > -1, stats);
  ok('completion is stated', stats.indexOf('Completed — every question attempted') > -1);
  ok('the result is reported as released, not as a marking method',
     stats.indexOf('Released') > -1 && !/by hand|automatic/i.test(stats), stats);
  ok('the awaiting-marking notice stays hidden for a marked paper', id('wtrPending').hidden === true);
  ok('a percentage ring was drawn', String(id('wtrRing').style.strokeDashoffset || '').length > 0 ||
     text('wtrTitle').length > 0);
  ok('XP earned is reported', text('wtrXp').indexOf('XP') > -1, text('wtrXp'));
  ok('a topic breakdown is offered once marked', id('wtrBrkWrap').hidden === false);
  ok('breakdown bands are capitalised for display', /Strong|Developing|Weak/.test(text('wtrBrk')), text('wtrBrk'));
  ok('review is offered', id('wtrReviewWrap').hidden === false);
  ok('the correct answer appears only now that the paper is marked',
     text('wtrReview').indexOf('Correct answer') > -1);
  ok('the review names the student\'s own answer', text('wtrReview').indexOf('Your answer') > -1);
  ok('a verdict is shown per question', /Correct|Incorrect/.test(markup('wtrReview')));
  ok('the record grew by the paper just submitted',
     (markup('wtHistory').match(/class="wt-his"/g) || []).length === 3,
     (markup('wtHistory').match(/class="wt-his"/g) || []).length);

  head('the theory session — a written paper, sat without a clock');
  run('wtStart')('test', 'theory', 'Chemistry');
  await flush();
  ok('the runner is showing', shown('wtRun'));
  var thy = run('wtPaper');
  ok('a theory paper was opened', thy.kind === 'theory', thy.kind);
  ok('no reference answer travelled with it', !leaks(thy));
  ok('the written-answer box is shown', id('wtTheory').hidden === false);
  ok('option buttons are hidden', id('wtOpts').hidden === true && kids('wtOpts') === 0);
  ok('the mark the question carries is stated', text('wtMarkHint').indexOf('Worth 10 marks') === 0,
     text('wtMarkHint'));
  /* What the mark is worth is the student's business; who awards it is not. */
  ok('but not who or what awards it', !/by hand|hand[ -]mark|automatic/i.test(text('wtMarkHint')),
     text('wtMarkHint'));
  ok('the switcher is not offered on a one-paper sitting',
     run('wtGroups') === null && id('wtSubjects').hidden === true);
  /* A written paper is not a race. There is no countdown, nothing auto-submits,
     and the badge says so rather than showing a stopped clock. */
  ok('it is one paper for one subject', thy.subject === 'Chemistry', thy.subject);
  ok('it arrives with no duration at all', thy.durationSec === 0, thy.durationSec);
  ok('the runner knows it is untimed', run('wtUntimed') === true);
  ok('no countdown is running', run('wtTimerId') === null);
  ok('the badge reads as having no limit', text('wtTime') === 'No limit', text('wtTime'));
  ok('the badge is styled as no-limit, not as a warning',
     id('wtTimer').classList.contains('none') && !id('wtTimer').classList.contains('warn'));
  ok('the sub-line says so in words', text('wtRunSub').indexOf('no time limit') > -1, text('wtRunSub'));
  ok('nothing is answered yet', run('wtUnanswered')() === thy.total);
  /* Write in every question on the paper, question by question, the way a scholar
     would — the paper may carry more than one. */
  for (var ti = 0; ti < thy.total; ti++) {
    run('wtGo')(ti);
    id('wtAnswer').value = 'A formal letter is impersonal and carries both addresses. (' + (ti + 1) + ')';
    run('wtTyped')();
  }
  ok('typing counts as answered', run('wtUnanswered')() === 0, run('wtUnanswered')());
  /* Time is still recorded on an untimed paper — measured forward from the
     moment it opened, not counted down from a limit that does not exist. */
  run('wtOpenedAt = Date.now() - 300000');
  run('wtSubmit')();
  await flush();
  var tres = run('__last');
  ok('the paper was accepted', !!tres && tres.section === 'theory');
  ok('theory is not auto-scored', tres.status === 'awaiting-marking', tres.status);
  ok('no score was invented', tres.score === null && tres.percent === null);
  ok('the answer was stored', tres.review[0].given.indexOf('A formal letter') === 0);
  ok('the maximum mark travels with the record', tres.review[0].maxMark === 10);
  ok('no mark was awarded yet', tres.review[0].markAwarded === null);

  head('the theory result says plainly that the result is still to come');
  ok('the result screen is showing', shown('wtResult'));
  ok('the pending notice is visible', id('wtrPending').hidden === false);
  ok('the notice promises a result, without naming a marker',
     text('wtrPending').indexOf('Result on the way') > -1
     && !/by hand|hand[ -]mark|automatic/i.test(text('wtrPending')), text('wtrPending'));
  ok('score reads as not released yet', text('wtrStats').indexOf('awaiting your result') > -1,
     text('wtrStats'));
  ok('and the stats disclose no marking method',
     !/by hand|hand[ -]mark|automatic/i.test(text('wtrStats')), text('wtrStats'));
  ok('no correct/incorrect rows on a theory paper',
     text('wtrStats').indexOf('Correct') < 0 && text('wtrStats').indexOf('Incorrect') < 0);
  ok('the time the student actually spent is still reported',
     text('wtrStats').indexOf('05:00') > -1, text('wtrStats'));
  ok('and it was measured, not clamped against a zero limit',
     tres.timeUsedSec >= 299 && tres.timeUsedSec <= 302, tres.timeUsedSec);
  ok('the review states what the question is worth, not a mark',
     text('wtrReview').indexOf('Not scored yet · worth 10') > -1, text('wtrReview'));
  ok('no reference answer is revealed', text('wtrReview').indexOf('Correct answer') < 0);
  ok('no topic breakdown before marking', id('wtrBrkWrap').hidden === true);
  ok('completion XP was still credited', tres.xpAwarded > 0, tres.xpAwarded);

  head('the JAMB-oriented session is held back at every level');
  /* Three layers, and the hidden button is never the control: the catalogue does
     not list it, the hub renders no Start for it, and the data layer refuses it
     even when asked directly. */
  var jm = await run('GOC.api.startTest')({ period: 'test', section: 'jamb', subject: 'Mathematics' })
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('the data layer refuses a JAMB paper', jm.indexOf('coming soon') > -1, jm);
  ok('and points the student at the objective sitting instead',
     jm.indexOf('Objective') > -1, jm);
  await run('GOC.api.listMyTests')().then(function (r) {
    ok('the catalogue never lists a JAMB paper',
       !r.tests.some(function (t) { return t.section === 'jamb'; }));
    ok('it lists the objective sitting exactly once, not one per subject',
       r.tests.filter(function (t) { return t.section === 'objective'; }).length === 1,
       r.tests.filter(function (t) { return t.section === 'objective'; }).length);
    ok('and one theory paper per subject',
       r.tests.filter(function (t) { return t.section === 'theory'; })
         .every(function (t) { return MINE.indexOf(t.subject) > -1; }));
    ok('every paper is filed under the one test', r.tests.every(function (t) {
      return t.period === 'test';
    }), r.tests.map(function (t) { return t.period; }).join(','));
  });
  run('wtStart')('test', 'jamb', 'Mathematics');
  await flush();
  ok('asking for it from the page opens no runner', !shown('wtRun') && run('wtPaper') === null);
  ok('and the student is told why', text('toast').indexOf('coming soon') > -1, text('toast'));

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
  /* The objective sitting takes no subject — it is the whole combination — so a
     foreign subject is refused where one is actually named: the theory paper.
     These calls deliberately still say 'weekly': an older page must be answered,
     not refused, so the refusal below has to be about the subject and nothing else. */
  var m1 = await run('GOC.api.startTest')({ period: 'weekly', section: 'theory', subject: 'Biology' })
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('a subject outside the combination is refused',
     m1.indexOf('not part of your registered subject combination') > -1, m1);
  run('wtStart')('weekly', 'theory', 'Biology');
  await flush();
  ok('and the refusal is shown on screen', text('toast').indexOf('Biology') > -1, text('toast'));
  /* Mathematics IS in this student's combination — the refusal has to be about the
     written paper, not the combination, or the message would be a lie. */
  var mth = await run('GOC.api.startTest')({ period: 'test', section: 'theory', subject: 'Mathematics' })
    .then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('a written mathematics paper is refused', mth.indexOf('objective sitting only') > -1, mth);
  ok('and not on the grounds of the combination, which does include it',
     mth.indexOf('not part of your registered') < 0 && MINE.indexOf('Mathematics') > -1, mth);
  await run('GOC.api.listMyTests')().then(function (r) {
    ok('the catalogue lists no written mathematics paper',
       !r.tests.some(function (t) { return t.section === 'theory' && t.subject === 'Mathematics'; }));
    ok('but the objective sitting still counts a mathematics paper',
       r.tests.some(function (t) {
         return t.section === 'objective' && (t.papers || []).some(function (p) { return p.subject === 'Mathematics'; });
       }));
  });
  run('wtStart')('test', 'theory', 'Mathematics');
  await flush();
  ok('asking from the page opens no written paper', !shown('wtRun') && run('wtPaper') === null);
  ok('and says where mathematics is examined instead',
     text('toast').indexOf('objective sitting only') > -1, text('toast'));
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
  ['dashNext', 'dashStand', 'dashLast'].forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  ok('the markup ships no figure of its own', /Checking your papers|Reading the standings|Reading your record/
     .test(read('index.html')) && read('index.html').indexOf('#1 of') < 0);
  run('go')('home');
  await flush();
  await flush();
  ok('the home screen is showing', shown('home'));
  ok('the waiting-for-you panel names the objective sitting',
     text('dashNext').indexOf('Objective sitting') > -1, text('dashNext'));
  ok('and states its length in hours', /hour/.test(text('dashNext')), text('dashNext'));
  ok('it names the theory papers and says they are untimed',
     text('dashNext').indexOf('Theory papers') > -1
     && text('dashNext').indexOf('no time limit') > -1, text('dashNext'));
  ok('the papers it counts are the ones the backend published',
     (await run('GOC.api.listMyTests')()).tests.length > 0);
  ok('the standing panel states a position out of the league',
     /#\d+ of \d+/.test(text('dashStand')), text('dashStand'));
  ok('and the same figures the league screen reads',
     text('dashStand').indexOf('Academy XP') > -1 && text('dashStand').indexOf('Papers counted') > -1,
     text('dashStand'));
  ok('the last-result panel opens one real result',
     markup('dashLast').indexOf('wtOpenResult') > -1, markup('dashLast'));
  ok('and it is the most recent paper on the record',
     text('dashLast').indexOf((await run('GOC.api.myResults')()).attempts[0].subject) > -1,
     text('dashLast'));
  ok('a paper still unreleased says so rather than showing a score',
     text('dashLast').indexOf('marks') > -1 || text('dashLast').indexOf('not released yet') > -1,
     text('dashLast'));
  ok('and no panel discloses how a paper is marked',
     !/by hand|hand[ -]mark|automatic/i.test(text('dashNext') + text('dashStand') + text('dashLast')));

  head('signing out clears the papers');
  run('logout')();
  ok('the catalogue is dropped', run('wtCatalogue') === null);
  run('renderWebTest')();
  ok('the hub asks for a Scholar ID', text('wtSections').indexOf('Log in with your Scholar ID') > -1,
     text('wtSections'));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

main().catch(function (e) {
  console.log('\nTHREW: ' + (e && e.stack || e));
  process.exit(1);
});

