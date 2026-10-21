/* test-tiers-reviews.js — Phase 3B, access tiers slice 2: spaced review. An Open student may answer 10 spaced
   reviews a Lagos day; GOC has no limit. Counted on the server, reset by the Lagos day.
   node test/test-tiers-reviews.js  */
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
var PORT = Number(process.env.GOC_TIER_REV_PORT) || 8160;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-rev-'));
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





var staff, openToken, openId, gocToken, gocId, gocPw;
function wrongRun(n) {
  var review = [];
  for (var i = 1; i <= n; i++) review.push({ n: i, topic: 'Motion', text: 'Review limit question ' + i + ' about motion?', options: ['a', 'b', 'c', 'd'], answer: 1, given: 0, isCorrect: false, explanation: 'x' });
  return { mode: 'practice', subject: 'Physics', total: n, answered: n, correct: 0, wrong: n, percent: 0, ts: Date.now() - 3 * 86400000,
    topics: [{ topic: 'Motion', percent: 0, band: 'weak' }], review: review };
}
function answerMany(token, count) {
  var results = [], p = Promise.resolve();
  for (var i = 0; i < count; i++) p = p.then(function () {
    return call('GET', '/api/me/review', undefined, token).then(function (r) {
      var due = (r.body.review && r.body.review.due) || [];
      if (!due.length) return { status: 0, body: { error: 'nothing due' } };
      return call('POST', '/api/me/review', { key: due[0].key, given: 1 }, token);
    }).then(function (r) { results.push(r); });
  });
  return p.then(function () { return results; });
}
function reviews(r) { return r.body && r.body.today && r.body.today.reviews; }

head('pure rules');
ok('Open allows 10 a day, GOC is unlimited', core.reviewAllowance(0, 'open').limit === 10 && core.reviewAllowance(999, 'goc').unlimited === true);
ok('the message says when it comes back and how to join', /midnight/.test(core.reviewLimitMessage(10)) && /GOC/.test(core.reviewLimitMessage(10)) && /10/.test(core.reviewLimitMessage(10)));

start().then(function () {
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  staff = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staff);
}).then(function () {
  return call('POST', '/api/admin/students', { name: 'Chidi Review', email: 'chidi.review@example.com', phone: '08000000072',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, staff);
}).then(function (r) {
  gocId = r.body.student.id; gocPw = r.body.temporaryPassword;
  return call('POST', '/api/auth/login', { id: gocId, password: gocPw });
}).then(function (r) {
  gocToken = r.body.token;
  return call('POST', '/api/me/practice', wrongRun(12), gocToken);
}).then(function () {
  return answerMany(gocToken, 12);
}).then(function (rs) {
  head('a GOC student');
  ok('answers 12 spaced reviews in a day, none refused', rs.length === 12 && rs.every(function (r) { return r.status === 200; }), JSON.stringify(rs.map(function (r) { return r.status; })));
  ok('  the reply shows no limit', reviews(rs[11]) && reviews(rs[11]).unlimited === true && reviews(rs[11]).limit === null, JSON.stringify(rs[11].body));
  return activeStudent.signedUp(call, signupBody('Ada Review', '08000000071'));
}).then(function (r) {
  openToken = r.body.token;
  openId = (r.body.student && r.body.student.id) || r.body.id;
  return call('POST', '/api/me/practice', wrongRun(12), openToken);
}).then(function () {
  return call('GET', '/api/me/review', undefined, openToken);
}).then(function (r) {
  head('an Open student');
  ok('sees 10 left before starting', reviews(r) && reviews(r).limit === 10 && reviews(r).remaining === 10, r.raw.slice(0, 300));
  return answerMany(openToken, 10);
}).then(function (rs) {
  ok('answers 10 spaced reviews', rs.length === 10 && rs.every(function (r) { return r.status === 200; }), JSON.stringify(rs.map(function (r) { return r.status; })));
  ok('  the count goes down as they go', reviews(rs[0]).remaining === 9 && reviews(rs[9]).remaining === 0 && reviews(rs[9]).used === 10, JSON.stringify(reviews(rs[9])));
  return call('GET', '/api/me/review', undefined, openToken);
}).then(function (r) {
  var due = (r.body.review && r.body.review.due) || [];
  ok('  still has questions due, so the limit is what stops them', due.length > 0, r.raw.slice(0, 200));
  return call('POST', '/api/me/review', { key: due[0].key, given: 1 }, openToken);
}).then(function (r) {
  ok('the 11th is refused (403, reason daily)', r.status === 403 && r.body.reason === 'daily', r.raw);
  ok('  the message says it comes back at midnight and how to join', /midnight/.test(r.body.error || '') && /GOC/.test(r.body.error || ''), r.raw);
  ok('  and carries what is left (none)', reviews(r) && reviews(r).remaining === 0 && reviews(r).allowed === false, r.raw);
  return call('POST', '/api/me/review', { key: 'nosuchkey', given: 1 }, openToken);
}).then(function (r) {
  ok('a question that is not theirs is still a plain 404, not the limit', r.status === 404, r.raw);
  return call('GET', '/api/me', undefined, openToken);
}).then(function (r) {
  ok('GET /api/me reports today.reviews', r.body.today && r.body.today.reviews && r.body.today.reviews.remaining === 0 && r.body.today.reviews.limit === 10, JSON.stringify(r.body.today));
  ok('  and the practice count is separate (untouched)', r.body.today.practice && r.body.today.practice.used === 0, JSON.stringify(r.body.today));
  head('the next Lagos day');
  return halt();
}).then(function () {
  var db = readDb();
  Object.keys(db.reviewCount || {}).forEach(function (k) { db.reviewCount[k].day = '2000-01-01'; });
  writeDb(db);
  return start();
}).then(function () {
  return call('POST', '/api/auth/login', { id: openId, password: 'secret123' });
}).then(function (r) {
  openToken = r.body.token;
  return call('GET', '/api/me/review', undefined, openToken);
}).then(function (r) {
  ok('an old day reads as zero: 10 left again', reviews(r) && reviews(r).remaining === 10 && reviews(r).used === 0, r.raw.slice(0, 300));
  return answerMany(openToken, 1);
}).then(function (rs) {
  ok('  and they can answer again', rs[0].status === 200, JSON.stringify(rs[0].body));
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (reviews): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
