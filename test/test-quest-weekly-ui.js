/* test-quest-weekly-ui.js — Phase 2, weekly quest slice 5: the read-only Weekly quest
   card on the Study hub and the results-screen row. Checks the markup, then runs
   the real paintWeekly / refreshWeekly / weeklyRow from js/app.js against a stub
   page and stub GOC.api.
   node test/test-quest-weekly-ui.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html'), app = read('js/app.js');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

console.log('\nWeekly quest card on the Study hub');
var studyAt = html.indexOf('id="study"'), setAt = html.indexOf('id="studySet"');
['weekCard', 'weekText', 'weekBar', 'weekNote'].forEach(function (id) {
  var at = html.indexOf('id="' + id + '"');
  ok(id + ' exists inside the Study screen', at > studyAt && at < setAt);
});
ok('the weekly card sits below the daily card', html.indexOf('id="weekCard"') > html.indexOf('id="questCard"'));
ok('the card starts hidden', /id="weekCard"[^>]*display:none/.test(html));
ok('opening the Study hub refreshes it', /id === 'study' && typeof refreshWeekly === 'function'\) refreshWeekly\(\)/.test(app));
ok('the results screen asks for the weekly row', /var wr = weeklyRow\(res\);\s*if\(wr\) rows\.push\(wr\);/.test(app));

function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
var els = {
  weekCard: { style: { display: 'none' } }, weekText: { textContent: '' },
  weekBar: { style: { width: '' } }, weekNote: { textContent: '' }
};
var getImpl;
var sandbox = {
  studentId: 'GOC-1',
  document: { getElementById: function (id) { return els[id] || null; } },
  GOC: { api: { getWeeklyQuest: function () { return getImpl(); } } },
  Promise: Promise, Math: Math, Number: Number
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('paintWeekly') + '\n' + grab('refreshWeekly') + '\n' + grab('weeklyRow'), ctx);

function wq(o) {
  return { weeklyQuest: Object.assign({ week: '2026-10-05', endsOn: '2026-10-11', days: 0, questions: 0, targetDays: 5, targetQuestions: 100, done: false, claimed: false, reward: 1 }, o) };
}

sandbox.paintWeekly(wq({ days: 2, questions: 37 }));
ok('it states both ways to finish', /5 daily quests or answer 100 questions this week/.test(els.weekText.textContent), els.weekText.textContent);
ok('the note shows both counts and the Sunday end', /2 of 5 daily quests/.test(els.weekNote.textContent) && /37 of 100 questions/.test(els.weekNote.textContent) && /Sunday/.test(els.weekNote.textContent), els.weekNote.textContent);
ok('the bar follows whichever target is closer (37%)', els.weekBar.style.width === '40%' || els.weekBar.style.width === '37%', els.weekBar.style.width);
ok('the card is shown', els.weekCard.style.display === '');

sandbox.paintWeekly(wq({ days: 1, questions: 80 }));
ok('questions closer than days: the bar shows 80%', els.weekBar.style.width === '80%', els.weekBar.style.width);
sandbox.paintWeekly(wq({ days: 0, questions: 0 }));
ok('an empty week is an empty bar', els.weekBar.style.width === '0%');
sandbox.paintWeekly(wq({ days: 5, questions: 20, done: true, claimed: true }));
ok('done and paid: full bar and says the freeze was added', els.weekBar.style.width === '100%' && /freeze for this week has been added/.test(els.weekNote.textContent), els.weekNote.textContent);
sandbox.paintWeekly(wq({ days: 3, questions: 140, done: true, claimed: false }));
ok('done but waiting at the cap: says so, bar never past full', els.weekBar.style.width === '100%' && /most streak freezes/.test(els.weekNote.textContent), els.weekNote.textContent);

sandbox.paintWeekly(null);
ok('nothing hides the card', els.weekCard.style.display === 'none');
sandbox.paintWeekly({});
ok('an empty object hides it too', els.weekCard.style.display === 'none');

console.log('\nResults row');
var base = { mode: 'practice', weekQuest: { done: false, claimed: false } };
ok('mid-week, nothing to say', sandbox.weeklyRow(base) === null);
var paid = sandbox.weeklyRow({ mode: 'practice', weekClaimed: true, freezeAwarded: 1, weekQuest: { done: true, claimed: true } });
ok('the run that finishes the week says a freeze was earned', paid && paid[0] === 'Weekly quest' && /\+1 streak freeze/.test(paid[1]), JSON.stringify(paid));
var wait = sandbox.weeklyRow({ mode: 'practice', weekClaimed: false, weekQuest: { done: true, claimed: false } });
ok('a finished week waiting for room says so', wait && /once you have room/.test(wait[1]), JSON.stringify(wait));
ok('a later run after the freeze was paid says nothing', sandbox.weeklyRow({ mode: 'practice', weekClaimed: false, weekQuest: { done: true, claimed: true } }) === null);
ok('CBT set-up shows nothing', sandbox.weeklyRow({ mode: 'cbt', weekClaimed: true, weekQuest: { done: true } }) === null);
ok('a result reopened from history shows nothing', sandbox.weeklyRow({ mode: 'practice' }) === null && sandbox.weeklyRow(null) === null);

getImpl = function () { return Promise.resolve(wq({ days: 1, questions: 10 })); };
sandbox.refreshWeekly().then(function () {
  ok('refreshWeekly paints what the server returned', els.weekCard.style.display === '' && /1 of 5 daily quests/.test(els.weekNote.textContent));
  getImpl = function () { return Promise.reject(new Error('offline')); };
  return sandbox.refreshWeekly();
}).then(function () {
  ok('offline: the card is left as it was', els.weekCard.style.display === '' && /1 of 5 daily quests/.test(els.weekNote.textContent));
  sandbox.studentId = null;
  return sandbox.refreshWeekly();
}).then(function () {
  ok('signed out: the card is hidden', els.weekCard.style.display === 'none');
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
});
