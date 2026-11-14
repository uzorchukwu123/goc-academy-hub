/* test-registrations-route.js — Stage B: registration codes + administrative
   approval over real HTTP. Lifecycle: CODE → APPLICATION → REVIEW → APPROVAL
   → ACCOUNT CREATION → PASSWORD SETUP → G.O.C STUDENT ACCESS.
   Boots with GOC_REMINDER_DRY_RUN=1 so the setup email lands in
   reminders-outbox.jsonl, exactly as the mailer would send it.
   node test/test-registrations-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_REG_PORT) || 8191;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-reg-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_PUBLIC_URL: 'https://hub.example.ng', GOC_REMINDER_DRY_RUN: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', function (c) { serverLog += c; }); child.stderr.on('data', function (c) { serverLog += c; });
function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
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
function outbox() {
  try { return fs.readFileSync(path.join(SANDBOX, 'server', 'reminders-outbox.jsonl'), 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }); }
  catch (e) { return []; }
}
function setupTokenFor(email) {
  var m = outbox().filter(function (x) { return x.to === email; }).pop();
  if (!m) return null;
  var match = /\/setup\/([A-Za-z0-9_-]+)/.exec(m.text || '');
  return match ? match[1] : null;
}
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
function applyBody(code, email) {
  return { code: code, name: 'Adaeze Applicant', email: email, phone: '08033334444', password: 'applicant-secret-1', goal: 'JAMB / UTME 2027', subjects: COMBO, privacyConsent: { accepted: true } };
}
function hashPw(plain) {
  var salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(plain, salt, 64).toString('hex');
}

var founder, finance, affairs, director;
waitForBoot(40).then(async function (h) {
  head('setup: founder, finance, student affairs, academic director');
  ok('server is up', h.status === 200, h.raw);
  founder = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, founder);
  director = (await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, director);
  async function manager(name, role, id) {
    await call('POST', '/api/managers', { name: name, role: role, password: 'starter123', passcode: '4821' }, founder);
    var tok = (await call('POST', '/api/auth/login', { id: id, password: 'starter123' })).body.token;
    await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'manager-secret-1' }, tok);
    await call('POST', '/api/auth/unlock', { passcode: '4821' }, tok);
    return tok;
  }
  finance = await manager('Femi Finance', 'finance', 'GOC-A-003');
  affairs = await manager('Sade Affairs', 'student-affairs', 'GOC-A-004');
  var studentsBefore = readDb().students.length;

  head('codes: created by Finance and the Founder, stored hashed, shown once');
  var c1 = await call('POST', '/api/registrations/codes', { label: 'Lagos cohort', maxUses: 2 }, finance);
  ok('Finance creates a code', c1.status === 200 && /^GOC-REG-[A-Z2-9]{6}-[A-Z2-9]{6}$/.test(c1.body.code || ''), c1.raw);
  var CODE1 = c1.body.code;
  ok('the creation reply carries the code once, plus a hint-only public view', !!c1.body.registrationCode && c1.body.registrationCode.hint === CODE1.slice(-4) && JSON.stringify(c1.body.registrationCode).indexOf(CODE1) === -1, c1.raw);
  var rawDb = fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8');
  ok('the plaintext code is nowhere in the data file (hash at rest only)', rawDb.indexOf(CODE1) === -1 && /"hash": "[0-9a-f]{64}"/.test(rawDb));
  ok('the Academic Director cannot create codes', (await call('POST', '/api/registrations/codes', { label: 'x', maxUses: 1 }, director)).status === 403);
  ok('Student Affairs cannot create codes', (await call('POST', '/api/registrations/codes', { label: 'x', maxUses: 1 }, affairs)).status === 403);
  ok('no session cannot create codes', [401, 403].indexOf((await call('POST', '/api/registrations/codes', { label: 'x', maxUses: 1 })).status) > -1);
  ok('no session cannot list codes', [401, 403].indexOf((await call('GET', '/api/registrations/codes')).status) > -1);
  var list1 = await call('GET', '/api/registrations/codes', null, finance);
  ok('the listing shows label, hint and status — never the code or its hash', list1.status === 200 && list1.body.codes.length === 1 && list1.body.codes[0].status === 'active' && list1.raw.indexOf(CODE1) === -1 && !/"hash"/.test(list1.raw), list1.raw);
  var cBad = await call('POST', '/api/registrations/codes', { label: '', maxUses: 1 }, finance);
  ok('a label is required', cBad.status === 400);
  var cBad2 = await call('POST', '/api/registrations/codes', { label: 'x', maxUses: 0 }, finance);
  ok('maxUses must be at least 1', cBad2.status === 400);

  head('validate-code answers generically');
  ok('a wrong code is simply not ok', (await call('POST', '/api/registrations/validate-code', { code: 'GOC-REG-AAAAAA-AAAAAA' })).body.ok === false);
  ok('garbage is simply not ok', (await call('POST', '/api/registrations/validate-code', { code: 'hello' })).body.ok === false);
  ok('the real code is ok, typed loosely', (await call('POST', '/api/registrations/validate-code', { code: CODE1.toLowerCase().replace(/-/g, ' ') })).body.ok === true);

  head('submission creates an application — and nothing else');
  var badSubmit = await call('POST', '/api/registrations', applyBody('GOC-REG-AAAAAA-AAAAAA', 'adaeze@example.com'));
  ok('an invalid code is rejected at submission', badSubmit.status === 400 && /not valid/.test(badSubmit.body.error || ''), badSubmit.raw);
  var noConsent = await call('POST', '/api/registrations', Object.assign(applyBody(CODE1, 'adaeze@example.com'), { privacyConsent: { accepted: false } }));
  ok('no consent, no application', noConsent.status === 400);
  var sub = await call('POST', '/api/registrations', applyBody(CODE1, 'adaeze@example.com'));
  ok('a valid code submits', sub.status === 200 && sub.body.received === true, sub.raw);
  var db1 = readDb();
  var app1 = db1.registrationApplications[0];
  ok('the application is pending with no Scholar ID and no session issued', !!app1 && app1.status === 'pending' && app1.scholarId === null && !sub.body.token && !sub.body.student, JSON.stringify(app1 && app1.status));
  ok('only a scrypt hash of the password is stored', /^scrypt\$/.test(app1.pwHash || '') && fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8').indexOf('applicant-secret-1') === -1);
  ok('NO student record was created', db1.students.length === studentsBefore);
  ok('one code use is held', db1.registrationCodes[0].uses.length === 1 && db1.registrationCodes[0].uses[0].state === 'held');
  ok('the pending applicant cannot sign in (there is no account)', (await call('POST', '/api/auth/login', { id: app1.id, password: 'applicant-secret-1' })).status === 401);
  ok('a duplicate email cannot apply twice while pending', (await call('POST', '/api/registrations', applyBody(CODE1, 'adaeze@example.com'))).status === 400);
  ok('the old public sign-up route is gone (404/405, and no account is made)', [404, 405].indexOf((await call('POST', '/api/students', { name: 'Old Way', password: 'secret123', email: 'old@example.com', phone: '0801', goal: 'JAMB / UTME 2027', subjects: COMBO, privacyConsent: { accepted: true } })).status) > -1 && readDb().students.length === studentsBefore);

  head('review: Finance and Founder only');
  var apps = await call('GET', '/api/registrations/applications', null, finance);
  ok('Finance lists applications with counts and no secrets', apps.status === 200 && apps.body.counts.pending === 1 && apps.body.applications[0].id === app1.id && !/pwHash|tokenHash/.test(apps.raw), apps.raw.slice(0, 200));
  ok('Student Affairs cannot list applications', (await call('GET', '/api/registrations/applications', null, affairs)).status === 403);
  ok('the Academic Director cannot approve', (await call('POST', '/api/registrations/applications/' + app1.id + '/approve', {}, director)).status === 403);
  ok('Student Affairs cannot approve', (await call('POST', '/api/registrations/applications/' + app1.id + '/approve', {}, affairs)).status === 403);
  ok('Student Affairs cannot reject', (await call('POST', '/api/registrations/applications/' + app1.id + '/reject', { reason: 'no' }, affairs)).status === 403);

  head('approval creates exactly one account; setup comes before access');
  var ap = await call('POST', '/api/registrations/applications/' + app1.id + '/approve', {}, finance);
  ok('Finance approves', ap.status === 200 && !!ap.body.application.scholarId, ap.raw.slice(0, 240));
  var scholarId = ap.body.application.scholarId;
  ok('the Scholar ID was assigned only now', /^GOC-S-\d+$/.test(scholarId) && ap.body.application.status === 'approved');
  ok('setup delivery is reported honestly (dry-run outbox here)', ap.body.setupDelivery === 'dry-run', ap.raw.slice(0, 200));
  var db2 = readDb();
  ok('exactly one student record created, active', db2.students.filter(function (s) { return s.id === scholarId; }).length === 1 && db2.students.length === studentsBefore + 1 && db2.students.find(function (s) { return s.id === scholarId; }).active === true);
  ok('the code use is finalised', db2.registrationCodes[0].uses[0].state === 'finalised');
  ok('the application password hash was discarded', !('pwHash' in db2.registrationApplications[0]));
  ok('a second approve is refused 409 and creates nothing', (await call('POST', '/api/registrations/applications/' + app1.id + '/approve', {}, founder)).status === 409 && readDb().students.length === studentsBefore + 1);
  ok('an approved application cannot be rejected', (await call('POST', '/api/registrations/applications/' + app1.id + '/reject', { reason: 'late' }, finance)).status === 409);
  var earlyLogin = await call('POST', '/api/auth/login', { id: scholarId, password: 'applicant-secret-1' });
  ok('before setup, sign-in is refused with the setup instruction', earlyLogin.status === 403 && /Set your password/.test(earlyLogin.body.error || ''), earlyLogin.raw.slice(0, 200));
  var token1 = setupTokenFor('adaeze@example.com');
  ok('the setup email went to the applicant with link and Scholar ID', !!token1 && outbox().pop().text.indexOf(scholarId) > -1);
  var page = await call('GET', '/setup/' + token1);
  ok('the setup page renders (and does not consume the link)', page.status === 200 && /Set your password/.test(page.raw), page.status + '');
  ok('a short password is refused', (await call('POST', '/api/registrations/setup', { token: token1, password: 'short' })).status === 400);
  var setup = await call('POST', '/api/registrations/setup', { token: token1, password: 'my-new-password-1' });
  ok('setup completes and names the Scholar ID', setup.status === 200 && setup.body.scholarId === scholarId, setup.raw);
  ok('the used link cannot be used again', (await call('POST', '/api/registrations/setup', { token: token1, password: 'another-pass-1' })).status === 400);
  ok('an unknown token is refused generically', (await call('POST', '/api/registrations/setup', { token: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', password: 'whatever-123' })).status === 400);
  var login = await call('POST', '/api/auth/login', { id: scholarId, password: 'my-new-password-1' });
  ok('the student signs in with the password they set', login.status === 200 && !!login.body.token, login.raw.slice(0, 160));
  var me = await call('GET', '/api/me', null, login.body.token);
  ok('full G.O.C access after setup', me.status === 200 && me.body.features && me.body.features.askTutor === true, me.raw.slice(0, 160));
  ok('resending a setup link after setup is refused', (await call('POST', '/api/registrations/applications/' + app1.id + '/resend-setup', {}, finance)).status === 409);

  head('rejection releases the code use and creates nothing');
  var c2 = await call('POST', '/api/registrations/codes', { label: 'One seat', maxUses: 1 }, founder);
  var CODE2 = c2.body.code;
  await call('POST', '/api/registrations', applyBody(CODE2, 'bola@example.com'));
  var app2 = readDb().registrationApplications[1];
  ok('the single-seat code is exhausted while held', (await call('POST', '/api/registrations/validate-code', { code: CODE2 })).body.ok === false);
  ok('rejection needs a reason', (await call('POST', '/api/registrations/applications/' + app2.id + '/reject', {}, finance)).status === 400);
  var rj = await call('POST', '/api/registrations/applications/' + app2.id + '/reject', { reason: 'Incomplete documents' }, finance);
  ok('Finance rejects with a reason', rj.status === 200 && rj.body.application.status === 'rejected' && rj.body.application.rejectReason === 'Incomplete documents', rj.raw.slice(0, 200));
  ok('no account was created by the rejection', readDb().students.length === studentsBefore + 1);
  ok('the held use was released: the code is usable again', (await call('POST', '/api/registrations/validate-code', { code: CODE2 })).body.ok === true);
  ok('the rejected applicant may apply again', (await call('POST', '/api/registrations', applyBody(CODE2, 'bola@example.com'))).status === 200);
  var app3 = readDb().registrationApplications[2];

  head('a code revoked after submission blocks approval; failure is recoverable');
  var c3 = await call('POST', '/api/registrations/codes', { label: 'Revoked later', maxUses: 5 }, finance);
  var CODE3 = c3.body.code;
  await call('POST', '/api/registrations', applyBody(CODE3, 'chidi@example.com'));
  var app4 = readDb().registrationApplications[3];
  var code3Id = (await call('GET', '/api/registrations/codes', null, finance)).body.codes.filter(function (c) { return c.label === 'Revoked later'; })[0].id;
  ok('Finance revokes the code', (await call('POST', '/api/registrations/codes/' + code3Id + '/revoke', {}, finance)).status === 200);
  ok('a revoked code no longer validates', (await call('POST', '/api/registrations/validate-code', { code: CODE3 })).body.ok === false);
  var failAp = await call('POST', '/api/registrations/applications/' + app4.id + '/approve', {}, finance);
  var app4Now = readDb().registrationApplications[3];
  ok('approval is blocked and lands in provisioning-failed at validate-code', failAp.status === 502 && app4Now.status === 'provisioning-failed' && app4Now.provisionStep === 'validate-code' && !!app4Now.provisionError, failAp.raw.slice(0, 200));
  ok('no Scholar ID was burned and no student created', app4Now.scholarId === null && readDb().students.length === studentsBefore + 1);
  /* Resume from a later step: simulate a failure that happened after the
     Scholar ID was assigned, then approve again — it must continue with the
     SAME id and create exactly one record. */
  var dbEdit = readDb();
  var a3 = dbEdit.registrationApplications[2];
  a3.status = 'provisioning-failed'; a3.provisionStep = 'student-record'; a3.provisionError = 'simulated interruption'; a3.scholarId = 'GOC-S-777';
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(dbEdit));
  var resumed = await call('POST', '/api/registrations/applications/' + a3.id + '/approve', {}, founder);
  ok('Resume continues with the same Scholar ID and completes', resumed.status === 200 && resumed.body.application.scholarId === 'GOC-S-777', resumed.raw.slice(0, 220));
  ok('exactly one record exists for the resumed student', readDb().students.filter(function (s) { return s.id === 'GOC-S-777'; }).length === 1);
  await call('POST', '/api/registrations/applications/' + app4.id + '/reject', { reason: 'Code revoked' }, finance);
  ok('the blocked application can still be rejected, releasing its hold', readDb().registrationApplications[3].status === 'rejected');

  head('an expired setup link is refused; resend issues a fresh one');
  var token3 = setupTokenFor('bola@example.com');
  ok('a setup link was emailed for the resumed approval', !!token3);
  var dbExp = readDb();
  var a3b = dbExp.registrationApplications[2];
  a3b.setup.expiresAt = new Date(Date.now() - 1000).toISOString();
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(dbExp));
  ok('the expired link is refused', (await call('POST', '/api/registrations/setup', { token: token3, password: 'bola-password-1' })).status === 400);
  var resend = await call('POST', '/api/registrations/applications/' + a3b.id + '/resend-setup', {}, finance);
  ok('staff resend reports delivery only', resend.status === 200 && resend.body.setupDelivery === 'dry-run' && !/setup\//.test(resend.raw), resend.raw);
  var token3b = setupTokenFor('bola@example.com');
  ok('a fresh link was emailed; the old one is dead', !!token3b && token3b !== token3 && (await call('POST', '/api/registrations/setup', { token: token3, password: 'bola-password-1' })).status === 400);
  ok('the fresh link works', (await call('POST', '/api/registrations/setup', { token: token3b, password: 'bola-password-1' })).status === 200);
  ok('the resumed student signs in', (await call('POST', '/api/auth/login', { id: 'GOC-S-777', password: 'bola-password-1' })).status === 200);

  head('legacy pending student records still use the old routes');
  var dbLeg = readDb();
  dbLeg.students.push({ id: 'GOC-S-900', name: 'Legacy Pending', email: 'legacy@example.com', phone: '08099998888', goal: 'JAMB / UTME 2027', exam: 'JAMB / UTME 2027', subjects: COMBO, pwHash: hashPw('legacy-secret-1'), active: false, pendingApproval: true, xp: 0, streak: 0, createdAt: new Date().toISOString() });
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(dbLeg));
  ok('the legacy pending account cannot sign in yet', (await call('POST', '/api/auth/login', { id: 'GOC-S-900', password: 'legacy-secret-1' })).status === 403);
  ok('the legacy approve route still works', (await call('POST', '/api/students/GOC-S-900/approve', {}, finance)).status === 200);
  ok('the legacy student signs in after the legacy approval', (await call('POST', '/api/auth/login', { id: 'GOC-S-900', password: 'legacy-secret-1' })).status === 200);

  head('the manager audit log records the decisions, with no secrets');
  var log = await call('GET', '/api/audit/manager-actions?limit=100', null, founder);
  var actions = (log.body.entries || []).map(function (e) { return e.action; });
  ok('code creation, approval and rejection are all logged', actions.indexOf('registration-code-create') > -1 && actions.indexOf('registration-approve') > -1 && actions.indexOf('registration-reject') > -1 && actions.indexOf('registration-code-revoke') > -1, actions.join(','));
  ok('no password, code or token ever reaches the log', !/applicant-secret|my-new-password|bola-password|GOC-REG-[A-Z2-9]{6}/.test(log.raw));

  stop();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-1200)); stop(); process.exit(1); });
