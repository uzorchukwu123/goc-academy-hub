/* test-free2027-activity-pool.js — the Competition activity POOL form.
 *
 * The activity pool is no longer capped at 180: an administrator may allocate
 * any positive whole number the eligible Competition Question Bank supports,
 * while each candidate still sits the standard 180-question paper. This drives
 * the REAL admin editor against the repository's small DOM.
 *
 * node test/test-free2027-activity-pool.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var rules = require(path.join(APP, 'js', 'goc-free-2027.js'));
var src = fs.readFileSync(path.join(APP, 'js', 'free2027-admin.js'), 'utf8');
var dom = require('./minidom.js');

var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 240) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function tick() { var p = Promise.resolve(); for (var i = 0; i < 30; i++) p = p.then(function () {}); return p; }

var SUBJECTS = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
/* 220 eligible competition questions: 60 English + 40 of each other subject. */
var ELIGIBLE = { 'Use of English': 60, Mathematics: 40, Physics: 40, Chemistry: 40, Biology: 40 };

var doc = new dom.Doc();
var sheet = new dom.El('div', { id: 'admSheetBody' });
var panel = new dom.El('div', { id: 'f27AdmBody' });
doc.body.appendChild(sheet);
sheet.appendChild(panel);

var saves = [], messages = [];
var activityRows = [];
var api = {
  adminBanks: function () {
    return Promise.resolve({
      subjects: SUBJECTS,
      banks: {
        competition: { count: 220, eligibleCount: 220, bySubject: ELIGIBLE, eligibleBySubject: ELIGIBLE },
        weekly: { count: 140, eligibleCount: 140, bySubject: ELIGIBLE, eligibleBySubject: ELIGIBLE }
      }
    });
  },
  adminActivities: function () { return Promise.resolve({ activities: activityRows }); },
  adminLessons: function () { return Promise.resolve({ lessons: [] }); },
  saveActivity: function (payload, id) {
    saves.push([JSON.parse(JSON.stringify(payload)), id || null]);
    return Promise.resolve({ activity: Object.assign({ id: 'F27-Q1' }, payload) });
  }
};
var sandbox = {
  console: console, document: doc, readyState: 'complete',
  admMe: { id: 'GOC-A-001', roleKey: 'founder' }, mode: 'free2027',
  GOC: { free2027: rules, free: api, api: { ready: Promise.resolve() } },
  toast: function (m) { messages.push(String(m)); },
  confirm: function () { return true; },
  setTimeout: function (fn) { return 0; }, clearTimeout: function () {},
  Promise: Promise, Date: Date, Math: Math, JSON: JSON
};
sandbox.window = sandbox;
dom.El.prototype.scrollIntoView = function () {};
var ctx = vm.createContext(sandbox);
vm.runInContext('var window = this; var global = this;', ctx);
vm.runInContext(src, ctx);

function el(id) { return doc.getElementById(id); }
function setCount(v) { el('f27Count').value = String(v); }
function setDist(vals) {
  SUBJECTS.forEach(function (s, i) {
    var box = el('f27Dist-' + i);
    if (box) box.value = vals && vals[s] !== undefined ? String(vals[s]) : '';
  });
}
function lastMessage() { return messages.length ? messages[messages.length - 1] : ''; }

(async function () {
  head('The Competition activity form is bounded by the eligible bank, not by 180');
  sandbox.f27AdmStartActivity('competition');
  await tick();
  ok('the editor renders a question-count field', !!el('f27Count'));
  ok('its maximum is the eligible bank count, not 180', el('f27Count').getAttribute('max') === '220',
    el('f27Count').getAttribute('max'));
  ok('the minimum is still 1', el('f27Count').getAttribute('min') === '1');
  ok('the form displays the actual available eligible count',
    /220/.test(el('f27Availability').innerHTML), el('f27Availability').innerHTML.slice(0, 200));
  ok('the count note names the real maximum',
    /up to 220/.test(el('f27CountNote') ? el('f27CountNote').textContent : ''),
    el('f27CountNote') ? el('f27CountNote').textContent : '(missing)');
  ok('the form explains that the pool may exceed one paper',
    /180/.test(el('f27CountNote') ? el('f27CountNote').textContent : ''));

  head('A 220-question pool is accepted by the form');
  el('f27Title').value = 'Competition 001';
  setCount(220);
  setDist(ELIGIBLE);
  var before = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('saving 220 questions reaches the server', saves.length === before + 1, JSON.stringify(messages.slice(-2)));
  ok('the payload carries the full pool size', saves.length > before && saves[saves.length - 1][0].questionCount === 220,
    JSON.stringify(saves[saves.length - 1] || []).slice(0, 200));
  ok('and the five-subject distribution that totals it',
    saves.length > before && Object.keys(saves[saves.length - 1][0].subjectDistribution || {}).length === 5);

  head('The bank availability limit is still enforced');
  sandbox.f27AdmStartActivity('competition');
  await tick();
  el('f27Title').value = 'Too many';
  setCount(221);
  setDist(null);
  var beforeOver = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('one more than the eligible bank is refused in the form', saves.length === beforeOver,
    JSON.stringify(messages.slice(-1)));
  ok('and the message names the real ceiling', /220/.test(lastMessage()), lastMessage());

  head('Invalid counts are still refused');
  var invalid = [0, -5, 'abc', ''];
  for (var i = 0; i < invalid.length; i++) {
    sandbox.f27AdmStartActivity('competition');
    await tick();
    el('f27Title').value = 'Invalid count';
    setCount(invalid[i]);
    setDist(null);
    var b = saves.length;
    sandbox.f27AdmSaveActivity(null);
    await tick();
    ok('a count of "' + invalid[i] + '" is refused', saves.length === b, lastMessage());
  }

  head('The distribution must still add up to the pool');
  sandbox.f27AdmStartActivity('competition');
  await tick();
  el('f27Title').value = 'Mismatched distribution';
  setCount(220);
  setDist({ 'Use of English': 60, Mathematics: 40, Physics: 40, Chemistry: 40 });
  var b2 = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('a distribution totalling 180 against a 220 pool is refused', saves.length === b2, lastMessage());
  ok('and the message says it must add up', /add up/i.test(lastMessage()), lastMessage());

  head('A subject allocation above its own eligible count is refused');
  sandbox.f27AdmStartActivity('competition');
  await tick();
  el('f27Title').value = 'Subject over allocation';
  setCount(220);
  setDist({ 'Use of English': 100, Mathematics: 40, Physics: 40, Chemistry: 20, Biology: 20 });
  var b3 = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('100 English questions against 60 eligible is refused', saves.length === b3, lastMessage());
  ok('naming the short subject', /Use of English/.test(lastMessage()), lastMessage());

  head('Weekly Assessments keep exactly the cap they had');
  sandbox.f27AdmStartActivity('weekly');
  await tick();
  ok('the weekly count field is still capped at 100', el('f27Count').getAttribute('max') === '100',
    el('f27Count').getAttribute('max'));
  el('f27Title').value = 'Weekly over cap';
  setCount(101);
  setDist(null);
  var b4 = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('a 101-question weekly assessment is still refused', saves.length === b4, lastMessage());
  ok('and the weekly note does not mention a competition pool',
    !/180/.test(el('f27CountNote') ? el('f27CountNote').textContent : ''),
    el('f27CountNote') ? el('f27CountNote').textContent : '(missing)');

  head('Weekly wording distinguishes the five-subject activity pool from a student paper');
  sandbox.f27AdmStartActivity('weekly');
  await tick();
  setCount(50);
  sandbox.f27AdmEditorRead();
  var weeklyHelp = 'Enter the total number of questions to allocate across all five subjects. Each student receives only questions from their registered subject combination.';
  ok('the weekly field is labelled Activity Question Pool Size',
    !!doc.querySelector('label[for="f27Count"]') &&
    doc.querySelector('label[for="f27Count"]').textContent === 'Activity Question Pool Size',
    doc.querySelector('label[for="f27Count"]') ? doc.querySelector('label[for="f27Count"]').textContent : '(missing)');
  ok('entering 50 keeps the required five-subject explanation after availability loads',
    el('f27Count').value === '50' && el('f27CountNote').textContent.indexOf(weeklyHelp) === 0,
    el('f27CountNote').textContent);
  ok('the blank-distribution note explains the even five-subject allocation',
    /blank to allocate the activity pool evenly across all five subjects/i.test(el('f27DistNote') ? el('f27DistNote').textContent : ''),
    el('f27DistNote') ? el('f27DistNote').textContent : '(missing)');
  el('f27Title').value = 'Weekly Assessment 001';
  setDist(null);
  var weeklyBefore = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('the clarified wording leaves the saved pool count and allocation payload unchanged',
    saves.length === weeklyBefore + 1 && saves[saves.length - 1][0].questionCount === 50 &&
    saves[saves.length - 1][0].subjectDistribution === null,
    JSON.stringify(saves[saves.length - 1] || []));

  head('Weekly validation uses the pool-size wording without changing its limits');
  sandbox.f27AdmStartActivity('weekly');
  await tick();
  setCount(0);
  var invalidWeeklyBefore = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('an invalid weekly pool is still refused', saves.length === invalidWeeklyBefore);
  ok('and the message names the activity question pool size',
    /activity question pool size/i.test(lastMessage()), lastMessage());
  setCount(50);
  setDist({ 'Use of English': 10, Mathematics: 10, Physics: 10, Chemistry: 10 });
  var mismatchWeeklyBefore = saves.length;
  sandbox.f27AdmSaveActivity(null);
  await tick();
  ok('a mismatched weekly distribution is still refused', saves.length === mismatchWeeklyBefore);
  ok('and its message refers to the activity question pool size',
    /add up to the activity question pool size \(50\)/i.test(lastMessage()), lastMessage());

  head('Switching the editor back to Competition preserves every Competition wording');
  sandbox.f27AdmStartActivity('weekly');
  await tick();
  el('f27Kind').value = 'competition';
  sandbox.f27AdmEditorRead();
  sandbox.f27AdmLoadAvailability();
  await tick();
  ok('the Competition label is still Number of questions',
    doc.querySelector('label[for="f27Count"]').textContent === 'Number of questions',
    doc.querySelector('label[for="f27Count"]').textContent);
  ok('the Competition availability and 180-question paper note is unchanged',
    el('f27CountNote').textContent === 'Available eligible questions in this category’s bank: 220. You may allocate up to 220. A competition pool may be larger than one paper: each candidate still sits the standard 180-question paper from their own subject combination.',
    el('f27CountNote').textContent);
  ok('the Competition distribution note is unchanged',
    el('f27DistNote').textContent === 'Leave every box blank to draw from all eligible questions. If used, the counts must add up to the number of questions.',
    el('f27DistNote').textContent);

  head('The activity list labels only Weekly counts as activity pools');
  activityRows = [
    { id: 'W-WORDS', kind: 'weekly', title: 'Weekly wording', questionCount: 50, durationMin: 120, maxAttempts: 1, state: 'open', status: 'published', published: true, attempts: 0, opensAt: 1, closesAt: 9999999999999, leaderboard: {} },
    { id: 'C-WORDS', kind: 'competition', title: 'Competition wording', questionCount: 220, durationMin: 120, maxAttempts: 1, state: 'open', status: 'published', published: true, attempts: 0, opensAt: 1, closesAt: 9999999999999, leaderboard: { approved: false, published: false } }
  ];
  sandbox.f27AdmCancelEdit();
  sandbox.f27AdmTab('activities');
  await tick();
  ok('the Weekly row says 50-question activity pool',
    /Weekly Assessment · 50-question activity pool · 120 min/.test(panel.innerHTML), panel.innerHTML.slice(0, 500));
  ok('the Competition row still says 220 questions',
    /Competition · 220 questions · 120 min/.test(panel.innerHTML), panel.innerHTML.slice(0, 500));

  head('Only activity saves were attempted — nothing else was written');
  ok('every recorded call is an activity save', saves.every(function (s) { return s[0] && s[0].kind; }));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('\nHARNESS ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});