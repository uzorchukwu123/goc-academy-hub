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
  adminActivities: function () { return Promise.resolve({ activities: [] }); },
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

  head('Only activity saves were attempted — nothing else was written');
  ok('every recorded call is an activity save', saves.every(function (s) { return s[0] && s[0].kind; }));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('\nHARNESS ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});