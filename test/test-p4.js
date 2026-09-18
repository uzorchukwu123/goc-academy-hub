/* test-p4.js — the Admin Console's Web Test management (Priority 4) driven end
   to end inside minidom: adding a question of either kind, editing it, changing
   the correct answer and the maximum mark, holding it back, reading the record
   filed against a Scholar ID, and marking a theory paper by hand — plus the
   Priority 13 guarantees that none of it is reachable from a student account or
   from a locked console.
   Run:  node test/test-p4.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

/* ---- a document built from the real markup (same recipe as test-p3) ---- */
var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
  scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});

/* ---- tiny assertions ---- */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function text(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function markup(x) { var e = id(x); return e ? e.innerHTML : ''; }
function count(x, sel) { var e = id(x); return e ? e.querySelectorAll(sel).length : -1; }
function set(x, v) { var e = id(x); if (e) e.value = v; return !!e; }
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 10) return done(); setImmediate(again); })();
  });
}
function api(name) { return run('GOC.api.' + name); }

var FOUNDER = 'GOC-A-001', FPW = 'founder2027', PASS = '2027';
var SID, SPW = 'bello#88';
var SID2, SPW2 = 'chukwu#19';

async function main() {

  /* There is no seeded demo roster any more, so the student the console
     marks a paper for is registered here through the real sign-up path —
     same as a scholar would use — and the driver hands back the Scholar ID
     it actually assigned. */
  var reg = await api('createStudent')({
    signupCode: 'GOC-2027', name: 'Tunde Bello', password: SPW,
    goal: 'JAMB / UTME',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics']
  });
  SID = reg.student.id;
  await api('logout')();

  /* A theory paper that nobody has marked yet — the console needs one, and the
     only honest way to get one is for a student to sit it. */
  head('a student sits a theory paper, so there is something to mark');
  await api('login')(SID, SPW);
  var paper = await api('startTest')({ period: 'monthly', section: 'theory', subject: 'Physics' });
  var responses = {};
  paper.questions.forEach(function (q, i) {
    responses[q.id] = 'Written answer number ' + (i + 1) + ' for the marker to read.';
  });
  var mine = await api('submitTest')({ attemptId: paper.attemptId, responses: responses, timeUsedSec: 300 });
  ok('it is waiting for a marker', mine.status === 'awaiting-marking', mine.status);
  ok('no score was invented', mine.score === null, mine.score);
  var THEORY_ID = mine.id;
  await api('logout')();

  head('the console is management-only, and locked until the passcode is entered');
  var shut = await api('listQuestions')({}).then(function () { return '(open!)'; }, function (e) { return e.message; });
  ok('signed out, the bank is refused', shut.indexOf('Management accounts only') > -1, shut);
  await api('login')(FOUNDER, FPW);
  var locked = await api('listQuestions')({}).then(function () { return '(open!)'; }, function (e) { return e.message; });
  ok('a staff account alone is not enough', locked.indexOf('access passcode') > -1, locked);
  var lockedR = await api('listResults')({}).then(function () { return '(open!)'; }, function (e) { return e.message; });
  ok('nor is the record readable while locked', lockedR.indexOf('access passcode') > -1, lockedR);
  await api('unlockConsole')(PASS);

  head('4.1 — the question form the console already had, now writing to the real bank');
  run('admOpen')('questions');
  await flush();
  /* There is one Test, so the form no longer asks which period a question belongs
     to — it asks only which session it is sat in. */
  ['admQSection', 'admQKind', 'admQTopic', 'admQText', 'admQAnswer',
   'admQDiff', 'admQWhy', 'admQActive', 'admQSaveBtn', 'admQCount', 'admQTabs', 'admQList']
    .forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  ok('and no period is asked for on the form', !id('admQPeriod'));
  ok('four option boxes for an objective question',
     !!id('admQO0') && !!id('admQO1') && !!id('admQO2') && !!id('admQO3'));
  ok('the question type is derived, not typed', id('admQKind').getAttribute('readonly') !== null);
  ok('it reads as an objective question', id('admQKind').value.indexOf('Objective') === 0, id('admQKind').value);
  ok('no theory-only field is on screen yet', !id('admQExpected') && !id('admQMax'));
  ok('the bank is shown, not a demo figure', text('admQCount') === '9 in Physics', text('admQCount'));
  ok('nine Physics questions were listed', count('admQList', '.ad-q') === 9, count('admQList', '.ad-q'));
  ok('they are grouped by session', markup('admQList').indexOf('Theory · 2 questions') > -1 &&
     markup('admQList').indexOf('Objective · 6 questions') > -1 &&
     markup('admQList').indexOf('JAMB-oriented · 1 question') > -1);
  ok('the correct answer is marked for management', markup('admQList').indexOf('✓ correct') > -1);
  ok('a theory row shows its reference answer and maximum',
     markup('admQList').indexOf('Reference answer:') > -1 && markup('admQList').indexOf('Maximum mark') > -1);
  ok('no import-a-CSV demo remains', markup('admPanel').indexOf('CSV template') < 0);

  head('choosing the theory session swaps the fields and keeps the typing');
  set('admQTopic', 'Waves');
  set('admQText', 'State two differences between transverse and longitudinal waves.');
  set('admQSection', 'theory');
  run('admQSet')();
  ok('the reference-answer box appeared', !!id('admQExpected'));
  ok('the maximum mark appeared', !!id('admQMax'));
  ok('the option boxes are gone', !id('admQO0') && !id('admQAnswer'));
  ok('the question type followed', id('admQKind').value.indexOf('Theory') === 0, id('admQKind').value);
  ok('what was already typed survived the swap',
     id('admQText').value.indexOf('State two differences') === 0, id('admQText').value);
  ok('the topic survived too', id('admQTopic').value === 'Waves', id('admQTopic').value);
  ok('the form says plainly that theory is never auto-scored',
     markup('admQForm').indexOf('never scored automatically') > -1);

  head('a theory question is refused until it carries a reference answer');
  set('admQExpected', 'short');
  set('admQMax', '12');
  run('admQSave')();
  await flush();
  ok('the API refused it', text('toast').indexOf('expected/reference answer') > -1, text('toast'));
  ok('nothing was added', count('admQList', '.ad-q') === 9, count('admQList', '.ad-q'));
  set('admQExpected', 'A transverse wave vibrates at right angles to the direction of travel; a longitudinal wave vibrates along it.');
  set('admQMax', '12');
  run('admQSave')();
  await flush();
  ok('with a reference answer it is accepted', text('toast').indexOf('added to Physics') > -1, text('toast'));
  ok('the bank grew', text('admQCount') === '10 in Physics', text('admQCount'));
  ok('the new question is listed', markup('admQList').indexOf('State two differences') > -1);
  ok('with the maximum mark management set', markup('admQList').indexOf('Maximum mark <b>12</b>') > -1);
  ok('the form was cleared for the next question', id('admQText').value === '', id('admQText').value);
  ok('and it went back to an objective question', !!id('admQO0'));
  head('an objective question is refused until the options make sense');
  set('admQText', 'Which unit measures electric current in a circuit?');
  set('admQTopic', 'Current Electricity');
  set('admQO0', 'Ampere'); set('admQO1', ''); set('admQO2', ''); set('admQO3', '');
  run('admQSave')();
  await flush();
  ok('one option is not a question', text('toast').indexOf('at least two options') > -1, text('toast'));
  set('admQO1', 'Volt'); set('admQO2', 'Ohm'); set('admQO3', '');
  set('admQAnswer', '3');
  run('admQSave')();
  await flush();
  ok('the correct answer must point at a filled-in option',
     text('toast').indexOf('Mark one of the options you filled in') > -1, text('toast'));
  ok('still nothing added', text('admQCount') === '10 in Physics', text('admQCount'));
  set('admQO3', 'Watt');
  set('admQAnswer', '0');
  set('admQWhy', 'Current is measured in amperes; the volt, ohm and watt measure other quantities.');
  run('admQSave')();
  await flush();
  ok('a complete objective question is accepted', text('toast').indexOf('added to Physics') > -1, text('toast'));
  var NEWQ = Number((text('toast').match(/#(\d+)/) || [0, 0])[1]);
  ok('it carries an id from the bank', NEWQ > 0, NEWQ);
  ok('the bank grew again', text('admQCount') === '11 in Physics', text('admQCount'));
  ok('it is listed under the objective session',
     markup('admQList').indexOf('Objective · 7 questions') > -1);
  ok('with the option management marked correct',
     markup('admQList').indexOf('A. Ampere <b>✓ correct</b>') > -1);
  ok('and the explanation it was given', markup('admQList').indexOf('Explanation: Current is measured') > -1);

  head('4.2 — the same form corrects a question: the answer, the mark, the wording');
  run('admQEditQ')(NEWQ);
  ok('the form filled itself in', id('admQText').value.indexOf('Which unit measures') === 0, id('admQText').value);
  ok('the options came back', id('admQO1').value === 'Volt', id('admQO1').value);
  ok('so did the topic', id('admQTopic').value === 'Current Electricity', id('admQTopic').value);
  ok('the save button now says update', text('admQSaveBtn').indexOf('Update question #' + NEWQ) === 0, text('admQSaveBtn'));
  ok('and an edit can be abandoned', markup('admQForm').indexOf('Cancel edit') > -1);
  set('admQAnswer', '1');
  set('admQText', 'Which unit measures electric potential difference?');
  run('admQSave')();
  await flush();
  ok('the correction was saved', text('toast').indexOf('#' + NEWQ + ' updated') > -1, text('toast'));
  ok('the bank did not gain a duplicate', text('admQCount') === '11 in Physics', text('admQCount'));
  ok('the wording changed', markup('admQList').indexOf('measures electric potential difference') > -1);
  ok('the correct answer moved with it', markup('admQList').indexOf('B. Volt <b>✓ correct</b>') > -1);
  ok('the form is back to a blank question', text('admQSaveBtn') === 'Add to the bank', text('admQSaveBtn'));

  head('the maximum mark on a theory question is management\'s to change');
  var theoryId = NEWQ - 1;
  run('admQEditQ')(theoryId);
  ok('the theory form opened', !!id('admQMax') && id('admQMax').value === '12', id('admQMax') && id('admQMax').value);
  ok('the reference answer came with it',
     id('admQExpected').value.indexOf('A transverse wave') === 0, id('admQExpected').value);
  set('admQMax', '15');
  run('admQSave')();
  await flush();
  ok('the new maximum was stored', markup('admQList').indexOf('Maximum mark <b>15</b>') > -1);

  head('4.2 — a question can be held back without being deleted');
  run('admQToggle')(NEWQ, false);
  await flush();
  ok('it is shown as inactive', count('admQList', '.ad-q.off') === 1, count('admQList', '.ad-q.off'));
  ok('with a plain-language tag', markup('admQList').indexOf('>Inactive<') > -1);
  ok('it is still in the bank, not deleted', text('admQCount') === '11 in Physics', text('admQCount'));
  var live = await api('listQuestions')({ subject: 'Physics', activeOnly: true });
  ok('but it is no longer served', live.questions.length === 10 &&
     !live.questions.some(function (q) { return q.id === NEWQ; }), live.questions.length);
  run('admQToggle')(NEWQ, true);
  await flush();
  ok('and it can be brought back', count('admQList', '.ad-q.off') === 0, count('admQList', '.ad-q.off'));

  head('the list can be narrowed to one session');
  run('admQSetFilter')('theory');
  ok('only theory questions are shown', count('admQList', '.ad-q') === 3, count('admQList', '.ad-q'));
  ok('the theory tab is active', markup('admQTabs').indexOf('class="on"') > -1);
  run('admQSetFilter')('jamb');
  ok('only the JAMB-oriented question is shown', count('admQList', '.ad-q') === 1, count('admQList', '.ad-q'));
  run('admQSetFilter')('all');
  ok('and back to everything', count('admQList', '.ad-q') === 11, count('admQList', '.ad-q'));

  head('item 3/5 — Web Test and Practice are two panels in one Question bank container');
  ok('the bank defaults to the Web Test panel', run('admQBank') === 'webtest', run('admQBank'));
  ok('the bank tabs are on screen', !!id('admQBankTabs'));
  ok('Web test reads as the active tab', markup('admQBankTabs').indexOf('class="on" onclick="admQSetBank(\'webtest\')">Web test') > -1, markup('admQBankTabs'));
  ok('a count-only totals summary is visible without opening either panel', !!id('admQTotals'));
  var countsNow = await api('questionCounts')();
  ok('the counts endpoint reports per-section totals',
     typeof countsNow.totals.theory === 'number' && typeof countsNow.totals.objective === 'number' &&
     typeof countsNow.totals.jamb === 'number' && typeof countsNow.totals.practice === 'number',
     JSON.stringify(countsNow.totals));
  ok('Physics carries the 11 web-test questions just built, and no practice ones yet',
     countsNow.bySubject.Physics.theory + countsNow.bySubject.Physics.objective + countsNow.bySubject.Physics.jamb === 11 &&
     countsNow.bySubject.Physics.practice === 0, JSON.stringify(countsNow.bySubject.Physics));

  run('admQSetBank')('practice');
  await flush();
  ok('switching banks is reflected in admQBank', run('admQBank') === 'practice', run('admQBank'));
  ok('Practice reads as the active tab', markup('admQBankTabs').indexOf('class="on" onclick="admQSetBank(\'practice\')">Practice') > -1, markup('admQBankTabs'));
  ok('the Web Test session picker is gone on the Practice panel', !id('admQSection'));
  ok('the section is shown fixed instead', markup('admQForm').indexOf('Practice only — not in Web Test') > -1);
  ok('nothing in the Practice bank for Physics yet', text('admQCount') === '0 in Physics', text('admQCount'));
  ok('the session tabs are not shown for a bank with one section', markup('admQTabs') === '');

  set('admQText', 'Which gas is released when zinc reacts with dilute acid?');
  set('admQTopic', 'Practice warm-up');
  set('admQO0', 'Hydrogen'); set('admQO1', 'Oxygen'); set('admQO2', 'Nitrogen'); set('admQO3', 'Chlorine');
  set('admQAnswer', '0');
  run('admQSave')();
  await flush();
  ok('a practice question is accepted', text('toast').indexOf('added to Physics') > -1, text('toast'));
  ok('it counts in the Practice bank', text('admQCount') === '1 in Physics', text('admQCount'));
  ok('it is listed here', markup('admQList').indexOf('Which gas is released') > -1);
  var practiceCounts = await api('questionCounts')();
  ok('the counts endpoint picked it up', practiceCounts.bySubject.Physics.practice === 1,
     JSON.stringify(practiceCounts.bySubject.Physics));
  ok('and the Web Test sections were untouched by it',
     practiceCounts.bySubject.Physics.theory + practiceCounts.bySubject.Physics.objective +
     practiceCounts.bySubject.Physics.jamb === 11, JSON.stringify(practiceCounts.bySubject.Physics));

  run('admQSetBank')('webtest');
  await flush();
  ok('back on the Web Test panel the practice question is not listed',
     markup('admQList').indexOf('Which gas is released') < 0);
  ok('and the Web Test count is unchanged by it', text('admQCount') === '11 in Physics', text('admQCount'));
  ok('the session tabs are back', markup('admQTabs').length > 0);

  head('management sets the objective sitting: one clock, one count per paper');
  run('admOpen')('objective');
  await flush();
  /* The academy sets a sitting in hours — "2 hours", not "120 minutes". Minutes
     stay the stored unit underneath, so both readings are checked: the label the
     console shows, and the number it saved. */
  ok('the clock is shown in hours, not left as a placeholder',
     /hour/.test(text('admObjMin')), text('admObjMin'));
  ok('and the stepper agrees with it',
     text('admObjStepVal') === text('admObjMin'), text('admObjStepVal'));
  var objMin = run('admObjMin');
  ok('the sitting starts on the academy default of two hours',
     objMin === 120 && text('admObjMin') === '2 hours', objMin + ' / ' + text('admObjMin'));
  ok('every paper in the blueprint is listed', run('admObjRows').length === 5, run('admObjRows').length);
  ok('Use of English is the first paper', run('admObjRows')[0].subject === 'Use of English',
     run('admObjRows')[0].subject);
  ok('each row separates the ceiling, the ask and what the bank can serve',
     run('admObjRows').every(function (r) {
       return typeof r.ceiling === 'number' && typeof r.want === 'number' &&
              typeof r.available === 'number' && typeof r.serving === 'number';
     }), JSON.stringify(run('admObjRows')[0]));
  ok('and the row is shown with all three',
     markup('admObjList').indexOf('live in the bank') > -1 &&
     markup('admObjList').indexOf('ceiling') > -1);
  ok('a paper the bank cannot fill is marked short, not quietly served',
     run('admObjRows').some(function (r) { return r.available < r.want; }) ===
     (markup('admObjList').indexOf('short</span>') > -1));
  ok('the total under the papers is what is actually served',
     markup('admObjList').indexOf(String(run('admObjRows').reduce(function (a, r) {
       return a + r.serving; }, 0)) + ' question') > -1);
  run('admObjStep')(30);
  await flush();
  ok('the clock can be moved by the half hour', run('admObjMin') === objMin + 30, run('admObjMin'));
  ok('and the change is reported in hours',
     text('toast').indexOf('runs for ' + run('GOC.api.rules.hoursLabel')(objMin + 30)) > -1,
     text('toast'));
  ok('the metric was repainted, not left behind',
     text('admObjMin') === '2 hours 30 min', text('admObjMin'));
  var far = 0;
  while (far < 30 && run('admObjMin') < 300) { run('admObjStep')(30); await flush(); far++; }
  ok('the clock stops at the five-hour ceiling',
     run('admObjMin') === 300 && text('admObjMin') === '5 hours',
     run('admObjMin') + ' / ' + text('admObjMin'));
  var back = 0;
  while (back < 40 && run('admObjMin') > 5) { run('admObjStep')(-30); await flush(); back++; }
  ok('and never falls below five minutes', run('admObjMin') === 5, run('admObjMin'));
  ok('a sitting under an hour is still named in minutes', text('admObjMin') === '5 minutes',
     text('admObjMin'));
  await api('setObjectiveMinutes')(120);
  run('admObjLoad')();
  await flush();
  ok('a saved clock is what the panel reads back', run('admObjMin') === 120, run('admObjMin'));
  var eng = run('admObjRows')[0], engWant = eng.want;
  run('admObjCount')(0, -5);
  await flush();
  ok('a paper can be set shorter than the ceiling',
     run('admObjRows')[0].want === engWant - 5, run('admObjRows')[0].want);
  ok('and the console says what it saved out of what is possible',
     text('toast').indexOf('of a possible 60') > -1, text('toast'));
  var up = 0;
  while (up < 20 && run('admObjRows')[0].want < 60) { run('admObjCount')(0, 5); await flush(); up++; }
  ok('Use of English cannot be pushed past 60', run('admObjRows')[0].want === 60,
     run('admObjRows')[0].want);
  var sci = run('admObjRows')[1], sciUp = 0;
  while (sciUp < 20 && run('admObjRows')[1].want < 40) { run('admObjCount')(1, 5); await flush(); sciUp++; }
  ok('nor a science paper past 40', run('admObjRows')[1].want === 40, run('admObjRows')[1].want);
  var dn = 0;
  while (dn < 20 && run('admObjRows')[1].want > 0) { run('admObjCount')(1, -5); await flush(); dn++; }
  ok('a paper set to zero is accepted as an instruction', run('admObjRows')[1].want === 0,
     run('admObjRows')[1].want);
  ok('and it is held out of the sitting in red, not left ambiguous',
     markup('admObjList').indexOf('Not served') > -1);
  ok('the questions it would have served are not counted', run('admObjRows')[1].serving === 0,
     run('admObjRows')[1].serving);
  await api('setObjectiveCount')(sci.subject, sci.want);
  await api('setObjectiveCount')(eng.subject, engWant);
  /* There is one sitting to configure, so the panel no longer switches period. */
  ok('the panel offers no period to switch between',
     run('typeof admObjPeriodSet') === 'undefined' && !id('admObjPeriod'));

  /* The record the console is about to review needs more than one scholar's
     paper on it, and at least one machine-marked (objective) sitting — there
     is no seeded demo history any more, so a second real student is
     registered and sits an objective paper through the real API, the same
     way the first student's theory paper above was produced. */
  head('a second scholar sits an objective paper, so the record holds more than one sitting');
  await api('logout')();
  var reg2 = await api('createStudent')({
    signupCode: 'GOC-2027', name: 'Ada Chukwu', password: SPW2,
    goal: 'JAMB / UTME',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics']
  });
  SID2 = reg2.student.id;
  await api('login')(SID2, SPW2);
  var objPaper = await api('startTest')({ period: 'weekly', section: 'objective', subject: 'Physics' });
  var objResponses = {};
  objPaper.questions.forEach(function (q) { objResponses[q.id] = 0; });
  var objMine = await api('submitTest')({ attemptId: objPaper.attemptId, responses: objResponses, timeUsedSec: 200 });
  ok('an objective paper is marked on the spot, by the machine', objMine.status === 'marked', objMine.status);
  ok('and carries a real score, not nothing', typeof objMine.score === 'number', objMine.score);
  await api('logout')();
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);

  run('admOpen')('results');
  await flush();

  head('4.3 — every sitting is on the record, filed under a Scholar ID');
  run('admOpen')('results');
  await flush();
  ['admRSection', 'admRSubject', 'admRStatus', 'admRScholar',
   'admRSummary', 'admRList', 'admRDetailCard', 'admRDetail', 'admRDetailTitle']
    .forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  ok('and the record is not split by period', !id('admRPeriod'));
  ok('no paper is open until one is chosen', id('admRDetailCard').hidden === true, id('admRDetailCard').hidden);
  var rows = count('admRList', '.ad-res');
  ok('the sittings are listed', rows > 1, rows);
  ok('the summary counts them', text('admRSummary').indexOf('Sittings shown') > -1, text('admRSummary'));
  ok('and says how many theory papers wait', markup('admRSummary').indexOf('Theory awaiting marking</span><b>1<') > -1,
     markup('admRSummary'));
  var named = id('admRList').querySelectorAll('.ad-res .nm b');
  ok('every row names the student by Scholar ID',
     named.length === rows && named.every(function (e) { return e.textContent.indexOf('GOC-S-') === 0; }), named.length);
  ok('a row carries the date, the score and the time used',
     named[0].parentNode.textContent.indexOf(' used') > -1, named[0].parentNode.textContent);
  ok('no demo names are left in the panel', markup('admPanel').indexOf('Chinedu') < 0);

  head('the record can be narrowed — by scholar, by session, by marking status');
  set('admRScholar', SID);
  run('admRSetFilter')();
  await flush();
  var mineRows = id('admRList').querySelectorAll('.ad-res .nm b');
  ok('one scholar at a time', mineRows.length > 0 &&
     mineRows.every(function (e) { return e.textContent.indexOf(SID) === 0; }), mineRows.length);
  ok('fewer than the whole record', mineRows.length < rows, mineRows.length + ' of ' + rows);
  set('admRStatus', 'awaiting-marking');
  run('admRSetFilter')();
  await flush();
  ok('exactly one paper of theirs is waiting for a marker',
     count('admRList', '.ad-res') === 1, count('admRList', '.ad-res'));
  ok('and it is shown as pending', count('admRList', '.ad-tag.a') === 1, count('admRList', '.ad-tag.a'));
  set('admRStatus', '');
  set('admRSection', 'objective');
  set('admRScholar', '');
  run('admRSetFilter')();
  await flush();
  var objRows = run('admRCache');
  ok('objective sittings can be read on their own',
     objRows.length > 0 && objRows.every(function (a) { return a.section === 'objective'; }), objRows.length);

  head('4.5 — an objective paper is read-only: the machine marked it, not the console');
  var OBJ = objRows[0];
  run('admROpen')(OBJ.id);
  await flush();
  ok('the paper opened', id('admRDetailCard').hidden === false, id('admRDetailCard').hidden);
  ok('the title names the scholar', text('admRDetailTitle').indexOf(OBJ.scholarId) === 0, text('admRDetailTitle'));
  var det = text('admRDetail');
  /* One Test, so the two old rows — test type and category — are now the single
     'Paper' row naming the Test and the session it was sat in. */
  ['Scholar ID', 'Student', 'Paper', 'Subject', 'Date & submission time',
   'Questions', 'Correct / incorrect', 'Score', 'Percentage', 'Time used',
   'Completion status', 'Marking status', 'XP credited']
    .forEach(function (label) { ok('it reports ' + label, det.indexOf(label) > -1); });
  ok('the paper row names the one Test and the session',
     det.indexOf('Test · Objective') > -1, det);
  ok('the correct answer is shown to management', det.indexOf('✓ correct answer') > -1);
  ok('it says the marking was automatic', det.indexOf('marked automatically') > -1);
  ok('there is no hand-marking box on a machine-marked paper',
     markup('admRDetail').indexOf('admMk') < 0);
  ok('the score is a real number, not a placeholder', det.indexOf('Awaiting marking') < 0);

  head('4.4 — a theory paper is marked by hand, and nothing is totalled until then');
  set('admRSection', 'theory');
  set('admRScholar', SID);
  run('admRSetFilter')();
  await flush();
  run('admROpen')(THEORY_ID);
  await flush();
  var mk = text('admRDetail');
  ok('it opens awaiting a marker', mk.indexOf('Awaiting marking by hand') > -1, mk.indexOf('Awaiting marking'));
  ok('no percentage was invented', mk.indexOf('Percentage') > -1 && mk.indexOf('—') > -1);
  ok('what the student wrote is shown', mk.indexOf('Written answer number 1') > -1);
  ok('the reference answer is shown beside it', mk.indexOf('Expected / reference answer') > -1);
  ok('the maximum mark is stated', mk.indexOf('maximum') > -1);
  ok('the console says plainly that nothing is scored automatically',
     mk.indexOf('Nothing on a theory paper is scored automatically') > -1);
  var boxes = id('admRDetail').querySelectorAll('input');
  ok('there is one empty mark box per question',
     boxes.length === paper.questions.length && boxes.every(function (b) { return b.value === ''; }), boxes.length);
  run('admMarkSave')();
  await flush();
  ok('saving with nothing awarded is refused', text('toast').indexOf('Award at least one mark') > -1, text('toast'));
  var MAX = Number(boxes[0].getAttribute('max'));
  boxes[0].value = String(MAX + 5);
  run('admMarkSave')();
  await flush();
  ok('a mark above the maximum is refused',
     text('toast').indexOf('between 0 and the maximum (' + MAX + ')') > -1, text('toast'));
  var still = await api('getAttempt')(THEORY_ID);
  ok('the paper is untouched by a refused save', still.status === 'awaiting-marking', still.status);
  var AWARD = MAX - 2;
  boxes.forEach(function (b) { b.value = String(AWARD); });
  run('admMarkSave')();
  await flush();
  ok('valid marks are saved against the Scholar ID',
     text('toast').indexOf('saved against ' + SID) > -1, text('toast'));
  var done = await api('getAttempt')(THEORY_ID);
  ok('the paper is now marked', done.status === 'marked', done.status);
  ok('the total is the sum management awarded', done.score === AWARD * boxes.length, done.score);
  ok('out of the maximum the questions carry', done.maxScore === MAX * boxes.length, done.maxScore);
  ok('the percentage follows from those two',
     done.percent === Math.round((done.score / done.maxScore) * 1000) / 10, done.percent);
  ok('and the marker is on the record', done.markedBy === FOUNDER, done.markedBy);
  ok('nothing is left waiting now', markup('admRSummary').indexOf('Theory awaiting marking</span><b>0<') > -1,
     markup('admRSummary'));
  ok('the row turned from pending to marked', count('admRList', '.ad-tag.a') === 0, count('admRList', '.ad-tag.a'));
  ok('the reopened paper shows the marks it was given',
     text('admRDetail').indexOf('Marked by ' + FOUNDER) > -1, text('admRDetail').indexOf('Marked'));
  var obj2 = await api('markTheory')(OBJ.id, {}).then(function () { return '(accepted!)'; }, function (e) { return e.message; });
  ok('a machine-marked paper cannot be re-marked by hand',
     obj2.indexOf('theory') > -1, obj2);
  head('a paper with several answers is sat, so marking can be split');
  /* How many theory questions Physics carries is the bank's business, not this
     test's — so the expected length is read from the bank management just wrote to. */
  var bank = await api('listQuestions')({ subject: 'Physics', section: 'theory', activeOnly: true });
  var expectQ = bank.questions.length;
  ok('the bank holds the theory question management wrote',
     bank.questions.some(function (q) { return q.id === theoryId; }), expectQ);
  /* SID has already sat and had their Physics theory paper marked above, and
     the one-sit rule closes that section for them for good — so the live
     sitting that proves the newly-added question reaches a student is done
     as SID2 instead, who has never sat Physics theory. */
  await api('logout')();
  await api('login')(SID2, SPW2);
  var wk = await api('startTest')({ period: 'weekly', section: 'theory', subject: 'Physics' });
  ok('the paper carries every published theory question, the new one included',
     wk.questions.length === expectQ, wk.questions.length + ' vs ' + expectQ);
  var wr = {};
  wk.questions.forEach(function (q) { wr[q.id] = 'A written response for the marker to read.'; });
  var sat = await api('submitTest')({ attemptId: wk.attemptId, responses: wr, timeUsedSec: 420 });
  ok('it waits for a marker too', sat.status === 'awaiting-marking', sat.status);
  ok('and carries no score of its own', sat.score === null, sat.score);
  await api('logout')();
  await api('login')(SID, SPW);

  head('13 — the paper a student is given never contains the answer key');
  var op = await api('startTest')({ period: 'weekly', section: 'objective', subject: 'Physics' });
  ok('no correct answer is sent to the browser',
     op.questions.every(function (q) {
       return q.answer === undefined && q.expected === undefined && q.isCorrect === undefined;
     }), JSON.stringify(op.questions[0]).slice(0, 120));

  head('13 — none of the console is reachable from a student account');
  function refused(call) { return call().then(function () { return '(allowed!)'; }, function (e) { return e.message; }); }
  var shutOut = [
    ['read the question bank', function () { return api('listQuestions')({}); }],
    ['add a question', function () { return api('createQuestion')({ subject: 'Physics', section: 'objective', period: 'weekly', text: 'x', options: ['a', 'b'], answer: 0 }); }],
    ['change a question', function () { return api('updateQuestion')(NEWQ, { text: 'rewritten by a student' }); }],
    ['change a correct answer', function () { return api('updateQuestion')(NEWQ, { answer: 3 }); }],
    ['hold a question back', function () { return api('setQuestionActive')(NEWQ, false); }],
    ['read the full notes list', function () { return api('listAllNotes')({}); }],
    ['add a note', function () { return api('createNote')({ subject: 'Physics', topic: 'x', title: 'x', body: 'x' }); }],
    ['delete a question', function () { return api('deleteQuestion')(NEWQ); }],
    ['set the objective clock', function () { return api('setObjectiveMinutes')(5); }],
    ['shorten an objective paper', function () { return api('setObjectiveCount')('Physics', 1); }],
    ['read the objective blueprint', function () { return api('objectiveBlueprint')({ period: 'weekly' }); }],
    ['read the whole record', function () { return api('listResults')({}); }],
    ['open another sitting', function () { return api('getAttempt')(OBJ.id); }],
    ['award marks', function () { return api('markTheory')(THEORY_ID, {}); }]
  ];
  for (var i = 0; i < shutOut.length; i++) {
    var msg = await refused(shutOut[i][1]);
    ok('a student cannot ' + shutOut[i][0], msg.indexOf('Management accounts only') > -1, msg);
  }
  var resub = await refused(function () {
    return api('submitTest')({ attemptId: wk.attemptId, responses: wr, timeUsedSec: 1, score: 100, percent: 100 });
  });
  ok('a submitted paper cannot be sent again with a score attached', resub !== '(allowed!)', resub);

  head('and the marks management awarded are exactly what remains on file');
  await api('logout')();
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  var final = await api('getAttempt')(THEORY_ID);
  ok('the hand-marked score is unchanged', final.score === AWARD * boxes.length, final.score);
  ok('the marker is unchanged', final.markedBy === FOUNDER, final.markedBy);
  ok('the question wording is unchanged', (await api('listQuestions')({ subject: 'Physics' })).questions
     .some(function (q) { return q.id === NEWQ && q.text.indexOf('rewritten') < 0; }));
  ok('the correct answer is unchanged', (await api('listQuestions')({ subject: 'Physics' })).questions
     .some(function (q) { return q.id === NEWQ && q.answer === 1; }));

  head('4.4 — marking can be done in two sittings at the desk');
  run('admOpen')('results');
  await flush();
  /* This paper was sat by SID2 (see above), so the scholar filter left over
     from the previous section has to move with it, or nothing here would
     show up. */
  set('admRScholar', SID2);
  set('admRStatus', 'awaiting-marking');
  run('admRSetFilter')();
  await flush();
  ok('the new paper is the only one waiting', count('admRList', '.ad-res') === 1, count('admRList', '.ad-res'));
  run('admROpen')(sat.id);
  await flush();
  var two = id('admRDetail').querySelectorAll('input');
  ok('one mark box per question on the paper', two.length === expectQ, two.length);
  /* Mark all but the last, so a half-marked paper can be seen for what it is. */
  var partial = 0;
  two.forEach(function (b, k) {
    if (k === two.length - 1) return;
    b.value = '4';
    partial += 4;
  });
  run('admMarkSave')();
  await flush();
  ok('a partly marked paper is not declared finished',
     text('toast').indexOf('still has answers waiting') > -1, text('toast'));
  var part = await api('getAttempt')(sat.id);
  ok('it is still awaiting marking', part.status === 'awaiting-marking', part.status);
  ok('the mark already awarded was kept',
     part.answers.some(function (r) { return Number(r.markAwarded) === 4; }),
     part.answers.map(function (r) { return r.markAwarded; }).join(','));
  ok('one answer is still unmarked',
     part.answers.some(function (r) { return r.markAwarded === null || r.markAwarded === undefined; }));
  ok('and half a paper carries no score at all', part.score === null, part.score);
  ok('nor a percentage', part.percent === null, part.percent);
  var again = id('admRDetail').querySelectorAll('input');
  ok('the box remembers the mark on reopening', String(again[0].value) === '4', again[0].value);
  again[again.length - 1].value = '9';
  run('admMarkSave')();
  await flush();
  ok('with every mark in, the paper is totalled',
     text('toast').indexOf('saved against ' + SID2) > -1, text('toast'));
  var whole = await api('getAttempt')(sat.id);
  ok('it is marked at last', whole.status === 'marked', whole.status);
  ok('the total is every mark added up', whole.score === partial + 9, whole.score);
  ok('out of the maximums the questions carry',
     whole.maxScore === wk.questions.reduce(function (m, q) { return m + (q.maxMark || 0); }, 0),
     whole.maxScore);
  ok('and the record shows who marked it', whole.markedBy === FOUNDER, whole.markedBy);

  head('#25 — management reads the standings and what the bank actually serves');
  /* Two console panels that only report: the leaderboard the students see, and
     what a student is served once a question is published. Neither may state a
     figure of its own — both are read from the same calls the student screens
     read, so management and student can never be looking at different numbers. */
  run('admOpen')('league');
  await flush();
  await flush();
  ['admLgName', 'admLgCount', 'admLgList'].forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  var lg = await api('league')();
  ok('the league is named, not described',
     text('admLgName') === (lg.leagueName || lg.league), text('admLgName'));
  ok('and the count is the league\'s own size',
     text('admLgCount') === lg.rows.length + ' of ' + lg.size, text('admLgCount'));
  ok('every ranked scholar is listed', count('admLgList', '.ad-cred') === lg.rows.length,
     count('admLgList', '.ad-cred'));
  ok('the top of the table is the same scholar the students see',
     text('admLgList').indexOf(lg.rows[0].name) > -1 &&
     text('admLgList').indexOf(String(lg.rows[0].xp) + ' XP') > -1, text('admLgList').slice(0, 120));
  ok('each row is filed against a Scholar ID',
     markup('admLgList').indexOf(lg.rows[0].scholarId) > -1);
  ok('XP is shown beside the streak and the assessed performance, so a rank built on activity alone is visible',
     text('admLgList').indexOf('Streak') > -1 && text('admLgList').indexOf('Performance') > -1);
  /* Row by row against what league() returned: a percentage where a paper was
     marked, the words 'not assessed' where none was. The console may not invent
     a figure for a scholar nobody has marked, and may not round one it has. */
  var lgBad = lg.rows.filter(function (s) {
    return markup('admLgList').indexOf('<label>Performance</label><code>' +
      (s.assessed ? String(s.performance) + '%' : 'not assessed') + '</code>') < 0;
  });
  ok('every performance cell is the figure league() gave, or the words "not assessed"',
     lgBad.length === 0, lgBad.map(function (s) { return s.scholarId; }).join(','));
  ok('and no scholar is credited with a percentage they have not been assessed for',
     !lg.rows.some(function (s) { return !s.assessed; }) ||
     text('admLgList').indexOf('not assessed') > -1);
  ok('the ranking basis is stated, so nobody has to guess what the order means',
     text('admLgBasis') === lg.basis, text('admLgBasis'));
  ok('and it is the same rule the students are shown, not a retyped one',
     text('admLgBasis').indexOf('performance') > -1 &&
     text('admLgBasis').toLowerCase().indexOf('xp') > -1, text('admLgBasis'));
  /* The order on screen must be the order league() ranked, or a scholar could
     look higher to management than to the students. */
  var seen = markup('admLgList'), lastAt = -1, orderOK = true;
  lg.rows.forEach(function (s) {
    var at = seen.indexOf(s.scholarId);
    if(at < 0 || at < lastAt) orderOK = false;
    lastAt = at;
  });
  ok('the rows are in the ranked order, top to bottom', orderOK);
  ok('a stronger performance outranks a bigger XP total, exactly as the students see it',
     lg.rows.length < 2 || lg.rows.every(function (s, i) {
       return i === 0 || !s.assessed || !lg.rows[i - 1].assessed ||
              lg.rows[i - 1].performance >= s.performance;
     }));

  run('admOpen')('questions');
  await flush();
  await flush();
  ok('#admQRef exists', !!id('admQRef'));
  var liveAll = await api('listQuestions')({ activeOnly: true });
  var livePhys = liveAll.questions.filter(function (q) { return q.subject === 'Physics'; }).length;
  ok('the reflection counts the live bank, subject by subject',
     text('admQRef').indexOf('Physics · ' + livePhys + ' live question') > -1, text('admQRef').slice(0, 160));
  ok('it reads every paper, not just the one being edited',
     text('admQRef').indexOf('Use of English ·') > -1 && text('admQRef').indexOf('Biology ·') > -1);
  ok('and breaks each paper down by the session a student sits',
     text('admQRef').indexOf('Objective') > -1 && text('admQRef').indexOf('Theory') > -1);
  ok('with every paper covered, it says so plainly',
     text('admQRef').indexOf('Every paper has live questions') > -1, text('admQRef').slice(-160));
  /* A held-back question is not served, so it must not be counted here either. */
  var vanish = liveAll.questions.filter(function (q) { return q.subject === 'Biology'; });
  await api('setQuestionActive')(vanish[0].id, false);
  run('admQRefLoad')();
  await flush();
  ok('holding a question back drops it out of what the bank is said to serve',
     text('admQRef').indexOf('Biology · ' + (vanish.length - 1) + ' live question') > -1,
     text('admQRef').slice(0, 200));
  /* The warning that matters before a launch: a paper with nothing live is a
     paper a student opens and is offered nothing in. Empty one and watch. */
  for(var vi = 1; vi < vanish.length; vi++) await api('setQuestionActive')(vanish[vi].id, false);
  run('admQRefLoad')();
  await flush();
  ok('an empty paper is named as empty, not silently reported as zero',
     text('admQRef').indexOf('No live question in Biology') > -1, text('admQRef').slice(0, 260));
  ok('and the console warns that a student who sits it is offered nothing',
     count('admQRef', '.ad-warn') === 1 &&
     text('admQRef').indexOf('1 paper has nothing live: Biology') > -1, text('admQRef').slice(-200));
  ok('the reassuring note is gone while a paper is empty',
     count('admQRef', '.ad-note') === 0);
  for(var vj = 0; vj < vanish.length; vj++) await api('setQuestionActive')(vanish[vj].id, true);
  run('admQRefLoad')();
  await flush();
  ok('publishing them again clears the warning',
     count('admQRef', '.ad-warn') === 0 &&
     text('admQRef').indexOf('Biology · ' + vanish.length + ' live question') > -1,
     text('admQRef').slice(0, 200));

  head('4.6 — the reading notes the students actually read are written here');
  /* Read / Learn holds no prose of its own. Everything a student reads there is
     a record in this panel, so the panel must show the real notes — not a
     figure, and not a demo. */
  run('admOpen')('notes');
  await flush();
  ['admNCount', 'admNForm', 'admNTopic', 'admNTitle', 'admNBody', 'admNMins',
   'admNActive', 'admNSaveBtn', 'admNTabs', 'admNList']
    .forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  ok('the notes held are counted from the record, not stated',
     text('admNCount') === '2 in Physics · 2 readable', text('admNCount'));
  ok('both Physics notes are listed', count('admNList', '.ad-q') === 2, count('admNList', '.ad-q'));
  ok('they are grouped under the topic the student picks',
     markup('admNList').indexOf('Motion · 1 note') > -1 &&
     markup('admNList').indexOf('Electricity · 1 note') > -1, markup('admNList'));
  ok('each row can be edited or held back',
     markup('admNList').indexOf('admNEdit(5)') > -1 &&
     markup('admNList').indexOf('admNToggle(5,false)') > -1);
  ok('the reading time is shown as a length, not a raw number',
     markup('admNList').indexOf('min read') > -1);

  head('writing a note, and the refusals that protect a student\'s screen');
  set('admNTopic', 'Waves');
  set('admNTitle', 'Wave basics');
  set('admNBody', 'Waves carry energy.');
  run('admNSave')();
  await flush();
  var tooThin = await api('listAllNotes')({ subject: 'Physics' });
  ok('a note thinner than a paragraph is refused',
     text('toast').indexOf('too short to read') > -1, text('toast'));
  ok('and nothing was published', tooThin.notes.length === 2, tooThin.notes.length);
  ok('the typing was kept so it can be finished, not retyped',
     id('admNTopic').value === 'Waves' && id('admNTitle').value === 'Wave basics',
     id('admNTopic').value + ' / ' + id('admNTitle').value);
  var BODY = 'A wave carries energy from one place to another without carrying '
    + 'matter with it. The particles of the medium move about their own fixed '
    + 'positions.\n\nA transverse wave vibrates across the direction of travel; a '
    + 'longitudinal wave vibrates along it.';
  set('admNBody', BODY);
  run('admNSave')();
  await flush();
  await flush();
  ok('a full note is published to the subject on screen',
     text('toast').indexOf('published to Physics') > -1, text('toast'));
  var grown = await api('listAllNotes')({ subject: 'Physics' });
  ok('the record grew by exactly one', grown.notes.length === 3, grown.notes.length);
  var mineNote = grown.notes.filter(function (n) { return n.title === 'Wave basics'; })[0];
  ok('it kept both paragraphs as typed', mineNote && mineNote.body.indexOf('\n\n') > -1);
  ok('a reading time was worked out for it', mineNote && mineNote.minutes >= 1, mineNote && mineNote.minutes);
  ok('it is readable straight away', mineNote && mineNote.active === true);
  ok('the panel repainted with it', count('admNList', '.ad-q') === 3, count('admNList', '.ad-q'));
  ok('and the form was emptied for the next one', id('admNTitle').value === '', id('admNTitle').value);
  head('correcting a note, and holding one back');
  var NID = mineNote.id;
  run('admNEdit')(NID);
  await flush();
  ok('editing fills the form from the record',
     id('admNTitle').value === 'Wave basics' && id('admNTopic').value === 'Waves',
     id('admNTitle').value + ' / ' + id('admNTopic').value);
  ok('and the note itself comes back to be corrected',
     id('admNBody').value.indexOf('without carrying') > -1);
  ok('the button says it will update, not publish again',
     text('admNSaveBtn').indexOf('Update note #' + NID) > -1, text('admNSaveBtn'));
  set('admNTitle', 'What a wave carries');
  run('admNSave')();
  await flush();
  await flush();
  ok('the correction is saved against the same note',
     text('toast') === 'Note #' + NID + ' updated', text('toast'));
  var edited = await api('listAllNotes')({ subject: 'Physics' });
  ok('no second copy was made', edited.notes.length === 3, edited.notes.length);
  ok('the title is the corrected one',
     edited.notes.filter(function (n) { return n.id === NID; })[0].title === 'What a wave carries');

  run('admNToggle')(NID, false);
  await flush();
  await flush();
  ok('holding a note back says plainly that students lose it',
     text('toast').indexOf('students will not see it') > -1, text('toast'));
  ok('the count separates what is held from what is readable',
     text('admNCount') === '3 in Physics · 2 readable', text('admNCount'));
  run('admNSetFilter')('held');
  ok('the held-back filter shows just that note', count('admNList', '.ad-q') === 1, count('admNList', '.ad-q'));
  ok('and offers to publish it rather than hold it again',
     markup('admNList').indexOf('admNToggle(' + NID + ',true)') > -1, markup('admNList'));
  run('admNSetFilter')('live');
  ok('the readable filter leaves it out', count('admNList', '.ad-q') === 2, count('admNList', '.ad-q'));
  run('admNSetFilter')('all');
  head('4.7 — a spreadsheet instead of typing, checked by the same rules');
  run('admOpen')('import');
  await flush();
  ['admImKind', 'admImCols', 'admImNote', 'admImFile', 'admImCsv', 'admImBtn', 'admImOut']
    .forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  ok('the columns shown are the ones the parser reads',
     text('admImCols') === run('GOC.api.rules.CSV_QUESTION_HEADER'), text('admImCols'));
  ok('the row ceiling is stated, not discovered',
     markup('admPanel').indexOf(String(run('GOC.api.rules.CSV_MAX_ROWS'))) > -1);
  ok('and it says plainly that importing adds rather than replaces',
     markup('admPanel').indexOf('never edits or removes') > -1);
  set('admImKind', 'notes');
  run('admImKindSet')();
  ok('choosing notes swaps the columns',
     text('admImCols') === run('GOC.api.rules.CSV_NOTE_HEADER'), text('admImCols'));
  ok('and explains how a paragraph is carried', text('admImNote').indexOf('\\n') > -1, text('admImNote'));
  run('admImTemplate')();
  ok('the template is a real file, not a picture of one',
     id('admImCsv').value.indexOf(run('GOC.api.rules.CSV_NOTE_HEADER')) === 0);
  run('admImRun')();
  await flush();
  await flush();
  ok('the template imports as it stands', text('toast') === '1 of 1 row imported', text('toast'));
  ok('the outcome is reported as counts', text('admImOut').indexOf('Rows read') > -1 &&
     text('admImOut').indexOf('Published') > -1 && text('admImOut').indexOf('Skipped') > -1,
     text('admImOut'));
  ok('and says every row was accepted', text('admImOut').indexOf('Every row was accepted') > -1);
  var withTpl = await api('listAllNotes')({ subject: 'Physics' });
  ok('the note it carried is on the record', withTpl.notes.length === 4, withTpl.notes.length);
  var tplNote = withTpl.notes.filter(function (n) { return n.title === 'Acceleration' && n.id > 10; })[0];
  ok('the two characters a spreadsheet writes became a real paragraph break',
     tplNote && tplNote.body.indexOf('\n\n') > -1 && tplNote.body.indexOf('\\n') === -1,
     tplNote && tplNote.body.slice(0, 90));
  head('a file of questions: the good rows publish, the bad ones are named');
  set('admImKind', 'questions');
  run('admImKindSet')();
  var CSV = run('GOC.api.rules.CSV_QUESTION_HEADER') + '\n'
    + 'Physics,objective,Waves,What does a wave transfer?,Energy,Matter,Mass,Charge,,A,,,easy,A wave moves energy and not matter.,yes\n'
    + 'Physics,theory,Waves,Define wavelength.,,,,,,,The distance between two successive points in phase.,5,medium,,yes\n'
    + 'Physics,objective,Waves,A question with only one option offered,Energy,,,,,A,,,easy,,yes\n'
    + 'Zoology,objective,Waves,A subject the academy does not teach,Energy,Matter,Mass,Charge,,A,,,easy,,yes\n';
  var before = (await api('listQuestions')({ subject: 'Physics' })).questions.length;
  set('admImCsv', CSV);
  run('admImRun')();
  await flush();
  await flush();
  ok('every row is read and the outcome counted',
     text('toast') === '2 of 4 rows imported', text('toast'));
  ok('the two sound rows published', text('admImOut').indexOf('2 questions') > -1, text('admImOut'));
  ok('the row offering one option is refused by line number',
     text('admImOut').indexOf('Line 4') > -1, text('admImOut'));
  ok('so is the row naming a subject the academy does not teach',
     text('admImOut').indexOf('Line 5') > -1, text('admImOut'));
  ok('and each refusal carries the same reason the form would give',
     /option|subject/i.test(text('admImOut')), text('admImOut'));
  ok('what passed is not held hostage to what failed',
     text('admImOut').indexOf('already published') > -1);
  var after = await api('listQuestions')({ subject: 'Physics' });
  ok('exactly two questions were added', after.questions.length === before + 2,
     before + ' → ' + after.questions.length);
  var impObj = after.questions.filter(function (q) { return q.text.indexOf('What does a wave transfer') === 0; })[0];
  ok('the imported objective question kept its four options',
     impObj && impObj.options.length === 4, impObj && impObj.options.length);
  ok('the answer letter became the position management would have picked',
     impObj && impObj.answer === 0, impObj && impObj.answer);
  ok('it is live, so a student meets it', impObj && impObj.active === true);
  var impThy = after.questions.filter(function (q) { return q.text.indexOf('Define wavelength') === 0; })[0];
  ok('the imported theory question carries its reference answer',
     impThy && impThy.expected.indexOf('successive points') > -1);
  ok('and the maximum mark it will be marked out of', impThy && impThy.maxMark === 5, impThy && impThy.maxMark);
  ok('the bank list on screen was repainted, not left stale',
     markup('admQList') === '' || count('admQList', '.ad-q') !== 9);
  head('CSV import can be restricted to one subject and section');
  ['admImTarget'].forEach(function (x) { ok('#' + x + ' exists', !!id(x)); });
  ok('left on "Any", the note says the file decides',
     text('admImTarget').indexOf('take it from the file') > -1 ||
     markup('admImTarget').indexOf('Any') > -1, markup('admImTarget'));
  run("admImSetSubject('Physics')");
  run("admImSetSection('objective')");
  ok('choosing a subject and section repaints the note',
     markup('admImTarget').indexOf('skipped and reported below') > -1, markup('admImTarget'));
  var TARGETED = run('GOC.api.rules.CSV_QUESTION_HEADER') + '\n'
    + 'Physics,objective,Waves,Which wave needs a medium to travel through?,Sound,Light,X-ray,Radio,,A,,,easy,,yes\n'
    + 'Physics,theory,Waves,State one property of transverse waves.,,,,,,,"They oscillate perpendicular to the direction of travel.",5,medium,,yes\n'
    + 'Chemistry,objective,Bonding,Which bond involves a shared electron pair?,Ionic,Covalent,Metallic,None,,B,,,easy,,yes\n';
  var beforeTarget = (await api('listQuestions')({ subject: 'Physics' })).questions.length;
  var beforeChem = (await api('listQuestions')({ subject: 'Chemistry' })).questions.length;
  set('admImCsv', TARGETED);
  run("admImFileName = null");
  run('admImRun')();
  await flush();
  await flush();
  ok('only the row matching the chosen subject and section is published',
     text('toast') === '1 of 3 rows imported', text('toast'));
  ok('the theory row is skipped for not matching the chosen section, by line number',
     text('admImOut').indexOf('Line 3') > -1 && text('admImOut').indexOf('not the chosen Physics / objective') > -1,
     text('admImOut'));
  ok('the Chemistry row is skipped for not matching the chosen subject, by line number',
     text('admImOut').indexOf('Line 4') > -1, text('admImOut'));
  var afterTarget = await api('listQuestions')({ subject: 'Physics' });
  var afterChem = await api('listQuestions')({ subject: 'Chemistry' });
  ok('exactly one Physics/objective question was added',
     afterTarget.questions.length === beforeTarget + 1, beforeTarget + ' → ' + afterTarget.questions.length);
  ok('nothing was added to Chemistry — the mismatched row was refused, not stamped',
     afterChem.questions.length === beforeChem, beforeChem + ' → ' + afterChem.questions.length);
  ok('the skipped theory row was not published under any subject',
     !afterTarget.questions.some(function (q) { return q.text.indexOf('transverse waves') > -1; }));
  run("admImSetSubject('')");
  run("admImSetSection('')");
  ok('the picker can be put back to "Any", restoring the old file-decides-everything import',
     markup('admImTarget').indexOf('take it from the file') > -1, markup('admImTarget'));
  head('import duplicate detection — the same file name and the same content, re-run');
  run("admImFileName = 'weekly-batch.csv'");
  var DUPCSV = run('GOC.api.rules.CSV_QUESTION_HEADER') + '\n'
    + 'Physics,objective,Waves,Which of these is a transverse wave?,Light,Sound,Both,Neither,,A,,,easy,,yes\n';
  var beforeDup = (await api('listQuestions')({ subject: 'Physics' })).questions.length;
  set('admImCsv', DUPCSV);
  run('admImRun')();
  await flush();
  await flush();
  ok('the first run of a named file imports normally',
     text('toast') === '1 of 1 row imported', text('toast'));
  var afterFirstDup = await api('listQuestions')({ subject: 'Physics' });
  ok('exactly one question was added', afterFirstDup.questions.length === beforeDup + 1,
     beforeDup + ' → ' + afterFirstDup.questions.length);
  set('admImCsv', DUPCSV);
  run('admImRun')();
  await flush();
  await flush();
  ok('the exact same file name and content is recognised, not silently re-run',
     text('admImOut').indexOf('already imported') > -1, text('admImOut'));
  ok('nothing new was published on the flagged run',
     (await api('listQuestions')({ subject: 'Physics' })).questions.length === afterFirstDup.questions.length);
  run('admImRun')(true);
  await flush();
  await flush();
  ok('"Import anyway" imports it unconditionally',
     text('toast') === '1 of 1 row imported', text('toast'));
  ok('the duplicate is now published too, once confirmed',
     (await api('listQuestions')({ subject: 'Physics' })).questions.length === afterFirstDup.questions.length + 1);
  var DUPCSV2 = DUPCSV + 'Physics,objective,Waves,A second question so the content differs,Light,Sound,Both,Neither,,B,,,easy,,yes\n';
  set('admImCsv', DUPCSV2);
  run('admImRun')();
  await flush();
  await flush();
  ok('the same file name with different content is not treated as a duplicate',
     text('toast') === '2 of 2 rows imported', text('toast'));
  run("admImFileName = null");
  set('admImCsv', DUPCSV);
  run('admImRun')();
  await flush();
  await flush();
  ok('a paste with no file name is never flagged as a duplicate, even with identical content',
     text('admImOut').indexOf('already imported') === -1, text('admImOut'));

  head('a file that cannot be read is refused whole, and nothing is guessed');
  var held = (await api('listQuestions')({ subject: 'Physics' })).questions.length;
  set('admImCsv', 'subject,topic\nPhysics,Waves\n');
  run('admImRun')();
  await flush();
  await flush();
  ok('a file missing a required column is refused',
     text('admImOut').indexOf('missing a column') > -1, text('admImOut'));
  ok('and it names the column and the expected header',
     text('admImOut').indexOf('text') > -1 && text('admImOut').indexOf('optionA') > -1);
  set('admImCsv', run('GOC.api.rules.CSV_QUESTION_HEADER') + '\n');
  run('admImRun')();
  await flush();
  await flush();
  ok('a header with no rows under it is refused',
     text('admImOut').indexOf('holds no rows') > -1, text('admImOut'));
  ok('no refusal published anything',
     (await api('listQuestions')({ subject: 'Physics' })).questions.length === held);
  run('admImClear')();
  ok('clearing empties the file box', id('admImCsv').value === '', id('admImCsv').value);
  ok('and the last outcome with it', markup('admImOut') === '', markup('admImOut'));

  head('importing is a console action, refused like every other one');
  await api('lockConsole')();
  var lockedIm = await api('importQuestions')(CSV).then(function () { return '(imported!)'; },
                                                        function (e) { return e.message; });
  ok('a locked console cannot import', lockedIm.indexOf('access passcode') > -1, lockedIm);
  var lockedNt = await api('importNotes')('x').then(function () { return '(imported!)'; },
                                                    function (e) { return e.message; });
  ok('nor import notes', lockedNt.indexOf('access passcode') > -1, lockedNt);
  await api('logout')();
  var outIm = await api('importQuestions')(CSV).then(function () { return '(imported!)'; },
                                                     function (e) { return e.message; });
  ok('signed out, importing is refused', outIm.indexOf('Management accounts only') > -1, outIm);
  await api('login')(SID, SPW);
  var stuIm = await api('importQuestions')(CSV).then(function () { return '(imported!)'; },
                                                     function (e) { return e.message; });
  ok('a student account cannot import a question bank',
     stuIm.indexOf('Management accounts only') > -1, stuIm);
  var stuNt = await api('importNotes')('x').then(function () { return '(imported!)'; },
                                                 function (e) { return e.message; });
  ok('nor a file of notes', stuNt.indexOf('Management accounts only') > -1, stuNt);
  head('what the student is served, now that the notes are real');
  var tile = read('index.html').split('openReading()')[1] || '';
  ok('Read / Learn is a live tile, not a promise', tile.indexOf('Read / Learn') > -1);
  ok('and no longer advertises itself as coming soon',
     tile.slice(0, 400).indexOf('Coming soon') < 0 &&
     read('index.html').indexOf("comingSoon('Read / Learn')") < 0);
  ok('the console offers both new sections',
     read('index.html').indexOf('<option value="notes">') > -1 &&
     read('index.html').indexOf('<option value="import">') > -1);
  var served = await api('listNotes')({ subject: 'Physics' });
  ok('the student is served the readable notes', served.notes.length === 3, served.notes.length);
  ok('the note held back is not among them',
     !served.notes.some(function (n) { return n.id === NID; }),
     served.notes.map(function (n) { return n.id; }).join(','));
  ok('the imported note is', served.notes.some(function (n) { return n.title === 'Acceleration' && n.id > 10; }));
  ok('every note the student gets carries its topic and its body',
     served.notes.every(function (n) { return !!n.topic && String(n.body).length > 40; }));
  var cat = await api('studyCatalogue')();
  var phys = (cat.reading || []).filter(function (e) { return e.subject === 'Physics'; })[0];
  ok('the reading catalogue counts what is readable, not what exists',
     phys && phys.notes === 3, phys && phys.notes);
  ok('and reading mode is reachable for this account', !!run('openReading'));


  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

main().catch(function (e) {
  console.log('\nTHREW: ' + (e && e.stack || e));
  process.exit(1);
});

