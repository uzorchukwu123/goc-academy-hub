/* test-quest-weekly-route.js — Phase 2, weekly quest slice 2: the stored week, its route, and
   progress recorded by study-submit.   node test/test-quest-weekly-route.js */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8170;

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
  waitForBoot(40).then(function () {
    head('Weekly quest route and progress (Phase 2, weekly quest slice 2)');
    var token, id;
    return activeStudent.signedUp(call, signup).then(function (r) {
      token = r.body.token; id = r.body.id || (r.body.student && r.body.student.id);
      setWeek(id, { tier: 'goc' });   /* an academy student: a public sign-up is Open and has a daily allowance */
      return call('GET', '/api/me/weekly-quest', undefined, token);
    }).then(function (r) {
      var q = r.body && r.body.weeklyQuest;
      ok('a new student starts the week empty', r.status === 200 && q && q.week === THIS_MON && q.days === 0 && q.questions === 0 && !q.done && !q.claimed, r.raw);
      ok('the week is Monday to Sunday', q.week === core.weekStart() && q.endsOn === core.weekEnd(), r.raw);
      ok('targets are 5 daily quests or 100 questions', q.targetDays === 5 && q.targetQuestions === 100, r.raw);
      ok('the route also reports freezes held', r.body.streakFreezes === 0, r.raw);
      return sit(token, 5, false);
    }).then(function (r) {
      ok('the submit reply carries the week', r.status === 200 && r.body.weekQuest && r.body.weekQuest.questions === 5 && r.body.weekQuest.days === 0, r.raw);
      return call('GET', '/api/me/weekly-quest', undefined, token);
    }).then(function (r) {
      var q = r.body.weeklyQuest;
      ok('answered questions are counted', q.questions === 5 && q.days === 0 && q.remainingQuestions === 95, r.raw);
      return sit(token, 5, true);
    }).then(function (r) {
      /* 5 + 5 answered today completes the plain daily goal: that is one day */
      ok('finishing the daily quest adds a day', r.body.questClaimed === true && r.body.weekQuest.days === 1 && r.body.weekQuest.questions === 10, r.raw);
      return sit(token, 5, false);
    }).then(function (r) {
      ok('a later run the same day adds questions, not a second day', r.body.questClaimed === false && r.body.weekQuest.days === 1 && r.body.weekQuest.questions === 15, r.raw);
      return call('GET', '/api/me/weekly-quest', undefined, token);
    }).then(function (r) {
      ok('the route agrees with the submit reply', r.body.weeklyQuest.days === 1 && r.body.weeklyQuest.questions === 15, r.raw);
      ok('the progress is stored on the student', (function () { var s = getStudent(id); return s && s.weekQuest && s.weekQuest.week === THIS_MON && s.weekQuest.questions === 15 && s.weekQuest.days === 1; })());
      setWeek(id, { weekQuest: { week: LAST_MON, days: 5, questions: 140, claimed: true } });
      return call('GET', '/api/me/weekly-quest', undefined, token);
    }).then(function (r) {
      var q = r.body.weeklyQuest;
      ok('last week\'s record reads as an empty new week', q.week === THIS_MON && q.days === 0 && q.questions === 0 && !q.claimed && !q.done, r.raw);
      return sit(token, 5, false);
    }).then(function (r) {
      ok('a run after the week turns starts the new week from the run', r.body.weekQuest.questions === 5 && r.body.weekQuest.week === THIS_MON && !r.body.weekQuest.claimed, r.raw);
      setWeek(id, { weekQuest: { week: THIS_MON, days: 'x', questions: -9, claimed: 'yes' } });
      return call('GET', '/api/me/weekly-quest', undefined, token);
    }).then(function (r) {
      var q = r.body.weeklyQuest;
      ok('a damaged stored record is read safely', r.status === 200 && q.days === 0 && q.questions === 0 && q.claimed === false, r.raw);
      return call('GET', '/api/me/weekly-quest', undefined, null);
    }).then(function (r) {
      ok('the weekly quest needs a student session', r.status === 401 || r.status === 403);
      return call('POST', '/api/me/weekly-quest', { days: 5 }, token);
    }).then(function (r) {
      ok('there is no way for the page to write the week', r.status === 404 || r.status === 405, String(r.status));
      return call('POST', '/api/me/study/start', { mode: 'cbt', subject: 'Physics', count: 5, minutes: 10 }, token);
    }).then(function (h) {
      return call('POST', '/api/me/study/submit', { paperId: h.body.paperId, responses: {} }, token);
    }).then(function (r) {
      ok('a CBT set-up run never touches the week', r.status === 200 && r.body.weekQuest === null, r.raw);
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
