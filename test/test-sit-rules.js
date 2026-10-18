/* test-sit-rules.js — Phase 3, Web Test sit rules slice 1: who may sit what.
   Pure core logic only.   node test/test-sit-rules.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c, extra) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }

function at(section, n) { var o = []; for (var i = 0; i < n; i++) o.push({ section: section, subject: 'Physics' }); return o; }

/* first sitting is always open for the three Web Test sections */
['theory', 'objective', 'jamb'].forEach(function (sec) {
  var r = core.canSit(sec, []);
  ok(sec + ': no attempts yet may be sat', r.allowed === true && r.count === 0 && r.reason === '');
});
ok('missing / junk attempts list counts as none', core.canSit('theory').allowed === true && core.canSit('theory', null).allowed === true && core.canSit('theory', 'x').allowed === true);

/* theory and objective close for good after one submission */
['theory', 'objective'].forEach(function (sec) {
  var r = core.canSit(sec, at(sec, 1));
  ok(sec + ': one submitted attempt closes it', r.allowed === false && r.reason === 'done' && r.repeatable === false && r.count === 1);
  ok(sec + ': more attempts stay closed', core.canSit(sec, at(sec, 3)).allowed === false);
});

/* jamb may be repeated, and the count is reported */
var j0 = core.canSit('jamb', at('jamb', 1)), j5 = core.canSit('jamb', at('jamb', 5));
ok('jamb: still open after one attempt', j0.allowed === true && j0.repeatable === true && j0.count === 1 && j0.reason === '');
ok('jamb: still open after five, count kept', j5.allowed === true && j5.count === 5);

/* only attempts of the same section count */
var mixed = at('jamb', 4).concat(at('objective', 2));
ok('a mixed list only counts the matching section', core.canSit('jamb', mixed).count === 4 && core.canSit('theory', mixed).allowed === true);
ok('an attempt with no section field counts for the asked section', core.canSit('objective', [{ subject: 'Physics' }]).allowed === false);
ok('null / non-object entries are ignored', core.canSit('theory', [null, 7, 'a']).allowed === true);

/* unknown sections are refused, never guessed */
['practice', '', undefined, null, 'Theory', 'exam'].forEach(function (sec) {
  var r = core.canSit(sec, []);
  ok('section ' + JSON.stringify(sec) + ' is refused as unknown', r.allowed === false && r.reason === 'unknown' && r.repeatable === false);
});

/* constants are exposed as copies */
ok('repeatable sections are exactly jamb', core.REPEATABLE_SECTIONS.join() === 'jamb');
core.REPEATABLE_SECTIONS.push('theory');
ok('the exposed list is a copy, so the rule cannot be changed from outside', core.canSit('theory', at('theory', 1)).allowed === false);
ok('web test sections are theory, objective, jamb', core.WEB_TEST_SECTIONS.join() === 'theory,objective,jamb');

if (fails) { console.log('\n' + fails + ' FAILED'); process.exit(1); }
console.log('\nall passed');
