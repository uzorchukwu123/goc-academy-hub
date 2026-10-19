/* test-quest-demo.js — Phase 2, daily quest slice 3: getQuest on both drivers
   and GOC.api. The demo driver follows GET /api/me/quest. Loads the real
   js/goc-core.js and js/api.js.
   node test/test-quest-demo.js  */
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

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
var core = vm.runInContext('GOC.core', ctx);
var api = vm.runInContext('GOC.api', ctx);
var drivers = vm.runInContext('GOC.api._drivers', ctx);
var mock = drivers.mock;
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }

function rows(n, topic, correct) {
  var out = [];
  for (var i = 0; i < n; i++) out.push({ n: i + 1, topic: topic, text: 'Question ' + i + ' about ' + topic, options: ['a', 'b', 'c', 'd'], answer: 0, given: i < correct ? 0 : 1, isCorrect: i < correct, explanation: 'e' });
  return out;
}
function run(ts, review) { return { mode: 'practice', subject: 'Physics', total: review.length, answered: review.length, ts: ts, review: review }; }

console.log('\nDemo driver: daily quest');
ok('GOC.api forwards getQuest', typeof api.getQuest === 'function');
ok('both drivers have it', typeof mock.getQuest === 'function' && typeof drivers.http.getQuest === 'function');

rejects(mock.getQuest()).then(function (m) {
  ok('signed out: refused', /log in/i.test(m || ''), m);
  var code = 'GOC2027';
  return activeStudent.demo(mock, { signupCode: code, name: 'Ada Test', password: 'secret123',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
}).then(function () {
  return mock.getQuest();
}).then(function (r) {
  var q = r.quest;
  ok('a new student gets the plain daily goal', q && q.kind === 'any' && q.target === 10 && q.answered === 0 && !q.done, JSON.stringify(r));
  return mock.recordPractice(run(Date.now() - 36 * 3600 * 1000, rows(5, 'Motion', 1).concat(rows(5, 'Waves', 5))));
}).then(function () {
  return mock.getQuest();
}).then(function (r) {
  var q = r.quest;
  ok('after earlier practice the quest targets the weakest topic', q.kind === 'weak' && q.subject === 'Physics' && q.topic === 'Motion' && q.answered === 0, JSON.stringify(r));
  return mock.recordPractice(run(Date.now(), rows(4, 'Motion', 2)));
}).then(function () {
  return api.getQuest();
}).then(function (r) {
  var q = r.quest;
  ok("today's answers count, read through GOC.api", q.topic === 'Motion' && q.answered === 4 && q.remaining === 6 && !q.done, JSON.stringify(r));
}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('THREW: ' + e.message);
  process.exit(1);
});
