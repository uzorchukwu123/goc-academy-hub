/* test-tutor-marking-rules.js — Phase 3C slice 6.6: the pure rules for tutor theory marking and the
   admin alert list.   node test/test-tutor-marking-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }

var chem = { id: 'GOC-T-001', name: 'Ada Obi', subjects: ['Chemistry'], active: true };
var phys = { id: 'GOC-T-002', name: 'Eze', subjects: ['Physics'], active: true };
var NOW = Date.UTC(2026, 9, 8, 10, 0, 0);
function script(over) {
  return Object.assign({ id: 'a1', scholarId: 'GOC-S-001', studentName: 'Gina', section: 'theory', subject: 'Chemistry', period: 'weekly',
    submittedAt: 1, status: 'awaiting-marking', score: null, maxScore: 20, percent: null,
    answers: [
      { questionId: 1, kind: 'theory', topic: 'Acids', given: 'x', markAwarded: null, maxMark: 10 },
      { questionId: 2, kind: 'theory', topic: 'Acids', given: 'y', markAwarded: 4, maxMark: 10 },
      { questionId: 3, kind: 'objective', topic: 'Acids', given: 1, isCorrect: true, markAwarded: 1, maxMark: 1 }
    ] }, over || {});
}

console.log('\nwho may mark which script');
ok('a tutor may mark any theory script in their subject, marked or not', core.tutorMayMarkScript(chem, script()).ok && core.tutorMayMarkScript(chem, script({ status: 'marked' })).ok);
ok('not another subject', /do not teach Physics/.test(core.tutorMayMarkScript(chem, script({ subject: 'Physics' })).error));
ok('not an objective paper', !!core.tutorMayMarkScript(chem, script({ section: 'objective' })).error);
ok('not when switched off', !!core.tutorMayMarkScript(Object.assign({}, chem, { active: false }), script()).error);
ok('not with nothing to mark, or no tutor', !!core.tutorMayMarkScript(chem, null).error && !!core.tutorMayMarkScript(null, script()).error);
ok('a tutor who teaches two subjects may mark both', core.tutorMayMarkScript({ id: 'T', name: 'T', subjects: ['Chemistry', 'Physics'], active: true }, script({ subject: 'Physics' })).ok);

console.log('\nwhat a tutor is shown');
var sum = core.tutorScriptSummary(script());
ok('written answers only are counted, with how many have a mark', sum.written === 2 && sum.marked === 1, JSON.stringify(sum));
ok('it carries no answer text or reference answer', sum.answers === undefined && sum.expected === undefined);

console.log('\nthe alert');
var done = script({ status: 'marked', score: 14, percent: 70 });
var al = core.makeMarkAlert(chem, done, false, NOW);
ok('it names the tutor, subject, script and time', al.tutorId === 'GOC-T-001' && al.tutorName === 'Ada Obi' && al.subject === 'Chemistry' && al.attemptId === 'a1' && al.scholarId === 'GOC-S-001' && al.at === '2026-10-08T10:00:00.000Z');
ok('it carries the mark so the admin can judge it without opening the script', al.score === 14 && al.maxScore === 20 && al.percent === 70);
ok('it starts unseen, and says whether this was a change to a marked script', al.seen === false && al.changed === false && core.makeMarkAlert(chem, done, true, NOW).changed === true);

console.log('\nthe alert list');
var l1 = core.addAlert([], Object.assign({ id: 'AL-1' }, al));
ok('an alert is added', l1.length === 1 && l1[0].id === 'AL-1');
var again = Object.assign({ id: 'AL-2' }, core.makeMarkAlert(phys, Object.assign({}, done, { percent: 80, score: 16 }), true, NOW + 60000));
var l2 = core.addAlert(l1, again);
ok('a second save on a script with an unseen alert updates it in place', l2.length === 1 && l2[0].id === 'AL-1' && l2[0].percent === 80 && l2[0].tutorId === 'GOC-T-002' && l2[0].changed === true, JSON.stringify(l2));
ok('the list given is not changed', l1[0].percent === 70);
var other = core.addAlert(l2, Object.assign({ id: 'AL-3' }, core.makeMarkAlert(chem, script({ id: 'a2', status: 'marked', score: 10, percent: 50 }), false, NOW + 120000)));
ok('another script gets its own alert', other.length === 2);
ok('unseen alerts come newest first', core.unseenAlerts(other).map(function (a) { return a.id; }).join() === 'AL-3,AL-1');
var sn = core.markAlertSeen(other, 'AL-3', 'GOC-A-001', NOW + 180000);
ok('Seen records who and when, and the alert leaves the unseen list', sn.alert.seen === true && sn.alert.seenBy === 'GOC-A-001' && core.unseenAlerts(sn.list).map(function (a) { return a.id; }).join() === 'AL-1');
ok('Seen twice is harmless and keeps the first record', core.markAlertSeen(sn.list, 'AL-3', 'GOC-A-009', NOW + 999999).alert.seenBy === 'GOC-A-001');
ok('an unknown alert is refused', !!core.markAlertSeen(sn.list, 'AL-99', 'x', NOW).error);
var reopened = core.addAlert(sn.list, Object.assign({ id: 'AL-4' }, core.makeMarkAlert(chem, script({ id: 'a2', status: 'marked', score: 12, percent: 60 }), true, NOW + 240000)));
ok('a save after the admin has seen the old alert raises a fresh one', core.unseenAlerts(reopened).length === 2 && core.unseenAlerts(reopened)[0].id === 'AL-4');
var many = [], i;
for (i = 0; i < 130; i++) many.push({ id: 'S' + i, kind: 'tutor-mark', attemptId: 's' + i, seen: true, seenAt: new Date(NOW + i * 1000).toISOString(), at: 'x' });
many.push({ id: 'U1', kind: 'tutor-mark', attemptId: 'u1', seen: false, at: 'y' });
var trimmed = core.addAlert(many, Object.assign({ id: 'U2' }, al));
ok('old seen alerts are trimmed, unseen ones never', trimmed.filter(function (a) { return a.seen; }).length === 100 && core.unseenAlerts(trimmed).length === 2);
ok('the newest seen ones are the ones kept', trimmed.some(function (a) { return a.id === 'S129'; }) && !trimmed.some(function (a) { return a.id === 'S0'; }));

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
