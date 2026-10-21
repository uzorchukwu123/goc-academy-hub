/* test-sit-rules-ui.js — Phase 3, Web Test sit rules slice 3: the Web Test card
   shows "Submitted" for a closed paper and "Sit again" with an attempt count for
   the JAMB-oriented rehearsal.   node test/test-sit-rules-ui.js */
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

console.log('\nTheory / Objective: closed for good');
var done = row(Object.assign({ section: 'objective', subject: 'All', completed: true, repeatable: false, attempts: 1 }, base));
ok('a completed paper reads "Submitted" and is disabled', done.btn.textContent === 'Submitted' && done.btn.disabled === true);
ok('and says nothing about sitting again', !/sit it again/.test(done.nm.innerHTML));
var fresh = row(Object.assign({ section: 'objective', subject: 'All', completed: false, repeatable: false, attempts: 0 }, base));
ok('an unsat paper reads "Start"', fresh.btn.textContent === 'Start' && !fresh.btn.disabled && typeof fresh.btn.onclick === 'function');

console.log('\nJAMB-oriented: a rehearsal');
var j0 = row(Object.assign({ section: 'jamb', subject: 'All', completed: false, repeatable: true, attempts: 0 }, base));
ok('never sat: "Start", no count line', j0.btn.textContent === 'Start' && !/Sat \d/.test(j0.nm.innerHTML));
var j1 = row(Object.assign({ section: 'jamb', subject: 'All', completed: false, repeatable: true, attempts: 1 }, base));
ok('sat once: "Sit again" and "Sat 1 time"', j1.btn.textContent === 'Sit again' && /Sat 1 time(?!s)/.test(j1.nm.innerHTML), j1.nm.innerHTML);
ok('the button is enabled and wired', !j1.btn.disabled && typeof j1.btn.onclick === 'function');
ok('it takes the retake style', /retake/.test(j1.btn.className));
var j3 = row(Object.assign({ section: 'jamb', subject: 'All', completed: false, repeatable: true, attempts: 3 }, base));
ok('sat three times: "Sat 3 times"', /Sat 3 times/.test(j3.nm.innerHTML), j3.nm.innerHTML);
sandbox.state.studyExhausted = true;
var jx = row(Object.assign({ section: 'jamb', subject: 'All', completed: false, repeatable: true, attempts: 2 }, base));
ok('a used-up study window still blocks it', jx.btn.textContent === 'Window used up' && jx.btn.disabled === true);
sandbox.state.studyExhausted = false;

console.log('\nOld drivers without the new fields');
var legacy = row(Object.assign({ section: 'jamb', subject: 'All', completed: true }, base));
ok('a row with only `completed` still reads "Submitted"', legacy.btn.textContent === 'Submitted' && legacy.btn.disabled === true);

console.log('\nBefore-you-start card');
var ri = sandbox.wtInstructions(Object.assign({ section: 'jamb', subject: 'All', repeatable: true }, base)).rules;
ok('the rehearsal says every attempt is kept', ri.some(function (r) { return /every attempt is kept/.test(r); }));
var ro = sandbox.wtInstructions(Object.assign({ section: 'objective', subject: 'All', repeatable: false }, base)).rules;
ok('Objective carries no rehearsal line, and no empty rule', !ro.some(function (r) { return /rehearsal/.test(r); }) && ro.every(Boolean));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
