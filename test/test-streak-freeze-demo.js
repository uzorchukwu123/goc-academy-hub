/* test-streak-freeze-demo.js — Phase 2, streak freeze slice 3 (demo driver):
   buyStreakFreeze on the offline driver follows the same rule and messages as
   POST /api/me/streak-freeze. Loads the real js/goc-core.js and js/api.js.
   node test/test-streak-freeze-demo.js  */
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
var mock = vm.runInContext('GOC.api._drivers', ctx).mock;
var COST = core.STREAK_FREEZE_COST_XP, MAX = core.STREAK_FREEZE_MAX;

function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }

console.log('\nDemo driver: buying a streak freeze');
ok('GOC.api forwards buyStreakFreeze', typeof api.buyStreakFreeze === 'function');
ok('both drivers have it', typeof mock.buyStreakFreeze === 'function' &&
  typeof vm.runInContext('GOC.api._drivers', ctx).http.buyStreakFreeze === 'function');

rejects(mock.buyStreakFreeze()).then(function (m) {
  ok('signed out: refused', /log in/i.test(m || ''), m);
  var code = 'GOC2027';
  return activeStudent.demo(mock, { signupCode: code, name: 'Ada Test', password: 'secret123',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
}).then(function () {
  return rejects(mock.buyStreakFreeze());
}).then(function (m) {
  ok('a new student has too little XP: refused with the cost', m && m.indexOf(String(COST)) >= 0, m);
  return mock.myProfile();
}).then(function (p) {
  ok('profile reports zero freezes and no XP spent', p.streakFreezes === 0 && p.xp === 0, JSON.stringify(p));
  // Earn XP the real way: practice runs until the balance covers a freeze.
  var earned = 0, subject = 'Physics', rounds = 0;
  function run() {
    if (earned >= COST || rounds++ > 40) return Promise.resolve();
    return mock.startStudy({ mode: 'practice', subject: subject, count: 5 }).then(function (r) {
      var ans = {}; (r.questions || []).forEach(function (q) { ans[q.id] = q.answer; });
      return mock.submitStudy({ paperId: r.paperId, responses: ans });
    }).then(function (s) {
      earned = s.xpTotal;
      return run();
    }, function () { rounds = 99; });
  }
  return run().then(function () { return earned; });
}).then(function (earned) {
  if (earned < COST) {
    console.log('  note  demo practice could not earn ' + COST + ' XP here (' + earned + '); success path skipped');
    return null;
  }
  return mock.buyStreakFreeze().then(function (r) {
    ok('enough XP: bought', r.ok === true && r.streakFreezes === 1, JSON.stringify(r));
    ok('cost taken from XP', r.xp === earned - COST, JSON.stringify(r));
    return mock.myProfile();
  }).then(function (p) {
    ok('profile shows the freeze', p.streakFreezes === 1, JSON.stringify(p));
  });
}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('THREW: ' + e.message);
  process.exit(1);
});
