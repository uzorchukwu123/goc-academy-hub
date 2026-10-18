/* test-managers-route.js - Roles slice (c), step 2a: the server lists and creates managers.
   A manager is a staff record (GOC-A-003 up); secrets are hashed and never sent back.
   node test/test-managers-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_MR_PORT) || 8203;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-mgr-test-'));
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
  var ftok = f.body && f.body.token;
  head('nobody gets in without the console unlocked');
  var locked = await call('GET', '/api/managers', undefined, ftok);
  ok('a signed-in Founder who has not entered the passcode is refused', locked.status === 403, locked.status);
  ok('no token at all is refused', (await call('GET', '/api/managers')).status === 401);
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);

  head('the list starts empty and offers the four roles');
  var l0 = await call('GET', '/api/managers', undefined, ftok);
  ok('no managers yet', l0.status === 200 && Array.isArray(l0.body.managers) && l0.body.managers.length === 0, l0.raw);
  ok('the four non-Founder roles are offered', l0.body.roles.map(function (r) { return r.key; }).join(',') === 'academic-director,finance,publicity,student-affairs', l0.raw);

  head('the Founder creates managers');
  var good = { name: 'Ada Obi', role: 'finance', password: 'starter123', passcode: '4821' };
  var c1 = await call('POST', '/api/managers', good, ftok);
  ok('the first manager is GOC-A-003', c1.status === 200 && c1.body.manager.id === 'GOC-A-003', c1.raw);
  ok('with the role key, its full title and must-change set', c1.body.manager.role === 'finance' && c1.body.manager.title === 'Finance & Administration Manager' && c1.body.manager.mustChangePassword === true && c1.body.manager.active === true, c1.raw);
  ok('the reply carries no password, passcode or hash', !/starter123|4821|pwHash|passcodeHash|scrypt/.test(c1.raw), c1.raw);
  var c2 = await call('POST', '/api/managers', { name: 'Chidi Eze', role: 'Publicity & Communications Manager', password: 'another456', passcode: '90210' }, ftok);
  ok('the second is GOC-A-004, the role given by its full title', c2.status === 200 && c2.body.manager.id === 'GOC-A-004' && c2.body.manager.role === 'publicity', c2.raw);
  var l1 = await call('GET', '/api/managers', undefined, ftok);
  ok('the list now shows both, in the order issued', l1.body.managers.map(function (m) { return m.id; }).join(',') === 'GOC-A-003,GOC-A-004', l1.raw);
  ok('the list carries no secrets either', !/starter123|another456|4821|90210|pwHash|passcodeHash|scrypt/.test(l1.raw), l1.raw);

  head('what is refused');
  ok('the Founder role cannot be issued', (await call('POST', '/api/managers', Object.assign({}, good, { role: 'founder' }), ftok)).status === 400);
  ok('a short password is refused', (await call('POST', '/api/managers', Object.assign({}, good, { password: 'ab1' }), ftok)).status === 400);
  var noDigit = await call('POST', '/api/managers', Object.assign({}, good, { password: 'lettersonly' }), ftok);
  ok('a password with no number is refused, with the same wording as management passwords', noDigit.status === 400 && /letters and numbers/.test(noDigit.raw), noDigit.raw);
  ok('a bad passcode is refused', (await call('POST', '/api/managers', Object.assign({}, good, { passcode: '12' }), ftok)).status === 400);
  ok('a missing name is refused', (await call('POST', '/api/managers', Object.assign({}, good, { name: '' }), ftok)).status === 400);
  var l2 = await call('GET', '/api/managers', undefined, ftok);
  ok('none of the refused ones were stored', l2.body.managers.length === 2, l2.raw);

  head('the stored record keeps only hashes');
  var stored = fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8');
  ok('data.json holds no plain password or passcode', !/starter123|another456/.test(stored) && !/"passcode"\s*:\s*"(4821|90210)"/.test(stored));
  ok('it holds hashes, the must-change flag and the ID high-water mark', /scrypt\$/.test(stored) && /"mustChangePassword": true/.test(stored) && /"managerIdHigh": "GOC-A-004"/.test(stored));

  head('the Academic Director keeps full access');
  var a = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, a.body.token);
  var al = await call('GET', '/api/managers', undefined, a.body.token);
  ok('the seeded Academic Director account can still open the panel', al.status === 200 && al.body.managers.length === 2, al.status);

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
