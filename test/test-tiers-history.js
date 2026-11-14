/* test-tiers-history.js — Phase 3B, access tiers slice 2: practice history. An Open student keeps the last 5
   runs (stored trimmed, not hidden); GOC keeps up to 30. Mistakes and the daily quest read the same trimmed list.
   node test/test-tiers-history.js  */
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
var PORT = Number(process.env.GOC_TIER_HIST_PORT) || 8159;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-hist-'));
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





var staff, openToken, gocToken, gocId, gocPw;
function runN(n, wrong) {
  return { mode: 'practice', subject: 'Physics', total: 1, answered: 1, correct: wrong ? 0 : 1, wrong: wrong ? 1 : 0, percent: wrong ? 0 : 100,
    ts: Date.now() + n, topics: [{ topic: 'Motion', percent: wrong ? 0 : 100, band: 'developing' }],
    review: [{ n: 1, topic: 'Motion', text: 'History question number ' + n + ' about motion?', options: ['a', 'b', 'c', 'd'], answer: 1, given: wrong ? 0 : 1, isCorrect: !wrong, explanation: 'x' }] };
}
function postRuns(token, count) {
  var p = Promise.resolve();
  for (var i = 1; i <= count; i++) (function (n) {
    p = p.then(function () { return call('POST', '/api/me/practice', runN(n, n === 1), token); }).then(function (r) {
      if (r.status !== 200) throw new Error('could not post a run: ' + r.raw);
    });
  })(i);
  return p;
}
function stamps(r) { return (r.body.runs || []).map(function (x) { return x.review[0].text.replace(/\D+/g, ''); }).join(); }

head('pure rules');
ok('live table: Open keeps 30 runs, GOC has no count limit', core.tierLimits('open').practiceHistory === 30 && core.tierLimits('goc').practiceHistory === null);
ok('(machinery) the old Open number was 5', require('./legacy-limits.js').loadCore(APP).tierLimits('open').practiceHistory === 5);

start().then(function () {
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  staff = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staff);
}).then(function () {
  return call('POST', '/api/admin/students', { name: 'Chidi History', email: 'chidi.history@example.com', phone: '08000000062',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, staff);
}).then(function (r) {
  gocId = r.body.student.id; gocPw = r.body.temporaryPassword;
  return call('POST', '/api/auth/login', { id: gocId, password: gocPw });
}).then(function (r) {
  gocToken = r.body.token;
  return postRuns(gocToken, 8);
}).then(function () {
  return call('GET', '/api/me/practice', undefined, gocToken);
}).then(function (r) {
  head('a GOC student');
  ok('keeps all 8 runs, newest first', (r.body.runs || []).length === 8 && stamps(r) === '8,7,6,5,4,3,2,1', stamps(r));
  return activeStudent.signedUp(call, signupBody('Ada History', '08000000061'));
}).then(function (r) {
  openToken = r.body.token;
  return postRuns(openToken, 7);
}).then(function () {
  return call('GET', '/api/me/practice', undefined, openToken);
}).then(function (r) {
  head('an Open student');
  ok('keeps only the newest 5 of 7', (r.body.runs || []).length === 5 && stamps(r) === '7,6,5,4,3', stamps(r));
  var stored = readDb().practiceRuns;
  var mine = Object.keys(stored).filter(function (k) { return k !== gocId && stored[k].length; });
  ok('  and the older two are gone from storage, not just hidden', mine.length === 1 && stored[mine[0]].length === 5, JSON.stringify(Object.keys(stored)));
  return call('GET', '/api/me/mistakes', undefined, openToken);
}).then(function (r) {
  ok('  the wrong answer in the oldest run no longer shows in mistakes', r.status === 200 && (r.body.mistakes || []).length === 0, r.raw);
  return call('GET', '/api/me/mistakes', undefined, gocToken);
}).then(function (r) {
  ok('GOC still sees that mistake', r.status === 200 && (r.body.mistakes || []).length === 1, r.raw);
  head('demoting a GOC student to Open');
  return halt();
}).then(function () {
  var db = readDb();
  db.students.forEach(function (s) { if (s.id === gocId) s.tier = 'open'; });
  writeDb(db);
  return start();
}).then(function () {
  return call('POST', '/api/auth/login', { id: gocId, password: gocPw });
}).then(function (r) {
  return call('GET', '/api/me/practice', undefined, r.body.token);
}).then(function (r) {
  ok('their history is cut to 5 on the next read', (r.body.runs || []).length === 5 && stamps(r) === '8,7,6,5,4', stamps(r) + ' ' + r.status);
  var stored = readDb().practiceRuns[gocId];
  ok('  and the cut is stored', stored.length === 5, stored.length);

  head('a GOC student: no count limit, but runs older than a year are dropped');
  return halt();
}).then(function () {
  var db = readDb();
  db.students.forEach(function (s) { if (s.id === gocId) s.tier = 'goc'; });
  var runs = [];
  for (var i = 1; i <= 40; i++) runs.push(Object.assign(runN(100 + i, false), { ts: Date.now() - i * 1000 }));
  runs.push(Object.assign(runN(201, false), { ts: Date.now() - 400 * 86400000 }));
  runs.push(Object.assign(runN(202, false), { ts: Date.now() - 800 * 86400000 }));
  db.practiceRuns[gocId] = runs;
  writeDb(db);
  return start();
}).then(function () {
  return call('POST', '/api/auth/login', { id: gocId, password: gocPw });
}).then(function (r) {
  return call('GET', '/api/me/practice', undefined, r.body.token);
}).then(function (r) {
  ok('all 40 recent runs are kept (past the old 30)', (r.body.runs || []).length === 40, (r.body.runs || []).length);
  ok('  and the two runs older than a year are gone', !(r.body.runs || []).some(function (x) { return /number (201|202) /.test(x.review[0].text); }));
  ok('  and the trim is stored', readDb().practiceRuns[gocId].length === 40, readDb().practiceRuns[gocId].length);
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (history): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
