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
/* Clean sweep (Phase 2): the Objective and Theory sittings that rounds gate are
   retired for students, so the student half of this journey is now "no sitting
   opens, in any round". The console's round management and every stored round
   and attempt are kept (historical records), so the console half is unchanged. */
console.log('\nthe demo-driver journey: no new sitting opens; the console still manages rounds');
vm.runInContext('GOC.api._drivers.mock._setJambReadyMin(1)', ctx);
activeStudent.demo(mock, { signupCode: 'GOC2027', name: 'Ada Round', password: 'secret123',
  goal: 'JAMB / UTME 2027', subjects: COMBO }).then(function (r) {
  stuId = r.student.id;
  return rejects(mock.startTest({ period: 'test', section: 'objective', subject: 'All subjects' }));
}).then(function (m) {
  ok('an Objective sitting is refused as retired, in round 1', /have been retired/.test(m || ''), m);
  return mock.listMyTests();
}).then(function (r) {
  ok('the catalogue lists no retired Objective row', !row(r, 'objective'), JSON.stringify(row(r, 'objective')));
  /* The academy can still read and open rounds from the console. */
  return mock.login('GOC-A-001', 'founder2027');
}).then(function () { return mock.unlockConsole('2027'); }).then(function () {
  return mock.getRound('objective');
}).then(function (r) {
  ok('the console reads round 1 before opening, with a served count', r.round === 1 && typeof r.served === 'number', JSON.stringify(r));
  return mock.openRound('objective');
}).then(function (r) {
  ok('opening advances to round 2 and reports what would be served', r.opened === true && r.round === 2 && r.section === 'objective' && r.subject === core.OBJECTIVE_SUBJECT, JSON.stringify(r));
  return rejects(mock.openRound('practice'));
}).then(function (m) {
  ok('opening a round for a non-Web-Test section is refused', !!m, m);
  return mock.login(stuId, 'secret123');
}).then(function () {
  return rejects(mock.startTest({ period: 'test', section: 'objective', subject: 'All subjects' }));
}).then(function (m) {
  ok('a newly opened round does not bring the retired sitting back', /have been retired/.test(m || ''), m);
}).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.error('crashed:', e && e.stack || e);
  process.exit(1);
});
