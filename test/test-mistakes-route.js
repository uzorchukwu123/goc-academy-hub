/* test-mistakes-route.js — Phase 2, slice 2: GET /api/me/mistakes.
   Boots a throwaway server, records a practice run, reads back the mistakes.
   node test/test-mistakes-route.js  */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8143;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-mistakes-route-test-'));
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
    head('Mistakes route (Phase 2, slice 2)');
    var token;
    return activeStudent.signedUp(call, signup).then(function (r) {
      token = r.body.token;
      return call('GET', '/api/me/mistakes', undefined, token);
    }).then(function (r) {
      ok('a new student has no mistakes', r.status === 200 && Array.isArray(r.body.mistakes) && r.body.mistakes.length === 0, r.raw);
      return call('POST', '/api/me/practice', run, token);
    }).then(function () {
      return call('GET', '/api/me/mistakes', undefined, token);
    }).then(function (r) {
      ok('only the wrong answer is listed', r.status === 200 && r.body.mistakes.length === 1 && r.body.mistakes[0].given === 0 && r.body.mistakes[0].answer === 3, r.raw);
      return call('GET', '/api/me/mistakes', undefined, null);
    }).then(function (r) {
      ok('mistakes need a student session', r.status === 401 || r.status === 403);
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
