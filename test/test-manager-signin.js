/* test-manager-signin.js - Roles slice (c), step 3a: a manager signs in with the password the Founder typed,
   opens the console with their OWN passcode, and is held to their role by the guard.
   node test/test-manager-signin.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_MS_PORT) || 8204;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-msi-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' }), stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', function (c) { serverLog += c; }); child.stderr.on('data', function (c) { serverLog += c; });
function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body), headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j, headers: res.headers }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null, headers: {} }); });
    if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(n) {
  return call('GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (n <= 0) throw new Error('server did not start\n' + serverLog);
    return new Promise(function (x) { setTimeout(x, 100); }).then(function () { return waitForBoot(n - 1); });
  });
}


(async function () {
  await waitForBoot(100);
  var f = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var ftok = f.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);
  var made = await call('POST', '/api/managers', { name: 'Ada Obi', role: 'finance', password: 'starter123', passcode: '4821' }, ftok);
  ok('set-up: a Finance manager is issued as GOC-A-003', made.status === 200 && made.body.manager.id === 'GOC-A-003', made.raw);

  head('signing in');
  var bad = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'wrong-pass1' });
  ok('a wrong password is refused', bad.status === 401, bad.status);
  var noSuch = await call('POST', '/api/auth/login', { id: 'GOC-A-099', password: 'starter123' });
  ok('an ID that does not exist gets the same refusal and message', noSuch.status === 401 && noSuch.body.error === bad.body.error, noSuch.raw);
  var shared = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'founder2027' });
  ok('the Founder password does not open a manager account', shared.status === 401);
  var m = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' });
  ok('the right password signs the manager in', m.status === 200 && !!m.body.token, m.raw);
  ok('as the finance role, told to change the starting password', m.body.user.roleKey === 'finance' && m.body.user.role === 'admin' && m.body.user.mustChangePassword === true, m.raw);
  ok('the reply carries no hash or passcode', !/pwHash|passcodeHash|scrypt|4821/.test(m.raw), m.raw);
  var ses = await call('GET', '/api/auth/session', undefined, m.body.token);
  ok('the session route reports the role key', ses.status === 200 && ses.body.roleKey === 'finance', ses.raw);
  ok('the Founder still signs in as before, with no change forced', f.body.user.mustChangePassword === false && f.body.user.roleKey === 'founder');

  head('the console opens with the manager\'s own passcode only');
  var wrongPc = await call('POST', '/api/auth/unlock', { passcode: '2027' }, m.body.token);
  ok('the shared passcode does not open it for a manager', wrongPc.status === 403, wrongPc.raw);
  var ownPc = await call('POST', '/api/auth/unlock', { passcode: '4821' }, m.body.token);
  ok('their own passcode does', ownPc.status === 200 && ownPc.body.unlocked === true, ownPc.raw);
  var fOwn = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var fWrong = await call('POST', '/api/auth/unlock', { passcode: '4821' }, fOwn.body.token);
  ok('a manager\'s passcode does not open the console for the Founder', fWrong.status === 403, fWrong.raw);

  head('until the starting password is changed, nothing in the console works');
  var held = await call('GET', '/api/students', undefined, m.body.token);
  ok('even a route the role may use is refused, with a clear message', held.status === 403 && /Change your starting password/.test(held.raw), held.raw);

  head('after the change (simulated here by editing the stored record), the role limits apply');
  var dataPath = path.join(SANDBOX, 'server', 'data.json');
  var db = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  db.staff.forEach(function (x) { if (x.id === 'GOC-A-003') x.mustChangePassword = false; });
  fs.writeFileSync(dataPath, JSON.stringify(db, null, 2));
  var m2 = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' });
  ok('signs in with nothing forced', m2.status === 200 && m2.body.user.mustChangePassword === false, m2.raw);
  await call('POST', '/api/auth/unlock', { passcode: '4821' }, m2.body.token);
  var t2 = m2.body.token;
  ok('the roster is open to every manager role', (await call('GET', '/api/students', undefined, t2)).status === 200);
  var add = await call('POST', '/api/admin/students', {}, t2);
  ok('Finance may add students (refused for bad input, not for role)', add.status !== 403 || !/Your role does not include/.test(add.raw), add.status + ' ' + add.raw);
  ok('Finance cannot see results', /Your role does not include/.test((await call('GET', '/api/results', undefined, t2)).raw));
  ok('Finance cannot open notices', (await call('GET', '/api/notices', undefined, t2)).status === 403);
  ok('Finance cannot change sign-up limits (Student Affairs only)', (await call('PUT', '/api/settings/signup-limits', { perHour: 8, perDay: 9 }, t2)).status === 403);
  ok('Finance cannot open the Managers panel', (await call('GET', '/api/managers', undefined, t2)).status === 403);
  ok('Finance cannot read the tutor audit log', (await call('GET', '/api/audit/tutor-views', undefined, t2)).status === 403);
  ok('Finance cannot open the question bank', (await call('GET', '/api/questions', undefined, t2)).status === 403);

  head('switching a manager off');
  db = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  db.staff.forEach(function (x) { if (x.id === 'GOC-A-003') x.active = false; });
  fs.writeFileSync(dataPath, JSON.stringify(db, null, 2));
  var off = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' });
  ok('a switched-off manager cannot sign in, and is told nothing special', off.status === 401 && off.body.error === bad.body.error, off.raw);

  head('the seeded accounts are untouched');
  var a = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, a.body.token);
  ok('the Academic Director signs in and unlocks with the shared passcode, with full access', a.status === 200 && a.body.user.roleKey === 'academic-director' && (await call('GET', '/api/managers', undefined, a.body.token)).status === 200);

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
