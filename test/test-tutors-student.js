/* test-tutors-student.js — Phase 3C, student detail page, slice 1: the pure rules (who a tutor may open, what the page
   holds, and the audit log's shape and one-year keep).
   node test/test-tutors-student.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var DAY = 86400000, NOW = Date.UTC(2026, 9, 9, 12, 0, 0);
function stu(o) { return Object.assign({ id: 'GOC-S-001', name: 'Gina Goc', email: 'gina@example.com', phone: '08011112222', tier: 'goc', active: true, subjects: ['Physics', 'Chemistry'] }, o || {}); }
function rev(subj, topic, n, right) { var a = []; for (var i = 0; i < n; i++) a.push({ given: 1, isCorrect: i < right, subject: subj, topic: topic }); return a; }

head('who may be opened');
ok('a GOC student who took the subject', core.tutorMayOpenStudent('Physics', stu()));
ok('even if the account has been switched off', core.tutorMayOpenStudent('Physics', stu({ active: false })));
ok('not a subject they never took', !core.tutorMayOpenStudent('Biology', stu()));
ok('not an Open student', !core.tutorMayOpenStudent('Physics', stu({ tier: 'open' })));
ok('nothing, or no id, or no subject, is never openable', !core.tutorMayOpenStudent('Physics', null) && !core.tutorMayOpenStudent('Physics', { subjects: ['Physics'], tier: 'goc' }) && !core.tutorMayOpenStudent('', stu()));
ok('a student whose subjects are not a list is not openable', !core.tutorMayOpenStudent('Physics', stu({ subjects: 'Physics' })));
ok('the detail of someone not openable is null', core.tutorStudentDetail('Biology', stu(), [], [], NOW) === null);

head('the page');
var runs = [
  { ts: NOW - 2 * DAY, subject: 'Physics', review: rev('Physics', 'Optics', 4, 1).concat(rev('Physics', 'Motion', 5, 5)).concat(rev('Physics', 'Heat', 2, 0)) },
  { ts: NOW - 9 * DAY, subject: 'Chemistry', review: rev('Chemistry', 'Acids', 10, 10) },
  { ts: NOW - 1 * DAY, subject: 'Physics', review: [{ given: null, isCorrect: false, subject: 'Physics', topic: 'Skipped' }] }
];
var attempts = [
  { scholarId: 'GOC-S-001', subject: 'Physics', status: 'marked', percent: 70, score: 14, maxScore: 20, submittedAt: NOW - 5 * DAY, section: 'objective' },
  { scholarId: 'GOC-S-001', subject: 'Physics', status: 'marked', percent: 50, score: 10, maxScore: 20, submittedAt: NOW - 3 * DAY, section: 'objective' },
  { scholarId: 'GOC-S-001', subject: 'Physics', status: 'awaiting-marking', percent: 0, score: 0, maxScore: 20, submittedAt: NOW - 4 * DAY, section: 'theory' },
  { scholarId: 'GOC-S-001', subject: 'Physics', status: 'draft', percent: 99, submittedAt: NOW },
  { scholarId: 'GOC-S-001', subject: 'Chemistry', status: 'marked', percent: 5, submittedAt: NOW },
  { scholarId: 'GOC-S-002', subject: 'Physics', status: 'marked', percent: 100, submittedAt: NOW }
];
var d = core.tutorStudentDetail('Physics', stu(), runs, attempts, NOW);
ok('name, ID and the account state', d.id === 'GOC-S-001' && d.name === 'Gina Goc' && d.active === true && d.subject === 'Physics');
ok('email and phone are NOT on the page', !/gina@|0801111/.test(JSON.stringify(d)) && d.email === undefined && d.phone === undefined);
var ct = core.tutorStudentContact('Physics', stu());
ok('they come from the contact rule, for an openable student only', ct.email === 'gina@example.com' && ct.phone === '08011112222' && ct.id === 'GOC-S-001' && core.tutorStudentContact('Biology', stu()) === null && core.tutorStudentContact('Physics', stu({ tier: 'open' })) === null && core.tutorStudentContact('Physics', stu({ active: false })) !== null);
ok('test scores: two marked papers, average 60, last score 50', d.tests.papers === 2 && d.tests.average === 60 && d.tests.lastScore === 50, JSON.stringify(d.tests));
ok('a paper awaiting marking and a draft are not scored', d.tests.papers === 2);
ok('practice: 11 answers, 6 right, 54.5%', d.practice.answers === 11 && d.practice.correct === 6 && d.practice.percent === 54.5, JSON.stringify(d.practice));
ok('nothing from another subject (the Chemistry run and paper are left out)', JSON.stringify(d).indexOf('Acids') < 0 && d.practice.answers === 11 && d.tests.papers === 2);
ok('last active is the newest real work (a skipped-only run does not count)', d.lastActiveAt === NOW - 2 * DAY && d.daysInactive === 2, d.lastActiveAt + ' ' + d.daysInactive);
ok('recent attempts: newest first, a draft and a skipped run left out', d.recent.length === 4 && d.recent[0].kind === 'practice' && d.recent[1].kind === 'test' && d.recent[1].percent === 50 && d.recent[2].status === 'awaiting-marking' && d.recent[2].percent === null, JSON.stringify(d.recent));
ok('a test row carries section, score and maximum', d.recent[1].section === 'objective' && d.recent[1].score === 10 && d.recent[1].maxScore === 20);
ok('weak topics need 3+ answers, weakest first: Optics (25%) then Motion (100%)', d.weakTopics.items.length === 2 && d.weakTopics.items[0].topic === 'Optics' && d.weakTopics.items[0].percent === 25 && d.weakTopics.items[1].topic === 'Motion', JSON.stringify(d.weakTopics));
ok('a thin topic (Heat, 2 answers) is counted, never ranked', d.weakTopics.hidden === 1 && !d.weakTopics.items.some(function (x) { return x.topic === 'Heat'; }) && d.weakTopics.minAnswers === 3);
ok('no password hash or tier field leaves the rule', !/hash|salt|password|tier/i.test(JSON.stringify(d)));

head('a new student, and a long history');
var empty = core.tutorStudentDetail('Physics', stu({ active: false }), [], [], NOW);
ok('no work yet: nulls, not zeros pretending to be scores', empty.tests.average === null && empty.practice.percent === null && empty.lastActiveAt === null && empty.daysInactive === null && empty.recent.length === 0 && empty.active === false);
var many = []; for (var i = 0; i < 15; i++) many.push({ scholarId: 'GOC-S-001', subject: 'Physics', status: 'marked', percent: 50, submittedAt: NOW - i * DAY });
var m = core.tutorStudentDetail('Physics', stu(), [], many, NOW);
ok('only the last ten attempts are returned, newest first', m.recent.length === 10 && m.recent[0].at === NOW && m.recent[9].at === NOW - 9 * DAY && m.tests.papers === 15);
var tops = []; ['A', 'B', 'C', 'D', 'E', 'F', 'G'].forEach(function (t, k) { tops.push({ ts: NOW, subject: 'Physics', review: rev('Physics', t, 4, k % 4) }); });
ok('at most five weak topics are shown', core.tutorStudentDetail('Physics', stu(), tops, [], NOW).weakTopics.items.length === 5);
var input = JSON.stringify([runs, attempts]); core.tutorStudentDetail('Physics', stu(), runs, attempts, NOW);
ok('the inputs are never changed', JSON.stringify([runs, attempts]) === input);

head('the audit log');
var tutor = { id: 'GOC-T-001', name: 'Mrs Ada Obi', subjects: ['Physics'], pwHash: 'x' };
var e = core.makeTutorViewEntry(tutor, stu(), 'Physics', NOW);
ok('an entry says who, which student, which subject and when', e.tutorId === 'GOC-T-001' && e.tutorName === 'Mrs Ada Obi' && e.studentId === 'GOC-S-001' && e.studentName === 'Gina Goc' && e.subject === 'Physics' && e.at === NOW && e.kind === 'tutor-view');
ok('it holds no password hash, email or phone', !/pwHash|hash|email|phone|gina@/i.test(JSON.stringify(e)));
var ce = core.makeTutorViewEntry(tutor, stu(), 'Physics', NOW, 'contact-view');
ok('a contact entry is its own kind; any other kind reads as an ordinary view', ce.kind === 'contact-view' && core.makeTutorViewEntry(tutor, stu(), 'Physics', NOW, 'x').kind === 'tutor-view' && e.kind === 'tutor-view');
ok('no tutor, student or subject means no entry', core.makeTutorViewEntry(null, stu(), 'Physics', NOW) === null && core.makeTutorViewEntry(tutor, null, 'Physics', NOW) === null && core.makeTutorViewEntry(tutor, stu(), '', NOW) === null);
var list = [{ id: 'AU-1', tutorId: 'GOC-T-001', studentId: 'GOC-S-001', at: NOW - 400 * DAY }, { id: 'AU-2', tutorId: 'GOC-T-001', studentId: 'GOC-S-001', at: NOW - 364 * DAY }, { id: 'AU-3', tutorId: 'GOC-T-002', studentId: 'GOC-S-002', at: NOW - 10 * DAY }];
var before = JSON.stringify(list);
var added = core.addTutorView(list, Object.assign({ id: 'AU-4' }, e), NOW);
ok('an entry older than a year is dropped when a new one is added', added.length === 3 && !added.some(function (x) { return x.id === 'AU-1'; }) && added.some(function (x) { return x.id === 'AU-2'; }) && added.some(function (x) { return x.id === 'AU-4'; }));
ok('the old list is not changed', JSON.stringify(list) === before);
ok('a missing list starts a new one', core.addTutorView(undefined, { id: 'AU-9', at: NOW }, NOW).length === 1);
ok('a tutor reads only their own entries, newest first', JSON.stringify(core.tutorOwnViews(added, 'GOC-T-001').map(function (x) { return x.id; })) === JSON.stringify(['AU-4', 'AU-2']));
ok('another tutor\'s entries never come back', !core.tutorOwnViews(added, 'GOC-T-001').some(function (x) { return x.tutorId !== 'GOC-T-001'; }) && core.tutorOwnViews(added, 'GOC-T-099').length === 0);
ok('management sees everyone, newest first', core.auditViews(added).length === 3 && core.auditViews(added)[0].id === 'AU-4');
ok('management can narrow by tutor, by student, or both', core.auditViews(added, { tutorId: 'GOC-T-002' }).length === 1 && core.auditViews(added, { studentId: 'GOC-S-001' }).length === 2 && core.auditViews(added, { tutorId: 'GOC-T-001', studentId: 'GOC-S-002' }).length === 0);
ok('the keep is one year', core.AUDIT_KEEP_DAYS === 365);
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
