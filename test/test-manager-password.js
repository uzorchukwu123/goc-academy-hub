/* test-manager-signin.js - Roles slice (c), step 3b: a manager replaces the starting password the Founder typed.
   node test/test-manager-password.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_MP_PORT) || 8205;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-mpw-test-'));
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
  head('the pure rule');
  var e = core.managerPasswordChangeError;
  ok('a good new password passes', e('starter123', 'fresh-pass9') === null);
  ok('too short, too long, letters only, digits only and unchanged are each refused',
    !!e('starter123', 'ab1') && !!e('starter123', new Array(202).join('a') + '1') && !!e('starter123', 'lettersonly') && !!e('starter123', '1234567890') && !!e('starter123', 'starter123'));
  ok('missing input is refused, not crashed on', !!e(null, null) && !!e(undefined, undefined));

  var f = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var ftok = f.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);
  var made = await call('POST', '/api/managers', { name: 'Ada Obi', role: 'finance', password: 'starter123', passcode: '4821' }, ftok);
  ok('set-up: a Finance manager is issued as GOC-A-003', made.status === 200 && made.body.manager.id === 'GOC-A-003', made.raw);

  var m = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' });
  var other = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' });
  var t = m.body.token;
  ok('signs in told to change the password', m.body.user.mustChangePassword === true);

  head('who may use it');
  ok('no session is refused', (await call('POST', '/api/auth/password', { currentPassword: 'a', newPassword: 'b' })).status === 401);
  var fr = await call('POST', '/api/auth/password', { currentPassword: 'founder2027', newPassword: 'newfounder77' }, ftok);
  ok('the Founder account is pointed to the console instead', fr.status === 403 && /Founder in the console/.test(fr.raw), fr.raw);
  var ad = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  ok('so is the Academic Director account', (await call('POST', '/api/auth/password', { currentPassword: 'acaddir2027', newPassword: 'newacad7788' }, ad.body.token)).status === 403);

  head('what is refused, with nothing changed');
  var w = await call('POST', '/api/auth/password', { currentPassword: 'not-it-1', newPassword: 'fresh-pass9' }, t);
  ok('a wrong current password', w.status === 400 && /current password is not right/.test(w.raw), w.raw);
  ok('a weak new password', (await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'lettersonly' }, t)).status === 400);
  ok('the same password again', (await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'starter123' }, t)).status === 400);
  ok('the old password still signs in, still forced to change', (await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' })).body.user.mustChangePassword === true);
  await call('POST', '/api/auth/unlock', { passcode: '4821' }, t);
  ok('console routes stay closed until it is changed', (await call('GET', '/api/students', undefined, t)).status === 403);

  head('the change');
  var ch = await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'fresh-pass9' }, t);
  ok('succeeds', ch.status === 200 && ch.body.mustChangePassword === false, ch.raw);
  ok('the same session now reaches the console, with no new sign-in', (await call('GET', '/api/students', undefined, t)).status === 200);
  ok('the role limits still apply (Finance cannot read results)', (await call('GET', '/api/results', undefined, t)).status === 403);
  ok('the manager\'s other open session was ended', (await call('GET', '/api/auth/session', undefined, other.body.token)).status === 401);
  ok('the old password no longer signs in', (await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'starter123' })).status === 401);
  var again = await call('POST', '/api/auth/login', { id: 'GOC-A-003', password: 'fresh-pass9' });
  ok('the new one does, with nothing forced', again.status === 200 && again.body.user.mustChangePassword === false, again.raw);
  var pc = await call('POST', '/api/auth/unlock', { passcode: '4821' }, again.body.token);
  ok('the Founder-set passcode is unchanged', pc.status === 200, pc.raw);
  var stored = fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8');
  ok('data.json holds only hashes, and the must-change flag is off', !/starter123|fresh-pass9/.test(stored) && !/"mustChangePassword": true/.test(stored));
  var lst = await call('GET', '/api/managers', undefined, ftok);
  ok('the Founder\'s Managers list shows the change was made', lst.body.managers[0].mustChangePassword === false, lst.raw);

  head('a switched-off manager');
  var db = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8'));
  db.staff.forEach(function (x) { if (x.id === 'GOC-A-003') x.active = false; });
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db, null, 2));
  var off = await call('POST', '/api/auth/password', { currentPassword: 'fresh-pass9', newPassword: 'another-pass8' }, again.body.token);
  ok('cannot change anything, and the session is ended', off.status === 403 && (await call('GET', '/api/auth/session', undefined, again.body.token)).status === 401, off.raw);

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
