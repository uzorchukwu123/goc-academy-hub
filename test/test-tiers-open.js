/* test-tiers-open.js — Phase 3B: the practice section and the JAMB-oriented Web Test are open to Open
   students with no tier restriction (live tier table, nothing patched). Objective and Theory Web Tests, and
   the other limits (notes, bookmarks, reviews), still hold.
   node test/test-tiers-open.js */
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
var PORT = Number(process.env.GOC_TIER_OPEN_PORT) || 8161;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-open-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
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





var staff, openToken, gocToken;
function pq(year, n) { return { subject: 'Chemistry', section: 'practice', topic: 'Acids', text: 'Past question ' + year + ' number ' + n + ' about acids?', options: ['a', 'b', 'c', 'd'], answer: 1, year: year }; }
function chem(r) { return ((r.body.subjects || []).filter(function (s) { return s.subject === 'Chemistry'; })[0]) || {}; }
function yrs(e) { return (e.years || []).map(function (y) { return y.year; }); }

/* pastQ is as in the past-years suite: Chemistry, dated 2021 (x3) and 2018 (x2), plus 12 undated. */
function mk(year, n) { return { subject: 'Chemistry', section: 'practice', topic: 'Acids', text: 'Open access question ' + (year || 'undated') + ' number ' + n + ' about acids?', options: ['a', 'b', 'c', 'd'], answer: 1, year: year }; }
function wr(n) { return { mode: 'practice', subject: 'Chemistry', total: 1, answered: 1, correct: 0, wrong: 1, percent: 0, ts: Date.now() + n,
  topics: [{ topic: 'Acids', percent: 0, band: 'weak' }], review: [{ n: 1, topic: 'Acids', text: 'Open history ' + n + '?', options: ['a', 'b', 'c', 'd'], answer: 1, given: 0, isCorrect: false, explanation: 'x' }] }; }

var staff, openToken;
start().then(function () {
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  staff = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staff);
}).then(function () {
  var p = Promise.resolve(), list = [2021, 2021, 2021, 2018, 2018];
  for (var i = 1; i <= 12; i++) list.push(null);
  list.forEach(function (y, i) {
    p = p.then(function () { return call('POST', '/api/questions', mk(y, i + 1), staff); }).then(function (r) {
      if (r.status !== 200 && r.status !== 201) throw new Error('could not seed: ' + r.raw);
    });
  });
  return p;
}).then(function () {
  return activeStudent.signedUp(call, signupBody('Ada Open', '08000000081'));
}).then(function (r) {
  openToken = r.body.token;
  return call('GET', '/api/me', undefined, openToken);
}).then(function (r) {
  head('an Open student: practice');
  ok('is Open', r.body.tier === 'open');
  ok('  practice shows no daily limit', r.body.today.practice.unlimited === true && r.body.today.practice.limit === null && r.body.limits.practiceRunMax === null, JSON.stringify(r.body.today));
  return call('GET', '/api/me/study', undefined, openToken);
}).then(function (r) {
  var e = ((r.body.subjects || []).filter(function (s) { return s.subject === 'Chemistry'; })[0]) || {};
  ok('is offered every past-paper year', (e.years || []).map(function (y) { return y.year; }).join() === '2021,2018' && e.yearsLocked === 0, r.raw.slice(0, 300));
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', years: [2018], count: 5 }, openToken);
}).then(function (r) {
  ok('can practise the older year', r.status === 200 && r.body.total === 2, r.raw);
  return call('POST', '/api/me/study/submit', { paperId: r.body.paperId, responses: {} }, openToken);
}).then(function () {
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', count: 15 }, openToken);
}).then(function (r) {
  ok('can start a run of 15 (no 10-question cap)', r.status === 200 && r.body.total === 15 && r.body.capped === false, r.raw.slice(0, 300));
  return call('POST', '/api/me/study/submit', { paperId: r.body.paperId, responses: {} }, openToken);
}).then(function () {
  var p = Promise.resolve(), n;
  for (n = 1; n <= 8; n++) (function (k) { p = p.then(function () { return call('POST', '/api/me/practice', wr(k), openToken); }); })(n);
  return p;
}).then(function () {
  return call('GET', '/api/me/practice', undefined, openToken);
}).then(function (r) {
  ok('keeps all 8 stored practice runs (not trimmed to 5)', (r.body.runs || []).length === 8, String((r.body.runs || []).length));
  head('an Open student: Web Tests');
  return call('POST', '/api/me/tests/start', { section: 'objective' }, openToken);
}).then(function (r) {
  ok('Objective is still refused (403, tier)', r.status === 403 && r.body.reason === 'tier', r.raw);
  return call('POST', '/api/me/tests/start', { section: 'theory', subject: 'Physics' }, openToken);
}).then(function (r) {
  ok('Theory is still refused (403, tier)', r.status === 403 && r.body.reason === 'tier', r.raw);
  return call('POST', '/api/me/tests/start', { section: 'jamb' }, openToken);
}).then(function (r) {
  ok('the JAMB-oriented test is not refused for tier', !(r.status === 403 && r.body && r.body.reason === 'tier'), r.raw.slice(0, 300));
  return call('GET', '/api/me/tests', undefined, openToken);
}).then(function (r) {
  var rows = r.body.tests || r.body.papers || r.body.rows || [];
  var j = rows.filter(function (x) { return x.section === 'jamb'; })[0];
  var o = rows.filter(function (x) { return x.section === 'objective'; })[0];
  ok('the Web Test list does not lock the JAMB row', !j || !j.locked, JSON.stringify(j));
  ok('  but still locks the Objective row', !o || o.locked === true, JSON.stringify(o));
  head('the other limits still hold');
  return call('GET', '/api/me', undefined, openToken);
}).then(function (r) {
  ok('bookmarks 20, notes 3 a subject, reviews 10 a day', r.body.limits.bookmarks === 20 && r.body.limits.notesPerSubject === 3 && r.body.limits.reviewsPerDay === 10, JSON.stringify(r.body.limits));
  ok('videos and class replays stay GOC-only', r.body.features.videos === false && r.body.features.classRecordings === false);
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (open access): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
