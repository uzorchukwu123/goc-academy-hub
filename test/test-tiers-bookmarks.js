/* test-tiers-route.js — Phase 3B, access tiers slice 2 (part 2): the saved-question (bookmark) cap by
   tier: 20 for Open, none for GOC; refuse when full, trim an over-full list.
   node test/test-tiers-bookmarks.js  */
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
var PORT = Number(process.env.GOC_TIER_BM_PORT) || 8156;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-bm-'));
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



function bm(n) { return { id: 1000 + n, subject: 'Physics', topic: 'Motion', text: 'Saved question number ' + n, options: ['a', 'b', 'c', 'd'], answer: 1, explanation: 'x' }; }
function saveMany(token, from, to) {
  var p = Promise.resolve();
  for (var i = from; i <= to; i++) (function (n) { p = p.then(function () { return call('POST', '/api/me/bookmarks', bm(n), token); }); })(i);
  return p;
}

var token, id;

start().then(function () {
  head('an Open student can save 20 questions');
  return activeStudent.signedUp(call, signupBody('Ada Saver', '08000000031'));
}).then(function (r) {
  token = r.body.token;
  return saveMany(token, 1, 20);
}).then(function () {
  return call('GET', '/api/me/bookmarks', undefined, token);
}).then(function (r) {
  ok('twenty are kept', r.status === 200 && r.body.bookmarks.length === 20, r.raw);
  ok('  the list says what the limit is', r.body.limit === 20, r.raw);

  head('the 21st is refused, with a way forward');
  return call('POST', '/api/me/bookmarks', bm(21), token);
}).then(function (r) {
  ok('refused 409 with reason tier and the limit', r.status === 409 && r.body.reason === 'tier' && r.body.limit === 20, r.raw);
  ok('  the message says remove one first, or ask about GOC', /Remove one/.test(r.body.error) && /GOC/.test(r.body.error), r.raw);
  return call('POST', '/api/me/bookmarks', bm(5), token);
}).then(function (r) {
  ok('saving one already saved is still fine when full', r.status === 200 && r.body.already === true, r.raw);
  return call('GET', '/api/me/bookmarks', undefined, token);
}).then(function (r) {
  ok('nothing was dropped to make room', r.body.bookmarks.length === 20 && r.body.bookmarks.some(function (b) { return /number 1$/.test(b.text); }), r.raw);
  var key = r.body.bookmarks[0].key;
  return call('DELETE', '/api/me/bookmarks/' + key, undefined, token);
}).then(function (r) {
  ok('removing one makes room', r.status === 200 && r.body.bookmarks.length === 19, r.raw);
  return call('POST', '/api/me/bookmarks', bm(21), token);
}).then(function (r) {
  ok('  and the next save goes through', r.status === 200 && r.body.bookmarks.length === 20, r.raw);

  head('an Open list that is over the limit is trimmed at once');
  var db = readDb();
  id = db.students[0].id;
  var list = [];
  for (var i = 30; i >= 1; i--) list.push({ key: 'k' + i, text: 'Old ' + i, options: ['a', 'b'], ts: 1000 + i });
  db.bookmarks[id] = list;
  writeDb(db);
  return halt().then(start).then(function () {
    return call('POST', '/api/auth/login', { id: id, password: 'secret123' });
  });
}).then(function (r) {
  token = r.body.token;
  return call('GET', '/api/me/bookmarks', undefined, token);
}).then(function (r) {
  ok('reading shows only 20', r.body.bookmarks.length === 20, r.raw);
  ok('  the newest 20 are the ones kept', r.body.bookmarks[0].key === 'k30' && r.body.bookmarks[19].key === 'k11', r.raw);
  ok('  and the trim is stored', readDb().bookmarks[id].length === 20);

  head('a GOC student has no limit on saved questions');
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  var staff = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staff).then(function () {
    return call('POST', '/api/admin/students', { name: 'Chidi Saver', email: 'chidi.saver@example.com', phone: '08000000032',
      goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, staff);
  });
}).then(function (r) {
  return call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword });
}).then(function (r) {
  var t = r.body.token;
  return saveMany(t, 1, 210).then(function () { return call('GET', '/api/me/bookmarks', undefined, t); });
}).then(function (r) {
  ok('210 saved without a refusal (past the old cap of 200), and the limit reads as none', r.body.bookmarks.length === 210 && r.body.limit === null, r.body.bookmarks.length + ' ' + r.body.limit);
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (bookmarks): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
