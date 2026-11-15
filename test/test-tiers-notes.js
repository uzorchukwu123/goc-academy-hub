/* test-tiers-route.js — Phase 3B, access tiers slice 2 (part 2): the notes by tier: an Open student can read the
   first 3 notes of each subject; the rest are listed but locked (no body sent).
   node test/test-tiers-notes.js  */
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
var PORT = Number(process.env.GOC_TIER_NOTES_PORT) || 8157;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-notes-'));
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




function noteBody(n) { return { subject: 'Physics', topic: n < 4 ? 'Motion' : 'Waves', title: 'Physics note ' + n, minutes: 3,
  body: 'This is the full text of physics note number ' + n + ', long enough to count as a note.' }; }

var staff, openToken, gocToken, refIds, ids = [];

start().then(function () {
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  staff = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staff);
}).then(function () {
  var p = Promise.resolve();
  for (var i = 1; i <= 5; i++) (function (n) {
    p = p.then(function () { return call('POST', '/api/notes', noteBody(n), staff); }).then(function (r) { ids.push(r.body.id); });
  })(i);
  return p;
}).then(function () {
  /* The seed already holds Physics notes, so the reference is the GOC view
     of every Physics note in id order, not an assumed empty subject. */
  return call('POST', '/api/admin/students', { name: 'Chidi Reader', email: 'chidi.reader@example.com', phone: '08000000042',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, staff);
}).then(function (r) {
  return call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword });
}).then(function (r) {
  gocToken = r.body.token;
  return call('GET', '/api/me/notes?subject=Physics', undefined, gocToken);
}).then(function (r) {
  head('a GOC student');
  var all = r.body.notes || [];
  refIds = all.map(function (n) { return Number(n.id); }).sort(function (a, b) { return a - b; });
  ok('reads every Physics note, none locked, with text', all.length >= 6 && all.every(function (n) { return !n.locked && n.body; }), r.raw);
  return activeStudent.signedUp(call, signupBody('Ada Reader', '08000000041'));
}).then(function (r) {
  openToken = r.body.token;
  return call('GET', '/api/me/notes?subject=Physics', undefined, openToken);
}).then(function (r) {
  head('an Open student');
  var rows = r.body.notes || [];
  var open = rows.filter(function (n) { return !n.locked; }), locked = rows.filter(function (n) { return n.locked; });
  ok('sees every Physics note listed', rows.length === refIds.length, r.raw);
  ok('  exactly three are readable', open.length === 3, JSON.stringify(rows.map(function (n) { return n.locked; })));
  ok('  and they are the three oldest', open.map(function (n) { return Number(n.id); }).sort(function (a, b) { return a - b; }).join() === refIds.slice(0, 3).join(), JSON.stringify(open.map(function (n) { return n.id; })));
  ok('  the readable ones carry their text', open.every(function (n) { return n.body && !n.locked; }));
  ok('  the rest are marked locked, still with title and topic', locked.length === refIds.length - 3 && locked.every(function (n) { return n.locked === true && n.title && n.topic; }));
  ok('  the locked ones carry no text at all', locked.every(function (n) { return n.body === ''; }));
  var lastId = refIds[refIds.length - 1];
  ok('  my newest test note (id ' + lastId + ') is locked and its words never left the server', r.raw.indexOf('number 5') === -1, r.raw);
  return call('GET', '/api/me/notes?subject=Physics&topic=Waves', undefined, openToken);
}).then(function (r) {
  var rows = (r.body.notes || []).filter(function (n) { return /^Physics note/.test(n.title); });
  ok('filtering by topic does not move the line (my Waves notes are all locked)', rows.length === 2 && rows.every(function (n) { return n.locked; }), r.raw);

  head('a hidden note does not use up a place');
  return call('PUT', '/api/notes/' + refIds[0] + '/active', { active: false }, staff);
}).then(function () {
  return call('GET', '/api/me/notes?subject=Physics', undefined, openToken);
}).then(function (r) {
  var rows = r.body.notes || [];
  var open = rows.filter(function (n) { return !n.locked; }).map(function (n) { return Number(n.id); }).sort(function (a, b) { return a - b; });
  ok('with the oldest switched off, the next three are readable', open.join() === refIds.slice(1, 4).join() && rows.length === refIds.length - 1, JSON.stringify(open));
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (notes): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
