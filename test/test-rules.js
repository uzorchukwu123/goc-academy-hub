/* test-rules.js — the shared domain rules in js/goc-core.js, tested directly.
   These are the rules both drivers and the server enforce with, so a failure
   here is a failure everywhere. No dependencies; run:  node test/test-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

head('Priority 5 — UTME only, and nothing that merely looks like it');
['JAMB / UTME 2027', 'JAMB / UTME', 'UTME', 'jamb'].forEach(function (g) {
  ok(g + ' accepted', core.validateExam(g).ok);
});
['WAEC', 'WASSCE', 'NECO', 'NABTEB', 'Post-UTME', 'Post UTME', 'post-utme 2027',
 'IJMB', 'JUPEB', 'A-Level', 'GCE', 'IELTS', 'TOEFL', 'SAT'].forEach(function (g) {
  var v = core.validateExam(g);
  ok(g + ' refused', !v.ok);
  ok(g + ' is told why', !v.ok && v.error.indexOf(g) > -1);
});

/* validateExam is deliberately lenient about a blank goal, because the sign-up
   screen calls it while the student is still filling the form in. requireExam is
   the version the data layer uses, where a blank goal means an account would be
   written with an examination nobody ever stated. */
head('a blank examination: forgiven on the form, refused at the data layer');
['', '   ', null, undefined].forEach(function (g) {
  ok('validateExam(' + JSON.stringify(g) + ') does not shout at a half-filled form',
     core.validateExam(g).ok);
  var bv = core.requireExam(g);
  ok('requireExam(' + JSON.stringify(g) + ') refuses it', !bv.ok);
  ok('and says which examination to choose',
     !bv.ok && /JAMB/.test(bv.error), bv.error);
});
ok('requireExam still accepts the real goal', core.requireExam('JAMB / UTME 2027').ok);
ok('requireExam still refuses another examination', !core.requireExam('WAEC').ok);
ok('requireExam normalises to the one examination the academy runs',
   core.requireExam('UTME').exam === core.EXAM);

head('Priority 5 — Use of English plus exactly three sciences');
ok('English + 3 sciences accepted', core.validateSubjects(['Use of English', 'Physics', 'Chemistry', 'Biology']).ok);
ok('order is normalised, English first',
   core.validateSubjects(['Biology', 'Physics', 'Use of English', 'Chemistry']).subjects[0] === 'Use of English');
[['English + 2 sciences', ['Use of English', 'Physics', 'Chemistry']],
 ['English + all 4 sciences', ['Use of English', 'Physics', 'Chemistry', 'Biology', 'Mathematics']],
 ['3 sciences, no English', ['Physics', 'Chemistry', 'Biology']],
 ['fewer than four papers', ['Use of English', 'Physics']],
 ['a subject the academy does not teach', ['Use of English', 'Physics', 'Chemistry', 'Geography']],
 ['the same science twice', ['Use of English', 'Physics', 'Physics', 'Chemistry']],
 ['nothing at all', []]].forEach(function (c) {
  var v = core.validateSubjects(c[1]);
  ok(c[0] + ' refused', !v.ok);
  ok(c[0] + ' explains itself', !v.ok && typeof v.error === 'string' && v.error.length > 10);
});

head('the question bank covers every paper');
var bank = core.seedQuestions();
var objective = {}, theory = {};
bank.forEach(function (q) {
  if (!q.active) return;
  var b = q.kind === 'theory' ? theory : objective;
  b[q.subject] = (b[q.subject] || 0) + 1;
});
core.ALL_SUBJECTS.forEach(function (s) {
  ok('objective questions for ' + s, (objective[s] || 0) > 0, String(objective[s] || 0));
  /* Not every subject sits a written paper — mathematics is examined in the
     objective sitting only — so the bank is expected to carry theory questions
     for exactly the subjects that offer one, and none for the others. */
  if (core.theoryAllowed(s)) ok('theory questions for ' + s, (theory[s] || 0) > 0, String(theory[s] || 0));
  else ok('no theory question for ' + s + ', which sits no written paper', !theory[s], String(theory[s] || 0));
});

head('a subject may be examined in the objective sitting only');
ok('mathematics offers no written paper', core.theoryAllowed('Mathematics') === false);
ok('every other subject does', core.ALL_SUBJECTS.filter(function (s) { return core.theoryAllowed(s); }).length
   === core.ALL_SUBJECTS.length - 1);
ok('the rule is published as a list', core.NO_THEORY.join(',') === 'Mathematics', core.NO_THEORY.join(','));
ok('and as the subjects that do offer one', core.THEORY_SUBJECTS.indexOf('Mathematics') === -1
   && core.THEORY_SUBJECTS.length === 4, core.THEORY_SUBJECTS.join(','));
ok('a combination is filtered down to its written papers',
   core.theorySubjects(['Use of English', 'Physics', 'Mathematics', 'Biology']).join(',')
   === 'Use of English,Physics,Biology',
   core.theorySubjects(['Use of English', 'Physics', 'Mathematics', 'Biology']).join(','));
ok('and an empty combination reads as the whole curriculum',
   core.theorySubjects([]).length === 4, core.theorySubjects([]).join(','));
ok('the refusal names the subject and where it is examined',
   /Mathematics/.test(core.noTheoryMessage('Mathematics'))
   && /objective/i.test(core.noTheoryMessage('Mathematics')), core.noTheoryMessage('Mathematics'));
/* The rule is enforced where questions are served, not on a screen: a
   mathematics theory question published before the rule existed can never be
   served, counted or listed. */
var legacy = [{ id: 9001, subject: 'Mathematics', topic: 'Mensuration', kind: 'theory', section: 'theory',
                period: 'test', text: 'Find the total surface area of the cylinder.', expected: 'x'.repeat(20),
                maxMark: 10, options: [], answer: null, active: true },
              { id: 9002, subject: 'Physics', topic: 'Motion', kind: 'theory', section: 'theory',
                period: 'test', text: 'State Newton’s first law of motion.', expected: 'x'.repeat(20),
                maxMark: 10, options: [], answer: null, active: true }];
ok('a stored mathematics theory question is never served',
   core.eligible(legacy, { section: 'theory', subject: 'Mathematics' }).length === 0);
ok('not even when no subject is asked for',
   core.eligible(legacy, { section: 'theory' }).length === 1,
   core.eligible(legacy, { section: 'theory' }).length);
ok('and the one that is served is the other subject’s',
   core.eligible(legacy, { section: 'theory' })[0].subject === 'Physics');
ok('the console cannot publish one either',
   !!core.validateQuestion({ subject: 'Mathematics', section: 'theory', text: 'Solve for x in 2x + 1 = 9.',
                             expected: 'x'.repeat(20), maxMark: 10 }).error);
ok('and is told why', /objective sitting only/
   .test(core.validateQuestion({ subject: 'Mathematics', section: 'theory', text: 'Solve for x in 2x + 1 = 9.',
                                 expected: 'x'.repeat(20), maxMark: 10 }).error));
ok('while a mathematics objective question is accepted as always',
   !!core.validateQuestion({ subject: 'Mathematics', section: 'objective', text: 'Simplify 2³ × 2⁵ ÷ 2⁴.',
                             options: ['2²', '2⁴'], answer: 1 }).rec);
ok('and a written paper in another subject is accepted',
   !!core.validateQuestion({ subject: 'Physics', section: 'theory', text: 'State Newton’s first law of motion.',
                             expected: 'x'.repeat(20), maxMark: 10 }).rec);

head('a student is never handed the answer');
var served = core.forStudent(bank[0]);
ok('no answer index', served.answer === undefined);
ok('no reference answer', served.expected === undefined);
ok('no explanation', served.explanation === undefined);
ok('serialised form leaks nothing', JSON.stringify(served).indexOf('"answer"') < 0);

head('Priority 9 — the session policy is bounded before it is stored');
ok('the bounds are published', !!(core.SESSION_BOUNDS && core.WARN_BOUNDS),
   JSON.stringify(core.SESSION_BOUNDS) + JSON.stringify(core.WARN_BOUNDS));
ok('two hours is the default', core.SESSION_DEFAULT === 120, String(core.SESSION_DEFAULT));
ok('five minutes of warning is the default', core.WARN_DEFAULT === 5, String(core.WARN_DEFAULT));
[[120, 120], [15, 15], [480, 480], [1, 15], [0, 120], [10080, 480], [90.4, 90], [90.6, 91],
 ['', 120], ['soon', 120], [null, 120], [undefined, 120], [-60, 15]].forEach(function (c) {
  ok('a session of ' + JSON.stringify(c[0]) + ' becomes ' + c[1],
     core.clampSessionMinutes(c[0]) === c[1], String(core.clampSessionMinutes(c[0])));
});
[[5, 120, 5], [1, 120, 1], [30, 120, 30], [0, 120, 5], [999, 480, 30], [30, 15, 14],
 [10, 15, 10], [20, 15, 14], ['x', 60, 5], [-4, 60, 1]].forEach(function (c) {
  ok('a warning of ' + JSON.stringify(c[0]) + ' on a ' + c[1] + '-minute session becomes ' + c[2],
     core.clampWarnMinutes(c[0], c[1]) === c[2], String(core.clampWarnMinutes(c[0], c[1])));
});
ok('a warning can never be as long as the session it warns about',
   [15, 16, 20, 31, 60, 480].every(function (s) {
     return core.clampWarnMinutes(999, s) < core.clampSessionMinutes(s);
   }));

head('Priority 9 — the countdown the student reads');
[[299, '04:59'], [300, '05:00'], [60, '01:00'], [59, '00:59'], [9, '00:09'], [0, '00:00'],
 [-40, '00:00'], [3600, '60:00'], [0.4, '00:00'], [1.6, '00:02']].forEach(function (c) {
  ok(c[0] + ' seconds reads ' + c[1], core.fmtCountdown(c[0]) === c[1], core.fmtCountdown(c[0]));
});
ok('nonsense reads as no time left', core.fmtCountdown('later') === '00:00', core.fmtCountdown('later'));
ok('every reading is exactly mm:ss',
   [0, 5, 61, 599, 3599].every(function (s) { return /^\d\d:\d\d$/.test(core.fmtCountdown(s)); }));

/* ==========================================================================
   Priorities 10, 11 and 12 — the Scholar League.
   The whole point of the league is that it rewards results, not activity. A
   student who grinds through papers badly must not outrank one who sits few
   papers and does well. That is a single comparator, and everything below
   exists so it cannot be quietly inverted by a later edit.
   ======================================================================== */

head('Priority 11 — XP earned for a marked paper');
[[0, 10], [100, 60], [50, 35], [80, 50], [49.6, 35], [null, 10], ['x', 10]].forEach(function (c) {
  ok('a paper at ' + JSON.stringify(c[0]) + '% is worth ' + c[1] + ' XP',
     core.xpForAttempt(c[0]) === c[1], String(core.xpForAttempt(c[0])));
});
ok('sitting a paper is always worth something, however badly it went',
   core.xpForAttempt(0) > 0);
ok('a better paper is never worth less XP than a worse one',
   [0, 10, 25, 40, 55, 70, 85, 100].every(function (p, i, all) {
     return i === 0 || core.xpForAttempt(p) >= core.xpForAttempt(all[i - 1]);
   }));

head('Priority 11 — overall academic performance');
function att(section, subject, percent, status) {
  return { section: section, subject: subject, percent: percent,
           status: status || (percent === null ? 'awaiting-marking' : 'marked') };
}
var W = core.DEFAULT_WEIGHTS;
ok('the shipped weighting is 40 objective / 30 theory / 30 JAMB',
   W.objective === 40 && W.theory === 30 && W.jamb === 30);

var none = core.computePerformance([], W);
ok('a student with no marked papers has no performance figure', none.overall === 0);
ok('and is flagged as having no data, not as scoring zero', none.hasData === false);
ok('nothing is counted as assessed', none.markedAttempts === 0);

var oneOnly = core.computePerformance([att('objective', 'Physics', 70)], W);
ok('a single section on its own carries the whole figure — no dilution',
   oneOnly.overall === 70, String(oneOnly.overall));
ok('the untouched sections are absent rather than zero',
   oneOnly.bySection.theory === undefined && oneOnly.bySection.jamb === undefined);

/* This is the rule that stops a student being punished for what they have not
   sat yet: weights are normalised over the sections actually marked. */
var twoSec = core.computePerformance(
  [att('objective', 'Physics', 100), att('theory', 'Physics', 50)], W);
ok('two sections normalise over 70, not 100  (100*40 + 50*30) / 70 = 78.6',
   twoSec.overall === 78.6, String(twoSec.overall));
var threeSec = core.computePerformance(
  [att('objective', 'Physics', 100), att('theory', 'Physics', 50), att('jamb', 'Physics', 40)], W);
ok('all three sections use the full weighting  (4000+1500+1200)/100 = 67',
   threeSec.overall === 67, String(threeSec.overall));

var avg = core.computePerformance(
  [att('objective', 'Physics', 40), att('objective', 'Physics', 80)], W);
ok('several papers in one section are averaged, not summed',
   avg.overall === 60, String(avg.overall));
ok('both are counted as assessed', avg.markedAttempts === 2);

var mixed = core.computePerformance(
  [att('objective', 'Physics', 90), att('theory', 'Physics', null),
   { section: 'objective', subject: 'Physics', percent: 10, status: 'awaiting-marking' }], W);
ok('an unmarked paper is ignored entirely, in either direction',
   mixed.overall === 90, String(mixed.overall));
ok('and is not counted as assessed', mixed.markedAttempts === 1);

var bySubj = core.computePerformance(
  [att('objective', 'Physics', 90), att('objective', 'Chemistry', 30)], W);
ok('performance is broken down per subject too',
   bySubj.bySubject.Physics === 90 && bySubj.bySubject.Chemistry === 30);
ok('an unknown section is treated as objective rather than dropped',
   core.computePerformance([att('practice', 'Physics', 60)], W).overall === 60);
ok('the weighting used is reported back, so a screen can show it',
   bySubj.weights.objective === 40 && bySubj.weights.theory === 30);

head('Priority 10 — the league order: performance first, XP only to break a tie');
function row(name, performance, xp) { return { name: name, performance: performance, xp: xp }; }
function names(list) { return list.map(function (r) { return r.name; }).join(','); }

var grinder = core.rankLeague([
  row('Grinder', 0, 900),
  row('Scholar', 100, 60)
]);
ok('a high-XP, low-performance student ranks BELOW a low-XP, high-performance one',
   names(grinder) === 'Scholar,Grinder', names(grinder));
ok('the winner is rank 1', grinder[0].rank === 1);
ok('ranks are consecutive from 1', grinder[1].rank === 2);

var tie = core.rankLeague([
  row('Lower XP', 80, 100),
  row('Higher XP', 80, 400)
]);
ok('when performance ties, the higher XP wins', names(tie) === 'Higher XP,Lower XP', names(tie));

/* The name tie-break exists only to stop the table reshuffling between reads.
   Without it two identical students could swap places on every refresh. */
var same = core.rankLeague([row('Zara', 50, 100), row('Adaeze', 50, 100), row('Musa', 50, 100)]);
ok('a full tie falls back to name, so the order is stable',
   names(same) === 'Adaeze,Musa,Zara', names(same));
ok('ranking the same table twice gives the identical order',
   names(core.rankLeague([row('Zara', 50, 100), row('Adaeze', 50, 100)])) ===
   names(core.rankLeague([row('Adaeze', 50, 100), row('Zara', 50, 100)])));

var scrambled = core.rankLeague([
  row('D', 10, 10), row('A', 95, 10), row('C', 40, 10), row('B', 70, 10)
]);
ok('an unsorted table comes back fully ordered', names(scrambled) === 'A,B,C,D', names(scrambled));
ok('every row carries its rank',
   scrambled.every(function (r, i) { return r.rank === i + 1; }));

ok('a missing performance figure is treated as zero, not as undefined',
   names(core.rankLeague([{ name: 'NoPerf', xp: 999 }, row('Some', 1, 0)])) === 'Some,NoPerf');
ok('a missing XP figure does not throw',
   core.rankLeague([{ name: 'Bare' }, { name: 'Also' }]).length === 2);
ok('an empty league is an empty table, not an error', core.rankLeague([]).length === 0);
ok('no rows at all is handled', core.rankLeague().length === 0);
ok('ranking does not mutate the caller\'s array', (function () {
  var mine = [row('B', 1, 1), row('A', 9, 9)];
  core.rankLeague(mine);
  return mine[0].name === 'B';
})());

head('Priority 12 — the tier a rank falls into');
[[1, 10, 'Diamond League'], [2, 10, 'Diamond League'], [3, 10, 'Gold League'],
 [4, 10, 'Gold League'], [5, 10, 'Silver League'], [7, 10, 'Silver League'],
 [8, 10, 'Bronze League'], [10, 10, 'Bronze League'],
 [1, 1, 'Diamond League'], [1, 5, 'Diamond League'], [5, 5, 'Bronze League']].forEach(function (c) {
  ok('rank ' + c[0] + ' of ' + c[1] + ' is ' + c[2],
     core.leagueName(c[0], c[1]) === c[2], core.leagueName(c[0], c[1]));
});
ok('an empty league still names a tier rather than blanking the screen',
   core.leagueName(1, 0) === 'Bronze League');
/* The pilot cohort starts small, so a two- or three-scholar league is the
   normal case at launch. On pure percentiles rank 1 of 1 lands in Bronze. */
ok('the only scholar in a league of one is Diamond, not Bronze',
   core.leagueName(1, 1) === 'Diamond League', core.leagueName(1, 1));
ok('top place is never anything but Diamond, whatever the size',
   [1, 2, 3, 5, 20, 100, 999].every(function (n) {
     return core.leagueName(1, n) === 'Diamond League';
   }));
ok('last place is never anything but Bronze, whatever the size',
   [2, 3, 5, 20, 100, 999].every(function (n) {
     return core.leagueName(n, n) === 'Bronze League';
   }));
ok('a tier is never skipped as rank walks down a large league', (function () {
  var seen = [], i, t;
  for (i = 1; i <= 100; i++) { t = core.leagueName(i, 100); if (seen[seen.length - 1] !== t) seen.push(t); }
  return seen.join(' > ') === 'Diamond League > Gold League > Silver League > Bronze League';
})());

head('Priorities 10-12 together — the scenario the league exists to get right');
/* Priority 15.6 scenario 1, as an engine test rather than a live one: eight bad
   papers against one excellent paper. */
var bad = [], i;
for (i = 0; i < 8; i++) bad.push(att('objective', 'Physics', 0));
var grindXp = bad.reduce(function (t, a) { return t + core.xpForAttempt(a.percent); }, 0);
var quietXp = core.xpForAttempt(100);
var table = core.rankLeague([
  { name: 'Grinder', xp: grindXp, performance: core.computePerformance(bad, W).overall },
  { name: 'Quiet', xp: quietXp, performance: core.computePerformance([att('theory', 'Physics', 100)], W).overall }
]);
ok('the scenario is meaningful: the grinder really does hold more XP', grindXp > quietXp,
   grindXp + ' vs ' + quietXp);
ok('the scenario is meaningful: the grinder really does perform worse',
   table[0].name === 'Quiet' ? true : false);
ok('eight wrong papers rank below one excellent paper',
   names(table) === 'Quiet,Grinder', names(table));

head('editing a topic moves everything that carries the label');
ok('a topic name is tidied, not taken as typed', core.topicName('  Acids   and  Bases ') === 'Acids and Bases',
   '[' + core.topicName('  Acids   and  Bases ') + ']');
ok('a one-letter topic is refused', !!core.validateTopic('x').error);
ok('an over-long topic is refused', !!core.validateTopic(new Array(70).join('a')).error);
ok('a reasonable topic is accepted', core.validateTopic(' Waves ').topic === 'Waves');
var tqs = [
  { id: 1, subject: 'Physics', topic: 'Waves', kind: 'objective', active: true },
  { id: 2, subject: 'Physics', topic: 'Waves', kind: 'objective', active: false },
  { id: 3, subject: 'Physics', topic: 'Optics', kind: 'objective', active: true },
  { id: 4, subject: 'Chemistry', topic: 'Waves', kind: 'objective', active: true }
];
var tns = [{ id: 1, subject: 'Physics', topic: 'Waves', active: true }];
var inv = core.topicInventory(tqs, tns, 'Physics');
ok('the inventory is only the subject asked for', inv.length === 2, inv.length);
ok('it is in alphabetical order', inv[0].topic === 'Optics', inv[0].topic);
var wv = inv.filter(function (t) { return t.topic === 'Waves'; })[0];
ok('it counts the questions behind the label', wv.questions === 2, wv.questions);
ok('and separates the ones actually served', wv.liveQuestions === 1, wv.liveQuestions);
ok('and counts the notes too', wv.notes === 1, wv.notes);
var movedQ = core.renameTopicIn(tqs, 'Physics', 'Waves', 'Wave Motion');
ok('renaming moves every row that carried it', movedQ === 2, movedQ);
ok('and leaves the same label in another subject alone',
   tqs[3].topic === 'Waves', tqs[3].topic);
ok('a held-back question is relabelled as well as a live one', tqs[1].topic === 'Wave Motion');
ok('renaming what nothing carries moves nothing',
   core.renameTopicIn(tqs, 'Physics', 'Waves', 'Anything') === 0);
core.renameTopicIn(tqs, 'Physics', 'Wave Motion', 'Optics');
core.renameTopicIn(tns, 'Physics', 'Waves', 'Optics');
ok('renaming onto a label in use merges the two',
   core.topicInventory(tqs, tns, 'Physics').length === 1);

head('declaring a topic before anything carries it');
var decl = [];
var addOk = core.addTopicTo(decl, tqs, tns, 'Physics', ' Electrolysis ');
ok('a new label is accepted and tidied', addOk.topic === 'Electrolysis', JSON.stringify(addOk));
ok('it is held against the subject it was declared for',
   decl.length === 1 && decl[0].subject === 'Physics', JSON.stringify(decl));
var declInv = core.topicInventory(tqs, tns, 'Physics', decl);
var el = declInv.filter(function (t) { return t.topic === 'Electrolysis'; })[0];
ok('it is listed with the others', !!el);
ok('and honestly reports that nothing is behind it yet',
   el.questions === 0 && el.liveQuestions === 0 && el.notes === 0, JSON.stringify(el));
ok('declaring the same label twice is refused',
   !!core.addTopicTo(decl, tqs, tns, 'Physics', 'electrolysis').error);
ok('declaring a label a question already carries is refused too',
   !!core.addTopicTo(decl, tqs, tns, 'Physics', 'Optics').error);
ok('the same label in another subject is a different topic',
   !core.addTopicTo(decl, tqs, tns, 'Chemistry', 'Electrolysis').error);
ok('a one-letter topic is still refused', !!core.addTopicTo(decl, tqs, tns, 'Physics', 'x').error);
ok('a topic with no subject is refused', !!core.addTopicTo(decl, tqs, tns, '', 'Kinematics').error);
ok('nothing was declared by the refusals', decl.length === 2, decl.length);
ok('a declared label can be renamed like any other',
   core.renameTopicIn(decl, 'Physics', 'Electrolysis', 'Electrolytic Cells') === 1);
ok('and the rename shows in the inventory',
   core.topicInventory(tqs, tns, 'Physics', decl)
     .some(function (t) { return t.topic === 'Electrolytic Cells'; }));

head('the objective sitting — one paper for the whole combination');
ok('the UTME ceiling is 60 for English and 40 for a science',
   core.OBJECTIVE_CEILING.english === 60 && core.OBJECTIVE_CEILING.science === 40,
   JSON.stringify(core.OBJECTIVE_CEILING));
ok('a four-subject sitting tops out at 180',
   core.OBJECTIVE_CEILING.english + core.OBJECTIVE_CEILING.science * 3 === 180);
ok('English carries the English ceiling', core.objectiveCeiling('Use of English') === 60);
ok('each science carries 40', core.objectiveCeiling('Physics') === 40);
ok('with no instruction from management, a paper is served in full',
   core.objectiveCount('Physics', {}) === 40, core.objectiveCount('Physics', {}));
ok('management may serve fewer', core.objectiveCount('Physics', { Physics: 25 }) === 25);
ok('but never more than the ceiling', core.objectiveCount('Physics', { Physics: 400 }) === 40,
   core.objectiveCount('Physics', { Physics: 400 }));
ok('a nonsense count falls back to the full paper',
   core.objectiveCount('Physics', { Physics: 'soon' }) === 40);
/* Zero is a real instruction, not a mistake to be corrected: it holds a paper
   out of this sitting. The console shows it as not served, so it cannot happen
   quietly. */
ok('zero holds the paper out of the sitting', core.objectiveCount('Physics', { Physics: 0 }) === 0,
   core.objectiveCount('Physics', { Physics: 0 }));
ok('and a held-out paper contributes nothing to the sitting',
   core.objectiveTotal(core.objectiveBlueprint([], ['Physics'], { Physics: 0 }, 'weekly')) === 0);
ok('the default clock is two hours', core.OBJ_MIN_DEFAULT === 120);
ok('a clock below the floor comes back to it', core.clampObjectiveMinutes(1) === core.OBJ_MIN_FLOOR);
ok('a clock above the ceiling comes back to it', core.clampObjectiveMinutes(9999) === core.OBJ_MIN_CEIL);
ok('a missing clock is the default', core.clampObjectiveMinutes(undefined) === core.OBJ_MIN_DEFAULT);
ok('so is a cleared one', core.clampObjectiveMinutes('') === core.OBJ_MIN_DEFAULT);
ok('and so is nonsense', core.clampObjectiveMinutes('soon') === core.OBJ_MIN_DEFAULT);
/* Stepping the console down must not leap back up to two hours: zero is a value
   under the floor, not a setting that was never made. */
ok('a clock of zero is the floor, not the default',
   core.clampObjectiveMinutes(0) === core.OBJ_MIN_FLOOR, core.clampObjectiveMinutes(0));
ok('and a negative clock is the floor too',
   core.clampObjectiveMinutes(-45) === core.OBJ_MIN_FLOOR, core.clampObjectiveMinutes(-45));
ok('a real setting is honoured', core.clampObjectiveMinutes(90) === 90);
ok('theory is sat without a clock', core.durationFor('theory') === 0, core.durationFor('theory'));
ok('a duration of zero survives the lookup — it is an answer, not a gap',
   typeof core.durationFor('theory') === 'number');
ok('the objective sitting is ordered English first, then the sciences',
   core.orderedCombination(['Chemistry', 'Use of English', 'Physics']).join(',') ===
   'Use of English,Physics,Chemistry',
   core.orderedCombination(['Chemistry', 'Use of English', 'Physics']).join(','));

var oqs = [];
(function () {
  var subs = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'], n = 0, i, j;
  for (i = 0; i < subs.length; i++) {
    for (j = 0; j < 12; j++) {
      oqs.push({ id: ++n, subject: subs[i], topic: 'T' + (j % 3), kind: 'objective',
                 section: 'objective', period: 'weekly', active: true,
                 options: ['a', 'b'], answer: 0 });
    }
  }
}());
var mine = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var bp = core.objectiveBlueprint(oqs, mine, {}, 'weekly');
ok('the blueprint has one row per paper', bp.length === 4, bp.length);
ok('it is in sitting order', bp[0].subject === 'Use of English', bp[0].subject);
ok('it states what management asked for', bp[0].want === 60, bp[0].want);
ok('it states what the bank can actually serve', bp[0].available === 12, bp[0].available);
ok('and serves only what exists', bp[0].serving === 12, bp[0].serving);
ok('the total is what the student will sit', core.objectiveTotal(bp) === 48, core.objectiveTotal(bp));
var bp2 = core.objectiveBlueprint(oqs, mine, { Physics: 5 }, 'weekly');
ok('a lowered count is respected',
   bp2.filter(function (r) { return r.subject === 'Physics'; })[0].serving === 5);
ok('and it lowers the sitting', core.objectiveTotal(bp2) === 41, core.objectiveTotal(bp2));
var paper = core.objectivePaper(oqs, mine, { Physics: 5 }, 'weekly', function () { return 0.5; });
ok('the paper is as long as the blueprint promised', paper.length === 41, paper.length);
ok('it opens with Use of English', paper[0].subject === 'Use of English', paper[0].subject);
ok('each paper is served whole before the next begins', (function () {
  var seen = [], last = null, i;
  for (i = 0; i < paper.length; i++) {
    if (paper[i].subject !== last) {
      if (seen.indexOf(paper[i].subject) > -1) return false;
      seen.push(paper[i].subject); last = paper[i].subject;
    }
  }
  return seen.length === 4;
})());
ok('no question is served twice', (function () {
  var seen = {}, i;
  for (i = 0; i < paper.length; i++) {
    if (seen[paper[i].id]) return false;
    seen[paper[i].id] = 1;
  }
  return true;
})());
ok('a subject outside the combination is not in the paper',
   !paper.some(function (q) { return q.subject === 'Biology'; }));
var solo = core.objectiveBlueprint(oqs, ['Use of English', 'Physics'], {}, 'weekly');
ok('a smaller combination sits a smaller paper', solo.length === 2, solo.length);

/* ---- the CSV importer, at the level both the browser and the server use ----
   A real spreadsheet export is messier than a hand-typed file: it wraps any
   field holding a comma in quotes, doubles a quote inside one, ends lines with
   CRLF, and often opens the file with a byte-order mark. All of that must read
   the same as the tidy version, because management will export from Excel. */
head('the CSV importer reads what a spreadsheet actually writes');
var messy = '﻿subject,section,topic,text,optionA,optionB,answer\r\n'
  + 'Physics,objective,Waves,"Which is true, in a vacuum?","Light travels",'
  + '"Sound travels",A\r\n'
  + '\r\n'
  + 'Physics,objective,Waves,"He said ""stop"" firmly",Yes,No,B\r\n';
var grid = core.parseCSV(messy);
ok('the byte-order mark is not read as part of the first column',
   grid[0][0] === 'subject', JSON.stringify(grid[0][0]));
ok('a quoted comma stays inside its own field',
   grid[1][3] === 'Which is true, in a vacuum?', JSON.stringify(grid[1][3]));
ok('a doubled quote becomes one quote',
   grid[3][3] === 'He said "stop" firmly', JSON.stringify(grid[3][3]));
var rows = core.csvRows(messy);
ok('the columns are matched by name, however they are written',
   rows.header.indexOf('optiona') > -1, rows.header.join('|'));
ok('a blank line in the middle is skipped, not read as a row',
   rows.rows.length === 2, rows.rows.length);
ok('and a row remembers the line it came from, for reporting',
   rows.rows[0].line === 2 && rows.rows[1].line === 4,
   rows.rows.map(function (r) { return r.line; }).join(','));
var imp = core.importCSV('questions', messy);
ok('both rows pass the same gate a typed question passes',
   imp.records.length === 2 && imp.errors.length === 0, JSON.stringify(imp.errors));
ok('an answer given as a letter becomes the position it means',
   imp.records[0].answer === 0 && imp.records[1].answer === 1,
   imp.records.map(function (r) { return r.answer; }).join(','));
ok('and the count read is reported alongside them', imp.read === 2, imp.read);

head('an unreadable file is refused whole, and says why');
ok('an empty file names the first line as the problem',
   /first line must name the columns/.test(core.importCSV('questions', '   ').error || ''),
   core.importCSV('questions', '   ').error);
ok('a header with nothing under it is refused',
   /holds no rows/.test(core.importCSV('questions', core.CSV_QUESTION_HEADER).error || ''),
   core.importCSV('questions', core.CSV_QUESTION_HEADER).error);
ok('a missing required column is named, with the expected header',
   /missing a column: text/.test(core.importCSV('questions', 'subject\nPhysics\n').error || ''),
   core.importCSV('questions', 'subject\nPhysics\n').error);
ok('notes are held to their own columns',
   /missing a column/.test(core.importCSV('notes', 'subject,topic\nPhysics,Waves\n').error || ''),
   core.importCSV('notes', 'subject,topic\nPhysics,Waves\n').error);
var tooMany = core.CSV_QUESTION_HEADER + '\n';
for (var cr = 0; cr < core.CSV_MAX_ROWS + 1; cr++) {
  tooMany += 'Physics,objective,Waves,Question ' + cr + ',A,B,C,D,,A,,,easy,,yes\n';
}
ok('a file past the row ceiling is refused before anything is published',
   /Import at most/.test(core.importCSV('questions', tooMany).error || ''),
   core.importCSV('questions', tooMany).error);
ok('a bad row is skipped and named, while the good rows still publish',
   (function () {
     var mixed = core.importCSV('questions', core.CSV_QUESTION_HEADER + '\n'
       + 'Physics,objective,Waves,A sound question,A,B,C,D,,A,,,easy,,yes\n'
       + 'Astrology,objective,Waves,Not a subject here,A,B,C,D,,A,,,easy,,yes\n');
     return mixed.records.length === 1 && mixed.errors.length === 1 && mixed.errors[0].line === 3;
   })());
ok('both templates are files the importer itself accepts',
   core.importCSV('questions', core.csvTemplate('questions')).errors.length === 0 &&
   core.importCSV('notes', core.csvTemplate('notes')).errors.length === 0);
ok('a note body written with the two characters \\n gains real paragraphs',
   core.importCSV('notes', core.csvTemplate('notes')).records[0].body.indexOf('\n\n') > -1);

head('csvFingerprint — the "same file re-run" check import duplicate detection is built on');
ok('the same text always fingerprints the same',
   core.csvFingerprint(messy) === core.csvFingerprint(messy));
ok('different text fingerprints differently',
   core.csvFingerprint(messy) !== core.csvFingerprint(messy + '\n'));
ok('an empty file still fingerprints to something, not a crash',
   typeof core.csvFingerprint('') === 'string' && core.csvFingerprint('').length > 0);

head('the academy access code: written many ways, one code');
/* The sign-up screen promises the scholar that "capitals, spaces and dashes
   don't matter". A code handed out on a printed slip or in a WhatsApp message
   gets retyped, and a scholar who puts a space where the academy wrote a dash
   must not be turned away by a firewall that is working perfectly — so every one
   of these has to reach the same code. */
['GOC-2027', 'goc-2027', 'goc 2027', 'GOC2027', ' goc2027 ', 'goc - 2027',
 'Goc_2027', 'goc.2027', 'GOC—2027', '  G O C 2 0 2 7  '].forEach(function (typed) {
  ok(JSON.stringify(typed) + ' is the shipped code',
     core.normalizeSignupCode(typed) === core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT),
     core.normalizeSignupCode(typed));
});
ok('a different code is still a different code',
   core.normalizeSignupCode('GOC-2028') !== core.normalizeSignupCode('GOC-2027'));
ok('and a blank is nothing at all',
   core.normalizeSignupCode('   -- ') === '' && core.normalizeSignupCode(null) === '');
/* What is stored is what is compared, so the console and the sign-up form have
   to agree on the shape. validateSignupCode is the one gate both go through. */
ok('the console gets back the same form the scholar is measured against',
   core.validateSignupCode(' cohort - a1 ').code === core.normalizeSignupCode('COHORT-A1'));
ok('the length rules are applied after the separators come out',
   !!core.validateSignupCode('a-b-c').error &&
   core.validateSignupCode('a-b-c-d').code === 'ABCD',
   core.validateSignupCode('a-b-c').error);
ok('a code of nothing but separators is refused, not accepted as blank',
   !!core.validateSignupCode('----').error);
[['GOC@2027', '@'], ['GOC/2027', '/'], ['GOC+2027', '+'],
 ['<b>2027</b>', 'mark-up']].forEach(function (c) {
  ok(c[1] + ' is refused rather than quietly rewritten',
     !!core.validateSignupCode(c[0]).error, core.validateSignupCode(c[0]).code);
});
/* A phone keyboard and Word both replace a typed hyphen with a longer dash, and
   the academy will not know which one reached the scholar. */
['GOC‐2027', 'GOC‑2027', 'GOC‒2027', 'GOC–2027', 'GOC—2027',
 'GOC―2027', 'GOC−2027'].forEach(function (t) {
  ok('a U+' + t.charCodeAt(3).toString(16).toUpperCase() + ' dash reads as the shipped code',
     core.normalizeSignupCode(t) === core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT),
     core.normalizeSignupCode(t));
});
ok('the ceiling counts letters and numbers, not punctuation',
   !core.validateSignupCode('a-b-c-d-e-f-g-h-i-j-k-l').error &&
   !!core.validateSignupCode(new Array(30).join('x')).error);
/* The older form kept dashes. It is retained for one purpose only: a data.json
   seeded before this change still holds the hash of THAT form, and the cohort it
   was set up for must keep getting in. It may not admit anything new. */
ok('the older form differs only where a separator was written',
   core.legacySignupCode('goc-2027') === 'GOC-2027' &&
   core.legacySignupCode('goc 2027') === 'GOC2027' &&
   core.legacySignupCode('GOC2027') === core.normalizeSignupCode('GOC2027'));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
