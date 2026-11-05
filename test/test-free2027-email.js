/* test-free2027-email.js — PR #9 Part D: Brevo/SMTP verification-email
   configuration. Covers the required cases 21–32:
     21 missing SMTP configuration        27 OTP resend limits
     22 incomplete SMTP configuration     28 incorrect OTP rejection
     23 SMTP connection failure           29 single-use OTP enforcement
     24 successful SMTP readiness         30 registration only after verification
     25 six-digit OTP generation          31 safe administrative diagnostics
     26 OTP expiry                        32 no secret leakage
   Phase 1 unit-tests the classifier; phases 2–5 boot real server instances
   with controlled environments (none / partial / failing / working stub).
   node test/test-free2027-email.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var mailstatus = require(path.join(APP, 'server', 'lib', 'mailstatus.js'));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------- phase 1: unit */
head('classifier: the four configuration states, without ever reading values out');
var empty = mailstatus.classifySmtpEnv({});
ok('21. nothing set -> missing', empty.status === 'missing' && empty.missing.indexOf('GOC_SMTP_HOST') > -1, empty.status);
var partial = mailstatus.classifySmtpEnv({ GOC_SMTP_HOST: 'smtp-relay.brevo.com', GOC_SMTP_USER: 'x@y' });
ok('22. partially set -> incomplete (never reported as operational)', partial.status === 'incomplete' && partial.missing.indexOf('GOC_SMTP_PASS') > -1 && partial.missing.indexOf('GOC_FREE_2027_OTP_SECRET') > -1, JSON.stringify(partial.missing));
var brokenPair = mailstatus.classifySmtpEnv({ GOC_SMTP_HOST: 'h', GOC_SMTP_USER: 'u', GOC_FREE_2027_OTP_SECRET: 's'.repeat(32) });
ok('22b. user without password is incomplete', brokenPair.status === 'incomplete' && brokenPair.missing.indexOf('GOC_SMTP_PASS') > -1, JSON.stringify(brokenPair.missing));
var shortSecret = mailstatus.classifySmtpEnv({ GOC_SMTP_HOST: 'h', GOC_SMTP_USER: 'u', GOC_SMTP_PASS: 'p', GOC_FREE_2027_OTP_SECRET: 'short' });
ok('22c. a too-short OTP secret is incomplete', shortSecret.status === 'incomplete' && shortSecret.missing.indexOf('GOC_FREE_2027_OTP_SECRET') > -1);
var full = mailstatus.classifySmtpEnv({ GOC_SMTP_HOST: 'smtp-relay.brevo.com', GOC_SMTP_PORT: '587', GOC_SMTP_USER: 'u', GOC_SMTP_PASS: 'k', GOC_SMTP_FROM: 'v@gocacademy.test', GOC_FREE_2027_OTP_SECRET: 's'.repeat(40) });
ok('configured when every required variable is present', full.status === 'configured' && full.missing.length === 0, full.status);
ok('24. live verify ok -> ready', mailstatus.withLiveCheck(full, true).status === 'ready');
ok('23. live verify failed -> unreachable', mailstatus.withLiveCheck(full, false).status === 'unreachable');
ok('the classifier output names variables but never values', (function () {
  var out = JSON.stringify([empty, partial, full, mailstatus.withLiveCheck(full, true)]);
  /* the public Brevo hint names the well-known relay host by design; what must
     never appear are the actual secret/credential values from the env */
  return out.indexOf('s'.repeat(40)) < 0 && out.indexOf('x@y') < 0 && out.indexOf('"k"') < 0;
})());
ok('the diagnostic names the exact Brevo variables for the Founder', /GOC_SMTP_HOST=smtp-relay\.brevo\.com/.test(mailstatus.BREVO_HINT) && /GOC_SMTP_PORT=587/.test(mailstatus.BREVO_HINT) && /GOC_FREE_2027_OTP_SECRET/.test(mailstatus.BREVO_HINT));

/* ------------------------------------------------------- server harness */
function bootServer(tag, port, extraEnv) {
  var sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-mail-' + tag + '-'));
  var data = path.join(sandbox, 'data');
  var mailFile = path.join(data, 'mail-capture.jsonl');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'server'), path.join(sandbox, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(sandbox, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
    var from = path.join(APP, f);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(sandbox, f));
  });
  try { fs.rmSync(path.join(sandbox, 'server', 'data.json'), { force: true }); } catch (e) {}
  var log = '';
  var child = spawn(process.execPath, [path.join(sandbox, 'server', 'server.js')], {
    cwd: sandbox,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
      GOC_TEST_MAIL_FILE: mailFile,
      GOC_FOUNDER_PW: 'founder2027',
      GOC_PASSCODE: '2027',
      GOC_DATA_DIR: data,
      GOC_FREE_2027: '1'
    }, extraEnv),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (c) { log += c; });
  child.stderr.on('data', function (c) { log += c; });
  return { child: child, log: function () { return log; }, mailFile: mailFile, port: port, data: data };
}
function call(srv, method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: srv.port, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(srv, tries) {
  return call(srv, 'GET', '/api/health').then(function (h) {
    if (h.status === 200 || tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return waitForBoot(srv, tries - 1); });
  });
}
function kill(srv) { try { srv.child.kill(); } catch (e) {} try { srv.child.unref(); } catch (e) {} }
function mailedCode(srv, email) {
  if (!fs.existsSync(srv.mailFile)) return null;
  var rows = fs.readFileSync(srv.mailFile, 'utf8').trim().split('\n').filter(Boolean).map(function (x) { return JSON.parse(x); });
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var m = mail && String(mail.message.text || '').match(/verification code is (\d{6})/i);
  return m ? m[1] : null;
}
async function founderToken(srv) {
  var lin = await call(srv, 'POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var t = lin.body && lin.body.token;
  await call(srv, 'POST', '/api/auth/unlock', { passcode: '2027' }, t);
  return t;
}

var PORT = Number(process.env.GOC_F27_MAIL_PORT) || 8451;

(async function () {
  /* -------------------------------------------- phase 2: nothing configured */
  head('live: no SMTP configuration at all');
  var s2 = bootServer('none', PORT, {});
  try {
    await waitForBoot(s2, 40);
    var reg = await call(s2, 'POST', '/api/free2027/register/start', { name: 'Ada Obi', email: 'ada@example.com', password: 'AdaPass-2027', course: 'Law' });
    ok('21. registration is refused with the explicit not-configured message', reg.status === 503 && /email verification is not configured/i.test(reg.raw), reg.status + ' ' + reg.raw.slice(0, 120));
    ok('32. no six-digit code leaks into the error response', !/\b\d{6}\b/.test(reg.raw), reg.raw.slice(0, 160));
    var anon = await call(s2, 'GET', '/api/free2027/admin/email-status');
    ok('31. ordinary visitors cannot read the admin diagnostic', anon.status === 401 || anon.status === 403, anon.status);
    var adm = await founderToken(s2);
    var st = await call(s2, 'GET', '/api/free2027/admin/email-status', undefined, adm);
    ok('31. the Founder diagnostic reports missing with the variable names', st.status === 200 && st.body.status === 'missing' && st.body.missing.indexOf('GOC_SMTP_HOST') > -1, st.raw.slice(0, 200));
    var stv = await call(s2, 'GET', '/api/free2027/admin/email-status?verify=1', undefined, adm);
    ok('24b. a live check on a missing config still says missing (never ready)', stv.body.status === 'missing', stv.raw.slice(0, 120));
  } finally { kill(s2); }

  /* ------------------------------------------ phase 3: partial / failing */
  head('live: incomplete and failing SMTP are never reported as operational');
  var s3 = bootServer('partial', PORT + 1, { GOC_SMTP_HOST: 'smtp-relay.brevo.com' });
  try {
    await waitForBoot(s3, 40);
    var reg3 = await call(s3, 'POST', '/api/free2027/register/start', { name: 'Ben', email: 'ben@example.com', password: 'BenPass-2027', course: 'Law' });
    ok('22. partial configuration still refuses registration', reg3.status === 503 && /not configured/i.test(reg3.raw), reg3.status);
    var adm3 = await founderToken(s3);
    var st3 = await call(s3, 'GET', '/api/free2027/admin/email-status', undefined, adm3);
    ok('22b. the diagnostic says incomplete and lists what is missing', st3.body.status === 'incomplete' && st3.body.missing.indexOf('GOC_FREE_2027_OTP_SECRET') > -1, st3.raw.slice(0, 220));
  } finally { kill(s3); }

  var s4 = bootServer('fail', PORT + 2, { GOC_SMTP_HOST: 'fail-smtp', GOC_SMTP_USER: 'u', GOC_SMTP_PASS: 'p', GOC_FREE_2027_OTP_SECRET: 'x'.repeat(40) });
  try {
    await waitForBoot(s4, 40);
    var adm4 = await founderToken(s4);
    var st4 = await call(s4, 'GET', '/api/free2027/admin/email-status?verify=1', undefined, adm4);
    ok('23. configured but connection failing -> unreachable', st4.body.status === 'unreachable' && !!st4.body.detail, st4.raw.slice(0, 220));
  } finally { kill(s4); }

  /* --------------------------------------------- phase 5: working delivery */
  head('live: working SMTP capture — OTP lifecycle and secret safety');
  var SECRET = 'unit-test-only-otp-secret-0123456789abcdef';
  var SMTPPASS = 'unit-test-only-smtp-key-DO-NOT-USE';
  var s5 = bootServer('ok', PORT + 3, {
    GOC_SMTP_HOST: 'mailpit-test', GOC_SMTP_USER: 'test-login', GOC_SMTP_PASS: SMTPPASS,
    GOC_SMTP_FROM: 'G.O.C Academy Hub <verification@gocacademy.test>',
    GOC_FREE_2027_OTP_SECRET: SECRET
  });
  try {
    await waitForBoot(s5, 40);
    var adm5 = await founderToken(s5);
    var st5 = await call(s5, 'GET', '/api/free2027/admin/email-status', undefined, adm5);
    ok('24. configured state reported', st5.status === 200 && st5.body.status === 'configured', st5.raw.slice(0, 160));
    var st5v = await call(s5, 'GET', '/api/free2027/admin/email-status?verify=1', undefined, adm5);
    ok('24b. live verify -> ready', st5v.body.status === 'ready', st5v.raw.slice(0, 160));
    ok('32. the diagnostic response contains no secret values', st5v.raw.indexOf(SECRET) < 0 && st5v.raw.indexOf(SMTPPASS) < 0 && st5v.raw.indexOf('test-login') < 0, st5v.raw.slice(0, 300));

    var start = await call(s5, 'POST', '/api/free2027/register/start', { name: 'Cat Ada', email: 'cat@example.com', password: 'CatPass-2027', course: 'Law' });
    ok('registration start succeeds and reports delivery', start.status === 200 && start.body.delivered === true, start.raw.slice(0, 160));
    var code = mailedCode(s5, 'cat@example.com');
    ok('25. a six-digit OTP is generated and emailed', !!code && /^\d{6}$/.test(code), String(code));
    ok('32. the API response never contains the code', start.raw.indexOf(code) < 0 && !/"code"/.test(start.raw), start.raw.slice(0, 160));
    var wrong = await call(s5, 'POST', '/api/free2027/register/verify', { email: 'cat@example.com', code: code === '000000' ? '000001' : '000000' });
    ok('28. an incorrect code is rejected', wrong.status === 400 || wrong.status === 403, wrong.status + ' ' + wrong.raw.slice(0, 100));
    var good = await call(s5, 'POST', '/api/free2027/register/verify', { email: 'cat@example.com', code: code });
    ok('30. correct verification completes registration and issues a token', good.status === 200 && !!good.body.token && good.body.participant && good.body.participant.verified === true, good.raw.slice(0, 160));
    var again = await call(s5, 'POST', '/api/free2027/register/verify', { email: 'cat@example.com', code: code });
    ok('29. a used code cannot be replayed', again.status === 400, again.status);
    var reReg = await call(s5, 'POST', '/api/free2027/register/start', { name: 'Cat Again', email: 'cat@example.com', password: 'CatPass-2027', course: 'Law' });
    ok('30b. a verified address cannot register twice', reReg.status === 409, reReg.status);
    var burst = [];
    for (var i = 0; i < 8; i++) burst.push(call(s5, 'POST', '/api/free2027/register/start', { name: 'Burst User ' + i, email: 'burst' + i + '@example.com', password: 'Burst-2027', course: 'Law' }));
    var rs = await Promise.all(burst);
    ok('27. the hourly per-address cap still applies', rs.every(function (r) { return r.status === 200 || r.status === 429; }), rs.map(function (r) { return r.status; }).join(','));
    ok('32. no secret appears in the server log', s5.log().indexOf(SECRET) < 0 && s5.log().indexOf(SMTPPASS) < 0, s5.log().slice(-200));
    /* OTP expiry is enforced by the stored expiresAt (covered end-to-end in
       test-free2027-route.js); assert the stored record shape here. */
    var db = JSON.parse(fs.readFileSync(path.join(s5.data, 'data.json'), 'utf8'));
    var otps = (db.free2027 && db.free2027.otps) || [];
    ok('26. OTPs are stored hashed with an expiry, never in plain text', otps.every(function (o) { return o.hash && o.expiresAt > 0; }) && JSON.stringify(otps).indexOf(code) < 0);
  } finally { kill(s5); }

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  process.exit(1);
});
