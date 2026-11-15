/* test-tiers-route.js — Phase 3B, access tiers slice 2 (part 1): the tier is
   stored on the student, set at sign-up / enrolment, migrated once for
   existing students, and reported by GET /api/me.
   Boots a throwaway server (twice, to prove the migration).
   node test/test-tiers-route.js  */
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
var PORT = Number(process.env.GOC_TIER_PORT) || 8154;

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

var openToken, gocId, gocTemp, staffToken;

start().then(function () {
  head('a self-registered student is Open');
  return activeStudent.signedUp(call, signupBody('Ada Open', '08000000011'));
}).then(function (r) {
  openToken = r.body.token;
  ok('sign-up works', r.status === 200 || r.status === 201, r.raw);
  return call('GET', '/api/me', undefined, openToken);
}).then(function (r) {
  ok('GET /api/me reports tier open', r.status === 200 && r.body.tier === 'open', r.raw);
  ok('  with the Open feature set (JAMB mock yes; no Objective or Theory Web Test, no videos)',
     r.body.features && r.body.features.jambMock === true && r.body.features.webTestObjective === false && r.body.features.webTestTheory === false && r.body.features.videos === false && r.body.features.practice === true);
  ok('  with the Open limits (practice unlimited, 20 bookmarks, 10 reviews a day)',
     r.body.limits && r.body.limits.practicePerDay === null && r.body.limits.practiceRunMax === null && r.body.limits.bookmarks === 20 && r.body.limits.reviewsPerDay === 10);
  ok('  the stored record says open', readDb().students[0].tier === 'open');
  var b = signupBody('Mallory Try', '08000000012'); b.tier = 'goc';
  return activeStudent.signedUp(call, b);
}).then(function (r) {
  return call('GET', '/api/me', undefined, r.body.token);
}).then(function (r) {
  ok('  a sign-up that sends tier:"goc" is still Open', r.body.tier === 'open', r.raw);
  ok('  and the stored record is open', readDb().students[1].tier === 'open');

  head('a student the console adds is GOC');
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  staffToken = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staffToken);
}).then(function () {
  return call('POST', '/api/admin/students', { name: 'Chidi Added', email: 'chidi@example.com', phone: '08000000013',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, staffToken);
}).then(function (r) {
  ok('the console can enrol a student', r.status === 200 && r.body.student, r.raw);
  gocId = r.body.student.id; gocTemp = r.body.temporaryPassword;
  ok('  the console view of the new student says goc', r.body.student.tier === 'goc', r.raw);
  return call('POST', '/api/auth/login', { id: gocId, password: gocTemp });
}).then(function (r) {
  return call('GET', '/api/me', undefined, r.body.token);
}).then(function (r) {
  ok('GET /api/me for the added student reports goc', r.status === 200 && r.body.tier === 'goc', r.raw);
  ok('  with the GOC feature set (JAMB mock, Web Test, videos)',
     r.body.features.jambMock === true && r.body.features.webTestObjective === true && r.body.features.videos === true);
  ok('  and no daily practice limit', r.body.limits.practicePerDay === null && r.body.limits.bookmarks === null && r.body.limits.practiceHistory === null);
  return call('GET', '/api/students', undefined, staffToken);
}).then(function (r) {
  var list = (r.body && (r.body.students || r.body)) || [];
  var a = list.filter(function (s) { return s.name === 'Ada Open'; })[0];
  var c = list.filter(function (s) { return s.name === 'Chidi Added'; })[0];
  ok('the console roster shows each student\'s tier', !!a && !!c && a.tier === 'open' && c.tier === 'goc', r.raw.slice(0, 200));
  ok('no password hash in the roster', r.raw.indexOf('scrypt$') < 0 && !/pwHash/.test(r.raw));

  head('the console chooses the tier of a student it adds');
  return call('POST', '/api/admin/students', { name: 'Ope Chosen', email: 'ope@example.com', phone: '08000000021',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'], tier: 'open' }, staffToken);
}).then(function (r) {
  ok('adding with tier open stores an Open student', r.status === 200 && r.body.student && r.body.student.tier === 'open', r.raw);
  return call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword });
}).then(function (r) {
  return call('GET', '/api/me', undefined, r.body.token);
}).then(function (r) {
  ok('  and the new account reads as Open, with Web Tests locked', r.body.tier === 'open' && r.body.features.webTestObjective === false, r.raw.slice(0, 160));
  return call('POST', '/api/admin/students', { name: 'Gina Explicit', email: 'gina@example.com', phone: '08000000022',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'], tier: ' GOC ' }, staffToken);
}).then(function (r) {
  ok('adding with tier goc (any capitalisation) stores GOC', r.status === 200 && r.body.student.tier === 'goc', r.raw);
  return call('POST', '/api/admin/students', { name: 'Bad Tier', email: 'bad@example.com', phone: '08000000023',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'], tier: 'platinum' }, staffToken);
}).then(function (r) {
  ok('an unknown tier is refused with 400 and nothing is created', r.status === 400 && /Open or GOC/.test((r.body && r.body.error) || ''), r.raw);
  return call('GET', '/api/students', undefined, staffToken);
}).then(function (r) {
  var list = (r.body && (r.body.students || r.body)) || [];
  ok('  no "Bad Tier" student exists', !list.some(function (s) { return s.name === 'Bad Tier'; }));
  return call('POST', '/api/admin/students', { name: 'No Tier Sent', email: 'nts@example.com', phone: '08000000024',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, undefined);
}).then(function (r) {
  ok('adding without a console session is still refused', r.status === 401 || r.status === 403, r.status);

  head('the one-time migration: students already on file become GOC');
  return halt();
}).then(function () {
  var db = readDb();
  // Emulate a data file from before tiers: one old student with no tier,
  // and no migration marker. The Open students already carry an explicit tier.
  var legacy = JSON.parse(JSON.stringify(db.students[0]));
  legacy.id = 'GOC-S-900'; legacy.name = 'Old Timer'; legacy.email = 'old@example.com'; legacy.phone = '08000000099';
  delete legacy.tier;
  db.students.push(legacy);
  var odd1 = JSON.parse(JSON.stringify(db.students[0])); odd1.id = 'GOC-S-901'; odd1.name = 'Odd One'; odd1.email = 'o1@example.com'; odd1.phone = '08000000098'; odd1.tier = ' GOC ';
  var odd2 = JSON.parse(JSON.stringify(db.students[0])); odd2.id = 'GOC-S-902'; odd2.name = 'Odd Two'; odd2.email = 'o2@example.com'; odd2.phone = '08000000097'; odd2.tier = 'platinum';
  db.students.push(odd1, odd2);
  ok('the file has a migration marker after the first boot', !!db.settings.tierMigrated);
  delete db.settings.tierMigrated;
  writeDb(db);
  return start();
}).then(function () {
  var db = readDb();
  var by = function (id) { return db.students.filter(function (s) { return s.id === id; })[0]; };
  ok('the student with no tier on file is now GOC', by('GOC-S-900').tier === 'goc');
  ok('a student already stored as open is NOT promoted', db.students[0].tier === 'open' && db.students[1].tier === 'open');
  ok('a stored " GOC " is tidied to goc', by('GOC-S-901').tier === 'goc');
  ok('a stored unknown tier ("platinum") reads as open', by('GOC-S-902').tier === 'open');
  ok('the marker is set again', !!db.settings.tierMigrated);
  return activeStudent.signedUp(call, signupBody('Late Joiner', '08000000014'));
}).then(function (r) {
  ok('a later sign-up is Open', r.status === 200 || r.status === 201, r.raw);
  return halt();
}).then(function () {
  var db = readDb();
  var late = db.students.filter(function (s) { return s.name === 'Late Joiner'; })[0];
  ok('the later sign-up is stored as open', late && late.tier === 'open');
  return start();
}).then(function () {
  var db = readDb();
  var late = db.students.filter(function (s) { return s.name === 'Late Joiner'; })[0];
  ok('another restart does NOT promote them (the marker stops the migration)', late.tier === 'open');
  return call('POST', '/api/auth/login', { id: 'GOC-S-902', password: 'secret123' });
}).then(function (r) {
  return call('GET', '/api/me', undefined, r.body && r.body.token);
}).then(function (r) {
  ok('GET /api/me for an unknown stored tier says open', r.status === 200 && r.body.tier === 'open', r.raw);
}).then(function () {
  head('a fresh install with no students is marked migrated, so its first students stay Open');
  return halt();
}).then(function () {
  try { fs.rmSync(DATA, { force: true }); } catch (e) {}
  return start();
}).then(function () {
  ok('a brand-new data file carries the marker at once', !!readDb().settings.tierMigrated);
  return activeStudent.signedUp(call, signupBody('First Ever', '08000000015'));
}).then(function (r) {
  return halt().then(function () { return r; });
}).then(function () {
  var s = readDb().students[0];
  ok('the first student on a fresh install is Open, not GOC', s && s.tier === 'open', s && s.tier);
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (slice 2, part 1): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
