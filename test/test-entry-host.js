/* test-entry-host.js — which experience a visitor enters is their hostname.
   ----------------------------------------------------------------------------
   There is no website-mode switch any more. One server, one deployment:
   utme.gocacademy.live enters the 2027 Free Tutorial; every other hostname
   (the main domain, an IP, an unknown or spoofed host) enters the original
   G.O.C Academy Hub. The stored `mode` field of older data files is never
   read. Programme AVAILABILITY (the edition's `enabled`, Founder-controlled)
   is a separate thing: while the programme is inactive, BOTH hostnames
   report the original hub and the participant API refuses.

   This suite boots the real server on a scratch data folder and asks it
   questions with different Host headers, exactly as the two public
   addresses (and a few hostile ones) would.

   Run:  node test/test-entry-host.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_ENTRY_PORT) || 8247;
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 220) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-entry-test-'));
var DATA = path.join(SANDBOX, 'data');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
    GOC_APPWRITE_OFF: '1',
    GOC_FREE_2027: '1',
    GOC_FREE_2027_OTP_SECRET: 'local-test-otp-secret-0123456789abcdef',
    GOC_FOUNDER_PW: 'founder2027',
    GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027',
    GOC_DATA_DIR: DATA
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
var serverLog = '';
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function stop() { try { child.kill(); } catch (e) {} try { child.unref(); } catch (e) {} }

/* One request, optionally under a chosen Host (and a forged forwarded host). */
function call(method, urlPath, body, opts) {
  var o = opts || {};
  return new Promise(function (resolve) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json' };
    if (o.host) headers.Host = o.host;
    if (o.fwdHost) headers['X-Forwarded-Host'] = o.fwdHost;
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (o.token) headers.Authorization = 'Bearer ' + o.token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').then(function (h) {
    if (h && h.status === 200) return h;
    if (tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return waitForBoot(tries - 1); });
  });
}

(async function () {
  try {
    var boot = await waitForBoot(40);
    ok('the disposable server boots', boot.status === 200, serverLog.slice(-300));

    head('the hostname chooses the experience');
    var utme = await call('GET', '/api/free2027/config', undefined, { host: 'utme.gocacademy.live' });
    ok('utme.gocacademy.live enters the Free Tutorial', utme.status === 200 && utme.body.on === true && utme.body.mode === 'free2027', utme.raw.slice(0, 160));
    var main = await call('GET', '/api/free2027/config', undefined, { host: 'gocacademy.live' });
    ok('gocacademy.live enters the original hub', main.status === 200 && main.body.mode === 'original', main.raw.slice(0, 160));
    var www = await call('GET', '/api/free2027/config', undefined, { host: 'www.gocacademy.live' });
    ok('www.gocacademy.live enters the original hub', www.body && www.body.mode === 'original');
    var ip = await call('GET', '/api/free2027/config');
    ok('an unnamed host (the server IP) enters the original hub', ip.body && ip.body.mode === 'original');
    var spoof = await call('GET', '/api/free2027/config', undefined, { host: 'utme.gocacademy.live.evil.example' });
    ok('a look-alike host does NOT enter the Free Tutorial', spoof.body && spoof.body.mode === 'original', spoof.raw.slice(0, 160));
    var forged = await call('GET', '/api/free2027/config', undefined, { fwdHost: 'utme.gocacademy.live' });
    ok('a forged X-Forwarded-Host is never trusted', forged.body && forged.body.mode === 'original');
    var ported = await call('GET', '/api/free2027/config', undefined, { host: 'utme.gocacademy.live:443' });
    ok('a port suffix does not break the match', ported.body && ported.body.mode === 'free2027');

    head('the health check agrees, per hostname');
    var hUtme = await call('GET', '/api/health', undefined, { host: 'utme.gocacademy.live' });
    ok('health on the UTME host: programme on, Free entry', hUtme.body.free2027.on === true && hUtme.body.free2027.mode === 'free2027');
    var hMain = await call('GET', '/api/health', undefined, { host: 'gocacademy.live' });
    ok('health on the main host: programme on, original entry', hMain.body.free2027.on === true && hMain.body.free2027.mode === 'original');

    head('the same application answers on both hostnames');
    var shellUtme = await call('GET', '/', undefined, { host: 'utme.gocacademy.live' });
    ok('the UTME host serves the app shell', shellUtme.status === 200 && /G\.O\.C/.test(shellUtme.raw));
    var shellMain = await call('GET', '/', undefined, { host: 'gocacademy.live' });
    ok('the main host serves the same app shell', shellMain.status === 200 && shellUtme.raw === shellMain.raw);

    head('the old switch is gone, for everyone');
    var login = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
    var tok = login.body && login.body.token;
    ok('the Founder signs in as before', !!tok, login.raw.slice(0, 160));
    await call('POST', '/api/auth/unlock', { passcode: '2027' }, { token: tok });
    ok('PUT /api/free2027/admin/mode no longer exists (404, not a refusal)',
      (await call('PUT', '/api/free2027/admin/mode', { mode: 'original', confirm: true }, { token: tok })).status === 404);

    head('programme availability is separate from the hostname, and survives');
    var before = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'));
    var off = await call('PUT', '/api/free2027/admin/edition', { enabled: false }, { token: tok });
    ok('the Founder deactivates the programme', off.status === 200 && off.body.enabled === false, off.raw.slice(0, 160));
    var cfgOff = await call('GET', '/api/free2027/config', undefined, { host: 'utme.gocacademy.live' });
    ok('while inactive, even the UTME hostname reports the programme off',
      cfgOff.body.on === false && cfgOff.body.mode === 'original', cfgOff.raw.slice(0, 160));
    var loginOff = await call('POST', '/api/free2027/login', { email: 'nobody@example.com', password: 'Whatever-2027' }, { host: 'utme.gocacademy.live' });
    ok('and candidates are refused while inactive', loginOff.status === 404, loginOff.raw.slice(0, 120));
    var on = await call('PUT', '/api/free2027/admin/edition', { enabled: true }, { token: tok });
    ok('the Founder reactivates the programme', on.status === 200 && on.body.enabled === true);
    var cfgOn = await call('GET', '/api/free2027/config', undefined, { host: 'utme.gocacademy.live' });
    ok('the UTME entry is the Free Tutorial again, with no mode switch anywhere',
      cfgOn.body.on === true && cfgOn.body.mode === 'free2027');
    var loginOn = await call('POST', '/api/free2027/login', { email: 'nobody@example.com', password: 'Whatever-2027' }, { host: 'utme.gocacademy.live' });
    ok('while active, an unknown login is a credential refusal, not an availability refusal',
      loginOn.status !== 404 && loginOn.status !== 0, loginOn.raw.slice(0, 120));
    var after = JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8'));
    var sessBefore = ((before.free2027 || {}).sessions || [])[0] || {};
    var sessAfter = (after.free2027.sessions || [])[0] || {};
    ok('the toggle touched no record (same participants, activities, attempts — only the audit trail grew, as designed)',
      (sessAfter.participants || []).length === (sessBefore.participants || []).length &&
      (sessAfter.activities || []).length === (sessBefore.activities || []).length &&
      (sessAfter.attempts || []).length === (sessBefore.attempts || []).length &&
      JSON.stringify(after.free2027.questionBanks || {}) === JSON.stringify((before.free2027 || {}).questionBanks || {}) &&
      after.free2027.enabled === true);
  } finally {
    stop();
  }
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { stop(); console.log('SUITE ERROR ' + (e && e.stack || e)); process.exit(1); });
