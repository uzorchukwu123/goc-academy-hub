/* test-tiers-switch.js — Phase 3B, slice 3: the console moves a student between Open and
   GOC (PUT /api/students/:id/tier), the change is recorded with who and when, and the
   rules behind the Make GOC / Restrict to Open button (core) and the offline driver
   agree with the server.
   node test/test-tiers-switch.js  */
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
var PORT = Number(process.env.GOC_TIER_PORT) || 8161;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-test-'));
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
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ---- pure rules */
head('core: parseTierChange, restrictWarning, tierChangeNote');
ok('goc and open are accepted in any capitalisation', core.parseTierChange(' GOC ').tier === 'goc' && core.parseTierChange('Open').tier === 'open');
ok('nothing, a typo or a non-string is refused (no default, unlike enrolment)',
   !core.parseTierChange(undefined).ok && !core.parseTierChange('platinum').ok && !core.parseTierChange(null).ok && !core.parseTierChange(1).ok);
var w = core.restrictWarning('Ada (GOC-S-001)');
ok('the restrict warning names the student', /Restrict Ada \(GOC-S-001\) to Open\?/.test(w), w);
ok('  says what is lost', /Web Tests/.test(w) && /live classes/.test(w) && /videos/.test(w));
ok('  says what is deleted for good, with the Open numbers from the table',
   /cannot be undone/.test(w) && /newest 20/.test(w) && /newest 30 runs/.test(w) && /does not restore it/.test(w), w);
var note = core.tierChangeNote('Ernest Uzorchukwu', '2026-10-08T13:05:00.000Z');
ok('the note says who and when, in Nigeria time (UTC+1)', /^Changed by Ernest Uzorchukwu/.test(note) && /14:05/.test(note) && /2026/.test(note), note);
ok('nothing recorded means no note', core.tierChangeNote(null, null) === '' && core.tierChangeNote('X', 'not a date') === '' && core.tierChangeNote('', '2026-10-08T13:05:00Z') === '');

/* ---- the offline driver */
var vm = require('vm');
function demoDriver() {
  var sandbox = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var ctx = vm.createContext(sandbox);
  vm.runInContext('window = this; self = this;', ctx);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f }); });
  return vm.runInContext('GOC.api._drivers.mock', ctx);
}
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }

async function demo() {
  head('offline driver: same rule, same wording');
  var mock = demoDriver();
  var s = await activeStudent.demo(mock, { signupCode: SIGNUP, name: 'Demo Open', password: 'secret123', email: 'd@example.com', phone: '08000000031',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  var id = s.student.id;
  ok('a demo sign-up is Open with nothing recorded', s.student.tier === 'open' && s.student.tierChangedAt === null);
  await mock.logout();
  ok('without a console session the change is refused', !!(await rejects(mock.setStudentTier(id, 'goc'))));
  await mock.login('GOC-A-002', 'acaddir2027');
  ok('a staff login that has not entered the passcode is refused', /passcode/i.test(await rejects(mock.setStudentTier(id, 'goc')) || ''));
  await mock.unlockConsole('2027');
  var up = await mock.setStudentTier(id, 'goc');
  ok('Make GOC works and stamps the staff member\'s name and a time',
     up.tier === 'goc' && up.tierChangedBy === 'Itsemeh Victorian' && Date.now() - Date.parse(up.tierChangedAt) < 5000, JSON.stringify(up));
  var again = await mock.setStudentTier(id, 'GOC');
  ok('asking for the tier it already has changes and records nothing', again.tierChangedAt === up.tierChangedAt && again.tier === 'goc');
  var down = await mock.setStudentTier(id, 'open');
  ok('Restrict to Open works', down.tier === 'open' && !!down.tierChangedAt);
  ok('a typo is refused with the server\'s words', /Open or GOC/.test(await rejects(mock.setStudentTier(id, 'platinum')) || ''));
  ok('an unknown Scholar ID is refused', /roster/.test(await rejects(mock.setStudentTier('GOC-S-999', 'goc')) || ''));
  var roster = await mock.listStudents();
  var row = roster.filter(function (r) { return r.id === id; })[0];
  ok('the console roster carries tier and who/when', row && row.tier === 'open' && row.tierChangedBy === 'Itsemeh Victorian');
}

/* ---- the real server */
var staffToken, stuToken, stuId, dirToken;
var stamp1, stamp2;
demo().then(function () { return start(); }).then(function () {
  head('server: a self-registered student starts Open');
  return activeStudent.signedUp(call, signupBody('Ada Switch', '08000000041'));
}).then(function (r) {
  stuToken = r.body.token; stuId = r.body.student.id;
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  staffToken = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staffToken);
}).then(function () {
  return call('GET', '/api/me', undefined, stuToken);
}).then(function (r) {
  ok('Ada is Open and the Objective Web Test is locked for her', r.body.tier === 'open' && r.body.features.webTestObjective === false);

  head('Make GOC');
  return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'goc' }, staffToken);
}).then(function (r) {
  ok('the Founder can make her GOC', r.status === 200 && r.body.tier === 'goc', r.raw);
  ok('  the reply says who (by name) and when', r.body.tierChangedBy === 'Ernest Uzorchukwu' && Date.now() - Date.parse(r.body.tierChangedAt) < 10000, r.raw);
  stamp1 = r.body.tierChangedAt;
  var rec = readDb().students.filter(function (s) { return s.id === stuId; })[0];
  ok('  the stored record carries tier, who and when', rec.tier === 'goc' && rec.tierChangedBy === 'Ernest Uzorchukwu' && rec.tierChangedAt === stamp1);
  return call('GET', '/api/me', undefined, stuToken);
}).then(function (r) {
  ok('  her very next request already has GOC access (same token, no re-login)', r.body.tier === 'goc' && r.body.features.webTestObjective === true && r.body.limits.bookmarks === null, r.raw.slice(0, 200));
  ok('  she is never shown who changed it', !/tierChanged/.test(r.raw));
  return sleep(30).then(function () { return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'GOC' }, staffToken); });
}).then(function (r) {
  ok('making a GOC student GOC again is harmless and records nothing new', r.status === 200 && r.body.tier === 'goc' && r.body.tierChangedAt === stamp1, r.raw);

  head('Restrict to Open: what really happens to saved questions');
  return saveMany(stuToken, 1, 25);
}).then(function () {
  return call('GET', '/api/me/bookmarks', undefined, stuToken);
}).then(function (r) {
  ok('as GOC she holds all 25 saved questions', (r.body.bookmarks || r.body.items || []).length === 25, r.raw.slice(0, 120));
  return call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
}).then(function (r) {
  dirToken = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, dirToken);
}).then(function () {
  return sleep(30).then(function () { return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'open' }, dirToken); });
}).then(function (r) {
  ok('the Academic Director can restrict her to Open', r.status === 200 && r.body.tier === 'open', r.raw);
  ok('  and it is her name that is recorded, with a newer time', r.body.tierChangedBy === 'Itsemeh Victorian' && Date.parse(r.body.tierChangedAt) > Date.parse(stamp1), r.raw);
  stamp2 = r.body.tierChangedAt;
  return call('GET', '/api/me', undefined, stuToken);
}).then(function (r) {
  ok('  her next request is Open: Web Test locked, 20 saved questions the limit', r.body.tier === 'open' && r.body.features.webTestObjective === false && r.body.limits.bookmarks === 20);
  return call('POST', '/api/me/tests/start', { section: 'objective', subject: 'Physics' }, stuToken);
}).then(function (r) {
  ok('  starting an Objective Web Test is refused for tier', r.status === 403 && r.body && r.body.reason === 'tier', r.raw);
  return call('GET', '/api/me/bookmarks', undefined, stuToken);
}).then(function (r) {
  ok('  the 25 saved questions are cut to the newest 20, as the confirm warns', (r.body.bookmarks || r.body.items || []).length === 20, r.raw.slice(0, 120));
  return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'goc' }, staffToken);
}).then(function () {
  return call('GET', '/api/me/bookmarks', undefined, stuToken);
}).then(function (r) {
  ok('  moving her back to GOC does not bring the other 5 back', (r.body.bookmarks || r.body.items || []).length === 20);

  head('refusals');
  return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'platinum' }, staffToken);
}).then(function (r) {
  ok('an unknown tier is 400 and changes nothing', r.status === 400 && /Open or GOC/.test((r.body && r.body.error) || ''), r.raw);
  return call('PUT', '/api/students/' + stuId + '/tier', {}, staffToken);
}).then(function (r) {
  ok('no tier named is 400', r.status === 400, r.raw);
  return call('PUT', '/api/students/GOC-S-9999/tier', { tier: 'goc' }, staffToken);
}).then(function (r) {
  ok('an unknown Scholar ID is 404', r.status === 404, r.raw);
  return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'open' });
}).then(function (r) {
  ok('no session is refused', r.status === 401 || r.status === 403, r.status);
  return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'goc' }, stuToken);
}).then(function (r) {
  ok('a student cannot change their own tier', r.status === 403 && readDb().students.filter(function (s) { return s.id === stuId; })[0].tier === 'goc', r.status);
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  return call('PUT', '/api/students/' + stuId + '/tier', { tier: 'open' }, r.body.token);
}).then(function (r) {
  ok('a staff login that has not entered the console passcode is refused', r.status === 401 || r.status === 403, r.status);

  head('the console roster');
  return call('GET', '/api/students', undefined, staffToken);
}).then(function (r) {
  var list = (r.body && (r.body.students || r.body)) || [];
  var a = list.filter(function (s) { return s.id === stuId; })[0];
  ok('the roster row shows tier, who and when', a && a.tier === 'goc' && a.tierChangedBy === 'Ernest Uzorchukwu' && !!a.tierChangedAt, JSON.stringify(a));
  ok('no password hash in the roster', r.raw.indexOf('scrypt$') < 0 && !/pwHash/.test(r.raw));
  return halt();
}).then(function () {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  cleanup();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('\nERROR ' + (e && e.stack || e) + '\n--- server log tail ---\n' + serverLog.slice(-1500));
  cleanup();
  process.exit(1);
});
