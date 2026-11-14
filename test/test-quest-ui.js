/* test-quest-ui.js — Part Two retired the Daily quest card from the Study hub.
   The quest itself is still computed and paid server-side, and still reported
   on a practice result; only the dashboard-style card is gone.
   Run:  node test/test-quest-ui.js  */
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
console.log('\nDaily quest card is retired');
['questCard', 'questText', 'questBar', 'questNote'].forEach(function (id) {
  ok(id + ' is gone from the Study hub', html.indexOf('id="' + id + '"') < 0);
});
ok('the Study hub no longer refreshes the quest card',
  !/id === 'study' && typeof refreshQuest === 'function'\) refreshQuest\(\)/.test(app));
ok('the quest is still computed by the shared core', typeof core.dailyQuest === 'function');
ok('a practice result still reports the quest row', /function questRow\(/.test(app) && /var qr = questRow\(res\)/.test(app));
console.log('\n' + passes + ' passed, ' + fails + ' failed');
process.exit(fails ? 1 : 0);
