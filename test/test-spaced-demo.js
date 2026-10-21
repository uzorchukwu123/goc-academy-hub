/* test-spaced-demo.js — Phase 2, spaced repetition slice 3: listReview / answerReview on
   both drivers and GOC.api, and the demo driver scheduling and judging the way the
   server does. Loads the real js/goc-core.js and js/api.js.
   node test/test-spaced-demo.js  */
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

var json = function (x) { return JSON.stringify(x).slice(0, 400); };
var DAY = 86400000;
function run(ts, texts) {
  return { mode: 'practice', subject: 'Physics', total: texts.length, answered: texts.length, ts: ts,
    review: texts.map(function (t) { return { topic: 'Waves', given: 0, isCorrect: false, text: t, options: ['a', 'b', 'c', 'd'], answer: 3, explanation: 'because' }; }) };
}
console.log('\nDemo driver: spaced repetition');
ok('GOC.api forwards listReview and answerReview', typeof api.listReview === 'function' && typeof api.answerReview === 'function');
ok('both drivers have both', ['listReview', 'answerReview'].every(function (m) { return typeof mock[m] === 'function' && typeof drivers.http[m] === 'function'; }));
var code = 'GOC2027';
var keyA, keyB;
rejects(mock.listReview()).then(function (m) {
  ok('signed out: listing refused', /log in/i.test(m || ''), m);
  return rejects(mock.answerReview('abc', 0));
}).then(function (m) {
  ok('signed out: answering refused', /log in/i.test(m || ''), m);
  return activeStudent.demo(mock, { signupCode: code, name: 'Sam Spaced', password: 'secret123', goal: 'JAMB / UTME 2027',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
}).then(function () {
  return mock.listReview();
}).then(function (r) {
  ok('a new student has nothing due', r.review.dueCount === 0 && r.review.due.length === 0 && r.review.nextDue === null, json(r));
  return mock.recordPractice(run(Date.now() - 3 * DAY, ['Old A', 'Old B']));
}).then(function () {
  return mock.recordPractice(run(Date.now(), ['Fresh C']));
}).then(function () {
  return mock.listReview();
}).then(function (r) {
  var q = r.review;
  ok('two old mistakes are due, the fresh one waits', q.dueCount === 2 && q.upcoming === 1, json(r));
  keyA = q.due[0].key; keyB = q.due[1].key;
  return mock.answerReview(keyA, 3);
}).then(function (r) {
  ok('right answer: judged here, box 1, about 3 days', r.correct === true && r.box === 1 && r.mastered === false && r.nextDue > Date.now() + 3 * DAY - 60000 && r.nextDue < Date.now() + 3 * DAY + 60000, json(r));
  ok('it reports the answer and what is left', r.answer === 3 && r.explanation === 'because' && r.dueCount === 1 && r.upcoming === 2, json(r));
  return mock.answerReview(keyB, 0);
}).then(function (r) {
  ok('wrong answer: box 0, a day', r.correct === false && r.box === 0 && r.answer === 3, json(r));
  return mock.listReview();
}).then(function (r) {
  ok('nothing left due', r.review.dueCount === 0 && r.review.upcoming === 3, json(r));
  return rejects(mock.answerReview(keyA, 9));
}).then(function (m) {
  ok('an option that does not exist is refused', /answer options/i.test(m || ''), m);
  return rejects(mock.answerReview(keyA, '3'));
}).then(function (m) {
  ok('a non-number answer is refused', /answer options/i.test(m || ''), m);
  return rejects(mock.answerReview('nosuchkey', 1));
}).then(function (m) {
  ok('an unknown question is refused', /not in your mistakes/i.test(m || ''), m);
  return rejects(mock.answerReview('../x', 1));
}).then(function (m) {
  ok('a malformed key is refused', /which question/i.test(m || ''), m);
  return api.listReview();
}).then(function (r) {
  ok('GOC.api reaches the active driver', r && r.review && r.review.upcoming === 3, json(r));
}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) { console.log('THREW: ' + e.message); process.exit(1); });
