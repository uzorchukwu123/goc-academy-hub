/* test-tutors-door.js — Phase 3C slice 4: the hidden door, on the real server over HTTP.
   A secret word (GOC_TUTOR_DOOR) earns a single-use token; only the token fetches the tutor
   screens' code; the code is in no public file.
   node test/test-tutors-door.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_DOOR_PORT) || 8181;
var WORD = 'open sesame two';
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

function boot(port, extraEnv) {
  var box = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-door-test-'));
  fs.cpSync(path.join(APP, 'server'), path.join(box, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(box, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(box, f)); });
  fs.mkdirSync(path.join(box, 'css'), { recursive: true });
  fs.cpSync(path.join(APP, 'css'), path.join(box, 'css'), { recursive: true });
  try { fs.rmSync(path.join(box, 'server', 'data.json'), { force: true }); } catch (e) {}
  var env = Object.assign({}, process.env, { PORT: String(port), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' }, extraEnv);
  delete env.GOC_TUTOR_DOOR; Object.assign(env, extraEnv);
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
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

var open = boot(PORT, { GOC_TUTOR_DOOR: WORD, GOC_DOOR_TOKEN_MS: '700' });
var shut = boot(PORT + 1, {});
var short = boot(PORT + 2, { GOC_TUTOR_DOOR: 'abc' });
function stopAll() { open.stop(); shut.stop(); short.stop(); }
process.on('exit', stopAll);

(async function () {
  await Promise.all([waitForBoot(PORT, 150), waitForBoot(PORT + 1, 150), waitForBoot(PORT + 2, 150)]);

  head('with no word set the door does not exist');
  var n1 = await call(PORT + 1, 'POST', '/api/door', { word: WORD });
  var n2 = await call(PORT + 1, 'POST', '/api/door', { word: '' });
  var nx = await call(PORT + 1, 'POST', '/api/nothing-here', { word: WORD });
  ok('any word is refused with 404', n1.status === 404 && n2.status === 404, n1.status);
  ok('the answer is identical to an address that is not there', n1.raw === nx.raw, n1.raw + ' vs ' + nx.raw);
  ok('the bundle route is closed too', (await call(PORT + 1, 'GET', '/api/door/' + 'a'.repeat(48) + '.js')).status === 404);
  ok('the boot log says the entrance is closed and how to open it', /Tutor entrance: closed\. Set GOC_TUTOR_DOOR/.test(shut.log), shut.log.slice(-300));
  var s1 = await call(PORT + 2, 'POST', '/api/door', { word: 'abc' });
  ok('a word shorter than 6 characters never opens it', s1.status === 404 && /CLOSED/.test(short.log), s1.status);

  head('a wrong word looks like nothing');
  var w1 = await call(PORT, 'POST', '/api/door', { word: 'open sesame' });
  ok('wrong word: 404', w1.status === 404, w1.status);
  ok('same body as an unknown address', w1.raw === nx.raw);
  ok('no token, no hint in the reply', !/token|word|tutor/i.test(w1.raw), w1.raw);
  ok('no word at all: 404', (await call(PORT, 'POST', '/api/door', {})).status === 404);
  ok('a word that is not text does not crash it', (await call(PORT, 'POST', '/api/door', { word: { a: 1 } })).status === 404);

  head('the right word gives a single-use token');
  var r1 = await call(PORT, 'POST', '/api/door', { word: WORD });
  ok('the word opens it', r1.status === 200 && r1.body && r1.body.ok === true, r1.raw);
  var tok = r1.body && r1.body.token;
  ok('the token is 48 hex characters', /^[a-f0-9]{48}$/.test(tok || ''), tok);
  ok('case and spacing are forgiven', (await call(PORT, 'POST', '/api/door', { word: '  Open   SESAME two ' })).status === 200);
  ok('the reply is never cached', /no-store/.test(r1.headers['cache-control'] || ''));

  head('the token fetches the tutor screens once');
  var b1 = await call(PORT, 'GET', '/api/door/' + tok + '.js');
  ok('the first fetch returns script', b1.status === 200 && /javascript/.test(b1.headers['content-type'] || ''), b1.status);
  ok('it is the tutor screens', /__zxOpen/.test(b1.raw) && b1.raw.length > 3000, b1.raw.length);
  ok('it is never cached or sniffed', /no-store/.test(b1.headers['cache-control'] || '') && b1.headers['x-content-type-options'] === 'nosniff');
  ok('it carries the no-index header like every response', /noindex/.test(b1.headers['x-robots-tag'] || ''));
  var b2 = await call(PORT, 'GET', '/api/door/' + tok + '.js');
  ok('the same token a second time is refused', b2.status === 404, b2.status);
  ok('a made-up token is refused', (await call(PORT, 'GET', '/api/door/' + 'b'.repeat(48) + '.js')).status === 404);
  ok('a token of the wrong shape is refused', (await call(PORT, 'GET', '/api/door/short.js')).status === 404);
  var r2 = await call(PORT, 'POST', '/api/door', { word: WORD });
  await sleep(900);
  ok('a token left too long is refused', (await call(PORT, 'GET', '/api/door/' + r2.body.token + '.js')).status === 404);
  ok('a late token is gone, not kept for a retry', (await call(PORT, 'GET', '/api/door/' + r2.body.token + '.js')).status === 404);

  head('the tutor code is in no public file');
  var wanted = ['/server/tutor/tutor-app.js', '/SERVER/tutor/tutor-app.js', '/js/tutor-app.js', '/tutor-app.js', '/tutor/tutor-app.js', '/server/server.js'];
  for (var i = 0; i < wanted.length; i++) {
    var g = await call(PORT, 'GET', wanted[i]);
    ok(wanted[i] + ' is not served', g.status === 404 || g.status === 403, g.status);
  }
  var pub = ['index.html', 'sw.js', 'css/styles.css', 'js/app.js', 'js/api.js', 'js/goc-core.js', 'js/pwa.js'];
  var all = pub.map(function (f) { return fs.readFileSync(path.join(APP, f), 'utf8'); });
  ok('no public file holds the tutor screens', all.every(function (t) { return t.indexOf('__zxOpen') < 0 && t.indexOf('zx-sheet') < 0; }));
  ok('no public file names the tutor sign-in or password routes', all.every(function (t) { return !/\/tutor\/(login|password|subject)/.test(t); }));
  ok('no public file holds the word or a default one', all.every(function (t) { return t.indexOf(WORD) < 0 && !/GOC_TUTOR_DOOR/.test(t); }));
  var sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  ok('the service worker lists nothing of it', !/tutor|zx|door/i.test(sw));
  ok('the manifest says nothing of it', !/tutor|door/i.test(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8')));
  ok('the code sits where the static server cannot reach', fs.existsSync(path.join(APP, 'server', 'tutor', 'tutor-app.js')));
  ok('the boot log says the entrance is open', /Tutor entrance: open/.test(open.log), open.log.slice(-300));
  ok('the boot log never prints the word', open.log.indexOf(WORD) < 0);

  head('knocking does not touch student or staff sign-in');
  var adm = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  ok('staff can still sign in after several knocks', adm.status === 200 && !!(adm.body && adm.body.token), adm.status);

  head('the screens speak the real server\'s language');
  var auth = { Authorization: 'Bearer ' + adm.body.token };
  await call(PORT, 'POST', '/api/auth/unlock', { passcode: '2027' }, auth);
  var mk = await call(PORT, 'POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Chemistry', 'Physics'], password: 'start-pass-1' }, auth);
  ok('the console made a tutor', mk.status === 200, mk.raw);
  var tl = await call(PORT, 'POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' });
  ok('sign-in with the bundle\'s fields works and asks for a new password', tl.status === 200 && tl.body.user.mustChangePassword === true && tl.body.user.subjects.length === 2, tl.raw);
  var tAuth = { Authorization: 'Bearer ' + tl.body.token };
  ok('the dashboard route is closed until the password is changed', (await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth)).status === 403);
  var pw = await call(PORT, 'POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'a-better-pass' }, tAuth);
  ok('the bundle\'s password fields are the ones the server reads', pw.status === 200 && pw.body.mustChangePassword === false, pw.raw);
  var sj = await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth);
  ok('then the subject comes back with the paper depth the screen draws', sj.status === 200 && sj.body.depth && ['objective', 'theory', 'jamb', 'practice', 'notes'].every(function (k) { return typeof sj.body.depth[k] === 'number'; }), sj.raw);
  ok('another subject is refused with a message the screen can show', (await call(PORT, 'GET', '/api/tutor/subject?subject=Biology', null, tAuth)).status === 403);
  var lo = await call(PORT, 'POST', '/api/auth/logout', {}, tAuth);
  ok('sign out works with the same token', lo.status === 200 || lo.status === 204, lo.status);
  ok('and the session is over', (await call(PORT, 'GET', '/api/tutor/me', null, tAuth)).status === 401);

  head('guessing is limited');
  var last = 0;
  for (var k = 0; k < 8; k++) last = (await call(PORT, 'POST', '/api/door', { word: 'guess number ' + k })).status;
  ok('after six misses the address is told to wait (429)', last === 429, last);
  var after = await call(PORT, 'POST', '/api/door', { word: WORD });
  ok('even the right word waits while locked', after.status === 429, after.status);
  ok('a locked address still cannot fetch a bundle', (await call(PORT, 'GET', '/api/door/' + 'c'.repeat(48) + '.js')).status === 429);
  ok('the lock does not stop the ordinary app', (await call(PORT, 'GET', '/api/health')).status === 200);

  stopAll();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('THREW ' + (e && e.stack || e)); stopAll(); process.exit(1); });
