/* test-tutors.js — Phase 3C slice 1: the pure tutor rules (no server, no screen).
   node test/test-tutors.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

console.log('\ntutor IDs');
ok('GOC-T-001 is valid', core.validTutorId('GOC-T-001'));
ok('case and spaces are tidied', core.cleanTutorId('  goc-t-012 ') === 'GOC-T-012' && core.validTutorId(' goc-t-012 '));
ok('a student or staff ID is not a tutor ID', !core.validTutorId('GOC-S-001') && !core.validTutorId('GOC-A-001'));
ok('too short, empty and junk are refused', !core.validTutorId('GOC-T-1') && !core.validTutorId('') && !core.validTutorId(null) && !core.validTutorId('GOC-T-00A'));
ok('first ID is GOC-T-001', core.nextTutorId([]) === 'GOC-T-001' && core.nextTutorId() === 'GOC-T-001');
ok('next ID follows the highest, gaps are not reused', core.nextTutorId(['GOC-T-001', 'GOC-T-004']) === 'GOC-T-005');
ok('other IDs in the list are ignored', core.nextTutorId(['GOC-S-009', 'junk', 'GOC-T-002']) === 'GOC-T-003');
ok('IDs grow past 999', core.nextTutorId(['GOC-T-999']) === 'GOC-T-1000' && core.validTutorId('GOC-T-1000'));

console.log('\nvalidateTutor');
var good = core.validateTutor({ name: '  Mrs  Ada Obi ', subjects: ['Chemistry', 'Physics'], password: 'starter-pass' });
ok('a good tutor is accepted', good.rec && !good.error);
ok('name is tidied', good.rec && good.rec.name === 'Mrs Ada Obi');
ok('subjects are kept in the academy order', good.rec && good.rec.subjects.join() === 'Physics,Chemistry', good.rec && good.rec.subjects.join());
ok('no ID given means blank (the server issues one)', good.rec && good.rec.id === '');
ok('a given ID is normalised', core.validateTutor({ name: 'Ada', subjects: ['Biology'], id: 'goc-t-007', password: 'longenough' }).rec.id === 'GOC-T-007');
ok('a bad ID is refused', /GOC-T-001/.test(core.validateTutor({ name: 'Ada', subjects: ['Biology'], id: 'T7', password: 'longenough' }).error || ''));
ok('duplicate subjects collapse', core.validateTutor({ name: 'Ada', subjects: ['Biology', 'Biology', ' Biology '], password: 'longenough' }).rec.subjects.length === 1);
ok('a single `subject` is accepted', core.validateTutor({ name: 'Ada', subject: 'Mathematics', password: 'longenough' }).rec.subjects[0] === 'Mathematics');
ok('English may be taught', !!core.validateTutor({ name: 'Ada', subjects: [core.ENGLISH], password: 'longenough' }).rec);
ok('no name is refused', !!core.validateTutor({ name: ' ', subjects: ['Biology'], password: 'longenough' }).error);
ok('a one-letter name is refused', !!core.validateTutor({ name: 'A', subjects: ['Biology'], password: 'longenough' }).error);
ok('a very long name is refused', !!core.validateTutor({ name: new Array(90).join('a'), subjects: ['Biology'], password: 'longenough' }).error);
ok('no subject is refused', /at least one subject/.test(core.validateTutor({ name: 'Ada', subjects: [], password: 'longenough' }).error || ''));
ok('an unknown subject is refused by name', /Geography/.test(core.validateTutor({ name: 'Ada', subjects: ['Geography'], password: 'longenough' }).error || ''));
ok('one unknown subject among good ones is still refused', !!core.validateTutor({ name: 'Ada', subjects: ['Biology', 'Art'], password: 'longenough' }).error);
ok('a starting password is required by default', !!core.validateTutor({ name: 'Ada', subjects: ['Biology'] }).error);
ok('a short password is refused', /8 characters/.test(core.validateTutor({ name: 'Ada', subjects: ['Biology'], password: 'short' }).error || ''));
ok('the floor is 8, same as staff', core.TUTOR_PASSWORD_MIN === 8 && !!core.validateTutor({ name: 'Ada', subjects: ['Biology'], password: '1234567' }).error && !!core.validateTutor({ name: 'Ada', subjects: ['Biology'], password: '12345678' }).rec);
ok('editing without a reset needs no password', !!core.validateTutor({ name: 'Ada', subjects: ['Biology'] }, { needPassword: false }).rec);
ok('editing with a too-short new password is still refused', !!core.validateTutor({ name: 'Ada', subjects: ['Biology'], password: 'abc' }, { needPassword: false }).error);
ok('null input does not throw', !!core.validateTutor(null).error);

console.log('\ntutorCan');
var chem = { id: 'GOC-T-001', name: 'Ada', subjects: ['Chemistry'], active: true };
ok('may act on own subject', core.tutorCan(chem, 'Chemistry'));
ok('a Chemistry tutor cannot touch Physics', !core.tutorCan(chem, 'Physics'));
ok('a blank or missing subject is refused', !core.tutorCan(chem, '') && !core.tutorCan(chem) && !core.tutorCan(chem, null));
ok('a switched-off tutor can do nothing', !core.tutorCan({ subjects: ['Chemistry'], active: false }, 'Chemistry'));
ok('a record with no active flag counts as active', core.tutorCan({ subjects: ['Chemistry'] }, 'Chemistry'));
ok('no tutor, or one with no subject list, fails closed', !core.tutorCan(null, 'Chemistry') && !core.tutorCan({}, 'Chemistry') && !core.tutorCan({ subjects: 'Chemistry' }, 'Chemistry'));
ok('subject matching is exact, not by prefix', !core.tutorCan({ subjects: ['Chemistry'] }, 'Chem'));

console.log('\nscopeToSubjects');
var items = [{ id: 1, subject: 'Chemistry' }, { id: 2, subject: 'Physics' }, { id: 3, subject: 'Chemistry' }, null, { id: 4 }];
var scoped = core.scopeToSubjects(items, ['Chemistry']);
ok('keeps only the tutor\'s subject', scoped.length === 2 && scoped[0].id === 1 && scoped[1].id === 3);
ok('several subjects keep each', core.scopeToSubjects(items, ['Chemistry', 'Physics']).length === 3);
ok('an empty scope returns nothing', core.scopeToSubjects(items, []).length === 0);
ok('a bad scope or list returns nothing', core.scopeToSubjects(items, null).length === 0 && core.scopeToSubjects(null, ['Chemistry']).length === 0 && core.scopeToSubjects(items, 'Chemistry').length === 0);
ok('items without the field are dropped', !scoped.some(function (x) { return x.id === 4; }));
ok('a custom field works', core.scopeToSubjects([{ sub: 'Biology' }, { sub: 'Physics' }], ['Biology'], 'sub').length === 1);
ok('the input is not changed', items.length === 5 && items[1].subject === 'Physics');
ok('Object.prototype keys are not a way in', core.scopeToSubjects([{ subject: 'constructor' }, { subject: 'toString' }], ['Chemistry']).length === 0);

console.log('\ntutorSubjectFor (the dashboard is for one subject)');
var two = { subjects: ['Physics', 'Chemistry'], active: true };
ok('nothing asked for gives the first subject', core.tutorSubjectFor(two).subject === 'Physics' && core.tutorSubjectFor(two, '  ').subject === 'Physics');
ok('an own subject is returned', core.tutorSubjectFor(two, 'Chemistry').subject === 'Chemistry');
ok('another subject is refused', /do not teach Biology/.test(core.tutorSubjectFor(two, 'Biology').error || '') && !core.tutorSubjectFor(two, 'Biology').subject);
ok('an inactive tutor gets nothing', !!core.tutorSubjectFor({ subjects: ['Physics'], active: false }).error);
ok('a tutor with no subjects gets nothing', !!core.tutorSubjectFor({ subjects: [] }).error && !!core.tutorSubjectFor(null).error);

console.log('\ntutorPublic (never a password or hash)');
var rec = { id: 'GOC-T-001', name: 'Ada', subjects: ['Chemistry'], active: true, passwordHash: 'x', salt: 'y', password: 'z', hash: 'h', mustChange: true };
var pub = core.tutorPublic(rec);
ok('keeps the harmless fields', pub.id === 'GOC-T-001' && pub.name === 'Ada' && pub.active === true && pub.mustChange === true);
ok('drops password, hash and salt', !('password' in pub) && !('passwordHash' in pub) && !('hash' in pub) && !('salt' in pub));
ok('the original is untouched', rec.passwordHash === 'x' && rec.salt === 'y');
ok('the subject list is a copy', (pub.subjects.push('Physics'), rec.subjects.length === 1));
ok('null gives an empty object', Object.keys(core.tutorPublic(null)).length === 0);

console.log('\nsubjectDepth (the console\'s Subjects & tutors view)');
var qs = [];
function addQ(sub, sec, n, status) { for (var i = 0; i < n; i++) qs.push({ subject: sub, section: sec, status: status }); }
addQ('Physics', 'objective', 25); addQ('Physics', 'objective', 4, 'pending'); addQ('Physics', 'objective', 2, 'returned');
addQ('Physics', 'jamb', 3); addQ('Chemistry', 'objective', 1);
var nts = [{ subject: 'Physics', active: true }, { subject: 'Physics', active: false }, { subject: 'Physics' }];
var depth = core.subjectDepth(qs, nts);
var phy = depth.filter(function (r) { return r.subject === 'Physics'; })[0];
var che = depth.filter(function (r) { return r.subject === 'Chemistry'; })[0];
var eng = depth.filter(function (r) { return r.subject === core.ENGLISH; })[0];
ok('every academy subject has a row, in order', depth.map(function (r) { return r.subject; }).join() === core.ALL_SUBJECTS.join());
ok('only live questions count (pending and returned do not)', phy.objective === 25, phy.objective);
ok('a question with no status counts as live', phy.jamb === 3);
ok('switched-off notes do not count; no flag means on', phy.notes === 2, phy.notes);
ok('25 objective is ok, 3 JAMB is thin, no practice is empty', phy.status.objective === 'ok' && phy.status.jamb === 'thin' && phy.status.practice === 'empty');
ok('weak lists what is not ok', phy.weak.indexOf('jamb') > -1 && phy.weak.indexOf('objective') === -1);
ok('one question is thin, not empty', che.status.objective === 'thin');
ok('subjects with no theory paper are marked not applicable', (function () {
  var any = depth.filter(function (r) { return r.status.theory === 'na'; });
  return any.every(function (r) { return !core.THEORY_SUBJECTS || core.THEORY_SUBJECTS.indexOf(r.subject) === -1; });
})());
ok('nothing at all reads empty, and null input does not throw', core.subjectDepth(null, null).every(function (r) { return r.status.objective === 'empty'; }));
ok('the minimums are exposed', core.SUBJECT_DEPTH_MIN.objective === 20 && core.SUBJECT_DEPTH_MIN.notes === 3);

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
