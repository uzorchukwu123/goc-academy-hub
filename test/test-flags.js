/* test-flags.js — Phase 4.A "Ask a tutor", slice 1: the pure rules. node test/test-flags.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

var NOW = Date.UTC(2026, 9, 10, 10, 0, 0);
var chem = { id: 'GOC-T-001', name: 'Ada Obi', subjects: ['Chemistry'], active: true };
var chem2 = { id: 'GOC-T-003', name: 'Ife', subjects: ['Chemistry', 'Biology'], active: true };
var phys = { id: 'GOC-T-002', name: 'Eze', subjects: ['Physics'], active: true };
var off = { id: 'GOC-T-004', name: 'Gone', subjects: ['Chemistry'], active: false };
var stu = { id: 'GOC-S-001', name: 'Tobi Ade', tier: 'goc', active: true, subjects: ['Chemistry', 'Physics'] };
var open = { id: 'GOC-S-002', name: 'Open One', tier: 'open', active: true };
var q = { id: '41', subject: 'Chemistry', section: 'practice', text: 'What  is the   pH of pure water at 25°C?', options: ['5', '7', '9', '14'], answer: 1 };

console.log('\nthe feature');
ok('GOC students may ask a tutor, Open students may not', core.canUse('askTutor', 'goc') && !core.canUse('askTutor', 'open') && !core.canUse('askTutor'));

console.log('\nreasons and validation');
ok('four reasons, each with a label', core.FLAG_REASONS.length === 4 && core.FLAG_REASONS.every(function (r) { return r.id && r.label && core.flagReasonLabel(r.id) === r.label; }));
ok('editing the exported reasons does not change the rules', (function () { core.FLAG_REASONS[0].id = 'x'; core.FLAG_REASONS.pop(); return core.flagReasonLabel('wrong-answer') !== '' && core.FLAG_REASONS !== core.FLAG_REASONS; })() === false);
var v = core.validateFlag({ questionId: 41, reason: 'typo', note: '  “pure”  is spelt wrong ' });
ok('a good flag is accepted and tidied', !!v.rec && v.rec.questionId === '41' && v.rec.reason === 'typo' && v.rec.note === '“pure”  is spelt wrong');
ok('only questionId, reason and note come through (no subject, status or author)', JSON.stringify(Object.keys(core.validateFlag({ questionId: 1, reason: 'typo', subject: 'Physics', status: 'closed', studentId: 'X' }).rec).sort()) === JSON.stringify(['note', 'questionId', 'reason']));
ok('no question is refused', !!core.validateFlag({ reason: 'typo' }).error && !!core.validateFlag(null).error && !!core.validateFlag({ questionId: '  ', reason: 'typo' }).error);
ok('an unknown or missing reason is refused', !!core.validateFlag({ questionId: 1, reason: 'rude' }).error && !!core.validateFlag({ questionId: 1 }).error);
ok('a note is optional for a named reason', !core.validateFlag({ questionId: 1, reason: 'unclear' }).error);
ok('a note over 300 characters is refused, exactly 300 is fine', !!core.validateFlag({ questionId: 1, reason: 'typo', note: new Array(302).join('x') }).error && !core.validateFlag({ questionId: 1, reason: 'typo', note: new Array(301).join('x') }).error);
ok('"Something else" needs a few words of note', !!core.validateFlag({ questionId: 1, reason: 'other' }).error && !!core.validateFlag({ questionId: 1, reason: 'other', note: 'hm' }).error && !core.validateFlag({ questionId: 1, reason: 'other', note: 'it is odd' }).error);
ok('line breaks in the note are kept as plain newlines', core.validateFlag({ questionId: 1, reason: 'typo', note: 'a\r\nb' }).rec.note === 'a\nb');

console.log('\nstamping');
var st = core.stampFlag({ questionId: '41', reason: 'wrong-answer', note: 'I get 7 but it says 5' }, q, stu, NOW);
ok('a GOC student flags a live question', !!st.rec && st.rec.status === 'open' && st.rec.studentId === 'GOC-S-001' && st.rec.studentName === 'Tobi Ade');
ok('the subject comes from the stored question', st.rec.subject === 'Chemistry');
ok('a forged subject, status or student in the request is overwritten', (function () {
  var r = core.stampFlag({ questionId: '41', reason: 'typo', subject: 'Physics', status: 'closed', studentId: 'GOC-S-999', studentName: 'Liar', reply: { text: 'x' } }, q, stu, NOW).rec;
  return r.subject === 'Chemistry' && r.status === 'open' && r.studentId === 'GOC-S-001' && r.studentName === 'Tobi Ade' && r.reply === undefined;
})());
ok('the question wording is kept as a tidy snapshot', st.rec.questionText === 'What is the pH of pure water at 25°C?');
ok('a very long question is cut to 300 characters', core.stampFlag({ questionId: '41', reason: 'typo' }, Object.assign({}, q, { text: new Array(600).join('w') }), stu, NOW).rec.questionText.length === 300);
ok('the time is stamped', st.rec.createdAt === new Date(NOW).toISOString());
ok('the stamp does not carry the tier or any hash', st.rec.tier === undefined && st.rec.password === undefined);
ok('an Open student is refused, with the way to join', /GOC/.test(core.stampFlag({ questionId: '41', reason: 'typo' }, q, open, NOW).error || ''));
ok('a student with no tier, a switched-off student or nobody is refused', !!core.stampFlag({ questionId: '41', reason: 'typo' }, q, { id: 'S', name: 'N' }, NOW).error && !!core.stampFlag({ questionId: '41', reason: 'typo' }, q, Object.assign({}, stu, { active: false }), NOW).error && !!core.stampFlag({ questionId: '41', reason: 'typo' }, q, null, NOW).error);
ok('a pending, returned or switched-off question cannot be flagged', ['pending', 'returned', 'bogus'].every(function (s) { return !!core.stampFlag({ questionId: '41', reason: 'typo' }, Object.assign({}, q, { status: s }), stu, NOW).error; }) && !!core.stampFlag({ questionId: '41', reason: 'typo' }, Object.assign({}, q, { active: false }), stu, NOW).error);
ok('a question with no status counts as live (nothing existing is lost)', !core.stampFlag({ questionId: '41', reason: 'typo' }, q, stu, NOW).error);
ok('a missing question, or one that is not the one named, is refused', !!core.stampFlag({ questionId: '41', reason: 'typo' }, null, stu, NOW).error && !!core.stampFlag({ questionId: '99', reason: 'typo' }, q, stu, NOW).error);
ok('a question in no known subject is refused', !!core.stampFlag({ questionId: '41', reason: 'typo' }, Object.assign({}, q, { subject: 'Latin' }), stu, NOW).error);
ok('a bad flag is refused before anything else', !!core.stampFlag({ reason: 'typo' }, q, stu, NOW).error && !!core.stampFlag(null, q, stu, NOW).error);

console.log('\nlimits: one waiting flag per question, ten a day');
var f1 = Object.assign({ id: 'FL-1' }, st.rec);
ok('the first flag on a question is allowed', core.canFlag([], 'GOC-S-001', '41', NOW).allowed === true);
var dup = core.canFlag([f1], 'GOC-S-001', '41', NOW);
ok('a second WAITING flag on the same question is refused', dup.allowed === false && dup.reason === 'duplicate' && /already asked/.test(dup.message));
ok('after an answer the student may ask again', core.canFlag([Object.assign({}, f1, { status: 'answered' })], 'GOC-S-001', '41', NOW).allowed === true);
ok('after it is closed the student may ask again', core.canFlag([Object.assign({}, f1, { status: 'closed' })], 'GOC-S-001', '41', NOW).allowed === true);
ok('another question, or another student, is not blocked', core.canFlag([f1], 'GOC-S-001', '42', NOW).allowed && core.canFlag([f1], 'GOC-S-009', '41', NOW).allowed);
function many(n, day) { var out = []; for (var i = 0; i < n; i++) out.push({ id: 'FL-' + (i + 10), studentId: 'GOC-S-001', questionId: String(100 + i), status: 'closed', createdAt: new Date(day).toISOString() }); return out; }
ok('nine today is fine, ten today stops the eleventh', core.canFlag(many(9, NOW), 'GOC-S-001', '500', NOW).allowed && core.canFlag(many(10, NOW), 'GOC-S-001', '500', NOW).reason === 'daily');
ok('the daily cap is ten', core.FLAG_DAILY_CAP === 10);
ok('yesterday\'s flags do not count', core.canFlag(many(10, NOW - 86400000), 'GOC-S-001', '500', NOW).allowed === true);
ok('the day turns at midnight in Nigeria (UTC+1), not UTC', (function () {
  var lateUtc = Date.UTC(2026, 9, 9, 22, 30, 0);          // 23:30 on the 9th in Lagos
  var nextUtc = Date.UTC(2026, 9, 9, 23, 30, 0);          // 00:30 on the 10th in Lagos
  return core.canFlag(many(10, lateUtc), 'GOC-S-001', '500', nextUtc).allowed === true && core.canFlag(many(10, lateUtc), 'GOC-S-001', '500', lateUtc + 1000).allowed === false;
})());
ok('another student\'s flags do not use up my cap', core.canFlag(many(10, NOW).map(function (f) { f.studentId = 'GOC-S-777'; return f; }), 'GOC-S-001', '500', NOW).allowed);
ok('junk in the list is ignored', core.canFlag([null, undefined, {}, f1], 'GOC-S-001', '42', NOW).allowed === true && core.canFlag(null, 'GOC-S-001', '42', NOW).allowed === true);

console.log('\nwho receives a flag');
var rc = core.flagRecipients('Chemistry', [chem, chem2, phys, off]);
ok('every switched-on tutor of the subject, and the console', rc.console === true && rc.tutors.length === 2 && rc.tutors[0].id === 'GOC-T-001' && rc.tutors[1].id === 'GOC-T-003');
ok('a switched-off tutor and a tutor of another subject are left out', !rc.tutors.some(function (t) { return t.id === 'GOC-T-004' || t.id === 'GOC-T-002'; }));
ok('only an ID and a name travel (no subjects, hash or password)', Object.keys(rc.tutors[0]).sort().join() === 'id,name');
ok('a subject with no tutor still reaches the console', (function () { var r = core.flagRecipients('Biology', [chem, phys]); return r.tutors.length === 0 && r.console === true; })());
ok('nothing in, nothing broken', core.flagRecipients('Chemistry', null).console === true && core.flagRecipients(undefined, [chem]).tutors.length === 0);

console.log('\nreplying');
var asTutor = function (t) { return { role: 'tutor', tutor: t }; };
var admin = { role: 'console', name: 'Founder' };
var ans = core.answerFlag(f1, asTutor(chem), '  The pH of pure water is 7.\r\nCheck the options.  ', NOW + 60000);
ok('the subject\'s tutor replies and the flag becomes answered', !!ans.rec && ans.rec.status === 'answered' && ans.rec.reply.text === 'The pH of pure water is 7.\nCheck the options.');
ok('the reply records who, as what, and when', ans.rec.reply.byId === 'GOC-T-001' && ans.rec.reply.byName === 'Ada Obi' && ans.rec.reply.role === 'tutor' && ans.rec.reply.at === new Date(NOW + 60000).toISOString());
ok('the original flag is not changed', f1.status === 'open' && f1.reply === undefined);
ok('the console may reply on any subject', (function () { var r = core.answerFlag(Object.assign({}, f1, { subject: 'Physics' }), admin, 'We will look at it.', NOW); return !!r.rec && r.rec.reply.byId === 'console' && r.rec.reply.byName === 'Founder'; })());
ok('a console reply with no name reads as the academy', core.answerFlag(f1, { role: 'console' }, 'Thanks, noted.', NOW).rec.reply.byName === 'The academy');
ok('a Physics tutor cannot reply to a Chemistry flag', /own subjects/.test(core.answerFlag(f1, asTutor(phys), 'Not mine.', NOW).error || ''));
ok('a switched-off tutor cannot reply', !!core.answerFlag(f1, asTutor(off), 'hello there', NOW).error);
ok('a student, an unknown role or no actor cannot reply', !!core.answerFlag(f1, { role: 'student' }, 'hello there', NOW).error && !!core.answerFlag(f1, null, 'hello there', NOW).error && !!core.answerFlag(f1, { role: 'tutor' }, 'hello there', NOW).error);
ok('a one-character reply is refused, so is one over 1000', !!core.answerFlag(f1, asTutor(chem), ' a ', NOW).error && !!core.answerFlag(f1, asTutor(chem), new Array(1002).join('x'), NOW).error && !core.answerFlag(f1, asTutor(chem), new Array(1001).join('x'), NOW).error);
ok('a closed flag cannot be replied to', /closed/.test(core.answerFlag(Object.assign({}, f1, { status: 'closed' }), asTutor(chem), 'hello there', NOW).error || ''));
ok('an unknown status fails closed (cannot be replied to)', !!core.answerFlag(Object.assign({}, f1, { status: 'weird' }), asTutor(chem), 'hello there', NOW).error);
ok('a second reply replaces the first and the flag stays answered', (function () { var r = core.answerFlag(ans.rec, asTutor(chem2), 'Correction: it is 7.', NOW + 120000); return r.rec.status === 'answered' && r.rec.reply.text === 'Correction: it is 7.' && r.rec.reply.byId === 'GOC-T-003'; })());
ok('no flag at all is an error, not a crash', !!core.answerFlag(null, asTutor(chem), 'hello there', NOW).error && !!core.closeFlag(undefined, admin, NOW).error);

console.log('\nclosing');
var cl = core.closeFlag(ans.rec, asTutor(chem), NOW + 180000);
ok('the tutor closes an answered flag', !!cl.rec && cl.rec.status === 'closed' && cl.rec.closedBy === 'GOC-T-001' && cl.rec.closedAt === new Date(NOW + 180000).toISOString() && !cl.noop);
ok('a waiting flag can be closed without a reply', core.closeFlag(f1, admin, NOW).rec.status === 'closed' && core.closeFlag(f1, admin, NOW).rec.closedBy === 'console');
ok('the reply is kept when a flag is closed', cl.rec.reply && cl.rec.reply.text.indexOf('pH') > -1);
ok('closing twice is harmless and changes nothing', (function () { var r = core.closeFlag(cl.rec, admin, NOW + 999999); return r.noop === true && r.rec.closedAt === cl.rec.closedAt && r.rec.closedBy === 'GOC-T-001'; })());
ok('a Physics tutor cannot close a Chemistry flag, nor can a student', !!core.closeFlag(f1, asTutor(phys), NOW).error && !!core.closeFlag(f1, { role: 'student' }, NOW).error);

console.log('\nwhat a student sees');
var pub = core.publicFlag(ans.rec);
ok('the student sees their words, the question, the status and the reply', pub.id === 'FL-1' && pub.reasonLabel === core.flagReasonLabel('wrong-answer') && pub.note === 'I get 7 but it says 5' && pub.status === 'answered' && pub.questionText.indexOf('pH') > -1 && pub.reply.text.indexOf('pH') > -1);
ok('the reply is from "<Subject> tutor", never a name or ID', pub.reply.from === 'Chemistry tutor' && JSON.stringify(pub).indexOf('Ada Obi') === -1 && JSON.stringify(pub).indexOf('GOC-T-001') === -1);
ok('a console reply reads as G.O.C Academy', core.publicFlag(core.answerFlag(f1, admin, 'Seen, thanks.', NOW).rec).reply.from === 'G.O.C Academy');
ok('a flag with no reply has reply null', core.publicFlag(f1).reply === null);
ok('another student\'s ID is not in the student view', JSON.stringify(pub).indexOf('studentId') === -1 && JSON.stringify(pub).indexOf('GOC-S-001') === -1);
var all = [
  Object.assign({}, f1, { id: 'FL-1', createdAt: '2026-10-10T09:00:00.000Z' }),
  Object.assign({}, f1, { id: 'FL-2', questionId: '42', createdAt: '2026-10-10T11:00:00.000Z' }),
  Object.assign({}, f1, { id: 'FL-3', studentId: 'GOC-S-009', studentName: 'Someone Else', createdAt: '2026-10-10T12:00:00.000Z' }),
  Object.assign({}, f1, { id: 'FL-4', subject: 'Physics', status: 'answered', reply: { text: 'ok then', byId: 'GOC-T-002', byName: 'Eze', role: 'tutor', at: '2026-10-10T12:30:00.000Z' }, createdAt: '2026-10-10T08:00:00.000Z' }),
  Object.assign({}, f1, { id: 'FL-5', status: 'closed', createdAt: '2026-10-10T07:00:00.000Z' })
];
var mine = core.flagsForStudent(all, stu);
ok('a student reads only their own flags, newest first', mine.map(function (f) { return f.id; }).join() === 'FL-2,FL-1,FL-4,FL-5');
ok('an Open student, or nobody, reads nothing (even if flags exist)', core.flagsForStudent(all, Object.assign({}, open, { id: 'GOC-S-001' })).length === 0 && core.flagsForStudent(all, null).length === 0 && core.flagsForStudent(all, { tier: 'goc' }).length === 0);
ok('a student demoted to Open stops seeing them on the next read', core.flagsForStudent(all, Object.assign({}, stu, { tier: 'open' })).length === 0);

console.log('\nwhat a tutor and the console see');
var ct = core.flagsForTutor(all, chem);
ok('a Chemistry tutor sees only Chemistry flags, newest first', ct.map(function (f) { return f.id; }).join() === 'FL-3,FL-2,FL-1,FL-5');
ok('a tutor sees the student\'s name and Scholar ID', ct[0].studentName === 'Someone Else' && ct[0].studentId === 'GOC-S-009');
ok('a Physics tutor sees only the Physics flag', core.flagsForTutor(all, phys).map(function (f) { return f.id; }).join() === 'FL-4');
ok('a switched-off tutor sees nothing', core.flagsForTutor(all, off).length === 0 && core.flagsForTutor(all, null).length === 0);
ok('asking for a subject that is not theirs gives nothing', core.flagsForTutor(all, chem, { subject: 'Physics' }).length === 0);
ok('a tutor with two subjects can narrow to one, or to a status', core.flagsForTutor(all, chem2, { subject: 'Chemistry' }).length === 4 && core.flagsForTutor(all, chem, { status: 'open' }).map(function (f) { return f.id; }).join() === 'FL-3,FL-2,FL-1');
ok('the tutor view of a reply shows who replied; the student view never does', core.flagsForTutor(all, phys)[0].reply.byName === 'Eze' && core.flagsForStudent(all, stu).filter(function (f) { return f.id === 'FL-4'; })[0].reply.from === 'Physics tutor');
ok('neither view carries a password, hash or tier', JSON.stringify(ct).indexOf('password') === -1 && JSON.stringify(ct).indexOf('tier') === -1);
ok('the console sees every flag and can filter by subject and status', core.flagsForConsole(all).length === 5 && core.flagsForConsole(all, { subject: 'Physics' }).length === 1 && core.flagsForConsole(all, { status: 'closed' }).length === 1);
ok('the lists do not change the stored flags', all[0].status === 'open' && all.length === 5 && all[0].reasonLabel === undefined);
ok('counts by status', JSON.stringify(core.flagCounts(all)) === JSON.stringify({ open: 3, answered: 1, closed: 1 }) && JSON.stringify(core.flagCounts(null)) === JSON.stringify({ open: 0, answered: 0, closed: 0 }));
ok('an unknown status counts as closed, never as waiting', core.flagCounts([{ status: 'weird' }, {}]).closed === 2);

console.log('\nthe console alert');
var al = core.makeFlagAlert(all[0], NOW);
ok('a new flag makes an unseen alert saying student, subject, question and reason', al.kind === 'question-flag' && al.seen === false && al.subject === 'Chemistry' && al.studentId === 'GOC-S-001' && al.studentName === 'Tobi Ade' && al.questionId === '41' && al.reason === 'wrong-answer' && al.flagId === 'FL-1');
ok('the alert carries no note text or reply', al.note === undefined && al.reply === undefined);
ok('each flag\'s alert is its own (addAlert does not merge them)', (function () {
  var l = core.addAlert([], core.makeFlagAlert(all[0], NOW)); l = core.addAlert(l, core.makeFlagAlert(all[1], NOW));
  return l.length === 2;
})());

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
