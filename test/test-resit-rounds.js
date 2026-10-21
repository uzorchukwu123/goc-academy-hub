/* test-resit-rounds.js — Phase 3E.B: Web Test "rounds".
   The academy opens a new round when it publishes a fresh Web Test; the one-sit
   rule counts only the current round, so finishing one round never blocks the
   next, and every earlier result stays on the record.
   Pure rule + a whole demo-driver journey. node test/test-resit-rounds.js */
'use strict';
var activeStudent = require('./active-student.js');
var fs = require('fs'), path = require('path'), vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var sandbox = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f }); });
var core = vm.runInContext('GOC.core', ctx);
var mock = vm.runInContext('GOC.api._drivers', ctx).mock;
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }
function row(r, sec) { return r.tests.filter(function (t) { return t.section === sec; })[0]; }

console.log('\nthe pure rule: canSit counts only the current round');
ok('round defaults to 1; one objective attempt in round 1 closes it',
   core.canSit('objective', [], 1).allowed === true
   && core.canSit('objective', [{ section: 'objective' }], 1).allowed === false);
ok('an attempt with no roundId counts as round 1 (nothing existing changes)',
   core.attemptRound({}) === 1 && core.attemptRound({ roundId: 0 }) === 1 && core.attemptRound({ roundId: 3 }) === 3);
ok('a finished round 1 does NOT block round 2',
   core.canSit('objective', [{ section: 'objective', roundId: 1 }], 2).allowed === true);
ok('once round 2 has an attempt, round 2 is closed too',
   core.canSit('objective', [{ section: 'objective', roundId: 1 }, { section: 'objective', roundId: 2 }], 2).allowed === false);
ok('theory behaves the same; JAMB-oriented always repeats',
   core.canSit('theory', [{ section: 'theory', roundId: 1 }], 1).allowed === false
   && core.canSit('theory', [{ section: 'theory', roundId: 1 }], 2).allowed === true
   && core.canSit('jamb', [{ section: 'jamb', roundId: 1 }], 1).allowed === true);
ok('old two-argument calls are unchanged (round defaults to 1)',
   core.canSit('objective', [{ section: 'objective' }]).allowed === false
   && core.canSit('objective', []).allowed === true);
ok('an unknown section is still refused', core.canSit('practice', [], 1).reason === 'unknown');

var stuId = null;
console.log('\nthe demo-driver journey: sit, open a new round, sit again');
vm.runInContext('GOC.api._drivers.mock._setJambReadyMin(1)', ctx);
activeStudent.demo(mock, { signupCode: 'GOC2027', name: 'Ada Round', password: 'secret123',
  goal: 'JAMB / UTME 2027', subjects: COMBO }).then(function (r) {
  stuId = r.student.id;
  vm.runInContext('GOC.api._drivers.mock._setTier', ctx)(stuId, 'goc');   // Objective is for GOC students
  return mock.startTest({ period: 'test', section: 'objective', subject: 'All subjects' });
}).then(function (st) {
  return mock.submitTest({ attemptId: st.attemptId, responses: {} });
}).then(function () {
  return rejects(mock.startTest({ period: 'test', section: 'objective', subject: 'All subjects' }));
}).then(function (m) {
  ok('a second Objective sitting in the same round is refused', /cannot be sat again/.test(m || ''), m);
  return mock.listMyTests();
}).then(function (r) {
  var o = row(r, 'objective');
  ok('the catalogue shows Objective completed, 1 attempt, round 1', o.completed === true && o.attempts === 1 && o.round === 1, JSON.stringify(o));
  /* The academy opens a new round from the console. */
  return mock.login('GOC-A-001', 'founder2027');
}).then(function () { return mock.unlockConsole('2027'); }).then(function () {
  return mock.getRound('objective');
}).then(function (r) {
  ok('the console reads round 1 before opening, with a served count', r.round === 1 && typeof r.served === 'number', JSON.stringify(r));
  return mock.openRound('objective');
}).then(function (r) {
  ok('opening advances to round 2 and reports what would be served', r.opened === true && r.round === 2 && r.section === 'objective' && r.subject === core.OBJECTIVE_SUBJECT, JSON.stringify(r));
  ok('an unknown section cannot open a round', true);
  return rejects(mock.openRound('practice'));
}).then(function (m) {
  ok('opening a round for a non-Web-Test section is refused', !!m, m);
  /* Back to the student. */
  return mock.login(stuId, 'secret123');
}).then(function () {
  return mock.listMyTests();
}).then(function (r) {
  var o = row(r, 'objective');
  ok('after the new round, Objective is open again with 0 attempts this round', o.completed === false && o.attempts === 0 && o.round === 2, JSON.stringify(o));
  return mock.startTest({ period: 'test', section: 'objective', subject: 'All subjects' });
}).then(function (st) {
  ok('the student can start the newly opened round', !!st.attemptId, JSON.stringify(st).slice(0, 120));
  return mock.submitTest({ attemptId: st.attemptId, responses: {} });
}).then(function () {
  return mock.myResults();
}).then(function (r) {
  var objs = (r.attempts || []).filter(function (a) { return a.section === 'objective'; });
  ok('both rounds are kept on the record (performance/league unchanged)', objs.length === 2, 'objective attempts: ' + objs.length);
  return mock.listMyTests();
}).then(function (r) {
  var o = row(r, 'objective');
  ok('round 2 is now closed too, counting 1 attempt this round', o.completed === true && o.attempts === 1 && o.round === 2, JSON.stringify(o));
}).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.error('crashed:', e && e.stack || e);
  process.exit(1);
});
