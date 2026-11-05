/* test-free2027-founder.js — PR #9 audit: the Founder entrance and the Admin
   Console authentication chain, all through the REAL backend routes:
     contact form (normal + founder phrase) -> staff login -> console passcode
   plus proof that the old hidden homepage entrance is gone.
   node test/test-free2027-founder.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_FOUNDER_PORT) || 8491;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 280) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-founder-'));
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
    GOC_TEST_MAIL_FILE: path.join(DATA, 'mail.jsonl'),
    GOC_FREE_2027_OTP_SECRET: 'founder-test-otp-secret-0123456789abcdef',
    GOC_SMTP_HOST: 'mailpit-test',
    GOC_FOUNDER_PW: 'founder2027',
    GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027',
    GOC_DATA_DIR: DATA,
    GOC_FREE_2027: '1'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
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
    if (h.status === 200 || tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return waitForBoot(tries - 1); });
  });
}

(async function () {
  var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  var uiSrc = fs.readFileSync(path.join(APP, 'js', 'free2027-ui.js'), 'utf8');
  await waitForBoot(40);

  head('the old hidden entrance is completely gone');
  ok('the fourth statistics card is an ordinary card (no gate attribute)', /<div class="lp-stat" id="lpStat4"><b>4<\/b><span>Science subjects<\/span><\/div>/.test(html) && !/data-f27-gate/.test(html), 'lpStat4 markup');
  ok('no entrance comment remains in the homepage', !/hidden administrator entrance/i.test(html));
  ok('no gate listener/handler remains in the edition script', !/data-f27-gate|freeGateClick|wireLanding/.test(uiSrc));
  ok('the card keeps its normal styling hook', /\.lp-stat\{/.test(fs.readFileSync(path.join(APP, 'css', 'styles.css'), 'utf8')));

  head('contact form: ordinary messages and the Founder phrase (real routes)');
  var normal = await call('POST', '/api/contact', { name: 'Visitor', email: 'visitor@example.com', message: 'Is the UTME bootcamp free?' });
  ok('normal contact message is accepted', normal.status === 200 && normal.body.ok === true && !normal.body.founderRequest, normal.status + ' ' + normal.raw.slice(0, 100));
  var phraseWrongEmail = await call('POST', '/api/contact', { name: 'Not Founder', email: 'stranger@example.com', message: 'GOC FOUNDER' });
  ok('Founder phrase with an incorrect email is rejected', phraseWrongEmail.status === 403 && !phraseWrongEmail.body.founderRequest, phraseWrongEmail.status);
  ok('the rejection does not reveal the Founder address', !/goc-a-001/.test(phraseWrongEmail.raw), phraseWrongEmail.raw.slice(0, 120));
  var wrongPhraseRightEmail = await call('POST', '/api/contact', { name: 'Ernest', email: 'goc-a-001@gocacademy.com', message: 'goc founder please' });
  ok('an incorrect phrase with the Founder email is just a normal message (no founder route)', wrongPhraseRightEmail.status === 200 && wrongPhraseRightEmail.body.ok === true && !wrongPhraseRightEmail.body.founderRequest, wrongPhraseRightEmail.status);
  var bothWrong = await call('POST', '/api/contact', { name: 'X', email: 'x@example.com', message: 'hello there' });
  ok('incorrect phrase and incorrect email: accepted as a normal message only', bothWrong.status === 200 && !bothWrong.body.founderRequest);
  var missingName = await call('POST', '/api/contact', { name: '', email: 'goc-a-001@gocacademy.com', message: 'GOC FOUNDER' });
  ok('missing name is rejected', missingName.status === 400, missingName.status);
  var missingEmail = await call('POST', '/api/contact', { name: 'Ernest', email: '', message: 'GOC FOUNDER' });
  ok('missing email is rejected', missingEmail.status === 400, missingEmail.status);
  var real = await call('POST', '/api/contact', { name: 'Ernest Uzorchukwu', email: 'goc-a-001@gocacademy.com', message: 'GOC FOUNDER' });
  ok('exact phrase + registered Founder email grants the founder ROUTE only', real.status === 200 && real.body.founderRequest === true && real.body.next === 'admin-gate', real.raw.slice(0, 160));
  ok('the founder route issues no token and leaks no credential', !real.body.token && !/founder2027|2027\b/.test(real.raw.replace(/"next"/, '')), real.raw.slice(0, 160));
  /* rate limit: 3 founder-phrase attempts per window from this IP */
  var r1 = await call('POST', '/api/contact', { name: 'A', email: 'a@example.com', message: 'GOC FOUNDER' });
  var r2 = await call('POST', '/api/contact', { name: 'B', email: 'b@example.com', message: 'GOC FOUNDER' });
  var r3 = await call('POST', '/api/contact', { name: 'C', email: 'c@example.com', message: 'GOC FOUNDER' });
  ok('repeated invalid founder attempts are rate limited', [r1.status, r2.status, r3.status].indexOf(429) > -1, [r1.status, r2.status, r3.status].join(','));

  head('the Admin Console chain stays separate and intact (real routes)');
  var noAuth = await call('GET', '/api/free2027/admin/participants');
  ok('a protected admin API without any authentication is rejected', noAuth.status === 401 || noAuth.status === 403, noAuth.status);
  var badPw = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'wrong-password-1' });
  ok('Founder staff login with an incorrect password is rejected', badPw.status === 401 || badPw.status === 403, badPw.status);
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  ok('Founder staff login with the correct password succeeds', lin.status === 200 && !!lin.body.token, lin.status);
  var adm = lin.body.token;
  var locked = await call('GET', '/api/free2027/admin/participants', undefined, adm);
  ok('without the console passcode the console stays locked', locked.status === 403 && /passcode/i.test(locked.raw), locked.status);
  var badCode = await call('POST', '/api/auth/unlock', { passcode: '9999' }, adm);
  ok('an incorrect console passcode is rejected', badCode.status === 403, badCode.status);
  var unlock = await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  ok('the correct passcode unlocks the console', unlock.status === 200, unlock.status);
  var open = await call('GET', '/api/free2027/admin/participants', undefined, adm);
  ok('correct Founder credentials + passcode open the console', open.status === 200, open.status);
  var mode = await call('PUT', '/api/free2027/admin/mode', { mode: 'original', confirm: true }, adm);
  ok('the Founder can still use the Website Mode switch', mode.status === 200, mode.status + ' ' + mode.raw.slice(0, 100));
  var acad = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  var acadT = acad.body && acad.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, acadT);
  var acadParticipants = await call('GET', '/api/free2027/admin/participants', undefined, acadT);
  ok('Academic Director permissions are preserved (roster readable)', acadParticipants.status === 200, acadParticipants.status);
  var acadMode = await call('PUT', '/api/free2027/admin/mode', { mode: 'free2027', confirm: true }, acadT);
  ok('the Academic Director still cannot flip the Website Mode (Founder-only)', acadMode.status === 403, acadMode.status);

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  try { child.kill(); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  try { child.kill(); } catch (e2) {}
  process.exit(1);
});
