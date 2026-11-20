/* test-tutor-question-rules.js — the tutor question status rules (pure).
   Final cleanup (18 Nov 2026): there is no approval step for tutor questions.
   A tutor's validated question is stored live, straight into the Question Bank.
   'pending' and 'returned' survive only as historical statuses on records the
   retired approval process wrote; they are kept as stored and never served.
   Replaces test-tutor-approval.js.
   node test/test-tutor-question-rules.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

var chem = { id: 'GOC-T-001', name: 'Mrs Ada Obi', subjects: ['Chemistry'], active: true };
var phys = { id: 'GOC-T-002', name: 'Mr Eze', subjects: ['Physics'], active: true };
var T0 = '2026-10-08T09:00:00.000Z', T1 = '2026-10-08T10:00:00.000Z';
var q0 = { id: 'Q1', subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'Which is a strong acid?',
  difficulty: 'hard', explanation: 'HCl ionises completely.', options: ['a', 'b', 'c', 'd'], answer: 1 };

console.log('\nstatus');
ok('no status counts as live', core.questionStatus(q0) === 'live' && core.questionIsLive(q0));
ok('historical pending and returned records are not live', !core.questionIsLive({ status: 'pending' }) && !core.questionIsLive({ status: 'returned' }));
ok('an unknown status fails closed', !core.questionIsLive({ status: 'weird' }));
ok('nothing is not live', !core.questionIsLive(null) && !core.questionIsLive(undefined));
ok('the serving pool holds back historical pending and returned records', (function () {
  var l = [q0, { id: 'Q2', subject: 'Chemistry', status: 'pending' }, { id: 'Q4', subject: 'Chemistry', status: 'returned' }];
  var out = core.servablePool(l, []);
  return out.length === 1 && out[0].id === 'Q1' && l.length === 3;
})());

console.log('\na tutor question goes straight into the Question Bank');
var st = core.stampTutorQuestion(q0, chem, { batch: 'IMP-1' }, T0);
ok('it is stored live with the author, name and time', st.rec && st.rec.status === 'live' && st.rec.addedBy === 'GOC-T-001' && st.rec.addedByName === 'Mrs Ada Obi' && st.rec.addedAt === T0);
ok('it is servable at once — no approval or publish step', core.servablePool([st.rec], []).length === 1);
ok('subject, topic, difficulty, section, explanation, options and answer are kept',
  st.rec.subject === 'Chemistry' && st.rec.topic === 'Acids' && st.rec.difficulty === 'hard' && st.rec.section === 'objective' &&
  st.rec.explanation === q0.explanation && st.rec.options.length === 4 && st.rec.answer === 1);
ok('an import batch is kept', st.rec.batch === 'IMP-1');
ok('a typed question has no batch', !('batch' in core.stampTutorQuestion(q0, chem, {}, T0).rec));
ok('the original is not changed', q0.status === undefined && q0.addedBy === undefined);
ok('a Chemistry tutor cannot add Physics', /do not teach Physics/.test(core.stampTutorQuestion({ subject: 'Physics', text: 'x' }, chem, {}, T0).error || ''));
ok('a switched-off tutor cannot add', !!core.stampTutorQuestion(q0, { id: 'GOC-T-001', subjects: ['Chemistry'], active: false }, {}, T0).error);
ok('no tutor, no record: refused', !!core.stampTutorQuestion(q0, null, {}, T0).error && !!core.stampTutorQuestion(null, chem, {}, T0).error);
ok('a forged author, status or review mark is overwritten', (function () {
  var r = core.stampTutorQuestion({ id: 'Q9', subject: 'Chemistry', status: 'pending', addedBy: 'GOC-T-999', reviewedBy: 'x', returnReason: 'y' }, chem, {}, T0).rec;
  return r.status === 'live' && r.addedBy === 'GOC-T-001' && r.reviewedBy === undefined && r.returnReason === undefined;
})());
ok('a bad time falls back to now rather than breaking', /^\d{4}-/.test(core.stampTutorQuestion(q0, chem, {}, 'junk').rec.addedAt));

console.log('\nowning and editing');
var mine = st.rec;
ok('a tutor owns their own question', core.tutorOwnsQuestion(chem, mine));
ok('another tutor does not', !core.tutorOwnsQuestion(phys, mine));
ok('an admin-added question (no author) is not a tutor\'s', !core.tutorOwnsQuestion(chem, q0));
ok('a tutor moved off the subject loses it', !core.tutorOwnsQuestion({ id: 'GOC-T-001', subjects: ['Biology'], active: true }, mine));
var ed = core.tutorEditQuestion(chem, mine, { subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'Which of these is a strong acid?' }, T1);
ok('an edited question stays live', ed.rec && ed.rec.status === 'live');
ok('the edit keeps id, author, first-added time and batch', ed.rec.id === 'Q1' && ed.rec.addedBy === 'GOC-T-001' && ed.rec.addedAt === T0 && ed.rec.batch === 'IMP-1');
ok('the new text is in, with the edit time', /Which of these/.test(ed.rec.text) && ed.rec.editedAt === T1);
ok('a historical pending record, edited by its tutor, becomes live', (function () {
  var old = Object.assign({}, mine, { status: 'pending' });
  return core.tutorEditQuestion(chem, old, { subject: 'Chemistry', text: 'Fixed question text here' }, T1).rec.status === 'live';
})());
ok('a historical returned record, edited, becomes live and keeps its historical review marks', (function () {
  var ret = Object.assign({}, mine, { status: 'returned', returnReason: 'Option C is also correct', reviewedBy: 'Founder', reviewedAt: T0 });
  var e = core.tutorEditQuestion(chem, ret, { subject: 'Chemistry', text: 'Fixed question text here' }, T1).rec;
  return e.status === 'live' && e.returnReason === 'Option C is also correct' && e.reviewedBy === 'Founder' && e.reviewedAt === T0;
})());
ok('another tutor cannot edit it', !!core.tutorEditQuestion(phys, mine, { subject: 'Physics', text: 'xxxxxxxxx' }, T1).error);
ok('a tutor cannot edit an admin question', !!core.tutorEditQuestion(chem, q0, { subject: 'Chemistry', text: 'xxxxxxxxx' }, T1).error);
ok('a tutor cannot move their question into another subject', /do not teach Physics/.test(core.tutorEditQuestion(chem, mine, { subject: 'Physics', text: 'xxxxxxxxx' }, T1).error || ''));
ok('an edit cannot smuggle another author or a review mark', (function () {
  var e = core.tutorEditQuestion(chem, mine, { subject: 'Chemistry', text: 'xxxxxxxxx', addedBy: 'GOC-T-002', reviewedBy: 'Me' }, T1).rec;
  return e.addedBy === 'GOC-T-001' && e.reviewedBy === undefined;
})());

console.log('\nthe approval process is gone from the rules');
ok('no publish, approve/return review, batch approval or queue is exported',
  core.publishQuestion === undefined && core.reviewQuestion === undefined && core.approveBatch === undefined &&
  core.approvalQueue === undefined && core.pendingCount === undefined && core.RETURN_REASON_MIN === undefined);
ok('no publish action is logged for managers', typeof core.auditActionFor === 'function' && !core.auditActionFor('POST', '/api/questions/7/publish', {}));

console.log('\nlists and counts');
var all = [q0,
  core.stampTutorQuestion({ id: 'P1', subject: 'Chemistry', text: 'older one' }, chem, {}, '2026-10-01T08:00:00.000Z').rec,
  core.stampTutorQuestion({ id: 'P2', subject: 'Physics', text: 'physics one' }, phys, {}, '2026-10-05T08:00:00.000Z').rec,
  core.stampTutorQuestion({ id: 'P3', subject: 'Chemistry', text: 'newest one' }, chem, {}, '2026-10-07T08:00:00.000Z').rec,
  Object.assign(core.stampTutorQuestion({ id: 'P4', subject: 'Chemistry', text: 'historical pending' }, chem, {}, '2026-10-02T08:00:00.000Z').rec, { status: 'pending' })];
ok('a tutor sees only their own, in any status, newest first', core.tutorQuestions(all, chem).map(function (q) { return q.id; }).join() === 'P3,P4,P1');
ok('a tutor never sees another tutor\'s or the admin\'s', core.tutorQuestions(all, phys).map(function (q) { return q.id; }).join() === 'P2');
ok('last upload is the newest stamp for the subject', core.lastTutorUpload(all, 'Chemistry') === '2026-10-07T08:00:00.000Z');
ok('the depth count includes tutor questions and ignores historical pending ones', (function () {
  var d = core.subjectDepth(all.map(function (q) { return Object.assign({ section: 'objective' }, q); }), []);
  return d.filter(function (r) { return r.subject === 'Chemistry'; })[0].objective === 3;
})());

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
