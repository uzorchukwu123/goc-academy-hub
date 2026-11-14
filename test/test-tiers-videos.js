/* test-tiers-videos.js — Phase 3B: the pure video rules (lesson = `videos`, live replay =
   `classRecordings`) and the empty-shelf wording an Open student sees.
   node test/test-tiers-videos.js */
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

console.log('\nrules');
ok('Open may not watch a lesson', !core.videoAllowed('lesson', 'open'));
ok('Open may not watch a live replay', !core.videoAllowed('live', 'open'));
ok('a missing tier is refused (fail closed)', !core.videoAllowed('lesson', undefined) && !core.videoAllowed('live', undefined));
ok('GOC may watch both', core.videoAllowed('lesson', 'goc') && core.videoAllowed('live', 'goc'));
ok('an unknown or missing type is treated as a lesson', core.videoAllowed(undefined, 'goc') && !core.videoAllowed(undefined, 'open'));
ok('the messages name the thing and GOC', /Lesson videos/.test(core.videoLockMessage('lesson')) && /Live class replays/.test(core.videoLockMessage('live')) && /GOC/.test(core.videoLockMessage('lesson')));

console.log('\nthe screen');
ok('the list reads the server\'s locked flag', /videosLocked = !!\(result && result\.locked\)/.test(app));
ok('a locked shelf says why instead of "No lesson videos yet"', /videosLocked \? GOC\.core\.videoLockMessage\('lesson'\)/.test(app) && /videosLocked \? GOC\.core\.videoLockMessage\('live'\)/.test(app));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
