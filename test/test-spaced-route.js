/* test-spaced-route.js — Phase 2, spaced repetition slice 2: GET/POST /api/me/review.
   Boots a throwaway server, records old and new practice runs, then reviews them.
   node test/test-spaced-route.js  */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8187;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-spaced-route-test-'));
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
var signup2 = Object.assign({}, signup, { name: 'Bayo Other', email: 'bayo.other@example.com', phone: '08000000010' });

var DAY = 86400000;
function runWith(ts, rows) {
  return {
    mode: 'practice', subject: 'Physics', total: rows.length, answered: rows.length, correct: 0, wrong: rows.length, percent: 0,
    timeUsedSec: null, xpAwarded: 0, ts: ts,
    topics: [{ topic: 'Waves', percent: 0, band: 'weak' }],
    review: rows.map(function (t, i) {
      return { n: i + 1, id: null, topic: 'Waves', text: t, options: ['12.5', '46', '54', '200'], answer: 3, given: 0, isCorrect: false, explanation: 'v=fλ.' };
    })
  };
}

(function main() {
  waitForBoot(40).then(function () {
    head('Spaced repetition route (Phase 2)');
    var token, token2, keyOld, keyOld2, keyNew;
    return activeStudent.signedUp(call, signup).then(function (r) {
      token = r.body.token;
      return activeStudent.signedUp(call, signup2);
    }).then(function (r) {
      token2 = r.body.token;
      return call('GET', '/api/me/review', undefined, token);
    }).then(function (r) {
      var q = r.body && r.body.review;
      ok('a new student has nothing due', r.status === 200 && q && q.dueCount === 0 && q.due.length === 0 && q.upcoming === 0 && q.nextDue === null, r.raw);
      return call('POST', '/api/me/practice', runWith(Date.now() - 3 * DAY, ['Old question one', 'Old question two']), token);
    }).then(function () {
      return call('POST', '/api/me/practice', runWith(Date.now(), ['Fresh question']), token);
    }).then(function () {
      return call('GET', '/api/me/review', undefined, token);
    }).then(function (r) {
      var q = r.body.review;
      ok('two old mistakes are due, the fresh one waits', q.dueCount === 2 && q.due.length === 2 && q.upcoming === 1, r.raw);
      ok('the next due date is about a day from now', q.nextDue > Date.now() + DAY - 60000 && q.nextDue < Date.now() + DAY + 60000);
      ok('due rows carry the question, answer and box 0', q.due[0].text.indexOf('Old question') === 0 && q.due[0].answer === 3 && q.due[0].box === 0 && typeof q.due[0].key === 'string');
      keyOld = q.due[0].key; keyOld2 = q.due[1].key;
      return call('GET', '/api/me/mistakes', undefined, token);
    }).then(function (r) {
      keyNew = r.body.mistakes.filter(function (m) { return m.text === 'Fresh question'; })[0].key;
      return call('POST', '/api/me/review', { key: keyOld, given: 3 }, token);
    }).then(function (r) {
      ok('a right answer is judged by the server and moves up a box', r.status === 200 && r.body.correct === true && r.body.box === 1 && r.body.mastered === false, r.raw);
      ok('and waits about 3 days', r.body.nextDue > Date.now() + 3 * DAY - 60000 && r.body.nextDue < Date.now() + 3 * DAY + 60000);
      ok('it reports the answer and what is left', r.body.answer === 3 && r.body.dueCount === 1 && r.body.upcoming === 2, r.raw);
      return call('POST', '/api/me/review', { key: keyOld2, given: 1 }, token);
    }).then(function (r) {
      ok('a wrong answer goes back to box 0 and waits a day', r.status === 200 && r.body.correct === false && r.body.box === 0 && r.body.answer === 3 && r.body.explanation === 'v=fλ.', r.raw);
      return call('GET', '/api/me/review', undefined, token);
    }).then(function (r) {
      ok('nothing is due once both are answered', r.body.review.dueCount === 0 && r.body.review.upcoming === 3, r.raw);
      return call('POST', '/api/me/review', { key: keyNew, given: 9 }, token);
    }).then(function (r) {
      ok('an option that does not exist is refused', r.status === 400, r.raw);
      return call('POST', '/api/me/review', { key: keyNew, given: 'three' }, token);
    }).then(function (r) {
      ok('a non-number answer is refused', r.status === 400);
      return call('POST', '/api/me/review', { key: 'nosuchkey123', given: 1 }, token);
    }).then(function (r) {
      ok('a key that is not in your mistakes is refused', r.status === 404, r.raw);
      return call('POST', '/api/me/review', { key: '../x', given: 1 }, token);
    }).then(function (r) {
      ok('a malformed key is refused', r.status === 400);
      return call('POST', '/api/me/review', { key: keyOld, given: 3 }, token2);
    }).then(function (r) {
      ok("another student cannot answer someone else's mistake", r.status === 404, r.raw);
      return call('GET', '/api/me/review', undefined, token2);
    }).then(function (r) {
      ok("and sees nothing of another student's schedule", r.body.review.dueCount === 0 && r.body.review.upcoming === 0);
      return call('GET', '/api/me/review', undefined, null);
    }).then(function (r) {
      ok('review needs a student session', r.status === 401 || r.status === 403);
      return call('POST', '/api/me/review', { key: keyOld, given: 3 }, null);
    }).then(function (r) {
      ok('answering needs a student session', r.status === 401 || r.status === 403);
      return call('GET', '/api/me', undefined, token);
    }).then(function (r) {
      ok('reviewing earns no XP and leaves the streak alone', r.status === 200 && r.body.xp === 0 && r.body.streak === 0, r.raw.slice(0, 200));
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
