/* test-free2027-review.js — standard UTME marking, launch eligibility, answer
   review and duplicate submission, over real HTTP against a throw-away server.
   ---------------------------------------------------------------------------
   A scratch copy of the app runs on its own data folder, so nothing here can
   touch a real academy, its records or a live Appwrite project. The bank answers
   live in the server's data file (never in the paper a candidate is served),
   which lets the test drive a KNOWN score and check the arithmetic exactly.

     A. marking      — 180 questions, 60/40/40/40, each subject /100, total /400
     B. eligibility  — the standard paper cannot launch or start short
     C. competition review — own paper only, after submission, history-safe
     D. weekly review      — the same facility for a weekly assessment
     E. duplicates   — one submission marks once, however often it is repeated
   node test/test-free2027-review.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_REVIEW_PORT) || 8244;
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 260) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-review-'));
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
try { fs.rmSync(path.join(DATA, 'data.json'), { force: true }); } catch (e) {}

var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
    GOC_TEST_MAIL_FILE: MAIL_FILE,
    GOC_FREE_2027_OTP_SECRET: 'review-test-otp-secret-0123456789abcdef',
    GOC_SMTP_HOST: 'mailpit-test',
    GOC_FOUNDER_PW: 'founder2027',
    GOC_PASSCODE: '2027',
    GOC_DATA_DIR: DATA,
    GOC_FREE_2027: '1'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function kill() { try { child.kill(); } catch (e) {} try { child.unref(); } catch (e) {} }
process.on('exit', kill);

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
function saveData(db) { fs.writeFileSync(path.join(DATA, 'data.json'), JSON.stringify(db)); }
function mailedCode(email) {
  if (!fs.existsSync(MAIL_FILE)) return null;
  var rows = fs.readFileSync(MAIL_FILE, 'utf8').trim().split('\n').filter(Boolean).map(function (x) { return JSON.parse(x); });
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var m = mail && String(mail.message.text || '').match(/verification code is (\d{6})/i);
  return m ? m[1] : null;
}
function register(name, email) {
  return call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Medicine and Surgery', password: 'AdaPass-2027' })
    .then(function (r) {
      var code = mailedCode(email);
      if (r.status !== 200 || !code) return Promise.reject(new Error('verification email missing: ' + r.raw));
      return call('POST', '/api/free2027/register/verify', { email: email, code: code });
    })
    .then(function (r) { return { token: r.body.token, participant: r.body.participant }; });
}

var DIST = { 'Use of English': 60, 'Mathematics': 40, 'Physics': 40, 'Chemistry': 40 };
/* Explicit per-subject rows, so the bank holds EXACTLY the standard structure. */
function jambCsv() {
  var rows = ['subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
  Object.keys(DIST).forEach(function (subject) {
    for (var i = 1; i <= DIST[subject]; i++) {
      rows.push([subject, subject + ' topic ' + i, subject + ' question ' + i + ': which option is correct?',
        'Alpha ' + i, 'Beta ' + i, 'Gamma ' + i, 'Delta ' + i, '', 'B', 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
    }
  });
  return rows.join('\n');
}
function smallCsv(prefix, subjects, n) {
  var rows = ['subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
  for (var i = 1; i <= n; i++) {
    var s = subjects[(i - 1) % subjects.length];
    rows.push([s, 'Topic ' + i, prefix + ' question ' + i + ': which option is correct?',
      'Alpha ' + i, 'Beta ' + i, 'Gamma ' + i, 'Delta ' + i, '', 'B', 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
  }
  return rows.join('\n');
}
function bankKey(bank) {
  var out = {};
  (((dataFile().free2027 || {}).questionBanks || {})[bank] || { questions: [] }).questions
    .forEach(function (q) { out[String(q.id)] = Number(q.answer); });
  return out;
}

var adm = null, ada = null, ben = null, cat = null;
var compId = null, weeklyId = null;
var adaAttempt = null, benAttempt = null, adaReview = null;

waitForBoot(60).then(async function (h) {
  ok('the throw-away server is up', h.status === 200, h.raw);
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  adm = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  ok('the console is unlocked', (await call('GET', '/api/free2027/admin/overview', undefined, adm)).status === 200);

  var imp = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: jambCsv() }, adm);
  ok('the competition bank imports exactly 180 questions', imp.status === 200 && imp.body.imported === 180, imp.raw.slice(0, 200));
  var av = await call('GET', '/api/free2027/admin/question-banks', undefined, adm);
  var comp = av.body && av.body.banks && av.body.banks.competition;
  ok('the bank reports 60/40/40/40 eligible',
    av.status === 200 && comp.eligibleCount === 180 && comp.eligibleBySubject['Use of English'] === 60 &&
    comp.eligibleBySubject['Mathematics'] === 40 && comp.eligibleBySubject['Physics'] === 40 &&
    comp.eligibleBySubject['Chemistry'] === 40, JSON.stringify(comp && comp.eligibleBySubject));

  ada = await register('Ada Obi', 'ada@example.com');
  ben = await register('Ben Eze', 'ben@example.com');
  cat = await register('Cat Musa', 'cat@example.com');
  ok('three candidates are registered and verified', !!(ada.token && ben.token && cat.token));

  var opens = Date.now() - 60000, closes = Date.now() + 7200000;
  var mk = await call('POST', '/api/free2027/admin/activities', {
    kind: 'competition', title: 'Standard UTME Cup', opensAt: opens, closesAt: closes,
    durationMin: 120, maxAttempts: 1, questionCount: 180, subjectDistribution: DIST,
    randomizeQuestions: false, randomizeOptions: false, status: 'draft'
  }, adm);
  ok('a 180-question standard competition can now be created', mk.status === 200, mk.raw.slice(0, 240));
  compId = mk.body && mk.body.activity && mk.body.activity.id;

  var pub = await call('POST', '/api/free2027/admin/activities/' + compId + '/publish', {}, adm);
  ok('a complete standard paper publishes', pub.status === 200, pub.raw.slice(0, 200));

  /* Sit a paper to a plan: per subject, how many to answer correctly and how
     many wrongly; anything left over is deliberately left unanswered. */
  var key = bankKey('competition');
  async function sitPlan(who, actId, plan) {
    var s = await call('POST', '/api/free2027/activities/' + actId + '/start', {}, who.token);
    if (s.status !== 200) return { start: s, submit: null };
    var seen = {}, resp = {};
    s.body.questions.forEach(function (q) {
      var subject = q.subject;
      var n = (seen[subject] = (seen[subject] || 0) + 1);
      var p = plan[subject] || {};
      var right = Number(p.correct) || 0, wrong = Number(p.wrong) || 0;
      if (n <= right) resp[String(q.id)] = key[String(q.id)];
      else if (n <= right + wrong) resp[String(q.id)] = (key[String(q.id)] + 1) % q.options.length;
    });
    var sub = await call('POST', '/api/free2027/attempts/' + s.body.attempt.id + '/submit', { responses: resp }, who.token);
    return { start: s, attemptId: s.body.attempt.id, responses: resp, submit: sub };
  }

  /* ─────────────────────── A. marking ─────────────────────── */
  head('A. a standard UTME paper is marked out of 400');
  var perfect = await sitPlan(ada, compId, { 'Use of English': { correct: 60 }, 'Mathematics': { correct: 40 }, 'Physics': { correct: 40 }, 'Chemistry': { correct: 40 } });
  adaAttempt = perfect.attemptId;
  var pr = perfect.submit.body && perfect.submit.body.result;
  ok('the paper is served with 180 questions', perfect.start.body.questions.length === 180, perfect.start.body.questions.length);
  ok('a perfect paper scores 400 of 400', pr.score === 400 && pr.maxScore === 400, JSON.stringify({ score: pr.score, max: pr.maxScore }));
  ok('a perfect paper is 100 percent', pr.percent === 100, pr.percent);
  ok('all four subject scores are 100', (pr.subjectScores || []).every(function (x) { return x.score === 100 && x.maxScore === 100; }));
  ok('the subject names come from the competition configuration',
    (pr.subjectScores || []).map(function (x) { return x.subject; }).join('|') === 'Use of English|Mathematics|Physics|Chemistry');
  ok('the result reports 180 correct and none unanswered', pr.correct === 180 && pr.unanswered === 0 && pr.total === 180);
  ok('the scoring model is declared', pr.scoring === 'jamb', pr.scoring);

  var partial = await sitPlan(ben, compId, {
    'Use of English': { correct: 45, wrong: 5 },   /* 10 unanswered */
    'Mathematics': { correct: 34, wrong: 6 },
    'Physics': { correct: 32, wrong: 8 },
    'Chemistry': { correct: 33, wrong: 7 }
  });
  benAttempt = partial.attemptId;
  var br = partial.submit.body && partial.submit.body.result;
  ok('English 45/60 is scaled to 75', br.subjectScores[0].score === 75, JSON.stringify(br.subjectScores[0]));
  ok('Mathematics 34/40 is scaled to 85', br.subjectScores[1].score === 85);
  ok('Physics 32/40 is scaled to 80', br.subjectScores[2].score === 80);
  ok('Chemistry 33/40 is scaled to 82.5', br.subjectScores[3].score === 82.5);
  ok('the total is the sum of the four subject scores', br.score === 322.5 && br.maxScore === 400, br.score);
  ok('the percentage is derived from the total', br.percent === 80.63, br.percent);
  var summed = Math.round(br.subjectScores.reduce(function (a, x) { return a + x.score; }, 0) * 100) / 100;
  ok('displayed subject scores add up to the displayed total', summed === br.score, summed + ' vs ' + br.score);
  ok('attempted, correct, incorrect and unanswered are all reported',
    br.answered === 170 && br.correct === 144 && br.wrong === 26 && br.unanswered === 10,
    JSON.stringify({ a: br.answered, c: br.correct, w: br.wrong, u: br.unanswered }));
  ok('the four counts reconcile to the paper size',
    br.correct + br.wrong + br.unanswered === br.total && br.answered + br.unanswered === br.total);

  await sitPlan(cat, compId, { 'Use of English': { correct: 30 }, 'Mathematics': { correct: 20 }, 'Physics': { correct: 20 }, 'Chemistry': { correct: 20 } });

  head('A. the result the candidate reads and the record the console reads agree');
  var mine = await call('GET', '/api/free2027/results', undefined, ben.token);
  var mineRow = (mine.body.results || []).filter(function (x) { return x.attemptId === benAttempt; })[0];
  ok('the candidate result carries the same total', mineRow && mineRow.score === br.score && mineRow.maxScore === 400);
  ok('the candidate result carries the same percentage', mineRow && mineRow.percent === br.percent);
  var adminRes = await call('GET', '/api/free2027/admin/activities/' + compId + '/results', undefined, adm);
  var benAdmin = (adminRes.body.top || []).filter(function (x) { return x.participantId === ben.participant.id; })[0];
  ok('the console record carries the same total and percentage',
    benAdmin && benAdmin.score === br.score && benAdmin.percent === br.percent, JSON.stringify(benAdmin));
  var detail = await call('GET', '/api/free2027/admin/attempts/' + benAttempt, undefined, adm);
  ok('the console attempt detail agrees too',
    detail.status === 200 && detail.body.attempt.score === br.score && detail.body.attempt.maxScore === 400,
    detail.raw.slice(0, 160));
  ok('the console attempt detail carries the same subject scores',
    JSON.stringify(detail.body.attempt.subjectScores) === JSON.stringify(br.subjectScores));

  head('A. a fabricated client score is never trusted');
  var forge = await call('POST', '/api/free2027/attempts/' + benAttempt + '/submit',
    { responses: {}, score: 400, maxScore: 400, percent: 100, subjectScores: [] }, ben.token);
  ok('a re-submission cannot overwrite the official mark',
    forge.status === 200 && forge.body.result.score === 322.5, JSON.stringify(forge.body && forge.body.result && forge.body.result.score));

  /* ─────────────────── leaderboard: percentages only ─────────────────── */
  head('the public leaderboard shows percentages and no raw scores');
  await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/approve', {}, adm);
  await call('POST', '/api/free2027/admin/activities/' + compId + '/leaderboard/publish', {}, adm);
  var board = await call('GET', '/api/free2027/leaderboards/' + compId);
  var rows = board.body && board.body.leaderboard && board.body.leaderboard.rows;
  ok('the published board is readable without a token', board.status === 200 && rows && rows.length === 3, board.raw.slice(0, 160));
  ok('the top row is 100 percent', rows[0].percent === 100, JSON.stringify(rows[0]));
  ok('the second row is 80.63 percent', rows[1].percent === 80.63, rows[1].percent);
  ok('no row exposes a raw score', rows.every(function (r) { return r.score === undefined; }));
  ok('no row exposes a maximum', rows.every(function (r) { return r.maxScore === undefined; }));
  ok('the payload never mentions 400 as a score', board.raw.indexOf('"maxScore"') < 0 && board.raw.indexOf('"score"') < 0);
  ok('identity and rank survive', rows[0].name === 'Ada Obi' && rows[0].rank === 1 && !!rows[0].participantId);
  ok('the board percentages match the official results',
    rows[1].percent === br.percent && rows[0].percent === pr.percent);
  ok('the candidate still sees their own score privately', mineRow.score === 322.5 && mineRow.maxScore === 400);
  ok('the candidate still sees their competition position', mineRow.position && mineRow.position.rank === 2, JSON.stringify(mineRow.position));

  /* ─────────────────── C. competition review ─────────────────── */
  head('C. a candidate reviews their own submitted competition paper');
  var rv = await call('GET', '/api/free2027/attempts/' + benAttempt + '/review', undefined, ben.token);
  ok('the review is returned to its owner', rv.status === 200 && !!rv.body.review, rv.raw.slice(0, 160));
  var v = rv.body.review;
  ok('every one of the 180 questions is present', v.questions.length === 180, v.questions.length);
  ok('every question carries its options', v.questions.every(function (q) { return Array.isArray(q.options) && q.options.length === 4; }));
  ok('every question carries a correct answer', v.questions.every(function (q) { return Number.isInteger(q.correctAnswer); }));
  var outcomes = { correct: 0, incorrect: 0, unanswered: 0 };
  v.questions.forEach(function (q) { outcomes[q.outcome] = (outcomes[q.outcome] || 0) + 1; });
  ok('correct, incorrect and unanswered are distinguished and match the mark',
    outcomes.correct === 144 && outcomes.incorrect === 26 && outcomes.unanswered === 10, JSON.stringify(outcomes));
  ok('an unanswered question carries no selected answer',
    v.questions.filter(function (q) { return q.outcome === 'unanswered'; }).every(function (q) { return q.yourAnswer === null; }));
  ok('a correct question shows the selected answer equal to the key',
    v.questions.filter(function (q) { return q.outcome === 'correct'; }).every(function (q) { return q.yourAnswer === q.correctAnswer; }));
  ok('an incorrect question shows a selected answer different from the key',
    v.questions.filter(function (q) { return q.outcome === 'incorrect'; }).every(function (q) { return q.yourAnswer !== q.correctAnswer && q.yourAnswer !== null; }));
  ok('the review totals agree with the official result',
    v.score === br.score && v.maxScore === 400 && v.percent === br.percent && v.correct === br.correct &&
    v.incorrect === undefined && v.wrong === br.wrong && v.unanswered === br.unanswered && v.total === 180);
  ok('the review carries the same subject breakdown',
    JSON.stringify(v.subjectScores) === JSON.stringify(br.subjectScores));
  ok('each question is attributed to its subject', v.questions.every(function (q) { return DIST[q.subject] > 0; }));

  head('C. review access is guarded');
  ok('another candidate cannot read this paper',
    (await call('GET', '/api/free2027/attempts/' + benAttempt + '/review', undefined, cat.token)).status === 403);
  ok('a guest cannot read it', (await call('GET', '/api/free2027/attempts/' + benAttempt + '/review')).status === 401);
  ok('the console token is not a candidate session for review',
    (await call('GET', '/api/free2027/attempts/' + benAttempt + '/review', undefined, adm)).status >= 400);
  ok('an unknown attempt is a 404',
    (await call('GET', '/api/free2027/attempts/F27-A999-deadbeef/review', undefined, ben.token)).status === 404);

  /* A live paper must not leak its answer key through the review route. */
  var mk2 = await call('POST', '/api/free2027/admin/activities', {
    kind: 'competition', title: 'Shuffled UTME Cup', opensAt: Date.now() - 1000, closesAt: Date.now() + 7200000,
    durationMin: 120, maxAttempts: 2, questionCount: 180, subjectDistribution: DIST,
    randomizeQuestions: false, randomizeOptions: true, status: 'draft'
  }, adm);
  var comp2 = mk2.body.activity.id;
  await call('POST', '/api/free2027/admin/activities/' + comp2 + '/publish', {}, adm);
  var liveStart = await call('POST', '/api/free2027/activities/' + comp2 + '/start', {}, cat.token);
  var liveAttempt = liveStart.body.attempt.id;
  var early = await call('GET', '/api/free2027/attempts/' + liveAttempt + '/review', undefined, cat.token);
  ok('review is refused while the paper is still open', early.status === 409, early.status);
  ok('no answer key is present in that refusal', early.raw.indexOf('correctAnswer') < 0 && early.raw.indexOf('"answer"') < 0);
  ok('the served paper itself carries no answer key', liveStart.raw.indexOf('"answer"') < 0);

  head('C. the review matches the shuffled paper the candidate actually saw');
  var served = liveStart.body.questions;
  var resp2 = {};
  served.forEach(function (q, i) {
    /* Answer the first question of each subject correctly by matching option
       TEXT, which is the only honest way to drive a shuffled paper. */
    if (i % 45 === 0) {
      var bankQ = (((dataFile().free2027 || {}).questionBanks || {}).competition.questions)
        .filter(function (b) { return String(b.id) === String(q.id); })[0];
      var rightText = bankQ.options[Number(bankQ.answer)];
      resp2[String(q.id)] = q.options.indexOf(rightText);
    }
  });
  await call('POST', '/api/free2027/attempts/' + liveAttempt + '/submit', { responses: resp2 }, cat.token);
  var rv2 = (await call('GET', '/api/free2027/attempts/' + liveAttempt + '/review', undefined, cat.token)).body.review;
  ok('the shuffled review still marks those answers correct',
    rv2.questions.filter(function (q) { return q.outcome === 'correct'; }).length === Object.keys(resp2).length,
    JSON.stringify(rv2.questions.filter(function (q) { return q.outcome === 'correct'; }).length));
  ok('the shuffled review presents options in the served order',
    rv2.questions.every(function (q, i) { return JSON.stringify(q.options) === JSON.stringify(served[i].options); }));
  ok('the shuffled correct answer points at the right option text',
    rv2.questions.every(function (q) {
      var bankQ = (((dataFile().free2027 || {}).questionBanks || {}).competition.questions)
        .filter(function (b) { return String(b.id) === String(q.id); })[0];
      return q.options[q.correctAnswer] === bankQ.options[Number(bankQ.answer)];
    }));

  head('C. history survives a question being edited and a question being deleted');
  var before = rv2.questions[0];
  var editId = String(before.id);
  var dbEdit = dataFile();
  var bankEd = dbEdit.free2027.questionBanks.competition;
  var target = bankEd.questions.filter(function (q) { return String(q.id) === editId; })[0];
  target.text = 'REWRITTEN AFTER THE PAPER WAS SAT';
  target.options = ['changed', 'changed too', 'also changed', 'still changed'];
  target.answer = 3;
  saveData(dbEdit);
  var afterEdit = (await call('GET', '/api/free2027/attempts/' + liveAttempt + '/review', undefined, cat.token)).body.review;
  var editedRow = afterEdit.questions.filter(function (q) { return String(q.id) === editId; })[0];
  ok('an edited question still reviews as the candidate saw it',
    editedRow.text === before.text && JSON.stringify(editedRow.options) === JSON.stringify(before.options),
    JSON.stringify(editedRow).slice(0, 160));
  ok('the edited question keeps its original verdict', editedRow.outcome === before.outcome);
  ok('the official score is unchanged by a later edit', afterEdit.score === rv2.score);

  /* Delete a question through the console, which archives a history snapshot. */
  var delId = String(rv2.questions[1].id);
  var delRes = await call('POST', '/api/free2027/admin/question-banks/competition/questions/delete', { confirm: true, ids: [delId] }, adm);
  ok('the console can delete a bank question', delRes.status === 200, delRes.raw.slice(0, 140));
  var afterDel = (await call('GET', '/api/free2027/attempts/' + liveAttempt + '/review', undefined, cat.token)).body.review;
  ok('the deleted question is still in the review from its snapshot', afterDel.questions.length === 180, afterDel.questions.length);
  var delRow = afterDel.questions.filter(function (q) { return String(q.id) === delId; })[0];
  ok('the snapshot keeps the original wording and key',
    delRow && delRow.text === rv2.questions[1].text && delRow.correctAnswer === rv2.questions[1].correctAnswer);
  ok('the score is unchanged by a later deletion', afterDel.score === rv2.score);
  /* Put a replacement question back so the eligibility phase below starts from
     a full bank again. The archived paper above must stay unaffected by this. */
  var repl = await call('POST', '/api/free2027/admin/question-banks/competition/import',
    { csv: smallCsv('Replacement', [rv2.questions[1].subject], 1) }, adm);
  ok('a replacement question restores the bank to 180', repl.status === 200 && repl.body.imported === 1, repl.raw.slice(0, 140));
  var stillIntact = (await call('GET', '/api/free2027/attempts/' + liveAttempt + '/review', undefined, cat.token)).body.review;
  ok('adding a new bank question does not disturb the archived paper',
    stillIntact.questions.length === 180 && stillIntact.score === rv2.score);

  /* ─────────────────── D. weekly assessment review ─────────────────── */
  head('D. a weekly assessment is reviewable after submission');
  var impW = await call('POST', '/api/free2027/admin/question-banks/weekly/import',
    { csv: smallCsv('Weekly', ['Use of English', 'Mathematics', 'Physics', 'Chemistry'], 8) }, adm);
  ok('the weekly bank imports', impW.status === 200 && impW.body.imported === 8, impW.raw.slice(0, 160));
  var mkW = await call('POST', '/api/free2027/admin/activities', {
    kind: 'weekly', title: 'Week One Check', opensAt: Date.now() - 60000, closesAt: Date.now() + 7200000,
    durationMin: 30, maxAttempts: 3, questionCount: 8, randomizeQuestions: false, randomizeOptions: false, status: 'draft'
  }, adm);
  weeklyId = mkW.body.activity.id;
  await call('POST', '/api/free2027/admin/activities/' + weeklyId + '/publish', {}, adm);
  var wkey = bankKey('weekly');
  var ws = await call('POST', '/api/free2027/activities/' + weeklyId + '/start', {}, ada.token);
  var wAttempt = ws.body.attempt.id;
  var wresp = {};
  ws.body.questions.forEach(function (q, i) {
    if (i < 5) wresp[String(q.id)] = wkey[String(q.id)];
    else if (i < 7) wresp[String(q.id)] = (wkey[String(q.id)] + 1) % q.options.length;
  });
  var wEarly = await call('GET', '/api/free2027/attempts/' + wAttempt + '/review', undefined, ada.token);
  ok('a weekly review is refused before submission', wEarly.status === 409, wEarly.status);
  var wsub = await call('POST', '/api/free2027/attempts/' + wAttempt + '/submit', { responses: wresp }, ada.token);
  var wr = wsub.body.result;
  ok('the weekly assessment keeps its original raw marking',
    wr.score === 5 && wr.maxScore === 8 && wr.scoring === 'raw', JSON.stringify({ s: wr.score, m: wr.maxScore, model: wr.scoring }));
  ok('the weekly result reports unanswered', wr.unanswered === 1 && wr.correct === 5 && wr.wrong === 2, JSON.stringify(wr));
  ok('the weekly percentage is the official one', wr.percent === 62.5, wr.percent);
  var wv = (await call('GET', '/api/free2027/attempts/' + wAttempt + '/review', undefined, ada.token)).body.review;
  ok('the weekly review returns all eight questions', wv.questions.length === 8);
  var wo = { correct: 0, incorrect: 0, unanswered: 0 };
  wv.questions.forEach(function (q) { wo[q.outcome] = (wo[q.outcome] || 0) + 1; });
  ok('the weekly verdicts are per answer and correct', wo.correct === 5 && wo.incorrect === 2 && wo.unanswered === 1, JSON.stringify(wo));
  ok('the weekly review carries score, percentage and totals',
    wv.score === 5 && wv.maxScore === 8 && wv.percent === 62.5 && wv.correct === 5 && wv.wrong === 2 && wv.unanswered === 1);
  ok('the weekly review shows selected and correct answers',
    wv.questions.every(function (q) { return Number.isInteger(q.correctAnswer) && (q.outcome === 'unanswered' ? q.yourAnswer === null : Number.isInteger(q.yourAnswer)); }));
  ok('another candidate cannot read the weekly review',
    (await call('GET', '/api/free2027/attempts/' + wAttempt + '/review', undefined, ben.token)).status === 403);
  ok('a weekly result is still absent from the public leaderboard',
    (await call('GET', '/api/free2027/leaderboards/' + weeklyId)).status >= 400);
  ok('the weekly review remains available on a later visit',
    (await call('GET', '/api/free2027/attempts/' + wAttempt + '/review', undefined, ada.token)).status === 200);
  ok('an earlier completed assessment stays reviewable after a new one',
    (await call('GET', '/api/free2027/attempts/' + adaAttempt + '/review', undefined, ada.token)).status === 200);

  /* ─────────────────── E. duplicate submission ─────────────────── */
  head('E. one attempt is marked once, however often submission is repeated');
  var ws2 = await call('POST', '/api/free2027/activities/' + weeklyId + '/start', {}, ben.token);
  var dupAttempt = ws2.body.attempt.id;
  var dresp = {};
  ws2.body.questions.forEach(function (q, i) { if (i < 6) dresp[String(q.id)] = wkey[String(q.id)]; });
  var first = await call('POST', '/api/free2027/attempts/' + dupAttempt + '/submit', { responses: dresp }, ben.token);
  ok('the first submission marks the paper', first.status === 200 && first.body.result.score === 6, first.raw.slice(0, 160));
  var firstStamp = first.body.result.submittedAt;

  /* Two submissions racing, exactly as a double-click would produce. */
  var race = await Promise.all([
    call('POST', '/api/free2027/attempts/' + dupAttempt + '/submit', { responses: dresp }, ben.token),
    call('POST', '/api/free2027/attempts/' + dupAttempt + '/submit', { responses: dresp }, ben.token)
  ]);
  ok('a double-click returns the existing result both times',
    race.every(function (r) { return r.status === 200 && r.body.result.score === 6 && r.body.result.submittedAt === firstStamp; }),
    JSON.stringify(race.map(function (r) { return r.body && r.body.result && r.body.result.submittedAt; })));
  ok('a repeat is flagged as already submitted', race.every(function (r) { return r.body.alreadySubmitted === true; }));

  for (var i = 0; i < 5; i++) {
    await call('POST', '/api/free2027/attempts/' + dupAttempt + '/submit', { responses: dresp }, ben.token);
  }
  var dbDup = dataFile();
  var sessionDup = dbDup.free2027.sessions[dbDup.free2027.sessions.length - 1];
  var copies = sessionDup.attempts.filter(function (a) { return String(a.id) === String(dupAttempt); });
  ok('repeated retries never create a second attempt record', copies.length === 1, copies.length);
  ok('the attempt is marked exactly once', copies[0].markedAt && copies[0].submittedAt === firstStamp);
  ok('the score never drifts across retries', copies[0].score === 6);
  var benResults = (await call('GET', '/api/free2027/results', undefined, ben.token)).body.results;
  ok('the candidate result list holds the attempt once',
    benResults.filter(function (x) { return x.attemptId === dupAttempt; }).length === 1);
  var submitRecords = (sessionDup.records || []).filter(function (r) {
    return r.kind === 'submit' && String(r.participantId) === String(ben.participant.id) &&
      String(r.activityId) === String(weeklyId);
  });
  ok('retries do not append duplicate submission records', submitRecords.length === 1, submitRecords.length);

  head('E. a duplicated question id cannot be counted twice');
  var dupQ = dataFile();
  var sDupQ = dupQ.free2027.sessions[dupQ.free2027.sessions.length - 1];
  var attemptDupQ = sDupQ.attempts.filter(function (a) { return String(a.id) === String(adaAttempt); })[0];
  var originalIds = attemptDupQ.questionIds.slice();
  attemptDupQ.questionIds = originalIds.concat([originalIds[0], originalIds[1], originalIds[0]]);
  saveData(dupQ);
  var dupReview = (await call('GET', '/api/free2027/attempts/' + adaAttempt + '/review', undefined, ada.token)).body.review;
  ok('a repeated question id is served once in the review', dupReview.questions.length === 180, dupReview.questions.length);
  ok('the duplicated ids do not inflate the correct count', dupReview.correct === 180 && dupReview.score === 400,
    JSON.stringify({ c: dupReview.correct, s: dupReview.score }));
  var uniq = {};
  ok('no question id appears twice', dupReview.questions.every(function (q) {
    if (uniq[q.id]) return false; uniq[q.id] = true; return true;
  }));

  /* ─────────────────── B. launch eligibility ─────────────────── */
  head('B. a standard paper cannot launch or start short of 180');
  var mkDraft = await call('POST', '/api/free2027/admin/activities', {
    kind: 'competition', title: 'Gated UTME Cup', opensAt: Date.now() - 1000, closesAt: Date.now() + 7200000,
    durationMin: 120, maxAttempts: 1, questionCount: 180, subjectDistribution: DIST,
    randomizeQuestions: false, randomizeOptions: false, status: 'draft'
  }, adm);
  var gated = mkDraft.body.activity.id;

  /* Take one English question out of service AFTER allocation, which is the
     case the launch gate exists for. */
  var dbGate = dataFile();
  var bankGate = dbGate.free2027.questionBanks.competition;
  var victim = bankGate.questions.filter(function (q) { return q.subject === 'Use of English'; })[0];
  victim.active = false;
  saveData(dbGate);

  var blocked = await call('POST', '/api/free2027/admin/activities/' + gated + '/publish', {}, adm);
  ok('launch is refused when a question is no longer eligible', blocked.status === 409, blocked.status);
  ok('the refusal states the available count against the requirement',
    /Available questions: 179\/180/.test(blocked.body.error), blocked.body.error);
  ok('the refusal states the additional number required',
    /Additional questions required: 1/.test(blocked.body.error), blocked.body.error);
  var stillDraft = (await call('GET', '/api/free2027/admin/activities', undefined, adm)).body.activities
    .filter(function (a) { return a.id === gated; })[0];
  ok('the activity was not published', stillDraft.status === 'draft' && stillDraft.published === false);
  ok('the console is told the same figures before it tries',
    stillDraft.launch && stillDraft.launch.available === 179 && stillDraft.launch.needed === 1 && stillDraft.launch.ok === false,
    JSON.stringify(stillDraft.launch));

  /* A competition already live must also refuse a NEW attempt. */
  var startBlocked = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, cat.token);
  ok('a candidate cannot start a standard paper that has fallen short', startBlocked.status >= 400, startBlocked.status);

  /* Restore, and the same activity launches. */
  var dbRestore = dataFile();
  dbRestore.free2027.questionBanks.competition.questions
    .filter(function (q) { return String(q.id) === String(victim.id); })[0].active = true;
  saveData(dbRestore);
  var unblocked = await call('POST', '/api/free2027/admin/activities/' + gated + '/publish', {}, adm);
  ok('exactly 180 eligible questions launch successfully', unblocked.status === 200, unblocked.raw.slice(0, 180));

  head('B. invalid, duplicate and mis-distributed questions are rejected');
  var dbBad = dataFile();
  var bankBad = dbBad.free2027.questionBanks.competition;
  var bad = bankBad.questions.filter(function (q) { return q.subject === 'Mathematics'; })[0];
  bad.answer = 99;                                  /* no such option */
  saveData(dbBad);
  var draft2 = await call('POST', '/api/free2027/admin/activities', {
    kind: 'competition', title: 'Invalid Key Cup', opensAt: Date.now() - 1000, closesAt: Date.now() + 7200000,
    durationMin: 120, maxAttempts: 1, questionCount: 180, subjectDistribution: DIST, status: 'draft'
  }, adm);
  ok('a bank with an invalid answer key cannot supply a full standard paper', draft2.status >= 400, draft2.raw.slice(0, 200));
  var dbFix = dataFile();
  dbFix.free2027.questionBanks.competition.questions
    .filter(function (q) { return String(q.id) === String(bad.id); })[0].answer = 1;
  saveData(dbFix);

  var dbDupId = dataFile();
  var sDupId = dbDupId.free2027.sessions[dbDupId.free2027.sessions.length - 1];
  var gatedRec = sDupId.activities.filter(function (a) { return a.id === gated; })[0];
  gatedRec.status = 'draft'; gatedRec.published = false;
  gatedRec.questionIds = gatedRec.questionIds.concat([gatedRec.questionIds[0]]);
  saveData(dbDupId);
  var dupBlock = await call('POST', '/api/free2027/admin/activities/' + gated + '/publish', {}, adm);
  ok('a duplicated question id blocks the launch', dupBlock.status === 409 && /duplicate question ID/.test(dupBlock.body.error), dupBlock.raw.slice(0, 200));

  var dbSwap = dataFile();
  var sSwap = dbSwap.free2027.sessions[dbSwap.free2027.sessions.length - 1];
  var swapRec = sSwap.activities.filter(function (a) { return a.id === gated; })[0];
  swapRec.questionIds = swapRec.questionIds.filter(function (id, i, arr) { return arr.indexOf(id) === i; });
  saveData(dbSwap);
  var rePub = await call('POST', '/api/free2027/admin/activities/' + gated + '/publish', {}, adm);
  ok('removing the duplicate lets the same paper launch', rePub.status === 200, rePub.raw.slice(0, 160));

  head('B. a bank larger than 180 still works, and a smaller competition is untouched');
  var more = await call('POST', '/api/free2027/admin/question-banks/competition/import',
    { csv: smallCsv('Spare', ['Biology'], 12) }, adm);
  ok('the bank can hold more than 180 questions', more.status === 200, more.raw.slice(0, 140));
  var bigBank = await call('POST', '/api/free2027/admin/activities', {
    kind: 'competition', title: 'Big Bank Cup', opensAt: Date.now() - 1000, closesAt: Date.now() + 7200000,
    durationMin: 120, maxAttempts: 1, questionCount: 180, subjectDistribution: DIST, status: 'draft'
  }, adm);
  ok('a standard paper still allocates exactly 180 from the larger bank',
    bigBank.status === 200 && bigBank.body.activity.questionIds.length === 180, bigBank.raw.slice(0, 180));
  var bigPub = await call('POST', '/api/free2027/admin/activities/' + bigBank.body.activity.id + '/publish', {}, adm);
  ok('the larger bank launches normally', bigPub.status === 200);

  var small = await call('POST', '/api/free2027/admin/activities', {
    kind: 'competition', title: 'Small Cup', opensAt: Date.now() - 1000, closesAt: Date.now() + 7200000,
    durationMin: 30, maxAttempts: 1, questionCount: 6, status: 'draft'
  }, adm);
  ok('a small competition needs no subject distribution', small.status === 200, small.raw.slice(0, 180));
  var smallPub = await call('POST', '/api/free2027/admin/activities/' + small.body.activity.id + '/publish', {}, adm);
  ok('a small competition is not held to the 180-question gate', smallPub.status === 200, smallPub.raw.slice(0, 160));
  var smallSit = await call('POST', '/api/free2027/activities/' + small.body.activity.id + '/start', {}, cat.token);
  var skey = bankKey('competition');
  var sresp = {};
  smallSit.body.questions.forEach(function (q) { sresp[String(q.id)] = skey[String(q.id)]; });
  var smallRes = (await call('POST', '/api/free2027/attempts/' + smallSit.body.attempt.id + '/submit', { responses: sresp }, cat.token)).body.result;
  ok('a small competition keeps its original raw marking',
    smallRes.score === 6 && smallRes.maxScore === 6 && smallRes.scoring === 'raw',
    JSON.stringify({ s: smallRes.score, m: smallRes.maxScore, model: smallRes.scoring }));
  ok('a small competition result is still reviewable',
    (await call('GET', '/api/free2027/attempts/' + smallSit.body.attempt.id + '/review', undefined, cat.token)).status === 200);

  head('the original hub is untouched');
  var health = await call('GET', '/api/health');
  ok('the hub still serves', health.status === 200 && health.body.service === 'goc-academy-hub');
  var dbFinal = dataFile();
  ok('the original hub question bank was never written to', Array.isArray(dbFinal.questions) && dbFinal.questions.length > 0);
  ok('the original hub roster is intact and was never reseeded',
    Array.isArray(dbFinal.students) && Array.isArray(dbFinal.staff) &&
    dbFinal.staff.some(function (m) { return m.id === 'GOC-A-001'; }),
    JSON.stringify({ students: (dbFinal.students || []).length, staff: (dbFinal.staff || []).length }));
  ok('the server logged no unhandled rejection', serverLog.indexOf('UnhandledPromiseRejection') < 0);

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  kill();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('\nHARNESS ERROR: ' + (e && e.stack || e));
  console.log(serverLog.slice(-2000));
  kill();
  process.exit(1);
});
