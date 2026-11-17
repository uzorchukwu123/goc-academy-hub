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
/* Phase 1 review: video is excluded from the redesigned web application, so the
   student-facing shelves that read the server's locked flag and named the lock
   are retired. The rules above still govern the routes that serve stored
   records, which is why this file keeps them. What is checked here now is that
   no playback surface came back. */
ok('no student-facing video shelf is left on the Classes screen',
   !/videoCard\(/.test(app) && !/function playVideo\(/.test(app) && !/loadPublishedVideos/.test(app));
ok('and the Classes markup no longer carries the recordings or lesson shelves',
   !/id="liveList"/.test(fs.readFileSync(path.join(APP, 'index.html'), 'utf8')) &&
   !/id="lessonList"/.test(fs.readFileSync(path.join(APP, 'index.html'), 'utf8')));

console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
process.exit(fails ? 1 : 0);
