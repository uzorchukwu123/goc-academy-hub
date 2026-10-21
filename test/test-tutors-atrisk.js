/* test-tutors-atrisk.js — Phase 3C, tutor at-risk list, first half: who is at risk.
   node test/test-tutors-atrisk.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
var DAY = 86400000, NOW = Date.UTC(2026, 9, 8, 12, 0, 0);
function iso(daysAgo) { return new Date(NOW - daysAgo * DAY).toISOString(); }
function run(daysAgo, subj) { return { ts: NOW - daysAgo * DAY, subject: subj || 'Chemistry', review: [{ given: 1, isCorrect: true, subject: subj || 'Chemistry' }] }; }
function paper(id, daysAgo, pct, status, subj) { return { scholarId: id, subject: subj || 'Chemistry', status: status || 'marked', percent: pct, submittedAt: NOW - daysAgo * DAY }; }
function S(id, extra) { var s = { id: id, name: 'Name ' + id, tier: 'goc', subjects: ['Chemistry'], createdAt: iso(30) }; for (var k in extra) s[k] = extra[k]; return s; }
function find(rows, id) { for (var i = 0; i < rows.length; i++) if (rows[i].id === id) return rows[i]; return null; }

console.log('\ninactivity');
var r = core.tutorAtRisk('Chemistry',
  [S('A'), S('B'), S('C'), S('D')],
  { A: [run(7)], B: [run(6)], C: [run(0)], D: [run(20)] },
  [], NOW);
ok('7 days without activity is at risk', find(r, 'A') && find(r, 'A').reasons.join() === 'inactive' && find(r, 'A').daysInactive === 7);
ok('6 days is not', !find(r, 'B'));
ok('active today is not', !find(r, 'C'));
ok('20 days inactive shows 20', find(r, 'D') && find(r, 'D').daysInactive === 20);
ok('a test submission counts as activity',
  !find(core.tutorAtRisk('Chemistry', [S('A')], { A: [run(30)] }, [paper('A', 1, 80)], NOW), 'A'));
var dr = core.tutorAtRisk('Chemistry', [S('A', { createdAt: iso(30) })], { A: [run(10)] }, [paper('A', 1, null, 'draft')], NOW);
ok('a draft does not reset the inactivity clock', find(dr, 'A') && find(dr, 'A').daysInactive === 10);
ok('practice in another subject is not activity here',
  find(core.tutorAtRisk('Chemistry', [S('A')], { A: [run(0, 'Physics'), run(9)] }, [], NOW), 'A').daysInactive === 9);
ok('an unanswered row is not activity',
  find(core.tutorAtRisk('Chemistry', [S('A')], { A: [{ ts: NOW, subject: 'Chemistry', review: [{ given: null }] }, run(12)] }, [], NOW), 'A').daysInactive === 12);

console.log('\nnever started');
var n = core.tutorAtRisk('Chemistry', [S('N1', { createdAt: iso(7) }), S('N2', { createdAt: iso(6) }), S('N3', { createdAt: 'garbage' }), S('N4', { createdAt: undefined })], {}, [], NOW);
ok('joined 7 days ago and nothing done: at risk, never started', find(n, 'N1') && find(n, 'N1').never === true && find(n, 'N1').daysInactive === null && find(n, 'N1').reasons.join() === 'never-started');
ok('joined 6 days ago: not yet', !find(n, 'N2'));
ok('unreadable or missing join date is not flagged', !find(n, 'N3') && !find(n, 'N4'));

console.log('\nlow average (Web Tests only)');
var l = core.tutorAtRisk('Chemistry',
  [S('L1'), S('L2'), S('L3'), S('L4'), S('L5')],
  { L1: [run(0)], L2: [run(0)], L3: [run(0)], L4: [run(0)], L5: [run(0)] },
  [paper('L1', 3, 30), paper('L1', 1, 45),                 /* avg 37.5, last 45 */
   paper('L2', 2, 40),                                      /* exactly 40: not under */
   paper('L3', 2, 39.9),                                    /* under */
   paper('L4', 2, 10, 'awaiting-marking'),                  /* unmarked: ignored */
   paper('L5', 2, 10, 'marked', 'Physics')],                /* other subject: ignored */
  NOW);
ok('average under 40 is at risk with last score and average', find(l, 'L1') && find(l, 'L1').average === 37.5 && find(l, 'L1').lastScore === 45 && find(l, 'L1').papers === 2 && find(l, 'L1').reasons.join() === 'low-average');
ok('exactly 40 is not at risk', !find(l, 'L2'));
ok('39.9 is at risk', !!find(l, 'L3'));
ok('a paper awaiting marking is never guessed', !find(l, 'L4'));
ok('another subject\'s paper never counts', !find(l, 'L5'));
var lp = core.tutorAtRisk('Chemistry', [S('P')], { P: [{ ts: NOW, subject: 'Chemistry', review: [{ given: 1, isCorrect: false, subject: 'Chemistry' }, { given: 1, isCorrect: false, subject: 'Chemistry' }] }] }, [], NOW);
ok('weak practice alone never flags (Web Tests only)', !find(lp, 'P'));
var both = core.tutorAtRisk('Chemistry', [S('X')], { X: [run(9)] }, [paper('X', 9, 20)], NOW);
ok('inactive and low average gives both reasons', find(both, 'X') && find(both, 'X').reasons.join() === 'inactive,low-average');

console.log('\nwho counts');
var w = core.tutorAtRisk('Chemistry',
  [S('G'), S('O', { tier: 'open' }), S('D', { active: false }), S('PH', { subjects: ['Physics'] }), S('G', { name: 'Dup' })],
  {}, [], NOW);
ok('only GOC students taking the subject, not deactivated, once each', w.length === 1 && w[0].id === 'G' && w[0].name === 'Name G', JSON.stringify(w));
ok('no email, phone or hash in a row', (function () { var x = core.tutorAtRisk('Chemistry', [S('E', { email: 'e@x.com', phone: '0803', passwordHash: 'h' })], {}, [], NOW); return x.length === 1 && !/e@x|0803|"h"|password/i.test(JSON.stringify(x)); })());
ok('empty input gives an empty list', core.tutorAtRisk('Chemistry', null, null, null, NOW).length === 0);
ok('the two limits are exposed', core.ATRISK_INACTIVE_DAYS === 7 && core.ATRISK_LOW_AVERAGE === 40);

console.log('\nordering');
function R(id, name, d, avg, never) { return { id: id, name: name, daysInactive: d, never: !!never, lastScore: avg, average: avg, papers: avg === null ? 0 : 1, reasons: [] }; }
var rows = [R('1', 'Bola', 8, 35), R('2', 'Ada', 20, null), R('3', 'Chi', null, null, true), R('4', 'Dayo', 8, 20), R('5', 'Efe', 8, 20), R('6', 'Femi', 2, 10)];
var snapshot = JSON.stringify(rows);
function ids(l) { return l.map(function (r) { return r.id; }).join(','); }
ok('inactive order: never started, then most days, ties by lower average then name', ids(core.sortAtRisk(rows, 'inactive')) === '3,2,4,5,1,6', ids(core.sortAtRisk(rows, 'inactive')));
ok('score order: lowest average first, no average last', ids(core.sortAtRisk(rows, 'score')) === '6,4,5,1,3,2', ids(core.sortAtRisk(rows, 'score')));
ok('score ties go to the more inactive: never started before 20 days', ids(core.sortAtRisk([R('a', 'A', 5, null), R('b', 'B', 9, null), R('c', 'C', null, null, true)], 'score')) === 'c,b,a');
ok('unknown or missing mode behaves as inactive', ids(core.sortAtRisk(rows, 'whatever')) === ids(core.sortAtRisk(rows, 'inactive')) && ids(core.sortAtRisk(rows)) === ids(core.sortAtRisk(rows, 'inactive')));
ok('sorting never changes the input list', JSON.stringify(rows) === snapshot);
ok('same order every time (stable on ties)', ids(core.sortAtRisk(rows.slice().reverse(), 'inactive')) === ids(core.sortAtRisk(rows, 'inactive')) && ids(core.sortAtRisk(rows.slice().reverse(), 'score')) === ids(core.sortAtRisk(rows, 'score')));
ok('empty, null and junk rows are safe', core.sortAtRisk(null).length === 0 && core.sortAtRisk([null, {}, R('z', 'Z', 1, 1)]).length === 1);
var live = core.sortAtRisk(core.tutorAtRisk('Chemistry', [S('A'), S('B', { createdAt: iso(10) })], { A: [run(9)] }, [paper('A', 9, 20)], NOW), 'inactive');
ok('works on real rows from the rule (never started first)', live.length === 2 && live[0].id === 'B' && live[1].id === 'A');

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
