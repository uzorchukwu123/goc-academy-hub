/* test-notices-rules.js — Phase 3C slice 7, part 1: the pure rules for class notices.
   node test/test-notices-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

var chem = { id: 'GOC-T-001', name: 'Ada Obi', subjects: ['Chemistry'], active: true };
var phys = { id: 'GOC-T-002', name: 'Eze', subjects: ['Physics'], active: true };
var NOW = Date.UTC(2026, 9, 8, 10, 0, 0);
var good = { subject: 'Chemistry', title: 'Lab moved to Friday', body: 'The titration practical is now on Friday at 10am in Lab 2.' };

console.log('\nvalidation');
var v = core.validateNotice(good);
ok('a good notice is accepted', !!v.rec && v.rec.title === 'Lab moved to Friday' && v.rec.subject === 'Chemistry');
ok('it carries no expiry, pin or active flag (stays until removed)', v.rec.expires === undefined && v.rec.pinned === undefined && v.rec.active === undefined);
ok('an unknown subject is refused', !!core.validateNotice(Object.assign({}, good, { subject: 'Latin' })).error);
ok('a short title is refused', !!core.validateNotice(Object.assign({}, good, { title: 'Hi' })).error);
ok('a long title is refused', !!core.validateNotice(Object.assign({}, good, { title: new Array(90).join('a') })).error);
ok('a short body is refused', !!core.validateNotice(Object.assign({}, good, { body: 'Soon' })).error);
ok('a body over 1000 characters is refused', !!core.validateNotice(Object.assign({}, good, { body: new Array(1002).join('x') })).error);
ok('spaces in a title are tidied and line breaks kept in the body', (function () {
  var r = core.validateNotice({ subject: 'Chemistry', title: '  Lab   moved  ', body: 'Line one here.\r\nLine two here.' }).rec;
  return r.title === 'Lab moved' && r.body === 'Line one here.\nLine two here.';
})());
ok('nothing at all is an error, not a crash', !!core.validateNotice(null).error);

console.log('\nstamping and ownership');
var st = core.stampTutorNotice(v.rec, chem, NOW);
ok('a tutor notice is stamped with author, name and time', st.rec.addedBy === 'GOC-T-001' && st.rec.addedByName === 'Ada Obi' && st.rec.addedAt === '2026-10-08T10:00:00.000Z' && st.rec.editedAt === undefined);
ok('the input is not changed', v.rec.addedBy === undefined);
ok('a tutor cannot post to a subject they do not teach', /do not teach Chemistry/.test(core.stampTutorNotice(v.rec, phys, NOW).error));
ok('a switched-off tutor cannot post', !!core.stampTutorNotice(v.rec, Object.assign({}, chem, { active: false }), NOW).error);
var mine = Object.assign({}, st.rec, { id: 5 });
ok('a tutor owns their notice', core.tutorOwnsNotice(chem, mine));
ok('not another tutor', !core.tutorOwnsNotice(phys, mine));
ok('not when switched off', !core.tutorOwnsNotice(Object.assign({}, chem, { active: false }), mine));
ok('not after the subject is taken away', !core.tutorOwnsNotice({ id: 'GOC-T-001', name: 'A', subjects: ['Physics'], active: true }, mine));

console.log('\nediting');
var ch = core.validateNotice({ subject: 'Chemistry', title: 'Lab moved to Saturday', body: 'The titration practical is now on Saturday at 10am in Lab 2.' }).rec;
var ed = core.tutorEditNotice(chem, mine, Object.assign({ addedBy: 'GOC-T-099', addedAt: 'forged' }, ch), NOW + 60000);
ok('an edit keeps id, author and first-posted time and adds an edit time', ed.rec.id === 5 && ed.rec.addedBy === 'GOC-T-001' && ed.rec.addedAt === mine.addedAt && ed.rec.editedAt === '2026-10-08T10:01:00.000Z' && ed.rec.title === 'Lab moved to Saturday', JSON.stringify(ed));
ok('another tutor cannot edit it', !!core.tutorEditNotice(phys, mine, ch, NOW).error);
ok('the subject cannot be changed by an edit (it would be a quiet new post)', /stays in the subject/.test(core.tutorEditNotice(chem, mine, Object.assign({}, ch, { subject: 'Physics' }), NOW).error));
ok('an edit that repeats the same subject is fine', !!core.tutorEditNotice(chem, mine, Object.assign({}, ch, { subject: 'Chemistry' }), NOW).rec);

console.log('\nlists, and who may read');
var list = [mine,
  Object.assign({}, mine, { id: 7, addedAt: '2026-10-09T00:00:00.000Z', editedAt: '2026-10-09T01:00:00.000Z' }),
  Object.assign({}, mine, { id: 8, addedBy: 'GOC-T-002', subject: 'Physics', addedByName: 'Eze' })];
ok('a tutor lists only their own, newest first', core.tutorNotices(list, chem).map(function (n) { return n.id; }).join() === '7,5');
var goc = { id: 'S1', tier: 'goc', subjects: ['English Language', 'Chemistry', 'Physics', 'Mathematics'] };
var seen = core.noticesForStudent(list, goc);
ok('a GOC student sees notices for the subjects they take, newest first', seen.map(function (n) { return n.id; }).join() === '7,5,8');
ok('a GOC student NOT taking the subject does not see it', core.noticesForStudent(list, Object.assign({}, goc, { subjects: ['Physics'] })).map(function (n) { return n.id; }).join() === '8');
ok('an Open student sees none', core.noticesForStudent(list, Object.assign({}, goc, { tier: 'open' })).length === 0);
ok('a student with no tier reads as Open and sees none', core.noticesForStudent(list, { id: 'S2', subjects: ['Chemistry'] }).length === 0);
ok('an odd tier string such as "GOCX" sees none', core.noticesForStudent(list, Object.assign({}, goc, { tier: 'GOCX' })).length === 0);
ok('no student record, no notices', core.noticesForStudent(list, null).length === 0);
var pub = seen[0];
ok('a student copy has no tutor ID or name, and says only who it is from', pub.addedBy === undefined && pub.addedByName === undefined && pub.from === 'Chemistry tutor' && JSON.stringify(pub).indexOf('Ada') === -1 && JSON.stringify(pub).indexOf('GOC-T') === -1);
ok('it shows when it was posted and whether it was edited', pub.at === '2026-10-09T00:00:00.000Z' && pub.edited === true && seen[1].edited === false);
ok('a notice never edited reads edited: false', core.publicNotice(st.rec).edited === false);

console.log('\nalerts');
var al = core.makeNoticeAlert(chem, Object.assign({}, mine), NOW);
ok('a new notice makes a class-notice alert', al.kind === 'class-notice' && al.tutorName === 'Ada Obi' && al.subject === 'Chemistry' && al.noticeId === 5 && al.title === 'Lab moved to Friday' && al.seen === false && al.at === '2026-10-08T10:00:00.000Z');
al.id = 'AL-1';
var l1 = core.addAlert([], al);
var al2 = core.makeNoticeAlert(chem, Object.assign({}, mine, { id: 6, title: 'Second one' }), NOW + 1000); al2.id = 'AL-2';
var l2 = core.addAlert(l1, al2);
ok('two new notices are two alerts (they never merge into one)', l2.length === 2 && l2[0].noticeId === 5 && l2[1].noticeId === 6);
var markAl = { kind: 'tutor-mark', attemptId: 'A1', id: 'AL-3', seen: false, at: 'x' };
var l3 = core.addAlert(l2, Object.assign({}, markAl, { id: 'AL-9', at: 'y' }));
var l4 = core.addAlert(core.addAlert([], markAl), Object.assign({}, markAl, { id: 'AL-9', at: 'y' }));
ok('tutor-mark alerts still update in place', l4.length === 1 && l4[0].at === 'y' && l4[0].id === 'AL-3');
ok('a notice alert and a mark alert never merge', l3.length === 3);
ok('unseen alerts include notice alerts, newest first', core.unseenAlerts(l2)[0].noticeId === 6);
var gone = core.flagNoticeGone(l2, 5);
ok('removing a notice flags its alert as gone but keeps it', gone.length === 2 && gone[0].gone === true && gone[1].gone === undefined && l2[0].gone === undefined);
ok('Seen still works on a notice alert', core.markAlertSeen(l2, 'AL-1', 'FOUNDER', NOW).alert.seen === true);

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
