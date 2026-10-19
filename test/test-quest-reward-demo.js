/* test-quest-reward-demo.js — Phase 2, daily quest slice 5: the demo driver pays the
   quest reward the same way the server does. Loads the real
   js/goc-core.js and js/api.js.
   node test/test-quest-reward-demo.js  */
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
var R = core.QUEST_XP_REWARD, run5 = core.xpForPractice(5, 5);
console.log('\nDemo driver: quest reward');
var code = 'GOC2027';
activeStudent.demo(mock, { signupCode: code, name: 'Ada Reward', password: 'secret123', goal: 'JAMB / UTME 2027',
  subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }).then(function () {
  return sit(5);
}).then(function (r) {
  ok('unfinished quest: no bonus', r.questXp === 0 && !r.questClaimed && !r.questDone, JSON.stringify(r).slice(0, 300));
  return sit(5);
}).then(function (r) {
  ok('finishing it pays the bonus once', r.questDone && r.questClaimed && r.questXp === R, JSON.stringify(r).slice(0, 300));
  ok('xpTotal and allowance include the bonus', r.xpTotal === run5 * 2 + R && r.xpLeftToday === core.PRACTICE_XP_DAILY_CAP - run5 * 2 - R, JSON.stringify(r).slice(0, 300));
  return sit(5);
}).then(function (r) {
  ok('no second bonus the same day', r.questDone && !r.questClaimed && r.questXp === 0, JSON.stringify(r).slice(0, 300));
}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('THREW: ' + e.message);
  process.exit(1);
});
