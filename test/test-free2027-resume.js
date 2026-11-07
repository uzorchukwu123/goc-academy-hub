/* test-free2027-resume.js — an existing standard UTME attempt resumes from its
   saved paper after the live bank falls below 180, while a NEW attempt is still
   refused. Real HTTP against a disposable local server; Appwrite is disabled.

   The bank starts at exactly 60/40/40/40. Existing candidates start and save
   answers before any fixture change. Deactivation/edit/replacement then tests
   both resume entry points, the clock, answer validation, submission, review,
   expiry and the launch gate without changing production records.
   node test/test-free2027-resume.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_RESUME_PORT) || 8247;
var DIST = { 'Use of English': 60, 'Mathematics': 40, 'Physics': 40, 'Chemistry': 40 };
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 260) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-resume-'));
var DATA = path.join(SANDBOX, 'data');
var MAIL_FILE = path.join(DATA, 'mail-capture.jsonl');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  if (fs.existsSync(path.join(APP, f))) fs.cpSync(path.join(APP, f), path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var serverLog = '', stopped = false, db;
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
    GOC_TEST_MAIL_FILE: MAIL_FILE,
    GOC_FREE_2027_OTP_SECRET: 'resume-test-otp-secret-0123456789abcdef',
    GOC_SMTP_HOST: 'mailpit-test',
    GOC_FOUNDER_PW: 'resume-test-founder',
    GOC_ACADDIR_PW: 'resume-test-acaddir',
    GOC_PASSCODE: '2027',
    GOC_DATA_DIR: DATA,
    GOC_FREE_2027: '1',
    GOC_APPWRITE_OFF: '1',
    APPWRITE_ENDPOINT: '', APPWRITE_PROJECT_ID: '', APPWRITE_API_KEY: ''
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function stop() {
  if (stopped) return;
  stopped = true;
  try { child.kill(); } catch (e) {}
  try { child.unref(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}
process.on('exit', stop);

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
    req.setTimeout(15000, function () { req.destroy(new Error('test request timeout')); });
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').then(function (h) {
    if (h.status === 200 || tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 150); }).then(function () { return waitForBoot(tries - 1); });
  });
}
function dataFile() { return JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')); }
function saveData(db) { fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(db)); }
function session() { var db = dataFile(); return db.free2027.sessions.filter(function (s) { return s.id === db.free2027.currentSessionId; })[0]; }
function storedAttempt(id) { return session().attempts.filter(function (a) { return a.id === id; })[0]; }
function csv(prefix, distribution) {
  var rows = ['subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
  Object.keys(distribution).forEach(function (subject) {
    for (var i = 1; i <= distribution[subject]; i++) {
      rows.push([subject, subject + ' topic ' + i, prefix + ' ' + subject + ' original question ' + i,
        'Original A ' + i, 'Original B ' + i, 'Original C ' + i, 'Original D ' + i, '', 'B', 'easy', '', 'TRUE', '', ''].join(','));
    }
  });
  return rows.join('\n');
}
function register(name, email) {
  return call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Law', password: 'Resume-Test-2027' })
    .then(function (r) {
      if (r.status !== 200) throw new Error('register/start failed: ' + r.raw);
      var rows = fs.readFileSync(MAIL_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
      var code = String(mail.message.text).match(/verification code is (\d{6})/i)[1];
      return call('POST', '/api/free2027/register/verify', { email: email, code: code });
    }).then(function (r) {
      if (r.status !== 200) throw new Error('register/verify failed: ' + r.raw);
      return { token: r.body.token, participant: r.body.participant };
    });
}
function displayedCorrect(servedQuestion, original) {
  return servedQuestion.options.indexOf(original.options[Number(original.answer)]);
}
function subjectCounts(questions) {
  var out = {};
  questions.forEach(function (q) { out[q.subject] = (out[q.subject] || 0) + 1; });
  return out;
}
function samePaper(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

(async function () {
  try {
    var h = await waitForBoot(60);
    ok('the isolated server boots', h.status === 200, h.raw);
    ok('the run is explicitly local-only', /GOC_APPWRITE_OFF is set/.test(serverLog), serverLog.slice(-300));
    var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'resume-test-founder' });
    var adm = lin.body && lin.body.token;
    await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
    var imp = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csv('UTME', DIST) }, adm);
    ok('the competition bank imports exactly 180 questions', imp.status === 200 && imp.body.imported === 180, imp.raw);
    var originalBank = clone(dataFile().free2027.questionBanks.competition.questions);
    var byId = {};
    originalBank.forEach(function (q) { byId[q.id] = q; });
    var ada = await register('Ada Resume', 'ada-resume@example.com');
    var ben = await register('Ben New', 'ben-new@example.com');
    var cat = await register('Cat Expiry', 'cat-expiry@example.com');
    var t = Date.now();
    var made = await call('POST', '/api/free2027/admin/activities', {
      kind: 'competition', title: 'Resume Standard UTME', questionCount: 180, subjectDistribution: DIST,
      opensAt: t - 60000, closesAt: t + 7200000, durationMin: 120, maxAttempts: 1,
      randomizeQuestions: false, randomizeOptions: true, status: 'draft'
    }, adm);
    ok('the standard competition is created', made.status === 200, made.raw);
    var activityId = made.body.activity.id;
    var draft = await call('POST', '/api/free2027/admin/activities', {
      kind: 'competition', title: 'Draft Standard UTME', questionCount: 180, subjectDistribution: DIST,
      opensAt: t - 60000, closesAt: t + 7200000, durationMin: 120, maxAttempts: 1, status: 'draft'
    }, adm);
    ok('a second standard competition stays draft for the launch check', draft.status === 200, draft.raw);
    var pub = await call('POST', '/api/free2027/admin/activities/' + activityId + '/publish', {}, adm);
    ok('the complete standard competition publishes', pub.status === 200, pub.raw);

    head('Scenario A: existing attempts are saved before the bank changes');
    var start = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, ada.token);
    ok('Ada starts a 180-question paper', start.status === 200 && start.body.questions.length === 180, start.raw.slice(0, 180));
    var attemptId = start.body.attempt.id;
    var served = clone(start.body.questions);
    var initialClock = clone(start.body.attempt);
    var snapshotBefore = JSON.stringify(storedAttempt(attemptId).questionSnapshot);
    ok('the server saves the exact served snapshot', storedAttempt(attemptId).questionSnapshot.length === 180 &&
      served.every(function (q, i) { return q.id === storedAttempt(attemptId).questionSnapshot[i].id; }));
    ok('the served paper has the required distribution', samePaper(subjectCounts(served), DIST), JSON.stringify(subjectCounts(served)));
    var english = served.filter(function (q) { return q.subject === 'Use of English'; })[0];
    var maths = served.filter(function (q) { return q.subject === 'Mathematics'; })[0];
    var physics = served.filter(function (q) { return q.subject === 'Physics'; })[0];
    var englishCorrect = displayedCorrect(english, byId[english.id]);
    var mathsWrong = (displayedCorrect(maths, byId[maths.id]) + 1) % maths.options.length;
    ok('Ada saves a correct English answer', (await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: english.id, choice: englishCorrect }, ada.token)).status === 200);
    ok('Ada saves an incorrect Mathematics answer', (await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: maths.id, choice: mathsWrong }, ada.token)).status === 200);
    var responsesBefore = JSON.stringify(storedAttempt(attemptId).responses);
    var savedResume = await call('GET', '/api/free2027/attempts/' + attemptId, undefined, ada.token);
    ok('the saved answers are readable before the bank changes', savedResume.status === 200 && Object.keys(savedResume.body.attempt.responses).length === 2);
    var displayedResponsesBefore = JSON.stringify(savedResume.body.attempt.responses);
    var catStart = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, cat.token);
    ok('Cat also has an existing valid attempt', catStart.status === 200 && catStart.body.questions.length === 180, catStart.raw.slice(0, 180));
    var catId = catStart.body.attempt.id;
    var catQuestion = catStart.body.questions[0];
    var catChoice = displayedCorrect(catQuestion, byId[catQuestion.id]);
    await call('PUT', '/api/free2027/attempts/' + catId + '/answer', { questionId: catQuestion.id, choice: catChoice }, cat.token);
    var attemptsBefore = session().attempts.length;
    var recordsBefore = session().records.length;
    var seqBefore = session().attemptSeq;
    await new Promise(function (r) { setTimeout(r, 1100); });

    head('The live bank falls below 180 and one question is edited');
    db = dataFile();
    var englishRows = db.free2027.questionBanks.competition.questions.filter(function (q) { return q.subject === 'Use of English'; });
    englishRows[0].active = false;
    englishRows[1].active = false;
    englishRows[0].text = 'LIVE EDIT AFTER ADA STARTED';
    englishRows[0].options = ['replacement A', 'replacement B'];
    englishRows[0].answer = 1;
    englishRows[0].updatedAt = Date.now();
    saveData(db);
    var list = await call('GET', '/api/free2027/admin/activities', undefined, adm);
    var launch = list.body.activities.filter(function (a) { return a.id === activityId; })[0].launch;
    ok('launch readiness reports the shortfall', launch.ok === false && launch.available === 178 && launch.needed === 2, JSON.stringify(launch));
    ok('launch readiness keeps the subject counts honest', launch.bySubject['Use of English'] === 58 && launch.bySubject.Mathematics === 40, JSON.stringify(launch.bySubject));

    var resumeGet = await call('GET', '/api/free2027/attempts/' + attemptId, undefined, ada.token);
    ok('GET resume remains available despite the launch shortfall', resumeGet.status === 200 && resumeGet.body.resumed === true, resumeGet.raw.slice(0, 180));
    ok('GET resume returns the saved paper, not the live edit', resumeGet.status === 200 && samePaper(resumeGet.body.questions, served));
    ok('GET resume keeps the same attempt ID and start time', resumeGet.status === 200 && resumeGet.body.attempt.id === attemptId && resumeGet.body.attempt.startedAt === initialClock.startedAt);
    ok('GET resume preserves the deadline and runs the clock down', resumeGet.status === 200 && resumeGet.body.attempt.deadline === initialClock.deadline &&
      resumeGet.body.attempt.remainingSec < initialClock.remainingSec && resumeGet.body.attempt.remainingSec > 0, JSON.stringify(resumeGet.body.attempt));
    ok('GET resume preserves the saved answers in both payload and storage',
      resumeGet.status === 200 && JSON.stringify(resumeGet.body.attempt.responses) === displayedResponsesBefore &&
      JSON.stringify(storedAttempt(attemptId).responses) === responsesBefore);
    var resumePost = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, ada.token);
    ok('POST start resumes the same existing attempt', resumePost.status === 200 && resumePost.body.resumed === true && resumePost.body.attempt.id === attemptId, resumePost.raw.slice(0, 180));
    ok('POST start also returns the saved paper', resumePost.status === 200 && samePaper(resumePost.body.questions, served));
    ok('resumption creates no attempt or start record', session().attempts.length === attemptsBefore && session().records.length === recordsBefore && session().attemptSeq === seqBefore);
    ok('resumption does not consume an attempt', resumePost.status === 200 && resumePost.body.attempt.attemptsUsed === 0);
    ok('the saved snapshot itself is unchanged', JSON.stringify(storedAttempt(attemptId).questionSnapshot) === snapshotBefore);
    var physicsCorrect = displayedCorrect(physics, byId[physics.id]);
    var saveAfterResume = await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: physics.id, choice: physicsCorrect }, ada.token);
    ok('a resumed answer is validated against the saved options', saveAfterResume.status === 200, saveAfterResume.raw);
    var editAttemptAnswer = await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: english.id, choice: 3 }, ada.token);
    ok('an option removed from the live bank remains valid on the saved paper', editAttemptAnswer.status === 200, editAttemptAnswer.raw);

    head('Scenario B: a different candidate cannot start a short paper');
    var blocked = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, ben.token);
    ok('a new attempt is refused with 409 and the exact shortfall', blocked.status === 409 && /178\/180/.test(blocked.body.error) && /Additional questions required: 2/.test(blocked.body.error), blocked.raw);
    ok('the rejected start creates no attempt, record or sequence increment', session().attempts.length === attemptsBefore && session().records.length === recordsBefore && session().attemptSeq === seqBefore);
    var draftBlocked = await call('POST', '/api/free2027/admin/activities/' + draft.body.activity.id + '/publish', {}, adm);
    ok('publication still enforces the same gate', draftBlocked.status === 409 && /178\/180/.test(draftBlocked.body.error), draftBlocked.raw);

    head('Deletion, replacement and spare questions do not weaken the gate');
    var mathIds = originalBank.filter(function (q) { return q.subject === 'Mathematics'; }).slice(0, 3).map(function (q) { return q.id; });
    var del = await call('POST', '/api/free2027/admin/question-banks/competition/questions/delete', { ids: mathIds, confirm: true }, adm);
    ok('three allocated Mathematics questions are deleted and archived', del.status === 200 && del.body.deleted === 3 && del.body.preservedForHistory === 3, del.raw);
    db = dataFile();
    var replacement = Object.assign({}, clone(byId[mathIds[0]]), {
      text: 'REUSED LIVE ID AFTER DELETION', options: ['new A', 'new B'], answer: 0, active: false,
      createdAt: Date.now(), updatedAt: Date.now(), importedAt: Date.now()
    });
    db.free2027.questionBanks.competition.questions.push(replacement);
    saveData(db);
    var afterDeletion = await call('GET', '/api/free2027/attempts/' + attemptId, undefined, ada.token);
    ok('resume still uses the snapshot after deletion and live-ID replacement', afterDeletion.status === 200 && samePaper(afterDeletion.body.questions, served));
    var spareC = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csv('Spare', { Biology: 12 }) }, adm);
    var spareW = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csv('Weekly spare', DIST) }, adm);
    ok('spare questions exist in both banks', spareC.status === 200 && spareW.status === 200);
    var stillBlocked = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, ben.token);
    ok('spares cannot pad the fixed allocation or cross the bank boundary', stillBlocked.status === 409 && /175\/180/.test(stillBlocked.body.error), stillBlocked.raw);
    var launchAfter = (await call('GET', '/api/free2027/admin/activities', undefined, adm)).body.activities.filter(function (a) { return a.id === activityId; })[0].launch;
    ok('the subject distribution still reports the actual shortage', launchAfter.ok === false && launchAfter.bySubject['Use of English'] === 58 && launchAfter.bySubject.Mathematics === 37, JSON.stringify(launchAfter));
    ok('no substitute attempt was created', session().attempts.length === attemptsBefore && session().attemptSeq === seqBefore);

    head('Submission and review still use the original saved paper');
    var submit = await call('POST', '/api/free2027/attempts/' + attemptId + '/submit', {}, ada.token);
    ok('the resumed attempt submits once', submit.status === 200 && submit.body.result.total === 180 && submit.body.result.maxScore === 400, submit.raw.slice(0, 200));
    var expectedCorrect = englishCorrect === 3 ? 2 : 1;
    ok('marking uses the saved answers and original key', submit.status === 200 && submit.body.result.correct === expectedCorrect && submit.body.result.wrong === 3 - expectedCorrect && submit.body.result.answered === 3 && submit.body.result.unanswered === 177, JSON.stringify(submit.body.result));
    var retries = await Promise.all([
      call('POST', '/api/free2027/attempts/' + attemptId + '/submit', {}, ada.token),
      call('POST', '/api/free2027/attempts/' + attemptId + '/submit', {}, ada.token)
    ]);
    ok('concurrent retries return the existing result', retries.every(function (r) { return r.status === 200 && r.body.alreadySubmitted === true && r.body.result.submittedAt === submit.body.result.submittedAt; }));
    ok('retries create neither attempts nor duplicate submit records', session().attempts.length === attemptsBefore &&
      session().records.filter(function (r) { return r.kind === 'submit' && r.participantId === ada.participant.id && r.activityId === activityId; }).length === 1);
    var review = await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, ada.token);
    ok('review after the bank changes still shows the exact saved paper', review.status === 200 && review.body.review.questions.length === 180 &&
      review.body.review.questions.every(function (q, i) { return q.id === served[i].id && samePaper(q.options, served[i].options) && q.text === served[i].text; }));
    ok('review keeps the official subject distribution and score', review.status === 200 && samePaper(subjectCounts(review.body.review.questions), DIST) && review.body.review.score === submit.body.result.score);

    head('Existing expiry and attempt-limit rules are preserved');
    var used = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, ada.token);
    ok('a submitted candidate cannot bypass the attempt limit while the bank is short', used.status === 403 && /used all/.test(used.body.error), used.raw);
    db = dataFile();
    var catStored = db.free2027.sessions.filter(function (s) { return s.id === db.free2027.currentSessionId; })[0].attempts.filter(function (a) { return a.id === catId; })[0];
    catStored.startedAt = Date.now() - catStored.durationSec * 1000 - 1000;
    saveData(db);
    var expired = await call('GET', '/api/free2027/attempts/' + catId, undefined, cat.token);
    ok('an expired attempt closes instead of becoming resumable', expired.status === 200 && expired.body.submitted === true && expired.body.expired === true, expired.raw.slice(0, 180));
    ok('expiry marks from the saved snapshot despite the edited live bank', expired.status === 200 && expired.body.result.total === 180 && expired.body.result.maxScore === 400 && expired.body.result.correct === 1, JSON.stringify(expired.body.result));
    var expiredAgain = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, cat.token);
    ok('expiry does not grant a replacement attempt', expiredAgain.status === 403 && session().attempts.length === attemptsBefore, expiredAgain.raw);

    head('Restoring eligibility permits a genuinely new attempt with a fresh snapshot');
    db = dataFile();
    db.free2027.questionBanks.competition.questions = clone(originalBank).concat(db.free2027.questionBanks.competition.questions.filter(function (q) { return q.subject === 'Biology'; }));
    saveData(db);
    var fresh = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, ben.token);
    ok('a new candidate can start only after eligibility is restored', fresh.status === 200 && fresh.body.resumed === false && fresh.body.questions.length === 180, fresh.raw.slice(0, 180));
    ok('the new attempt receives its own full snapshot', fresh.status === 200 && storedAttempt(fresh.body.attempt.id).questionSnapshot.length === 180 && fresh.body.attempt.id !== attemptId);
    ok('the new paper keeps 60/40/40/40 and comes from the competition bank', fresh.status === 200 && samePaper(subjectCounts(fresh.body.questions), DIST) &&
      fresh.body.questions.every(function (q) { return /^CQ-/.test(q.id); }));
    ok('no unhandled server rejection occurred', !/UnhandledPromiseRejection|ERR_UNHANDLED_REJECTION/.test(serverLog), serverLog.slice(-300));
  } catch (e) {
    fails++;
    console.log('  FAIL  harness: ' + (e && e.stack || e));
    console.log(serverLog.slice(-1500));
  } finally {
    stop();
    console.log('\n' + passes + ' passed, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
  }
})();
