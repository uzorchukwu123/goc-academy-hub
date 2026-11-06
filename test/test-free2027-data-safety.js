/* test-free2027-data-safety.js — the DATA-PRESERVATION contract.
   ---------------------------------------------------------------------------
   Proves, against the real HTTP server and the real persisted data file, that:

     A. creating activities ACCUMULATES (Week 1 / Week 2 / Week 3 coexist, each
        with its own stable id, and Week 1 is never rewritten);
     B. deleting an activity deletes ONLY that activity — every attempt,
        submitted answer, score and result survives byte-for-byte, and no
        student, other activity, question bank or record is touched;
     C. deleting a competition follows the same rule and never disturbs the
        weekly programme;
     D. question-bank deletion (individual / bulk / delete-all) is bank-scoped
        and never destroys attempts, answers, scores or results;
     E. activity deletion requires explicit confirmation;
     F. switching website mode destroys nothing.

   node test/test-free2027-data-safety.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_SAFETY_PORT) || 8492;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-safety-'));
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
      GOC_FREE_2027_OTP_SECRET: 'safety-test-otp-secret-0123456789abcdef',
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
function kill() { try { child.kill(); } catch (e) {} try { child.unref(); } catch (e) {} }
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
function sess() { var ed = dataFile().free2027; return ed.sessions.filter(function (s) { return s.id === ed.currentSessionId; })[0]; }
function stable(v) { return JSON.stringify(v); }
var SUBJ5 = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
function csvText(prefix, n) {
  var rows = ['subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
  for (var i = 1; i <= n; i++) {
    rows.push([SUBJ5[(i - 1) % SUBJ5.length], 'Topic ' + i, prefix + ' question ' + i, 'Alpha ' + i, 'Beta ' + i,
      'Gamma ' + i, 'Delta ' + i, '', 'B', 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
  }
  return rows.join('\n');
}
async function founder() {
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var t = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
  return t;
}
async function registerStudent(email, name) {
  var start = await call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Law', password: 'AdaPass-2027' });
  if (start.status !== 200) throw new Error('register/start failed: ' + start.raw);
  var rows = fs.readFileSync(path.join(DATA, 'mail.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var code = String(mail.message.text).match(/verification code is (\d{6})/i)[1];
  var v = await call('POST', '/api/free2027/register/verify', { email: email, code: code });
  if (v.status !== 200) throw new Error('register/verify failed: ' + v.raw);
  return v.body.token;
}
async function makeActivity(adm, kind, title, count) {
  var t = Date.now();
  var r = await call('POST', '/api/free2027/admin/activities', {
    kind: kind, title: title, questionCount: count || 2,
    opensAt: t - 60000, closesAt: t + 86400000, durationMin: 30, maxAttempts: 2
  }, adm);
  if (r.status !== 200) throw new Error('activity create failed: ' + r.raw);
  var id = r.body.activity.id;
  var pub = await call('POST', '/api/free2027/admin/activities/' + id + '/publish', {}, adm);
  if (pub.status !== 200) throw new Error('publish failed: ' + pub.raw);
  return r.body.activity;
}
/* Sit a paper end-to-end and return the scored attempt id. */
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
  return { id: aid, result: sub.body.result, questions: qs };
}

/* A mode switch legitimately APPENDS one entry to the session audit trail.
   Every data collection must be untouched, and the audit may only grow. */
function sessionData(db) {
  return db.free2027.sessions.map(function (s) {
    return {
      id: s.id, participants: s.participants, activities: s.activities, attempts: s.attempts,
      leaderboards: s.leaderboards, records: s.records, activityHistory: s.activityHistory
    };
  });
}
function auditLens(db) { return db.free2027.sessions.map(function (s) { return (s.audit || []).length; }); }

(async function () {
  boot();
  await waitForBoot(40);
  var adm = await founder();
  await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('Weekly', 12) }, adm);
  await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csvText('Comp', 8) }, adm);
  var ada = await registerStudent('ada.safety@example.com', 'Ada Safety');
  var bola = await registerStudent('bola.safety@example.com', 'Bola Safety');

  /* ================= A. activities ACCUMULATE, never overwrite ============ */
  head('A. assessment accumulation (Week 1 / Week 2 / Week 3)');
  var w1 = await makeActivity(adm, 'weekly', 'Week 1', 2);
  var w1Snapshot = stable(sess().activities.filter(function (a) { return a.id === w1.id; })[0]);
  var sat1 = await sitPaper(ada, w1.id);
  ok('Week 1 exists and a scored attempt was stored', !!sat1.result && typeof sat1.result.score === 'number');

  var w2 = await makeActivity(adm, 'weekly', 'Week 2', 3);
  var after2 = sess().activities;
  ok('creating Week 2 keeps Week 1 (both exist together)', after2.some(function (a) { return a.id === w1.id; }) && after2.some(function (a) { return a.id === w2.id; }));
  ok('every activity has its own unique identifier', w1.id !== w2.id);
  ok('Week 1 is byte-for-byte unchanged after Week 2 is created', stable(sess().activities.filter(function (a) { return a.id === w1.id; })[0]) === w1Snapshot);
  ok('Week 1 attempt and score survive the creation of Week 2', stable(sess().attempts.filter(function (a) { return a.id === sat1.id; })[0].score) === stable(sat1.result.score));

  var w3 = await makeActivity(adm, 'weekly', 'Week 3', 2);
  var ids3 = sess().activities.map(function (a) { return a.id; });
  ok('creating Week 3 keeps all three assessments', [w1.id, w2.id, w3.id].every(function (id) { return ids3.indexOf(id) > -1; }), ids3.join(','));
  ok('Week 1 is still unchanged after Week 3 is created', stable(sess().activities.filter(function (a) { return a.id === w1.id; })[0]) === w1Snapshot);
  var listed = await call('GET', '/api/free2027/admin/activities', undefined, adm);
  ok('the console lists all three accumulated assessments', listed.body.activities.filter(function (a) { return a.kind === 'weekly'; }).length === 3);

  /* ================= B. MANDATORY activity-deletion preservation ========== */
  head('B. deleting an activity deletes ONLY the activity (mandatory)');
  /* A second student sits Week 2 so unrelated records are provably untouched. */
  var sat2 = await sitPaper(bola, w2.id);
  var beforeDelete = sess();
  var attemptBefore = stable(beforeDelete.attempts.filter(function (a) { return a.id === sat1.id; })[0]);
  var responsesBefore = stable(beforeDelete.attempts.filter(function (a) { return a.id === sat1.id; })[0].responses);
  var allAttemptsBefore = beforeDelete.attempts.length;
  var participantsBefore = stable(beforeDelete.participants);
  var recordsBefore = stable(beforeDelete.records);
  var banksBefore = stable(dataFile().free2027.questionBanks);
  var otherActivitiesBefore = stable(beforeDelete.activities.filter(function (a) { return a.id !== w1.id; }));
  var resultsBefore = await call('GET', '/api/free2027/results', undefined, ada);
  var scoreBefore = resultsBefore.body.results.filter(function (r) { return r.attemptId === sat1.id; })[0];

  /* Confirmation is mandatory: an unconfirmed delete changes nothing at all. */
  var noConf = await call('DELETE', '/api/free2027/admin/activities/' + w1.id, {}, adm);
  ok('deleting an activity without confirm:true is refused', noConf.status === 400, noConf.status + ' ' + noConf.raw.slice(0, 160));
  ok('the refused delete leaves the activity in place', sess().activities.some(function (a) { return a.id === w1.id; }));
  ok('the refused delete leaves every attempt in place', sess().attempts.length === allAttemptsBefore);

  var del = await call('DELETE', '/api/free2027/admin/activities/' + w1.id, { confirm: true }, adm);
  ok('the confirmed delete succeeds', del.status === 200 && del.body.ok === true, del.raw.slice(0, 200));
  ok('the response reports the preserved attempts/results', del.body.attemptsKept === 1 && del.body.resultsKept === 1, JSON.stringify(del.body));

  /* 6. gone from the active lists */
  var afterDelete = sess();
  ok('6. the activity is gone from the stored activity list', !afterDelete.activities.some(function (a) { return a.id === w1.id; }));
  var adminList = await call('GET', '/api/free2027/admin/activities', undefined, adm);
  ok('6. the activity is gone from the console activity list', !adminList.body.activities.some(function (a) { return a.id === w1.id; }));
  var studentList = await call('GET', '/api/free2027/activities', undefined, ada);
  ok('6. the activity is gone from the student activity list', !studentList.body.activities.some(function (a) { return a.id === w1.id; }));

  /* 7. the attempt still exists — byte-for-byte */
  var keptAttempt = afterDelete.attempts.filter(function (a) { return a.id === sat1.id; })[0];
  ok('7. the student attempt still exists', !!keptAttempt);
  ok('7. the attempt is byte-for-byte identical (nothing rewritten)', stable(keptAttempt) === attemptBefore);
  ok('7. no attempt was removed at all', afterDelete.attempts.length === allAttemptsBefore);

  /* 8. submitted answers still exist */
  ok('8. every submitted answer still exists', stable(keptAttempt.responses) === responsesBefore && Object.keys(keptAttempt.responses).length > 0, stable(keptAttempt.responses));

  /* 9. score and result still exist */
  ok('9. the score, percent and marking are unchanged', keptAttempt.score === sat1.result.score && keptAttempt.maxScore === sat1.result.maxScore && keptAttempt.percent === sat1.result.percent);
  var resultsAfter = await call('GET', '/api/free2027/results', undefined, ada);
  var scoreAfter = resultsAfter.body.results.filter(function (r) { return r.attemptId === sat1.id; })[0];
  ok('9. the student result is still served by the API', !!scoreAfter);
  ok('9. the result keeps the same score/max/percent', scoreAfter.score === scoreBefore.score && scoreAfter.maxScore === scoreBefore.maxScore && scoreAfter.percent === scoreBefore.percent);
  ok('9. the result still names the assessment it belongs to', scoreAfter.title === 'Week 1' && scoreAfter.kind === 'weekly', JSON.stringify({ t: scoreAfter.title, k: scoreAfter.kind }));
  ok('9. the result is flagged as belonging to a deleted activity', scoreAfter.activityDeleted === true);
  var detail = await call('GET', '/api/free2027/admin/attempts/' + sat1.id, undefined, adm);
  ok('9. the console can still open the historical paper and its answers', detail.status === 200 && stable(detail.body.attempt.responses) === responsesBefore && detail.body.activity.title === 'Week 1');
  var histResults = await call('GET', '/api/free2027/admin/activities/' + w1.id + '/results', undefined, adm);
  ok('9. the deleted activity keeps a readable historical result row', histResults.status === 200 && histResults.body.rows.length === 1 && histResults.body.activity.deleted === true);

  /* 10. nothing unrelated moved */
  ok('10. student records are untouched', stable(afterDelete.participants) === participantsBefore);
  ok('10. other activities are untouched', stable(afterDelete.activities) === otherActivitiesBefore);
  ok('10. both question banks are untouched', stable(dataFile().free2027.questionBanks) === banksBefore);
  ok('10. the other student attempt and score are untouched', stable(afterDelete.attempts.filter(function (a) { return a.id === sat2.id; })[0]) === stable(beforeDelete.attempts.filter(function (a) { return a.id === sat2.id; })[0]));
  var bolaResults = await call('GET', '/api/free2027/results', undefined, bola);
  ok('10. the other student still has their own result', bolaResults.body.results.some(function (r) { return r.attemptId === sat2.id; }));
  ok('10. the activity id is retained as a historical reference', (afterDelete.activityHistory || []).some(function (h) { return h.id === w1.id && h.title === 'Week 1'; }));
  ok('10. the attempt still points at its original activity id', keptAttempt.activityId === w1.id);
  ok('10. pre-existing performance records were not rewritten', stable(afterDelete.records) === recordsBefore);

  /* ================= C. competition deletion is equally safe ============== */
  head('C. competition deletion preserves attempts and the weekly programme');
  var comp = await makeActivity(adm, 'competition', 'Grand Competition', 2);
  var satC = await sitPaper(ada, comp.id);
  var weeklyBeforeCompDelete = stable(sess().activities.filter(function (a) { return a.kind === 'weekly'; }));
  var compAttemptBefore = stable(sess().attempts.filter(function (a) { return a.id === satC.id; })[0]);
  var compDel = await call('DELETE', '/api/free2027/admin/activities/' + comp.id, { confirm: true }, adm);
  ok('the competition activity is deleted', compDel.status === 200 && !sess().activities.some(function (a) { return a.id === comp.id; }));
  ok('the competition attempt, answers and score survive', stable(sess().attempts.filter(function (a) { return a.id === satC.id; })[0]) === compAttemptBefore);
  ok('deleting a competition never touches weekly assessments', stable(sess().activities.filter(function (a) { return a.kind === 'weekly'; })) === weeklyBeforeCompDelete);
  var adaResults2 = await call('GET', '/api/free2027/results', undefined, ada);
  ok('the competition result is still in the student history', adaResults2.body.results.some(function (r) { return r.attemptId === satC.id && r.title === 'Grand Competition'; }));
  ok('deleting a competition leaves the competition bank intact', dataFile().free2027.questionBanks.competition.questions.length === 8);

  /* ================= D. question-bank deletion is bank-scoped ============= */
  head('D. question-bank deletion never destroys student records');
  var attemptsBeforeBank = stable(sess().attempts);
  var wq = await call('GET', '/api/free2027/admin/question-banks/weekly/questions', undefined, adm);
  var cq = await call('GET', '/api/free2027/admin/question-banks/competition/questions', undefined, adm);
  var compCountBefore = cq.body.total;
  var one = await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete', { ids: [wq.body.questions[0].id], confirm: true }, adm);
  ok('an individual weekly question can be deleted', one.status === 200 && one.body.deleted === 1);
  var bulkIds = wq.body.questions.slice(1, 4).map(function (q) { return q.id; });
  var bulk = await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete', { ids: bulkIds, confirm: true }, adm);
  ok('multiple selected weekly questions can be bulk-deleted', bulk.status === 200 && bulk.body.deleted === 3);
  ok('the competition bank is untouched by weekly individual/bulk deletion', dataFile().free2027.questionBanks.competition.questions.length === compCountBefore);
  var delAllW = await call('POST', '/api/free2027/admin/question-banks/weekly/delete-all', { confirm: true }, adm);
  ok('delete-all clears the selected weekly bank', delAllW.status === 200 && delAllW.body.remaining === 0);
  ok('delete-all on weekly never clears the competition bank', dataFile().free2027.questionBanks.competition.questions.length === compCountBefore);
  ok('no student attempt, answer or score changed during bank deletion', stable(sess().attempts) === attemptsBeforeBank);
  var resultsAfterBank = await call('GET', '/api/free2027/results', undefined, ada);
  ok('every historical result is still served after the bank was cleared', resultsAfterBank.body.results.length === adaResults2.body.results.length && resultsAfterBank.body.results.every(function (r) { return typeof r.score === 'number'; }));
  var histDetail = await call('GET', '/api/free2027/admin/attempts/' + sat1.id, undefined, adm);
  ok('the historical paper still resolves its questions after deletion', histDetail.status === 200 && Object.keys(histDetail.body.attempt.responses).length > 0);
  var delAllC = await call('POST', '/api/free2027/admin/question-banks/competition/delete-all', { confirm: true }, adm);
  ok('delete-all on competition is independently confirmed and scoped', delAllC.status === 200 && delAllC.body.deleted === compCountBefore && delAllC.body.remaining === 0);
  ok('student records survive both banks being cleared', stable(sess().participants) === participantsBefore && sess().attempts.length === allAttemptsBefore + 1);

  /* ================= E. mode switching destroys nothing =================== */
  head('E. Website Mode Control preserves every record');
  var beforeMode = stable(sessionData(dataFile()));
  var auditBefore = auditLens(dataFile());
  var banksBeforeMode = stable(dataFile().free2027.questionBanks);
  var toOriginal = await call('PUT', '/api/free2027/admin/mode', { mode: 'original', confirm: true }, adm);
  ok('the Founder can switch to Original Mode', toOriginal.status === 200, toOriginal.raw.slice(0, 160));
  ok('switching to Original Mode changes no student/activity/attempt/result data', stable(sessionData(dataFile())) === beforeMode);
  ok('the mode switch only appends to the audit trail, never truncates it', auditLens(dataFile()).every(function (n, i) { return n >= auditBefore[i]; }), JSON.stringify(auditLens(dataFile())));
  var cfgOriginal = await call('GET', '/api/free2027/config');
  ok('the public config reports Original Mode', cfgOriginal.body.mode === 'original', cfgOriginal.raw.slice(0, 120));
  var backToFree = await call('PUT', '/api/free2027/admin/mode', { mode: 'free2027', confirm: true }, adm);
  ok('the Founder can switch back to Free Tutorial Mode', backToFree.status === 200);
  ok('switching back changes no student/activity/attempt/result data', stable(sessionData(dataFile())) === beforeMode);
  var afterModeResults = await call('GET', '/api/free2027/results', undefined, ada);
  ok('every result is still readable after switching modes twice', afterModeResults.body.results.length === resultsAfterBank.body.results.length);
  ok('switching modes never resets the question banks', stable(dataFile().free2027.questionBanks) === banksBeforeMode);
  var cfgFree = await call('GET', '/api/free2027/config');
  ok('the public config reports Free Tutorial Mode again', cfgFree.body.mode === 'free2027');

  /* ================= F. guest CBT Portal entry ============================ */
  head('F. direct CBT Portal entry needs no account');
  await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('Guest', 6) }, adm);
  var guestActivity = await makeActivity(adm, 'weekly', 'Guest Visible Week', 2);
  var cat = await call('GET', '/api/free2027/catalogue');
  ok('the public catalogue is readable with no token at all', cat.status === 200 && cat.body.guest === true, cat.raw.slice(0, 160));
  ok('the catalogue lists the published activity for a guest', cat.body.activities.some(function (a) { return a.id === guestActivity.id; }));
  var pub = cat.body.activities.filter(function (a) { return a.id === guestActivity.id; })[0];
  ok('the catalogue exposes only public metadata (no questions/answers)', !('questionIds' in pub) && !('answer' in pub) && !('responses' in pub) && !('options' in pub), JSON.stringify(pub).slice(0, 200));
  ok('the catalogue never exposes a participant record', !/participantId|email|responses/.test(JSON.stringify(cat.body)));
  ok('a guest still cannot start a paper without the existing verified identity', (await call('POST', '/api/free2027/activities/' + guestActivity.id + '/start', {})).status === 401);

  /* ================= G. persistence across restart ======================== */
  head('G. everything preserved survives a server restart');
  var beforeRestart = stable(sessionData(dataFile()));
  kill();
  await new Promise(function (r) { setTimeout(r, 400); });
  boot();
  await waitForBoot(40);
  ok('all attempts, answers, scores and history survive a restart', stable(sessionData(dataFile())) === beforeRestart);
  var adm2 = await founder();
  var detail2 = await call('GET', '/api/free2027/admin/attempts/' + sat1.id, undefined, adm2);
  ok('the deleted activity historical paper is still readable after restart', detail2.status === 200 && detail2.body.activity.title === 'Week 1' && detail2.body.activity.deleted === true);
  var modeAfterRestart = await call('GET', '/api/free2027/config');
  ok('the selected website mode persists across the restart', modeAfterRestart.body.mode === 'free2027');
  kill();

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e));
  try { kill(); } catch (e2) {}
  process.exit(1);
});
