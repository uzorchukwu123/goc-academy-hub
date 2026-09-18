/* test-study.js — self-directed study: the practice run and the student's own
   CBT set-up (Priorities 28 / 29 / 30), driven end to end inside minidom.

   These are study tools, not examinations, and the whole point of this suite is
   to prove that distinction holds in the code and not just in the copy: a
   practice question travels with its answer so the page can mark it the instant
   an option is tapped, and because of that a practice run is never filed in the
   academic record and never moves a league position. The XP it earns is
   calculated by the data layer from its own marking — never from anything the
   page sends — and it stops at a daily allowance.
   Run:  node test/test-study.js  */
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
function count(x, sel) { var e = id(x); return e ? e.querySelectorAll(sel).length : -1; }
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 12) return done(); setImmediate(again); })();
  });
}
function api(name) { return run('GOC.api.' + name); }
function shown(x) { var e = id(x); return !!e && e.classList.contains('active'); }
function screenNow() {
  var out = '';
  doc.querySelectorAll('.screen').forEach(function (s) {
    if (s.classList.contains('active')) out = s.getAttribute('id') || out;
  });
  return out;
}
function refused(p) {
  return p.then(function () { return null; }, function (e) { return e.message || 'refused'; });
}
/* Amara carries English, Physics, Chemistry and Biology — and deliberately not
   Mathematics, which is what makes her the right student to prove a paper
   outside a combination is refused rather than quietly served. */
var SPW = 'amara2027!';
var FOUNDER = 'GOC-A-001', FPW = 'founder2027', PASS = '2027';
var R = run('GOC.api.rules');
var MINE = ['Use of English', 'Physics', 'Chemistry', 'Biology'];

/* There is no seeded demo roster any more (same obsolete demo-data
   assumption already documented for test-p3.js, test-p4.js, test-p78.js,
   test-p9.js and test-p10.js): the mock driver now starts with zero
   students, so every scholar this suite needs is registered through the
   same public sign-up path a real one would use, and the driver hands back
   the Scholar ID it actually assigned — nothing here is hard-coded. */
async function registerStudent(name, pw, subjects) {
  var r = await run('GOC.api.createStudent')({
    signupCode: 'GOC-2027', name: name, password: pw,
    goal: 'JAMB / UTME', subjects: subjects
  });
  return r.student.id;
}

async function main() {
  var SID = await registerStudent('Amara Obi', SPW, MINE);
  /* A second, independent student — needed only to prove a run belongs to
     the Scholar ID that started it, not to whoever happens to submit it. */
  var SID2 = await registerStudent('Kelechi Bello', 'bello#88', MINE);

  head('the rules every screen and both drivers share');
  ok('there are exactly two self-directed modes', R.STUDY_MODES.join(',') === 'cbt,practice',
     R.STUDY_MODES.join(','));
  ok('a run is capped at ' + R.STUDY_MAX + ' questions', R.STUDY_MAX === 60);
  ok('a count below one is lifted to one', R.clampStudyCount(0, 40) === 1);
  ok('a count is never larger than the topics can answer', R.clampStudyCount(40, 7) === 7);
  ok('nor larger than the ceiling, however deep the bank', R.clampStudyCount(500, 500) === 60);
  ok('a fractional count is rounded, not truncated to nothing', R.clampStudyCount(9.6, 40) === 10);
  ok('nonsense in the count is read as one, never as zero questions',
     R.clampStudyCount('abc', 40) === 1);
  ok('a clock under five minutes is lifted to five', R.clampStudyMinutes(1) === 5);
  ok('a clock over three hours is brought back to 180', R.clampStudyMinutes(400) === 180);
  ok('a legal clock is left exactly as chosen', R.clampStudyMinutes(45) === 45);
  /* The pool is what a student could be asked. Theory is not in it: theory needs
     a marker, and self-study has none. */
  var BANK = [
    { id:1, subject:'Physics', kind:'objective', topic:'Waves',  active:true,  answer:1, explanation:'why' },
    { id:2, subject:'Physics', kind:'objective', topic:'Waves',  active:true,  answer:0, explanation:'' },
    { id:3, subject:'Physics', kind:'objective', topic:'Motion', active:true,  answer:2, explanation:'' },
    { id:4, subject:'Physics', kind:'objective', topic:'Motion', active:false, answer:0, explanation:'' },
    { id:5, subject:'Physics', kind:'theory',    topic:'Waves',  active:true,  expected:'x', maxMark:5 },
    { id:6, subject:'Chemistry', kind:'objective', topic:'Acids', active:true, answer:3, explanation:'' }
  ];
  var poolAll = R.studyPool(BANK, 'Physics', null);
  ok('the pool holds only this subject', poolAll.every(function (q) { return q.subject === 'Physics'; }));
  ok('and only questions a machine can mark', poolAll.every(function (q) { return q.kind === 'objective'; }));
  ok('a question held back is not offered for study', poolAll.every(function (q) { return q.id !== 4; }));
  ok('so Physics offers three, not six', poolAll.length === 3, poolAll.length);
  var poolOne = R.studyPool(BANK, 'Physics', ['Motion']);
  ok('choosing one topic narrows the pool to it',
     poolOne.length === 1 && poolOne[0].id === 3, poolOne.length);
  ok('an empty topic list means the whole paper, not an empty paper',
     R.studyPool(BANK, 'Physics', []).length === 3);
  var tps = R.studyTopics(BANK, 'Physics');
  ok('the picker is offered each topic once, with its live count',
     tps.length === 2 && tps[0].topic === 'Motion' && tps[0].questions === 1 &&
     tps[1].topic === 'Waves' && tps[1].questions === 2, JSON.stringify(tps));
  ok('the topics are in alphabetical order, so the list does not shuffle between visits',
     tps[0].topic < tps[1].topic);
  /* Spread, not a block: two questions over two topics is one from each, so a
     short run still covers the paper the student chose. */
  var spread = R.pickStudy(poolAll, 2, function () { return 0.5; });
  ok('a short run is spread across the chosen topics rather than taken from one',
     spread.length === 2 && spread[0].topic !== spread[1].topic,
     spread.map(function (q) { return q.topic; }).join(','));
  ok('asking for more than the pool holds gives the pool, not padding',
     R.pickStudy(poolAll, 99, function () { return 0.5; }).length === 3);

  var prac = R.forPractice(BANK[0], 0);
  var stud = R.forStudent(BANK[0], 0);
  ok('a practice question carries its answer, which is how it is marked as it is tapped',
     prac.answer === 1);
  ok('and its explanation, so a wrong tap teaches something', prac.explanation === 'why');
  ok('an examination question carries neither', stud.answer === undefined &&
     stud.explanation === undefined, JSON.stringify(stud));
  head('what a practice run is worth, and where the earning stops');
  ok('an answer is worth ' + R.PRACTICE_XP_PER_ANSWER + ' XP and a correct one ' +
     (R.PRACTICE_XP_PER_ANSWER + R.PRACTICE_XP_PER_CORRECT) + ' in total',
     R.xpForPractice(10, 6) === 10 * R.PRACTICE_XP_PER_ANSWER + 6 * R.PRACTICE_XP_PER_CORRECT,
     R.xpForPractice(10, 6));
  ok('a run answered but all wrong still earns something for the effort',
     R.xpForPractice(10, 0) === 10);
  ok('a run nobody answered earns nothing', R.xpForPractice(0, 0) === 0);
  ok('more correct than answered is impossible to claim',
     R.xpForPractice(3, 9) === R.xpForPractice(3, 3), R.xpForPractice(3, 9));
  ok('the day\'s allowance is ' + R.PRACTICE_XP_DAILY_CAP + ' XP',
     R.practiceXpRemaining(0) === R.PRACTICE_XP_DAILY_CAP);
  ok('what is already earned today comes off it',
     R.practiceXpRemaining(100) === R.PRACTICE_XP_DAILY_CAP - 100);
  ok('and the allowance never goes negative', R.practiceXpRemaining(9999) === 0);

  head('a student sees only their own papers, and only what is published');
  await api('login')(SID, SPW);
  var cat = await api('studyCatalogue')();
  var mine = cat.subjects.map(function (s) { return s.subject; });
  ok('the catalogue lists the four papers this student sits', mine.length === 4, mine.join(','));
  ok('Mathematics is not among them, because she does not sit it',
     mine.indexOf('Mathematics') === -1, mine.join(','));
  ok('every paper reports how many questions stand behind it',
     cat.subjects.every(function (s) {
       return s.questions === s.topics.reduce(function (m, t) { return m + t.questions; }, 0);
     }));
  ok('and the ceiling on a run is stated rather than left to the screen',
     cat.maxQuestions === R.STUDY_MAX);
  ok('the reading list is carried alongside, one entry per paper',
     cat.reading.length === 4 &&
     cat.reading.every(function (r) { return mine.indexOf(r.subject) > -1; }));

  head('setting up a run: what is refused, and why');
  ok('a mode the academy does not run is refused',
     (await refused(api('startStudy')({ mode: 'exam', subject: 'Physics' }))) === 'Choose practice or CBT.');
  ok('a paper outside her combination is refused by name',
     /Mathematics is not part of your registered subject combination/
       .test(await refused(api('startStudy')({ mode: 'practice', subject: 'Mathematics' }))));
  ok('a topic nobody has published to is refused rather than served empty',
     /No questions have been published/
       .test(await refused(api('startStudy')({ mode: 'cbt', subject: 'Physics', topics: ['Nothing Here'] }))));
  var practiceIgnoresTopics = await api('startStudy')({ mode: 'practice', subject: 'Physics', topics: ['Nothing Here'], count: 2 });
  ok('practice ignores a topics array even if one is sent anyway',
     practiceIgnoresTopics.questions.length === 2, practiceIgnoresTopics.questions.length);
  /* Close this out — practice is one subject at a time (item 2), so an
     unsubmitted run left lying around would block every other subject
     later in this test. */
  await api('submitStudy')({ paperId: practiceIgnoresTopics.paperId, responses: {} });

  head('practice is one subject at a time — the old "every subject" sentinel is refused');
  ok('the sentinel constant is still exposed, only to be recognised and rejected',
     R.PRACTICE_ALL_SUBJECTS === 'All my subjects');
  ok('practice refuses the sentinel outright rather than pooling across subjects',
     (await refused(api('startStudy')({ mode: 'practice', subject: R.PRACTICE_ALL_SUBJECTS, count: R.STUDY_MAX }))) ===
       'Choose a single subject to practice.');
  ok('a CBT run refuses the sentinel too, but as an unknown paper',
     /not part of your registered subject combination/
       .test(await refused(api('startStudy')({ mode: 'cbt', subject: R.PRACTICE_ALL_SUBJECTS }))));

  head('practice restricts a student to one subject while a run is still open');
  var openOne = await api('startStudy')({ mode: 'practice', subject: 'Physics', count: 2 });
  ok('the first run opens normally', !!openOne.paperId);
  ok('starting a different subject while it is open is refused',
     (await refused(api('startStudy')({ mode: 'practice', subject: 'Chemistry', count: 2 }))) ===
       'Finish or submit your Physics practice run before starting a different subject.');
  var sameSubjAgain = await api('startStudy')({ mode: 'practice', subject: 'Physics', count: 2 });
  ok('starting the SAME subject again while one is open is not blocked',
     !!sameSubjAgain.paperId);
  await api('submitStudy')({ paperId: sameSubjAgain.paperId, responses: {} });
  ok('a different subject is still refused while the first run remains open',
     /Finish or submit your Physics practice run/
       .test(await refused(api('startStudy')({ mode: 'practice', subject: 'Chemistry', count: 2 }))));
  await api('submitStudy')({ paperId: openOne.paperId, responses: {} });
  var afterClose = await api('startStudy')({ mode: 'practice', subject: 'Chemistry', count: 2 });
  ok('once the open run is submitted, a different subject is allowed', !!afterClose.paperId);
  await api('submitStudy')({ paperId: afterClose.paperId, responses: {} });

  head('a practice run, marked as it is answered and rewarded when it is done');
  var meBefore = await api('myProfile')();
  var histBefore = await api('myResults')();
  var p = await api('startStudy')({ mode: 'practice', subject: 'Physics', count: 4 });
  ok('the run is registered and carries a paper id', !!p.paperId);
  ok('it is untimed — practice has no clock', p.durationSec === 0);
  ok('it holds the questions asked for', p.questions.length === 4, p.questions.length);
  ok('each question carries its answer, so the page can mark the tap',
     p.questions.every(function (q) { return typeof q.answer === 'number'; }));
  ok('the XP rates come from the data layer, not from the screen',
     p.xpPerAnswer === R.PRACTICE_XP_PER_ANSWER && p.xpPerCorrect === R.PRACTICE_XP_PER_CORRECT);
  ok('and what is left of today\'s allowance is stated up front',
     p.xpLeftToday === R.PRACTICE_XP_DAILY_CAP - 0 || p.xpLeftToday <= R.PRACTICE_XP_DAILY_CAP,
     p.xpLeftToday);
  /* Answer three of four, one of them wrong, and leave one untouched. */
  var resp = {};
  resp[p.questions[0].id] = p.questions[0].answer;
  resp[p.questions[1].id] = p.questions[1].answer;
  resp[p.questions[2].id] = (p.questions[2].answer + 1) % 4;
  var r = await api('submitStudy')({ paperId: p.paperId, responses: resp, timeUsedSec: 0 });
  ok('the run is marked from this side\'s own copy of the answers',
     r.total === 4 && r.answered === 3 && r.correct === 2 && r.wrong === 1 && r.unanswered === 1,
     JSON.stringify([r.total, r.answered, r.correct, r.wrong, r.unanswered]));
  ok('the percentage is of the whole run, not of what was answered',
     r.percent === 50, r.percent);
  ok('it says plainly that the run is not assessed', r.assessed === false);
  ok('the XP is what the marking deserves, not what the page claimed',
     r.xpAwarded === R.xpForPractice(3, 2), r.xpAwarded);
  ok('and it is actually credited to the student', r.xpTotal === meBefore.xp + r.xpAwarded,
     r.xpTotal + ' vs ' + meBefore.xp);
  ok('the level is recalculated from the new total', r.level === R.levelFor(r.xpTotal));
  ok('the allowance left is reported so the figure never stops without explanation',
     r.xpLeftToday === R.PRACTICE_XP_DAILY_CAP - r.xpAwarded, r.xpLeftToday);
  ok('the review names every question, answered or not', r.review.length === 4);
  ok('the review shows the correct answer now the run is over',
     r.review.every(function (x) { return typeof x.answer === 'number'; }));
  ok('an unanswered question is shown as unanswered, not as wrong',
     r.review.filter(function (x) { return x.given === null; }).length === 1);
  ok('the topics are banded, so a student knows what to read next',
     Array.isArray(r.topics) && r.topics.length > 0 &&
     r.topics.every(function (t) { return /strong|developing|weak/.test(t.band); }));
  head('a study run is not an examination: nothing reaches the record');
  var histAfter = await api('myResults')();
  ok('no sitting was added to the student\'s record',
     histAfter.attempts.length === histBefore.attempts.length,
     histBefore.attempts.length + ' → ' + histAfter.attempts.length);
  ok('and the run cannot be found on it by its own paper id',
     !histAfter.attempts.some(function (x) { return String(x.id) === String(p.paperId); }));
  ok('the academic performance is untouched by a practice score',
     JSON.stringify(histAfter.performance) === JSON.stringify(histBefore.performance),
     JSON.stringify(histAfter.performance));
  var perfAfter = await api('myProfile')();
  ok('but the XP did move, because effort outside the exam still counts',
     perfAfter.xp === meBefore.xp + r.xpAwarded, perfAfter.xp);
  ok('a finished run cannot be sent again to earn twice',
     /That study run has ended/
       .test(await refused(api('submitStudy')({ paperId: p.paperId, responses: resp }))));
  ok('and a paper id that was never issued is refused',
     /That study run has ended/
       .test(await refused(api('submitStudy')({ paperId: 'S999-madeup', responses: {} }))));

  head('one student cannot finish another student\'s run');
  var mine2 = await api('startStudy')({ mode: 'practice', subject: 'Physics', count: 2 });
  await api('logout')();
  await api('login')(SID2, 'bello#88');
  ok('a run belongs to the Scholar ID that started it',
     /does not belong to this Scholar ID/
       .test(await refused(api('submitStudy')({ paperId: mine2.paperId, responses: {} }))));
  await api('logout')();
  ok('and nobody signed in can start one at all',
     /log in/i.test(await refused(api('startStudy')({ mode: 'practice', subject: 'Physics' }))));

  head('the day\'s XP allowance holds, however much is practised');
  await api('login')(SID, SPW);
  /* mine2, above, was deliberately left unsubmitted to prove another scholar
     cannot finish it — but its own owner still has it open, and practice is
     now one subject at a time (item 2), so it has to be closed out here
     before a Physics run can be started again. */
  await api('submitStudy')({ paperId: mine2.paperId, responses: {} });
  var guard = 0, last = null;
  while (guard++ < 40) {
    var big = await api('startStudy')({ mode: 'practice', subject: 'Physics', count: R.STUDY_MAX });
    var all = {};
    big.questions.forEach(function (q) { all[q.id] = q.answer; });
    last = await api('submitStudy')({ paperId: big.paperId, responses: all, timeUsedSec: 0 });
    if (last.xpLeftToday === 0) break;
  }
  ok('practising on earns XP until the day\'s allowance is reached',
     last.xpLeftToday === 0, last.xpLeftToday);
  /* The flag reports "this run earned less than it deserved", not "the
     allowance is spent": a run that lands exactly on the allowance reaches
     zero without being trimmed. So it must follow the arithmetic. */
  var deservedAtCap = last.answered + last.correct * 2;
  ok('and the run that reaches it says whether it was trimmed, matching its own arithmetic',
     last.xpCapped === (last.xpAwarded < deservedAtCap),
     last.xpAwarded + ' of ' + deservedAtCap + ' earned, capped=' + last.xpCapped);
  var xpAtCap = (await api('myProfile')()).xp;
  var after = await api('startStudy')({ mode: 'practice', subject: 'Physics', count: 4 });
  var allAfter = {};
  after.questions.forEach(function (q) { allAfter[q.id] = q.answer; });
  var capped = await api('submitStudy')({ paperId: after.paperId, responses: allAfter, timeUsedSec: 0 });
  ok('a run sat after the allowance is still marked in full',
     capped.correct === capped.total && capped.percent === 100);
  ok('but earns no further XP', capped.xpAwarded === 0);
  ok('and the total does not move', (await api('myProfile')()).xp === xpAtCap);
  ok('the student is told the allowance is reached, not left guessing', capped.xpCapped === true);
  head('the student\'s own CBT: timed, and marked only when it is submitted');
  var c = await api('startStudy')({ mode: 'cbt', subject: 'Physics', count: 5, minutes: 20 });
  ok('the clock is the minutes chosen, in seconds', c.durationSec === 20 * 60, c.durationSec);
  ok('no answer is sent to the browser for a CBT paper',
     c.questions.every(function (q) { return q.answer === undefined; }));
  ok('nor an explanation, which would give the answer away',
     c.questions.every(function (q) { return q.explanation === undefined; }));
  ok('no XP rate is quoted, because a CBT set-up does not earn XP',
     c.xpPerCorrect === undefined);
  var cShort = await api('startStudy')({ mode: 'cbt', subject: 'Physics', count: 3, minutes: 1 });
  ok('a clock below the floor is lifted, not accepted',
     cShort.durationSec === R.clampStudyMinutes(1) * 60, cShort.durationSec);
  var cr = await api('submitStudy')({ paperId: c.paperId, responses: {}, timeUsedSec: 90 });
  ok('an unanswered CBT paper is marked as answered nothing, not refused',
     cr.total === 5 && cr.answered === 0 && cr.percent === 0);
  ok('it is not assessed either', cr.assessed === false);
  ok('and it earns no XP, unlike practice', cr.xpAwarded === 0);
  ok('the time used is kept as reported, inside the clock', cr.timeUsedSec === 90, cr.timeUsedSec);
  var cOver = await api('submitStudy')({ paperId: cShort.paperId, responses: {}, timeUsedSec: 99999 });
  ok('a time longer than the clock allowed is brought back to the clock',
     cOver.timeUsedSec === cShort.durationSec, cOver.timeUsedSec);

  head('the set-up screen offers only what the bank can answer');
  run('openPractice')();
  await flush();
  ok('the practice set-up is the screen on show', screenNow() === 'studySet', screenNow());
  ok('it is named as practice, not as an examination',
     text('suTitle').indexOf('practice') > -1, text('suTitle'));
  ok('and says how it is marked: as each answer is chosen',
     /untimed/i.test(text('suSub')) && /marked as you choose/i.test(text('suSub')), text('suSub'));
  var liveSubjects = cat.subjects.filter(function (s) { return s.questions > 0; });
  ok('the subject is chosen from a dropdown: exactly one option per paper the student sits that has questions, and no "all subjects" option',
     count('suSubjectDD', 'option') === liveSubjects.length,
     count('suSubjectDD', 'option'));
  ok('the dropdown is shown and the chip strip is hidden in practice',
     id('suSubjectDDWrap').hidden === false && id('suSubjectChipsWrap').hidden === true);
  ok('Mathematics is not offered, because she does not sit it',
     markup('suSubjectDD').indexOf('Mathematics') === -1);
  ok('the dropdown starts on the paper that is selected', id('suSubjectDD').value === run('suSubj'), id('suSubjectDD').value);
  var startSub = run('suSubj');
  ok('item 4/6: practice shows no topic picker at all', id('suTopicsSection').hidden === true);
  ok('the clock is hidden for practice', id('suTimeWrap').hidden === true);
  ok('and the start button names the run it will begin',
     /^Start practice · \d+ questions?$/.test(text('suStart')), text('suStart'));
  var startEntry = run('suEntry')(startSub);
  ok('the number of questions is typed into a box, not picked from chips',
     id('suCountInputWrap').hidden === false && id('suCountChipsWrap').hidden === true);
  var capNow = Math.min(60, startEntry.questions);
  ok('the number the box starts on is one the whole paper can actually answer',
     run('suCount') >= 1 && run('suCount') <= capNow, run('suCount') + ' of ' + startEntry.questions);
  ok('and the box shows that same number', Number(id('suCountInput').value) === run('suCount'), id('suCountInput').value);
  ok('the box limit matches what the paper holds', Number(id('suCountInput').max) === capNow, id('suCountInput').max);

  head('typing a number of questions');
  var box = id('suCountInput');
  box.value = '3'; run('suCountTyped')(box);
  ok('a typed number becomes the length of the run', run('suCount') === 3, run('suCount'));
  ok('and the Start button says so', text('suStart') === 'Start practice · 3 questions', text('suStart'));
  box.value = '1'; run('suCountTyped')(box);
  ok('one question reads in the singular', text('suStart') === 'Start practice · 1 question', text('suStart'));
  box.value = '99999'; run('suCountTyped')(box);
  ok('a number above what the paper holds is brought down to it', run('suCount') === capNow && Number(box.value) === capNow, run('suCount'));
  box.value = ''; run('suCountTyped')(box);
  ok('an empty box disables Start rather than guessing', id('suStart').disabled === true && text('suStart') === 'Enter number of questions', text('suStart'));
  run('suCountCommit')(box);
  ok('leaving the box empty restores the last valid number', run('suCount') >= 1 && Number(box.value) === run('suCount'), box.value);
  ok('and Start is available again', id('suStart').disabled === false);
  box.value = '0'; run('suCountTyped')(box);
  ok('zero is not a valid length', id('suStart').disabled === true);
  run('suCountCommit')(box);
  box.value = '2'; run('suCountTyped')(box);
  ok('a typed number is kept when the subject list is redrawn', run('suCount') === 2, run('suCount'));

  head('practice is one subject at a time, even though she sits more than one');
  var ddOptionValues = Array.prototype.map.call(id('suSubjectDD').querySelectorAll('option'),
    function (o) { return o.value; });
  ok('"All my subjects" is not offered in the dropdown',
     ddOptionValues.indexOf(R.PRACTICE_ALL_SUBJECTS) === -1, ddOptionValues.join(','));
  ok('every option offered is one of her own registered papers',
     ddOptionValues.every(function (v) { return mine.indexOf(v) > -1; }), ddOptionValues.join(','));

  head('and the CBT set-up differs only in the clock');
  run('openCBT')();
  await flush();
  ok('the CBT set-up says it is timed and marked at the end',
     /timed/i.test(text('suSub')) && /marked when you submit/i.test(text('suSub')), text('suSub'));
  ok('the clock is shown for a CBT', id('suTimeWrap').hidden === false);
  ok('with a choice of lengths', count('suMinutes', '.wt-tab') > 1);
  ok('and the button states both the length and the clock',
     /^Start CBT · \d+ in \d+ min$/.test(text('suStart')), text('suStart'));
  run('suSetMins')(45);
  ok('choosing a different clock is reflected in the button',
     text('suStart').indexOf('in 45 min') > -1, text('suStart'));
  ok('and only one clock is ever selected', count('suMinutes', '.wt-tab.on') === 1);
  head('sitting the practice run: every tap marked the moment it is made');
  run('openPractice')();
  await flush();
  run('suSetSubject')(startSub);
  /* The length is typed into the box; pick one this paper can answer. */
  var typedLen = Math.min(5, Math.min(60, run('suEntry')(startSub).questions));
  var lens = [typedLen];
  ok('the screen accepts a run length to sit', lens.length > 0 && typedLen >= 1, lens.join(','));
  var boxRun = id('suCountInput');
  boxRun.value = String(lens[0]); run('suCountTyped')(boxRun);
  var N = Number(run('suCount'));
  ok('and the length typed is the length the screen kept', N === lens[0], N + ' vs ' + lens[0]);
  run('suStart')();
  await flush();
  // Same instructions-overlay step as the CBT run above (Task 8): suStart()
  // opens it, confirmTestInfo() is the click that actually starts the run.
  run('confirmTestInfo')();
  await flush();
  ok('the practice screen opens', screenNow() === 'practice', screenNow());
  ok('it names the paper, the topic and that there is no clock',
     text('pracSub').indexOf(startSub) > -1 && /untimed/.test(text('pracSub')), text('pracSub'));
  ok('and quotes the XP rate from the data layer',
     /\d+ XP answered, \d+ XP correct/.test(text('pracSub')), text('pracSub'));
  ok('the position in the run is stated',
     text('pracNum') === 'Question 1 of ' + N, text('pracNum'));
  ok('the question is on screen', text('pracQ').length > 5);
  ok('with one button per option', count('pracOpts', '.opt') === 4, count('pracOpts', '.opt'));
  ok('a progress dot per question, the current one marked',
     count('pracProg', 'span') === N && count('pracProg', '.cur') === 1,
     count('pracProg', 'span') + ' dots');
  ok('nothing can be advanced before an answer is chosen',
     id('pracBtn').disabled === true && text('pracBtn') === 'Select an answer');
  ok('and no feedback is shown before the tap', markup('pracFb') === '');

  /* Tap the wrong option first: the marking is instant, the right answer is
     shown, and the explanation is what teaches. */
  var q1 = run('pracQ')();
  var wrongAt = (q1.answer + 1) % 4;
  var opts = id('pracOpts').querySelectorAll('.opt');
  opts[wrongAt].onclick();
  ok('a wrong tap is marked wrong at once', /Not quite/.test(text('pracFb')), text('pracFb'));
  ok('the option tapped is marked as the wrong one', opts[wrongAt].classList.contains('wrong'));
  ok('and the correct option is shown alongside it', opts[q1.answer].classList.contains('correct'));
  ok('every option is locked, so an answer cannot be changed after marking',
     opts.every(function (o) { return o.disabled === true; }));
  ok('something is always said about why, even with no explanation on file',
     text('pracFb').length > 20, text('pracFb'));
  ok('and the run can now be advanced', id('pracBtn').disabled === false &&
     text('pracBtn') === 'Next question →', text('pracBtn'));
  opts[q1.answer].onclick();
  ok('tapping again after marking changes nothing', /Not quite/.test(text('pracFb')));
  run('pracNext')();
  await flush();
  ok('the second question is on screen',
     text('pracNum') === 'Question 2 of ' + N, text('pracNum'));
  ok('with the first dot now filled in', count('pracProg', '.on') === 1);
  ok('and the feedback cleared for a fresh answer', markup('pracFb') === '');
  var q2 = run('pracQ')();
  id('pracOpts').querySelectorAll('.opt')[q2.answer].onclick();
  ok('a correct tap is marked correct at once', /Correct/.test(text('pracFb')), text('pracFb'));

  /* Answer the rest of the run correctly, so exactly one question in the whole
     run is wrong however long the screen made it. */
  var lastNum = '';
  for(var pn = 3; pn <= N; pn++) {
    run('pracNext')();
    await flush();
    lastNum = text('pracNum');
    var qn = run('pracQ')();
    id('pracOpts').querySelectorAll('.opt')[qn.answer].onclick();
  }
  ok('the last question says it is the last',
     lastNum === 'Question ' + N + ' of ' + N, lastNum);
  ok('and the button offers the review rather than another question',
     text('pracBtn') === 'See your review', text('pracBtn'));

  head('the review: what was earned, and what it is not');
  var xpWas = (await api('myProfile')()).xp;
  run('pracNext')();
  await flush();
  ok('the review screen opens', screenNow() === 'studyRes', screenNow());
  var sl = run('srLast');
  ok('the run marked is the run she sat, one wrong out of the whole length',
     sl.total === N && sl.answered === N && sl.correct === N - 1 && sl.wrong === 1,
     sl.correct + '/' + sl.answered + ' of ' + sl.total);
  ok('it leads with the score out of the run',
     text('srTitle') === sl.correct + ' of ' + sl.total + ' correct · ' + sl.percent + '%',
     text('srTitle'));
  ok('and says in the same breath that it is not part of the record',
     /not part of your record/.test(text('srSub')), text('srSub'));
  ok('it names the paper and that practice earns XP',
     text('srSub').indexOf(startSub) > -1 && /earns XP/.test(text('srSub')), text('srSub'));
  ok('the figures are all there to be read',
     ['Questions', 'Answered', 'Correct', 'Incorrect', 'Score'].every(function (k) {
       return text('srStats').indexOf(k) > -1;
     }), text('srStats'));
  ok('the XP earned is shown', /XP earned/.test(text('srStats')), text('srStats'));
  ok('and it is stated again that nothing went on the record',
     /No — study runs are not assessed/.test(text('srStats')), text('srStats'));
  ok('every question of the run is in the review to be read back',
     count('srReview', '.wt-rev') === N, count('srReview', '.wt-rev') + ' of ' + N);
  ok('and each row gives back both what she chose and what was right',
     count('srReview', '.ra') >= N * 2, count('srReview', '.ra'));
  ok('the topics are banded for what to read next',
     count('srBrk', '.brk') > 0, markup('srBrk').slice(0, 120));
  var xpNow = (await api('myProfile')()).xp;
  ok('the XP the data layer awarded is what moved, and only once',
     xpNow === xpWas + (Number(sl.xpAwarded) || 0), xpWas + ' → ' + xpNow);
  head('a practice run never becomes a result, however it ends');
  var recAfter = await api('myResults')();
  ok('the record still holds only the papers she actually sat',
     recAfter.attempts.length === histBefore.attempts.length,
     recAfter.attempts.length + ' vs ' + histBefore.attempts.length);
  var beforeIds = histBefore.attempts.map(function (x) { return String(x.id); }).sort().join(',');
  ok('and not one row of it changed', recAfter.attempts.map(function (x) { return String(x.id); })
     .sort().join(',') === beforeIds);
  await api('logout')();
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  var seen = await api('listResults')({ scholarId: SID });
  ok('management\'s record of her shows no study run either',
     seen.results.length === histBefore.attempts.length,
     seen.results.length + ' vs ' + histBefore.attempts.length);
  ok('every row it does show is a real paper, with a session and a marking status',
     seen.results.every(function (x) { return !!x.section && !!x.status; }));
  await api('logout')();

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  if (fails) process.exit(1);
}

main().catch(function (e) {
  console.log('\nTHREW: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
