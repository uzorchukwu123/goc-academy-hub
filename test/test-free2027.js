/* test-free2027.js — the 2027 Free Tutorial Edition, slice 1: the shared rules.
   Pure functions only — no server, no DOM — so this suite pins the policy the
   page and the server must agree on: the two modes, the one central switch, the
   OTP and email rules, the activity window, the timer, the ranking order and
   the archive naming.
   node test/test-free2027.js */
'use strict';
var path = require('path');
var f = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-free-2027.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 180) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('the two website modes and the one central switch');
ok('there are exactly two modes', f.MODES.length === 2 && f.MODES.join() === 'original,free2027', f.MODES.join());
ok('both modes have a human label', f.modeLabel('original') === 'Original Mode' && f.modeLabel('free2027') === '2027 Free Tutorial Mode');
ok('an unknown mode falls back to Original', f.cleanMode('nonsense') === 'original' && f.modeLabel('nonsense') === 'Original Mode');
ok('the switch defaults to Original', f.editionDefault('') === 'original' && f.editionDefault(undefined) === 'original');
ok('the switch can be set to the edition', f.editionDefault('free2027') === 'free2027' && f.editionDefault('1') === 'free2027' && f.editionDefault('FREE') === 'free2027');
ok('switched OFF the site is in Original Mode whatever is stored', f.activeMode({ enabled: false, mode: 'free2027' }, true) === 'original');
ok('switched ON the stored mode is used', f.activeMode({ enabled: true, mode: 'free2027' }, true) === 'free2027');
ok('a corrupt stored mode cannot leave the site without a homepage', f.activeMode({ enabled: true, mode: '???' }, true) === 'original');
ok('when the feature is off there is no edition at all', f.activeMode({ enabled: true, mode: 'free2027' }, false) === 'original');
ok('six free-tutorial screens are declared', f.SCREENS.length === 6 && f.isFreeScreen('free-portal') && !f.isFreeScreen('home'));

head('participant records and the email rule');
ok('a name is required', f.cleanName('').error && f.cleanName('A').error, 'short name accepted');
ok('a name is trimmed', f.cleanName('  Ada   Obi ').name === 'Ada Obi');
ok('a name with no letters is refused', !!f.cleanName('12345').error);
ok('a good address is accepted and lower-cased', f.cleanEmail(' Ada.Obi@Example.COM ').email === 'ada.obi@example.com');
['', 'ada', 'ada@', 'a@b', 'a b@example.com', 'ada@@example.com', 'ada@example', 'ada@.com'].forEach(function (bad) {
  ok('refused: ' + (bad || '(empty)'), !!f.cleanEmail(bad).error, JSON.stringify(f.cleanEmail(bad)));
});
ok('a course is required', !!f.cleanCourse('').error && f.cleanCourse('Law').course === 'Law');
ok('the console course list is de-duplicated and trimmed', f.cleanCourseList([' Law ', 'law', 'Physics', '']).join() === 'Law,Physics', f.cleanCourseList([' Law ', 'law', 'Physics', '']).join());
ok('participant IDs preserve a random non-sequential identifier', f.participantId('0123456789abcdefabcd') === 'GOC-F27-0123456789ABCDEFABCD');
ok('only the 80-bit random ID shape is accepted', f.isParticipantId('GOC-F27-0123456789ABCDEFABCD') && !f.isParticipantId('GOC-S-001') && !f.isParticipantId('GOC-F27-0001'));
var pub = f.publicParticipant({ id: 'GOC-F27-0123456789ABCDEFABCD', name: 'Ada', course: 'Law', email: 'ada@example.com', verified: true, otp: '123456' });
ok('a public participant carries no email address and no code', JSON.stringify(pub).indexOf('@') < 0 && !pub.otp, JSON.stringify(pub));
ok('the address is masked even for the candidate themselves', f.maskEmail('ada.obi@example.com').indexOf('ada.obi') < 0 && /@example\.com$/.test(f.maskEmail('ada.obi@example.com')), f.maskEmail('ada.obi@example.com'));

head('one-time codes');
ok('a code is exactly six digits', f.OTP_LENGTH === 6 && f.cleanOtp('123456').code === '123456');
ok('a short or long code is refused', !!f.cleanOtp('12345').error && !!f.cleanOtp('1234567').error);
ok('digits only, however they are typed', f.cleanOtp('12 34 56').code === '123456');
ok('the codes are compared exactly', f.otpMatches('123456', '123456') && !f.otpMatches('123456', '123457') && !f.otpMatches('', ''));
ok('a code that stays usable has a stated life and a resend gap', f.OTP_TTL_MIN > 0 && f.OTP_RESEND_SEC > 0);

head('an activity is only open inside its window');
function act(extra) {
  return Object.assign({ kind: 'weekly', title: 'Week 1', status: 'published', published: true,
    opensAt: 1000, closesAt: 2000, durationMin: 20, maxAttempts: 1, questionIds: ['1'] }, extra || {});
}
ok('before the opening time it is upcoming', f.activityState(act(), 500) === 'upcoming');
ok('inside the window it is open', f.activityState(act(), 1500) === 'open' && f.canSit(act(), 1500));
ok('after the closing time it is ended', f.activityState(act(), 2500) === 'ended' && !f.canSit(act(), 2500));
ok('a draft is never open', f.activityState(act({ status: 'draft', published: false }), 1500) === 'draft');
ok('a closed activity is closed even inside its window', f.activityState(act({ status: 'closed' }), 1500) === 'closed');
ok('a latecomer gets in only because the administrator reopened it', (function () {
  var a = act();
  return f.activityState(a, 2500) === 'ended' && f.activityState(act({ reopenedAt: 2400, reopenClosesAt: 5000 }), 2500) === 'open';
})());
ok('a reopen never moves the opening time', f.activityState(act({ reopenedAt: 2400, reopenClosesAt: 5000 }), 500) === 'upcoming');

head('what may be published');
ok('a new activity needs a kind, a title and both times', f.validateActivity({}, {}).error);
var good = { kind: 'weekly', title: 'Week 1', opensAt: 1000, closesAt: 2000, durationMin: 20, maxAttempts: 1, questionIds: ['3'] };
ok('a complete activity passes', !f.validateActivity(good, {}).error, f.validateActivity(good, {}).error);
ok('a closing time before the opening time is refused', !!f.validateActivity(Object.assign({}, good, { closesAt: 500 }), {}).error);
ok('a duration outside the bounds is refused', !!f.validateActivity(Object.assign({}, good, { durationMin: 0 }), {}).error &&
  !!f.validateActivity(Object.assign({}, good, { durationMin: f.MAX_DURATION_MIN + 1 }), {}).error);
ok('an attempt limit outside the bounds is refused', !!f.validateActivity(Object.assign({}, good, { maxAttempts: 0 }), {}).error &&
  !!f.validateActivity(Object.assign({}, good, { maxAttempts: f.MAX_ATTEMPTS + 1 }), {}).error);
ok('an activity with no questions is refused', !!f.validateActivity(Object.assign({}, good, { questionIds: [] }), {}).error);
ok('duplicate question IDs are counted once', f.validateActivity(Object.assign({}, good, { questionIds: ['3', '3', '4'] }), {}).rec.questionIds.length === 2);
ok('an ISO date string is understood as well as a number', f.validateActivity(Object.assign({}, good, { opensAt: '2027-01-01T09:00:00Z', closesAt: '2027-01-01T11:00:00Z' }), {}).rec.opensAt > 0);

head('the clock belongs to the server');
var attempt = { startedAt: 1000000, durationSec: 600 };
ok('the deadline is the stored start plus the stored duration', f.attemptDeadline(attempt) === 1000000 + 600000);
ok('the remaining time counts down', f.attemptRemainingSec(attempt, 1000000 + 100000) === 500);
ok('it never goes below zero', f.attemptRemainingSec(attempt, 9999999) === 0 && f.attemptExpired(attempt, 9999999));
ok('an unsubmitted paper inside its time is open', f.attemptState(attempt, 1000000 + 1000) === 'open');
ok('an unsubmitted paper past its time has expired', f.attemptState(attempt, 9999999) === 'expired');
ok('a submitted paper is submitted', f.attemptState({ submittedAt: 5 }, 0) === 'submitted');
ok('a paper whose time ran out is not silently restarted', (function () {
  var a = Object.assign({}, attempt, { responses: { 1: 2 } });
  return f.attemptState(a, 9999999) === 'expired';
})());

head('attempts are counted and resumed');
var mine = [{ submittedAt: 10 }, { submittedAt: null, startedAt: 1000000, durationSec: 600 }];
/* `now` is handed in everywhere in this module, so the suite owns the clock. */
var openNow = 1000000 + 50000;
ok('only submitted papers use an attempt', f.attemptsUsed([{ submittedAt: 1 }, { submittedAt: null }]) === 1);
ok('the attempts left follow the limit', f.attemptsLeft({ maxAttempts: 2 }, [{ submittedAt: 1 }]) === 1 &&
  f.attemptsLeft({ maxAttempts: 1 }, [{ submittedAt: 1 }]) === 0);
ok('an open paper is the one to resume', f.openAttempt(mine, openNow) === mine[1]);
ok('an expired paper is not resumed', f.openAttempt([{ startedAt: 1, durationSec: 60 }], 1000000) === null);

head('ranking: highest score first, then the shortest time');
var ranked = f.rankRows([
  { participantId: 'A', score: 7, timeUsedSec: 300 },
  { participantId: 'B', score: 5, timeUsedSec: 100 },
  { participantId: 'C', score: 7, timeUsedSec: 200 },
  { participantId: 'D', score: 5, timeUsedSec: 100 }
]);
ok('the highest score is first', ranked[0].participantId === 'C', ranked.map(function (r) { return r.participantId + ':' + r.rank; }).join(' '));
ok('equal scores are split by the shorter time', ranked[1].participantId === 'A' && ranked[0].rank === 1 && ranked[1].rank === 2);
ok('an exact tie shares a place', ranked[2].rank === 3 && ranked[3].rank === 3, ranked[2].rank + '/' + ranked[3].rank);
ok('one participant appears once, with their best attempt', (function () {
  var r = f.rankRows([{ participantId: 'A', score: 2, timeUsedSec: 300 }, { participantId: 'A', score: 9, timeUsedSec: 120 }]);
  return r.length === 1 && r[0].score === 9 && r[0].timeUsedSec === 120;
})());
ok('a paper with no time ranks below one that has a time', f.betterRank({ score: 4, timeUsedSec: 60 }, { score: 4, timeUsedSec: 0 }) < 0);

head('leaderboards: competitions only, top ten only, approval first');
var comp = { id: 'Q1', kind: 'competition', title: 'Cup', status: 'published', leaderboard: { approved: true, published: true } };
var many = [];
for (var i = 1; i <= 15; i++) many.push({ participantId: 'P' + i, name: 'N' + i, course: 'Law', score: 20 - i, timeUsedSec: 100 + i });
var board = f.publicLeaderboard(comp, many);
ok('a published competition gives a board', !!board && board.rows.length === f.PUBLIC_TOP_N, board && board.rows.length);
ok('the board carries the whole field size', board.totalCompetitors === 15, board.totalCompetitors);
ok('an approved but unpublished board is not public', f.publicLeaderboard({ id: 'Q1', kind: 'competition', status: 'published', leaderboard: { approved: true, published: false } }, many) === null);
ok('an unapproved board is not public', f.publicLeaderboard({ id: 'Q1', kind: 'competition', status: 'published', leaderboard: { approved: false, published: true } }, many) === null);
ok('a weekly assessment has no public board', f.publicLeaderboard({ id: 'Q1', kind: 'weekly', status: 'published', leaderboard: { approved: true, published: true } }, many) === null);
ok('a draft competition is not public', f.publicLeaderboard({ id: 'Q1', kind: 'competition', status: 'draft', leaderboard: { approved: true, published: true } }, many) === null);
var pos = f.myPosition(comp, many, 'P14');
ok('a candidate outside the top ten still sees their own position', !!pos && pos.rank === 14 && pos.inTop === false, JSON.stringify(pos));
ok('a candidate inside the top ten is marked as such', f.myPosition(comp, many, 'P2').inTop === true);
ok('a candidate who did not compete has no position', f.myPosition(comp, many, 'NOPE') === null);

head('sessions and archives');
var s = f.emptySession(3);
ok('a new session has fresh records', s.id === 'F27-S3' && s.participants.length === 0 && s.activities.length === 0 && s.attempts.length === 0);
ok('the archive file name is derived from the session', f.archiveName('F27-S3') === 'free2027-archive-F27-S3.json');
ok('the archive name cannot escape its folder', f.archiveName('../../etc/passwd').indexOf('/') < 0, f.archiveName('../../etc/passwd'));
ok('a session label is trimmed and capped', f.cleanSessionLabel('  Term  Two  ') === 'Term Two' && f.cleanSessionLabel('').length > 0);

head('programme lessons, progress and the audit trail');
ok('a new session has an empty lesson catalogue and audit trail',
  Array.isArray(s.lessons) && s.lessons.length === 0 && Array.isArray(s.audit) && s.audit.length === 0);
ok('lesson ids are issued by the programme, never chosen by the client',
  f.lessonId(1) === 'F27-L-001' && f.lessonId(12) === 'F27-L-012' && f.lessonId(120) === 'F27-L-120' && f.isLessonId('F27-L-001') && !f.isLessonId('lesson-1'));
ok('a lesson needs a real title', !f.cleanLesson({ title: '' }).error === false && !!f.cleanLesson({ title: '  ' }).error && !!f.cleanLesson({ title: 'ab' }).error);
ok('a good lesson is trimmed and capped',
  f.cleanLesson({ title: '  Cell   biology  ', subject: ' Biology ', summary: ' x '.repeat(500) }).lesson.title === 'Cell biology' &&
  f.cleanLesson({ title: 'Cell biology', subject: ' Biology ' }).lesson.subject === 'Biology' &&
  f.cleanLesson({ title: 'Cell biology', summary: 'x'.repeat(500) }).lesson.summary.length === f.LESSON_SUMMARY_MAX);
ok('only live lessons are shown, in the administrator\'s order',
  f.liveLessons([
    { id: 'F27-L-002', title: 'Second', order: 2 },
    { id: 'F27-L-001', title: 'First', order: 1 },
    { id: 'F27-L-003', title: 'Hidden', order: 3, active: false }
  ]).map(function (l) { return l.id; }).join(',') === 'F27-L-001,F27-L-002');
var sheet = f.progressOf({ progress: { lessons: { 'F27-L-001': 1700000000000 } } }, [
  { id: 'F27-L-001', title: 'One', order: 1 }, { id: 'F27-L-002', title: 'Two', order: 2 }
]);
ok('progress counts only what is done, out of what is live', sheet.completed === 1 && sheet.total === 2 && sheet.percent === 50, JSON.stringify(sheet));
ok('a completion keeps the time it was marked', sheet.lessons[0].done === true && sheet.lessons[0].completedAt === 1700000000000);
ok('a candidate with no programme record still reads as zero progress',
  f.progressOf({}, [{ id: 'F27-L-001', title: 'One' }]).percent === 0);
ok('no lessons means no division by zero', f.progressOf({}, []).percent === 0 && f.progressOf({}, []).total === 0);
var entry = f.auditEntry({ id: 'GOC-A-001', role: 'founder' }, 'lesson.create', 'F27-L-001', 'Cell biology', 1700000000000);
ok('an audit entry names the administrator and the action',
  entry.actorId === 'GOC-A-001' && entry.actorRole === 'founder' && entry.action === 'lesson.create' && entry.target === 'F27-L-001' && entry.at === 1700000000000);
ok('an audit entry cannot carry a long free-text body', f.auditEntry({ id: 'x' }, 'a', 'b', 'z'.repeat(500)).detail.length <= 80);
ok('an anonymous change is recorded as the system', f.auditEntry(null, 'x').actorId === 'system');
var trail = { audit: [] };
for (var ai = 0; ai < f.AUDIT_MAX + 5; ai++) f.pushAudit(trail, f.auditEntry({ id: 'GOC-A-001' }, 'action' + ai));
ok('the audit trail is bounded, newest first',
  trail.audit.length === f.AUDIT_MAX && trail.audit[0].action === 'action' + (f.AUDIT_MAX + 4),
  trail.audit.length + ' ' + (trail.audit[0] || {}).action);

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
