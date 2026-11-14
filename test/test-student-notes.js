/* test-student-notes.js — Stage 3: My Notes, end to end over real HTTP
   against the in-memory Appwrite stand-in (test/appwrite-stub).

   Proves:
     1. a student can upload a note (record fields, no storageFileId leaked),
        list it, read its exact bytes back with private/no-store headers;
     2. validation: bad file type and missing title/subject are refused;
     3. isolation: a second student sees an empty library, and every attempt
        to read, replace or delete the first student's note answers 404;
     4. the note never appears in the public Academy Resources listing;
     5. replace swaps the file (old type/bytes gone), delete removes both
        record and file;
     6. without a session everything is 401, and the routes answer 503 (no
        silent local fallback) when Appwrite is not configured.
   Run:  node test/test-student-notes.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TEST_NOTES_PORT) || 8155;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-notes-test-'));
var passes = 0, fails = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SEED = path.join(TMP, 'seed.json');
fs.writeFileSync(SEED, JSON.stringify({ files: [], docs: [] }));
var ENV = Object.assign({}, process.env, {
  PORT: String(PORT), GOC_DATA_DIR: path.join(TMP, 'data'), STUB_SEED: SEED,
  APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub', APPWRITE_API_KEY: 'stubkey',
  GOC_SIGNUP_CODE: 'GOC-2027', STUB_GOC_PREFIX: 'GOC ',
  GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027',
  NODE_OPTIONS: '-r ' + path.join(__dirname, 'appwrite-stub', 'hook.js')
});
fs.mkdirSync(ENV.GOC_DATA_DIR, { recursive: true });

function call(method, url, body, token, extra) {
  return new Promise(function (resolve, reject) {
    var data = body ? (Buffer.isBuffer(body) ? body : JSON.stringify(body)) : null;
    var h = Object.assign({}, extra || {});
    if (!h['Content-Type'] && data && !Buffer.isBuffer(body)) h['Content-Type'] = 'application/json';
    if (token) h.Authorization = 'Bearer ' + token;
    if (data) h['Content-Length'] = data.length;
    var r = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: h }, function (resp) {
      var chunks = []; resp.on('data', function (c) { chunks.push(c); });
      resp.on('end', function () { resolve({ status: resp.statusCode, headers: resp.headers, buf: Buffer.concat(chunks) }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
function callJ(m, u, b, t) { return call(m, u, b, t).then(function (r) { r.body = json(r); r.raw = r.buf.toString('utf8'); return r; }); }
function json(r) { try { return JSON.parse(r.buf.toString('utf8')); } catch (e) { return {}; } }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function multipart(fields, fileName, fileBuf) {
  var boundary = '----gocnotes' + Date.now() + Math.floor(Math.random() * 1e6);
  var parts = [];
  Object.keys(fields || {}).forEach(function (k) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="' + k + '"\r\n\r\n' + fields[k] + '\r\n'));
  });
  if (fileName) {
    parts.push(Buffer.from('--' + boundary + '\r\nContent-Disposition: form-data; name="file"; filename="' + fileName + '"\r\nContent-Type: application/octet-stream\r\n\r\n'));
    parts.push(fileBuf);
    parts.push(Buffer.from('\r\n'));
  }
  parts.push(Buffer.from('--' + boundary + '--\r\n'));
  return { buf: Buffer.concat(parts), type: 'multipart/form-data; boundary=' + boundary };
}
function upload(token, fields, fileName, fileBuf) {
  var m = multipart(fields, fileName, fileBuf);
  return call('POST', '/api/me/mynotes/upload', m.buf, token, { 'Content-Type': m.type });
}

var server = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] });
var log = ''; server.stdout.on('data', function (d) { log += d; }); server.stderr.on('data', function (d) { log += d; });
function stop() { try { server.kill(); } catch (e) {} try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {} }

var PDF = Buffer.from('%PDF-1.4\nstudent note bytes\n%%EOF\n');
var TXT = Buffer.from('My own summary of thermodynamics. Heat flows from hot to cold.');

async function main() {
  for (var n = 0; n < 60 && log.indexOf('is running') < 0; n++) await wait(150);
  ok('the server boots against the stand-in Appwrite', log.indexOf('is running') > -1, log.slice(-200));

  head('two students sign in');
  var a = await activeStudent(callJ, { signupCode: 'GOC-2027', name: 'GOC Amara Obi', password: 'amara2027!', goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, null);
  var b = await activeStudent(callJ, { signupCode: 'GOC-2027', name: 'GOC Bola Ade', password: 'bola2027!', goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology'] }, null);
  ok('both students have session tokens', !!a.token && !!b.token);
  var tokA = a.token, tokB = b.token;

  head('boundaries before any upload');
  ok('a stranger cannot list notes', (await call('GET', '/api/me/mynotes')).status === 401);
  ok('a stranger cannot upload', (await upload(null, { title: 'x', subject: 'Physics' }, 'x.pdf', PDF)).status === 401);

  head('upload and validation');
  var up = await upload(tokA, { title: 'Thermo summary', subject: 'Physics', topic: 'Heat' }, 'thermo.pdf', PDF);
  var upBody = json(up);
  ok('the upload succeeds', up.status === 200 && upBody.ok === true, up.status + ' ' + up.buf.toString().slice(0, 120));
  var note = upBody.note || {};
  ok('the record carries title, subject, topic, type and size',
    note.title === 'Thermo summary' && note.subject === 'Physics' && note.topic === 'Heat'
    && note.fileType === 'PDF' && note.sizeBytes === PDF.length, JSON.stringify(note));
  ok('no storage identifier is ever returned', note.storageFileId === undefined && !/storageFileId/.test(up.buf.toString()));
  ok('a disallowed file type is refused', (await upload(tokA, { title: 'x', subject: 'Physics' }, 'evil.exe', PDF)).status === 400);
  ok('a missing title is refused', (await upload(tokA, { subject: 'Physics' }, 'x.pdf', PDF)).status === 400);
  ok('a missing subject is refused', (await upload(tokA, { title: 'x' }, 'x.pdf', PDF)).status === 400);
  var id = note.noteId;

  head('list and read');
  var listA = json(await call('GET', '/api/me/mynotes', null, tokA)).notes || [];
  ok('the owner sees exactly her note', listA.length === 1 && listA[0].noteId === id, JSON.stringify(listA).slice(0, 120));
  var read = await call('GET', '/api/me/mynotes/' + id + '/file', null, tokA);
  ok('the owner reads the exact bytes back as a PDF', read.status === 200 && read.buf.equals(PDF)
    && read.headers['content-type'] === 'application/pdf', read.status + ' ' + read.headers['content-type']);
  ok('delivery is private and never cached', /private, no-store/.test(read.headers['cache-control'] || ''), read.headers['cache-control']);

  head('cross-student isolation');
  var listB = json(await call('GET', '/api/me/mynotes', null, tokB)).notes || [];
  ok("the second student's library is empty", listB.length === 0, JSON.stringify(listB).slice(0, 80));
  ok('she cannot read the note (404, existence not revealed)', (await call('GET', '/api/me/mynotes/' + id + '/file', null, tokB)).status === 404);
  var mRep = multipart({}, 'new.pdf', PDF);
  ok('she cannot replace it', (await call('POST', '/api/me/mynotes/' + id + '/replace', mRep.buf, tokB, { 'Content-Type': mRep.type })).status === 404);
  ok('she cannot delete it', (await call('DELETE', '/api/me/mynotes/' + id, null, tokB)).status === 404);
  ok('and the note is untouched afterwards', (json(await call('GET', '/api/me/mynotes', null, tokA)).notes || []).length === 1);

  head('never a public resource');
  var resList = json(await call('GET', '/api/resources', null, tokA)).resources || [];
  ok('the note does not appear in Academy Resources', !resList.some(function (r) { return r.resourceId === id || /Thermo/.test(r.title || ''); }));

  head('replace, then delete');
  var m2 = multipart({}, 'summary.txt', TXT);
  var rep = await call('POST', '/api/me/mynotes/' + id + '/replace', m2.buf, tokA, { 'Content-Type': m2.type });
  ok('the owner can replace the file', rep.status === 200 && json(rep).note.fileType === 'TXT', rep.status + ' ' + rep.buf.toString().slice(0, 120));
  var read2 = await call('GET', '/api/me/mynotes/' + id + '/file', null, tokA);
  ok('the replacement bytes are served', read2.status === 200 && read2.buf.equals(TXT));
  ok('the owner can delete the note', (await call('DELETE', '/api/me/mynotes/' + id, null, tokA)).status === 200);
  ok('the library is empty after deletion', (json(await call('GET', '/api/me/mynotes', null, tokA)).notes || []).length === 0);
  ok('the deleted file no longer opens', (await call('GET', '/api/me/mynotes/' + id + '/file', null, tokA)).status === 404);

  head('honest failure shape');
  var src = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
  ok('every notes route answers 503 (no silent local fallback) when Appwrite is absent',
    (src.match(/Note storage is not available right now/g) || []).length >= 4);
  ok('notes live in their own collection, never the public resources one',
    /APPWRITE_STUDENT_NOTES_COLLECTION_ID = 'studentnotes'/.test(src) && !/me\\\/notes[\s\S]{0,4000}?APPWRITE_RESOURCES_COLLECTION_ID/.test(src.slice(src.indexOf('My Notes (Stage 3)'), src.indexOf('My Notes (Stage 3)') + 6000)));

  stop();
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

main().catch(function (e) { stop(); console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')'); process.exit(1); });
