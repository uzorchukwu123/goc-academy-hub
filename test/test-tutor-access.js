/* Shared tutor login, dashboard handoff and server-side authorization. */
'use strict';
var http = require('http');
var vm = require('vm');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TUTOR_ACCESS_PORT) || 8183;
var mod = require(path.join(APP, 'js', 'onboarding.js'));
var tutorSrc = fs.readFileSync(path.join(APP, 'js', 'tutor-app.js'), 'utf8');
var serverSrc = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
var appSrc = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');

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

async function browserTutorLogin(port, id, password) {
  var elements = {}, requests = [], opened = [], errors = [];
  ['loginId','loginPw','loginBtn','loginForm','tutorConnection','tutorConnectionTitle','tutorConnectionMessage','tutorRetry'].forEach(function (key) {
    elements[key] = {value:'', textContent:'', hidden:false, disabled:false, dataset:{}};
  });
  elements.loginId.value = id; elements.loginPw.value = password; elements.loginBtn.textContent = 'Log in';
  var storage = {getItem:function(){return null;},setItem:function(){},removeItem:function(){}};
  var win = {console:console, document:{getElementById:function(id){return elements[id];}}, location:{protocol:'https:'}, navigator:{userAgent:'test'}, sessionStorage:storage,
    fetch:function(url, opts){requests.push({url:url,opts:opts});return fetch('http://127.0.0.1:'+port+'/'+url,opts);},
    toast:function(s){errors.push(s);},setTimeout:function(){},clearTimeout:function(){},Promise:Promise,
    __zxOpen:function(session){opened.push(session);}};
  win.window=win; win.self=win;
  var ctx=vm.createContext(win);
  vm.runInContext(fs.readFileSync(path.join(APP,'js','goc-core.js'),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(path.join(APP,'js','api.js'),'utf8'),ctx);
  vm.runInContext(appSrc.slice(appSrc.indexOf('var pendingTutor = null;'),appSrc.indexOf('/* ===== Management preview =====')),ctx);
  await win.GOC.api.ready; await win.login();
  return {opened:opened,requests:requests,errors:errors,elements:elements,api:win.GOC.api};
}

var inst = boot(PORT);
process.on('exit', function () { inst.stop(); });

(async function () {
  await waitForBoot(PORT, 150);

  head('one shared entry point');
  var homepage = await call(PORT, 'GET', '/');
  ok('normal homepage offers the shared login', homepage.status === 200 && /id="login-v2"/.test(homepage.raw));
  ok('the separate tutor page is gone', (await call(PORT, 'GET', '/tutor')).status === 404);
  ok('the separate tutor login endpoint is gone', (await call(PORT, 'POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'x' })).status === 404);
  ok('the old hidden door is still gone', (await call(PORT, 'POST', '/api/door', { word: 'x' })).status === 404);
  ok('the dashboard is a normal static asset', (await call(PORT, 'GET', '/js/tutor-app.js')).status === 200);
  ok('the app delivery gate is gone', (await call(PORT, 'GET', '/api/tutor/app')).status === 404);
  head('tutor API authorization remains enforced');
  ok('no token, no tutor data', (await call(PORT, 'GET', '/api/tutor/me')).status === 401);
  var adm = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var admAuth = { Authorization: 'Bearer ' + adm.body.token };
  await call(PORT, 'POST', '/api/auth/unlock', { passcode: '2027' }, admAuth);
  ok('a management token cannot access tutor data', (await call(PORT, 'GET', '/api/tutor/me', null, admAuth)).status === 403);
  var mk = await call(PORT, 'POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Chemistry'], password: 'start-pass-1' }, admAuth);
  ok('the console still creates the tutor', mk.status === 200, mk.raw);
  var before = JSON.parse(fs.readFileSync(path.join(inst.box, 'server', 'data.json'), 'utf8')).tutors[0];
  head('browser-to-server shared login');
  var browser = await browserTutorLogin(PORT, 'goc-t-001', 'start-pass-1');
  ok('existing tutor reaches dashboard with the original ID, subjects and required password change', browser.opened.length === 1 && browser.opened[0].user.id === 'GOC-T-001' && browser.opened[0].user.subjects.join() === 'Chemistry' && browser.opened[0].user.mustChangePassword === true);
  ok('browser uses only the common login, not an app delivery request', browser.requests.filter(function(r){return r.url === 'api/auth/login';}).length === 1 && !browser.requests.some(function(r){return /tutor\/(?:app|login)/.test(r.url);}));
  ok('browser clears password after submitting', browser.elements.loginPw.value === '');
  var existing = await call(PORT, 'GET', '/api/tutors', null, admAuth);
  ok('logging in did not create a duplicate tutor', existing.body.tutors.length === 1 && existing.body.tutors[0].id === 'GOC-T-001');
  var after = JSON.parse(fs.readFileSync(path.join(inst.box, 'server', 'data.json'), 'utf8')).tutors[0];
  ok('login preserves the existing password verifier and subjects', before.pwHash === after.pwHash && JSON.stringify(before.subjects) === JSON.stringify(after.subjects));
  await browser.api.logout();
  var tl = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-T-001', password: 'start-pass-1' });
  var tAuth = { Authorization: 'Bearer ' + tl.body.token };
  ok('subject APIs stay closed until the password is changed', (await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth)).status === 403);
  var pw = await call(PORT, 'POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'a-better-pass' }, tAuth);
  ok('the password change still works', pw.status === 200, pw.raw);
  ok('after password change the assigned subject opens', (await call(PORT, 'GET', '/api/tutor/subject?subject=Chemistry', null, tAuth)).status === 200);
  ok('another subject is still refused', (await call(PORT, 'GET', '/api/tutor/subject?subject=Biology', null, tAuth)).status === 403);

  head('switching a tutor off closes the door at once');
  var off = await call(PORT, 'PUT', '/api/tutors/GOC-T-001/active', { active: false }, admAuth);
  ok('the console can switch the tutor off', off.status === 200, off.raw);
  var afterOff = await call(PORT, 'GET', '/api/tutor/me', null, tAuth);
  ok('tutor data is refused from that moment', afterOff.status === 403 || afterOff.status === 401, afterOff.status);
  var inactive = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-T-001', password: 'a-better-pass' });
  var unknown = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-T-099', password: 'a-better-pass' });
  var wrong = await call(PORT, 'POST', '/api/auth/login', { id: 'GOC-T-001', password: 'wrong' });
  ok('inactive, unknown and incorrect credentials have the same refusal', [inactive, unknown, wrong].every(function(r){return r.status === 401 && r.body.error === inactive.body.error;}));

  head('the tutor app adopts the shared session');
  ok('a pre-authenticated tutor session is adopted, not re-asked', /window\.__zxOpen\(\{ token: token, user: user \}\)/.test(appSrc) && /session\.user\.role !== 'tutor'/.test(tutorSrc));
  ok('the tour bridge moves through the app’s own views', /window\.__zxTourGo = function \(view\)/.test(tutorSrc) && /goQuestions\(\)/.test(tutorSrc) && /goScripts\(\)/.test(tutorSrc));
  ok('the shared login starts the tutor tour', /register\('tutor', window\.GOCTours\.tutor\)/.test(appSrc) && /maybeAutoStart\('tutor', user\.id\)/.test(appSrc));
  ok('Founder’s Tutors section directs tutors to the normal login', /normal login page with their tutor ID/.test(appSrc));

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
