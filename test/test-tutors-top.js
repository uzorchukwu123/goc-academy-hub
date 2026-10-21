/* test-tutors-top.js — Phase 3C, tutor top performers, slice 1: who tops the class (pure rules).
   node test/test-tutors-top.js */
'use strict';
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function S(id, extra) { var s = { id: id, name: 'Name ' + id, tier: 'goc', subjects: ['Chemistry'] }; for (var k in extra) s[k] = extra[k]; return s; }
function rows(n, right, subj) { var o = []; for (var i = 0; i < n; i++) o.push({ given: 1, isCorrect: i < right, subject: subj }); return o; }
function run(n, right, subj) { return { ts: Date.now(), subject: subj || 'Chemistry', review: rows(n, right, subj || 'Chemistry') }; }
function paper(id, pct, status, subj) { return { scholarId: id, subject: subj || 'Chemistry', status: status || 'marked', percent: pct }; }
function ids(l) { return l.map(function (r) { return r.id; }).join(','); }

console.log('\nthe two floors');
var t = core.tutorTopPerformers('Chemistry', [S('A'), S('B'), S('C')], {}, [paper('A', 80), paper('A', 60), paper('B', 90), paper('C', 50), paper('C', 70)]);
ok('2 marked papers is enough, 1 is not', ids(t.tests.items) === 'A,C' || ids(t.tests.items) === 'A,C', ids(t.tests.items));
ok('a student under the floor is counted as held back, never ranked', t.tests.hidden === 1 && !t.tests.items.some(function (x) { return x.id === 'B'; }));
ok('the average is the mean of the marked papers, one decimal', t.tests.items[0].average === 70 && t.tests.items[0].papers === 2);
var p = core.tutorTopPerformers('Chemistry', [S('A'), S('B'), S('C')], { A: [run(10, 9), run(10, 8)], B: [run(19, 19)], C: [run(20, 10)] }, []);
ok('20 answers is enough, 19 is not', ids(p.practice.items) === 'A,C' && p.practice.hidden === 1, ids(p.practice.items) + ' hidden ' + p.practice.hidden);
ok('percent right is correct over answered, across runs', p.practice.items[0].percent === 85 && p.practice.items[0].answers === 20 && p.practice.items[0].correct === 17);
ok('the floors are exposed and the result says them', core.TOP_MIN_PAPERS === 2 && core.TOP_MIN_ANSWERS === 20 && t.tests.minPapers === 2 && p.practice.minAnswers === 20);
ok('the two lists are separate: practice never feeds the test list, tests never feed practice', t.practice.items.length === 0 && p.tests.items.length === 0);

console.log('\nwhat is left out');
var o = core.tutorTopPerformers('Chemistry', [S('A')], { A: [{ ts: 1, subject: 'Chemistry', review: [{ given: null, isCorrect: false }].concat(rows(19, 19, 'Chemistry')) }] }, [paper('A', 90), paper('A', 90, 'awaiting-marking'), paper('A', 90, 'draft'), paper('A', null, 'marked'), paper('A', 90, 'marked', 'Physics')]);
ok('unanswered rows, unmarked and draft papers, missing scores and other subjects count for nothing', o.practice.items.length === 0 && o.practice.hidden === 1 && o.tests.items.length === 0 && o.tests.hidden === 1, JSON.stringify(o));
var ph = core.tutorTopPerformers('Chemistry', [S('A')], { A: [run(25, 25, 'Physics')] }, []);
ok('practice in another subject is not counted here', ph.practice.items.length === 0 && ph.practice.hidden === 0);
var rowSubj = core.tutorTopPerformers('Chemistry', [S('A')], { A: [{ ts: 1, subject: 'Physics', review: rows(20, 20, 'Chemistry') }] }, []);
ok('a row with its own subject beats the run\'s', rowSubj.practice.items.length === 1);
var z = core.tutorTopPerformers('Chemistry', [S('A')], {}, [paper('A', 0), paper('A', 0)]);
ok('a real score of 0 is ranked, not skipped', z.tests.items.length === 1 && z.tests.items[0].average === 0);

console.log('\nwho counts');
var w = core.tutorTopPerformers('Chemistry', [S('G'), S('O', { tier: 'open' }), S('D', { active: false }), S('PH', { subjects: ['Physics'] }), S('G', { name: 'Dup' }), S('NT', { tier: undefined })], { G: [run(20, 20)], O: [run(20, 20)], D: [run(20, 20)], PH: [run(20, 20)], NT: [run(20, 20)] }, [paper('G', 80), paper('G', 80), paper('O', 99), paper('O', 99), paper('D', 99), paper('D', 99)]);
ok('only GOC students taking the subject, not deactivated, once each', ids(w.practice.items) === 'G' && ids(w.tests.items) === 'G' && w.practice.items[0].name === 'Name G', JSON.stringify(w));
ok('no email, phone or hash in a row', !/e@x|0803|password|hash/i.test(JSON.stringify(core.tutorTopPerformers('Chemistry', [S('E', { email: 'e@x.com', phone: '0803', passwordHash: 'h' })], { E: [run(20, 20)] }, [paper('E', 5), paper('E', 5)]))));
var e = core.tutorTopPerformers('Chemistry', null, null, null);
ok('empty input gives two empty lists', e.tests.items.length === 0 && e.practice.items.length === 0 && e.tests.hidden === 0);

console.log('\nordering');
var ord = core.tutorTopPerformers('Chemistry', [S('1', { name: 'Bola' }), S('2', { name: 'Ada' }), S('3', { name: 'Chi' }), S('4', { name: 'Dayo' })], {}, [
  paper('1', 70), paper('1', 70), paper('2', 70), paper('2', 70), paper('3', 70), paper('3', 70), paper('3', 70), paper('4', 90), paper('4', 80)]);
ok('highest first; ties go to more papers, then name', ids(ord.tests.items) === '4,3,2,1', ids(ord.tests.items));
var ordP = core.tutorTopPerformers('Chemistry', [S('1', { name: 'Bola' }), S('2', { name: 'Ada' }), S('3', { name: 'Chi' })], { 1: [run(20, 10)], 2: [run(20, 10)], 3: [run(40, 20)] }, []);
ok('practice: ties go to more answers, then name', ids(ordP.practice.items) === '3,2,1', ids(ordP.practice.items));
var again = core.tutorTopPerformers('Chemistry', [S('4', { name: 'Dayo' }), S('3', { name: 'Chi' }), S('2', { name: 'Ada' }), S('1', { name: 'Bola' })], {}, [
  paper('1', 70), paper('1', 70), paper('2', 70), paper('2', 70), paper('3', 70), paper('3', 70), paper('3', 70), paper('4', 90), paper('4', 80)]);
ok('same order whatever order the students arrive in', ids(again.tests.items) === ids(ord.tests.items));
var snap = JSON.stringify([S('A')]), inp = [S('A')]; core.tutorTopPerformers('Chemistry', inp, {}, []);
ok('nothing passed in is changed', JSON.stringify(inp) === snap);

console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
