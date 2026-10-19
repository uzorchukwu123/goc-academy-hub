/* test-challenge-result.js — Phase 4.C: the Team challenge row on the practice results screen.
   Runs the real challengeRow from js/app.js. node test/test-challenge-result.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js/app.js'), 'utf8');
var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + x + ')' : '')); } }
function grab(name) {
  var i = app.indexOf('function ' + name + '('), d = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) { if (app[k] === '{') d++; else if (app[k] === '}') { d--; if (d === 0) return app.slice(i, k + 1); } }
}
var ctx = vm.createContext({ Number: Number });
vm.runInContext(grab('challengeRow'), ctx);
var row = ctx.challengeRow;
function res(c, mode) { return { mode: mode || 'practice', challenge: c }; }

console.log('\nTeam challenge results row');
ok('wired into the results screen', /var cr = challengeRow\(res\);\s*if\(cr\) rows\.push\(cr\);/.test(app));
ok('no challenge: no row', row(res(null)) === null && row({ mode: 'practice' }) === null && row(null) === null);
ok('CBT set-up never shows it', row(res({ added: 5, teamTotal: 5, goal: 50 }, 'cbt')) === null);
var r = row(res({ title: 'T', added: 8, teamTotal: 31, goal: 100, done: false, freezeAwarded: 0 }));
ok('progress line', r && r[0] === 'Team challenge' && /\+8 toward the goal/.test(r[1]) && /31 of 100 answered/.test(r[1]), r && r[1]);
ok('run that added nothing says nothing', row(res({ added: 0, teamTotal: 31, goal: 100, done: false, freezeAwarded: 0 })) === null);
r = row(res({ added: 4, teamTotal: 100, goal: 100, done: true, freezeAwarded: 1 }));
ok('freeze paid on this run', r && /Goal reached/.test(r[1]) && /\+1 streak freeze/.test(r[1]), r && r[1]);
r = row(res({ added: 4, teamTotal: 100, goal: 100, done: true, freezeAwarded: true }));
ok('a true award counts as one freeze', r && /\+1 streak freeze/.test(r[1]), r && r[1]);
r = row(res({ added: 3, teamTotal: 120, goal: 100, done: true, freezeAwarded: 0, claimed: false }));
ok('goal reached but freeze waiting for room', r && /once you have room/.test(r[1]), r && r[1]);
r = row(res({ added: 0, teamTotal: 120, goal: 100, done: true, freezeAwarded: 0, claimed: false }));
ok('a finished challenge still tells a student who is full', r && /once you have room/.test(r[1]));
r = row(res({ added: 6, teamTotal: 120, goal: 100, done: true, freezeAwarded: 0, claimed: true }));
ok('already paid: later runs just show progress, never "waiting"', r && /\+6 toward the goal/.test(r[1]) && !/room/.test(r[1]), r && r[1]);
ok('already paid and nothing added: no row', row(res({ added: 0, teamTotal: 120, goal: 100, done: true, freezeAwarded: 0, claimed: true })) === null);
ok('cache bumped past goc-v173', /const CACHE = 'goc-v(17[4-9]|1[89]\d|[2-9]\d\d)'/.test(sw));
console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
process.exit(fails ? 1 : 0);
