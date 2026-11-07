/* test-free2027-jamb.js — standard JAMB UTME competition marking and the
   percentage-only public leaderboard, at the rules level.
   ---------------------------------------------------------------------------
   These are the pure functions the server calls when it marks a standard
   180-question competition, so the arithmetic is checked exactly rather than
   inferred from an HTTP round trip:

     • Use of English is scaled from 60 questions to 100;
     • each other subject is scaled from 40 questions to 100;
     • the four subject scores sum to the paper total, out of 400;
     • rounding is applied once per subject and the total is the sum of those
       rounded values, so the displayed figures always add up;
     • one percentage rule feeds the result and the board alike;
     • the public board carries a percentage and never a raw score.

   A competition that is not configured as a standard 180-question paper is
   unaffected, and neither is any weekly assessment.
   node test/test-free2027-jamb.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var f = require(path.join(APP, 'js', 'goc-free-2027.js'));

var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 240) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var DIST = { 'Use of English': 60, 'Mathematics': 40, 'Physics': 40, 'Chemistry': 40 };

/* Build the marking engine's own per-question rows: `correct` maps a subject to
   how many of its questions were answered correctly. */
function rows(correct) {
  var out = [];
  Object.keys(DIST).forEach(function (subject) {
    var n = DIST[subject], right = Number(correct[subject]) || 0;
    for (var i = 0; i < n; i++) {
      out.push({ questionId: subject + '-' + i, kind: 'objective', subject: subject, isCorrect: i < right });
    }
  });
  return out;
}
function scoreOf(correct) { return f.jambSubjectScores(rows(correct), DIST); }
function subject_named(res, name) {
  return res.subjects.filter(function (x) { return x.subject === name; })[0];
}

/* ───────────────────────────── structure ───────────────────────────── */
head('the standard UTME structure is recognised from the existing configuration');
ok('a 180-question competition is a standard paper',
  f.isJambCompetition({ kind: 'competition', questionCount: 180 }) === true);
ok('a smaller competition is left alone',
  f.isJambCompetition({ kind: 'competition', questionCount: 20 }) === false);
ok('a 180-question weekly assessment is NOT a competition paper',
  f.isJambCompetition({ kind: 'weekly', questionCount: 180 }) === false);
ok('the constants match the standard structure',
  f.JAMB_QUESTION_COUNT === 180 && f.JAMB_ENGLISH_QUESTIONS === 60 &&
  f.JAMB_OTHER_QUESTIONS === 40 && f.JAMB_TOTAL_MAX === 400 && f.JAMB_SUBJECT_MAX === 100);

head('subject distribution validation');
ok('the standard distribution is accepted', f.jambDistributionProblem(DIST) === null);
ok('a missing distribution is rejected', /needs a subject distribution/.test(f.jambDistributionProblem(null)));
ok('English must carry exactly 60', /Use of English must carry exactly 60/.test(
  f.jambDistributionProblem({ 'Use of English': 50, 'Mathematics': 50, 'Physics': 40, 'Chemistry': 40 })));
ok('three other subjects are required', /exactly 3 other subjects/.test(
  f.jambDistributionProblem({ 'Use of English': 60, 'Mathematics': 60, 'Physics': 60 })));
ok('four other subjects are rejected', /exactly 3 other subjects/.test(
  f.jambDistributionProblem({ 'Use of English': 60, 'Mathematics': 40, 'Physics': 40, 'Chemistry': 40, 'Biology': 40 })));
ok('each other subject must carry exactly 40', /Mathematics must carry exactly 40/.test(
  f.jambDistributionProblem({ 'Use of English': 60, 'Mathematics': 30, 'Physics': 45, 'Chemistry': 45 })));
ok('an unknown subject is rejected', /Unknown subject/.test(
  f.jambDistributionProblem({ 'Use of English': 60, 'Astrology': 40, 'Physics': 40, 'Chemistry': 40 })));
ok('English is always listed first', f.jambSubjectOrder(DIST)[0] === 'Use of English');
/* Still proves the names come from the distribution and are not hard-coded:
   Biology is present and Physics is absent. The ORDER is now the edition's
   canonical order (English, Mathematics, Physics, Chemistry, Biology) rather
   than the order the keys happened to be written in. */
ok('the configured subject names are used, not hard-coded ones',
  f.jambSubjectOrder({ 'Use of English': 60, 'Biology': 40, 'Mathematics': 40, 'Chemistry': 40 })
    .join('|') === 'Use of English|Mathematics|Chemistry|Biology');
ok('the order never depends on the order the keys were written in',
  f.jambSubjectOrder({ 'Biology': 40, 'Chemistry': 40, 'Use of English': 60, 'Mathematics': 40 })
    .join('|') === f.jambSubjectOrder({ 'Use of English': 60, 'Mathematics': 40, 'Chemistry': 40, 'Biology': 40 }).join('|'));
ok('the full canonical order is English, Mathematics, Physics, Chemistry, Biology',
  f.sortSubjects(['Biology', 'Chemistry', 'Physics', 'Mathematics', 'Use of English'])
    .join('|') === 'Use of English|Mathematics|Physics|Chemistry|Biology');

head('validateActivity enforces the distribution only on a standard competition');
var base = { title: 'Term Cup', opensAt: Date.now(), closesAt: Date.now() + 3600000, durationMin: 120, maxAttempts: 1 };
var badDist = { kind: 'competition', questionCount: 180,
  subjectDistribution: { 'Use of English': 50, 'Mathematics': 50, 'Physics': 40, 'Chemistry': 40 } };
ok('a standard competition with a bad distribution is refused at save',
  !!f.validateActivity(Object.assign({}, base, badDist)).error);
ok('a standard competition with the right distribution saves',
  !f.validateActivity(Object.assign({}, base, { kind: 'competition', questionCount: 180, subjectDistribution: DIST })).error);
ok('a small competition keeps its old distribution freedom',
  !f.validateActivity(Object.assign({}, base, { kind: 'competition', questionCount: 10 })).error);
ok('a weekly assessment is never forced into the UTME distribution',
  !f.validateActivity(Object.assign({}, base, { kind: 'weekly', questionCount: 20 })).error);

head('the activity POOL cap is the eligible bank, not one paper');
/* The 180 pool ceiling has been removed: a competition pool is bounded by the
   eligible questions available, while each candidate still sits 180. */
ok('180 is no longer the competition pool ceiling', f.maxQuestionsFor('competition') > 180);
ok('the cap is the available eligible count when it is known', f.maxQuestionsFor('competition', 220) === 220);
ok('a larger bank raises the cap accordingly', f.maxQuestionsFor('competition', 640) === 640);
ok('an unknown availability falls back to the structural ceiling',
  f.maxQuestionsFor('competition') === f.MAX_COMPETITION_POOL);
ok('a nonsense availability never becomes the cap',
  f.maxQuestionsFor('competition', 0) === f.MAX_COMPETITION_POOL &&
  f.maxQuestionsFor('competition', -5) === f.MAX_COMPETITION_POOL &&
  f.maxQuestionsFor('competition', 'abc') === f.MAX_COMPETITION_POOL);
ok('a weekly assessment keeps its original cap of 100', f.maxQuestionsFor('weekly') === 100);
ok('and weekly ignores competition availability entirely', f.maxQuestionsFor('weekly', 640) === 100);
ok('the general cap constant is unchanged', f.MAX_QUESTIONS === 100);
ok('a 181-question competition pool is now accepted',
  !f.validateActivity(Object.assign({}, base, { kind: 'competition', questionCount: 181 })).error);
var pool220 = { 'Use of English': 60, Mathematics: 40, Physics: 40, Chemistry: 40, Biology: 40 };
ok('a 220-question pool across all five subjects is accepted',
  !f.validateActivity(Object.assign({}, base, { kind: 'competition', questionCount: 220, subjectDistribution: pool220 })).error);
ok('a pool distribution must still add up to the pool size',
  !!f.validateActivity(Object.assign({}, base, { kind: 'competition', questionCount: 220,
    subjectDistribution: { 'Use of English': 60, Mathematics: 40, Physics: 40, Chemistry: 40 } })).error);
ok('zero and negative pool sizes are still refused',
  !!f.validateActivity(Object.assign({}, base, { kind: 'competition', questionCount: 0 })).error &&
  !!f.validateActivity(Object.assign({}, base, { kind: 'competition', questionCount: -20 })).error);
ok('a 101-question weekly assessment is still refused',
  !!f.validateActivity(Object.assign({}, base, { kind: 'weekly', questionCount: 101 })).error);

head('a larger pool still serves standard 180-question papers');
ok('a 220 pool serves standard papers', f.servesJambPaper({ kind: 'competition', questionCount: 220 }));
ok('a 180 pool serves standard papers', f.servesJambPaper({ kind: 'competition', questionCount: 180 }));
ok('a smaller competition does not', !f.servesJambPaper({ kind: 'competition', questionCount: 40 }));
ok('a weekly assessment never does', !f.servesJambPaper({ kind: 'weekly', questionCount: 220 }));
ok('the candidate\'s distribution is still 60 + 40 + 40 + 40',
  f.combinationDistribution(['Use of English', 'Mathematics', 'Chemistry', 'Biology'])['Use of English'] === 60 &&
  f.JAMB_QUESTION_COUNT === 180 && f.JAMB_TOTAL_MAX === 400);

/* ───────────────────────────── marking ─────────────────────────────── */
head('perfect, zero and partial papers');
var perfect = scoreOf({ 'Use of English': 60, 'Mathematics': 40, 'Physics': 40, 'Chemistry': 40 });
ok('a perfect paper scores 400/400', perfect.score === 400 && perfect.maxScore === 400, JSON.stringify(perfect.score));
ok('every subject is 100 on a perfect paper',
  perfect.subjects.every(function (x) { return x.score === 100 && x.maxScore === 100; }));
ok('a perfect paper is 100%', perfect.percent === 100, perfect.percent);

var zero = scoreOf({});
ok('a blank paper scores 0/400', zero.score === 0 && zero.maxScore === 400, zero.score);
ok('a blank paper is 0%', zero.percent === 0, zero.percent);
ok('a blank paper still reports all four subjects', zero.subjects.length === 4);

var partial = scoreOf({ 'Use of English': 45, 'Mathematics': 34, 'Physics': 32, 'Chemistry': 33 });
ok('English 45/60 converts to 75', subject_named(partial, 'Use of English').score === 75, JSON.stringify(subject_named(partial, 'Use of English')));
ok('Mathematics 34/40 converts to 85', subject_named(partial, 'Mathematics').score === 85);
ok('Physics 32/40 converts to 80', subject_named(partial, 'Physics').score === 80);
ok('Chemistry 33/40 converts to 82.5', subject_named(partial, 'Chemistry').score === 82.5);
ok('the paper total is the sum of the four subjects', partial.score === 322.5, partial.score);
ok('the total never exceeds 400', partial.score <= 400);
ok('the percentage is derived from the official total', partial.percent === 80.63, partial.percent);

head('conversion and rounding');
var eng = scoreOf({ 'Use of English': 46 });
ok('English uses (correct / 60) x 100, rounded once',
  subject_named(eng, 'Use of English').score === 76.67, subject_named(eng, 'Use of English').score);
var one = scoreOf({ 'Mathematics': 1 });
ok('another subject uses (correct / 40) x 100',
  subject_named(one, 'Mathematics').score === 2.5, subject_named(one, 'Mathematics').score);
var third = scoreOf({ 'Use of English': 1 });
ok('one English answer is 1.67, not 1.666…',
  subject_named(third, 'Use of English').score === 1.67, subject_named(third, 'Use of English').score);

/* Every subject score is rounded once, so the sum of the displayed subject
   scores must equal the displayed total exactly — never off by a hundredth. */
var drift = scoreOf({ 'Use of English': 7, 'Mathematics': 7, 'Physics': 7, 'Chemistry': 7 });
var sum = drift.subjects.reduce(function (a, x) { return a + x.score; }, 0);
ok('rounded subject scores add up to the displayed total',
  Math.round(sum * 100) / 100 === drift.score, sum + ' vs ' + drift.score);
var sweep = true, sweepCase = null;
for (var e = 0; e <= 60; e += 7) {
  for (var m = 0; m <= 40; m += 9) {
    var r = scoreOf({ 'Use of English': e, 'Mathematics': m, 'Physics': 40 - m, 'Chemistry': 60 - e > 40 ? 40 : 60 - e });
    var s = Math.round(r.subjects.reduce(function (a, x) { return a + x.score; }, 0) * 100) / 100;
    if (s !== r.score) { sweep = false; sweepCase = JSON.stringify(r); }
  }
}
ok('subject scores always sum to the total across a sweep of papers', sweep, sweepCase);

head('one percentage rule for every surface');
ok('326/400 is 81.5%', f.percentOf(326, 400) === 81.5, f.percentOf(326, 400));
ok('377/400 is 94.25%', f.percentOf(377, 400) === 94.25, f.percentOf(377, 400));
ok('a zero maximum yields 0 rather than NaN', f.percentOf(0, 0) === 0);
ok('the paper percentage equals percentOf(score, maxScore)',
  partial.percent === f.percentOf(partial.score, partial.maxScore));

/* ─────────────────────────── leaderboard ───────────────────────────── */
head('the public leaderboard shows percentages, never raw scores');
var comp = { id: 'Q1', kind: 'competition', title: 'Cup', status: 'published', leaderboard: { approved: true, published: true } };
var field = [
  { participantId: 'P1', name: 'Student A', course: 'Law', score: 377, maxScore: 400, timeUsedSec: 100 },
  { participantId: 'P2', name: 'Student B', course: 'Law', score: 366, maxScore: 400, timeUsedSec: 110 },
  { participantId: 'P3', name: 'Student C', course: 'Law', score: 355, maxScore: 400, timeUsedSec: 120 },
  { participantId: 'P4', name: 'Student D', course: 'Law', score: 340, maxScore: 400, timeUsedSec: 130 }
];
var board = f.publicLeaderboard(comp, field);
ok('the board is produced for a published competition', !!board && board.rows.length === 4);
ok('the primary metric is the percentage',
  board.rows.map(function (r) { return r.percent; }).join(',') === '94.25,91.5,88.75,85',
  JSON.stringify(board.rows.map(function (r) { return r.percent; })));
ok('no row carries a raw score', board.rows.every(function (r) { return r.score === undefined; }));
ok('no row carries a maximum score', board.rows.every(function (r) { return r.maxScore === undefined; }));
ok('the serialised board contains no 400-based score', JSON.stringify(board).indexOf('"score"') < 0);
ok('identity and ranking fields are preserved',
  board.rows[0].participantId === 'P1' && board.rows[0].rank === 1 && board.rows[0].name === 'Student A');
ok('ordering is still highest score first', board.rows[0].percent > board.rows[1].percent);

var tied = f.publicLeaderboard(comp, [
  { participantId: 'A', score: 300, maxScore: 400, timeUsedSec: 90 },
  { participantId: 'B', score: 300, maxScore: 400, timeUsedSec: 60 },
  { participantId: 'C', score: 300, maxScore: 400, timeUsedSec: 60 }
]);
ok('the existing tie-break still prefers the shorter time', tied.rows[0].participantId === 'B');
ok('equal score AND equal time still share a place',
  tied.rows[0].rank === 1 && tied.rows[1].rank === 1 && tied.rows[2].rank === 3,
  JSON.stringify(tied.rows.map(function (r) { return r.rank; })));

/* The candidate's own position is private and still carries their real score. */
var pos = f.myPosition(comp, field, 'P3');
ok('a candidate still sees their own score privately', pos.score === 355 && pos.maxScore === 400, JSON.stringify(pos));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
