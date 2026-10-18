/* test-tiers-webtest-ui.js — Phase 3B: a Web Test row the server marks `locked` (Open student)
   reads "Locked · GOC", is disabled and says why.   node test/test-tiers-webtest-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
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
function fakeEl() {
  var el = { children: [], className: '', textContent: '', innerHTML: '', disabled: false, onclick: null,
    appendChild: function (c) { el.children.push(c); return c; } };
  return el;
}
var sandbox = {
  document: { createElement: function () { return fakeEl(); } },
  esc: function (x) { return String(x); },
  state: { studyExhausted: false },
  wtMinutes: function (sec) { return Math.round(sec / 60) + ' min'; },
  wtSectionLabel: function (s) { return s; },
  wtConfirmStart: function () {},
  showTestInfo: function () {},
  Number: Number, String: String, Math: Math
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('wtRowEl') + '\n' + grab('wtPapersLine') + '\n' + grab('wtInstructions'), ctx);

function row(t) { var r = sandbox.wtRowEl(t, false); return { nm: r.children[0], btn: r.children[1] }; }
var base = { period: 'test', questions: 40, durationSec: 3600 };

console.log('\nLocked rows (Open student)');
var lk = row(Object.assign({ section: 'objective', subject: 'All', completed: false, repeatable: false, attempts: 0, locked: true }, base));
ok('the button reads "Locked · GOC" and is disabled', lk.btn.textContent === 'Locked \u00b7 GOC' && lk.btn.disabled === true, lk.btn.textContent);
ok('it has no click handler', lk.btn.onclick === null);
ok('it takes the locked style', /locked/.test(lk.btn.className));
ok('the row says it is for GOC students', /For GOC students/.test(lk.nm.innerHTML), lk.nm.innerHTML);
var lj = row(Object.assign({ section: 'jamb', subject: 'All', completed: false, repeatable: true, attempts: 0, locked: true }, base));
ok('the JAMB mock is locked the same way', lj.btn.textContent === 'Locked \u00b7 GOC' && lj.btn.disabled === true);
sandbox.state.studyExhausted = true;
var lx = row(Object.assign({ section: 'objective', subject: 'All', locked: true }, base));
ok('locked wins over a used-up window', lx.btn.textContent === 'Locked \u00b7 GOC');
sandbox.state.studyExhausted = false;

console.log('\nUnlocked rows are untouched');
var gk = row(Object.assign({ section: 'objective', subject: 'All', completed: false, repeatable: false, attempts: 0 }, base));
ok('a GOC row still reads "Start", wired, with no GOC line', gk.btn.textContent === 'Start' && !gk.btn.disabled && typeof gk.btn.onclick === 'function' && !/For GOC/.test(gk.nm.innerHTML));
var gd = row(Object.assign({ section: 'objective', subject: 'All', completed: true, locked: false }, base));
ok('a submitted GOC row still reads "Submitted"', gd.btn.textContent === 'Submitted');

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
