/* test-video-excluded.js — video is excluded from the web application entirely,
   not merely from its player (owner decision, Phase 1 review).

   What this pins, in the order it matters:
     1. the rule itself — an MP4 (and every other video format) is not a student
        resource, while documents, PDFs and images still are;
     2. the student resource SCREEN — a video is never listed, and both the open
        and the download handlers refuse one even if it somehow reached the list;
     3. the student resource ROUTE on the server — the list filters video out and
        the file route answers 403 for a video, in both the view and the download
        case;
     4. nothing was deleted — video records, the videos collection and the
        /api/videos routes are all still there;
     5. no inline player came back anywhere in the app.
   node test/test-video-excluded.js */
'use strict';
var fs = require('fs');
var path = require('path');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------- 1. the rule */
head('the rule: a video is not a student resource');

ok('an MP4 resource is refused', core.resourceStudentAccessible({ fileExt: 'mp4' }) === false);
ok('a video is refused however its extension is cased or padded',
   core.resourceStudentAccessible({ fileExt: 'MP4' }) === false &&
   core.resourceStudentAccessible({ fileExt: ' mp4 ' }) === false &&
   core.resourceStudentAccessible({ fileExt: '.mp4' }) === false);
ok('every other video container is refused too', core.VIDEO_FILE_EXTENSIONS.every(function (e) {
  return core.isVideoResource({ fileExt: e }) === true;
}), core.VIDEO_FILE_EXTENSIONS.join(','));
ok('a server-shaped record (fileType) is refused as well',
   core.resourceStudentAccessible({ fileType: 'mp4' }) === false);
ok('an already-classified video is refused', core.isVideoResource({ fileExt: 'video' }) === true);

ok('a PDF still passes', core.resourceStudentAccessible({ fileExt: 'pdf' }) === true);
ok('a Word document still passes',
   core.resourceStudentAccessible({ fileExt: 'doc' }) === true &&
   core.resourceStudentAccessible({ fileExt: 'docx' }) === true);
ok('a spreadsheet still passes',
   core.resourceStudentAccessible({ fileExt: 'xls' }) === true &&
   core.resourceStudentAccessible({ fileExt: 'xlsx' }) === true);
ok('a presentation still passes',
   core.resourceStudentAccessible({ fileExt: 'ppt' }) === true &&
   core.resourceStudentAccessible({ fileExt: 'pptx' }) === true);
ok('an image still passes',
   core.resourceStudentAccessible({ fileExt: 'jpg' }) === true &&
   core.resourceStudentAccessible({ fileExt: 'png' }) === true &&
   core.resourceStudentAccessible({ fileExt: 'gif' }) === true);
ok('a zip still passes', core.resourceStudentAccessible({ fileExt: 'zip' }) === true);
ok('a record with no usable extension is not hidden (a blank is not evidently video)',
   core.resourceStudentAccessible({}) === true && core.resourceStudentAccessible({ fileExt: '' }) === true);
ok('nothing at all is refused', core.resourceStudentAccessible(null) === false);
ok('the exclusion message names video and points at the academy',
   /video/i.test(core.VIDEO_EXCLUDED_MESSAGE) && /academy/i.test(core.VIDEO_EXCLUDED_MESSAGE),
   core.VIDEO_EXCLUDED_MESSAGE);
ok('the message offers no download and no suggestion to save the file',
   !/download|save/i.test(core.VIDEO_EXCLUDED_MESSAGE), core.VIDEO_EXCLUDED_MESSAGE);
ok('the rule does not widen a tier: it only ever excludes',
   core.resourceStudentAccessible({ fileExt: 'pdf' }) && !core.resourceStudentAccessible({ fileExt: 'mp4' }));

/* ----------------------------------------------------------- 2. the screen */
head('the student resource screen');

var app = read('js/app.js');

ok('a video is filtered out of the list before it is counted or drawn', (function () {
  var filter = app.indexOf('if(!GOC.core.resourceStudentAccessible(r)) return;');
  if (filter < 0) return false;
  /* it must sit inside renderResources(), after the loop opens and before the
     card is appended — i.e. it decides what is listed, not what a card does */
  var render = app.indexOf('function renderResources(){');
  var append = app.indexOf('host.appendChild(d);', render);
  var loop = app.indexOf('resources.forEach(function(r){', render);
  return render > -1 && loop > -1 && filter > loop && filter < append;
})());

ok('the open handler refuses a video at the click, not only at render',
   /openBtn\.onclick = function\(\)\{[\s\S]{0,400}?resourceStudentAccessible\(r\)[\s\S]{0,200}?VIDEO_EXCLUDED_MESSAGE/.test(app));

ok('the download handler refuses a video too',
   /dlBtn\.onclick = function\(e\)\{[\s\S]{0,400}?resourceStudentAccessible\(r\)[\s\S]{0,200}?VIDEO_EXCLUDED_MESSAGE/.test(app));

ok('the download handler no longer fetches a file before checking',
   (function () {
  var dl = app.slice(app.indexOf('dlBtn.onclick = function(e){'));
  dl = dl.slice(0, dl.indexOf('host.appendChild(d);'));
  return dl.indexOf('resourceStudentAccessible') > -1 &&
         dl.indexOf('resourceStudentAccessible') < dl.indexOf('getResourceFile');
})());

ok('resourceViewerKind never returns a video kind',
   !/'video'/.test(app.slice(app.indexOf('function resourceViewerKind'), app.indexOf('function resourceFileName'))));

/* ------------------------------------------------------ 3. the server route */
head('the student resource route');

var server = read(path.join('server', 'server.js'));

ok('the resource list filters video out on the server as well as the screen',
   /const resources = result\.documents\s*\n?\s*\.filter\(doc => core\.resourceStudentAccessible\(\{ fileType: doc\.fileType \}\)\)/.test(server),
   'no filter on the resources list');

ok('the file route refuses a video with 403 and the exclusion reason',
   /if \(!core\.resourceStudentAccessible\(\{ fileType: doc\.fileType \}\)\) \{\s*\n\s*return send\(res, 403, \{ error: core\.VIDEO_EXCLUDED_MESSAGE, reason: 'video-excluded' \}\);\s*\n\s*\}/.test(server),
   'no video gate on /api/resources/:id/file');

ok('the gate is not inside the download/view branch, so ?download=1 cannot get past it', (function () {
  var from = server.indexOf("'GET', path: /^\\/api\\/resources\\/([A-Za-z0-9._-]+)\\/file$/");
  if (from < 0) return false;
  var route = server.slice(from, from + 4000);
  var gate = route.indexOf('resourceStudentAccessible');
  var getFile = route.indexOf('getFileView');
  if (gate < 0 || getFile < 0) return false;
  return gate < getFile;
})());

ok('and the gate is reached before any file bytes are read',
   (function () {
  var route = server.slice(server.indexOf("path: /^\\/api\\/resources\\/([A-Za-z0-9._-]+)\\/file$/"));
  return route.indexOf('resourceStudentAccessible') < route.indexOf('getFileView');
})());

/* ------------------------------------------------- 4. nothing was deleted */
head('nothing was deleted — video records and files are preserved');

ok('the videos collection constant is still declared',
   /APPWRITE_VIDEOS_COLLECTION_ID = 'videos'/.test(server));
ok('the video list route is still registered over stored records',
   server.indexOf("path: /^\\/api\\/videos$/") > -1, 'GET /api/videos is gone');
ok('the video file route is still registered over stored records',
   server.indexOf("path: /^\\/api\\/videos\\/([A-Za-z0-9._-]+)\\/file$/") > -1, 'GET /api/videos/:id/file is gone');
ok('they are still tier-guarded', /core\.videoAllowed\(/.test(server) && /core\.videoLockMessage\(/.test(server));
ok('the stored-file audit tool still covers videos',
   /'videos'/.test(read(path.join('server', 'verify-media.js'))));
ok('no admin video route was brought back',
   !/api\\\\\/admin\\\\\/videos/.test(server));

/* ------------------------------------------------------ 5. no player returned */
head('no inline player came back');

ok('the app has no playVideo / videoCard / loadPublishedVideos',
   !/function playVideo\(/.test(app) && !/function videoCard\(/.test(app) && !/loadPublishedVideos/.test(app));
ok('the app has no <video> element or video media type',
   !/<video/.test(app) && !/video\/mp4/.test(app));
ok('the client API exposes no video playback method',
   !/listPublishedVideos|getVideoFile/.test(read('js/api.js')));
ok('the Classes screen carries no recording or lesson-video shelf',
   !/id="liveList"/.test(read('index.html')) && !/id="lessonList"/.test(read('index.html')));
ok('the resource viewer builds no video element',
   !/kind === 'video'/.test(app) && !/loadeddata/.test(app));

console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
process.exit(fails ? 1 : 0);
