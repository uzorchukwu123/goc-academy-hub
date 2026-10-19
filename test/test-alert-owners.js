/* test-manager-signin.js - Roles slice (c), step 6: each console alert goes to the Founder plus the matching role.
   node test/test-alert-owners.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_AO_PORT) || 8207;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-alo-test-'));
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
  var AD = 'academic-director', FIN = 'finance', PUB = 'publicity', SA = 'student-affairs';
  function seen(kind, id, role) { return core.alertVisibleTo({ kind: kind }, id, role); }
  ok('the owner of each kind is read from the capability map', core.alertCapability('tutor-mark') === 'theory.mark' && core.alertCapability('class-notice') === 'notices.manage' && core.alertCapability('question-flag') === 'questions.manage' && core.alertCapability('assignment') === 'assignments.oversee' && core.alertCapability('contact-message') === 'contact.handle');
  ok('every kind points at a real capability', ['tutor-mark', 'class-notice', 'question-flag', 'assignment', 'contact-message'].every(function (k) { return core.allCapabilities().indexOf(core.alertCapability(k)) > -1; }));
  ok('an unknown kind has no owner', core.alertCapability('mystery') === null && core.alertCapability(undefined) === null && core.alertCapability('toString') === null);
  ok('the Founder sees every kind, including an unknown one', ['tutor-mark', 'class-notice', 'question-flag', 'assignment', 'contact-message', 'mystery'].every(function (k) { return seen(k, 'GOC-A-005', 'founder'); }));
  ok('the seeded accounts keep full access', seen('mystery', 'GOC-A-001', null) && seen('mystery', 'GOC-A-002', AD) && seen('tutor-mark', 'GOC-A-002', 'academic-director'));
  ok('a marked script goes to the Academic Director only', seen('tutor-mark', 'GOC-A-003', AD) && [FIN, PUB, SA].every(function (r) { return !seen('tutor-mark', 'GOC-A-003', r); }));
  ok('a class notice goes to the Academic Director and Publicity', seen('class-notice', 'GOC-A-003', AD) && seen('class-notice', 'GOC-A-003', PUB) && !seen('class-notice', 'GOC-A-003', FIN) && !seen('class-notice', 'GOC-A-003', SA));
  ok('a contact message goes to Publicity and Student Affairs', seen('contact-message', 'GOC-A-003', PUB) && seen('contact-message', 'GOC-A-003', SA) && !seen('contact-message', 'GOC-A-003', AD) && !seen('contact-message', 'GOC-A-003', FIN));
  ok('a question flag and an assignment go to the Academic Director', seen('question-flag', 'GOC-A-003', AD) && seen('assignment', 'GOC-A-003', AD) && !seen('question-flag', 'GOC-A-003', SA) && !seen('assignment', 'GOC-A-003', FIN));
  ok('Finance sees none of them', ['tutor-mark', 'class-notice', 'question-flag', 'assignment', 'contact-message'].every(function (k) { return !seen(k, 'GOC-A-003', FIN); }));
  ok('an unknown kind, a missing role or a mistyped role is hidden from managers', !seen('mystery', 'GOC-A-003', AD) && !seen('tutor-mark', 'GOC-A-003', null) && !seen('tutor-mark', 'GOC-A-003', 'chairman') && !core.alertVisibleTo(null, 'GOC-A-003', AD));
  var list = [{ id: 'a', kind: 'tutor-mark' }, { id: 'b', kind: 'class-notice' }, { id: 'c', kind: 'contact-message' }, { id: 'd', kind: 'mystery' }];
  ok('alertsFor filters a list and never mutates it', core.alertsFor(list, 'GOC-A-004', PUB).map(function (a) { return a.id; }).join(',') === 'b,c' && list.length === 4 && core.alertsFor(null, 'GOC-A-004', PUB).length === 0);

  await waitForBoot(100);
  var f = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var ftok = f.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);
  var roles = [['Ada Obi', FIN, 'GOC-A-003'], ['Chidi Eze', PUB, 'GOC-A-004'], ['Ngozi Ade', SA, 'GOC-A-005'], ['Tunde Bello', AD, 'GOC-A-006']];
  var tok = {};
  for (var i = 0; i < roles.length; i++) {
    await call('POST', '/api/managers', { name: roles[i][0], role: roles[i][1], password: 'starter123', passcode: '4821' }, ftok);
    var lg = await call('POST', '/api/auth/login', { id: roles[i][2], password: 'starter123' });
    await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'mine-pass77' }, lg.body.token);
    await call('POST', '/api/auth/unlock', { passcode: '4821' }, lg.body.token);
    tok[roles[i][1]] = lg.body.token;
  }
  var dp = path.join(SANDBOX, 'server', 'data.json');
  var db = JSON.parse(fs.readFileSync(dp, 'utf8'));
  db.alerts = [
    { id: 'al-1', kind: 'tutor-mark', at: '2026-10-14T09:00:00Z', seen: false },
    { id: 'al-2', kind: 'class-notice', at: '2026-10-14T09:01:00Z', seen: false },
    { id: 'al-3', kind: 'contact-message', at: '2026-10-14T09:02:00Z', seen: false },
    { id: 'al-4', kind: 'question-flag', at: '2026-10-14T09:03:00Z', seen: false },
    { id: 'al-5', kind: 'mystery', at: '2026-10-14T09:04:00Z', seen: false }
  ];
  fs.writeFileSync(dp, JSON.stringify(db, null, 2));
  function ids(r) { return r.body.alerts.map(function (a) { return a.id; }).sort().join(','); }

  head('what each console sees');
  var fa = await call('GET', '/api/alerts', undefined, ftok);
  ok('the Founder sees all five', fa.status === 200 && fa.body.count === 5 && ids(fa) === 'al-1,al-2,al-3,al-4,al-5', fa.raw);
  var ad = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ad.body.token);
  ok('the seeded Academic Director sees all five', ids(await call('GET', '/api/alerts', undefined, ad.body.token)) === 'al-1,al-2,al-3,al-4,al-5');
  var r1 = await call('GET', '/api/alerts', undefined, tok[AD]);
  ok('an issued Academic Director sees script, notice and flag', r1.status === 200 && r1.body.count === 3 && ids(r1) === 'al-1,al-2,al-4', r1.raw);
  var r2 = await call('GET', '/api/alerts', undefined, tok[PUB]);
  ok('Publicity sees the notice and the contact message', r2.body.count === 2 && ids(r2) === 'al-2,al-3', r2.raw);
  var r3 = await call('GET', '/api/alerts', undefined, tok[SA]);
  ok('Student Affairs sees the contact message only', r3.body.count === 1 && ids(r3) === 'al-3', r3.raw);
  var r4 = await call('GET', '/api/alerts', undefined, tok[FIN]);
  ok('Finance sees none', r4.status === 200 && r4.body.count === 0, r4.raw);

  head('tapping Seen');
  ok('Student Affairs cannot clear an alert that is not theirs, and is told it does not exist', (await call('POST', '/api/alerts/al-1/seen', undefined, tok[SA])).status === 404);
  ok('and it stays unseen for the Founder', (await call('GET', '/api/alerts', undefined, ftok)).body.count === 5);
  var ok1 = await call('POST', '/api/alerts/al-3/seen', undefined, tok[SA]);
  ok('their own can be cleared, and the count is theirs', ok1.status === 200 && ok1.body.count === 0, ok1.raw);
  ok('it is cleared for Publicity too, since it is one shared alert', (await call('GET', '/api/alerts', undefined, tok[PUB])).body.count === 1);
  ok('the Founder clears any alert', (await call('POST', '/api/alerts/al-5/seen', undefined, ftok)).status === 200);
  ok('a missing alert is 404 for everyone', (await call('POST', '/api/alerts/nope/seen', undefined, ftok)).status === 404);
  ok('no session is refused', (await call('GET', '/api/alerts')).status === 401);

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
