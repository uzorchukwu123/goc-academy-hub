/* test-sit-rules-ui.js — Phase 3, Web Test sit rules slice 3. The Web Test card
   ("Submitted" / "Sit again") was retired in the clean sweep; this now checks the
   card is gone and the JAMB CBT's before-you-start card.   node test/test-sit-rules-ui.js */
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
/* Clean sweep (Phase 2): the Web Test catalogue and its rows (wtRowEl) are
   retired, so the "Submitted" / "Sit again" row is gone with them. What is
   left of this slice is the JAMB CBT's own before-you-start card. */
console.log('\nthe retired Web Test rows');
ok('the catalogue row renderer is gone', app.indexOf('function wtRowEl(') < 0 && app.indexOf('function wtInstructions(') < 0);

var sandbox = {
  esc: function (x) { return String(x); },
  wtMinutes: function (sec) { return Math.round(sec / 60) + ' min'; },
  wtSectionLabel: function (s) { return s; },
  showTestInfo: function () {},
  Number: Number, String: String, Math: Math
};
var ctx = vm.createContext(sandbox);
vm.runInContext(grab('wtPapersLine') + '\n' + grab('jambInstructions'), ctx);
var base = { period: 'test', questions: 40, durationSec: 3600 };

console.log('\nJAMB CBT before-you-start card');
var ri = sandbox.jambInstructions(Object.assign({ section: 'jamb', subject: 'All', repeatable: true }, base)).rules;
ok('the rehearsal says every attempt is kept', ri.some(function (r) { return /every attempt is kept/.test(r); }));
ok('it names the examination-room keys', ri.some(function (r) { return /A, B, C or D answers a question/.test(r); }));
var rn = sandbox.jambInstructions(Object.assign({ section: 'jamb', subject: 'All', repeatable: false }, base)).rules;
ok('a non-repeatable sitting carries no rehearsal line, and no empty rule', !rn.some(function (r) { return /rehearsal/.test(r); }) && rn.every(Boolean));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
