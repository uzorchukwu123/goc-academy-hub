/* test-practice.js — Phase 1: server-authoritative practice history.
   A practice run is study, not assessment, but its review must follow the
   student across devices (Phase 2's mistakes review and spaced repetition read
   it), so the server now holds it per Scholar ID. This suite boots a throwaway
   server, signs a student up, records a run on one token and reads it back on a
   fresh login — the "other phone" — and checks the guards around it.
   No dependencies; run:  node test/test-practice.js  */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8139;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-practice-test-'));
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

var run = {
  mode: 'practice', subject: 'Physics', total: 2, answered: 2, correct: 1, wrong: 1, percent: 50,
  timeUsedSec: null, xpAwarded: 8,
  topics: [{ topic: 'Motion', percent: 50, band: 'developing' }],
  review: [
    { n: 1, topic: 'Motion', text: 'A body starts from rest...', options: ['9', '20', '25', '40'], answer: 1, given: 1, isCorrect: true, explanation: 'v=u+at.' },
    { n: 2, topic: 'Waves', text: 'A wave has frequency 50 Hz...', options: ['12.5', '46', '54', '200'], answer: 3, given: 0, isCorrect: false, explanation: 'v=fλ.' }
  ]
};

(function main() {
  waitForBoot(40).then(function () {
    head('Practice history — server-authoritative (Phase 1)');
    var idA, tokenA, tokenB;

    return activeStudent.signedUp(call, signup).then(function (r) {
      ok('a student can sign up with the academy code', r.status === 200 && r.body && r.body.token, r.status + ' ' + r.raw);
      idA = r.body.session.id; tokenA = r.body.token;

      return call('GET', '/api/me/practice', undefined, tokenA);
    }).then(function (r) {
      ok('a new student has no practice runs yet', r.status === 200 && Array.isArray(r.body.runs) && r.body.runs.length === 0);

      return call('POST', '/api/me/practice', run, tokenA);
    }).then(function (r) {
      ok('a finished run is accepted and echoed back', r.status === 200 && r.body.ok === true && r.body.runs.length === 1);
      ok('the stored run keeps its subject and score', r.body.saved.subject === 'Physics' && r.body.saved.correct === 1 && r.body.saved.total === 2);
      ok('the review round-trips every question', r.body.saved.review.length === 2);
      ok('the chosen answer (given) and correct answer are preserved', r.body.saved.review[1].given === 0 && r.body.saved.review[1].answer === 3 && r.body.saved.review[1].isCorrect === false);

      return call('POST', '/api/me/practice', { mode: 'practice', subject: 'Physics', review: [] }, tokenA);
    }).then(function (r) {
      ok('a run with no review is refused', r.status === 400);

      // A stranger with no token cannot touch another student's history.
      return call('GET', '/api/me/practice', undefined, null);
    }).then(function (r) {
      ok('practice history needs a student session', r.status === 401 || r.status === 403);

      // The other phone: a fresh login for the same student.
      return call('POST', '/api/auth/login', { id: idA, password: 'secret123' });
    }).then(function (r) {
      ok('the student can log in again (a second device)', r.status === 200 && r.body.token);
      tokenB = r.body.token;

      return call('GET', '/api/me/practice', undefined, tokenB);
    }).then(function (r) {
      ok('the run followed the student to the second device', r.status === 200 && r.body.runs.length === 1 && r.body.runs[0].subject === 'Physics');
      ok('the second device sees the full review, not just the score', r.body.runs[0].review.length === 2 && r.body.runs[0].review[0].text.indexOf('body starts') !== -1);
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
