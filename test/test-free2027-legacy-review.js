/* test-free2027-legacy-review.js — review integrity for attempts created before
   per-attempt question snapshots existed.

   Real HTTP, a disposable local data folder, Appwrite disabled and captured
   mail. Candidates sit and submit through the normal routes; only then is the
   snapshot removed from the fixture to reproduce an older stored attempt.
   Bank edits that the console guards against are injected into this disposable
   fixture so the review resolver itself is exercised, not just the edit guard.
   node test/test-free2027-legacy-review.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_LEGACY_REVIEW_PORT) || 8246;
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 260) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function clone(v) { return JSON.parse(JSON.stringify(v)); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-legacy-review-'));
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

var serverLog = '', stopped = false;
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
    GOC_TEST_MAIL_FILE: MAIL_FILE,
    GOC_FREE_2027_OTP_SECRET: 'legacy-review-test-otp-secret-0123456789',
    GOC_SMTP_HOST: 'mailpit-test',
    GOC_FOUNDER_PW: 'legacy-review-founder',
    GOC_ACADDIR_PW: 'legacy-review-acaddir',
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
function liveQuestion(bank, id) {
  return dataFile().free2027.questionBanks[bank].questions.filter(function (q) { return String(q.id) === String(id); })[0] || null;
}
function editLive(bank, id, edit) {
  var db = dataFile();
  var rows = db.free2027.questionBanks[bank].questions;
  var i = rows.findIndex(function (q) { return String(q.id) === String(id); });
  if (i < 0) rows.push(Object.assign({ id: id, bank: bank }, edit));
  else rows[i] = Object.assign({}, rows[i], edit);
  saveData(db);
}
function removeLive(bank, id) {
  var db = dataFile();
  db.free2027.questionBanks[bank].questions = db.free2027.questionBanks[bank].questions.filter(function (q) { return String(q.id) !== String(id); });
  saveData(db);
}
function restoreLive(bank, q) {
  var db = dataFile();
  var rows = db.free2027.questionBanks[bank].questions;
  var i = rows.findIndex(function (x) { return String(x.id) === String(q.id); });
  if (i < 0) rows.push(clone(q)); else rows[i] = clone(q);
  saveData(db);
}
function changedCopy(q, at) {
  return Object.assign({}, clone(q), {
    text: 'EDITED AFTER SUBMISSION: ' + q.id,
    options: ['replacement A', 'replacement B'], answer: 1,
    createdAt: at, updatedAt: at, importedAt: at
  });
}
function csv(bank) {
  var subjects = ['Use of English', 'Mathematics', 'Physics', 'Chemistry'];
  var rows = ['subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
  for (var i = 1; i <= 6; i++) {
    rows.push([subjects[(i - 1) % subjects.length], 'Topic ' + i, bank + ' original question ' + i,
      'Original A ' + i, 'Original B ' + i, 'Original C ' + i, 'Original D ' + i, '', 'B', 'easy', '', 'TRUE', '', ''].join(','));
  }
  return rows.join('\n');
}
function register(name, email) {
  return call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Law', password: 'Legacy-Review-2027' })
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
function unavailable(label, r, attemptId, before) {
  ok(label + ': controlled 409, not a reconstructed paper', r.status === 409 && !r.body.review, r.status + ' ' + r.raw.slice(0, 180));
  ok(label + ': limitation and unchanged result are explained',
    /original question/i.test(r.body.error || '') && /saved result.*unchanged/i.test(r.body.error || ''), r.raw);
  ok(label + ': no answer key or verdict is disclosed',
    r.raw.indexOf('correctAnswer') < 0 && r.raw.indexOf('"questions"') < 0 && r.raw.indexOf('"outcome"') < 0);
  ok(label + ': the stored attempt is untouched', JSON.stringify(storedAttempt(attemptId)) === before);
}
function reviewRow(r, id) { return r.body.review.questions.filter(function (q) { return String(q.id) === String(id); })[0]; }

(async function () {
  try {
    var h = await waitForBoot(60);
    ok('the isolated server boots', h.status === 200, h.raw);
    ok('the run is explicitly local-only', /GOC_APPWRITE_OFF is set/.test(serverLog), serverLog.slice(-300));
    var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'legacy-review-founder' });
    var adm = lin.body && lin.body.token;
    await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
    ok('the test console is unlocked', (await call('GET', '/api/free2027/admin/overview', undefined, adm)).status === 200);
    var owner = await register('Legacy Owner', 'legacy-owner@example.com');
    var other = await register('Other Candidate', 'legacy-other@example.com');

    for (var bi = 0; bi < ['weekly', 'competition'].length; bi++) {
      var bank = ['weekly', 'competition'][bi];
      head(bank + ': a submitted legacy attempt with no questionSnapshot');
      var imp = await call('POST', '/api/free2027/admin/question-banks/' + bank + '/import', { csv: csv(bank) }, adm);
      ok(bank + ': fixture bank imports', imp.status === 200 && imp.body.imported === 6, imp.raw);
      var originalBank = clone(dataFile().free2027.questionBanks[bank].questions);
      var t = Date.now();
      var made = await call('POST', '/api/free2027/admin/activities', {
        kind: bank, title: 'Legacy ' + bank + ' paper', questionCount: 6,
        opensAt: t - 60000, closesAt: t + 3600000, durationMin: 30, maxAttempts: 2,
        randomizeQuestions: false, randomizeOptions: bank === 'competition', status: 'published'
      }, adm);
      ok(bank + ': activity publishes', made.status === 200, made.raw);
      var activityId = made.body.activity.id;
      var start = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, owner.token);
      ok(bank + ': candidate starts normally', start.status === 200, start.raw);
      var attemptId = start.body.attempt.id;
      var served = clone(start.body.questions);
      var key = {};
      originalBank.forEach(function (q) { key[q.id] = Number(q.answer); });
      var responses = {};
      responses[served[0].id] = served[0].options.indexOf(originalBank.filter(function (q) { return q.id === served[0].id; })[0].options[key[served[0].id]]);
      responses[served[1].id] = (responses[served[0].id] + 1) % served[1].options.length;
      var submitted = await call('POST', '/api/free2027/attempts/' + attemptId + '/submit', { responses: responses }, owner.token);
      ok(bank + ': candidate submits normally', submitted.status === 200 && !!submitted.body.result, submitted.raw);
      var resultBefore = JSON.stringify(submitted.body.result);
      var db = dataFile();
      var s = db.free2027.sessions.filter(function (x) { return x.id === db.free2027.currentSessionId; })[0];
      var a = s.attempts.filter(function (x) { return x.id === attemptId; })[0];
      delete a.questionSnapshot;
      saveData(db);
      ok(bank + ': fixture reproduces a legacy attempt without a snapshot', storedAttempt(attemptId).questionSnapshot === undefined);
      var attemptBefore = JSON.stringify(storedAttempt(attemptId));
      var baseline = await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token);
      ok(bank + ': an unchanged legacy paper remains reviewable', baseline.status === 200 && baseline.body.review.questions.length === 6, baseline.raw.slice(0, 180));
      ok(bank + ': legacy review preserves the official result',
        baseline.body.review.score === submitted.body.result.score && baseline.body.review.correct === submitted.body.result.correct);
      ok(bank + ': another candidate still cannot review it',
        (await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, other.token)).status === 403);

      var q = originalBank;
      var afterSubmit = storedAttempt(attemptId).submittedAt + 10000;
      editLive(bank, q[5].id, changedCopy(q[5], afterSubmit));
      unavailable(bank + ' edited live question without history',
        await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token), attemptId, attemptBefore);
      restoreLive(bank, q[5]);

      var del = await call('POST', '/api/free2027/admin/question-banks/' + bank + '/questions/delete', { ids: [q[0].id], confirm: true }, adm);
      ok(bank + ': normal deletion archives the original version', del.status === 200 && del.body.preservedForHistory === 1, del.raw);
      var deletedOnly = await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token);
      ok(bank + ': deletion history alone reconstructs the original question',
        deletedOnly.status === 200 && JSON.stringify(reviewRow(deletedOnly, q[0].id)) === JSON.stringify(reviewRow(baseline, q[0].id)));
      editLive(bank, q[0].id, changedCopy(q[0], afterSubmit + 1000));
      var historyWins = await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token);
      ok(bank + ': trustworthy history wins over a newer live replacement',
        historyWins.status === 200 && JSON.stringify(reviewRow(historyWins, q[0].id)) === JSON.stringify(reviewRow(baseline, q[0].id)), historyWins.raw.slice(0, 180));
      ok(bank + ': history review keeps the original verdict and key',
        reviewRow(historyWins, q[0].id).outcome === reviewRow(baseline, q[0].id).outcome &&
        reviewRow(historyWins, q[0].id).correctAnswer === reviewRow(baseline, q[0].id).correctAnswer);
      ok(bank + ': using history does not rewrite the attempt', JSON.stringify(storedAttempt(attemptId)) === attemptBefore);
      removeLive(bank, q[0].id);
      restoreLive(bank, q[0]);

      removeLive(bank, q[1].id);
      db = dataFile();
      db.free2027.questionHistory.push(Object.assign({}, clone(q[1]), { bank: bank === 'weekly' ? 'competition' : 'weekly', deletedAt: afterSubmit }));
      saveData(db);
      unavailable(bank + ' history belongs to the other bank',
        await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token), attemptId, attemptBefore);
      db = dataFile();
      db.free2027.questionHistory = db.free2027.questionHistory.filter(function (x) { return x.id !== q[1].id; });
      saveData(db);
      restoreLive(bank, q[1]);

      removeLive(bank, q[2].id);
      db = dataFile();
      db.free2027.questionHistory.push(Object.assign({}, clone(q[2]), { bank: bank, updatedAt: afterSubmit, deletedAt: afterSubmit + 1000 }));
      saveData(db);
      unavailable(bank + ' history version postdates the attempt',
        await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token), attemptId, attemptBefore);
      db = dataFile();
      db.free2027.questionHistory = db.free2027.questionHistory.filter(function (x) { return x.id !== q[2].id; });
      saveData(db);
      restoreLive(bank, q[2]);

      editLive(bank, q[3].id, { updatedAt: null, createdAt: null, importedAt: null });
      unavailable(bank + ' live version has no trustworthy timestamp',
        await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token), attemptId, attemptBefore);
      restoreLive(bank, q[3]);

      removeLive(bank, q[4].id);
      unavailable(bank + ' question is missing with no history',
        await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token), attemptId, attemptBefore);
      restoreLive(bank, q[4]);

      removeLive(bank, q[2].id);
      db = dataFile();
      db.free2027.questionHistory.push(Object.assign({}, clone(q[2]), { bank: bank, deletedAt: storedAttempt(attemptId).startedAt - 1000 }));
      saveData(db);
      unavailable(bank + ' history was archived before the attempt',
        await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token), attemptId, attemptBefore);
      db = dataFile();
      db.free2027.questionHistory = db.free2027.questionHistory.filter(function (x) { return x.id !== q[2].id; });
      saveData(db);
      restoreLive(bank, q[2]);

      var again = await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token);
      ok(bank + ': restoring the original records restores review without migration',
        again.status === 200 && JSON.stringify(again.body.review.questions) === JSON.stringify(baseline.body.review.questions));
      ok(bank + ': repeated unavailable reviews never change the stored result',
        JSON.stringify((await call('GET', '/api/free2027/results', undefined, owner.token)).body.results.filter(function (r) { return r.attemptId === attemptId; })[0]) === resultBefore);

      var newerStart = await call('POST', '/api/free2027/activities/' + activityId + '/start', {}, owner.token);
      var newerId = newerStart.body.attempt.id;
      var newerResponses = {};
      newerResponses[newerStart.body.questions[5].id] = 0;
      await call('POST', '/api/free2027/attempts/' + newerId + '/submit', { responses: newerResponses }, owner.token);
      ok(bank + ': a new attempt still saves its snapshot', Array.isArray(storedAttempt(newerId).questionSnapshot) && storedAttempt(newerId).questionSnapshot.length === 6);
      var newerBefore = JSON.stringify(storedAttempt(newerId));
      editLive(bank, q[5].id, changedCopy(q[5], Date.now() + 10000));
      var newerReview = await call('GET', '/api/free2027/attempts/' + newerId + '/review', undefined, owner.token);
      var newerRow = newerReview.status === 200 ? reviewRow(newerReview, q[5].id) : null;
      ok(bank + ': the new snapshot path is unchanged by legacy safeguards',
        !!newerRow && newerRow.text === q[5].text &&
        JSON.stringify(newerRow.options.slice().sort()) === JSON.stringify(q[5].options.slice().sort()) &&
        newerRow.options[newerRow.correctAnswer] === q[5].options[key[q[5].id]]);
      ok(bank + ': reviewing the snapshot does not rewrite that attempt', JSON.stringify(storedAttempt(newerId)) === newerBefore);
      unavailable(bank + ' legacy safeguard still applies beside a newer snapshot',
        await call('GET', '/api/free2027/attempts/' + attemptId + '/review', undefined, owner.token), attemptId, attemptBefore);
      restoreLive(bank, q[5]);
    }
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
