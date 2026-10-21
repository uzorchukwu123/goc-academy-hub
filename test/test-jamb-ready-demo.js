/* test-jamb-ready-demo.js — Phase 3, JAMB mock slice 3: the demo driver and
   GOC.api apply the same depth bar the server does (catalogue, start, blueprint,
   setJambReadyMin). Loads the real js/goc-core.js and js/api.js.
   node test/test-jamb-ready-demo.js  */
'use strict';
var activeStudent = require('./active-student.js');
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var sandbox = {
  console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
var core = vm.runInContext('GOC.core', ctx);
var api = vm.runInContext('GOC.api', ctx);
var drivers = vm.runInContext('GOC.api._drivers', ctx);
var mock = drivers.mock;
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }
function jambRows(r) { return r.tests.filter(function (t) { return t.section === 'jamb'; }); }

var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var code = 'GOC2027';
var protos = {};

/* add n active jamb-pool questions to a subject through the console path */
function addJamb(subject, n) {
  var chain = Promise.resolve();
  for (var i = 0; i < n; i++) (function (k) {
    chain = chain.then(function () {
      var p = protos[subject];
      var d = JSON.parse(JSON.stringify(p));
      delete d.id; d.text = 'Extra ' + subject + ' ' + k + ' ' + Math.random(); d.active = true;
      return mock.createQuestion(d);
    });
  }(i));
  return chain;
}

console.log('\nDemo driver: JAMB sitting depth bar');
ok('GOC.api forwards setJambReadyMin', typeof api.setJambReadyMin === 'function');
ok('both drivers have it', typeof mock.setJambReadyMin === 'function' && typeof drivers.http.setJambReadyMin === 'function');

mock.login('GOC-A-001', 'founder2027').then(function () {
  return mock.unlockConsole('2027');
}).then(function () {
  return mock.listQuestions({});
}).then(function (res) {
  var qs = res.questions;
  COMBO.forEach(function (s) {
    protos[s] = qs.filter(function (q) { return q.section === 'jamb' && q.subject === s; })[0];
  });
  ok('the seed has a jamb question per subject to copy from', COMBO.every(function (s) { return !!protos[s]; }));

  head('the bar and the console report');
  return mock.getSettings();
}).then(function (st) {
  ok('the bar defaults to 20 and is in the settings', st.jambReadyMin === 20, st.jambReadyMin);
  return mock.jambBlueprint({});
}).then(function (bp) {
  ok('the blueprint carries the bar and a readiness report',
     bp.readyMin === 20 && bp.readiness && bp.readiness.ready === false && bp.readiness.min === 20, JSON.stringify(bp.readiness).slice(0, 200));
  ok('it names the subjects that are short, with how many more each needs',
     bp.readiness.short.length > 0 && bp.readiness.subjects.every(function (r) { return typeof r.need === 'number'; }));
  return mock.logout();
}).then(function () {
  return activeStudent.demo(mock, { signupCode: code, name: 'Dee Demo', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: COMBO });
}).then(function () {
  head('on the thin seed bank the sitting is held back');
  return mock.listMyTests();
}).then(function (r) {
  ok('no JAMB-oriented paper is listed', jambRows(r).length === 0, JSON.stringify(jambRows(r)));
  ok('the Objective sitting is unaffected', r.tests.some(function (t) { return t.section === 'objective'; }));
  return rejects(mock.startTest({ period: 'test', section: 'jamb', subject: 'All subjects' }));
}).then(function (m) {
  ok('starting it directly is refused, not just hidden', /not open yet/.test(m || ''), m);
  ok('and it says why in the same words as the server', /question bank is still being built/.test(m || ''), m);
  return mock.listMyTests();
}).then(function (r) {
  ok('the refusal opened nothing (catalogue unchanged)', jambRows(r).length === 0);
  return mock.logout();
}).then(function () {
  head('the bar belongs to the academy');
  return rejects(mock.setJambReadyMin(1));
}).then(function (m) {
  ok('signed out, the bar cannot be moved', /management|passcode/i.test(m || ''), m);
  return mock.login('GOC-A-001', 'founder2027');
}).then(function () { return rejects(mock.setJambReadyMin(1)); }
).then(function (m) {
  ok('a locked console cannot move it either', /passcode/i.test(m || ''), m);
  return mock.unlockConsole('2027');
}).then(function () {
  return mock.setJambReadyMin(9999);
}).then(function (st) {
  ok('an out-of-range bar is clamped to 40', st.jambReadyMin === 40, st.jambReadyMin);
  return mock.setJambReadyMin(0);
}).then(function (st) {
  ok('and a low one to 1', st.jambReadyMin === 1, st.jambReadyMin);
  return mock.setJambReadyMin(20);
}).then(function (st) {
  ok('the console can set it back to 20', st.jambReadyMin === 20);
  head('depth in every subject opens it — one subject short does not');
  return addJamb('Use of English', 25).then(function () { return addJamb('Chemistry', 25); }).then(function () { return addJamb('Mathematics', 25); });
}).then(function () {
  return mock.logout();
}).then(function () {
  return mock.login('GOC-A-001', 'founder2027');
}).then(function () {
  return mock.getSettings();
}).then(function () {
  /* sign the student back in via a fresh registration (the demo has no roster) */
  return mock.logout();
}).then(function () {
  return activeStudent.demo(mock, { signupCode: code, name: 'Eve Demo', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: COMBO });
}).then(function () {
  return mock.listMyTests();
}).then(function (r) {
  ok('three deep subjects and one thin one: still held back', jambRows(r).length === 0, JSON.stringify(jambRows(r)));
  return rejects(mock.startTest({ period: 'test', section: 'jamb' }));
}).then(function (m) {
  ok('and still refused at start', /not open yet/.test(m || ''), m);
  return mock.logout();
}).then(function () {
  return mock.login('GOC-A-001', 'founder2027');
}).then(function () { return mock.unlockConsole('2027'); }
).then(function () { return addJamb('Physics', 25); }
).then(function () { return mock.jambBlueprint({}); }
).then(function (bp) {
  ok('the console report turns ready for the subjects it covers',
     bp.readiness.subjects.filter(function (r) { return COMBO.indexOf(r.subject) > -1; }).every(function (r) { return r.ok; }));
  return mock.logout();
}).then(function () {
  return activeStudent.demo(mock, { signupCode: code, name: 'Fay Demo', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: COMBO });
}).then(function () {
  return mock.listMyTests();
}).then(function (r) {
  ok('once every subject is deep the sitting is listed, once', jambRows(r).length === 1 && jambRows(r)[0].durationSec > 0, JSON.stringify(jambRows(r)));
  return api.startTest({ period: 'test', section: 'jamb', subject: 'All subjects' });
}).then(function (p) {
  ok('through GOC.api it opens as a full timed paper', p && p.section === 'jamb' && p.durationSec > 0 && p.total > 0, JSON.stringify(p).slice(0, 160));
  return mock.logout();
}).then(function () {
  head('a raised bar hides it again');
  return mock.login('GOC-A-001', 'founder2027');
}).then(function () { return mock.unlockConsole('2027'); }
).then(function () { return api.setJambReadyMin(40); }
).then(function () { return mock.logout(); }
).then(function () {
  return activeStudent.demo(mock, { signupCode: code, name: 'Gus Demo', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: COMBO });
}).then(function () {
  return mock.listMyTests();
}).then(function (r) {
  ok('a bar above what the bank holds (26 deep < 40) closes the sitting', jambRows(r).length === 0, JSON.stringify(jambRows(r)));
  return rejects(mock.startTest({ period: 'test', section: 'jamb' }));
}).then(function (m) {
  ok('and start refuses again', /not open yet/.test(m || ''), m);
}).catch(function (e) {
  fails++; console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')');
}).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
});
