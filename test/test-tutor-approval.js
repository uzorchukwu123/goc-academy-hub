/* test-tutor-approval.js — the tutor-question ownership and authorship rules (pure).
   The approval queue this suite was written for was retired in the Phase 1 sweep: a
   tutor's question is live as soon as it is saved. What is left to check here is the
   part that still runs — who may author and edit what, and how an edit is stamped —
   plus the one thing the retirement must not break: a row a tutor saved BEFORE the
   sweep that still says 'pending' or 'returned' must stay off students' papers.
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
ok('saved as live, with the author, name and time', st.rec && st.rec.status === 'live' && st.rec.addedBy === 'GOC-T-001' && st.rec.addedByName === 'Mrs Ada Obi' && st.rec.addedAt === T0);
ok('an import batch is kept', st.rec && st.rec.batch === 'IMP-1');
ok('a typed question has no batch', !('batch' in core.stampTutorQuestion(q0, chem, {}, T0).rec));
ok('the original is not changed', q0.status === undefined && q0.addedBy === undefined);
ok('a Chemistry tutor cannot add Physics', /do not teach Physics/.test(core.stampTutorQuestion({ subject: 'Physics', text: 'x' }, chem, {}, T0).error || ''));
ok('a switched-off tutor cannot add', !!core.stampTutorQuestion(q0, { id: 'GOC-T-001', subjects: ['Chemistry'], active: false }, {}, T0).error);
ok('no tutor, no record: refused', !!core.stampTutorQuestion(q0, null, {}, T0).error && !!core.stampTutorQuestion(null, chem, {}, T0).error);
ok('a forged status, review mark or return reason is overwritten', (function () {
  var r = core.stampTutorQuestion({ id: 'Q9', subject: 'Chemistry', status: 'pending', reviewedBy: 'x', returnReason: 'y' }, chem, {}, T0).rec;
  return r.status === 'live' && r.reviewedBy === undefined && r.returnReason === undefined;
})());
ok('a bad time falls back to now rather than breaking', /^\d{4}-/.test(core.stampTutorQuestion(q0, chem, {}, 'junk').rec.addedAt));

console.log('\nowning and editing');
var mine = st.rec;
ok('a tutor owns their own question', core.tutorOwnsQuestion(chem, mine));
ok('another tutor does not', !core.tutorOwnsQuestion(phys, mine));
ok('an admin-added question (no author) is not a tutor\'s', !core.tutorOwnsQuestion(chem, q0));
ok('a tutor moved off the subject loses it', !core.tutorOwnsQuestion({ id: 'GOC-T-001', subjects: ['Biology'], active: true }, mine));
var live = mine;
var ed = core.tutorEditQuestion(chem, live, { subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'Which of these is a strong acid?' }, T1);
ok('editing a tutor question leaves it live, straight on the paper', ed.rec && ed.rec.status === 'live');
ok('the edit keeps id, author and first-added time', ed.rec && ed.rec.id === 'Q1' && ed.rec.addedBy === 'GOC-T-001' && ed.rec.addedAt === T0 && ed.rec.batch === 'IMP-1');
ok('the edit clears the old review marks', ed.rec && ed.rec.reviewedBy === undefined && ed.rec.reviewedAt === undefined);
ok('the new text is in', ed.rec && /Which of these/.test(ed.rec.text) && ed.rec.editedAt === T1);
ok('a legacy returned row edited goes back live and loses the old reason', (function () {
  var ret = { id: 'Q1', subject: 'Chemistry', status: 'returned', returnReason: 'Option C is also correct', addedBy: 'GOC-T-001' };
  var e = core.tutorEditQuestion(chem, ret, { subject: 'Chemistry', text: 'Fixed question text here' }, T1).rec;
  return e.status === 'live' && e.returnReason === undefined;
})());
ok('another tutor cannot edit it', !!core.tutorEditQuestion(phys, live, { subject: 'Physics', text: 'xxxxxxxxx' }, T1).error);
ok('a tutor cannot edit an admin question', !!core.tutorEditQuestion(chem, q0, { subject: 'Chemistry', text: 'xxxxxxxxx' }, T1).error);
ok('a tutor cannot move their question into another subject', /do not teach Physics/.test(core.tutorEditQuestion(chem, live, { subject: 'Physics', text: 'xxxxxxxxx' }, T1).error || ''));
ok('an edit cannot smuggle a held-back status or another author', (function () {
  var e = core.tutorEditQuestion(chem, live, { subject: 'Chemistry', text: 'xxxxxxxxx', status: 'pending', addedBy: 'GOC-T-002' }, T1).rec;
  return e.status === 'live' && e.addedBy === 'GOC-T-001';
})());

console.log('\nrows left behind by the retired queue');
var legacyPending = { id: 'L1', subject: 'Chemistry', text: 'left pending', status: 'pending', addedBy: 'GOC-T-001' };
var legacyReturned = { id: 'L2', subject: 'Chemistry', text: 'left returned', status: 'returned', addedBy: 'GOC-T-001' };
ok('a row left pending is not live, so no student is served it',
   !core.questionIsLive(legacyPending) && core.servablePool([legacyPending], []).length === 0);
ok('a row left returned is not live either',
   !core.questionIsLive(legacyReturned) && core.servablePool([legacyReturned], []).length === 0);
ok('the live pool really does drop them while keeping a live row',
   core.servablePool([legacyPending, legacyReturned, live], []).length === 1);
ok('there is no reviewer or return reason left to read anywhere', (function () {
  var r = core.stampTutorQuestion(q0, chem, {}, T0).rec;
  return r.reviewedBy === undefined && r.reviewedAt === undefined && r.returnReason === undefined;
})());

console.log('\nlists and counts');
var all = [q0,
  core.stampTutorQuestion({ id: 'P1', subject: 'Chemistry', text: 'older one' }, chem, {}, '2026-10-01T08:00:00.000Z').rec,
  core.stampTutorQuestion({ id: 'P2', subject: 'Physics', text: 'newer one' }, phys, {}, '2026-10-05T08:00:00.000Z').rec,
  core.stampTutorQuestion({ id: 'P3', subject: 'Chemistry', text: 'newest one' }, chem, {}, '2026-10-07T08:00:00.000Z').rec,
  core.stampTutorQuestion({ id: 'P4', subject: 'Chemistry', text: 'second oldest' }, chem, {}, '2026-10-02T08:00:00.000Z').rec];
ok('a tutor sees only their own, newest first', core.tutorQuestions(all, chem).map(function (q) { return q.id; }).join() === 'P3,P4,P1');
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
