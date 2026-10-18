/* test-signup-limits.js — Phase 3B slice 5: sign-up is open (no access code) and one address can only
   create so many accounts: the rules in js/goc-core.js, then the real server over HTTP.
   node test/test-signup-limits.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_LIM_PORT) || 8152;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('the rules');
var D = core.SIGNUP_LIMIT_DEFAULTS;
ok('standard numbers are 5 an hour and 20 a day', D.perHour === 5 && D.perDay === 20);
ok('nothing stored reads as the standard numbers', JSON.stringify(core.signupLimits({})) === JSON.stringify(D) && JSON.stringify(core.signupLimits(null)) === JSON.stringify(D));
ok('stored numbers are used', core.signupLimits({ signupPerHour: 9, signupPerDay: 30 }).perHour === 9);
ok('damaged numbers fall back to the standard', core.signupLimits({ signupPerHour: 'x', signupPerDay: -4 }).perDay === 20);
ok('a day is never below an hour', core.signupLimits({ signupPerHour: 50, signupPerDay: 10 }).perDay === 50);
ok('good input is accepted, as text too', core.validateSignupLimits({ perHour: '3', perDay: '9' }).perHour === 3);
ok('zero, fractions, blanks and booleans are refused',
   [0, 2.5, '', true, null, 1001].every(function (v) { return !!core.validateSignupLimits({ perHour: v, perDay: 10 }).error; }));
ok('a day below the hour is refused', /cannot be fewer/.test(core.validateSignupLimits({ perHour: 9, perDay: 3 }).error));
var now = 1e12, lim = { perHour: 3, perDay: 5 };
ok('under the limit means no wait', core.signupWait([now - 10], now, lim) === null && core.signupWait([], now, lim) === null);
var w = core.signupWait([now - 50 * 60000, now - 30 * 60000, now - 5 * 60000], now, lim);
ok('at the hourly limit the wait is until the oldest one leaves the hour (10 minutes)', w && w.window === 'hour' && w.retryAfter === 600, JSON.stringify(w));
var many = [1, 2, 3, 4, 5].map(function (i) { return now - i * 3 * 3600 * 1000; });
var w2 = core.signupWait(many, now, lim);
ok('at the daily limit the wait is until the oldest leaves the day', w2 && w2.window === 'day' && w2.retryAfter === 3 * 3600 * 0 + (24 - 15) * 3600, JSON.stringify(w2));
ok('old sign-ups stop counting', core.signupWait([now - 25 * 3600 * 1000, now - 26 * 3600 * 1000, now - 27 * 3600 * 1000], now, lim) === null);
ok('the message names the wait and says to ask the academy', /about 10 minutes/.test(core.signupLimitMessage(600, 'hour')) && /ask the academy/.test(core.signupLimitMessage(600, 'hour')) && /today/.test(core.signupLimitMessage(30000, 'day')));

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-lim-test-'));
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
var seq = 0;
function signup(extra) {
  seq++;
  return call('POST', '/api/students', Object.assign({ name: 'Open Person ' + seq, password: 'secret123', email: 'o' + seq + '@example.com',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology'] }, extra || {}));
}

(async function () {
  await waitForBoot(100);
  head('anyone can sign up, with no code, and the account is Open');
  var r = await signup();
  ok('accepted with no code at all', r.status === 200 && r.body && r.body.student, r.status + ' ' + r.raw);
  /* the sign-up reply is only "pending" now, so read the stored record the way the console does */
  var fl = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var ftok = fl.body && fl.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);
  var roster = await call('GET', '/api/students', undefined, ftok);
  var mine = ((roster.body && (roster.body.students || roster.body)) || []).filter(function (x) { return r.body && r.body.student && x.id === r.body.student.id; })[0];
  ok('stored as Open, waiting for approval', r.body && r.body.pending === true && !!mine && mine.tier === 'open' && mine.pendingApproval === true, JSON.stringify(mine) + ' ' + r.raw);
  r = await signup({ signupCode: 'whatever' });
  ok('a stale code field is ignored', r.status === 200, r.status + ' ' + r.raw);

  head('the 6th sign-up in an hour from one address is refused');
  for (var i = 0; i < 3; i++) await signup();
  r = await signup();
  ok('the 6th is 429', r.status === 429, r.status + ' ' + r.raw);
  ok('with a Retry-After of at most an hour', Number(r.headers['retry-after']) > 0 && Number(r.headers['retry-after']) <= 3600, r.headers['retry-after']);
  ok('and a message about the connection that says to ask the academy', /connection/.test(r.body.error) && /ask the academy/.test(r.body.error), r.raw);

  head('a refused attempt is not counted, and the console can raise the allowance');
  var early = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var plain = await call('PUT', '/api/settings/signup-limits', { perHour: 8, perDay: 9 }, early.body && early.body.token);
  ok('the limits cannot be changed before the console is unlocked', plain.status >= 400, plain.status);
  var login = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var tok = login.body && login.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, tok);
  var up = await call('PUT', '/api/settings/signup-limits', { perHour: 8, perDay: 9 }, tok);
  ok('raised to 8 an hour, 9 a day', up.status === 200 && up.body.limits.perHour === 8, up.raw);
  var a = await signup(), b = await signup(), c = await signup();
  ok('the next three go through (5 used, 8 allowed)', a.status === 200 && b.status === 200 && c.status === 200, [a.status, b.status, c.status].join(','));
  r = await signup();
  ok('the 9th is refused (8 an hour)', r.status === 429, r.status);
  var more = await call('PUT', '/api/settings/signup-limits', { perHour: 9, perDay: 9 }, tok);
  ok('an hour above the day is refused when typed', (await call('PUT', '/api/settings/signup-limits', { perHour: 40, perDay: 9 }, tok)).status === 400);
  r = await signup();
  ok('with 9 allowed, the 9th goes through and the 10th is refused',
     r.status === 200 && (await signup()).status === 429, r.status);
  r = await signup();
  ok('and that refusal says today, with a longer wait', r.status === 429 && /today/.test(r.body.error) && Number(r.headers['retry-after']) > 3600, r.raw + r.headers['retry-after']);
  var lowered = await call('PUT', '/api/settings/signup-limits', { perHour: 1, perDay: 1 }, tok);
  ok('lowering takes effect at once', lowered.status === 200 && (await signup()).status === 429);

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  stop(); process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  harness error: ' + (e && e.message) + '\n' + serverLog); stop(); process.exit(1); });
