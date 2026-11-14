/* test-bookmarks.js — Phase 1 (part 2): saved questions (bookmarks).
   Boots a throwaway server, signs a student up, saves questions on one token,
   reads them back on a fresh login (the "other phone"), and checks the guards:
   duplicates, removal, validation, isolation between students, auth.
   No dependencies; run:  node test/test-bookmarks.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = 'GOC2027';
var PORT = Number(process.env.GOC_TEST_PORT) || 8141;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-bookmarks-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}

var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
var serverLog = '';
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

var signup = { signupCode: SIGNUP, name: 'Ada Test', password: 'secret123',
  email: 'ada.test@example.com', phone: '08000000009', goal: 'JAMB / UTME 2027',
  subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };


var q1 = { id: 12, subject: 'Physics', topic: 'Motion', text: 'A body starts from rest...', options: ['9', '20', '25', '40'], answer: 1, explanation: 'v=u+at.' };
var q2 = { subject: 'Physics', topic: 'Waves', text: 'A wave has frequency 50 Hz...', options: ['12.5', '46', '54', '200'], answer: 3, explanation: 'v=f*lambda.' };

(function main() {
  waitForBoot(40).then(function () {
    head('Bookmarks — per-student saved questions (Phase 1, part 2)');
    var idA, tokenA, tokenB, tokenC, keyA, keyB;

    return activeStudent.signedUp(call, signup).then(function (r) {
      ok('a student can sign up', r.status === 200 && r.body && r.body.token, r.status + ' ' + r.raw);
      idA = r.body.session.id; tokenA = r.body.token;
      return call('GET', '/api/me/bookmarks', undefined, tokenA);
    }).then(function (r) {
      ok('a new student has no bookmarks', r.status === 200 && Array.isArray(r.body.bookmarks) && r.body.bookmarks.length === 0);
      return call('POST', '/api/me/bookmarks', q1, tokenA);
    }).then(function (r) {
      ok('a question can be bookmarked', r.status === 200 && r.body.ok === true && r.body.bookmarks.length === 1);
      ok('the snapshot keeps text, options, answer and explanation', r.body.saved.text.indexOf('body starts') !== -1 && r.body.saved.options.length === 4 && r.body.saved.answer === 1 && r.body.saved.explanation === 'v=u+at.');
      ok('a question with an id is keyed by it', r.body.saved.key === 'q12', r.body.saved.key);
      keyA = r.body.saved.key;
      return call('POST', '/api/me/bookmarks', q1, tokenA);
    }).then(function (r) {
      ok('saving the same question twice does not duplicate it', r.status === 200 && r.body.already === true && r.body.bookmarks.length === 1);
      return call('POST', '/api/me/bookmarks', q2, tokenA);
    }).then(function (r) {
      ok('a question with no id is still saved, keyed by its text', r.status === 200 && r.body.bookmarks.length === 2 && /^t[a-z0-9]+$/.test(r.body.saved.key), r.raw);
      keyB = r.body.saved.key;
      ok('newest bookmark comes first', r.body.bookmarks[0].key === keyB);
      return call('POST', '/api/me/bookmarks', { text: 'No options', options: ['only one'] }, tokenA);
    }).then(function (r) {
      ok('a bookmark with fewer than two options is refused', r.status === 400);
      return call('POST', '/api/me/bookmarks', { options: ['a', 'b'] }, tokenA);
    }).then(function (r) {
      ok('a bookmark with no question text is refused', r.status === 400);
      return call('POST', '/api/me/bookmarks', { id: 99, text: 'x'.repeat(5000), options: ['a', 'b'], answer: 7, evil: 'drop table' }, tokenA);
    }).then(function (r) {
      ok('oversized text is trimmed and unknown fields are dropped', r.status === 200 && r.body.saved.text.length === 2000 && r.body.saved.evil === undefined);
      ok('an out-of-range answer index is stored as null, not trusted', r.body.saved.answer === null);
      return call('GET', '/api/me/bookmarks', undefined, null);
    }).then(function (r) {
      ok('bookmarks need a student session', r.status === 401 || r.status === 403);
      return call('POST', '/api/auth/login', { id: idA, password: 'secret123' });
    }).then(function (r) {
      tokenB = r.body.token;
      return call('GET', '/api/me/bookmarks', undefined, tokenB);
    }).then(function (r) {
      ok('bookmarks followed the student to a second device', r.status === 200 && r.body.bookmarks.length === 3);
      var other = Object.assign({}, signup, { name: 'Bayo Other', email: 'bayo.other@example.com', phone: '08000000010' });
      return activeStudent.signedUp(call, other);
    }).then(function (r) {
      tokenC = r.body && r.body.token;
      ok('a second student can sign up', !!tokenC, r.raw);
      return call('GET', '/api/me/bookmarks', undefined, tokenC);
    }).then(function (r) {
      ok("one student never sees another's bookmarks", r.status === 200 && r.body.bookmarks.length === 0);
      return call('DELETE', '/api/me/bookmarks/' + keyA, undefined, tokenC);
    }).then(function (r) {
      ok("another student cannot remove someone else's bookmark", r.status === 200 && r.body.removed === false);
      return call('DELETE', '/api/me/bookmarks/' + keyA, undefined, tokenB);
    }).then(function (r) {
      ok('a bookmark can be removed', r.status === 200 && r.body.removed === true && r.body.bookmarks.length === 2);
      return call('DELETE', '/api/me/bookmarks/' + keyA, undefined, tokenB);
    }).then(function (r) {
      ok('removing an already-removed bookmark is harmless', r.status === 200 && r.body.removed === false);
      return call('GET', '/api/me/bookmarks', undefined, tokenA);
    }).then(function (r) {
      ok('removal shows on every device', r.body.bookmarks.length === 2 && !r.body.bookmarks.some(function (b) { return b.key === keyA; }));
    }).then(function () {
      console.log('\n' + passes + ' passed, ' + fails + ' failed');
      stop();
      process.exit(fails ? 1 : 0);
    });
  }).catch(function (e) {
    console.log('THREW: ' + e.message);
    console.log(serverLog);
    stop();
    process.exit(1);
  });
})();
