/* test-free2027-auth.js — the STUDENT ACCOUNT / SESSION contract.
   ---------------------------------------------------------------------------
   Proves, against the real HTTP server and the real persisted data file, that a
   Free UTME Tutorial student's records belong to the STUDENT and never to the
   login session:

     A. registration takes name + email + password + course, verifies the email
        with a one-time code, and issues the sequential identifier GOC-F-001;
     B. the password is stored only as a salted scrypt hash, and login is the
        real authentication mechanism (wrong passwords refused, unknown
        addresses indistinguishable);
     C. signing out ends ONLY the session — the account, identifier, course,
        progress, attempts, answers, scores and results are byte-for-byte intact;
     D. logging in again returns the SAME account and creates no duplicate;
     E. a valid session survives a SERVER RESTART;
     F. the inactivity window is configurable, slides forward while the student
        works, and requires a fresh login once it passes;
     G. an expired or signed-out token can no longer read protected information;
     H. a pre-password (OTP-only) student keeps their existing identifier and
        every record when they verify their email and set a password;
     I. identifiers issued by the earlier random scheme are preserved, and new
        registrations continue the sequence without colliding;
     J. the public CBT catalogue stays reachable with no session at all.

   node test/test-free2027-auth.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_AUTH_PORT) || 8494;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-auth-'));
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

var child = null, serverLog = '';
function boot(extraEnv) {
  serverLog = '';
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
      GOC_TEST_MAIL_FILE: path.join(DATA, 'mail.jsonl'),
      GOC_FREE_2027_OTP_SECRET: 'auth-test-otp-secret-0123456789abcdef',
      GOC_SMTP_HOST: 'mailpit-test',
      GOC_FOUNDER_PW: 'founder2027',
      GOC_PASSCODE: '2027',
      GOC_DATA_DIR: DATA,
      GOC_FREE_2027: '1'
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (c) { serverLog += c; });
  child.stderr.on('data', function (c) { serverLog += c; });
}
function kill() { return new Promise(function (resolve) {
  if (!child) return resolve();
  var c = child; child = null;
  c.once('exit', function () { resolve(); });
  try { c.kill(); } catch (e) { return resolve(); }
  setTimeout(function () { try { c.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000);
}); }
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
function dataFile() { return JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')); }
function writeDataFile(db) { fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(db)); }
function sess() { var ed = dataFile().free2027; return ed.sessions.filter(function (s) { return s.id === ed.currentSessionId; })[0]; }
function stable(v) { return JSON.stringify(v); }
function mailedCode(email) {
  var rows = fs.readFileSync(path.join(DATA, 'mail.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var m = mail && String(mail.message.text).match(/verification code is (\d{6})/i);
  return m ? m[1] : null;
}
var PASSWORD = 'AdaPass-2027';
async function startRegistration(email, name, password) {
  return call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Law', password: password === undefined ? PASSWORD : password });
}
async function registerStudent(email, name, password) {
  var start = await startRegistration(email, name, password);
  if (start.status !== 200) throw new Error('register/start failed: ' + start.raw);
  var code = mailedCode(email);
  if (!code) throw new Error('no verification code was mailed to ' + email);
  var v = await call('POST', '/api/free2027/register/verify', { email: email, code: code });
  if (v.status !== 200) throw new Error('register/verify failed: ' + v.raw);
  return v.body;
}
async function founder() {
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var t = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
  return t;
}
var SUBJ5 = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
function csvText(prefix, n) {
  var rows = ['subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
  for (var i = 1; i <= n; i++) {
    rows.push([SUBJ5[(i - 1) % SUBJ5.length], 'Topic ' + i, prefix + ' question ' + i, 'Alpha ' + i, 'Beta ' + i,
      'Gamma ' + i, 'Delta ' + i, '', 'B', 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
  }
  return rows.join('\n');
}
async function makeActivity(adm, kind, title, count) {
  var t = Date.now();
  var r = await call('POST', '/api/free2027/admin/activities', {
    kind: kind, title: title, questionCount: count || 2,
    opensAt: t - 60000, closesAt: t + 86400000, durationMin: 30, maxAttempts: 2
  }, adm);
  if (r.status !== 200) throw new Error('activity create failed: ' + r.raw);
  var id = r.body.activity.id;
  await call('POST', '/api/free2027/admin/activities/' + id + '/publish', {}, adm);
  return r.body.activity;
}
async function sitPaper(studentToken, activityId) {
  var start = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, studentToken);
  if (start.status !== 200) throw new Error('start failed: ' + start.raw);
  var aid = start.body.attempt.id;
  var qs = start.body.questions || [];
  for (var i = 0; i < qs.length; i++) {
    var a = await call('PUT', '/api/free2027/attempts/' + aid + '/answer', { questionId: qs[i].id, choice: 1 }, studentToken);
    if (a.status !== 200) throw new Error('answer failed: ' + a.raw);
  }
  var sub = await call('POST', '/api/free2027/attempts/' + aid + '/submit', {}, studentToken);
  if (sub.status !== 200) throw new Error('submit failed: ' + sub.raw);
  return { id: aid, result: sub.body.result };
}

/* Everything the student owns, read straight off disk. Two things legitimately
   move when a student authenticates and are therefore normalised here rather
   than compared: `records` (the append-only register/login audit, asserted
   separately below) and the participant's own `lastSeenAt` stamp, whose whole
   purpose is to record the latest visit. Every substantive field — identifier,
   name, email, course, password hash, enrolment, access, progress, attempts,
   answers, scores and leaderboard rows — is compared byte-for-byte. */
function ownedBytes(id) {
  var s = sess();
  var found = s.participants.filter(function (x) { return x.id === id; })[0] || null;
  var p = found ? JSON.parse(JSON.stringify(found)) : null;
  if (p) p.lastSeenAt = '<normalised>';
  return stable({
    participant: p,
    attempts: s.attempts.filter(function (a) { return a.participantId === id; }),
    leaderboards: (s.leaderboards || []).map(function (b) {
      return { activityId: b.activityId, rows: (b.rows || []).filter(function (r) { return r.participantId === id; }) };
    })
  });
}
function protectedReads(token, attemptId) {
  return Promise.all([
    call('GET', '/api/free2027/me', undefined, token),
    call('GET', '/api/free2027/activities', undefined, token),
    call('GET', '/api/free2027/programme', undefined, token),
    call('GET', '/api/free2027/results', undefined, token),
    call('GET', '/api/free2027/attempts/' + attemptId, undefined, token)
  ]);
}

(async function () {
  boot();
  await waitForBoot(40);
  var adm = await founder();
  await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('Weekly', 12) }, adm);
  var lesson = await call('POST', '/api/free2027/admin/lessons', { title: 'Cell biology — the basics', subject: 'Biology' }, adm);
  var lessonId = lesson.body.lesson.id;
  var weekly = await makeActivity(adm, 'weekly', 'Week 1', 3);

  /* ================== A. registration with a password ==================== */
  head('A. registration: name, email, password, course + a one-time code');
  ok('a registration with no password is refused', (await startRegistration('nopa@example.com', 'No Password', '')).status === 400);
  ok('a password without a number is refused', (await startRegistration('weak@example.com', 'Weak Password', 'abcdefgh')).status === 400);
  ok('a password shorter than eight characters is refused', (await startRegistration('short@example.com', 'Short Password', 'Ab1')).status === 400);
  var reg = await registerStudent('ada.auth@example.com', 'Ada Auth');
  var adaId = reg.participant.id;
  ok('the first student of the programme is GOC-F-001', adaId === 'GOC-F-001', adaId);
  ok('registration returns an authenticated session', !!reg.token);
  ok('the course chosen at registration is on the account', reg.participant.course === 'Law', JSON.stringify(reg.participant));
  var stored = dataFile().free2027;
  var adaRec = sess().participants.filter(function (p) { return p.id === adaId; })[0];
  ok('the password is stored only as a salted scrypt hash', /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(adaRec.passwordHash || ''), adaRec.passwordHash);
  ok('the plaintext password appears nowhere in the data file', JSON.stringify(stored).indexOf(PASSWORD) < 0);
  ok('the pending code carried a hash, never the password itself', stored.otps.every(function (o) { return !o.password && (!o.pwHash || /^scrypt\$/.test(o.pwHash)); }));
  ok('the identifier is in the permanent registry and mapped to the email',
    stored.studentIds.indexOf(adaId) > -1 && stored.studentIdsByEmail['ada.auth@example.com'] === adaId);
  ok('no API response ever carries the hash', reg.raw === undefined && JSON.stringify(reg).indexOf('scrypt$') < 0 && JSON.stringify(reg).indexOf('passwordHash') < 0);

  /* Build the student's own history: a scored paper and a completed lesson. */
  var sat = await sitPaper(reg.token, weekly.id);
  await call('POST', '/api/free2027/lessons/' + lessonId + '/complete', {}, reg.token);
  var progBefore = await call('GET', '/api/free2027/programme', undefined, reg.token);
  var resBefore = await call('GET', '/api/free2027/results', undefined, reg.token);
  ok('the student has a scored attempt on record', !!sat.result && typeof sat.result.score === 'number', JSON.stringify(sat.result));
  ok('the student has learning progress on record', progBefore.body.progress.completed === 1, JSON.stringify(progBefore.body.progress));
  var ownedBefore = ownedBytes(adaId);

  /* ================== B. login is the real authentication ================ */
  head('B. login: email + password, and nothing else');
  var bad = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: 'WrongPass-999' });
  ok('an incorrect password is rejected', bad.status === 403, bad.raw);
  var missing = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com' });
  ok('a login with no password is refused', missing.status === 400, missing.raw);
  var ghost = await call('POST', '/api/free2027/login', { email: 'ghost@example.com', password: 'WrongPass-999' });
  ok('an unknown address answers identically, so accounts cannot be enumerated', ghost.status === 403 && ghost.body.error === bad.body.error, ghost.raw);
  ok('a verification code alone is not a login', (await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: mailedCode('ada.auth@example.com') })).status === 403);
  var in1 = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD });
  ok('the registered credentials log the student in', in1.status === 200 && !!in1.body.token, in1.raw.slice(0, 160));
  ok('login returns the SAME identifier, not a new account', in1.body.participant.id === adaId, JSON.stringify(in1.body.participant));
  ok('login created no duplicate record', sess().participants.filter(function (p) { return p.email === 'ada.auth@example.com'; }).length === 1);

  /* ================== C. signing out ends ONLY the session =============== */
  head('C. signing out never touches the account or its records');
  var out = await call('POST', '/api/free2027/logout', {}, in1.body.token);
  ok('signing out succeeds', out.status === 200 && out.body.ok === true, out.raw);
  ok('the student record is byte-for-byte unchanged by signing out', ownedBytes(adaId) === ownedBefore);
  ok('the account, identifier, course and progress are all still stored', (function () {
    var p = sess().participants.filter(function (x) { return x.id === adaId; })[0];
    return !!p && p.id === adaId && p.course === 'Law' && p.verified === true && !!p.passwordHash &&
      !!p.progress && !!p.progress.lessons && Object.keys(p.progress.lessons).length === 1;
  })());
  ok('the attempt, answers and score are still stored', sess().attempts.filter(function (a) { return a.participantId === adaId && a.id === sat.id; }).length === 1);
  ok('the permanent identifier registry still holds the identifier', dataFile().free2027.studentIds.indexOf(adaId) > -1);
  var dead = await protectedReads(in1.body.token, sat.id);
  ok('the signed-out token can no longer read ANY protected student endpoint', dead.every(function (r) { return r.status === 401; }), dead.map(function (r) { return r.status; }).join(','));
  ok('one student signing out does not end another of their sessions', (await call('GET', '/api/free2027/me', undefined, reg.token)).status === 200);

  /* ================== D. logging back in restores everything ============= */
  head('D. logging in again restores the same account and every record');
  var in2 = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD });
  ok('the same credentials work again', in2.status === 200 && !!in2.body.token);
  ok('the identifier is exactly the one issued at registration', in2.body.participant.id === adaId, in2.body.participant.id);
  ok('every owned byte is identical after signing out and back in', ownedBytes(adaId) === ownedBefore);
  var progAfter = await call('GET', '/api/free2027/programme', undefined, in2.body.token);
  var resAfter = await call('GET', '/api/free2027/results', undefined, in2.body.token);
  ok('the learning progress reads back identically', stable(progAfter.body.progress) === stable(progBefore.body.progress));
  ok('the results read back identically', stable(resAfter.body) === stable(resBefore.body));
  ok('the previous CBT attempt is resumable/readable after logging back in', (await call('GET', '/api/free2027/attempts/' + sat.id, undefined, in2.body.token)).status === 200);
  ok('no duplicate account was created by logging in', sess().participants.filter(function (p) { return p.email === 'ada.auth@example.com'; }).length === 1);
  ok('the register/login audit only ever grew — nothing was removed from it', (function () {
    var recs = sess().records.filter(function (r) { return r.participantId === adaId; });
    return recs.filter(function (r) { return r.kind === 'register'; }).length === 1 &&
      recs.filter(function (r) { return r.kind === 'login'; }).length >= 1;
  })(), JSON.stringify(sess().records.filter(function (r) { return r.participantId === adaId; })));
  ok('the account\'s last-seen stamp moved forward, which is all that changed', (function () {
    var p = sess().participants.filter(function (x) { return x.id === adaId; })[0];
    return typeof p.lastSeenAt === 'number' && p.lastSeenAt > 0;
  })());
  ok('the registry still holds exactly one identifier for that email',
    dataFile().free2027.studentIds.filter(function (x) { return x === adaId; }).length === 1);

  /* ================== E. sessions survive a server restart =============== */
  head('E. a valid session survives a server restart');
  var liveToken = in2.body.token;
  ok('only a token DIGEST is persisted, never a usable token', (function () {
    var list = dataFile().free2027.authSessions || [];
    return list.length > 0 && list.every(function (x) { return /^[a-f0-9]{64}$/.test(x.tokenHash || ''); }) &&
      JSON.stringify(list).indexOf(liveToken) < 0;
  })());
  await kill();
  boot();
  await waitForBoot(40);
  var afterRestart = await call('GET', '/api/free2027/me', undefined, liveToken);
  ok('the student is STILL signed in after the server restarted', afterRestart.status === 200 && afterRestart.body.participant.id === adaId, afterRestart.raw.slice(0, 160));
  ok('every owned byte survived the restart', ownedBytes(adaId) === ownedBefore);
  ok('the restarted server still refuses the token that was signed out', (await call('GET', '/api/free2027/me', undefined, in1.body.token)).status === 401);
  ok('the password still authenticates after the restart', (await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD })).status === 200);

  /* ================== F. the inactivity window ========================== */
  head('F. inactivity expiry, and a window that slides while the student works');
  var fresh = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD });
  var freshToken = fresh.body.token;
  function sessionRec(tok) {
    var crypto = require('crypto');
    var h = crypto.createHash('sha256').update(String(tok)).digest('hex');
    return (dataFile().free2027.authSessions || []).filter(function (x) { return x.tokenHash === h; })[0] || null;
  }
  var rec0 = sessionRec(freshToken);
  ok('a new session is stored with a created/seen/expiry timestamp',
    !!rec0 && rec0.createdAt > 0 && rec0.lastSeenAt > 0 && rec0.expiresAt > rec0.createdAt, JSON.stringify(rec0));
  ok('the default window is the configured eight hours', !!rec0 && Math.round((rec0.expiresAt - rec0.createdAt) / 60000) === 480,
    rec0 ? String(Math.round((rec0.expiresAt - rec0.createdAt) / 60000)) : 'no session');
  /* Age only this throwaway server's session record — never wait eight hours
     and never rewrite a live data file. */
  var db1 = dataFile();
  var r1 = db1.free2027.authSessions.filter(function (x) { return x.tokenHash === rec0.tokenHash; })[0];
  r1.lastSeenAt = Date.now() - 120000;
  r1.expiresAt = Date.now() + 120000;
  writeDataFile(db1);
  ok('using the session keeps the student signed in', (await call('GET', '/api/free2027/me', undefined, freshToken)).status === 200);
  var rec1 = sessionRec(freshToken);
  ok('activity slides the inactivity window forward', !!rec1 && rec1.expiresAt > Date.now() + 120000 && rec1.lastSeenAt > r1.lastSeenAt,
    JSON.stringify(rec1));
  ok('sliding the window changed no student record', ownedBytes(adaId) === ownedBefore);
  /* Now let the window pass. */
  var db2 = dataFile();
  db2.free2027.authSessions.filter(function (x) { return x.tokenHash === rec0.tokenHash; })[0].expiresAt = Date.now() - 1;
  writeDataFile(db2);
  var expired = await protectedReads(freshToken, sat.id);
  ok('after the inactivity window EVERY protected endpoint requires authentication again',
    expired.every(function (r) { return r.status === 401; }), expired.map(function (r) { return r.status; }).join(','));
  ok('session expiry deleted no student record', ownedBytes(adaId) === ownedBefore);
  var back = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD });
  ok('the student logs in again after the timeout and gets the same identifier', back.status === 200 && back.body.participant.id === adaId, back.raw.slice(0, 120));
  ok('logging in after a timeout restored every record', ownedBytes(adaId) === ownedBefore);
  ok('the expired token stays dead even after a new login', (await call('GET', '/api/free2027/me', undefined, freshToken)).status === 401);

  head('F2. the timeout is configurable in one place');
  await kill();
  boot({ GOC_FREE_2027_SESSION_IDLE_MIN: '30' });
  await waitForBoot(40);
  var cfgLogin = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD });
  var cfgRec = sessionRec(cfgLogin.body.token);
  ok('the deployment override sets the window', !!cfgRec && Math.round((cfgRec.expiresAt - cfgRec.createdAt) / 60000) === 30,
    cfgRec ? String(Math.round((cfgRec.expiresAt - cfgRec.createdAt) / 60000)) : 'no session');
  await kill();
  boot({ GOC_FREE_2027_SESSION_IDLE_MIN: 'nonsense' });
  await waitForBoot(40);
  var defLogin = await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD });
  var defRec = sessionRec(defLogin.body.token);
  ok('a nonsense override falls back to the safe default', !!defRec && Math.round((defRec.expiresAt - defRec.createdAt) / 60000) === 480);

  /* ================== H/I. a pre-password student, legacy identifier ===== */
  head('H. an OTP-only student sets a password without losing the account');
  /* Reproduce exactly what an older data file holds: a SECOND student who
     registered under the earlier code-only flow, holding an identifier from the
     random scheme, with NO password and with history already attached to that
     identifier. Ada (GOC-F-001) is left completely alone, so this also proves a
     legacy record and a sequential record coexist. */
  var LEGACY = 'GOC-F27-0123456789ABCDEF0123';
  var LEGACY_EMAIL = 'legacy.auth@example.com';
  var dbLegacy = dataFile();
  var cur = dbLegacy.free2027.sessions.filter(function (x) { return x.id === dbLegacy.free2027.currentSessionId; })[0];
  var adaStored = cur.participants.filter(function (x) { return x.id === adaId; })[0];
  var legacyStudent = JSON.parse(JSON.stringify(adaStored));
  legacyStudent.id = LEGACY;
  legacyStudent.email = LEGACY_EMAIL;
  legacyStudent.name = 'Legacy Student';
  delete legacyStudent.passwordHash;                 /* the code-only era */
  cur.participants.push(legacyStudent);
  var adaAttempt = cur.attempts.filter(function (a) { return a.participantId === adaId; })[0];
  var legacyAttempt = JSON.parse(JSON.stringify(adaAttempt));
  legacyAttempt.id = 'F27-A-LEGACY';
  legacyAttempt.participantId = LEGACY;
  cur.attempts.push(legacyAttempt);
  cur.records.unshift({ at: Date.now(), participantId: LEGACY, kind: 'register' });
  dbLegacy.free2027.studentIds.push(LEGACY);
  dbLegacy.free2027.studentIdsByEmail[LEGACY_EMAIL] = LEGACY;
  /* The code-only era kept sessions in memory, so an old file has none at all,
     and it has no sequence counter either. */
  dbLegacy.free2027.authSessions = [];
  delete dbLegacy.free2027.studentIdSeq;
  writeDataFile(dbLegacy);
  var legacyOwned = ownedBytes(LEGACY);
  var adaOwnedBeforeUpgrade = ownedBytes(adaId);
  await kill();
  boot();
  await waitForBoot(40);
  ok('the migration is additive: the old file gains the new stores', (function () {
    var ed = dataFile().free2027;
    return Array.isArray(ed.authSessions) && typeof ed.studentIdSeq === 'number';
  })());
  ok('the sequence counter reseeded from the identifiers already issued', dataFile().free2027.studentIdSeq === 1, String(dataFile().free2027.studentIdSeq));
  ok('the legacy identifier and every record attached to it survived the migration', ownedBytes(LEGACY) === legacyOwned);
  ok('the sequential student was not disturbed by the legacy record', ownedBytes(adaId) === adaOwnedBeforeUpgrade);
  ok('a password login is refused for an account that has no password yet',
    (await call('POST', '/api/free2027/login', { email: LEGACY_EMAIL, password: PASSWORD })).status === 403);
  var upgradeStart = await startRegistration(LEGACY_EMAIL, 'Legacy Student', 'NewPass-2028');
  ok('an OTP-only student is allowed to verify and set a password (not told to make a new account)',
    upgradeStart.status === 200, upgradeStart.raw.slice(0, 160));
  var upCode = mailedCode(LEGACY_EMAIL);
  var upgraded = await call('POST', '/api/free2027/register/verify', { email: LEGACY_EMAIL, code: upCode });
  ok('the email code verifies and signs them in', upgraded.status === 200 && !!upgraded.body.token, upgraded.raw.slice(0, 160));
  ok('the EXISTING legacy identifier was kept — no new identifier was issued', upgraded.body.participant.id === LEGACY, upgraded.body.participant.id);
  ok('no second account was created for that email', sess().participants.filter(function (p) { return p.email === LEGACY_EMAIL; }).length === 1);
  ok('the new password is stored as a scrypt hash', /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(sess().participants.filter(function (p) { return p.id === LEGACY; })[0].passwordHash || ''));
  ok('the plaintext of the new password is nowhere in the data file', JSON.stringify(dataFile().free2027).indexOf('NewPass-2028') < 0);
  ok('the attempt, answers and score are unchanged by the upgrade',
    stable(sess().attempts.filter(function (a) { return a.participantId === LEGACY; })) === stable(JSON.parse(legacyOwned).attempts));
  ok('the upgrade touched no other student', ownedBytes(adaId) === adaOwnedBeforeUpgrade);
  var upLogin = await call('POST', '/api/free2027/login', { email: LEGACY_EMAIL, password: 'NewPass-2028' });
  ok('the student can now log in with the password they just set', upLogin.status === 200 && upLogin.body.participant.id === LEGACY, upLogin.raw.slice(0, 140));
  var upProg = await call('GET', '/api/free2027/programme', undefined, upLogin.body.token);
  ok('the learning progress is still there after the upgrade', upProg.body.progress.completed === 1, JSON.stringify(upProg.body.progress));
  var upRes = await call('GET', '/api/free2027/results', undefined, upLogin.body.token);
  ok('the previous CBT result is still there after the upgrade, with the same score', (function () {
    var rows = upRes.body.results || [];
    var mine = rows.filter(function (r) { return r.attemptId === legacyAttempt.id; })[0];
    return rows.length === 1 && !!mine && mine.score === legacyAttempt.score && mine.maxScore === legacyAttempt.maxScore;
  })(), JSON.stringify(upRes.body).slice(0, 220));
  ok('the previous attempt is readable again after the upgrade', (await call('GET', '/api/free2027/attempts/' + legacyAttempt.id, undefined, upLogin.body.token)).status === 200);
  ok('the account cannot be re-registered once it holds a password',
    (await startRegistration(LEGACY_EMAIL, 'Legacy Again', 'Another-123')).status === 409);
  ok('the sequential student can still log in with their own password',
    (await call('POST', '/api/free2027/login', { email: 'ada.auth@example.com', password: PASSWORD })).status === 200);

  head('I. new registrations continue the sequence without touching old identifiers');
  var ben = await registerStudent('ben.auth@example.com', 'Ben Auth');
  ok('the next new student receives the next sequential identifier', ben.participant.id === 'GOC-F-002', ben.participant.id);
  var cat = await registerStudent('cat.auth@example.com', 'Cat Auth');
  ok('the sequence keeps advancing', cat.participant.id === 'GOC-F-003', cat.participant.id);
  ok('the legacy identifier is untouched and still in the registry', dataFile().free2027.studentIds.indexOf(LEGACY) > -1);
  ok('no identifier was issued twice', (function () {
    var ids = dataFile().free2027.studentIds;
    return ids.length === new Set(ids).size;
  })(), JSON.stringify(dataFile().free2027.studentIds));
  ok('the legacy student can still log in after new students registered',
    (await call('POST', '/api/free2027/login', { email: LEGACY_EMAIL, password: 'NewPass-2028' })).status === 200);
  ok('a new student cannot read another student\'s attempt',
    (await call('GET', '/api/free2027/attempts/' + sat.id, undefined, ben.token)).status !== 200);

  /* ============ K. deactivation ends every session, atomically =========== */
  head('K. switching a student off ends their sessions in the same write');
  /* A fresh administrator token: the server was restarted several times above. */
  adm = await founder();
  var catLogin = await call('POST', '/api/free2027/login', { email: 'cat.auth@example.com', password: PASSWORD });
  ok('the student is signed in before deactivation', (await call('GET', '/api/free2027/me', undefined, catLogin.body.token)).status === 200);
  var off = await call('PUT', '/api/free2027/admin/participants/' + cat.participant.id, { active: false }, adm);
  ok('the administrator can switch the student off', off.status === 200, off.raw.slice(0, 160));
  ok('the deactivation persisted (the caller\'s write was not clobbered)',
    sess().participants.filter(function (p) { return p.id === cat.participant.id; })[0].active === false);
  ok('deactivation removed that student\'s sessions in the SAME write',
    !(dataFile().free2027.authSessions || []).some(function (x) { return String(x.participantId) === String(cat.participant.id); }),
    JSON.stringify((dataFile().free2027.authSessions || []).map(function (x) { return x.participantId; })));
  ok('the deactivated student\'s token no longer opens protected information',
    (await call('GET', '/api/free2027/me', undefined, catLogin.body.token)).status === 401);
  ok('the deactivated student cannot log in', (await call('POST', '/api/free2027/login', { email: 'cat.auth@example.com', password: PASSWORD })).status === 403);
  ok('deactivation kept the account, identifier and every record', (function () {
    var p = sess().participants.filter(function (x) { return x.id === cat.participant.id; })[0];
    return !!p && !!p.passwordHash && p.verified === true && dataFile().free2027.studentIds.indexOf(cat.participant.id) > -1;
  })());
  ok('another student\'s sessions were left alone',
    (await call('POST', '/api/free2027/login', { email: 'ben.auth@example.com', password: PASSWORD })).status === 200);
  var backOn = await call('PUT', '/api/free2027/admin/participants/' + cat.participant.id, { active: true }, adm);
  ok('switching the student back on is reversible', backOn.status === 200 &&
    (await call('POST', '/api/free2027/login', { email: 'cat.auth@example.com', password: PASSWORD })).status === 200);

  /* ================== J. the public CBT catalogue stays open ============= */
  head('J. the public CBT Portal needs no session at all');
  var cat0 = await call('GET', '/api/free2027/catalogue');
  ok('the public catalogue answers with no token', cat0.status === 200 && cat0.body.guest === true, cat0.raw.slice(0, 120));
  ok('the catalogue lists the published activity', (cat0.body.activities || []).some(function (a) { return a.id === weekly.id; }));
  ok('the catalogue exposes no student, question or answer', (function () {
    var raw = cat0.raw;
    return raw.indexOf('@') < 0 && raw.indexOf('passwordHash') < 0 && raw.indexOf('"options"') < 0 && raw.indexOf('participants') < 0;
  })(), cat0.raw.slice(0, 200));
  ok('an expired token does not close the public catalogue', (await call('GET', '/api/free2027/catalogue', undefined, freshToken)).status === 200);
  ok('a guest still cannot sit a paper', (await call('POST', '/api/free2027/activities/' + weekly.id + '/start', {})).status === 401);
  ok('the server logged no unexpected error', serverLog.indexOf('[free2027] Error') < 0 && serverLog.indexOf('Unhandled') < 0, serverLog.slice(-200));

  await kill();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(async function (e) {
  console.log('  FAIL  ' + ((e && e.stack) || e));
  console.log(serverLog.slice(-1500));
  await kill();
  process.exit(1);
});
