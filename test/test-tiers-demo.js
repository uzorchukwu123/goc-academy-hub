/* test-tiers-demo.js — Phase 3B, slice 2: the offline demo driver applies the same access-tier rules as
   the server — public sign-up is Open, an academy-added student is GOC, and for an Open student: Objective
   and Theory Web Tests are locked (JAMB-oriented is not), notes past the first 3 of each subject are locked,
   bookmarks stop at 20, spaced reviews stop at 10 a day. Loads the real js/goc-core.js and js/api.js.
   node test/test-tiers-demo.js */
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
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
var core = vm.runInContext('GOC.core', ctx);
var mock = vm.runInContext('GOC.api._drivers.mock', ctx);
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }

var CODE = 'GOC2027';
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var DAY = 86400000;
function mistakeRun(ts, n) {
  var review = [];
  for (var i = 0; i < n; i++) review.push({ topic: 'Waves', given: 0, isCorrect: false, text: 'Question number ' + i + ' ' + ts, options: ['a', 'b', 'c', 'd'], answer: 3, explanation: 'because' });
  return { mode: 'practice', subject: 'Physics', total: n, answered: n, ts: ts, review: review };
}
function bm(i) { return { text: 'Saved question ' + i, options: ['a', 'b', 'c', 'd'], answer: 1, subject: 'Physics', topic: 'Waves' }; }

var openId, gocId;
async function main() {
  mock._setJambReadyMin(1);
  /* The seed has 2 notes per subject, so the console adds 3 more Physics ones: 5 in all, 2 past the Open line. */
  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  for (var n = 1; n <= 3; n++) {
    await mock.createNote({ subject: 'Physics', topic: 'Waves', title: 'Extra note ' + n,
      body: 'A long enough body for a study note about waves, number ' + n + ', so it passes the length check.' });
  }
  await mock.logout();

  head('who is Open and who is GOC');
  var r = await activeStudent.demo(mock, { signupCode: CODE, name: 'Opal Open', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: COMBO });
  openId = r.student.id;
  var me = await mock.myProfile();
  ok('a public sign-up is Open', me.tier === 'open', me.tier);
  ok('the profile carries features, limits and what is left today', me.features && me.limits && me.today && me.today.reviews && me.today.practice);
  ok('Open: Objective and Theory locked, JAMB-oriented open', me.features.webTestObjective === false && me.features.webTestTheory === false && me.features.jambMock === true);
  ok('practice is unlimited, reviews are 10 a day', me.today.practice.unlimited === true && me.today.reviews.limit === 10 && me.today.reviews.remaining === 10);

  head('Web Tests');
  var cat = await mock.listMyTests();
  var obj = cat.tests.filter(function (t) { return t.section === 'objective'; })[0];
  var jamb = cat.tests.filter(function (t) { return t.section === 'jamb'; })[0];
  var theory = cat.tests.filter(function (t) { return t.section === 'theory'; });
  ok('the Objective row is listed but marked locked', obj && obj.locked === true, JSON.stringify(obj));
  ok('every Theory row is marked locked', theory.length > 0 && theory.every(function (t) { return t.locked === true; }));
  ok('the JAMB-oriented row is listed and not locked', jamb && !jamb.locked, JSON.stringify(jamb));
  var m1 = await rejects(mock.startTest({ period: 'test', section: 'objective', subject: 'All subjects' }));
  ok('starting Objective is refused with the tier message', m1 && /GOC students/.test(m1), m1);
  var m2 = await rejects(mock.startTest({ period: 'test', section: 'theory', subject: 'Physics' }));
  ok('starting Theory is refused with the tier message', m2 && /GOC students/.test(m2), m2);
  var jp = await mock.startTest({ period: 'test', section: 'jamb', subject: 'All subjects' });
  ok('starting the JAMB-oriented test is allowed', jp && jp.attemptId && jp.questions.length > 0);

  head('notes');
  var nl = (await mock.listNotes({})).notes;
  var bySubject = {};
  nl.slice().sort(function (a, b) { return Number(a.id) - Number(b.id); }).forEach(function (n) { (bySubject[n.subject] = bySubject[n.subject] || []).push(n); });
  var anyLocked = false, shapeOk = true;
  Object.keys(bySubject).forEach(function (s) {
    bySubject[s].forEach(function (n, i) {
      if (i < 3) { if (n.locked || !n.body) shapeOk = false; }
      else { anyLocked = true; if (n.locked !== true || n.body !== '') shapeOk = false; }
    });
  });
  ok('the first 3 notes of each subject are readable, the rest locked with no body', shapeOk && anyLocked);

  head('bookmarks (20)');
  var last = null;
  for (var i = 0; i < 20; i++) last = await mock.addBookmark(bm(i));
  ok('20 saves are accepted', last && last.ok === true && last.bookmarks.length === 20);
  var m3 = await rejects(mock.addBookmark(bm(99)));
  ok('the 21st is refused with the limit message', m3 && /20 questions/.test(m3) && /GOC/.test(m3), m3);
  var again = await mock.addBookmark(bm(3));
  ok('saving one already saved is still a no-op', again.ok === true && again.already === true);
  var lb = await mock.listBookmarks();
  ok('the list reports the limit', lb.limit === 20 && lb.bookmarks.length === 20);

  head('spaced reviews (10 a day)');
  await mock.recordPractice(mistakeRun(Date.now() - 3 * DAY, 12));
  var q = (await mock.listReview());
  ok('the review list reports what is left today', q.today && q.today.reviews.limit === 10 && q.today.reviews.remaining === 10, JSON.stringify(q.today));
  var res;
  for (var k = 0; k < 10; k++) res = await mock.answerReview(q.review.due[k].key, 3);
  ok('10 reviews are accepted and the last says none are left', res.ok === true && res.today.reviews.remaining === 0);
  var q2 = await mock.listReview();
  ok('two more are still due, so the limit (not an empty queue) is what stops the 11th', q2.review.dueCount >= 2 && q2.review.due.length > 0, JSON.stringify(q2.review.dueCount));
  var nextKey = q2.review.due[0].key;
  var m4 = await rejects(mock.answerReview(nextKey, 3));
  ok('the 11th is refused with the daily message', m4 && /free spaced reviews/.test(m4) && /midnight/.test(m4), m4);
  var m5 = await rejects(mock.answerReview('nosuchkey', 3));
  ok('a bad request is not charged or shown the limit', m5 && /not in your mistakes/.test(m5), m5);
  ok('the profile now shows none left', (await mock.myProfile()).today.reviews.remaining === 0);

  head('a GOC student has none of these limits');
  mock._setTier(openId, 'goc');
  var me2 = await mock.myProfile();
  ok('promoted: tier goc, reviews unlimited', me2.tier === 'goc' && me2.today.reviews.unlimited === true);
  var more = await mock.addBookmark(bm(100));
  ok('GOC can save a 21st question', more.ok === true && more.bookmarks.length === 21);
  var nl2 = (await mock.listNotes({})).notes;
  ok('GOC reads every note', nl2.length > 0 && nl2.every(function (n) { return !n.locked && n.body; }));
  var r4 = await mock.answerReview(nextKey, 3);
  ok('GOC can keep reviewing', r4.ok === true);
  var big;
  for (var b = 200; b < 400; b++) big = await mock.addBookmark(bm(b));
  ok('GOC has no cap on saved questions (221 and counting)', big.ok === true && big.bookmarks.length === 221 && (await mock.listBookmarks()).limit === null, big.bookmarks.length);
  for (var pr = 0; pr < 35; pr++) await mock.recordPractice(mistakeRun(Date.now() - pr * 1000, 1));
  await mock.recordPractice(mistakeRun(Date.now() - 400 * DAY, 1));
  var hist = (await mock.listPractice()).runs;
  ok('GOC keeps more than 30 practice runs, and drops one older than a year', hist.length >= 36 && !hist.some(function (x) { return x.ts < Date.now() - 366 * DAY; }), hist.length);
  var cat2 = await mock.listMyTests();
  ok('GOC rows are not locked', cat2.tests.every(function (t) { return !t.locked; }));

  head('a student the academy adds is GOC');
  await mock.logout();
  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  var added = await mock.addStudent({ name: 'Gina Added', goal: 'JAMB / UTME 2027', subjects: COMBO });
  await mock.logout();
  await mock.login(added.student.id, added.temporaryPassword);
  var me3 = await mock.myProfile();
  ok('added by the console: tier goc', me3.tier === 'goc', me3.tier);

  head('the console can choose Open when adding');
  await mock.logout();
  await mock.login('GOC-A-001', 'founder2027');
  await mock.unlockConsole('2027');
  var addedOpen = await mock.addStudent({ name: 'Ope Chosen', goal: 'JAMB / UTME 2027', subjects: COMBO, tier: 'open' });
  ok('the reply names the tier chosen', addedOpen.student.tier === 'open', addedOpen.student.tier);
  var badTier = await rejects(mock.addStudent({ name: 'Bad Tier', goal: 'JAMB / UTME 2027', subjects: COMBO, tier: 'platinum' }));
  ok('an unknown tier is refused', badTier && /Open or GOC/.test(badTier), badTier);
  await mock.logout();
  await mock.login(addedOpen.student.id, addedOpen.temporaryPassword);
  var me4 = await mock.myProfile();
  ok('the account added as Open reads as Open', me4.tier === 'open' && me4.features.webTestObjective === false, me4.tier);
}
main().then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
}, function (e) { console.log('  FAIL  crashed   (' + (e && e.stack || e) + ')'); process.exit(1); });
