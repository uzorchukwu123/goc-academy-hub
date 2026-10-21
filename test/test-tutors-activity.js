/* test-tutors-activity.js — Phase 3C slice 5, part 5: the 7-day activity chart rules and the card.
   node test/test-tutors-activity.js */
'use strict';
var path = require('path'), fs = require('fs');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
var DAY = 86400000, NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
function rows(n, subj) { var o = []; for (var i = 0; i < n; i++) o.push({ given: 1, isCorrect: true, subject: subj }); return o; }
function run(daysAgo, n, subj) { return { ts: NOW - daysAgo * DAY, subject: subj || 'Chemistry', review: rows(n, subj || 'Chemistry') }; }
var students = [
  { id: 'S1', tier: 'goc', subjects: ['Chemistry'] }, { id: 'S2', tier: 'goc', subjects: ['Chemistry', 'Physics'] },
  { id: 'S3', tier: 'open', subjects: ['Chemistry'] }, { id: 'S4', tier: 'goc', subjects: ['Physics'] },
  { id: 'S5', tier: 'goc', subjects: ['Chemistry'], active: false }
];
var runs = { S1: [run(0, 4), run(2, 3)], S2: [run(2, 5), run(8, 9), run(1, 6, 'Physics')], S3: [run(0, 7)], S4: [run(0, 2, 'Physics')], S5: [run(0, 5)] };
var att = [
  { scholarId: 'S1', subject: 'Chemistry', status: 'marked', percent: 50, submittedAt: NOW - 2 * DAY },
  { scholarId: 'S2', subject: 'Chemistry', status: 'awaiting-marking', submittedAt: NOW - 2 * DAY },
  { scholarId: 'S2', subject: 'Chemistry', status: 'draft', submittedAt: NOW - 1 * DAY },
  { scholarId: 'S3', subject: 'Chemistry', status: 'marked', percent: 90, submittedAt: NOW - 1 * DAY },
  { scholarId: 'S1', subject: 'Chemistry', status: 'marked', percent: 70, submittedAt: NOW - 12 * DAY }
];
var a = core.tutorActivity('Chemistry', students, runs, att, NOW);
console.log('\nshape');
ok('seven days, oldest first, ending today', a.days.length === 7 && a.days[6].day === '2026-10-08' && a.days[0].day === '2026-10-02', JSON.stringify(a.days.map(function (d) { return d.day; })));
console.log('\nwho counts');
ok('only GOC students taking the subject (not Open, not other subjects, not deactivated)', a.gocStudents === 2);
ok('today: S1 answered 4', a.days[6].answers === 4 && a.days[6].active === 1, JSON.stringify(a.days[6]));
ok('2 days ago: 8 answers, 2 active, 1 test (draft and awaiting-marking handled)', a.days[4].answers === 8 && a.days[4].active === 2 && a.days[4].tests === 2, JSON.stringify(a.days[4]));
ok('Physics practice never shows in Chemistry', a.days[5].answers === 0 && a.days[5].active === 0, JSON.stringify(a.days[5]));
ok('older than 7 days is left out', a.total.answers === 12 && a.total.tests === 2, JSON.stringify(a.total));
ok('Open student practice and tests never counted', a.days[5].tests === 0);
console.log('\nedges');
var e = core.tutorActivity('Chemistry', null, null, null, NOW);
ok('empty input gives seven zero days', e.days.length === 7 && e.days.every(function (d) { return !d.active && !d.answers && !d.tests; }));
ok('no name or ID in the result', !/S1|S2|scholar/i.test(JSON.stringify(a)));
var late = core.tutorActivity('Chemistry', students, { S1: [{ ts: Date.UTC(2026, 9, 7, 23, 30), review: rows(2, 'Chemistry'), subject: 'Chemistry' }] }, [], NOW);
ok('11:30pm UTC counts as the next day (Nigerian time)', late.days[6].answers === 2 && late.days[5].answers === 0);
console.log('\nwiring');
var srv = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8'), ui = fs.readFileSync(path.join(APP, 'server', 'tutor', 'tutor-app.js'), 'utf8');
ok('analytics route returns activity', /activity: core\.tutorActivity\(subject/.test(srv));
ok('dashboard draws the activity card after the snapshot', ui.indexOf('snapshotCard() +') < ui.indexOf('activityCard() +') && ui.indexOf('activityCard() +') < ui.indexOf('weakCard() + hardCard()'));
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed'); process.exit(fails ? 1 : 0);
