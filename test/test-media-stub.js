/* test-media-stub.js — resources and videos, end to end over real HTTP, against
   an in-memory stand-in for Appwrite (test/appwrite-stub). Proves the server's
   half of "PDFs/images/mp4 open inline, videos seek, office files download"
   without a live project. It cannot prove your real Appwrite project, keys or
   uploaded files — for that, run  node server/verify-media.js  once configured.
   Run:  node test/test-media-stub.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var spawnSync = require('child_process').spawnSync;

var APP = path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TEST_MEDIA_PORT) || 8151;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-media-test-'));
var passes = 0, fails = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ---- the files the stand-in "bucket" holds ---- */
var pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
var png = fs.readFileSync(path.join(APP, 'icons', 'icon-192.png'));
var docx = Buffer.from('PK\x03\x04 not a real office file, only its type matters here');
var mp4 = Buffer.alloc(300000); for (var i = 0; i < mp4.length; i++) mp4[i] = (i * 31 + 7) & 255;
var MP4ID = 'f-mp4-' + process.pid + '-' + Date.now();   /* unique, so a video cached by an earlier run can never be served */
var files = { 'f-pdf': ['notes.pdf', pdf], 'f-png': ['diagram.png', png], 'f-docx': ['sheet.docx', docx], };
files[MP4ID] = ['clip.mp4', mp4];
var seed = { files: [], docs: [] };
Object.keys(files).forEach(function (id) {
  var p = path.join(TMP, files[id][0]); fs.writeFileSync(p, files[id][1]); seed.files.push({ id: id, path: p });
});
function res(id, title, type, file, published) {
  return { col: 'resources', data: { $id: id, resourceId: id, title: title, description: '', subject: 'Physics', category: 'notes', fileType: type, storageFileId: file, published: published } };
}
seed.docs.push(res('RES-pdf', 'Physics past questions', 'PDF', 'f-pdf', true));
seed.docs.push(res('RES-png', 'Circuit diagram', 'PNG', 'f-png', true));
seed.docs.push(res('RES-docx', 'Formula sheet', 'DOCX', 'f-docx', true));
seed.docs.push(res('RES-draft', 'Unpublished draft', 'PDF', 'f-pdf', false));
seed.docs.push({ col: 'resources', data: { $id: 'RES-lost', resourceId: 'RES-lost', title: 'Lost file', description: '', subject: 'Physics', category: 'notes', fileType: 'PDF', storageFileId: 'f-gone', published: true } });
seed.docs.push({ col: 'videos', data: { $id: 'VID-1', videoId: 'VID-1', title: 'Kinematics walk-through', subject: 'Physics', type: 'lesson', tutor: 'Mr Ade', duration: '0:06', storageFileId: MP4ID, externalUrl: '', published: true } });
seed.docs.push({ col: 'videos', data: { $id: 'VID-2', videoId: 'VID-2', title: 'Live class replay', subject: 'Physics', type: 'live', tutor: 'Mr Ade', duration: '0:06', storageFileId: MP4ID, externalUrl: 'https://example.invalid/secret-replay', published: true } });
seed.docs.push({ col: 'liveclasses', data: { $id: 'CLS-1', classId: 'CLS-1', subject: 'Physics', topic: 'Waves revision', tutor: 'Mr Ade', scheduledAt: new Date(Date.now() + 3 * 86400000).toISOString(), durationMin: 60, zoomLink: 'https://zoom.invalid/j/secret-room', status: 'scheduled' } });
var SEED = path.join(TMP, 'seed.json'); fs.writeFileSync(SEED, JSON.stringify(seed));

var ENV = Object.assign({}, process.env, {
  PORT: String(PORT), GOC_DATA_DIR: path.join(TMP, 'data'), STUB_SEED: SEED,
  APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub', APPWRITE_API_KEY: 'stubkey', GOC_SIGNUP_CODE: 'GOC-2027', STUB_GOC_PREFIX: 'GOC ',
  GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027',
  NODE_OPTIONS: '-r ' + path.join(__dirname, 'appwrite-stub', 'hook.js')
});
fs.mkdirSync(ENV.GOC_DATA_DIR, { recursive: true });

function call(method, url, body, token, extra) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    if (token) h.Authorization = 'Bearer ' + token;
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    var r = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: h }, function (resp) {
      var chunks = []; resp.on('data', function (c) { chunks.push(c); });
      resp.on('end', function () { resolve({ status: resp.statusCode, headers: resp.headers, buf: Buffer.concat(chunks) }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
/* the walk sign-up -> founder approves -> student logs in, over this file's byte-style call() */
function callJ(m, u, b, t) { return call(m, u, b, t).then(function (r) { r.body = json(r); r.raw = r.buf.toString('utf8'); return r; }); }
function json(r) { try { return JSON.parse(r.buf.toString('utf8')); } catch (e) { return {}; } }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var server = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
var log = ''; server.stdout.on('data', function (d) { log += d; }); server.stderr.on('data', function (d) { log += d; });

async function main() {
  for (var n = 0; n < 60 && log.indexOf('is running') < 0; n++) await wait(150);
  ok('the server boots against the stand-in Appwrite', log.indexOf('is running') > -1, log.slice(-300));

  head('a student signs in');
  var amara = await activeStudent(callJ, { signupCode: 'GOC-2027', name: 'GOC Amara Obi', password: 'amara2027!', goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, null);
  var signup = amara.signup;
  ok('registration works', signup.status === 200 || signup.status === 201, signup.raw.slice(0, 150));
  var sid = amara.id;
  var login = amara.login;
  var tok = amara.token;
  ok('login returns a session token', login.status === 200 && !!tok, login.status);

  head('resources');
  ok('a stranger cannot list resources', (await call('GET', '/api/resources')).status === 401);
  var list = json(await call('GET', '/api/resources', null, tok)).resources || [];
  var ids = list.map(function (r) { return r.resourceId; }).sort().join(',');
  ok('a student sees only published resources', ids === 'RES-docx,RES-lost,RES-pdf,RES-png', ids);
  var r = await call('GET', '/api/resources/RES-pdf/file', null, tok);
  ok('a PDF is served inline as application/pdf', r.status === 200 && r.headers['content-type'] === 'application/pdf' && r.headers['content-disposition'] === 'inline' && r.buf.slice(0, 4).toString() === '%PDF', r.status + ' ' + r.headers['content-type']);
  ok('resource files are private and never cached', /no-store/.test(r.headers['cache-control'] || ''), r.headers['cache-control']);
  r = await call('GET', '/api/resources/RES-png/file', null, tok);
  ok('an image is served as image/png with the exact bytes', r.status === 200 && r.headers['content-type'] === 'image/png' && r.buf.equals(png), r.status);
  r = await call('GET', '/api/resources/RES-docx/file', null, tok);
  ok('an office file carries its office mime type (the app saves it)', r.status === 200 && /wordprocessingml/.test(r.headers['content-type'] || ''), r.headers['content-type']);
  ok('an unpublished resource cannot be opened', (await call('GET', '/api/resources/RES-draft/file', null, tok)).status === 404);
  ok('an unknown resource is a clean 404', (await call('GET', '/api/resources/NOPE/file', null, tok)).status === 404);
  r = await call('GET', '/api/resources/RES-lost/file', null, tok);
  ok('a record whose file is missing from storage fails cleanly (404, no crash)', r.status === 404 && /Could not open|missing/i.test(json(r).error || ''), r.status);
  ok('a stranger cannot fetch a file', (await call('GET', '/api/resources/RES-pdf/file')).status === 401);

  head('resources: an Open student may download but not open');
  var ola = await activeStudent(callJ, { signupCode: 'GOC-2027', name: 'Ola Open', password: 'ola2027!', goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, null);
  var olog = ola.login;
  var otok = ola.token;
  ok('an Open student signs in', olog.status === 200 && !!otok, olog.status);
  var olist = json(await call('GET', '/api/resources', null, otok));
  ok('the list tells the screen they cannot open files', olist.canView === false && (olist.resources || []).length === 4, JSON.stringify(olist).slice(0, 120));
  ok('the GOC student is told they can', json(await call('GET', '/api/resources', null, tok)).canView === true);
  r = await call('GET', '/api/resources/RES-pdf/file', null, otok);
  ok('opening is refused 403 with reason tier', r.status === 403 && json(r).reason === 'tier' && /GOC/.test(json(r).error || ''), r.status + ' ' + r.buf.toString().slice(0, 100));
  ok('  and no file bytes leak', r.buf.slice(0, 4).toString() !== '%PDF');
  r = await call('GET', '/api/resources/RES-pdf/file?download=1', null, otok);
  ok('downloading is allowed, as an attachment', r.status === 200 && r.headers['content-disposition'] === 'attachment' && r.buf.slice(0, 4).toString() === '%PDF', r.status + ' ' + r.headers['content-disposition']);
  r = await call('GET', '/api/resources/RES-pdf/file?download=1', null, tok);
  ok('a GOC student can download too', r.status === 200 && r.headers['content-disposition'] === 'attachment');
  r = await call('GET', '/api/resources/RES-pdf/file', null, tok);
  ok('and still opens inline', r.status === 200 && r.headers['content-disposition'] === 'inline');
  ok('an unpublished resource is still a 404 when downloaded', (await call('GET', '/api/resources/RES-draft/file?download=1', null, otok)).status === 404);
  ok('a stranger cannot download', (await call('GET', '/api/resources/RES-pdf/file?download=1')).status === 401);

  head('live classes: Open students get no classes at all');
  var gc = await call('GET', '/api/classes', null, tok);
  var gcj = json(gc);
  ok('a GOC student gets the class with its Zoom link', gc.status === 200 && (gcj.classes || []).length === 1 && /secret-room/.test(gcj.classes[0].zoomLink || '') && gcj.joinLocked === false, gc.buf.toString().slice(0, 160));
  var oc = await call('GET', '/api/classes', null, otok);
  var ocj = json(oc);
  ok('an Open student gets an empty class list', oc.status === 200 && Array.isArray(ocj.classes) && ocj.classes.length === 0 && ocj.joinLocked === true, oc.buf.toString().slice(0, 160));
  ok('  and neither the class details nor the Zoom link appear in the response', !/secret-room|zoom\.invalid|Waves revision|Mr Ade/.test(oc.buf.toString()));
  ok('a stranger cannot list classes', (await call('GET', '/api/classes')).status === 401);

  head('videos: seeking');
  var vids = json(await call('GET', '/api/videos', null, tok)).videos || [];
  ok('a GOC student sees both published videos, lesson and live replay', vids.map(function (v) { return v.videoId; }).sort().join(',') === 'VID-1,VID-2', JSON.stringify(vids));
  var full = await call('GET', '/api/videos/VID-1/file', null, tok);
  ok('a video is served inline and advertises byte ranges', full.status === 200 && full.headers['accept-ranges'] === 'bytes' && full.headers['content-disposition'] === 'inline' && /^video\/mp4/.test(full.headers['content-type'] || ''), full.status);
  ok('the full body is the whole file', full.buf.equals(mp4));
  var part = await call('GET', '/api/videos/VID-1/file', null, tok, { Range: 'bytes=1000-1999' });
  ok('a Range request returns 206 with exactly those bytes', part.status === 206 && part.buf.equals(mp4.slice(1000, 2000)) && part.headers['content-range'] === 'bytes 1000-1999/' + mp4.length, part.status + ' ' + part.headers['content-range']);
  var tail = await call('GET', '/api/videos/VID-1/file', null, tok, { Range: 'bytes=' + (mp4.length - 500) + '-' });
  ok('seeking to the end (open-ended range) works', tail.status === 206 && tail.buf.equals(mp4.slice(mp4.length - 500)), tail.status);
  var bad = await call('GET', '/api/videos/VID-1/file', null, tok, { Range: 'bytes=' + (mp4.length + 5) + '-' + (mp4.length + 9) });
  ok('a range past the end is refused with 416', bad.status === 416, bad.status);
  ok('a stranger cannot stream a video', (await call('GET', '/api/videos/VID-1/file')).status === 401);
  head('videos: an Open student is held back');
  var ovl = await call('GET', '/api/videos', null, otok);
  var ovj = json(ovl);
  ok('the Open list is empty and says it is locked', ovl.status === 200 && Array.isArray(ovj.videos) && ovj.videos.length === 0 && ovj.locked === true, ovl.buf.toString().slice(0, 150));
  ok('no title, file id or external link leaks', !/Kinematics|Live class replay|secret-replay|f-mp4/.test(ovl.buf.toString()), ovl.buf.toString().slice(0, 150));
  var ov1 = await call('GET', '/api/videos/VID-1/file', null, otok);
  ok('a lesson file is refused 403 with reason tier', ov1.status === 403 && json(ov1).reason === 'tier' && /Lesson videos/.test(json(ov1).error || ''), ov1.status + ' ' + ov1.buf.length);
  var ov2 = await call('GET', '/api/videos/VID-2/file', null, otok);
  ok('a live replay is refused 403 with reason tier', ov2.status === 403 && json(ov2).reason === 'tier' && /Live class replays/.test(json(ov2).error || ''), ov2.status);
  var ov3 = await call('GET', '/api/videos/VID-1/file', null, otok, { Range: 'bytes=0-99' });
  ok('a Range request does not slip past it', ov3.status === 403 && ov3.buf.length < 300, ov3.status + ' ' + ov3.buf.length);
  ok('a GOC student is told nothing is locked', json(await call('GET', '/api/videos', null, tok)).locked === false);


  head('verify-media.js (the check you run against your real project)');
  var v = spawnSync(process.execPath, [path.join(APP, 'server', 'verify-media.js')], { env: ENV, encoding: 'utf8' });
  ok('it reports the missing file and exits 1 while something is missing', v.status === 1 && /MISSING\s+resource "Lost file"/.test(v.stdout), v.status + ' ' + (v.stdout || '').slice(-200));
  ok('it says which files open in the app and which download', /Physics past questions.*opens inside the app/.test(v.stdout) && /Formula sheet.*downloads/.test(v.stdout));
}

main().catch(function (e) { fails++; console.log('  FAIL  test crashed: ' + e.stack); }).then(function () {
  server.kill();
  setTimeout(function () {
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
    try { fs.rmSync(path.join(os.tmpdir(), 'goc-video-cache', MP4ID + '.mp4'), { force: true }); } catch (e) {}
    console.log('\n' + passes + ' passed, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
  }, 300);
});
