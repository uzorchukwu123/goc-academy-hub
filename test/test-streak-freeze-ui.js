/* test-streak-freeze-ui.js — Phase 2, streak freeze slice 5: the Profile screen
   shows how many freezes are held and lets a student buy one. Checks the
   markup, then runs the real paintFreeze / buyFreeze from js/app.js against a
   stub page and stub GOC.api.   node test/test-streak-freeze-ui.js  */
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

console.log('\nStreak freeze on the Profile screen');
ok('the row, note and button exist in the page',
  /id="freezeRow"/.test(html) && /id="freezeNote"/.test(html) && /id="freezeBuyBtn"/.test(html));
ok('the button calls buyFreeze()', /id="freezeBuyBtn"[^>]*onclick="buyFreeze\(\)"/.test(html));
ok('the row sits inside the Profile screen',
  html.indexOf('id="freezeRow"') > html.indexOf('id="profile"') && html.indexOf('id="freezeRow"') < html.indexOf('id="limitVal"') + 3000);
ok('the profile refresh paints it', /paintFreeze\(me\)/.test(app));

function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}
var els = { freezeNote: { textContent: '' }, freezeBuyBtn: { textContent: '', disabled: false } };
var toasts = [], refreshed = 0, profileRepaints = 0, buyImpl;
var sandbox = {
  role: 'student',
  document: { getElementById: function (id) { return els[id] || null; } },
  GOC: { core: { STREAK_FREEZE_COST_XP: 100, STREAK_FREEZE_MAX: 2 },
         api: { buyStreakFreeze: function () { return buyImpl(); } } },
  toast: function (m) { toasts.push(m); },
  refreshMe: function () { refreshed++; },
  renderProfileBadges: function () { profileRepaints++; },
  Promise: Promise
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('paintFreeze') + '\n' + grab('buyFreeze'), ctx);

sandbox.paintFreeze({ streakFreezes: 1 });
ok('shows the held count, the cap and the cost',
  /holding 1 of 2/.test(els.freezeNote.textContent) && /100 XP/.test(els.freezeNote.textContent), els.freezeNote.textContent);
ok('one held: the button still offers another', els.freezeBuyBtn.textContent === 'Get one' && !els.freezeBuyBtn.disabled);
sandbox.paintFreeze({ streakFreezes: 2 });
ok('at the cap: the button reads Full and is disabled', els.freezeBuyBtn.textContent === 'Full' && els.freezeBuyBtn.disabled);
sandbox.paintFreeze({});
ok('no field (older server): treated as none held', /holding 0 of 2/.test(els.freezeNote.textContent));

buyImpl = function () { return Promise.resolve({ ok: true, xp: 30, streakFreezes: 1 }); };
sandbox.buyFreeze();
Promise.resolve().then(function () {}).then(function () {}).then(function () {
  ok('a successful buy tells the student', toasts.length === 1 && /1 held/.test(toasts[0]), toasts.join('|'));
  ok('and re-reads XP and shows the new count', refreshed === 1 && /holding 1 of 2/.test(els.freezeNote.textContent));
  buyImpl = function () { return Promise.reject(new Error('A streak freeze costs 100 XP.')); };
  els.freezeBuyBtn.disabled = false;
  sandbox.buyFreeze();
  return Promise.resolve().then(function () {}).then(function () {}).then(function () {});
}).then(function () {
  ok('a refusal shows the server\'s own message', toasts[1] === 'A streak freeze costs 100 XP.', toasts.join('|'));
  ok('and the button is usable again', els.freezeBuyBtn.disabled === false);
  sandbox.role = 'admin';
  var before = toasts.length;
  sandbox.buyFreeze();
  ok('a non-student does nothing', toasts.length === before);
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
});
