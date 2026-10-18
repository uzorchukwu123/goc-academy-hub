/* test-tutors-snapshot.js — Phase 3C slice 5, part 1: the pure snapshot rules for a tutor's
   dashboard (no server, no screen).   node test/test-tutors-snapshot.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
var DAY = 86400000, NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
function row(correct, subject) { return { given: 1, isCorrect: correct, subject: subject }; }
function run(daysAgo, rows, subject) { return { ts: NOW - daysAgo * DAY, subject: subject || 'Chemistry', review: rows }; }
function rows(n, right, subject) { var o = []; for (var i = 0; i < n; i++) o.push(row(i < right, subject)); return o; }

console.log('\nconstants');
ok('active window is 7 days, small samples are under 10 answers or 3 papers', core.ANALYTICS_ACTIVE_DAYS === 7 && core.ANALYTICS_MIN_ANSWERS === 10 && core.ANALYTICS_MIN_PAPERS === 3);

console.log('\nwho counts as the tutor\'s class');
var students = [
  { id: 'S1', tier: 'goc', subjects: ['Chemistry', 'Physics'] },
  { id: 'S2', tier: 'goc', subjects: ['Chemistry'] },
  { id: 'S3', tier: 'goc', subjects: ['Physics'] },
  { id: 'S4', tier: 'open', subjects: ['Chemistry'] },
  { id: 'S5', subjects: ['Chemistry'] },
  { id: 'S6', tier: 'goc', subjects: ['Chemistry'], active: false },
  { id: 'S7', tier: ' GOC ', subjects: ['Chemistry'] }
];
var snap = core.tutorSnapshot('Chemistry', students, {}, [], NOW);
ok('GOC students taking the subject are counted (spaces and case in tier tidied)', snap.gocStudents === 3, snap.gocStudents);
ok('Open students, and a student with no tier, are only a count', snap.openStudents === 2, snap.openStudents);
ok('a deactivated student is in neither count', snap.gocStudents + snap.openStudents === 5 && core.tutorSnapshot('Chemistry', [students[5]], {}, [], NOW).gocStudents === 0);
ok('a student of another subject is not counted', core.tutorSnapshot('Physics', students, {}, [], NOW).gocStudents === 2);
ok('no students at all reads as zeros, not an error', (function () { var s = core.tutorSnapshot('Chemistry', [], null, null, NOW); return s.gocStudents === 0 && s.active === 0 && s.practice.average === null && s.tests.average === null; })());
ok('a missing list is tolerated', core.tutorSnapshot('Chemistry', null, undefined, undefined, NOW).gocStudents === 0);

console.log('\nactive this week');
var runs = {
  S1: [run(2, rows(5, 4))],
  S2: [run(9, rows(5, 2))],
  S7: [run(0, rows(3, 3, 'Physics'), 'Physics')],
  S4: [run(1, rows(5, 5))],
  S3: [run(1, rows(5, 5, 'Physics'), 'Physics')]
};
snap = core.tutorSnapshot('Chemistry', students, runs, [], NOW);
ok('a practice run in the subject within 7 days makes a student active', snap.active === 1, snap.active);
ok('a run from 9 days ago does not', core.tutorSnapshot('Chemistry', students, { S2: runs.S2 }, [], NOW).active === 0);
ok('practice in a different subject does not make them active here', snap.active === 1);
ok('an Open student\'s practice never counts', snap.active === 1 && snap.practice.answers === 10, snap.practice.answers);
var att = [
  { scholarId: 'S2', subject: 'Chemistry', section: 'objective', status: 'marked', percent: 60, submittedAt: NOW - 3 * DAY },
  { scholarId: 'S7', subject: 'Chemistry', section: 'jamb', status: 'marked', percent: 80, submittedAt: NOW - 20 * DAY },
  { scholarId: 'S4', subject: 'Chemistry', section: 'jamb', status: 'marked', percent: 99, submittedAt: NOW - 1 * DAY },
  { scholarId: 'S1', subject: 'Physics', section: 'jamb', status: 'marked', percent: 10, submittedAt: NOW - 1 * DAY },
  { scholarId: 'S2', subject: 'Chemistry', section: 'theory', status: 'awaiting-marking', percent: null, submittedAt: NOW - 1 * DAY }
];
snap = core.tutorSnapshot('Chemistry', students, runs, att, NOW);
ok('a test submitted within 7 days makes a student active', snap.active === 2, snap.active);
ok('a student who both practised and sat a test is counted once', (function () {
  var s = core.tutorSnapshot('Chemistry', students, runs, [{ scholarId: 'S1', subject: 'Chemistry', status: 'marked', percent: 50, submittedAt: NOW - DAY }], NOW);
  return s.active === 1;
})());
ok('exactly 7 days ago still counts, 7 days and a second does not', (function () {
  var edge = { S1: [{ ts: NOW - 7 * DAY, subject: 'Chemistry', review: rows(1, 1) }] };
  var late = { S1: [{ ts: NOW - 7 * DAY - 1000, subject: 'Chemistry', review: rows(1, 1) }] };
  return core.tutorSnapshot('Chemistry', students, edge, [], NOW).active === 1 && core.tutorSnapshot('Chemistry', students, late, [], NOW).active === 0;
})());

console.log('\npractice average');
var p = core.tutorSnapshot('Chemistry', students, runs, [], NOW).practice;
ok('it is correct over answered, across every GOC run still held', p.answers === 10 && p.correct === 6 && p.average === 60, JSON.stringify(p));
ok('unanswered rows are not counted', (function () {
  var r = { S1: [{ ts: NOW, subject: 'Chemistry', review: [row(true), { given: null, isCorrect: false }, row(false)] }] };
  var s = core.tutorSnapshot('Chemistry', students, r, [], NOW).practice; return s.answers === 2 && s.average === 50;
})());
ok('a row with its own subject beats the run\'s', (function () {
  var r = { S1: [{ ts: NOW, subject: 'Chemistry', review: [row(true, 'Physics'), row(false)] }] };
  var s = core.tutorSnapshot('Chemistry', students, r, [], NOW).practice; return s.answers === 1 && s.average === 0;
})());
ok('a row with no subject takes its run\'s', (function () {
  var r = { S1: [{ ts: NOW, subject: 'Chemistry', review: [{ given: 2, isCorrect: true }] }] };
  return core.tutorSnapshot('Chemistry', students, r, [], NOW).practice.answers === 1;
})());
ok('under 10 answers is flagged small, 10 is not', p.small === false && core.tutorSnapshot('Chemistry', students, { S1: [run(1, rows(9, 9))] }, [], NOW).practice.small === true);
ok('no answers means no average, not 0', core.tutorSnapshot('Chemistry', students, {}, [], NOW).practice.average === null);

console.log('\ntest average');
var t = snap.tests;
ok('only marked papers of GOC students in the subject are averaged', t.papers === 2 && t.average === 70, JSON.stringify(t));
ok('theory awaiting marking is left out, never guessed', t.papers === 2);
ok('fewer than 3 papers is flagged small', t.small === true);
ok('3 papers is not small', core.tutorSnapshot('Chemistry', students, {}, [1, 2, 3].map(function (n) { return { scholarId: 'S1', subject: 'Chemistry', status: 'marked', percent: 50, submittedAt: NOW }; }), NOW).tests.small === false);
ok('a percent of 0 is a real score', core.tutorSnapshot('Chemistry', students, {}, [{ scholarId: 'S1', subject: 'Chemistry', status: 'marked', percent: 0, submittedAt: NOW }], NOW).tests.average === 0);
ok('no papers means no average, not 0', core.tutorSnapshot('Chemistry', students, {}, [], NOW).tests.average === null);

console.log('\nprivacy and safety');
var full = JSON.stringify(core.tutorSnapshot('Chemistry', students, runs, att, NOW));
ok('the result holds no student ID', !/S[1-7]"/.test(full), full);
ok('nothing passed in is changed', (function () {
  var a = JSON.stringify([students, runs, att]); core.tutorSnapshot('Chemistry', students, runs, att, NOW); return a === JSON.stringify([students, runs, att]);
})());
ok('junk rows are skipped without a crash', (function () {
  var s = core.tutorSnapshot('Chemistry', [null, 3, { id: 'S1', tier: 'goc', subjects: ['Chemistry'] }], { S1: [null, { review: null }, { ts: NOW, review: [null, 5] }] }, [null, {}], NOW);
  return s.gocStudents === 1 && s.practice.answers === 0;
})());
ok('rounded to one decimal', core.tutorSnapshot('Chemistry', students, { S1: [run(0, rows(3, 1))] }, [], NOW).practice.average === 33.3);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
