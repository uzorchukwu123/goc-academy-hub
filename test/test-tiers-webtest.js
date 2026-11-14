/* test-tiers-webtest.js — Phase 3B, access tiers slice 2: Web Tests (Theory, Objective, JAMB-oriented)
   are for GOC students; an Open student is refused at the start route (403, reason tier).
   node test/test-tiers-webtest.js  */
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
var PORT = Number(process.env.GOC_TIER_WT_PORT) || 8160;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-wt-'));
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
  head('rules in core');
  ok('Open is refused Objective and Theory, but may sit the JAMB-oriented test', !core.webTestAllowed('theory', 'open') && !core.webTestAllowed('objective', 'open') && core.webTestAllowed('jamb', 'open'));
  ok('a missing tier is refused (fail closed)', !core.webTestAllowed('objective', undefined));
  ok('GOC may sit all three', ['theory','objective','jamb'].every(function (s) { return core.webTestAllowed(s, 'goc'); }));
  ok('an unknown section is refused for everyone', !core.webTestAllowed('practice', 'goc'));

  head('an Open student cannot start a Web Test');
  return activeStudent.signedUp(call, signupBody('Ola Open', '08000000041'));
}).then(function (r) {
  token = r.body.token;
  return call('GET', '/api/me', undefined, token);
}).then(function (r) {
  ok('the student really is Open', r.body.tier === 'open', r.raw);
  return call('GET', '/api/me/tests', undefined, token);
}).then(function (r) {
  var rows = (r.body && r.body.tests) || [];
  ok('the catalogue still lists papers', r.status === 200 && rows.length > 0, r.raw);
  ok('  and every row is marked locked', rows.length > 0 && rows.every(function (x) { return x.locked === true; }), r.raw);
  return call('POST', '/api/me/tests/start', { section: 'objective' }, token);
}).then(function (r) {
  ok('objective refused 403 with reason tier', r.status === 403 && r.body.reason === 'tier', r.raw);
  ok('  the message points to GOC and to practice', /GOC/.test(r.body.error) && /practice/.test(r.body.error), r.raw);
  return call('POST', '/api/me/tests/start', { section: 'theory', subject: 'Physics' }, token);
}).then(function (r) {
  ok('theory refused 403 with reason tier', r.status === 403 && r.body.reason === 'tier', r.raw);
  return call('POST', '/api/me/tests/start', { section: 'jamb' }, token);
}).then(function (r) {
  ok('the JAMB-oriented test is not refused for tier (Open may sit it)', !(r.status === 403 && r.body && r.body.reason === 'tier'), r.raw);
  return call('POST', '/api/me/tests/start', { section: 'practice' }, token);
}).then(function (r) {
  ok('a non-Web-Test section is not given the tier refusal', r.status !== 200 && !(r.body && r.body.reason === 'tier'), r.raw);
  var db = readDb();
  ok('nothing was opened or recorded', !(db.attempts || []).length, JSON.stringify(db.attempts));

  head('a GOC student can start one');
  db.students[0].tier = 'goc';
  writeDb(db);
  return halt().then(start);
}).then(function () {
  return call('POST', '/api/auth/login', { id: readDb().students[0].id, password: 'secret123' });
}).then(function (r) {
  token = r.body.token;
  return call('GET', '/api/me/tests', undefined, token);
}).then(function (r) {
  var rows = (r.body && r.body.tests) || [];
  ok('no row is locked', rows.length > 0 && rows.every(function (x) { return !x.locked; }), r.raw);
  return call('POST', '/api/me/tests/start', { section: 'objective' }, token);
}).then(function (r) {
  ok('objective starts', r.status === 200 || r.status === 201, r.raw);
}).catch(function (e) {
  fails++; console.log('  FAIL  threw: ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
}).then(function () {
  cleanup();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
});
