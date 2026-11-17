/* test-video-excluded.js — video is excluded from the web application entirely,
   not merely from its player (owner decision, Phase 1 review).

   What this pins, in the order it matters:
     1. the rule itself — an MP4 (and every other video format) is not a student
        resource, while documents, PDFs and images still are;
     2. the student resource SCREEN — a video is never listed, and both the open
        and the download handlers refuse one even if it somehow reached the list;
     3. the student resource ROUTE on the server — the list filters video out, and
        the file route answers 403 to a video for EVERY tier and BOTH the open and
        the download request. Two halves: the source shows the gate sits after the
        record is validated and before the tier check and the download/view
        decision; a live server shows the answers that ordering produces;
     4. nothing was deleted — video records, the videos collection and the
        /api/videos routes are all still there;
     5. no inline player came back anywhere in the app.

   Section 3 is the one to read if the ROUTE changes: it pins the order
   retrieve -> validate -> file ref -> video 403 -> tier -> download/view, and
   section 3b runs a real server to show a video is refused as video for both
   tiers and both requests, while a PDF still opens for GOC and downloads for
   both. Put the video gate after the tier check and section 3/3b fail.
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

/* The route must answer in this exact order, so the video answer is the same
   whichever tier asks and whichever button is pressed. Each step is located by
   a string that belongs to it and only to it. */
function fileRoute() {
  var from = server.indexOf("'GET', path: /^\\/api\\/resources\\/([A-Za-z0-9._-]+)\\/file$/");
  if (from < 0) return null;
  var next = server.indexOf("'GET', path: /^\\/api\\/admin", from);
  return server.slice(from, next > from ? next : from + 6000);
}
function at(hay, needle) { return hay.indexOf(needle); }

var route = fileRoute();
ok('the file route was found', !!route, 'no /api/resources/:id/file route');

if (route) {
  var iGetDoc = at(route, 'appwriteDatabases.getDocument');
  var iNotPublished = at(route, "'That resource is not available.'");
  var iNoFileRef = at(route, "'The resource file is missing.'");
  var iVideoGate = at(route, "reason: 'video-excluded'");
  var iTierCheck = at(route, 'canUse(');
  var iTierRefusal = at(route, "reason: 'tier'");
  var iWantsDownload = at(route, 'wantsDownload =');
  var iGetFile = at(route, 'getFileView');
  var iDelivery = at(route, 'res.writeHead(200');

  ok('every step of the route is present',
     [iGetDoc, iNotPublished, iNoFileRef, iVideoGate, iTierCheck, iTierRefusal,
      iWantsDownload, iGetFile, iDelivery].every(function (v) { return v > -1; }),
     JSON.stringify({ iGetDoc: iGetDoc, iNotPublished: iNotPublished, iNoFileRef: iNoFileRef,
       iVideoGate: iVideoGate, iTierCheck: iTierCheck, iTierRefusal: iTierRefusal,
       iWantsDownload: iWantsDownload, iGetFile: iGetFile, iDelivery: iDelivery }));

  ok('1-3. the record is retrieved and validated before the video gate',
     iGetDoc > -1 && iGetDoc < iNotPublished && iNotPublished < iNoFileRef && iNoFileRef < iVideoGate,
     'getDocument ' + iGetDoc + ', published ' + iNotPublished + ', file-ref ' + iNoFileRef + ', gate ' + iVideoGate);

  ok('4. the video gate precedes the resource-view tier check',
     iVideoGate > -1 && iTierCheck > -1 && iVideoGate < iTierCheck,
     'gate ' + iVideoGate + ' vs canUse ' + iTierCheck);

  ok('   and it precedes the tier REFUSAL itself, not merely the tier lookup',
     iVideoGate > -1 && iTierRefusal > -1 && iVideoGate < iTierRefusal,
     'gate ' + iVideoGate + ' vs reason:tier ' + iTierRefusal);

  ok('   so an Open student asking to OPEN a video is told it is video, not that it is tier',
     iVideoGate < iTierRefusal);

  ok('5. the video gate precedes the download/view decision',
     iVideoGate > -1 && iWantsDownload > -1 && iVideoGate < iWantsDownload,
     'gate ' + iVideoGate + ' vs wantsDownload ' + iWantsDownload);

  ok('   not merely before the file read — ?download=1 is decided later than the video answer',
     iVideoGate < iWantsDownload && iWantsDownload < iGetFile);

  ok('6. the file is read and delivered only after the video gate',
     iVideoGate < iGetFile && iGetFile < iDelivery);

  ok('the video gate is not wrapped in a tier or download condition',
     !/(wantsDownload|canUse|tier)[\s\S]{0,200}?resourceStudentAccessible/.test(route),
     'a tier/download condition appears before the rule call');
}

/* ------------------------------------- 3b. the answers that ordering produces
   The source check above proves WHERE the gate is. This proves WHAT that
   placement answers, over a real server against the in-memory Appwrite
   stand-in: a video must never come back as tier-refused (which would tell an
   Open student to upgrade for a file that is not offered at all), never as
   file bytes, and never as a download — while a PDF still opens for GOC and
   still downloads for both tiers.
   Nothing here reads or writes a stored record: the seed is a throwaway temp
   file that only the stand-in bucket knows about. */
var http = require('http');
var os = require('os');
var spawn = require('child_process').spawn;

async function liveServerChecks() {
  head('the answers that ordering produces (live server, stand-in Appwrite)');

  var PORT = Number(process.env.GOC_TEST_VEX_PORT) || 8177;
  var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-vex-'));
  var mp4Bytes = Buffer.alloc(2048, 7);
  var clips = {
    'f-vex-mp4': ['lecture.mp4', mp4Bytes],
    'f-vex-pdf': ['notes.pdf', Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')]
  };
  var seed = { files: [], docs: [] };
  Object.keys(clips).forEach(function (id) {
    var p = path.join(TMP, clips[id][0]);
    fs.writeFileSync(p, clips[id][1]);
    seed.files.push({ id: id, path: p });
  });
  function rec(id, type, file, published) {
    return { col: 'resources', data: { $id: id, resourceId: id, title: id, description: '',
      subject: 'Physics', category: 'notes', fileType: type, storageFileId: file, published: published } };
  }
  seed.docs.push(rec('VEX-mp4', 'MP4', 'f-vex-mp4', true));
  seed.docs.push(rec('VEX-pdf', 'PDF', 'f-vex-pdf', true));
  seed.docs.push(rec('VEX-draft-mp4', 'MP4', 'f-vex-mp4', false));
  seed.docs.push(rec('VEX-nofile-mp4', 'MP4', '', true));
  var SEED = path.join(TMP, 'seed.json');
  fs.writeFileSync(SEED, JSON.stringify(seed));

  var ENV = Object.assign({}, process.env, {
    PORT: String(PORT), GOC_DATA_DIR: path.join(TMP, 'data'), STUB_SEED: SEED,
    APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub',
    APPWRITE_API_KEY: 'stubkey', GOC_SIGNUP_CODE: 'GOC-2027', STUB_GOC_PREFIX: 'GOC ',
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027',
    NODE_OPTIONS: '-r ' + path.join(__dirname, 'appwrite-stub', 'hook.js')
  });
  fs.mkdirSync(ENV.GOC_DATA_DIR, { recursive: true });

  function call(method, url, body, token) {
    return new Promise(function (resolve, reject) {
      var data = body ? JSON.stringify(body) : null;
      var h = { 'Content-Type': 'application/json' };
      if (token) h.Authorization = 'Bearer ' + token;
      if (data) h['Content-Length'] = Buffer.byteLength(data);
      var r = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: h },
        function (resp) {
          var cs = [];
          resp.on('data', function (c) { cs.push(c); });
          resp.on('end', function () {
            var buf = Buffer.concat(cs);
            var parsed = {};
            try { parsed = JSON.parse(buf.toString('utf8')); } catch (e) {}
            resolve({ status: resp.statusCode, headers: resp.headers, buf: buf, body: parsed,
              raw: buf.toString('utf8') });
          });
        });
      r.on('error', reject);
      if (data) r.write(data);
      r.end();
    });
  }
  function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  var srv = spawn(process.execPath, [path.join(APP, 'server', 'server.js')],
    { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
  var log = '';
  srv.stdout.on('data', function (d) { log += d; });
  srv.stderr.on('data', function (d) { log += d; });

  try {
    for (var n = 0; n < 80 && log.indexOf('is running') < 0; n++) await wait(150);
    if (log.indexOf('is running') < 0) {
      ok('the server boots against the stand-in Appwrite', false, log.slice(-300));
      return;
    }
    ok('the server boots against the stand-in Appwrite', true);

    var activeStudent = require('./active-student.js');
    var goc = await activeStudent(call, { signupCode: 'GOC-2027', name: 'GOC Ada Video',
      password: 'ada2027!', goal: 'JAMB / UTME',
      subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, null);
    var open = await activeStudent(call, { signupCode: 'GOC-2027', name: 'Ola Open Video',
      password: 'ola2027!', goal: 'JAMB / UTME',
      subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, null);
    ok('two students sign in, one GOC and one Open', !!goc.token && !!open.token,
       'goc ' + (goc.signup && goc.signup.status) + '/' + (goc.approve && goc.approve.status) + '/' + (goc.login && goc.login.status) + ' ' + String((goc.login && goc.login.raw) || '').slice(0, 160) +
       ' | open ' + (open.signup && open.signup.status) + '/' + (open.approve && open.approve.status) + '/' + (open.login && open.login.status) + ' ' + String((open.login && open.login.raw) || '').slice(0, 160));
    if (!goc.token || !open.token) return;

    /* the list offers no video to either tier, but still offers the PDF */
    var gl = await call('GET', '/api/resources', null, goc.token);
    var ol = await call('GET', '/api/resources', null, open.token);
    ok('the list carries the PDF and no video record, for either tier',
       (gl.body.resources || []).every(function (x) { return x.resourceId !== 'VEX-mp4'; }) &&
       (ol.body.resources || []).every(function (x) { return x.resourceId !== 'VEX-mp4'; }) &&
       (gl.body.resources || []).some(function (x) { return x.resourceId === 'VEX-pdf'; }),
       JSON.stringify((gl.body.resources || []).map(function (x) { return x.resourceId; })));

    var checks = [
      ['a GOC student opening a video', '/api/resources/VEX-mp4/file', 'goc'],
      ['a GOC student downloading a video', '/api/resources/VEX-mp4/file?download=1', 'goc'],
      ['an Open student opening a video', '/api/resources/VEX-mp4/file', 'open'],
      ['an Open student downloading a video', '/api/resources/VEX-mp4/file?download=1', 'open']
    ];
    for (var k = 0; k < checks.length; k++) {
      var c = checks[k];
      var tok = c[2] === 'goc' ? goc.token : open.token;
      var r = await call('GET', c[1], null, tok);
      ok(c[0] + ' is refused 403 video-excluded',
         r.status === 403 && r.body.reason === 'video-excluded', r.status + ' ' + r.raw.slice(0, 120));
      ok('  ' + c[0] + ' is NOT told it is a tier problem', r.body.reason !== 'tier', r.body.reason);
      ok('  ' + c[0] + ' gets no file bytes',
         r.buf.equals(mp4Bytes) === false && r.buf.length < 600, r.buf.length);
    }

    /* the tier branch is still live for documents — proof the gate did not
       swallow it, and that steps 5-6 are untouched */
    var oOpen = await call('GET', '/api/resources/VEX-pdf/file', null, open.token);
    ok('an Open student is still refused the PDF view, reason tier',
       oOpen.status === 403 && oOpen.body.reason === 'tier' && /GOC/.test(oOpen.body.error || ''),
       oOpen.status + ' ' + oOpen.raw.slice(0, 100));
    ok('  and still no PDF bytes leak', oOpen.buf.slice(0, 4).toString() !== '%PDF');
    var oDl = await call('GET', '/api/resources/VEX-pdf/file?download=1', null, open.token);
    ok('an Open student can still DOWNLOAD the PDF as an attachment',
       oDl.status === 200 && oDl.headers['content-disposition'] === 'attachment' &&
       oDl.buf.slice(0, 4).toString() === '%PDF',
       oDl.status + ' ' + oDl.headers['content-disposition']);
    var gOpen = await call('GET', '/api/resources/VEX-pdf/file', null, goc.token);
    ok('a GOC student still OPENS the PDF inline',
       gOpen.status === 200 && gOpen.headers['content-disposition'] === 'inline' &&
       /^application\/pdf/.test(gOpen.headers['content-type'] || ''),
       gOpen.status + ' ' + gOpen.headers['content-disposition']);

    /* steps 2-3 still answer BEFORE the video gate, and say so */
    var draft = await call('GET', '/api/resources/VEX-draft-mp4/file', null, goc.token);
    ok('an unpublished video is still 404, not 403 (validation comes first)',
       draft.status === 404, draft.status + ' ' + draft.raw.slice(0, 100));
    var draftDl = await call('GET', '/api/resources/VEX-draft-mp4/file?download=1', null, open.token);
    ok('  and the same when downloaded', draftDl.status === 404, draftDl.status);
    var nofile = await call('GET', '/api/resources/VEX-nofile-mp4/file', null, goc.token);
    ok('a video record with no stored file is still 404, not 403 (file ref comes first)',
       nofile.status === 404, nofile.status + ' ' + nofile.raw.slice(0, 100));
    var stranger = await call('GET', '/api/resources/VEX-mp4/file');
    ok('a stranger is refused 401 before any of it', stranger.status === 401, stranger.status);
  } catch (e) {
    ok('the live checks ran without crashing', false, e && e.message);
  } finally {
    srv.kill();
    await wait(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  }
}

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

liveServerChecks().then(function () {
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  the live section crashed: ' + (e && e.message));
  console.log('\n' + (fails + 1) + ' check(s) FAILED');
  process.exit(1);
});
