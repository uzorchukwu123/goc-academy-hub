/* test-quest-weekly-ui.js — Part Two retired the Weekly quest card from the
   Study hub. Weekly progress and its streak-freeze reward remain server-side
   and are still reported on a practice result.
   Run:  node test/test-quest-weekly-ui.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html'), app = read('js/app.js');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
console.log('\nWeekly quest card is retired');
['weekCard', 'weekText', 'weekBar', 'weekNote'].forEach(function (id) {
  ok(id + ' is gone from the Study hub', html.indexOf('id="' + id + '"') < 0);
});
ok('the Study hub no longer refreshes the weekly card',
  !/id === 'study' && typeof refreshWeekly === 'function'\) refreshWeekly\(\)/.test(app));
ok('the weekly reward is still computed by the shared core',
  typeof core.weeklyQuest === 'function' && typeof core.weeklyReward === 'function');
ok('a practice result still reports the weekly row', /function weeklyRow\(/.test(app) && /var wr = weeklyRow\(res\)/.test(app));
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
