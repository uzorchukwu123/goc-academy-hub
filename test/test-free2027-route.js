/* test-free2027-route.js — the 2027 Free Tutorial Edition over real HTTP.
   Starts a throw-away copy of the server on a scratch data folder, then walks
   the whole programme the way a candidate and an administrator would:

     • registration with a one-time code, and the code rules (wrong code,
       single use, one a minute);
     • the mode switch, and the confirmation the server itself insists on;
     • an activity that cannot be sat before it opens or after it closes, and a
       latecomer who gets in only because the administrator reopened it;
     • an interrupted examination that resumes with its answers, its remaining
       time and the same attempt (no second attempt consumed);
     • a submitted paper marked by the shared engine, with the result immediate
       and a weekly assessment's result private;
     • a competition leaderboard that is public only after approve + publish,
       shows ten rows, and hides an eleventh competitor's position from the
       public while still telling that candidate where they came;
     • session archiving to a local JSON file, and a fresh session afterwards;
     • the guards: no token, someone else's paper, a hand-made answer, a student
       account on a console route, and the original hub's data untouched.
   node test/test-free2027-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_PORT) || 8231;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 220) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-test-'));
var DATA = path.join(SANDBOX, 'data');
var MAIL_FILE = path.join(DATA, 'mail-capture.jsonl');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
try { fs.rmSync(path.join(DATA, 'data.json'), { force: true }); } catch (e) {}

var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
    GOC_TEST_MAIL_FILE: MAIL_FILE,
    GOC_FREE_2027_OTP_SECRET: 'local-test-otp-secret-0123456789abcdef',
    GOC_SMTP_HOST: 'mailpit-test',
    GOC_SMTP_FROM: 'G.O.C Academy Hub <verification@gocacademy.test>',
    GOC_FOUNDER_PW: 'founder2027',
    GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027',
    GOC_DATA_DIR: DATA,
    /* the central switch: this deployment opens in the edition */
    GOC_FREE_2027: '1',
    /* Test-only SMTP capture exercises the real delivery hook without exposing
       the message/code through the public API. */
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
/* Kill the running server but keep the sandbox: a later phase starts a second
   server on the same data folder with the central switch off. */
function stop() {
  try { child.kill(); } catch (e) {}
  try { child.unref(); } catch (e) {}
}

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
    if (h && h.status === 200) return h;
    if (tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return waitForBoot(tries - 1); });
  });
}
function dataFile() { return JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')); }
function mailRows() {
  if (!fs.existsSync(MAIL_FILE)) return [];
  return fs.readFileSync(MAIL_FILE, 'utf8').trim().split('\n').filter(Boolean).map(function (x) { return JSON.parse(x); });
}
function latestMail(email) {
  return mailRows().filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0] || null;
}
function mailedCode(email) {
  var mail = latestMail(email);
  var match = mail && String(mail.message.text || '').match(/verification code is (\d{6})/i);
  return match ? match[1] : null;
}
function register(name, email) {
  return call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Medicine and Surgery' })
    .then(function (r) {
      var code = mailedCode(email);
      if (r.status !== 200 || !code) return Promise.reject(new Error('verification email missing: ' + r.raw));
      return call('POST', '/api/free2027/register/verify', { email: email, code: code });
    });
}

var adm = null, adm2 = null;
var ada = null, ben = null, cat = null;      // { token, participant }
var weeklyId = null, compId = null;

waitForBoot(40).then(async function (h) {
  head('the server opens in the edition');
  ok('the server is up', h.status === 200, h.raw);
  ok('the health check names the mode', h.body && h.body.free2027 && h.body.free2027.on === true && h.body.free2027.mode === 'free2027', h.raw);
  var cfg = await call('GET', '/api/free2027/config');
  ok('the public config lists both modes and the six screens', cfg.status === 200 && cfg.body.modes.length === 2 && cfg.body.screens.length === 6, cfg.raw.slice(0, 120));
  ok('the config carries no participant, address or code', cfg.raw.indexOf('@') < 0 && cfg.raw.indexOf('otpCode') < 0);
  ok('the test mail provider is configured and the public config exposes availability only',
    cfg.body.otpDelivery && cfg.body.otpDelivery.available === true && cfg.body.otpDelivery.devAllowed === undefined,
    JSON.stringify(cfg.body.otpDelivery));

  head('the console signs in (unchanged) and unlocks (unchanged)');
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  adm = lin.body && lin.body.token;
  ok('the Founder signs in through the original route', lin.status === 200 && !!adm, lin.status);
  ok('the console is still locked until the passcode is entered', (await call('GET', '/api/free2027/admin/overview', undefined, adm)).status === 403);
  ok('a wrong passcode is still refused', (await call('POST', '/api/auth/unlock', { passcode: '9999' }, adm)).status === 403);
  ok('the passcode opens it', (await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm)).status === 200);

  head('recovered SMTP diagnostics: names and booleans only, console-guarded');
  var anonMail = await call('GET', '/api/free2027/admin/email-status');
  ok('ordinary visitors cannot read the admin email diagnostic', anonMail.status === 401 || anonMail.status === 403, anonMail.status);
  var mailSt = await call('GET', '/api/free2027/admin/email-status', undefined, adm);
  ok('the Founder diagnostic reports the configured state without a live check',
    mailSt.status === 200 && mailSt.body.status === 'configured' && mailSt.body.liveChecked === false && Array.isArray(mailSt.body.missing), mailSt.raw.slice(0, 200));
  ok('the diagnostic never returns the configured host, sender or OTP secret',
    mailSt.raw.indexOf('mailpit-test') < 0 && mailSt.raw.indexOf('verification@gocacademy.test') < 0 && mailSt.raw.indexOf('local-test-otp-secret') < 0, mailSt.raw.slice(0, 200));
  var mailLive = await call('GET', '/api/free2027/admin/email-status?verify=1', undefined, adm);
  ok('a live check against the test transport reports ready', mailLive.status === 200 && mailLive.body.status === 'ready' && mailLive.body.liveChecked === true, mailLive.raw.slice(0, 200));

  head('registration: a code is required before anything exists');
  var noCode = await call('POST', '/api/free2027/register/verify', { email: 'ada@example.com', code: '123456' });
  ok('verifying without ever asking for a code is refused', noCode.status === 400, noCode.status);
  var badEmail = await call('POST', '/api/free2027/register/start', { name: 'Ada Obi', email: 'not-an-email', course: 'Law' });
  ok('a malformed address is refused', badEmail.status === 400, badEmail.raw);
  var start1 = await call('POST', '/api/free2027/register/start', { name: 'Ada Obi', email: 'ada@example.com', course: 'Medicine and Surgery' });
  var code1 = mailedCode('ada@example.com');
  ok('registration sends a real verification email to the submitted address', start1.status === 200 && start1.body.delivered === true && !!code1 && latestMail('ada@example.com').message.to === 'ada@example.com', start1.raw);
  ok('the public response never contains the verification code', start1.raw.indexOf(code1) < 0 && start1.body.devCode === undefined && start1.body.code === undefined, start1.raw);
  ok('the email has the academy identity and expiry guidance', /G\.O\.C Academy Hub/.test(latestMail('ada@example.com').message.text) && /expires in \d+ minutes/.test(latestMail('ada@example.com').message.text), latestMail('ada@example.com').message.text);
  ok('nothing was created by asking for a code', dataFile().free2027.sessions[0].participants.length === 0);
  var again = await call('POST', '/api/free2027/register/start', { name: 'Ada Obi', email: 'ada@example.com', course: 'Medicine and Surgery' });
  ok('a second code within the resend window is rate limited', again.status === 429, again.raw);
  /* Advance only the persisted resend timestamp so this test remains fast. */
  var otpDb = dataFile(); otpDb.free2027.otps[otpDb.free2027.otps.length - 1].createdAt = Date.now() - 61000;
  fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(otpDb));
  var resent = await call('POST', '/api/free2027/register/start', { name: 'Ada Obi', email: 'ada@example.com', course: 'Medicine and Surgery' });
  var code2 = mailedCode('ada@example.com');
  ok('resending after the cooldown sends a fresh email', resent.status === 200 && resent.body.delivered === true && !!code2, resent.raw);
  var wrongCode = code2 === '000000' ? '000001' : '000000';
  var wrong = await call('POST', '/api/free2027/register/verify', { email: 'ada@example.com', code: wrongCode });
  ok('a wrong code is refused', wrong.status === 403, wrong.raw);
  var old = await call('POST', '/api/free2027/register/verify', { email: 'ada@example.com', code: code1 });
  ok('the older code is rejected after a resend', old.status === 403, old.raw);
  var good = await call('POST', '/api/free2027/register/verify', { email: 'ada@example.com', code: code2 });
  ok('the emailed code verifies and issues a cryptographically random student ID', good.status === 200 && /^GOC-F27-[A-F0-9]{20}$/.test(good.body.participant.id), good.raw.slice(0, 160));
  ok('the candidate is told their own address only masked', good.body.participant.email.indexOf('ada@') < 0 && /@example\.com$/.test(good.body.participant.email), good.body.participant.email);
  ok('the code cannot be used twice', (await call('POST', '/api/free2027/register/verify', { email: 'ada@example.com', code: code2 })).status === 400);
  ada = { token: good.body.token, participant: good.body.participant };
  var stored = dataFile();
  ok('verification codes are stored only as salted hashes', stored.free2027.otps.every(function (o) { return o.hash && String(o.hash).length === 64; }) && JSON.stringify(stored.free2027.otps).indexOf(code2) < 0);
  ben = await register('Ben Eze', 'ben@example.com').then(function (r) { return { token: r.body.token, participant: r.body.participant }; });
  cat = await register('Cat Musa', 'cat@example.com').then(function (r) { return { token: r.body.token, participant: r.body.participant }; });
  ok('each verified participant gets their own ID', ada.participant.id !== ben.participant.id && ben.participant.id !== cat.participant.id);
  var stored = dataFile();
  ok('the stored record keeps the address (it is private, not absent)', /ada@example\.com/.test(JSON.stringify(stored.free2027)));
  ok('the permanent ID is associated with the student email in the Free Tutorial registry', stored.free2027.studentIds.indexOf(ada.participant.id) > -1 && stored.free2027.studentIdsByEmail['ada@example.com'] === ada.participant.id);
  var expiredStart = await call('POST', '/api/free2027/register/start', { name: 'Zed Obi', email: 'zed@example.com', course: 'Law' });
  var expiredCode = mailedCode('zed@example.com');
  var expiredDb = dataFile();
  expiredDb.free2027.otps.filter(function (o) { return o.email === 'zed@example.com'; }).forEach(function (o) { o.expiresAt = Date.now() - 1; });
  fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(expiredDb));
  var expiredVerify = await call('POST', '/api/free2027/register/verify', { email: 'zed@example.com', code: expiredCode });
  ok('an expired email verification code is rejected', expiredStart.status === 200 && expiredVerify.status === 400, expiredVerify.raw);
  var burstOk = true;
  for (var oi = 0; oi < 6; oi++) {
    var br = await call('POST', '/api/free2027/register/start', { name: 'Test Student', email: 'limit@example.com', course: 'Law' });
    if (br.status !== 200) burstOk = false;
    var burstDb = dataFile();
    var burstRows = burstDb.free2027.otps.filter(function (o) { return o.email === 'limit@example.com'; });
    if (burstRows.length) burstRows[burstRows.length - 1].createdAt = Date.now() - 61000;
    fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(burstDb));
  }
  var limited = await call('POST', '/api/free2027/register/start', { name: 'Test Student', email: 'limit@example.com', course: 'Law' });
  ok('verification email requests have an hourly per-address cap', burstOk && limited.status === 429, limited.raw);

  head('the administrator imports the two independent question banks and schedules activities');
  /* One mixed-subject CSV per bank; the subject column decides the category. */
  function csvRows(prefix, subjects, n) {
    var rows = ['subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
    for (var i = 1; i <= n; i++) {
      var s = subjects[(i - 1) % subjects.length];
      rows.push([s, 'Topic ' + i, prefix + ' question number ' + i + ': which option is correct?',
        'Alpha ' + i, 'Beta ' + i, 'Gamma ' + i, 'Delta ' + i, '', 'B', 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
    }
    return rows.join('\n');
  }
  var SUBJ5 = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
  var impW = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvRows('Weekly', SUBJ5, 8) }, adm);
  ok('a mixed-subject CSV imports into the Weekly bank (all five subjects)', impW.status === 200 && impW.body.imported === 8, impW.raw.slice(0, 200));
  var impC = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csvRows('Comp', SUBJ5, 4) }, adm);
  ok('a mixed-subject CSV imports into the Competition bank', impC.status === 200 && impC.body.imported === 4, impC.raw.slice(0, 200));
  var wq = await call('GET', '/api/free2027/admin/questions?bank=weekly', undefined, adm);
  var cq = await call('GET', '/api/free2027/admin/questions?bank=competition', undefined, adm);
  ok('the picker reads the edition banks, not the shared db.questions', wq.body.source === 'free2027-question-bank' && wq.body.questions.length === 8 && cq.body.questions.length === 4, wq.body.source + '/' + wq.body.questions.length + '/' + cq.body.questions.length);
  var ids = wq.body.questions.slice(0, 4).map(function (q) { return q.id; });
  var compIds = cq.body.questions.map(function (q) { return q.id; });
  var t = Date.now();
  var draft = await call('POST', '/api/free2027/admin/activities', {
    kind: 'weekly', title: 'Week 1 — Foundations', questionCount: ids.length,
    opensAt: t - 60000, closesAt: t + 3600000, durationMin: 15, maxAttempts: 2
  }, adm);
  ok('an activity is created as a draft', draft.status === 200 && draft.body.activity.status === 'draft' && /^F27-Q\d+$/.test(draft.body.activity.id), draft.raw.slice(0, 160));
  weeklyId = draft.body.activity.id;
  ok('a draft is not on a candidate\'s list', (await call('GET', '/api/free2027/activities', undefined, ada.token)).body.activities.length === 0);
  var noQuestions = await call('POST', '/api/free2027/admin/activities', { kind: 'weekly', title: 'Empty', opensAt: t, closesAt: t + 1000, durationMin: 10, maxAttempts: 1, questionCount: 0 }, adm);
  ok('an activity with no questions cannot be created', noQuestions.status === 400, noQuestions.raw);
  var badWindow = await call('POST', '/api/free2027/admin/activities', { kind: 'weekly', title: 'Backwards', opensAt: t + 5000, closesAt: t + 1000, durationMin: 10, maxAttempts: 1, questionCount: ids.length }, adm);
  ok('a closing time before the opening time is refused', badWindow.status === 400, badWindow.raw);
  var badAttempts = await call('POST', '/api/free2027/admin/activities', { kind: 'weekly', title: 'Too many', opensAt: t, closesAt: t + 9000, durationMin: 10, maxAttempts: 99, questionCount: ids.length }, adm);
  ok('an out-of-range attempt limit is refused before publishing', badAttempts.status === 400, badAttempts.raw);
  ok('publishing it makes it visible', (await call('POST', '/api/free2027/admin/activities/' + weeklyId + '/publish', {}, adm)).status === 200);
  var list = await call('GET', '/api/free2027/activities', undefined, ada.token);
  ok('a published, open activity is on the candidate\'s list', list.body.activities.length === 1 && list.body.activities[0].state === 'open', list.raw.slice(0, 200));

  head('scheduling: nobody sits it outside its window');
  var soon = await call('POST', '/api/free2027/admin/activities', {
    kind: 'weekly', title: 'Week 2 — Later', questionCount: ids.length,
    opensAt: t + 3600000, closesAt: t + 7200000, durationMin: 10, maxAttempts: 1
  }, adm);
  var soonId = soon.body.activity.id;
  await call('POST', '/api/free2027/admin/activities/' + soonId + '/publish', {}, adm);
  var early = await call('POST', '/api/free2027/activities/' + soonId + '/start', {}, ada.token);
  ok('starting before it opens is refused', early.status === 403 && /not open yet/i.test(early.raw), early.status + ' ' + early.raw);
  ok('and the candidate\'s list says it opens later',
    (await call('GET', '/api/free2027/activities', undefined, ada.token)).body.activities.some(function (a) { return a.id === soonId && a.state === 'upcoming'; }));

  head('an interrupted examination resumes with its answers and its clock');
  var started = await call('POST', '/api/free2027/activities/' + weeklyId + '/start', {}, ada.token);
  ok('the paper opens with questions and a clock', started.status === 200 && started.body.questions.length === 4 && started.body.attempt.remainingSec > 800, started.raw.slice(0, 160));
  var attemptId = started.body.attempt.id;
  ok('the questions carry no correct answer', started.raw.indexOf('"answer"') < 0 && started.body.questions.every(function (q) { return q.answer === undefined; }));
  var q0 = started.body.questions[0], q1 = started.body.questions[1];
  ok('an answer is saved as it is given', (await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: q0.id, choice: 1 }, ada.token)).status === 200);
  var hand = await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: q0.id, choice: 97 }, ada.token);
  ok('an option that does not exist is refused', hand.status === 400, hand.raw);
  var foreign = await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: q0.id, choice: 0 }, ben.token);
  ok('nobody else can answer on that paper', foreign.status === 403, foreign.raw);
  var res = await call('GET', '/api/free2027/attempts/' + attemptId, undefined, ada.token);
  ok('resuming hands back the saved answer', res.status === 200 && res.body.attempt.responses[q0.id] === 1, res.raw.slice(0, 160));
  ok('resuming keeps the clock running down, not reset', res.body.attempt.remainingSec <= started.body.attempt.remainingSec);
  var resumed = await call('POST', '/api/free2027/activities/' + weeklyId + '/start', {}, ada.token);
  ok('opening it again resumes the SAME attempt', resumed.body.attempt.id === attemptId && resumed.body.resumed === true, resumed.raw.slice(0, 160));
  ok('and uses no extra attempt', resumed.body.attempt.attemptsUsed === 0, resumed.body.attempt.attemptsUsed);
  ok('a second answer is saved too', (await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: q1.id, choice: 0 }, ada.token)).status === 200);

  head('submitting marks the paper immediately');
  var sub = await call('POST', '/api/free2027/attempts/' + attemptId + '/submit', { responses: { 999999: 0 } }, ada.token);
  ok('the paper is marked at once', sub.status === 200 && sub.body.result && sub.body.result.score !== null, sub.raw.slice(0, 200));
  ok('marking is the shared engine\'s, out of the paper\'s own questions', sub.body.result.total === 4 && sub.body.result.maxScore === 4, sub.body.result && sub.body.result.total);
  ok('a weekly result is flagged private', sub.body.result.private === true);
  ok('submitting twice does not mark it again', (await call('POST', '/api/free2027/attempts/' + attemptId + '/submit', {}, ada.token)).body.alreadySubmitted === true);
  var myRes = await call('GET', '/api/free2027/results', undefined, ada.token);
  ok('the result appears in the candidate\'s own results only', myRes.body.results.length === 1);
  ok('another candidate cannot see it', (await call('GET', '/api/free2027/results', undefined, ben.token)).body.results.length === 0);

  head('a competition, its ranking and its leaderboard');
  var comp = await call('POST', '/api/free2027/admin/activities', {
    kind: 'competition', title: 'Term Cup', questionCount: compIds.length,
    opensAt: t - 60000, closesAt: t + 3600000, durationMin: 5, maxAttempts: 1
  }, adm);
  compId = comp.body.activity.id;
  await call('POST', '/api/free2027/admin/activities/' + compId + '/publish', {}, adm);
  /* The marked answers are the SERVER's (they live in the data file, never in
     the paper a candidate is served), so the test can drive a known score for
     each candidate. That is what makes "highest score first" testable rather
     than hopeful. */
  function correctAnswers() {
    var bank = {};
    ((dataFile().free2027 || {}).questionBanks || {}).competition.questions.forEach(function (q) { bank[String(q.id)] = Number(q.answer); });
    return bank;
  }
  var answers = correctAnswers();
  async function sit(who, correctCount) {
    var s = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, who.token);
    var qsx = s.body.questions;
    var resp = {};
    for (var i = 0; i < correctCount && i < qsx.length; i++) resp[qsx[i].id] = answers[String(qsx[i].id)];
    return call('POST', '/api/free2027/attempts/' + s.body.attempt.id + '/submit', { responses: resp }, who.token);
  }
  await sit(ada, 4);
  await sit(ben, 3);
  await sit(cat, 2);
  /* Eight more candidates, so the field is genuinely larger than ten. Seven of
     them score one; the last scores none and finishes bottom. */
  var extra = [];
  for (var i = 0; i < 8; i++) {
    var r2 = await register('Extra ' + i, 'extra' + i + '@example.com');
    extra.push({ token: r2.body.token, participant: r2.body.participant });
  }
  for (var j = 0; j < extra.length; j++) await sit(extra[j], j < 7 ? 1 : 0);
  ok('the competition field is now larger than ten', extra.length === 8);
  var results = await call('GET', '/api/free2027/admin/activities/' + compId + '/results', undefined, adm);
  ok('the console lists every submitted paper with a rank', results.status === 200 && results.body.rows.length === 11, results.raw.slice(0, 160));
  ok('the ranking puts the highest score first', results.body.top[0].participantId === ada.participant.id && results.body.top[0].score === 4, JSON.stringify(results.body.top[0]));
  ok('then the next highest, and the next', results.body.top[1].score === 3 && results.body.top[2].score === 2,
    JSON.stringify(results.body.top.slice(0, 3).map(function (r) { return r.score; })));
  var lowest = results.body.rows.filter(function (r) { return r.participantId === extra[7].participant.id; })[0];
  ok('the bottom candidate is ranked last', !!lowest && lowest.rank === 11 && lowest.score === 0, JSON.stringify(lowest));
  ok('the console is given the whole field, even though the public board is ten',
    results.body.ranked === 11 && results.body.top.length === 10, results.body.ranked + '/' + results.body.top.length);
  var boardBefore = await call('GET', '/api/free2027/leaderboards/' + compId);
  ok('an unapproved board is not public', boardBefore.status === 404, boardBefore.status);
  ok('publishing without approving is refused', (await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/publish', {}, adm)).status === 400);
  ok('the administrator approves it', (await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/approve', {}, adm)).status === 200);
  ok('approved but unpublished is still private', (await call('GET', '/api/free2027/leaderboards/' + compId)).status === 404);
  ok('publishing it makes it public', (await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/publish', {}, adm)).status === 200);
  var board = await call('GET', '/api/free2027/leaderboards/' + compId, undefined, cat.token);
  ok('the public board is served', board.status === 200, board.raw.slice(0, 160));
  ok('the whole field is counted', board.body.leaderboard.totalCompetitors === 11, board.body.leaderboard.totalCompetitors);
  ok('the public board is exactly the top ten, whatever the field size', board.body.leaderboard.rows.length === 10, board.body.leaderboard.rows.length);
  ok('the public board ranks by score then time', board.body.leaderboard.rows[0].score === 4 &&
    board.body.leaderboard.rows[1].score === 3 && board.body.leaderboard.rows[2].score === 2,
    JSON.stringify(board.body.leaderboard.rows.map(function (r) { return r.score; })));
  ok('the public board carries no email address', board.raw.indexOf('@') < 0);
  ok('a weekly assessment never gets a public board', (await call('GET', '/api/free2027/leaderboards/' + weeklyId)).status === 404);
  var bottom = extra[7].participant.id;
  var outside = await call('GET', '/api/free2027/leaderboards/' + compId, undefined, extra[7].token);
  ok('the eleventh-placed candidate is not on the public board',
    !outside.body.leaderboard.rows.some(function (r) { return r.participantId === bottom; }));
  ok('but they are told their own position, privately',
    !!outside.body.mine && outside.body.mine.rank === 11 && outside.body.mine.inTop === false, JSON.stringify(outside.body.mine));
  ok('the public rows stay at ten even for the candidate who asked', outside.body.leaderboard.rows.length === 10);
  ok('a candidate inside the ten is marked as being on the board',
    (await call('GET', '/api/free2027/leaderboards/' + compId, undefined, ada.token)).body.mine.inTop === true);
  await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/unpublish', {}, adm);
  ok('unpublishing takes the board off the public site at once', (await call('GET', '/api/free2027/leaderboards/' + compId)).status === 404);
  ok('and the same private position is no longer served', (await call('GET', '/api/free2027/leaderboards/' + compId, undefined, extra[7].token)).status === 404);
  ok('the ranking still exists for the administrator',
    (await call('GET', '/api/free2027/admin/activities/' + compId + '/results', undefined, adm)).body.ranked === 11);
  await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/approve', {}, adm);
  await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/publish', {}, adm);

  head('closing, then reopening for a latecomer');
  ok('the administrator closes the competition', (await call('POST', '/api/free2027/admin/activities/' + compId + '/close', {}, adm)).status === 200);
  var late = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, cat.token);
  ok('nobody can start it while it is closed', late.status === 403, late.raw);
  ok('a reopen needs a new closing time', (await call('POST', '/api/free2027/admin/activities/' + compId + '/reopen', {}, adm)).status === 400);
  ok('a reopen with a past time is refused', (await call('POST', '/api/free2027/admin/activities/' + compId + '/reopen', { closesAt: Date.now() - 1000 }, adm)).status === 400);
  ok('a reopen with a real closing time is accepted', (await call('POST', '/api/free2027/admin/activities/' + compId + '/reopen', { closesAt: Date.now() + 3600000 }, adm)).status === 200);
  ok('a candidate with no attempt left still cannot sit it again', (await call('POST', '/api/free2027/activities/' + compId + '/start', {}, cat.token)).status === 403);

  head('the mode switch needs a confirmation, and is reversible');
  ok('switching with no confirmation is refused by the SERVER', (await call('PUT', '/api/free2027/admin/mode', { mode: 'original' }, adm)).status === 400);
  ok('an unknown mode is refused', (await call('PUT', '/api/free2027/admin/mode', { mode: 'banana', confirm: true }, adm)).status === 400);
  var toOrig = await call('PUT', '/api/free2027/admin/mode', { mode: 'original', confirm: true }, adm);
  ok('Original Mode is applied', toOrig.status === 200 && toOrig.body.mode === 'original', toOrig.raw);
  ok('the public config says Original Mode', (await call('GET', '/api/free2027/config')).body.mode === 'original');
  var h2 = await call('GET', '/api/health');
  ok('and the health check agrees, so the page restores the hub', h2.body.free2027.mode === 'original' && h2.body.free2027.on === true);
  ok('the original hub still answers while the edition is in Original Mode',
    (await call('GET', '/api/updates')).status === 200);
  ok('the edition\'s own data is untouched by the switch', dataFile().free2027.sessions[0].participants.length === 11);
  ok('switching back is one call', (await call('PUT', '/api/free2027/admin/mode', { mode: 'free2027', confirm: true }, adm)).body.mode === 'free2027');

  head('programme records: lessons, progress and the audit trail');
  var lp = await call('GET', '/api/free2027/programme', undefined, ada.token);
  ok('a candidate reads their own programme record', lp.status === 200 && lp.body.profile.id === ada.participant.id, lp.raw.slice(0, 220));
  ok('it carries the course enrolment', lp.body.enrolment.course === 'Medicine and Surgery' && lp.body.enrolment.status === 'enrolled', JSON.stringify(lp.body.enrolment));
  ok('it carries the programme access', lp.body.access.status === 'active' && /free-tutorial/.test(lp.body.access.programme), JSON.stringify(lp.body.access));
  ok('and their quiz record', lp.body.quizzes.submitted >= 1 && typeof lp.body.quizzes.average === 'number', JSON.stringify(lp.body.quizzes));
  ok('no programme route without a token', (await call('GET', '/api/free2027/programme')).status === 401);
  ok('a console token is not a candidate token', (await call('GET', '/api/free2027/programme', undefined, adm)).status === 401);

  /* The Academic Director, signed in and unlocked: the second programme
     administrator, through the same console authentication as always. */
  var acadLogin = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  var acadT = acadLogin.body && acadLogin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, acadT);
  var mk1 = await call('POST', '/api/free2027/admin/lessons', { title: 'Cell biology — the basics', subject: 'Biology', summary: 'Membranes and division' }, adm);
  ok('the Founder adds a lesson', mk1.status === 200 && /^F27-L-\d{3}$/.test(mk1.body.lesson.id) && mk1.body.created === true, mk1.raw.slice(0, 200));
  var mk2 = await call('POST', '/api/free2027/admin/lessons', { title: 'Algebra — quadratics', subject: 'Mathematics' }, acadT);
  ok('the Academic Director adds a lesson too', mk2.status === 200 && mk2.body.lesson.id !== mk1.body.lesson.id, mk2.raw.slice(0, 200));
  ok('a lesson with no real title is refused', (await call('POST', '/api/free2027/admin/lessons', { title: 'ab' }, adm)).status === 400);
  ok('a candidate cannot create a lesson', (await call('POST', '/api/free2027/admin/lessons', { title: 'Sneaky one' }, cat.token)).status === 401);
  ok('a console token cannot create a lesson either', (await call('POST', '/api/free2027/admin/lessons', { title: 'Sneaky one' }, ada.token)).status === 401);
  var edited = await call('PUT', '/api/free2027/admin/lessons/' + mk2.body.lesson.id, { title: 'Algebra — quadratics and graphs' }, acadT);
  ok('a lesson can be edited', edited.status === 200 && /graphs/.test(edited.body.lesson.title) && edited.body.created === false, edited.raw.slice(0, 200));
  ok('an unknown lesson cannot be edited', (await call('PUT', '/api/free2027/admin/lessons/F27-L-999', { title: 'Ghost lesson' }, adm)).status === 404);
  var all2 = await call('GET', '/api/free2027/admin/lessons', undefined, acadT);
  ok('both administrators read the same catalogue', all2.status === 200 && all2.body.lessons.length === 2, all2.raw.slice(0, 200));
  ok('the Academic Director cannot change the Free Tutorial site mode',
    (await call('PUT', '/api/free2027/admin/mode', { mode: 'original', confirm: true }, acadT)).status === 403);
  ok('the Academic Director cannot archive programme/system data',
    (await call('GET', '/api/free2027/admin/archives', undefined, acadT)).status === 403);
  var finMade = await call('POST', '/api/managers', { name: 'Local Finance', role: 'finance', password: 'starter123', passcode: '4821' }, adm);
  var finLogin = await call('POST', '/api/auth/login', { id: finMade.body.manager.id, password: 'starter123' });
  var finToken = finLogin.body.token;
  await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'finance-1234' }, finToken);
  await call('POST', '/api/auth/unlock', { passcode: '4821' }, finToken);
  ok('a non-academic management role cannot open Free Tutorial administration',
    (await call('GET', '/api/free2027/admin/overview', undefined, finToken)).status === 403);

  head('a candidate works through the lessons, and the console sees it');
  var before = await call('GET', '/api/free2027/programme', undefined, ada.token);
  ok('the candidate starts at nought of two', before.body.progress.completed === 0 && before.body.progress.total === 2, JSON.stringify(before.body.progress));
  var d1 = await call('POST', '/api/free2027/lessons/' + mk1.body.lesson.id + '/complete', {}, ada.token);
  ok('marking a lesson done is accepted', d1.status === 200 && d1.body.completed === true && d1.body.already === false, d1.raw.slice(0, 200));
  ok('progress moves to one of two, fifty per cent', d1.body.progress.completed === 1 && d1.body.progress.percent === 50, JSON.stringify(d1.body.progress));
  var d2 = await call('POST', '/api/free2027/lessons/' + mk1.body.lesson.id + '/complete', {}, ada.token);
  ok('marking the same lesson again changes nothing', d2.body.already === true && d2.body.progress.completed === 1, d2.raw.slice(0, 200));
  ok('another candidate keeps their own sheet', (await call('GET', '/api/free2027/programme', undefined, ben.token)).body.progress.completed === 0);
  ok('an unknown lesson is refused', (await call('POST', '/api/free2027/lessons/F27-L-999/complete', {}, ada.token)).status === 404);
  ok('a lesson cannot be completed without a token', (await call('POST', '/api/free2027/lessons/' + mk1.body.lesson.id + '/complete', {})).status === 401);
  ok('the completion is in the session records', (await call('GET', '/api/free2027/admin/records', undefined, adm)).body.records.some(function (r) { return r.kind === 'lesson' && r.participantId === ada.participant.id; }));

  var plist = await call('GET', '/api/free2027/admin/participants', undefined, adm);
  var adaRow = (plist.body.participants || []).filter(function (p) { return p.id === ada.participant.id; })[0];
  ok('the participant list carries each candidate\'s lesson progress', !!adaRow && adaRow.lessonsDone === 1 && adaRow.lessonsTotal === 2, JSON.stringify(adaRow && { d: adaRow.lessonsDone, t: adaRow.lessonsTotal }));
  var prog = await call('GET', '/api/free2027/admin/progress', undefined, acadT);
  ok('the progress view lists every candidate', prog.status === 200 && prog.body.participants.length === 11 && prog.body.lessons === 2, prog.raw.slice(0, 220));
  var adaProg = prog.body.participants.filter(function (x) { return x.id === ada.participant.id; })[0];
  ok('with their lessons, quizzes and average',
    !!adaProg && adaProg.lessonsDone === 1 && adaProg.quizzes >= 1 && typeof adaProg.average === 'number', JSON.stringify(adaProg));
  ok('and no address is carried into the progress view', prog.raw.indexOf('@') < 0, prog.raw.slice(0, 160));

  head('the programme keeps its own audit trail');
  var audit = await call('GET', '/api/free2027/admin/audit', undefined, adm);
  var acts = ((audit.body && audit.body.entries) || []).map(function (e) { return e.action; });
  ok('administrative changes are recorded', audit.status === 200 && acts.indexOf('lesson.create') > -1 && acts.indexOf('lesson.edit') > -1,
    acts.slice(0, 12).join(','));
  ok('and the activity and leaderboard changes with them',
    acts.indexOf('activity.create') > -1 && acts.indexOf('activity.publish') > -1 && acts.indexOf('leaderboard.publish') > -1, acts.join(','));
  ok('each entry names the administrator and their role',
    audit.body.entries.every(function (e) { return !!e.actorId && !!e.actorRole; }), JSON.stringify(audit.body.entries.slice(0, 2)));
  ok('no address, passcode or code is ever written to it',
    audit.raw.indexOf('@') < 0 && audit.raw.indexOf('2027') < 0 && audit.raw.indexOf('ada') < 0, audit.raw.slice(0, 200));
  ok('a candidate cannot read the audit trail', (await call('GET', '/api/free2027/admin/audit', undefined, ada.token)).status === 401);
  ok('getting a list is not an administrative change', acts.filter(function (a) { return /^(questions|progress|audit)\./.test(a); }).length === 0);

  head('archiving a session, and starting fresh');
  ok('archiving without a confirmation is refused', (await call('POST', '/api/free2027/admin/sessions/new', { label: 'Term Two' }, adm)).status === 400);
  var before = dataFile();
  var gocStudentsBefore = (before.students || []).length;
  var gocAttemptsBefore = (before.attempts || []).length;
  var newSession = await call('POST', '/api/free2027/admin/sessions/new', { label: 'Term Two', confirm: true }, adm);
  ok('the session is archived and a new one starts', newSession.status === 200 && /^F27-S2$/.test(newSession.body.session.id), newSession.raw.slice(0, 200));
  ok('the archive reports what it holds', newSession.body.archive.counts.participants === 11 && newSession.body.archive.counts.submissions === 12, JSON.stringify(newSession.body.archive.counts));
  var archiveFile = path.join(DATA, 'free2027-archives', newSession.body.archive.file);
  ok('the archive is a real JSON file on disk', fs.existsSync(archiveFile), archiveFile);
  var archiveJson = JSON.parse(fs.readFileSync(archiveFile, 'utf8'));
  ok('it holds the participants, activities, attempts and rankings', archiveJson.session.participants.length === 11 && archiveJson.session.activities.length >= 3 && archiveJson.session.attempts.length >= 12);
  ok('nothing in the original hub was touched by the archive',
    (function () { var after = dataFile(); return (after.students || []).length === gocStudentsBefore && (after.attempts || []).length === gocAttemptsBefore; })());
  ok('the new session starts with no participants or activities',
    (function () { var s = dataFile().free2027.sessions[0]; return s.id === 'F27-S2' && s.participants.length === 0 && s.activities.length === 0 && s.attempts.length === 0; })());
  ok('a candidate from the archived session is signed out of it', (await call('GET', '/api/free2027/me', undefined, ada.token)).status === 401);
  var archives = await call('GET', '/api/free2027/admin/archives', undefined, adm);
  ok('the administrator can list the archives', archives.status === 200 && archives.body.archives.length === 1, archives.raw.slice(0, 200));
  ok('and read one back', (await call('GET', '/api/free2027/admin/archives/' + newSession.body.archive.file, undefined, adm)).status === 200);
  ok('an archive cannot be used to read another file', (await call('GET', '/api/free2027/admin/archives/' + encodeURIComponent('../../data.json'), undefined, adm)).status === 400 ||
    (await call('GET', '/api/free2027/admin/archives/..%2F..%2Fdata.json', undefined, adm)).status === 404);

  head('the guards');
  ok('no token: nothing of the candidate side', (await call('GET', '/api/free2027/activities')).status === 401);
  ok('a management token is not a candidate token', (await call('GET', '/api/free2027/activities', undefined, adm)).status === 401);
  ok('a candidate token is not a console token', (await call('GET', '/api/free2027/admin/participants', undefined, cat.token)).status === 401);
  ok('a candidate token does not open the hub\'s own student routes', (await call('GET', '/api/me', undefined, cat.token)).status === 401);
  var stu = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  adm2 = stu.body.token;
  var locked = await call('GET', '/api/free2027/admin/participants', undefined, adm2);
  ok('a second management account is refused until it enters the passcode', locked.status === 403 && /passcode/i.test(locked.raw), locked.status + ' ' + locked.raw);
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm2);
  ok('once unlocked, the console reads the programme', (await call('GET', '/api/free2027/admin/participants', undefined, adm2)).status === 200);
  ok('the console lists the participants for the Founder', (await call('GET', '/api/free2027/admin/participants', undefined, adm)).status === 200);
  var plist = await call('GET', '/api/free2027/admin/participants', undefined, adm);
  ok('an address is masked in the console list, never rendered in full', plist.raw.indexOf('@') < 0, plist.raw.slice(0, 200));
  var csv = await call('GET', '/api/free2027/admin/participants.csv', undefined, adm);
  ok('the deliberate export is a CSV file', csv.status === 200 && /Participant ID,Full name,Email/.test(csv.raw));
  ok('the session records are readable by the administrator', (await call('GET', '/api/free2027/admin/records', undefined, adm)).status === 200);
}).catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n')[0] : e));
}).then(phaseTwo).then(phaseThree).then(function () {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  if (fails) console.log('\nserver log tail:\n' + serverLog.slice(-2000));
  process.exit(fails ? 1 : 0);
});

/* Phase three: with no SMTP sender, production must expose a clear config
   error and must not pretend that an email was sent or return a code. */
async function phaseThree() {
  head('missing SMTP is an explicit configuration error in production');
  var DATA2 = path.join(SANDBOX, 'data-prod');
  fs.mkdirSync(DATA2, { recursive: true });
  var child3 = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
      /* a production-like run refuses to boot on the published demo secrets,
         so this one is given real ones (and no SMTP). */
      GOC_FOUNDER_PW: 'prod-founder-2027', GOC_ACADDIR_PW: 'prod-acaddir-2027', GOC_PASSCODE: '918273',
      GOC_DATA_DIR: DATA2, GOC_FREE_2027: '1',
      NODE_ENV: 'production'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  var prodLog = '';
  child3.stdout.on('data', function (c) { prodLog += c; });
  child3.stderr.on('data', function (c) { prodLog += c; });
  try {
    var r = await waitForBoot(40);
    ok('the edition still opens in production', r.body && r.body.free2027 && r.body.free2027.on === true, r.raw + ' ' + prodLog.slice(-300));
    var c = await call('GET', '/api/free2027/config');
    ok('the public config says SMTP is unavailable without advertising a bypass',
      c.body.otpDelivery && c.body.otpDelivery.available === false && c.body.otpDelivery.devAllowed === undefined,
      JSON.stringify(c.body.otpDelivery));
    var reg = await call('POST', '/api/free2027/register/start', { name: 'Zed', email: 'zed@example.com', course: 'Law' });
    ok('registration fails clearly instead of pretending to send an email', reg.status === 503 && /email verification is not configured/i.test(reg.body.error || reg.body.message || ''), reg.raw.slice(0, 200));
    ok('no verification code is handed back in the error response', !/\b\d{6}\b/.test(reg.raw), reg.raw.slice(0, 200));
    ok('nothing was created from an unproved address', ((JSON.parse(fs.readFileSync(path.join(DATA2, 'data.json'), 'utf8')).free2027 || {}).sessions || [{}])[0].participants === undefined ||
      (JSON.parse(fs.readFileSync(path.join(DATA2, 'data.json'), 'utf8')).free2027.sessions[0].participants || []).length === 0);
  } finally {
    try { child3.kill(); } catch (e) {}
  }
}

/* Phase two: the SAME data folder, opened by a server whose deployment has the
   central switch off. Nothing about the edition is reachable, and the original
   hub is exactly what it was. */
async function phaseTwo() {
  head('the edition switched off at the deployment level');
  stop();
  await new Promise(function (r) { setTimeout(r, 500); });
  var child2 = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027',
      GOC_DATA_DIR: DATA, GOC_FREE_2027: '0'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child2.stdout.on('data', function () {});
  child2.stderr.on('data', function () {});
  try {
    var r = await waitForBoot(40);
    ok('GOC_FREE_2027=0 switches the edition off completely', r.body && r.body.free2027 && r.body.free2027.on === false, r.raw);
    var c = await call('GET', '/api/free2027/config');
    ok('the config says so, so the page stays in Original Mode', c.body.on === false);
    var reg = await call('POST', '/api/free2027/register/start', { name: 'Zed', email: 'zed@example.com', course: 'Law' });
    ok('registration is refused while the switch is off', reg.status === 404, reg.status);
    var health = await call('GET', '/api/health');
    ok('the hub itself is untouched and still serving', health.status === 200 && health.body.service === 'goc-academy-hub');
  } finally {
    try { child2.kill(); } catch (e) {}
    /* let the port be released before phase three binds it again */
    await new Promise(function (r) { setTimeout(r, 700); });
  }
}
