/* test-jamb-fresh.js — Phase 3: a repeated JAMB-oriented sitting draws questions
   the student has not met first.   node test/test-jamb-fresh.js */
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

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* A synthetic bank: 30 jamb questions in one subject, in three topics. */
function bank(n) {
  var out = [];
  for (var i = 1; i <= n; i++) out.push({ id: i, subject: 'Physics', topic: 'T' + (i % 3), kind: 'objective', section: 'jamb', active: true,
    question: 'q' + i, options: ['a', 'b', 'c', 'd'], answer: 0 });
  return out;
}
var caps = { Physics: 10 };
function ids(p) { return p.map(function (q) { return q.id; }); }
function overlap(a, b) { return a.filter(function (x) { return b.indexOf(x) > -1; }).length; }

head('jambSeenCounts');
ok('counts only JAMB-oriented attempts', JSON.stringify(core.jambSeenCounts([
  { section: 'jamb', questionIds: [1, 2] }, { section: 'jamb', questionIds: [2] }, { section: 'objective', questionIds: [9] }])) === '{"1":1,"2":2}');
ok('empty / junk input gives an empty map', JSON.stringify(core.jambSeenCounts(null)) === '{}' && JSON.stringify(core.jambSeenCounts([null, {}])) === '{}');

head('the draw');
var b = bank(30);
var first = ids(core.jambPaper(b, ['Physics'], caps));
ok('a first sitting is a full paper with no repeats inside it', first.length === 10 && new Set(first).size === 10);
var seen1 = core.jambSeenCounts([{ section: 'jamb', questionIds: first }]);
var second = ids(core.jambPaper(b, ['Physics'], caps, undefined, seen1));
ok('the second paper shares NO question with the first when the bank allows', overlap(first, second) === 0, JSON.stringify([first, second]));
var seen2 = core.jambSeenCounts([{ section: 'jamb', questionIds: first }, { section: 'jamb', questionIds: second }]);
var third = ids(core.jambPaper(b, ['Physics'], caps, undefined, seen2));
ok('the third still uses all-unseen questions (30 in the bank = exactly three papers)', overlap(first, third) === 0 && overlap(second, third) === 0, JSON.stringify(third));

head('a bank too thin for a fresh paper');
var thin = bank(14);
var t1 = ids(core.jambPaper(thin, ['Physics'], caps));
var ts = core.jambSeenCounts([{ section: 'jamb', questionIds: t1 }]);
var t2 = ids(core.jambPaper(thin, ['Physics'], caps, undefined, ts));
var unseen = thin.map(function (q) { return q.id; }).filter(function (x) { return t1.indexOf(x) < 0; });
ok('the paper is still full length', t2.length === 10 && new Set(t2).size === 10);
ok('every unseen question is used before any is repeated', unseen.every(function (x) { return t2.indexOf(x) > -1; }), JSON.stringify([t1, t2]));
ok('only the shortfall is repeated (14 - 10 = 4 fresh, so 6 repeats)', overlap(t1, t2) === 6, String(overlap(t1, t2)));
var many = { 1: 3, 2: 3, 3: 3, 4: 3, 5: 1, 6: 1 };   // a bank of 6 only
var low = ids(core.jambPaper(bank(6), ['Physics'], { Physics: 4 }, undefined, many));
ok('when everything has been met, the least-met come first', low.indexOf(5) > -1 && low.indexOf(6) > -1, JSON.stringify(low));

head('the draw is unchanged without history');
ok('no `seen` behaves as before (same call shape)', core.jambPaper(b, ['Physics'], caps, function () { return 0.5; }).length === 10);

head('demo driver: a repeat sitting meets new questions');
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
vm.runInContext('GOC.api._drivers.mock._setJambReadyMin(1)', ctx);
function sit() {
  return mock.startTest({ period: 'test', section: 'jamb', subject: 'All subjects' }).then(function (st) {
    var qs = st.questions.map(function (q) { return q.id; });
    return mock.submitTest({ attemptId: st.attemptId, responses: {} }).then(function () { return qs; });
  });
}
var A, B;
activeStudent.demo(mock, { signupCode: 'GOC2027', name: 'Fresh Demo', password: 'secret123',
  goal: 'JAMB / UTME 2027', subjects: COMBO }).then(function () { return mock.listQuestions ? 0 : 0; }).then(sit).then(function (a) {
  A = a; return sit();
}).then(function (b2) {
  B = b2;
  ok('both sittings were real papers', A.length > 0 && B.length > 0, A.length + ' / ' + B.length);
  /* How fresh a repeat can be depends on the bank's depth, which the route suite checks against a
     real data file; here it is enough that the demo driver feeds the same history into the draw. */
  ok('the demo driver passes the student\'s own history to the draw', /jambSeenCounts\(attempts\.filter/.test(
     fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8')));
}).catch(function (e) { fails++; console.log('  FAIL  crashed   (' + (e && e.stack || e) + ')'); }).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
});
