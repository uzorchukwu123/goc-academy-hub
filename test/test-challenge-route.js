/* test-challenge-route.js — Phase 4.C team challenges, slices 2-5: the console and student
   routes and gating over real HTTP. The contribution/reward logic is covered by the pure
   rules in test-challenge.js; team totals need cohorts, which are an Appwrite feature, so this
   checks the routes, the gating and the empty-cohort case on a local-file server.
   node test/test-challenge-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_CHAL_PORT) || 8182;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 180) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-chal-test-'));
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
    var payload = body === undefined ? null : JSON.stringify(body), headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').then(function (h) {
    if (h && h.status === 200) return h;
    if (tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var adm = null, stuTok = null, stuId = null, chId = null;

waitForBoot(20).then(async function (h) {
  head('setup');
  ok('server is up', h.status === 200, h.raw);
  adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var reg = await call('POST', '/api/students', { name: 'Chal One', password: 'secret123', email: 'c1@example.com', phone: '08012340000', goal: 'JAMB / UTME 2027', subjects: COMBO });
  stuId = reg.body.student.id;
  await call('POST', '/api/students/' + stuId + '/approve', {}, adm);
  await call('PUT', '/api/students/' + stuId + '/tier', { tier: 'goc' }, adm);
  stuTok = (await call('POST', '/api/auth/login', { id: stuId, password: 'secret123' })).body.token;

  head('the console opens a challenge');
  var bad = await call('POST', '/api/challenges', { title: 'x', goal: 5 }, adm);
  ok('a challenge with no cohort or a short title/goal is refused', bad.status === 400, bad.status + ' ' + bad.raw);
  var create = await call('POST', '/api/challenges', { cohortId: 'COH-A', title: 'Race to 500 this week', goal: 500 }, adm);
  ok('a good challenge is created and stamped', create.status === 200 && create.body.created === true && /^CHL-/.test(create.body.challenge.id) && create.body.challenge.week && create.body.challenge.active === true, create.status + ' ' + create.raw.slice(0, 180));
  chId = create.body.challenge.id;

  head('listing and gating');
  var list = await call('GET', '/api/challenges', undefined, adm);
  ok('the console lists it with a team total of zero and not done', list.status === 200 && list.body.challenges.some(function (c) { return c.id === chId && c.teamTotal === 0 && c.done === false; }), list.raw.slice(0, 200));
  var stuCreate = await call('POST', '/api/challenges', { cohortId: 'COH-A', title: 'Sneaky', goal: 50 }, stuTok);
  ok('a student cannot open a challenge', stuCreate.status === 401 || stuCreate.status === 403, stuCreate.status);
  var noAuth = await call('GET', '/api/challenges');
  ok('no session cannot list challenges', noAuth.status === 401 || noAuth.status === 403, noAuth.status);

  head('a student with no cohort sees no challenge');
  var mine = await call('GET', '/api/me/challenge', undefined, stuTok);
  ok('GET /api/me/challenge is null when the student has no cohort', mine.status === 200 && mine.body.challenge === null, mine.raw.slice(0, 160));

  head('closing');
  var close = await call('PUT', '/api/challenges/' + chId + '/active', { active: false }, adm);
  ok('the console closes the challenge', close.status === 200 && close.body.challenge.active === false, close.status + ' ' + close.raw.slice(0, 120));
  var unknown = await call('PUT', '/api/challenges/CHL-999/active', { active: false }, adm);
  ok('closing an unknown challenge is 404', unknown.status === 404, unknown.status);

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  stop();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.error('crashed:', e && e.stack || e);
  console.error('--- server log ---\n' + serverLog.slice(-1000));
  stop();
  process.exit(1);
});
