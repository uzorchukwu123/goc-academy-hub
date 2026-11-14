/* test-tiers-classes.js — Phase 3B: Open students get no live classes (no timetable
   entries, no Zoom join link) (rule + screen wiring; the route is covered in test-media-stub.js).
   node test/test-tiers-classes.js */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}

console.log('\nrule');
ok('Open may not join a live class', !core.canUse('liveClassJoin', 'open'));
ok('a missing tier may not join (fail closed)', !core.canUse('liveClassJoin', undefined));
ok('GOC may join', core.canUse('liveClassJoin', 'goc'));
ok('the lock message names live classes and GOC', /live classes/i.test(core.LIVE_JOIN_LOCK_MESSAGE) && /GOC/.test(core.LIVE_JOIN_LOCK_MESSAGE));

console.log('\nthe screen');
ok('a locked block is carried from the server flag', /joinLocked: !!\(c\.joinLocked \|\| \(result && result\.joinLocked\)\)/.test(app));
ok('tapping a locked block shows the message and never opens a window',
   /if\(bl\.joinLocked\)\{ toast\(GOC\.core\.LIVE_JOIN_LOCK_MESSAGE\); \}\s*else if\(bl\.zoomLink\)/.test(app));
ok('a locked block is labelled "Join link: GOC"', /Join link: GOC/.test(app));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
