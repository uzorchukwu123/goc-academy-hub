/* test-overview-scope.js - Roles slice (d) follow-up: the console Overview figures, scoped by role.
   node test/test-overview-scope.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_OV_PORT) || 8209;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-ovs-test-'));
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
  head('the pure rule');
  var F = { studentsTotal: 12, activeToday: 4, avgScorePercent: 61, lessonsPublished: 9 };
  function keys(id, role) { return Object.keys(core.overviewFor(id, role, F)).sort().join(','); }
  ok('the Founder sees all four figures', keys('GOC-A-009', 'founder') === 'activeToday,avgScorePercent,lessonsPublished,studentsTotal', keys('GOC-A-009', 'founder'));
  ok('the two seeded accounts keep all four, whatever role they carry', keys('GOC-A-001', null) === keys('GOC-A-009', 'founder') && keys('GOC-A-002', 'finance') === keys('GOC-A-009', 'founder'));
  ok('Finance sees the student count only', keys('GOC-A-003', 'finance') === 'studentsTotal', keys('GOC-A-003', 'finance'));
  ok('Publicity sees the student count only', keys('GOC-A-003', 'publicity') === 'studentsTotal', keys('GOC-A-003', 'publicity'));
  ok('Student Affairs sees students, active today and the average mock score', keys('GOC-A-003', 'student-affairs') === 'activeToday,avgScorePercent,studentsTotal', keys('GOC-A-003', 'student-affairs'));
  ok('the Academic Director role sees students, the average mock score and lessons published', keys('GOC-A-003', 'academic-director') === 'avgScorePercent,lessonsPublished,studentsTotal', keys('GOC-A-003', 'academic-director'));
  ok('a missing or mistyped role sees nothing (fails closed)', keys('GOC-A-003', null) === '' && keys('GOC-A-003', 'chairman') === '' && keys('GOC-A-003', '') === '');
  ok('values are copied as they are, not changed', core.overviewFor('GOC-A-003', 'student-affairs', F).avgScorePercent === 61 && core.overviewFor('GOC-A-003', 'finance', F).studentsTotal === 12);
  ok('a figure the server did not compute is not invented', core.overviewFor('GOC-A-009', 'founder', { studentsTotal: 3 }).hasOwnProperty('activeToday') === false);
  ok('a missing figures object gives an empty reply, not a crash', JSON.stringify(core.overviewFor('GOC-A-009', 'founder', null)) === '{}');
  ok('the source figures are never changed', (function () { var c = JSON.parse(JSON.stringify(F)); core.overviewFor('GOC-A-003', 'finance', c); return JSON.stringify(c) === JSON.stringify(F); })());
  ok('every figure is tied to a capability that exists', Object.keys(core.OVERVIEW_FIGURE_CAPS).every(function (k) { return core.allCapabilities().indexOf(core.OVERVIEW_FIGURE_CAPS[k]) > -1; }));
  ok('overview.all stays defined and Founder-only (as alerts.all does)', core.rolesWithCapability('overview.all').join() === 'founder');

  head('the page and the route are wired');
  var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  var srv = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
  ok('the overview route is open to any role holding overview.own', /path: \/\^\\\/api\\\/admin\\\/overview\$\/, need: 'console', cap: 'overview\.own'/.test(srv));
  ok('and answers through core.overviewFor with the session id and role', /core\.overviewFor\(sess\.data\.id, sess\.data\.roleKey,/.test(srv));
  ok('the four tiles show a dash for any figure that is not a number', /typeof r\.activeToday === 'number'\) \? String\(r\.activeToday\) : '—'/.test(app) && /typeof r\.avgScorePercent === 'number'/.test(app));
  ok('the Overview panel does the same for lessons published', /typeof r\.lessonsPublished === 'number'\) \? String\(r\.lessonsPublished\) : '—'/.test(app));

  head('on the real server');
  await waitForBoot(100);
  var f = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var ftok = f.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);
  var who = [['Ada Obi', 'finance', 'GOC-A-003'], ['Ngozi Ade', 'student-affairs', 'GOC-A-004'], ['Tunde Bello', 'publicity', 'GOC-A-005'], ['Dr Ife Eze', 'academic-director', 'GOC-A-006']];
  var tok = {};
  for (var j = 0; j < who.length; j++) {
    var mk = await call('POST', '/api/managers', { name: who[j][0], role: who[j][1], password: 'starter123', passcode: '4821' }, ftok);
    ok('set-up: ' + who[j][1] + ' manager created', mk.status === 200 || mk.status === 201, mk.raw);
    var lg = await call('POST', '/api/auth/login', { id: who[j][2], password: 'starter123' });
    await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'secret-pass77' }, lg.body.token);
    await call('POST', '/api/auth/unlock', { passcode: '4821' }, lg.body.token);
    tok[who[j][1]] = lg.body.token;
  }
  var st = await call('POST', '/api/admin/students', { name: 'Test Student', goal: 'UTME', subjects: ['Use of English', 'Mathematics', 'Physics', 'Chemistry'] }, tok['finance']);
  ok('set-up: Finance adds one student', st.status === 200 || st.status === 201, st.raw);

  var fo = await call('GET', '/api/admin/overview', undefined, ftok);
  ok('the Founder gets all four figures', fo.status === 200 && ['studentsTotal', 'activeToday', 'avgScorePercent', 'lessonsPublished'].every(function (k) { return fo.body.hasOwnProperty(k); }) && fo.body.studentsTotal === 1, fo.raw);
  var fi = await call('GET', '/api/admin/overview', undefined, tok['finance']);
  ok('Finance gets 200 with only the student count', fi.status === 200 && Object.keys(fi.body).join() === 'studentsTotal' && fi.body.studentsTotal === 1, fi.raw);
  var pu = await call('GET', '/api/admin/overview', undefined, tok['publicity']);
  ok('Publicity gets only the student count', pu.status === 200 && Object.keys(pu.body).join() === 'studentsTotal', pu.raw);
  var sa = await call('GET', '/api/admin/overview', undefined, tok['student-affairs']);
  ok('Student Affairs gets students, active today and the average', sa.status === 200 && Object.keys(sa.body).sort().join() === 'activeToday,avgScorePercent,studentsTotal', sa.raw);
  var ad = await call('GET', '/api/admin/overview', undefined, tok['academic-director']);
  ok('an Academic Director manager gets students, the average and lessons', ad.status === 200 && Object.keys(ad.body).sort().join() === 'avgScorePercent,lessonsPublished,studentsTotal', ad.raw);
  ok('nothing in the reply names a student or carries an ID, a score row or a hash', [fi, sa, ad].every(function (r) { return !/GOC-\d|pwHash|email|phone/i.test(r.raw); }));

  var seeded = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, seeded.body.token);
  var sd = await call('GET', '/api/admin/overview', undefined, seeded.body.token);
  ok('the seeded Academic Director account still gets all four', sd.status === 200 && Object.keys(sd.body).length === 4, sd.raw);
  ok('no sign-in at all is refused (401)', (await call('GET', '/api/admin/overview')).status === 401);
  var stu = await call('POST', '/api/students', { name: 'Open Person', password: 'pass-word-1', subjects: ['Use of English', 'Mathematics', 'Physics', 'Chemistry'] });
  var slogin = stu.body && stu.body.id ? await call('POST', '/api/auth/login', { id: stu.body.id, password: 'pass-word-1' }) : { body: {} };
  ok('a student session still cannot read the overview', !slogin.body.token || (await call('GET', '/api/admin/overview', undefined, slogin.body.token)).status >= 401);

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
