/* test-quest-weekly-demo.js — Phase 2, weekly quest slice 4: getWeeklyQuest on both drivers
   and GOC.api, and the demo driver counting the week and paying the freeze the
   way the server does. Loads the real
   js/goc-core.js and js/api.js.
   node test/test-quest-weekly-demo.js  */
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

function sit(count) {
  return mock.startStudy({ mode: 'practice', subject: 'Physics', count: count }).then(function (h) {
    var responses = {};
    h.questions.forEach(function (q) { responses[q.id] = q.answer; });
    return mock.submitStudy({ paperId: h.paperId, responses: responses }).then(function (sub) {
      return mock.recordPractice({ mode: 'practice', subject: 'Physics', total: sub.total, answered: sub.answered, ts: Date.now(),
        review: sub.review.map(function (q) { return { topic: q.topic, given: q.given, isCorrect: q.isCorrect, text: q.text, options: q.options, answer: q.answer }; }) }).then(function () { return sub; });
    });
  });
}
var json = function (x) { return JSON.stringify(x).slice(0, 400); };
console.log('\nDemo driver: weekly quest');
ok('GOC.api forwards getWeeklyQuest', typeof api.getWeeklyQuest === 'function');
ok('both drivers have it', typeof mock.getWeeklyQuest === 'function' && typeof drivers.http.getWeeklyQuest === 'function');
var code = 'GOC2027';
rejects(mock.getWeeklyQuest()).then(function (m) {
  ok('signed out: refused', /log in/i.test(m || ''), m);
  return activeStudent.demo(mock, { signupCode: code, name: 'Wen Weekly', password: 'secret123', goal: 'JAMB / UTME 2027',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
}).then(function () {
  return mock.getWeeklyQuest();
}).then(function (r) {
  var q = r.weeklyQuest;
  ok('a new student starts the week empty', q && q.week === core.weekStart() && q.days === 0 && q.questions === 0 && !q.done && !q.claimed && r.streakFreezes === 0, json(r));
  return sit(7);
}).then(function (r) {
  /* the demo bank holds 7 practice questions per subject, so a run is 7 */
  var n = r.total;
  ok('the run is counted; the daily quest (10) is not finished yet', r.weekQuest.questions === n && r.weekQuest.days === 0 && r.questClaimed === false, json(r.weekQuest));
  return sit(7);
}).then(function (r) {
  ok('finishing the daily quest adds one day', r.questClaimed === true && r.weekQuest.days === 1 && r.weekQuest.questions === 2 * r.total, json(r.weekQuest));
  ok('nothing is paid yet', r.weekClaimed === false && r.freezeAwarded === 0 && r.streakFreezes === 0, json(r));
  return sit(7);
}).then(function (r) {
  ok('a third run the same day adds questions but not a day', r.weekQuest.days === 1 && r.weekQuest.questions === 3 * r.total, json(r.weekQuest));
  return mock.getWeeklyQuest();
}).then(function (r) {
  ok('the getter agrees', r.weeklyQuest.days === 1 && r.weeklyQuest.questions === 3 * 7, json(r));
  var paid = null, runs = 0;
  function next() {
    return sit(7).then(function (x) {
      runs++;
      if (x.weekClaimed) paid = x;
      if (!paid && runs < 20) return next();
    });
  }
  return next().then(function () {
    ok('a hundred questions finish it and pay one freeze', paid && paid.weekQuest.done && paid.weekQuest.questions >= 100 && paid.weekQuest.byQuestions && paid.freezeAwarded === 1 && paid.streakFreezes === 1 && paid.weekQuest.claimed, json(paid));
    ok('it was paid on the run that crossed 100', paid && paid.weekQuest.questions - paid.total < 100, json(paid));
    return mock.myProfile();
  });
}).then(function (p) {
  ok('the profile holds the freeze', p.streakFreezes === 1, json(p));
  return sit(7);
}).then(function (r) {
  ok('no second freeze in the same week', r.weekClaimed === false && r.freezeAwarded === 0 && r.streakFreezes === 1 && r.weekQuest.claimed, json(r));
  return mock.startStudy({ mode: 'cbt', subject: 'Physics', count: 5, minutes: 10 });
}).then(function (h) {
  return mock.submitStudy({ paperId: h.paperId, responses: {} });
}).then(function (r) {
  ok('a CBT set-up run leaves the week alone', r.weekQuest === null && r.freezeAwarded === 0, json(r));
}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('THREW: ' + e.message);
  process.exit(1);
});
