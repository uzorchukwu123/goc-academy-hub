/* test-quest-reward.js — Phase 2, daily quest slice 5: XP for finishing the quest.
   node test/test-quest-reward.js  */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8145;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-quest-reward-test-'));
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

var signup = { signupCode: SIGNUP, name: 'Ada Reward', password: 'secret123',
  email: 'ada.reward@example.com', phone: '08000000011', goal: 'JAMB / UTME 2027',
  subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };

function sit(token, count, wrong) {
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Physics', count: count }, token).then(function (h) {
    var responses = {};
    (h.body.questions || []).forEach(function (q) {
      responses[q.id] = wrong ? (Number(q.answer) + 1) % Math.max(2, (q.options || []).length || 4) : q.answer;
    });
    return call('POST', '/api/me/study/submit', { paperId: h.body.paperId, responses: responses }, token).then(function (sub) {
      /* The app saves each finished run to the server straight after the
         submit (savePracResult); do the same so the next quest check sees it. */
      var b = sub.body || {};
      var rec = { mode: 'practice', subject: 'Physics', total: b.total, answered: b.answered, correct: b.correct, wrong: b.wrong, percent: b.percent, ts: Date.now(), review: (b.review || []).map(function (q) { return { n: q.n, topic: q.topic, text: q.text, options: q.options, answer: q.answer, given: q.given, isCorrect: q.isCorrect, explanation: q.explanation }; }) };
      return call('POST', '/api/me/practice', rec, token).then(function () { return sub; });
    });
  });
}

(function main() {
  head('questReward, pure rule');
  var cap = core.PRACTICE_XP_DAILY_CAP, R = core.QUEST_XP_REWARD;
  var done = { day: '2026-10-06', done: true }, notDone = { day: '2026-10-06', done: false };
  ok('reward is a positive whole number', R > 0 && Math.floor(R) === R);
  ok('an unfinished quest pays nothing and claims nothing', (function () { var r = core.questReward(notDone, null, 0); return !r.claim && r.award === 0; })());
  ok('no quest at all pays nothing', core.questReward(null, null, 0).claim === false);
  ok('a finished, uncollected quest pays the reward', (function () { var r = core.questReward(done, null, 10); return r.claim && r.award === R; })());
  ok("yesterday's claim does not block today", core.questReward(done, '2026-10-05', 0).claim === true);
  ok('already collected today: nothing', (function () { var r = core.questReward(done, '2026-10-06', 0); return !r.claim && r.award === 0; })());
  ok('the reward is trimmed to what the daily allowance has left', core.questReward(done, null, cap - 5).award === 5);
  ok('allowance full: the day is still claimed, award 0', (function () { var r = core.questReward(done, null, cap); return r.claim && r.award === 0; })());

  waitForBoot(40).then(function () {
    head('Quest reward through the server');
    var token;
    return activeStudent.signedUp(call, signup).then(function (r) {
      token = r.body.token;
      return sit(token, 5, false);
    }).then(function (r) {
      ok('a run that leaves the quest unfinished pays no bonus', r.status === 200 && r.body.questXp === 0 && r.body.questClaimed === false && r.body.questDone === false, r.raw);
      ok('run XP is unchanged (1 + 2 per correct)', r.body.xpAwarded === core.xpForPractice(5, 5), r.raw);
      return sit(token, 5, false);
    }).then(function (r) {
      /* 5 + 5 answered today in the plain daily goal = 10 */
      ok('finishing the quest pays the bonus once', r.status === 200 && r.body.questDone === true && r.body.questClaimed === true && r.body.questXp === R, r.raw);
      var run = core.xpForPractice(5, 5);
      ok('xpTotal holds both runs and the bonus', r.body.xpTotal === run * 2 + R, r.raw);
      ok('the bonus counts against the allowance', r.body.xpLeftToday === cap - run * 2 - R, r.raw);
      return sit(token, 5, false);
    }).then(function (r) {
      ok('a later run the same day pays no second bonus', r.status === 200 && r.body.questDone === true && r.body.questClaimed === false && r.body.questXp === 0, r.raw);
      return call('GET', '/api/me', undefined, token);
    }).then(function (r) {
      var run = core.xpForPractice(5, 5);
      ok('profile XP matches', r.body && r.body.xp === run * 3 + R, r.raw);
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
