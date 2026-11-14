/* test-tutor-access.js — Stage 8: the approved tutor entrance + tutor tour.

   The route, as approved: GET /tutor serves a sign-in shell holding none
   of the tutor application; the shell signs in through the existing
   POST /api/tutor/login; only then does GET /api/tutor/app (need:
   'tutor-setup', private + no-store) deliver server/tutor/tutor-app.js.
   Proves the shell is code-free, unauthenticated and wrong-role delivery
   is refused, a switched-off tutor is refused mid-session, the
   password-change gate is unchanged, static serving still refuses the
   file, and the tutor tour maps onto real tutor views through the
   app's own navigation bridge.
   Run:  node test/test-tutor-access.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TUTOR_ACCESS_PORT) || 8183;
var mod = require(path.join(APP, 'js', 'onboarding.js'));
var tutorSrc = fs.readFileSync(path.join(APP, 'server', 'tutor', 'tutor-app.js'), 'utf8');
var serverSrc = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

function boot(port) {
  var box = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tutor-access-'));
  fs.cpSync(path.join(APP, 'server'), path.join(box, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(box, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(box, f)); });
  fs.mkdirSync(path.join(box, 'css'), { recursive: true });
  fs.cpSync(path.join(APP, 'css'), path.join(box, 'css'), { recursive: true });
  try { fs.rmSync(path.join(box, 'server', 'data.json'), { force: true }); } catch (e) {}
  var env = Object.assign({}, process.env, { PORT: String(port), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' });
  var inst = { box: box, log: '' };
  inst.child = spawn(process.execPath, [path.join(box, 'server', 'server.js')], { cwd: box, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
  inst.child.stdout.on('data', function (c) { inst.log += c; });
  inst.child.stderr.on('data', function (c) { inst.log += c; });
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

  head('the shell holds no tutor application');
  var shell = await call(PORT, 'GET', '/tutor');
  ok('GET /tutor serves the sign-in shell', shell.status === 200 && /id="tutorGate"/.test(shell.raw), shell.status);
  ok('the shell contains none of the tutor screens', shell.raw.indexOf('__zxOpen') < 0 && shell.raw.indexOf('zx-sheet') < 0 && shell.raw.indexOf('__zxTourGo') < 0);
  ok('the shell is never cached', /no-store/.test(shell.headers['cache-control'] || ''), shell.headers['cache-control']);
  ok('the shell signs in first, then fetches the app with the token',
    /api\/tutor\/login/.test(shell.raw) && /api\/tutor\/app/.test(shell.raw) && /Authorization.*Bearer/.test(shell.raw) && shell.raw.indexOf('api/tutor/login') < shell.raw.indexOf('api/tutor/app'));
  ok('the shell passes the session to the app in memory only', /window\.__zxSession = \{ token: j\.token, user: j\.user \}/.test(shell.raw) && !/localStorage|document\.cookie/.test(shell.raw));
  ok('the old hidden door is still gone', (await call(PORT, 'POST', '/api/door', { word: 'x' })).status === 404);
  ok('static serving still refuses the tutor file', (await call(PORT, 'GET', '/server/tutor/tutor-app.js')).status === 404);

  head('delivery is authenticated, tutor-only, uncached');
  ok('no token, no app', (await call(PORT, 'GET', '/api/tutor/app')).status === 401);
  var adm = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var admAuth = { Authorization: 'Bearer ' + adm.body.token };
  await call(PORT, 'POST', '/api/auth/unlock', { passcode: '2027' }, admAuth);
  ok('a management token cannot take the tutor app', (await call(PORT, 'GET', '/api/tutor/app', null, admAuth)).status === 403);
  var mk = await call(PORT, 'POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Chemistry'], password: 'start-pass-1' }, admAuth);
  ok('the console still creates the tutor', mk.status === 200, mk.raw);
  var tl = await call(PORT, 'POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' });
  var tAuth = { Authorization: 'Bearer ' + tl.body.token };
  var appRes = await call(PORT, 'GET', '/api/tutor/app', null, tAuth);
  ok('a tutor in password-change state can load the app', appRes.status === 200, appRes.status);
  ok('the delivered bytes are the tutor application', appRes.raw === tutorSrc);
  ok('delivery is private and never stored', /private/.test(appRes.headers['cache-control'] || '') && /no-store/.test(appRes.headers['cache-control'] || ''), appRes.headers['cache-control']);
  ok('subject APIs stay closed until the password is changed', (await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth)).status === 403);
  var pw = await call(PORT, 'POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'a-better-pass' }, tAuth);
  ok('the password change still works', pw.status === 200, pw.raw);
  ok('then the app still loads and the subject opens', (await call(PORT, 'GET', '/api/tutor/app', null, tAuth)).status === 200
    && (await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth)).status === 200);
  ok('another subject is still refused', (await call(PORT, 'GET', '/api/tutor/subject?subject=Biology', null, tAuth)).status === 403);

  head('switching a tutor off closes the door at once');
  var off = await call(PORT, 'PUT', '/api/tutors/GOC-T-001/active', { active: false }, admAuth);
  ok('the console can switch the tutor off', off.status === 200, off.raw);
  var afterOff = await call(PORT, 'GET', '/api/tutor/app', null, tAuth);
  ok('app delivery is refused from that moment', afterOff.status === 403 || afterOff.status === 401, afterOff.status);
  ok('and sign-in refuses with the same words as any bad login', (await call(PORT, 'POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'a-better-pass' })).status === 401);

  head('the tutor app adopts the shell session');
  ok('a pre-authenticated session is adopted, not re-asked', /window\.__zxSession && window\.__zxSession\.token/.test(tutorSrc) && /enter\(window\.__zxSession\.user\)/.test(tutorSrc));
  ok('the tour bridge moves through the app\u2019s own views', /window\.__zxTourGo = function \(view\)/.test(tutorSrc)
    && /goQuestions\(\)/.test(tutorSrc) && /goScripts\(\)/.test(tutorSrc));
  ok('the shell starts the tutor tour after loading the app', /register\("tutor", window\.GOCTours\.tutor\)/.test(serverSrc) && /maybeAutoStart\("tutor", j\.user\.id\)/.test(serverSrc));
  ok('Founder\u2019s Tutors section gives the sign-in address', /Tutors sign in at <b>\/tutor<\/b>/.test(fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8')));

  head('the tutor tour maps onto real views');
  ok('every tutor step target exists in the tutor app', mod.TUTOR_STEPS.every(function (s) {
    return tutorSrc.indexOf('id="' + s.target + '"') >= 0;
  }), mod.TUTOR_STEPS.filter(function (s) { return tutorSrc.indexOf('id="' + s.target + '"') < 0; }).map(function (s) { return s.target; }).join(','));
  ok('every tutor step navigates through the bridge', mod.TUTOR_STEPS.every(function (s) { return !!s.zx; }));
  ok('the tour prescribes no mutating action', mod.TUTOR_STEPS.every(function (s) {
    return !/data-act|saveQuestion|simple\(|fetch/.test(JSON.stringify(s));
  }));

  inst.stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { try { inst.stop(); } catch (_) {} console.log('FAIL  ' + (e && e.stack || e)); process.exit(1); });
