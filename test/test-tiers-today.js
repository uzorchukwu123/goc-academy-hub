/* test-tiers-route.js — Phase 3B, access tiers slice 2 (part 2): the per-day practice
   counter (Lagos day) and the "left today" fields on GET /api/me. Plus
   enforcement at study start (shorten to fit, refuse when spent).
   node test/test-tiers-today.js  */
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
var PORT = Number(process.env.GOC_TIER_TODAY_PORT) || 8155;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-today-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
/* Open practice is unrestricted in the live table; this suite proves the limit
   machinery, so the sandbox copy of the core carries the old Open numbers. */
require('./legacy-limits.js').patchSandbox(SANDBOX);
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var DATA = path.join(SANDBOX, 'server', 'data.json');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); }
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

var child = null, serverLog = '';
function start() {
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (c) { serverLog += c; });
  child.stderr.on('data', function (c) { serverLog += c; });
  return waitForBoot(60);
}
function halt() {
  return new Promise(function (resolve) {
    if (!child) return resolve();
    child.once('exit', function () { child = null; resolve(); });
    child.kill();
  });
}
function cleanup() {
  try { if (child) child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}
function readDb() { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
function writeDb(db) { fs.writeFileSync(DATA, JSON.stringify(db)); }

function signupBody(name, phone) {
  return { signupCode: SIGNUP, name: name, password: 'secret123', email: name.split(' ')[0].toLowerCase() + '@example.com',
    phone: phone, goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };
}


function sit(token, count) {
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Physics', count: count }, token).then(function (h) {
    var responses = {};
    (h.body.questions || []).forEach(function (q) { responses[q.id] = q.answer; });
    return call('POST', '/api/me/study/submit', { paperId: h.body.paperId, responses: responses }, token);
  });
}

var token, answeredFirst;

start().then(function () {
  head('a new student has the whole day left');
  return activeStudent.signedUp(call, signupBody('Ada Count', '08000000021'));
}).then(function (r) {
  token = r.body.token;
  return call('GET', '/api/me', undefined, token);
}).then(function (r) {
  var t = r.body.today || {};
  ok('GET /api/me carries today.day as the Lagos day', t.day === core.lagosDay(), r.raw);
  ok('  an Open student has 20 left, none used', t.practice && t.practice.limit === 20 && t.practice.used === 0 && t.practice.remaining === 20 && t.practice.allowed === true, JSON.stringify(t));

  head('a practice run is counted');
  return sit(token, 5);
}).then(function (r) {
  ok('the run is marked as before', r.status === 200 && r.body.answered > 0, r.raw);
  answeredFirst = r.body.answered;
  return call('GET', '/api/me', undefined, token);
}).then(function (r) {
  var p = r.body.today.practice;
  ok('  used now equals the questions answered', p.used === answeredFirst, JSON.stringify(p));
  ok('  remaining falls by the same amount', p.remaining === 20 - answeredFirst, JSON.stringify(p));
  ok('  the stored record carries the Lagos day', readDb().students[0].practiceCountDay === core.lagosDay());
  return sit(token, 5);
}).then(function (r) {
  return call('GET', '/api/me', undefined, token).then(function (me) { return { run: r, me: me }; });
}).then(function (x) {
  ok('a second run adds to the count', x.me.body.today.practice.used === answeredFirst + x.run.body.answered, JSON.stringify(x.me.body.today));

  head('the allowance is enforced at study start');
  var db = readDb();
  db.students[0].practiceCount = 25;
  writeDb(db);
  return halt().then(start).then(function () {
    return call('POST', '/api/auth/login', { id: db.students[0].id, password: 'secret123' });
  });
}).then(function (r) {
  token = r.body.token;
  return call('GET', '/api/me', undefined, token);
}).then(function (r) {
  var p = r.body.today.practice;
  ok('over the limit reads as zero left and not allowed, never negative', p.remaining === 0 && p.allowed === false && p.used === 25, JSON.stringify(p));
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Physics', count: 5 }, token);
}).then(function (r) {
  ok('with nothing left a run is refused 403 with reason daily', r.status === 403 && r.body.reason === 'daily', r.raw);
  ok('  the message says come back tomorrow and how to join', /midnight/.test(r.body.error) && /GOC/.test(r.body.error), r.raw);
  ok('  and the reply carries today.practice with 0 remaining', r.body.today && r.body.today.practice.remaining === 0, r.raw);
    return call('POST', '/api/me/study/start', { mode: 'cbt', subject: 'Physics', count: 5, minutes: 10 }, token);
}).then(function (r) {
  ok('  (CBT) refused 403 daily', r.status === 403 && r.body.reason === 'daily', r.raw);

  head('a run bigger than what is left is shortened to fit');
  var db = readDb();
  db.students[0].practiceCountDay = core.lagosDay();
  db.students[0].practiceCount = 18;
  writeDb(db);
  return halt().then(start).then(function () {
    return call('POST', '/api/auth/login', { id: db.students[0].id, password: 'secret123' });
  });
}).then(function (r) {
  token = r.body.token;
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Physics', count: 10 }, token);
}).then(function (r) {
  ok('asking for 10 with 2 left serves 2', r.status === 200 && r.body.total === 2 && r.body.questions.length === 2, r.raw);
  ok('  and says it was shortened (asked is what the bank could serve)', r.body.capped === true && r.body.asked > r.body.total, r.raw);
  return call('POST', '/api/me/study/submit', { paperId: r.body.paperId, responses: {} }, token);
}).then(function () {
  head('a run is held to 10 questions for an Open student');
  var db = readDb();
  db.students[0].practiceCount = 0;
  writeDb(db);
  return halt().then(start).then(function () {
    return call('POST', '/api/auth/login', { id: db.students[0].id, password: 'secret123' });
  });
}).then(function (r) {
  token = r.body.token;
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Physics', count: 30 }, token);
}).then(function (r) {
  ok('asking for 30 serves no more than 10', r.status === 200 && r.body.total <= 10, r.raw);
  ok('  and is flagged shortened only when the 10-a-run limit actually bit', r.body.capped === (r.body.asked > 10), r.raw);

  head('a count from an earlier day reads as zero');
  var db = readDb();
  db.students[0].practiceCountDay = '2000-01-01';
  db.students[0].practiceCount = 19;
  writeDb(db);
  return halt().then(start).then(function () {
    return call('POST', '/api/auth/login', { id: db.students[0].id, password: 'secret123' });
  });
}).then(function (r) {
  return call('GET', '/api/me', undefined, r.body.token);
}).then(function (r) {
  var p = r.body.today.practice;
  ok('yesterday\'s count is not carried into today', p.used === 0 && p.remaining === 20, JSON.stringify(p));

  head('a GOC student is counted but unlimited');
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  var staff = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staff).then(function () {
    return call('POST', '/api/admin/students', { name: 'Chidi Count', email: 'chidi.count@example.com', phone: '08000000022',
      goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, staff);
  });
}).then(function (r) {
  return call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword });
}).then(function (r) {
  var t = r.body.token;
  return call('GET', '/api/me', undefined, t).then(function (me) {
    ok('a GOC student has no practice limit', me.body.today.practice.limit === null && me.body.today.practice.unlimited === true && me.body.today.practice.allowed === true, JSON.stringify(me.body.today));
    return sit(t, 5);
  }).then(function (run) {
    return call('GET', '/api/me', undefined, t).then(function (me) {
      ok('  but the questions are still counted', me.body.today.practice.used === run.body.answered && run.body.answered > 0, JSON.stringify(me.body.today));
    });
  });
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (slice 2, part 2): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
