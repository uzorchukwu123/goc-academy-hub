/* test-media-stub.js — resources and videos, end to end over real HTTP, against
   an in-memory stand-in for Appwrite (test/appwrite-stub). Proves the server's
   half of "PDFs/images/mp4 open inline, videos seek, office files download"
   without a live project. It cannot prove your real Appwrite project, keys or
   uploaded files — for that, run  node server/verify-media.js  once configured.
   Run:  node test/test-media-stub.js  */
'use strict';
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
var SEED = path.join(TMP, 'seed.json'); fs.writeFileSync(SEED, JSON.stringify(seed));

var ENV = Object.assign({}, process.env, {
  PORT: String(PORT), GOC_DATA_DIR: path.join(TMP, 'data'), STUB_SEED: SEED,
  APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub', APPWRITE_API_KEY: 'stubkey', GOC_SIGNUP_CODE: 'GOC-2027',
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
function json(r) { try { return JSON.parse(r.buf.toString('utf8')); } catch (e) { return {}; } }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var server = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
var log = ''; server.stdout.on('data', function (d) { log += d; }); server.stderr.on('data', function (d) { log += d; });

async function main() {
  for (var n = 0; n < 60 && log.indexOf('is running') < 0; n++) await wait(150);
  ok('the server boots against the stand-in Appwrite', log.indexOf('is running') > -1, log.slice(-300));

  head('a student signs in');
  var signup = await call('POST', '/api/students', { signupCode: 'GOC-2027', name: 'Amara Obi', password: 'amara2027!', goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  ok('registration works', signup.status === 200 || signup.status === 201, signup.buf.toString().slice(0, 150));
  var sid = (json(signup).student || {}).id;
  var login = await call('POST', '/api/auth/login', { id: sid, password: 'amara2027!' });
  var tok = json(login).token;
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

  head('videos: seeking');
  var vids = json(await call('GET', '/api/videos', null, tok)).videos || [];
  ok('a student sees the published video', vids.length === 1 && vids[0].videoId === 'VID-1');
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
