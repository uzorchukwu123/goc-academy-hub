/* test-streak-freeze.js — Phase 2, streak freeze slice 1: pure core logic.
   node test/test-streak-freeze.js */
'use strict';
var path = require('path');
var core = require(path.join(process.env.GOC_DIR || path.join(__dirname, '..'), 'js', 'goc-core.js'));
var fails = 0;
function ok(name, c) { if (c) console.log('  pass  ' + name); else { fails++; console.log('  FAIL  ' + name); } }

var T = '2026-10-10', Y = '2026-10-09', D2 = '2026-10-08', D3 = '2026-10-07';
var r;
r = core.streakAfterActivity(5, Y, T);
ok('yesterday continues, no freeze touched', r.streak === 6 && r.freezes === 0 && !r.frozen);
r = core.streakAfterActivity(5, T, T, 1);
ok('already counted today is unchanged', r.streak === 5 && r.freezes === 1 && !r.frozen);
r = core.streakAfterActivity(5, D2, T);
ok('one missed day with no freeze still resets (old behaviour)', r.streak === 1 && !r.frozen);
r = core.streakAfterActivity(5, D2, T, 1);
ok('one missed day with a freeze keeps the streak and spends it', r.streak === 6 && r.freezes === 0 && r.frozen && r.day === T);
r = core.streakAfterActivity(5, D3, T, 2);
ok('two missed days are never bridged', r.streak === 1 && r.freezes === 2 && !r.frozen);
r = core.streakAfterActivity(0, null, T, 2);
ok('no streak yet: nothing to freeze', r.streak === 1 && r.freezes === 2 && !r.frozen);
r = core.streakAfterActivity(5, Y, T, 99);
ok('held freezes are clamped to the maximum', r.freezes === core.STREAK_FREEZE_MAX);
r = core.streakAfterActivity(5, D2, T, -3);
ok('bad freeze counts are safe', r.streak === 1 && r.freezes === 0);

var b = core.buyStreakFreeze(250, 0);
ok('buying spends the cost and adds one', b.ok && b.xp === 250 - core.STREAK_FREEZE_COST_XP && b.freezes === 1);
b = core.buyStreakFreeze(core.STREAK_FREEZE_COST_XP - 1, 0);
ok('not enough XP is refused', !b.ok && b.reason === 'xp' && b.xp === core.STREAK_FREEZE_COST_XP - 1);
b = core.buyStreakFreeze(1000, core.STREAK_FREEZE_MAX);
ok('cannot hold more than the maximum', !b.ok && b.reason === 'max' && b.xp === 1000);
b = core.buyStreakFreeze(null, undefined);
ok('bad input is safe', !b.ok && b.xp === 0 && b.freezes === 0);

console.log(fails ? fails + ' failed' : 'all passed');
process.exit(fails ? 1 : 0);
