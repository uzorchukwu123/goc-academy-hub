/* test-no-open-student.js — Stage A: the Open Student tier is gone.
   One student identity (G.O.C STUDENT) with the full entitlement set.
   Proves, over the pure rules and real HTTP (Stage B registration flow):
     · the core no longer exports tier machinery (TIERS / cleanTier);
     · every feature is available to every student and limits are the
       former full (GOC) limits;
     · an approved registration produces a student record with NO tier key;
     · /api/me carries features/limits and no tier;
     · both tier-switch routes are gone (404);
     · a legacy record carrying a stored tier:'open' value loads and
       works with full access (the stored value is simply ignored).
   node test/test-no-open-student.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_NOOPEN_PORT) || 8188;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 180) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------- pure rules */
head('the core has one student access model');
ok('no TIERS table is exported', core.TIERS === undefined);
ok('no cleanTier is exported', core.cleanTier === undefined);
ok('no tier message helpers are exported', core.TIER_LOCK_MESSAGE === undefined && core.TIER_UPGRADE_MESSAGE === undefined);
ok('every known feature is available to every student',
  ['practice', 'notes', 'pastQuestions', 'resourceView', 'resourceDownload', 'videos',
   'classRecordings', 'liveClassJoin', 'streakFreezes', 'classNotices', 'askTutor',
   'webTestObjective', 'webTestTheory', 'jambMock', 'bookmarks', 'spacedReview', 'fullRecord']
    .every(function (f) { return core.canUse(f) === true; }));
ok('an unknown feature is refused (fail closed)', core.canUse('noSuchFeature') === false);
var lim = core.studentLimits();
ok('limits are the former full set (no practice/note/review/bookmark caps, all past years)',
  lim.practicePerDay === null && lim.notesPerSubject === null && lim.reviewsPerDay === null &&
  lim.bookmarks === null && lim.pastYears === 'all', JSON.stringify(lim));
ok('limits come back as a fresh copy', (function () { lim.bookmarks = 3; return core.studentLimits().bookmarks === null; })());
ok('studentFeatures is all-true', Object.keys(core.studentFeatures()).every(function (k) { return core.studentFeatures()[k] === true; }));
ok('no students.tier capability exists', core.allCapabilities().indexOf('students.tier') === -1);
ok('the tier routes are not audited actions', core.auditActionFor('PUT', '/api/students/GOC-S-1/tier', { tier: 'goc' }) === null &&
  core.auditActionFor('PUT', '/api/admin/cohorts/c1/tier', { tier: 'goc' }) === null);

/* ------------------------------------------------------------ the server */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-noopen-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var serverLog = '', child = null;
function boot() {
  serverLog = '';
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_PUBLIC_URL: 'https://hub.example.ng', GOC_REMINDER_DRY_RUN: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', function (c) { serverLog += c; });
  child.stderr.on('data', function (c) { serverLog += c; });
}
function halt() { return new Promise(function (r) { if (!child) return r(); try { child.once('exit', function () { r(); }); child.kill(); setTimeout(r, 1500); } catch (e) { r(); } }); }
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body === undefined || body === null ? null : JSON.stringify(body), headers = { Accept: 'application/json' };
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
function readDb() { return JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8')); }
function setupTokenFor(email) {
  try {
    var lines = fs.readFileSync(path.join(SANDBOX, 'server', 'reminders-outbox.jsonl'), 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); });
    var m = lines.filter(function (x) { return x.to === email; }).pop();
    var match = m && /\/setup\/([A-Za-z0-9_-]+)/.exec(m.text || '');
    return match ? match[1] : null;
  } catch (e) { return null; }
}
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];

boot();
waitForBoot(30).then(async function (h) {
  head('registration stores no tier; approval creates the one student kind');
  ok('server is up', h.status === 200, h.raw);
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var code = (await call('POST', '/api/registrations/codes', { label: 'Tier check', maxUses: 5 }, adm)).body.code;
  var reg = await call('POST', '/api/registrations', { code: code, name: 'New Student', password: 'secret123',
    email: 'new.student@example.com', phone: '08022220000', goal: 'JAMB / UTME 2027', subjects: COMBO,
    privacyConsent: { accepted: true } });
  ok('the application is received', reg.status === 200 && reg.body.received === true, reg.raw);
  var db0 = readDb();
  var app = db0.registrationApplications[0];
  ok('no student record and no tier anywhere yet', db0.students.length === 0 && !/"tier"/.test(JSON.stringify(app)), JSON.stringify(app).slice(0, 160));
  var ap = await call('POST', '/api/registrations/applications/' + app.id + '/approve', null, adm);
  ok('the founder approves', ap.status === 200, ap.raw.slice(0, 160));
  var sid = ap.body.application.scholarId;
  var stored = readDb().students.find(function (s) { return s.id === sid; });
  ok('the stored student record carries no tier key', !!stored && !('tier' in stored) && stored.active === true, stored && JSON.stringify(Object.keys(stored)));
  var early = await call('POST', '/api/auth/login', { id: sid, password: 'secret123' });
  ok('before password setup, sign-in is refused (no tier involvement)', early.status === 403 && /Set your password/.test(early.body.error || ''), early.raw.slice(0, 160));
  var token = setupTokenFor('new.student@example.com');
  ok('the setup link was emailed', !!token);
  ok('password setup completes', (await call('POST', '/api/registrations/setup', { token: token, password: 'secret123' })).status === 200);
  var login = await call('POST', '/api/auth/login', { id: sid, password: 'secret123' });
  ok('the approved student signs in', login.status === 200 && !!login.body.token, login.raw.slice(0, 160));
  var tok = login.body.token;
  var me = await call('GET', '/api/me', null, tok);
  ok('/api/me answers with no tier anywhere', me.status === 200 && !/"tier"/.test(me.raw), me.raw.slice(0, 200));
  var feats = (me.body && (me.body.features || (me.body.student && me.body.student.features))) || {};
  var lims = (me.body && (me.body.limits || (me.body.student && me.body.student.limits))) || {};
  ok('/api/me carries the full feature set', feats.askTutor === true && feats.webTestObjective === true && feats.streakFreezes === true, JSON.stringify(feats).slice(0, 200));
  ok('/api/me carries the full limits', lims.pastYears === 'all' && lims.bookmarks === null, JSON.stringify(lims).slice(0, 200));
  var notices = await call('GET', '/api/me/notices', null, tok);
  ok('class notices are readable (not locked)', notices.status === 200 && notices.body.locked === false, notices.raw.slice(0, 160));
  var bcs = await call('GET', '/api/me/broadcasts', null, tok);
  ok('broadcasts are readable (not locked)', bcs.status === 200 && bcs.body.locked === false, bcs.raw.slice(0, 160));

  head('the tier routes are gone');
  ok('PUT /api/students/:id/tier is 404', (await call('PUT', '/api/students/' + sid + '/tier', { tier: 'open' }, adm)).status === 404);
  ok('PUT /api/admin/cohorts/:id/tier is 404', (await call('PUT', '/api/admin/cohorts/c1/tier', { tier: 'open' }, adm)).status === 404);
  var after = readDb().students.find(function (s) { return s.id === sid; });
  ok('the 404s changed nothing (still no tier stored)', !!after && !('tier' in after));

  head('a legacy record with a stored tier value loads with full access');
  await halt();
  var db = readDb();
  var legacy = db.students.find(function (s) { return s.id === sid; });
  legacy.tier = 'open'; legacy.tierChangedBy = 'GOC-A-001'; legacy.tierChangedAt = '2026-01-01T00:00:00.000Z';
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db));
  boot();
  var h2 = await waitForBoot(30);
  ok('server reboots with the legacy record', h2.status === 200, h2.raw);
  var login2 = await call('POST', '/api/auth/login', { id: sid, password: 'secret123' });
  ok('the legacy student still signs in', login2.status === 200 && !!login2.body.token, login2.raw.slice(0, 160));
  var me2 = await call('GET', '/api/me', null, login2.body.token);
  var feats2 = (me2.body && (me2.body.features || (me2.body.student && me2.body.student.features))) || {};
  ok('the stored open tier is ignored: full features', me2.status === 200 && feats2.askTutor === true && feats2.webTestObjective === true && feats2.classNotices === true, me2.raw.slice(0, 240));
  var notices2 = await call('GET', '/api/me/notices', null, login2.body.token);
  ok('the legacy student reads notices unlocked', notices2.status === 200 && notices2.body.locked === false, notices2.raw.slice(0, 160));

  await halt();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}).catch(async function (e) {
  console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-800));
  await halt();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (er) {}
  process.exit(1);
});
