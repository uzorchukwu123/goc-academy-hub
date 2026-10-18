/* test-tutor-approval.js — Phase 3C slice 6, part 1: the question approval rules (pure).
   node test/test-tutor-approval.js */
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
var admin = { id: 'GOC-A-001', name: 'Founder', role: 'staff' };
var T0 = '2026-10-08T09:00:00.000Z', T1 = '2026-10-08T10:00:00.000Z';
var q0 = { id: 'Q1', subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'Which is a strong acid?' };

console.log('\nstatus');
ok('no status counts as live', core.questionStatus(q0) === 'live' && core.questionIsLive(q0));
ok('pending and returned are not live', !core.questionIsLive({ status: 'pending' }) && !core.questionIsLive({ status: 'returned' }));
ok('an unknown status fails closed (pending)', core.questionStatus({ status: 'weird' }) === 'pending' && !core.questionIsLive({ status: 'weird' }));
ok('nothing is not live', !core.questionIsLive(null) && !core.questionIsLive(undefined));
ok('liveQuestions keeps only live, never mutates', (function () {
  var l = [q0, { id: 'Q2', status: 'pending' }, { id: 'Q3', status: 'live' }, { id: 'Q4', status: 'returned' }];
  var out = core.liveQuestions(l);
  return out.length === 2 && out[0].id === 'Q1' && out[1].id === 'Q3' && l.length === 4;
})());
ok('the serving pool holds back pending and returned questions', (function () {
  var l = [q0, { id: 'Q2', subject: 'Chemistry', status: 'pending' }, { id: 'Q4', subject: 'Chemistry', status: 'returned' }];
  var out = core.servablePool(l, []);
  return out.length === 1 && out[0].id === 'Q1';
})());

console.log('\nstamping a tutor question');
var st = core.stampTutorQuestion(q0, chem, { batch: 'IMP-1' }, T0);
ok('saved as pending with the author, name and time', st.rec && st.rec.status === 'pending' && st.rec.addedBy === 'GOC-T-001' && st.rec.addedByName === 'Mrs Ada Obi' && st.rec.addedAt === T0);
ok('an import batch is kept', st.rec && st.rec.batch === 'IMP-1');
ok('a typed question has no batch', !('batch' in core.stampTutorQuestion(q0, chem, {}, T0).rec));
ok('the original is not changed', q0.status === undefined && q0.addedBy === undefined);
ok('a Chemistry tutor cannot add Physics', /do not teach Physics/.test(core.stampTutorQuestion({ subject: 'Physics', text: 'x' }, chem, {}, T0).error || ''));
ok('a switched-off tutor cannot add', !!core.stampTutorQuestion(q0, { id: 'GOC-T-001', subjects: ['Chemistry'], active: false }, {}, T0).error);
ok('no tutor, no record: refused', !!core.stampTutorQuestion(q0, null, {}, T0).error && !!core.stampTutorQuestion(null, chem, {}, T0).error);
ok('a forged live status or review mark is overwritten', (function () {
  var r = core.stampTutorQuestion({ id: 'Q9', subject: 'Chemistry', status: 'live', reviewedBy: 'x', returnReason: 'y' }, chem, {}, T0).rec;
  return r.status === 'pending' && r.reviewedBy === undefined && r.returnReason === undefined;
})());
ok('a bad time falls back to now rather than breaking', /^\d{4}-/.test(core.stampTutorQuestion(q0, chem, {}, 'junk').rec.addedAt));

console.log('\nowning and editing');
var mine = st.rec;
ok('a tutor owns their own question', core.tutorOwnsQuestion(chem, mine));
ok('another tutor does not', !core.tutorOwnsQuestion(phys, mine));
ok('an admin-added question (no author) is not a tutor\'s', !core.tutorOwnsQuestion(chem, q0));
ok('a tutor moved off the subject loses it', !core.tutorOwnsQuestion({ id: 'GOC-T-001', subjects: ['Biology'], active: true }, mine));
var live = core.reviewQuestion(mine, 'approve', admin, '', T1).rec;
var ed = core.tutorEditQuestion(chem, live, { subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'Which of these is a strong acid?' }, T1);
ok('editing a live tutor question sends it back to pending', ed.rec && ed.rec.status === 'pending');
ok('the edit keeps id, author and first-added time', ed.rec && ed.rec.id === 'Q1' && ed.rec.addedBy === 'GOC-T-001' && ed.rec.addedAt === T0 && ed.rec.batch === 'IMP-1');
ok('the edit clears the old review marks', ed.rec && ed.rec.reviewedBy === undefined && ed.rec.reviewedAt === undefined);
ok('the new text is in', ed.rec && /Which of these/.test(ed.rec.text) && ed.rec.editedAt === T1);
ok('a returned question edited goes back to pending and loses the reason', (function () {
  var ret = core.reviewQuestion(mine, 'return', admin, 'Option C is also correct', T1).rec;
  var e = core.tutorEditQuestion(chem, ret, { subject: 'Chemistry', text: 'Fixed question text here' }, T1).rec;
  return e.status === 'pending' && e.returnReason === undefined;
})());
ok('another tutor cannot edit it', !!core.tutorEditQuestion(phys, live, { subject: 'Physics', text: 'xxxxxxxxx' }, T1).error);
ok('a tutor cannot edit an admin question', !!core.tutorEditQuestion(chem, q0, { subject: 'Chemistry', text: 'xxxxxxxxx' }, T1).error);
ok('a tutor cannot move their question into another subject', /do not teach Physics/.test(core.tutorEditQuestion(chem, live, { subject: 'Physics', text: 'xxxxxxxxx' }, T1).error || ''));
ok('an edit cannot smuggle a live status or another author', (function () {
  var e = core.tutorEditQuestion(chem, live, { subject: 'Chemistry', text: 'xxxxxxxxx', status: 'live', addedBy: 'GOC-T-002' }, T1).rec;
  return e.status === 'pending' && e.addedBy === 'GOC-T-001';
})());

console.log('\nreviewing');
var ap = core.reviewQuestion(mine, 'approve', admin, '', T1);
ok('approve makes it live and records who and when', ap.rec && ap.rec.status === 'live' && ap.rec.reviewedBy === 'Founder' && ap.rec.reviewedAt === T1);
ok('an approved question can be served', ap.rec && core.servablePool([ap.rec], []).length === 1);
var rt = core.reviewQuestion(mine, 'return', admin, '  Option C is also correct  ', T1);
ok('return needs a reason and keeps it trimmed', rt.rec && rt.rec.status === 'returned' && rt.rec.returnReason === 'Option C is also correct');
ok('a returned question is not served', rt.rec && core.servablePool([rt.rec], []).length === 0);
ok('return without a reason is refused', /Say why/.test(core.reviewQuestion(mine, 'return', admin, ' ', T1).error || ''));
ok('a very long reason is refused', !!core.reviewQuestion(mine, 'return', admin, new Array(400).join('a'), T1).error);
ok('an unknown decision is refused', /approve or return/.test(core.reviewQuestion(mine, 'publish', admin, '', T1).error || ''));
ok('a tutor cannot approve', /management/.test(core.reviewQuestion(mine, 'approve', { id: 'GOC-T-002', name: 'Mr Eze', role: 'tutor' }, '', T1).error || ''));
ok('a tutor cannot approve even without a role label if they are the author', !!core.reviewQuestion(mine, 'approve', { id: 'GOC-T-001', name: 'Mrs Ada Obi' }, '', T1).error);
ok('no reviewer is refused', !!core.reviewQuestion(mine, 'approve', null, '', T1).error);
ok('only a pending question can be reviewed', !!core.reviewQuestion(ap.rec, 'approve', admin, '', T1).error && !!core.reviewQuestion(q0, 'return', admin, 'reason here', T1).error);
ok('the pending original is not changed by a review', mine.status === 'pending' && mine.reviewedBy === undefined);

console.log('\napprove a whole import');
var imp = [1, 2, 3].map(function (n) { return core.stampTutorQuestion({ id: 'B' + n, subject: 'Chemistry', text: 'Question number ' + n }, chem, { batch: 'IMP-7' }, T0).rec; });
imp.push(core.stampTutorQuestion({ id: 'C1', subject: 'Chemistry', text: 'Another import entirely' }, chem, { batch: 'IMP-8' }, T0).rec);
imp[1] = core.reviewQuestion(imp[1], 'return', admin, 'Needs a clearer stem', T1).rec; /* already returned: skipped */
var ab = core.approveBatch(imp, 'IMP-7', admin, T1);
ok('every pending question in the batch is approved', ab.recs && ab.recs.length === 2 && ab.recs.every(function (r) { return r.status === 'live' && r.batch === 'IMP-7'; }));
ok('a question already returned is left alone and counted', ab.skipped === 1);
ok('another batch is untouched', ab.recs && ab.recs.every(function (r) { return r.id !== 'C1'; }));
ok('no batch given is refused', !!core.approveBatch(imp, '', admin, T1).error);
ok('a tutor cannot approve a batch', !!core.approveBatch(imp, 'IMP-7', { id: 'GOC-T-002', name: 'Mr Eze', role: 'tutor' }, T1).error);
ok('an unknown batch approves nothing', core.approveBatch(imp, 'IMP-99', admin, T1).recs.length === 0);

console.log('\nlists and counts');
var all = [q0,
  core.stampTutorQuestion({ id: 'P1', subject: 'Chemistry', text: 'older pending one' }, chem, {}, '2026-10-01T08:00:00.000Z').rec,
  core.stampTutorQuestion({ id: 'P2', subject: 'Physics', text: 'newer pending one' }, phys, {}, '2026-10-05T08:00:00.000Z').rec,
  core.stampTutorQuestion({ id: 'P3', subject: 'Chemistry', text: 'newest pending one' }, chem, {}, '2026-10-07T08:00:00.000Z').rec,
  core.reviewQuestion(core.stampTutorQuestion({ id: 'P4', subject: 'Chemistry', text: 'approved already' }, chem, {}, '2026-10-02T08:00:00.000Z').rec, 'approve', admin, '', T1).rec];
ok('the queue lists pending questions across subjects, oldest first', core.approvalQueue(all).map(function (q) { return q.id; }).join() === 'P1,P2,P3');
ok('the queue can be limited to one subject', core.approvalQueue(all, 'Chemistry').map(function (q) { return q.id; }).join() === 'P1,P3');
ok('the pending count matches the queue', core.pendingCount(all) === 3 && core.pendingCount([]) === 0 && core.pendingCount() === 0);
ok('a tutor sees only their own, in any status, newest first', core.tutorQuestions(all, chem).map(function (q) { return q.id; }).join() === 'P3,P4,P1');
ok('a tutor never sees another tutor\'s or the admin\'s', core.tutorQuestions(all, phys).map(function (q) { return q.id; }).join() === 'P2');
ok('last upload is the newest stamp for the subject', core.lastTutorUpload(all, 'Chemistry') === '2026-10-07T08:00:00.000Z' && core.lastTutorUpload(all, 'Physics') === '2026-10-05T08:00:00.000Z');
ok('no tutor upload gives blank', core.lastTutorUpload(all, 'Biology') === '' && core.lastTutorUpload([], 'Physics') === '');

console.log('\nfeeds the rest unchanged');
ok('the hardest-question ranking and depth count still ignore non-live questions', (function () {
  var d = core.subjectDepth([{ subject: 'Chemistry', section: 'objective' }, { subject: 'Chemistry', section: 'objective', status: 'pending' }], []);
  return d.filter(function (r) { return r.subject === 'Chemistry'; })[0].objective === 1;
})());

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
