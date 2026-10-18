/* test-streak-freeze-route.js — Phase 2, streak freeze slice 2: a held freeze
   bridges exactly one missed day on a real study submit, and is spent.
   Boots a throwaway server, backdates the student's streak, then submits.
   node test/test-streak-freeze-route.js  */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8144;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-streak-freeze-test-'));
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

var DATA = path.join(SANDBOX, 'server', 'data.json');
function daysAgo(n) { var d = new Date(); d.setDate(d.getDate() - n); return core.dayStamp(d); }
function patchStudent(fields) {
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  Object.assign(db.students[0], fields);
  fs.writeFileSync(DATA, JSON.stringify(db));
}
function practiceRun(token) {
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Physics', count: 3 }, token).then(function (r) {
    var ans = {}; (r.body.questions || []).forEach(function (q) { ans[q.id] = q.answer; });
    return call('POST', '/api/me/study/submit', { paperId: r.body.paperId, responses: ans }, token);
  });
}

(function main() {
  waitForBoot(40).then(function () {
    head('Streak freeze (Phase 2, slice 2)');
    var token;
    return activeStudent.signedUp(call, signup).then(function (r) {
      token = r.body.token;
      return call('GET', '/api/me', undefined, token);
    }).then(function (r) {
      ok('a new student holds no freezes', r.status === 200 && r.body.streakFreezes === 0, r.raw);
      patchStudent({ streak: 4, streakDay: daysAgo(2), streakFreezes: 1 });
      return practiceRun(token);
    }).then(function (r) {
      ok('the run is accepted', r.status === 200, r.raw);
      return call('GET', '/api/me', undefined, token);
    }).then(function (r) {
      ok('one missed day with a freeze: streak carries on', r.body.streak === 5, r.raw);
      ok('and the freeze is spent', r.body.streakFreezes === 0, r.raw);
      patchStudent({ streak: 7, streakDay: daysAgo(2), streakFreezes: 0 });
      return practiceRun(token);
    }).then(function () {
      return call('GET', '/api/me', undefined, token);
    }).then(function (r) {
      ok('one missed day with no freeze still resets to 1', r.body.streak === 1, r.raw);
      patchStudent({ streak: 9, streakDay: daysAgo(3), streakFreezes: 2 });
      return practiceRun(token);
    }).then(function () {
      return call('GET', '/api/me', undefined, token);
    }).then(function (r) {
      ok('two missed days are not bridged, freezes are kept', r.body.streak === 1 && r.body.streakFreezes === 2, r.raw);
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
