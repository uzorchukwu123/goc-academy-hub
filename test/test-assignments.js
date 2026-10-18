/* test-assignments.js — Phase A slice 1: pure assignment rules in js/goc-core.js.
   No server, no storage.  Run:  node test/test-assignments.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ---- helpers ---- */
var FUTURE_DATE = '2099-12-31';   /* always in the future relative to now */
var PAST_DATE   = '2000-01-01';   /* always in the past                   */
var SUBJECT     = core.ALL_SUBJECTS[0];   /* first valid subject             */

/* A minimal valid assignment form object. */
function good(overrides) {
  return Object.assign({
    subject:  SUBJECT,
    title:    'Test Assignment 1',
    deadline: FUTURE_DATE,
    tutorId:  'GOC-T-001'
  }, overrides || {});
}

/* ---- constants ---- */
head('Constants are published correctly');
ok('ASSIGNMENT_SECTION is "assignment"', core.ASSIGNMENT_SECTION === 'assignment');
ok('ASSIGNMENT_XP_WEIGHT is 30',         core.ASSIGNMENT_XP_WEIGHT === 30);
ok('ASSIGNMENT_LATE_WINDOW is 3',        core.ASSIGNMENT_LATE_WINDOW === 3);
ok('ASSIGNMENT_LATE_DEDUCT is 0.20',     core.ASSIGNMENT_LATE_DEDUCT === 0.20);
ok('ASSIGNMENT_LEADERBOARD_N is 10',     core.ASSIGNMENT_LEADERBOARD_N === 10);
ok('ASSIGNMENT_FILE_LIMIT is 3',         core.ASSIGNMENT_FILE_LIMIT === 3);
ok('ASSIGNMENT_FILE_MAX_BYTES is 5 MB',  core.ASSIGNMENT_FILE_MAX_BYTES === 5 * 1024 * 1024);
ok('allowed mime list is an array',      Array.isArray(core.ASSIGNMENT_ALLOWED_MIME));
ok('pdf is in allowed mime list',        core.ASSIGNMENT_ALLOWED_MIME.indexOf('application/pdf') !== -1);

/* ---- assignmentDeadlineMs ---- */
head('assignmentDeadlineMs');
ok('valid date returns a number',    typeof core.assignmentDeadlineMs('2030-06-15') === 'number');
ok('null returns null',              core.assignmentDeadlineMs(null) === null);
ok('empty string returns null',      core.assignmentDeadlineMs('') === null);
ok('bad string returns null',        core.assignmentDeadlineMs('15-06-2030') === null);
ok('result is end of Lagos day',     (function () {
  /* 2030-06-15 end-of-day Lagos = 23:00 UTC (UTC+1) */
  var ms = core.assignmentDeadlineMs('2030-06-15');
  var d = new Date(ms);
  return d.getUTCHours() === 23 && d.getUTCMinutes() === 0;
})());

/* ---- assignmentDaysLate ---- */
head('assignmentDaysLate');
(function () {
  var dl = core.assignmentDeadlineMs('2030-01-01');  /* end of 2030-01-01 Lagos */
  var onTime   = dl - 1000;                          /* 1 s before deadline      */
  var justOver = dl + 1000;                          /* 1 s after                */
  var day1     = dl + 86400000;                      /* +1 full day              */
  var day3     = dl + 3 * 86400000;
  var day4     = dl + 4 * 86400000;
  ok('on time → 0',    core.assignmentDaysLate(dl, onTime) === 0);
  ok('1 s late → 1',   core.assignmentDaysLate(dl, justOver) === 1);
  ok('1 day late → 1', core.assignmentDaysLate(dl, day1) === 1);
  ok('3 days late → 3',core.assignmentDaysLate(dl, day3) === 3);
  ok('4 days late → 4',core.assignmentDaysLate(dl, day4) === 4);
})();

/* ---- validateAssignment ---- */
head('validateAssignment — happy path');
(function () {
  var r = core.validateAssignment(good());
  ok('rec returned',          !!r.rec);
  ok('no error on good input', !r.error);
  ok('subject kept',           r.rec.subject === SUBJECT);
  ok('title kept',             r.rec.title === 'Test Assignment 1');
  ok('deadline kept',          r.rec.deadline === FUTURE_DATE);
  ok('tutorId kept',           r.rec.tutorId === 'GOC-T-001');
  ok('questions defaults []',  Array.isArray(r.rec.questions) && r.rec.questions.length === 0);
  ok('description defaults ""',r.rec.description === '');
})();

head('validateAssignment — questions and description');
(function () {
  var r = core.validateAssignment(good({ questions: [1, 2, 3], description: 'Some instructions.' }));
  ok('questions stored',     r.rec.questions.join(',') === '1,2,3');
  ok('description stored',   r.rec.description === 'Some instructions.');
})();

head('validateAssignment — bad subject');
(function () {
  var r = core.validateAssignment(good({ subject: 'Yoruba' }));
  ok('error returned',  !!r.error);
  ok('no rec',          !r.rec);
})();

head('validateAssignment — missing title');
ok('blank title refused',   !!core.validateAssignment(good({ title: '' })).error);
ok('whitespace title refused', !!core.validateAssignment(good({ title: '   ' })).error);
ok('200-char title accepted', (function () {
  return !!core.validateAssignment(good({ title: 'x'.repeat(200) })).rec;
})());
ok('201-char title refused', !!core.validateAssignment(good({ title: 'x'.repeat(201) })).error);

head('validateAssignment — deadline');
ok('past deadline refused',    !!core.validateAssignment(good({ deadline: PAST_DATE })).error);
ok('malformed date refused',   !!core.validateAssignment(good({ deadline: '31-12-2099' })).error);
ok('missing deadline refused', !!core.validateAssignment(good({ deadline: '' })).error);

head('validateAssignment — description length');
ok('1000-char description accepted', (function () {
  return !!core.validateAssignment(good({ description: 'a'.repeat(1000) })).rec;
})());
ok('1001-char description refused',  !!core.validateAssignment(good({ description: 'a'.repeat(1001) })).error);

/* ---- assignmentCanSubmit ---- */
head('assignmentCanSubmit — on time');
(function () {
  var dlMs = core.assignmentDeadlineMs(FUTURE_DATE);
  var r = core.assignmentCanSubmit({ deadline: FUTURE_DATE }, dlMs - 60000);
  ok('allowed',       r.allowed === true);
  ok('daysLate is 0', r.daysLate === 0);
})();

head('assignmentCanSubmit — late but inside window');
(function () {
  var dl = core.assignmentDeadlineMs('2030-03-01');
  var twoLate = dl + 2 * 86400000;
  var r = core.assignmentCanSubmit({ deadline: '2030-03-01' }, twoLate);
  ok('allowed',          r.allowed === true);
  ok('daysLate is 2',    r.daysLate === 2);
})();

head('assignmentCanSubmit — past late window');
(function () {
  var dl = core.assignmentDeadlineMs('2030-03-01');
  var fourLate = dl + 4 * 86400000;
  var r = core.assignmentCanSubmit({ deadline: '2030-03-01' }, fourLate);
  ok('not allowed',      r.allowed === false);
  ok('reason is overdue',r.reason === 'overdue');
  ok('message present',  typeof r.message === 'string' && r.message.length > 0);
})();

head('assignmentCanSubmit — closed assignment');
(function () {
  var r = core.assignmentCanSubmit({ deadline: FUTURE_DATE, status: 'closed' });
  ok('not allowed',       r.allowed === false);
  ok('reason is closed',  r.reason === 'closed');
})();

/* ---- assignmentApplyLate ---- */
head('assignmentApplyLate');
ok('0 days late → no change',  core.assignmentApplyLate(80, 0) === 80);
ok('1 day late → −20 %',       core.assignmentApplyLate(100, 1) === 80);
ok('3 days late → −20 %',      core.assignmentApplyLate(100, 3) === 80);
ok('clamped at 0 (not negative)', core.assignmentApplyLate(10, 1) >= 0);
ok('100 % on time stays 100',  core.assignmentApplyLate(100, 0) === 100);
ok('0 % stays 0',              core.assignmentApplyLate(0, 1) === 0);

/* ---- assignmentXp ---- */
head('assignmentXp');
ok('100 % → 30 XP',  core.assignmentXp(100) === 30);
ok('0 % → 0 XP',     core.assignmentXp(0) === 0);
ok('50 % → 15 XP',   core.assignmentXp(50) === 15);
ok('33 % → round(30×0.33) = 10', core.assignmentXp(33) === 10);
ok('late 80 % → 24 XP', core.assignmentXp(core.assignmentApplyLate(100, 1)) === 24);

/* ---- assignmentScore ---- */
head('assignmentScore');
(function () {
  var s = core.assignmentScore([{ mark: 8, maxMark: 10 }, { mark: 1, maxMark: 1 }]);
  ok('earned correct',  s.earned === 9);
  ok('total correct',   s.total === 11);
  ok('percent correct', s.percent === Math.round(9/11*100));
})();
ok('empty answers → 0 percent',
   core.assignmentScore([]).percent === 0);
ok('all correct → 100 %',
   core.assignmentScore([{ mark: 10, maxMark: 10 }]).percent === 100);
ok('all wrong → 0 %',
   core.assignmentScore([{ mark: 0, maxMark: 10 }]).percent === 0);

/* ---- assignmentLeaderboard ---- */
head('assignmentLeaderboard — basic ranking');
(function () {
  var subs = [
    { studentId: 'S1', finalPercent: 90, submittedAt: 1000, status: 'marked' },
    { studentId: 'S2', finalPercent: 80, submittedAt: 2000, status: 'marked' },
    { studentId: 'S3', finalPercent: 95, submittedAt: 3000, status: 'marked' }
  ];
  var lb = core.assignmentLeaderboard(subs, null);
  ok('top has 3 entries',       lb.top.length === 3);
  ok('rank 1 is S3 (95 %)',     lb.top[0].studentId === 'S3' && lb.top[0].rank === 1);
  ok('rank 2 is S1 (90 %)',     lb.top[1].studentId === 'S1');
  ok('rank 3 is S2 (80 %)',     lb.top[2].studentId === 'S2');
  ok('self is null when no id', lb.self === null);
})();

head('assignmentLeaderboard — tie-breaking by submittedAt');
(function () {
  var subs = [
    { studentId: 'A', finalPercent: 70, submittedAt: 2000, status: 'marked' },
    { studentId: 'B', finalPercent: 70, submittedAt: 1000, status: 'marked' }
  ];
  var lb = core.assignmentLeaderboard(subs, null);
  ok('earlier submission wins tie', lb.top[0].studentId === 'B');
})();

head('assignmentLeaderboard — only marked submissions appear');
(function () {
  var subs = [
    { studentId: 'M', finalPercent: 90, submittedAt: 1000, status: 'marked' },
    { studentId: 'U', finalPercent: 99, submittedAt: 500,  status: 'submitted' }
  ];
  var lb = core.assignmentLeaderboard(subs, null);
  ok('unmarked not in leaderboard', lb.top.length === 1 && lb.top[0].studentId === 'M');
})();

head('assignmentLeaderboard — self rank');
(function () {
  var subs = Array.from({ length: 12 }, function (_, i) {
    return { studentId: 'S' + i, finalPercent: 100 - i, submittedAt: i, status: 'marked' };
  });
  var lb = core.assignmentLeaderboard(subs, 'S11');  /* rank 12, outside top 10 */
  ok('top has 10 entries',         lb.top.length === 10);
  ok('self rank is 12',            lb.self && lb.self.rank === 12);
})();

/* ---- validateAssignmentFile ---- */
head('validateAssignmentFile');
ok('jpeg ok',     !!core.validateAssignmentFile({ size: 1024,           type: 'image/jpeg' }).ok);
ok('pdf ok',      !!core.validateAssignmentFile({ size: 1024,           type: 'application/pdf' }).ok);
ok('too large',   !!core.validateAssignmentFile({ size: 6*1024*1024,    type: 'image/jpeg' }).error);
ok('zero size',   !!core.validateAssignmentFile({ size: 0,              type: 'image/jpeg' }).error);
ok('bad mime',    !!core.validateAssignmentFile({ size: 1024,           type: 'text/plain' }).error);
ok('zip refused', !!core.validateAssignmentFile({ size: 1024,           type: 'application/zip' }).error);

/* ---- validateAssignmentFiles ---- */
head('validateAssignmentFiles');
var goodFile = { size: 1024, type: 'image/jpeg' };
ok('empty list ok',   !!core.validateAssignmentFiles([]).ok);
ok('3 files ok',      !!core.validateAssignmentFiles([goodFile, goodFile, goodFile]).ok);
ok('4 files refused', !!core.validateAssignmentFiles([goodFile, goodFile, goodFile, goodFile]).error);
ok('one bad propagates', !!core.validateAssignmentFiles([goodFile, { size: 0, type: 'image/jpeg' }]).error);

/* ---- assignmentReuseWarnings ---- */
head('assignmentReuseWarnings');
(function () {
  var existing = [
    { subject: SUBJECT,                title: 'Old A', questions: [1, 2, 3] },
    { subject: core.ALL_SUBJECTS[1],   title: 'Old B', questions: [4, 5] }
  ];
  ok('shared question flagged',
     core.assignmentReuseWarnings([1, 10], existing, SUBJECT).indexOf(1) !== -1);
  ok('new question not flagged',
     core.assignmentReuseWarnings([10], existing, SUBJECT).length === 0);
  ok('different subject not flagged',
     core.assignmentReuseWarnings([4], existing, SUBJECT).length === 0);
  ok('no duplicates in result', (function () {
    var w = core.assignmentReuseWarnings([1], [existing[0], existing[0]], SUBJECT);
    return w.length === 1;
  })());
})();

/* ---- summary ---- */
console.log('\n' + passes + ' passed, ' + fails + ' failed');
if (fails) process.exit(1);
