/* test-sit-rules-demo.js — Phase 3, Web Test sit rules slice 4: the demo driver
   follows the same sit rules and catalogue fields as the server.
   node test/test-sit-rules-demo.js */
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
function sit(section) {
  return mock.startTest({ period: 'test', section: section, subject: 'All subjects' }).then(function (st) {
    return mock.submitTest({ attemptId: st.attemptId, responses: {} });
  });
}

vm.runInContext('GOC.api._drivers.mock._setJambReadyMin(1)', ctx);
activeStudent.demo(mock, { signupCode: 'GOC2027', name: 'Ada Demo', password: 'secret123',
  goal: 'JAMB / UTME 2027', subjects: COMBO }).then(function (r) {
  vm.runInContext('GOC.api._drivers.mock._setTier', ctx)(r.student.id, 'goc');   // Objective is for GOC students
  return mock.listMyTests();
}).then(function (r) {
  var j = row(r, 'jamb'), o = row(r, 'objective');
  ok('a fresh JAMB row is open, repeatable, 0 attempts', j && j.completed === false && j.repeatable === true && j.attempts === 0, JSON.stringify(j));
  ok('a fresh Objective row is open, not repeatable', o && o.completed === false && o.repeatable === false && o.attempts === 0, JSON.stringify(o));
  return sit('jamb');
}).then(function () { return sit('jamb'); }).then(function () {
  ok('two JAMB sittings opened and submitted', true);
  return mock.listMyTests();
}).then(function (r) {
  var j = row(r, 'jamb');
  ok('JAMB stays open and counts 2 attempts', j.completed === false && j.attempts === 2, JSON.stringify(j));
  return mock.myResults();
}).then(function (r) {
  var js = (r.attempts || []).filter(function (a) { return a.section === 'jamb'; });
  ok('the demo results carry the /400 score on JAMB-oriented rows', js.length === 2 && js.every(function (a) { return a.jambScore && a.jambScore.max === 400; }), JSON.stringify(js.map(function (a) { return a.jambScore; })).slice(0, 160));
  return sit('objective');
}).then(function () {
  return rejects(mock.startTest({ period: 'test', section: 'objective', subject: 'All subjects' }));
}).then(function (m) {
  ok('a second Objective sitting is refused, in the server\'s words', /cannot be sat again/.test(m || ''), m);
  return mock.listMyTests();
}).then(function (r) {
  var o = row(r, 'objective');
  ok('Objective now reads completed with 1 attempt', o.completed === true && o.repeatable === false && o.attempts === 1, JSON.stringify(o));
  return mock.myResults();
}).then(function (r) {
  var n = (r.attempts || []).filter(function (a) { return a.section === 'jamb'; }).length;
  ok('both JAMB attempts are kept on the record', n === 2, String(n));
}).catch(function (e) { fails++; console.log('  FAIL  crashed   (' + (e && e.stack || e) + ')'); }).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
});
