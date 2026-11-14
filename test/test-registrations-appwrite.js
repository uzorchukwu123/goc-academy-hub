/* test-registrations-appwrite.js — Stage B in Appwrite mode: approval must
   create exactly ONE Appwrite Auth account and ONE students document, and a
   submission must create neither. Boots the real server against the
   in-memory Appwrite stand-in (test/appwrite-stub), with the Auth user
   creations logged to a file by the stand-in.
   node test/test-registrations-appwrite.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_REG_AW_PORT) || 8192;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-reg-aw-'));
var DATA_DIR = path.join(TMP, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
var USERS_LOG = path.join(TMP, 'users.jsonl');
var SEED = path.join(TMP, 'seed.json');
fs.writeFileSync(SEED, JSON.stringify({ files: [], docs: [] }));
fs.writeFileSync(path.join(DATA_DIR, 'data.json'), JSON.stringify({
  questions: [], tutors: [], students: [], attempts: [], practiceRuns: {}, settings: {},
  staff: [{ id: 'GOC-A-001', name: 'Founder', title: 'Founder' }]
}));
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
var child = null, log = '';
function boot() {
  log = '';
  child = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), GOC_DATA_DIR: DATA_DIR, STUB_SEED: SEED, STUB_USERS_LOG: USERS_LOG,
      APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub', APPWRITE_API_KEY: 'stubkey',
      GOC_FOUNDER_PW: 'founder2027', GOC_PASSCODE: '2027',
      GOC_PUBLIC_URL: 'https://hub.example.ng', GOC_REMINDER_DRY_RUN: '1',
      NODE_OPTIONS: '-r ' + path.join(__dirname, 'appwrite-stub', 'hook.js')
    }), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', function (d) { log += d; }); child.stderr.on('data', function (d) { log += d; });
  return (async function () { for (var n = 0; n < 80 && log.indexOf('is running') < 0; n++) await wait(150); await wait(600); })();
}
function halt() { return new Promise(function (r) { if (!child) return r(); child.once('exit', function () { child = null; r(); }); child.kill(); }); }
function call(method, url, body, token) {
  return new Promise(function (resolve) {
    var data = body ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    var r = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: h }, function (resp) {
      var raw = ''; resp.on('data', function (c) { raw += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: resp.statusCode, body: j, raw: raw }); });
    });
    r.on('error', function (e) { resolve({ status: 0, body: null, raw: String(e) }); });
    if (data) r.write(data); r.end();
  });
}
function readDb() { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8')); }
function userOps() {
  try { return fs.readFileSync(USERS_LOG, 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }); } catch (e) { return []; }
}
function outbox() {
  try { return fs.readFileSync(path.join(DATA_DIR, 'reminders-outbox.jsonl'), 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }); } catch (e) { return []; }
}
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];

(async function main() {
  await boot();
  ok('the server starts in Appwrite-stub mode', log.indexOf('is running') > -1, log.slice(-300));
  var founder = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, founder);

  head('submission creates no Auth account and no student document');
  var code = (await call('POST', '/api/registrations/codes', { label: 'AW cohort', maxUses: 3 }, founder)).body.code;
  ok('the Founder creates a code', /^GOC-REG-/.test(code || ''));
  var sub = await call('POST', '/api/registrations', { code: code, name: 'Funmi Applicant', email: 'funmi@example.com', phone: '08055556666', password: 'funmi-secret-1', goal: 'JAMB / UTME 2027', subjects: COMBO, privacyConsent: { accepted: true } });
  ok('the application submits', sub.status === 200, sub.raw);
  ok('no Auth user was created', userOps().filter(function (u) { return u.op === 'create'; }).length === 0);
  var roster0 = await call('GET', '/api/students', null, founder);
  ok('no student document exists', roster0.status === 200 && roster0.body.length === 0, roster0.raw.slice(0, 160));
  var app = readDb().registrationApplications[0];
  ok('the application holds no Scholar ID and no Auth id', !!app && app.scholarId === null && app.appwriteUserId === null);

  head('approval creates exactly one of each');
  var ap = await call('POST', '/api/registrations/applications/' + app.id + '/approve', {}, founder);
  ok('approval succeeds', ap.status === 200 && /^GOC-S-/.test(ap.body.application.scholarId || ''), ap.raw.slice(0, 220));
  var creates = userOps().filter(function (u) { return u.op === 'create'; });
  ok('exactly one Auth account was created, for the Scholar ID email', creates.length === 1 && creates[0].email === ap.body.application.scholarId.toLowerCase() + '@gocacademy.com', JSON.stringify(creates));
  var roster1 = await call('GET', '/api/students', null, founder);
  ok('exactly one student document exists', roster1.status === 200 && roster1.body.length === 1 && roster1.body[0].id === ap.body.application.scholarId, roster1.raw.slice(0, 200));
  ok('nothing leaked into the local student cache', readDb().students.length === 0);
  ok('a duplicate approve is refused and creates nothing more', (await call('POST', '/api/registrations/applications/' + app.id + '/approve', {}, founder)).status === 409 && userOps().filter(function (u) { return u.op === 'create'; }).length === 1 && (await call('GET', '/api/students', null, founder)).body.length === 1);

  head('password setup talks to the Auth account');
  var scholarId = ap.body.application.scholarId;
  ok('sign-in is blocked before setup', (await call('POST', '/api/auth/login', { id: scholarId, password: 'funmi-secret-1' })).status === 403);
  var mail = outbox().filter(function (m) { return m.to === 'funmi@example.com'; }).pop();
  var token = mail && (/\/setup\/([A-Za-z0-9_-]+)/.exec(mail.text || '') || [])[1];
  ok('the setup link was emailed to the applicant', !!token);
  var setup = await call('POST', '/api/registrations/setup', { token: token, password: 'funmi-new-pass-1' });
  ok('setup completes', setup.status === 200 && setup.body.scholarId === scholarId, setup.raw);
  ok('the Auth password was updated exactly once', userOps().filter(function (u) { return u.op === 'updatePassword'; }).length === 1);
  ok('the student signs in after setup (stand-in Auth accepts the session)', (await call('POST', '/api/auth/login', { id: scholarId, password: 'funmi-new-pass-1' })).status === 200);
  ok('the setup link cannot be reused', (await call('POST', '/api/registrations/setup', { token: token, password: 'funmi-new-pass-1' })).status === 400);

  /* Note: the stand-in's Auth accepts any password (its Account stub always
     returns a session), so password correctness in Appwrite mode is asserted
     by the local-mode suite; here we prove creation counts and token flow. */
  await halt();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(async function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(log.slice(-1000)); await halt(); process.exit(1); });
