/* test-privacy-consent.js — privacy consent and the visit counter gate.
   Verifies the audit fixes:
   · the cookie banner is gone and the privacy policy is still reachable;
   · the registration checkbox starts unticked and is required by the page;
   · POST /api/students refuses a registration without an explicit acceptance
     and records { at, version } when one is given (read back on /api/me);
   · the demo driver mirrors both rules;
   · the visitor beacon only sends after consent is recorded on the device.
   Boots a throwaway server like the other route suites. No dependencies.
   node test/test-privacy-consent.js */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var core = require(path.join(APP, 'js', 'goc-core.js'));
var html = read('index.html'), app = read('js/app.js');
var SIGNUP = 'GOC2027';
var PORT = Number(process.env.GOC_TEST_PORT) || 8177;

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ------------------------------------------------ markup and page logic */
head('The page: no cookie banner, an explicit consent box, a gated counter');
ok('the cookie consent banner is gone', html.indexOf('cookieBanner') < 0 && html.indexOf('cookieAccept') < 0 && html.indexOf('goc-cookie-consent') < 0);
ok('the privacy policy screen is still there and linked from sign-up', /id="legal"/.test(html) && /onclick="go\('legal'\)"/.test(html));
ok('the policy names its version and the core constant agrees', html.indexOf('Policy version ' + core.PRIVACY_POLICY_VERSION) > -1);
ok('the registration checkbox exists, is named, and starts UNTICKED', /id="signConsent"/.test(html) && !/id="signConsent"[^>]*checked/.test(html));
ok('signupSubmit refuses to call the API until the box is ticked',
  app.indexOf('signConsent') > -1 && /if\(!consentBox \|\| !consentBox\.checked\)/.test(app));
ok('the registration payload carries the acceptance and the policy version',
  /privacyConsent: \{ accepted: true, version: GOC\.core\.PRIVACY_POLICY_VERSION \}/.test(app));
ok('the visitor beacon checks the consent marker before sending',
  /function send\(\)\{[\s\S]{0,400}if\(!privacyConsentGiven\(\)\) return;/.test(app));
ok('a stored server consent re-enables the counter on a new device',
  /me\.privacyConsent && me\.privacyConsent\.at\) notePrivacyConsent/.test(app));
ok('the analytics dashboard no longer claims a cookie gate', app.indexOf('accepted cookies') < 0 && app.indexOf('accepted the privacy policy') > -1);
ok('the policy discloses the visit counter and its consent gate',
  /only after the privacy policy has been accepted on the device/.test(html));
ok('the policy discloses educational, operational and publicity purposes',
  /educational and operational purposes/.test(html) && /Publicity:/.test(html));

/* ------------------------------------------------ demo driver */
head('The demo driver mirrors the server rule');
var sandbox = {
  console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
var mock = vm.runInContext('GOC.api._drivers', ctx).mock;
function rejects(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }
var body = { name: 'Consent Test', password: 'secret123', goal: 'JAMB / UTME 2027',
  subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };

/* ------------------------------------------------ throwaway server */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-consent-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

function call(method, url, payload, token) {
  return new Promise(function (resolve, reject) {
    var data = payload === undefined ? null : JSON.stringify(payload);
    var headers = { 'Accept': 'application/json' };
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject);
    if (data) req.write(data);
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
    PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
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

(async function main() {
  /* Demo driver first — no server needed. */
  var m = await rejects(mock.createStudent(body));
  ok('demo: no acceptance, no account', m && /Privacy Policy/.test(m), m);
  m = await rejects(mock.createStudent(Object.assign({}, body, { privacyConsent: { accepted: false } })));
  ok('demo: an explicit refusal is refused too', m && /Privacy Policy/.test(m), m);
  var r = await mock.createStudent(Object.assign({}, body, { privacyConsent: { accepted: true } }));
  ok('demo: an accepted registration goes to pending', r && r.pending === true && r.student && r.student.id, JSON.stringify(r));

  await waitForBoot(40);
  head('The server refuses a registration without consent');
  var no = await call('POST', '/api/students', body);
  ok('no acceptance: 400 with a clear reason', no.status === 400 && /Privacy Policy/.test(no.body.error || ''), no.status + ' ' + no.raw);
  ok('and no account was created', !(no.body && no.body.student), no.raw);
  var falseConsent = await call('POST', '/api/students', Object.assign({}, body, { privacyConsent: { accepted: false } }));
  ok('accepted:false is refused as well', falseConsent.status === 400, falseConsent.status + ' ' + falseConsent.raw);

  head('With consent, the acceptance is recorded and follows the student');
  var a = await activeStudent(call, Object.assign({}, body, { email: 'consent@example.com', phone: '08000000111' }));
  ok('the helper signs up, approves and logs in', !!a.token, JSON.stringify(a.signup && a.signup.body));
  var me = await call('GET', '/api/me', undefined, a.token);
  ok('/api/me carries the consent record', me.status === 200 && me.body.privacyConsent && !!me.body.privacyConsent.at, me.raw);
  ok('the record names the server\'s own policy version', me.body.privacyConsent.version === core.PRIVACY_POLICY_VERSION, me.raw);
  ok('the timestamp is a real ISO date', !isNaN(Date.parse(me.body.privacyConsent.at)), me.raw);
  /* The stored record lives in the data blob, keyed by Scholar ID. */
  var db = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8'));
  ok('the acceptance is stored against the Scholar ID', db.consentLog && db.consentLog[a.id] && db.consentLog[a.id].version === core.PRIVACY_POLICY_VERSION);
  ok('no plaintext password rides along in the consent log', JSON.stringify(db.consentLog).indexOf('secret123') < 0);

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  stop();
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  console.log(serverLog);
  stop();
  process.exit(1);
});