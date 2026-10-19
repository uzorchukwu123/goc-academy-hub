/* test-manager-signin.js - Roles slice (c), step 4: the Founder switches a manager off/on and resets their password.
   node test/test-manager-admin.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_MA_PORT) || 8206;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-mad-test-'));
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
  await call('POST', '/api/managers', { name: 'Ada Obi', role: 'finance', password: 'starter123', passcode: '4821' }, ftok);
  var m = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' });
  await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'mine-pass77' }, m.body.token);
  await call('POST', '/api/auth/unlock', { passcode: '4821' }, m.body.token);
  ok('set-up: the manager is working in the console', (await call('GET', '/api/students', undefined, m.body.token)).status === 200);

  head('who may use these routes');
  ok('a manager cannot switch another off', (await call('PUT', '/api/managers/GOC-A-003/active', { active: false }, m.body.token)).status === 403);
  ok('a manager cannot reset a password', (await call('PUT', '/api/managers/GOC-A-003/password', { password: 'hacked-pass1' }, m.body.token)).status === 403);
  ok('no session is refused', (await call('PUT', '/api/managers/GOC-A-003/active', { active: false })).status === 401);

  head('the seeded accounts and unknown IDs are out of reach');
  ok('GOC-A-001 and GOC-A-002 give 404', (await call('PUT', '/api/managers/GOC-A-001/active', { active: false }, ftok)).status === 404 && (await call('PUT', '/api/managers/GOC-A-002/password', { password: 'newpass123' }, ftok)).status === 404);
  ok('an ID that was never issued gives 404', (await call('PUT', '/api/managers/GOC-A-099/active', { active: false }, ftok)).status === 404);
  ok('active must be true or false', (await call('PUT', '/api/managers/GOC-A-003/active', { active: 'no' }, ftok)).status === 400);

  head('switching off');
  var off = await call('PUT', '/api/managers/GOC-A-003/active', { active: false }, ftok);
  ok('succeeds and the list says so', off.status === 200 && off.body.manager.active === false, off.raw);
  ok('their open session ends at once', (await call('GET', '/api/students', undefined, m.body.token)).status === 401);
  ok('they cannot sign in', (await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'mine-pass77' })).status === 401);
  var on = await call('PUT', '/api/managers/GOC-A-003/active', { active: true }, ftok);
  ok('switching back on works', on.status === 200 && on.body.manager.active === true);
  ok('and they can sign in again', (await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'mine-pass77' })).status === 200);

  head('resetting the password');
  ok('a short or weak one is refused', (await call('PUT', '/api/managers/GOC-A-003/password', { password: 'abc1' }, ftok)).status === 400 && (await call('PUT', '/api/managers/GOC-A-003/password', { password: 'lettersonly' }, ftok)).status === 400);
  ok('a bad passcode is refused, nothing changed', (await call('PUT', '/api/managers/GOC-A-003/password', { password: 'reset-pass5', passcode: '12' }, ftok)).status === 400 && (await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'mine-pass77' })).status === 200);
  var live = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'mine-pass77' });
  var rs = await call('PUT', '/api/managers/GOC-A-003/password', { password: 'reset-pass5' }, ftok);
  ok('a good reset succeeds with no secret in the reply', rs.status === 200 && rs.body.reset === true && rs.body.passcodeChanged === false && rs.body.manager.mustChangePassword === true && !/reset-pass5|pwHash|scrypt/.test(rs.raw), rs.raw);
  ok('their open session ended', (await call('GET', '/api/auth/session', undefined, live.body.token)).status === 401);
  ok('the old password is dead', (await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'mine-pass77' })).status === 401);
  var n = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'reset-pass5' });
  ok('the new one signs in, forced to change again', n.status === 200 && n.body.user.mustChangePassword === true, n.raw);
  ok('the old passcode still works when none is given', (await call('POST', '/api/auth/unlock', { passcode: '4821' }, n.body.token)).status === 200);
  var rs2 = await call('PUT', '/api/managers/GOC-A-003/password', { password: 'reset-pass6', passcode: '70707' }, ftok);
  ok('a new passcode can be set in the same reset', rs2.status === 200 && rs2.body.passcodeChanged === true, rs2.raw);
  var n2 = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'reset-pass6' });
  ok('the old passcode no longer opens it, the new one does', (await call('POST', '/api/auth/unlock', { passcode: '4821' }, n2.body.token)).status === 403 && (await call('POST', '/api/auth/unlock', { passcode: '70707' }, n2.body.token)).status === 200);
  var stored = fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8');
  ok('data.json holds only hashes', !/reset-pass|70707|mine-pass77/.test(stored));

  head('deleting a manager');
  await call('POST', '/api/managers', { name: 'Chidi Eze', role: 'publicity', password: 'second-pass2', passcode: '9021' }, ftok);
  var c = await call('POST', '/api/auth/login', { id: 'GOC-A-004', password: 'second-pass2' });
  var mt = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'reset-pass6' });
  await call('PUT', '/api/managers/GOC-A-003/active', { active: true }, ftok);
  ok('a manager cannot delete a manager', (await call('DELETE', '/api/managers/GOC-A-004', undefined, mt.body.token)).status === 403);
  ok('the seeded accounts and unknown IDs give 404', (await call('DELETE', '/api/managers/GOC-A-001', undefined, ftok)).status === 404 && (await call('DELETE', '/api/managers/GOC-A-002', undefined, ftok)).status === 404 && (await call('DELETE', '/api/managers/GOC-A-099', undefined, ftok)).status === 404);
  var del = await call('DELETE', '/api/managers/GOC-A-004', undefined, ftok);
  ok('the Founder deletes GOC-A-004', del.status === 200 && del.body.deleted === true, del.raw);
  var lst = await call('GET', '/api/managers', undefined, ftok);
  ok('they are gone from the list, the other remains', lst.body.managers.map(function (x) { return x.id; }).join(',') === 'GOC-A-003', lst.raw);
  ok('their session ended and they cannot sign in', (await call('GET', '/api/auth/session', undefined, c.body.token)).status === 401 && (await call('POST', '/api/auth/login', { id: 'GOC-A-004', password: 'second-pass2' })).status === 401);
  ok('deleting twice gives 404', (await call('DELETE', '/api/managers/GOC-A-004', undefined, ftok)).status === 404);
  var nx = await call('POST', '/api/managers', { name: 'Ngozi Ade', role: 'student-affairs', password: 'third-pass3', passcode: '5566' }, ftok);
  ok('the deleted ID is never issued again: the next manager is GOC-A-005', nx.status === 200 && nx.body.manager.id === 'GOC-A-005', nx.raw);

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
