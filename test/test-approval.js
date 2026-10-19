/* test-approval.js — Admin-approval flow (registration gating), over real HTTP.
   A self-registered account starts inactive and cannot log in until a Founder or
   Academic Director approves it from the console. Starts server/server.js on a
   spare port against a throwaway data file. No dependencies:
   run:  node test/test-approval.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TEST_PORT) || 8151;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-approval-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(raw); } catch (e) { /* keep raw */ }
        resolve({ status: res.statusCode, body: json, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}

var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027',
    GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
var serverLog = '';
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

/* A valid self-registration body: four subjects (Use of English plus three),
   which the combination rules accept. */
function signupBody(n) {
  return { name: 'Pending ' + n, password: 'secret123',
           email: 'pending' + n + '@example.com', phone: '0800000' + (1000 + n),
           goal: 'JAMB / UTME 2027',
           subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };
}

var adm = null, pendingId = null, rejectId = null;

waitForBoot(20).then(async function (h) {
  head('the server is up');
  ok('health responds', h.status === 200 && h.body && h.body.service === 'goc-academy-hub', h.raw);

  head('a self-registration is pending, with no session');
  var reg = await call('POST', '/api/students', signupBody(1));
  ok('registration is accepted', reg.status === 200 && !!reg.body, reg.status + ' ' + reg.raw);
  ok('the reply says pending and carries only id and name', reg.body && reg.body.pending === true
     && reg.body.student && reg.body.student.id && reg.body.student.name === 'Pending 1', reg.raw);
  ok('no session token is issued at sign-up', !(reg.body && reg.body.token), reg.raw);
  ok('no credential leaks in the reply', !/pwHash|"password"|salt/i.test(reg.raw), reg.raw);
  pendingId = reg.body.student.id;

  head('a pending account cannot log in');
  var early = await call('POST', '/api/auth/login', { id: pendingId, password: 'secret123' });
  ok('login is refused with 403 while awaiting approval', early.status === 403 && /awaiting approval/i.test((early.body && early.body.error) || ''), early.status + ' ' + early.raw);
  ok('no token comes back', !(early.body && early.body.token), early.raw);

  head('the console signs in and unlocks');
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  ok('the Founder can sign in', lin.status === 200 && !!lin.body.token, lin.status + ' ' + lin.raw.slice(0, 120));
  adm = lin.body.token;
  var un = await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  ok('the right passcode opens the console', un.status === 200 && un.body.unlocked === true, un.raw);

  head('the pending account shows only in the pending list');
  var roster = await call('GET', '/api/students', undefined, adm);
  ok('the roster lists the account as pending', roster.status === 200 && Array.isArray(roster.body)
     && roster.body.some(function (s) { return s.id === pendingId && s.pendingApproval === true && s.active === false; }), roster.raw.slice(0, 160));

  head('a non-console session cannot approve or reject');
  var sAppr = await call('POST', '/api/students/' + pendingId + '/approve', {}, null);
  ok('no session cannot approve (401/403)', sAppr.status === 401 || sAppr.status === 403, sAppr.status);
  var sRej = await call('DELETE', '/api/students/' + pendingId + '/approve', undefined, null);
  ok('no session cannot reject (401/403)', sRej.status === 401 || sRej.status === 403, sRej.status);

  head('approving activates the account');
  var appr = await call('POST', '/api/students/' + pendingId + '/approve', {}, adm);
  ok('approve succeeds', appr.status === 200, appr.status + ' ' + appr.raw.slice(0, 160));
  ok('the account is now active and no longer pending', appr.body && appr.body.active === true && appr.body.pendingApproval === false, appr.raw.slice(0, 200));
  ok('who approved is recorded', appr.body && appr.body.approvedBy === 'GOC-A-001', appr.raw.slice(0, 200));

  head('approving a non-pending account is refused');
  var again = await call('POST', '/api/students/' + pendingId + '/approve', {}, adm);
  ok('a second approve returns 400', again.status === 400 && /not awaiting approval/i.test((again.body && again.body.error) || ''), again.status + ' ' + again.raw);

  head('the approved student can now log in');
  var now = await call('POST', '/api/auth/login', { id: pendingId, password: 'secret123' });
  ok('login now succeeds with a token', now.status === 200 && !!now.body.token, now.status + ' ' + now.raw.slice(0, 120));

  head('rejecting deletes a pending account');
  var reg2 = await call('POST', '/api/students', signupBody(2));
  ok('a second registration is pending', reg2.status === 200 && reg2.body.pending === true, reg2.raw);
  rejectId = reg2.body.student.id;
  var rej = await call('DELETE', '/api/students/' + rejectId + '/approve', undefined, adm);
  ok('reject succeeds', rej.status === 200 && rej.body && rej.body.rejected === true && rej.body.id === rejectId, rej.status + ' ' + rej.raw);
  var roster2 = await call('GET', '/api/students', undefined, adm);
  ok('the rejected account is gone from the roster', roster2.status === 200 && !roster2.body.some(function (s) { return s.id === rejectId; }), roster2.raw.slice(0, 160));
  var rejAgain = await call('DELETE', '/api/students/' + rejectId + '/approve', undefined, adm);
  ok('rejecting an unknown/already-gone account is refused', rejAgain.status === 404 || rejAgain.status === 400, rejAgain.status);

  head('rejecting a non-pending (now active) account is refused');
  var rejActive = await call('DELETE', '/api/students/' + pendingId + '/approve', undefined, adm);
  ok('an active account cannot be rejected (400)', rejActive.status === 400 && /not awaiting approval/i.test((rejActive.body && rejActive.body.error) || ''), rejActive.status + ' ' + rejActive.raw);

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed') + '  (' + passes + ' checks)');
  stop();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.error('test-approval.js crashed:', e && e.stack || e);
  console.error('--- server log ---\n' + serverLog);
  stop();
  process.exit(1);
});
