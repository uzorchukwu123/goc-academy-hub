/* test-tiers-classes.js — Phase 3B: Open students get no live classes (no Zoom
   join link) (rule + screen wiring; the route is covered in test-media-stub.js).
   The standalone Timetable screen was retired in the redesign's Phase 1 sweep,
   so the screen-side checks now read the Classes screen, which is where a live
   class and its join link are actually shown.
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
ok('a locked class is carried from the server flag', /joinLocked/.test(app) && /result\.joinLocked/.test(app));
ok('tapping a locked class shows the message and never opens a window',
   /LIVE_JOIN_LOCK_MESSAGE/.test(app) && /zoomLink/.test(app));
ok('a locked class is labelled "Join link: GOC"', /Join link: GOC/.test(app));
ok('the standalone Timetable screen is gone', !/id="timetable"/.test(fs.readFileSync(path.join(APP, 'index.html'), 'utf8')));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
