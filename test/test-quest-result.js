/* test-quest-result.js — Phase 2, daily quest slice 6: the quest bonus is
   shown on the practice results screen. Runs the real questRow and srShow
   from js/app.js against a stub page.
   node test/test-quest-result.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}

var els = { srTitle: {}, srSub: {}, srStats: {}, srBrk: {}, srReview: {} };
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  savePracResult: function () {}, go: function () {}, mmss: String, hexA: String,
  esc: function (x) { return String(x); }, mth: function (x) { return String(x == null ? '' : x); },
  Number: Number, Math: Math, String: String
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('questRow') + '\n' + grab('weeklyRow') + '\n' + grab('challengeRow') + '\n' + grab('srShow'), ctx);

console.log('\nquestRow wording');
var base = { mode: 'practice', questClaimed: false, questDone: false, questXp: 0 };
function mk(o) { var r = {}; for (var k in base) r[k] = base[k]; for (var k2 in o) r[k2] = o[k2]; return r; }

var r1 = sandbox.questRow(mk({ questClaimed: true, questDone: true, questXp: 20 }));
ok('claimed with a bonus shows +20 XP', r1 && r1[0] === 'Daily quest' && /\+20 XP bonus/.test(r1[1]), JSON.stringify(r1));
var r2 = sandbox.questRow(mk({ questClaimed: true, questDone: true, questXp: 0 }));
ok('claimed with a full allowance says no bonus', r2 && /allowance was full/.test(r2[1]) && !/\+0/.test(r2[1]), JSON.stringify(r2));
var r3 = sandbox.questRow(mk({ questDone: true }));
ok('done earlier today says already completed', r3 && /Already completed today/.test(r3[1]), JSON.stringify(r3));
ok('not done: no row', sandbox.questRow(mk({})) === null);
ok('CBT set-up mode: no row', sandbox.questRow(mk({ mode: 'cbt', questClaimed: true, questXp: 20 })) === null);
ok('result from history (no quest fields): no row', sandbox.questRow({ mode: 'practice', total: 10 }) === null);
ok('null result: no row', sandbox.questRow(null) === null);

console.log('\nsrShow integration');
function show(o) {
  els.srStats.innerHTML = '';
  sandbox.srShow(mk(Object.assign({ subject: 'Physics', total: 10, answered: 10, correct: 7, wrong: 3, percent: 70,
    timeUsedSec: 60, xpAwarded: 15, xpLeftToday: 85, xpCapped: false, topics: [], review: [] }, o)), false);
  return els.srStats.innerHTML;
}
var h1 = show({ questClaimed: true, questDone: true, questXp: 20 });
ok('results screen shows the bonus row', /Daily quest/.test(h1) && /\+20 XP bonus/.test(h1));
ok('run XP row still shows the run XP only', /\+15 XP/.test(h1));
var h2 = show({});
ok('no quest activity: no quest row on screen', !/Daily quest/.test(h2));
var h3 = show({ mode: 'cbt', questClaimed: true, questXp: 20 });
ok('non-practice screen never shows it', !/Daily quest/.test(h3));

console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
