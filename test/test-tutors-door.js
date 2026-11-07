/* test-tutors-door.js — the old hidden tutor door has been removed.
   The Scholar ID box no longer knocks, /api/door and its single-use bundle route are gone,
   and no public file carries the door hook. Tutor account authentication and the tutor API
   remain on the server and are checked here so removing the entrance did not remove auth.
   node test/test-tutors-door.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_DOOR_PORT) || 8181;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

function boot(port) {
  var box = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-door-removed-test-'));
  fs.cpSync(path.join(APP, 'server'), path.join(box, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(box, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(box, f)); });
  fs.mkdirSync(path.join(box, 'css'), { recursive: true });
  fs.cpSync(path.join(APP, 'css'), path.join(box, 'css'), { recursive: true });
  try { fs.rmSync(path.join(box, 'server', 'data.json'), { force: true }); } catch (e) {}
  var env = Object.assign({}, process.env, { PORT: String(port), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' });
  var inst = { box: box, port: port, log: '' };
  inst.child = spawn(process.execPath, [path.join(box, 'server', 'server.js')], { cwd: box, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  inst.child.stdout.on('data', function (c) { inst.log += c; }); inst.child.stderr.on('data', function (c) { inst.log += c; });
  inst.stop = function () { try { inst.child.kill(); } catch (e) {} try { fs.rmSync(box, { recursive: true, force: true }); } catch (e) {} };
  return inst;
}
function call(port, method, urlPath, body, headers) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body), h = Object.assign({}, headers || {});
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: urlPath, headers: h }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j, headers: res.headers }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null, headers: {} }); });
    if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(port, n) {
  return call(port, 'GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (n <= 0) throw new Error('server did not start');
    return new Promise(function (x) { setTimeout(x, 100); }).then(function () { return waitForBoot(port, n - 1); });
  });
}

var inst = boot(PORT);
process.on('exit', function () { inst.stop(); });

(async function () {
  await waitForBoot(PORT, 150);

  head('the old hidden door no longer exists');
  var nx = await call(PORT, 'POST', '/api/nothing-here', { word: 'anything' });
  var d1 = await call(PORT, 'POST', '/api/door', { word: 'anything' });
  var d2 = await call(PORT, 'GET', '/api/door/' + 'a'.repeat(48) + '.js');
  ok('POST /api/door is an unknown endpoint', d1.status === 404, d1.status);
  ok('the bundle token route is an unknown endpoint', d2.status === 404, d2.status);
  ok('the answer is identical to an address that is not there', d1.raw === nx.raw, d1.raw + ' vs ' + nx.raw);
  ok('the boot log does not advertise a tutor entrance', !/Tutor entrance/i.test(inst.log), inst.log.slice(-300));

  head('no public file carries the removed mechanism');
  var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  var api = fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8');
  var server = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
  var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  ok('the public login code has no door loader or knock', !/knockDoor|doorLoad|api\/door/i.test(app));
  ok('the public API has no knock method or door route', !/knockDoor|\/door/i.test(api));
  ok('the server has no door route, token mint, or old door environment reads',
    server.indexOf('doorMint') < 0 && server.indexOf('doorSpend') < 0 &&
    server.indexOf('GOC_TUTOR_DOOR') < 0 && server.indexOf('GOC_DOOR_TOKEN_MS') < 0 &&
    server.indexOf('/api/door') < 0 && server.indexOf('api\\/door') < 0);
  ok('the homepage has no science-card gate marker', html.indexOf('data-f27-gate') < 0);
  var pub = ['index.html', 'sw.js', 'css/styles.css', 'js/app.js', 'js/api.js', 'js/goc-core.js', 'js/pwa.js'];
  var all = pub.map(function (f) { return fs.readFileSync(path.join(APP, f), 'utf8'); });
  ok('no public file holds the tutor screens', all.every(function (t) { return t.indexOf('__zxOpen') < 0 && t.indexOf('zx-sheet') < 0; }));
  ok('the service worker and manifest say nothing of the door', !/tutor|zx|door/i.test(fs.readFileSync(path.join(APP, 'sw.js'), 'utf8')) && !/tutor|door/i.test(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8')));

  head('ordinary staff authentication still works');
  var adm = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  ok('staff can still sign in', adm.status === 200 && !!(adm.body && adm.body.token), adm.status);
  var auth = { Authorization: 'Bearer ' + adm.body.token };
  var un = await call(PORT, 'POST', '/api/auth/unlock', { passcode: '2027' }, auth);
  ok('the console passcode is still required and accepted', un.status === 200, un.raw);

  head('tutor accounts and tutor API authentication remain');
  var mk = await call(PORT, 'POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Chemistry', 'Physics'], password: 'start-pass-1' }, auth);
  ok('the console can still make a tutor', mk.status === 200, mk.raw);
  var tl = await call(PORT, 'POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' });
  ok('tutor sign-in still works and asks for a new password', tl.status === 200 && tl.body.user.mustChangePassword === true && tl.body.user.subjects.length === 2, tl.raw);
  var tAuth = { Authorization: 'Bearer ' + tl.body.token };
  ok('the dashboard route is closed until the password is changed', (await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth)).status === 403);
  var pw = await call(PORT, 'POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'a-better-pass' }, tAuth);
  ok('the tutor password change still works', pw.status === 200 && pw.body.mustChangePassword === false, pw.raw);
  var sj = await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth);
  ok('then the subject comes back with the paper depth', sj.status === 200 && sj.body.depth && ['objective', 'theory', 'jamb', 'practice', 'notes'].every(function (k) { return typeof sj.body.depth[k] === 'number'; }), sj.raw);
  ok('another subject is refused', (await call(PORT, 'GET', '/api/tutor/subject?subject=Biology', null, tAuth)).status === 403);
  var lo = await call(PORT, 'POST', '/api/auth/logout', {}, tAuth);
  ok('sign out works with the same token', lo.status === 200 || lo.status === 204, lo.status);
  ok('and the session is over', (await call(PORT, 'GET', '/api/tutor/me', null, tAuth)).status === 401);

  inst.stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('THREW ' + (e && e.stack || e)); inst.stop(); process.exit(1); });
