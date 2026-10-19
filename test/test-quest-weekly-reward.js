/* test-quest-weekly-reward.js — Phase 2, weekly quest slice 3: the streak freeze for finishing the week.
   node test/test-quest-weekly-reward.js */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8171;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-weekly-quest-test-'));
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

var signup = { signupCode: SIGNUP, name: 'Wen Weekly', password: 'secret123',
  email: 'wen.weekly@example.com', phone: '08000000012', goal: 'JAMB / UTME 2027',
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


var DATA = path.join(SANDBOX, 'server', 'data.json');
/* The server reads data.json on every call, so a test can put a student's
   stored week into any state it needs (a week of earlier days, say). */
function setWeek(id, patch) {
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var s = db.students.find(function (x) { return x.id === id; });
  Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
  fs.writeFileSync(DATA, JSON.stringify(db));
}
function getStudent(id) {
  return JSON.parse(fs.readFileSync(DATA, 'utf8')).students.find(function (x) { return x.id === id; });
}
var THIS_MON = core.weekStart(), LAST_MON = (function () { var p = THIS_MON.split('-'); var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]) - 7); return core.dayStamp(d); })();

(function main() {
  head('weeklyReward, pure rule is covered in test-weekly-quest.js');
  waitForBoot(40).then(function () {
    head('Weekly quest reward through the server (Phase 2, weekly quest slice 3)');
    var token, id;
    return activeStudent.signedUp(call, signup).then(function (r) {
      token = r.body.token; id = r.body.id || (r.body.student && r.body.student.id);
      setWeek(id, { tier: 'goc' });   /* an academy student: a public sign-up is Open and has a daily allowance */
      setWeek(id, { weekQuest: { week: THIS_MON, days: 4, questions: 0, claimed: false } });
      return sit(token, 5, false);
    }).then(function (r) {
      ok('an unfinished week pays nothing', r.body.weekClaimed === false && r.body.freezeAwarded === 0 && r.body.streakFreezes === 0 && !r.body.weekQuest.done, r.raw);
      return sit(token, 5, false);
    }).then(function (r) {
      ok('the fifth daily quest finishes the week and pays one freeze', r.body.questClaimed === true && r.body.weekQuest.days === 5 && r.body.weekQuest.done && r.body.weekClaimed === true && r.body.freezeAwarded === 1 && r.body.streakFreezes === 1, r.raw);
      ok('the week is marked paid', r.body.weekQuest.claimed === true, r.raw);
      return call('GET', '/api/me', undefined, token);
    }).then(function (r) {
      ok('the profile now holds the freeze', r.body.streakFreezes === 1, r.raw);
      return sit(token, 5, false);
    }).then(function (r) {
      ok('a later run the same week pays no second freeze', r.body.weekClaimed === false && r.body.freezeAwarded === 0 && r.body.streakFreezes === 1 && r.body.weekQuest.claimed === true, r.raw);
      /* the other way in: a hundred questions, few days */
      setWeek(id, { weekQuest: { week: THIS_MON, days: 1, questions: 95, claimed: false } });
      return sit(token, 5, true);
    }).then(function (r) {
      ok('a hundred questions finish it too, whichever comes first', r.body.weekQuest.questions === 100 && r.body.weekQuest.days === 1 && r.body.weekClaimed === true && r.body.streakFreezes === 2, r.raw);
      ok('wrong answers still count as answered', r.body.weekQuest.byQuestions === true, r.raw);
      /* at the cap the week is held, not thrown away */
      setWeek(id, { streakFreezes: 2, weekQuest: { week: THIS_MON, days: 1, questions: 95, claimed: false } });
      return sit(token, 5, false);
    }).then(function (r) {
      ok('already holding the most: finished but not paid, nothing lost', r.body.weekQuest.done && r.body.weekQuest.claimed === false && r.body.weekClaimed === false && r.body.freezeAwarded === 0 && r.body.streakFreezes === 2, r.raw);
      return call('GET', '/api/me/weekly-quest', undefined, token);
    }).then(function (r) {
      ok('the route shows it waiting', r.body.weeklyQuest.done && !r.body.weeklyQuest.claimed && r.body.streakFreezes === 2, r.raw);
      setWeek(id, { streakFreezes: 1 });
      return sit(token, 5, false);
    }).then(function (r) {
      ok('once there is room the next run pays it', r.body.weekClaimed === true && r.body.freezeAwarded === 1 && r.body.streakFreezes === 2 && r.body.weekQuest.claimed === true, r.raw);
      ok('the freeze count is stored', getStudent(id).streakFreezes === 2);
      /* next week the quest is fresh and payable again */
      setWeek(id, { streakFreezes: 0, weekQuest: { week: LAST_MON, days: 5, questions: 200, claimed: true } });
      return sit(token, 5, false);
    }).then(function (r) {
      ok('a new week starts unpaid and not done', r.body.weekQuest.claimed === false && !r.body.weekQuest.done && r.body.freezeAwarded === 0 && r.body.streakFreezes === 0, r.raw);
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
