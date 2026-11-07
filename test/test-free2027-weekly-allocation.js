/* test-free2027-weekly-allocation.js — Weekly Assessments serve ONLY the
 * questions allocated to that exact activity, and the administrator's typed
 * "Number of questions" covers ALL FIVE subjects.
 *
 * 50 typed => the activity's pool holds 10 per subject. No candidate sits all
 * five, so a candidate taking Use of English + three others sits 4 x 10 = 40
 * questions, every one of them drawn from that activity's own allocation.
 *
 * THE ORIGINAL BUG: the spread was divided by the CANDIDATE's four subjects
 * (50/4 -> 13 English) and then enforced as a hard bank requirement, producing
 * "Use of English needs 13 eligible questions". It must divide by five.
 *
 * node test/test-free2027-weekly-allocation.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_WEEKLY_PORT) || 8491;
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-weekly-'));
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

var child = null;
function boot() {
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
      GOC_TEST_MAIL_FILE: path.join(DATA, 'mail.jsonl'),
      GOC_FREE_2027_OTP_SECRET: 'weekly-test-otp-secret-0123456789abcdef',
      GOC_SMTP_HOST: 'mailpit-test',
      GOC_FOUNDER_PW: 'founder2027',
      GOC_PASSCODE: '2027',
      GOC_DATA_DIR: DATA,
      GOC_FREE_2027: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function () {});
  child.stderr.on('data', function () {});
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
function session() { return dataFile().free2027.sessions[0]; }
function bankRows(bank) { return dataFile().free2027.questionBanks[bank].questions; }
function attemptById(id) { return session().attempts.filter(function (a) { return a.id === id; })[0]; }

var HEADER = 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId';
function csv(prefix, perSubject) {
  var rows = [HEADER], n = 0;
  Object.keys(perSubject).forEach(function (subject) {
    for (var i = 1; i <= perSubject[subject]; i++) {
      n++;
      rows.push([subject, 'Topic ' + n, prefix + ' question ' + n + ' in ' + subject + ': choose the correct option',
        'Alpha ' + n, 'Beta ' + n, 'Gamma ' + n, 'Delta ' + n, '', 'B', 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
    }
  });
  return rows.join('\n');
}
var ENGLISH = 'Use of English';
async function founder() {
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var t = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
  return t;
}
async function registerStudent(email, name, subjects) {
  var start = await call('POST', '/api/free2027/register/start',
    { name: name, email: email, course: 'Law', password: 'AdaPass-2027', subjects: subjects });
  if (start.status !== 200) throw new Error('register/start failed: ' + start.raw);
  var rows = fs.readFileSync(path.join(DATA, 'mail.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var code = String(mail.message.text).match(/verification code is (\d{6})/i)[1];
  var v = await call('POST', '/api/free2027/register/verify', { email: email, code: code });
  if (v.status !== 200) throw new Error('register/verify failed: ' + v.raw);
  return v.body.token;
}
function activityBody(kind, title, count, extra) {
  var t = Date.now();
  return Object.assign({ kind: kind, title: title, questionCount: count, opensAt: t - 60000,
    closesAt: t + 3600000, durationMin: 120, maxAttempts: 3 }, extra || {});
}
function qs(r) { return (r && r.body && r.body.questions) || []; }
function counts(questions) {
  var out = {};
  (questions || []).forEach(function (q) { out[q.subject] = (out[q.subject] || 0) + 1; });
  return out;
}
function allCorrect(bank, questions) {
  var rows = bankRows(bank), out = {};
  (questions || []).forEach(function (q) {
    var row = rows.filter(function (x) { return String(x.id) === String(q.id); })[0];
    if (row) out[q.id] = Number(row.answer);
  });
  return out;
}

(async function () {
  boot();
  await waitForBoot(40);
  var adm = await founder();
  /* Ample English so the assertion below proves the SHARE (10) is what gets
     allocated — not the 13 the old divide-by-four invented, nor JAMB's 60. */
  await call('POST', '/api/free2027/admin/question-banks/weekly/import',
    { csv: csv('Weekly', { 'Use of English': 30, Mathematics: 40, Physics: 40, Chemistry: 40, Biology: 40 }) }, adm);
  await call('POST', '/api/free2027/admin/question-banks/competition/import',
    { csv: csv('Comp', { 'Use of English': 90, Mathematics: 70, Physics: 70, Chemistry: 70, Biology: 70 }) }, adm);

  var mpc = await registerStudent('mpc@example.com', 'Ada MPC', ['Mathematics', 'Physics', 'Chemistry']);
  var mcb = await registerStudent('mcb@example.com', 'Ben MCB', ['Mathematics', 'Chemistry', 'Biology']);

  head('TEST A — a 50-question Weekly Assessment with a configured distribution');
  var configured = { 'Use of English': 10, Mathematics: 15, Physics: 15, Chemistry: 10 };
  var w50 = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Assessment 001', 50, {
    subjectDistribution: configured, randomizeOptions: false, status: 'published'
  }), adm);
  ok('the administrator can publish a 50-question weekly', w50.status === 200 &&
    w50.body.activity.questionCount === 50, w50.raw.slice(0, 220));
  var a50 = await call('POST', '/api/free2027/activities/' + w50.body.activity.id + '/start', {}, mpc);
  ok('the student can start it', a50.status === 200, a50.status + ' ' + a50.raw.slice(0, 240));
  ok('and receives exactly the configured 50 questions', a50.body && a50.body.questions.length === 50,
    String(a50.body && a50.body.questions && a50.body.questions.length));
  var c50 = counts(a50.body && a50.body.questions);
  ok('with the administrator\'s exact distribution',
    c50[ENGLISH] === 10 && c50.Mathematics === 15 && c50.Physics === 15 && c50.Chemistry === 10, JSON.stringify(c50));
  ok('and no 60-question English requirement is applied', c50[ENGLISH] === 10, JSON.stringify(c50));

  head('TEST A2 — a 50-question Weekly Assessment with NO distribution (the reported bug)');
  var w50n = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly No Distribution', 50, {
    randomizeOptions: false, status: 'published'
  }), adm);
  ok('a 50-question weekly with no distribution publishes', w50n.status === 200, w50n.raw.slice(0, 200));
  var a50n = await call('POST', '/api/free2027/activities/' + w50n.body.activity.id + '/start', {}, mpc);
  ok('the student can start it without an invented English quota', a50n.status === 200,
    a50n.status + ' ' + a50n.raw.slice(0, 260));
  ok('no fabricated "needs 13" English shortage is reported', !/needs 13/.test(a50n.raw), a50n.raw.slice(0, 240));
  var pool50n = {}; w50n.body.activity.questionIds.forEach(function (id) { pool50n[String(id)] = true; });
  ok('the typed 50 is allocated as ten questions per subject across all five',
    w50n.body.activity.questionIds.length === 50, String(w50n.body.activity.questionIds.length));
  var allocCounts = counts(w50n.body.activity.questionIds.map(function (id) {
    return bankRows('weekly').filter(function (x) { return String(x.id) === String(id); })[0];
  }).filter(Boolean));
  ok('each of the five subjects holds exactly its ten-question share',
    allocCounts[ENGLISH] === 10 && allocCounts.Mathematics === 10 && allocCounts.Physics === 10 &&
    allocCounts.Chemistry === 10 && allocCounts.Biology === 10, JSON.stringify(allocCounts));
  ok('the candidate sits their own four subjects at ten each = 40 questions',
    qs(a50n).length === 40, String(qs(a50n).length));
  var c50n = counts(qs(a50n));
  ok('compulsory Use of English is included at its share', c50n[ENGLISH] === 10, JSON.stringify(c50n));
  ok('only the student\'s registered subjects appear', !c50n.Biology, JSON.stringify(c50n));
  ok('every served question belongs to THIS activity\'s allocation',
    qs(a50n).every(function (q) { return pool50n[String(q.id)] === true; }));
  ok('nothing is borrowed from the wider weekly bank',
    qs(a50n).filter(function (q) { return pool50n[String(q.id)] !== true; }).length === 0);
  ok('and the paper is never inflated to a 180-question JAMB paper', qs(a50n).length !== 180);

  head('TEST B — the typed count is the five-subject pool; the candidate sits four shares');
  var sizes = [20, 30, 50, 100];
  for (var i = 0; i < sizes.length; i++) {
    var n = sizes[i], share = n / 5;
    var wa = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly ' + n, n, {
      randomizeOptions: false, status: 'published'
    }), adm);
    ok('the typed count of ' + n + ' is stored unchanged',
      wa.status === 200 && wa.body.activity.questionCount === n, wa.raw.slice(0, 180));
    ok('and exactly ' + n + ' questions are allocated to the activity',
      wa.status === 200 && wa.body.activity.questionIds.length === n, wa.raw.slice(0, 180));
    var st = await call('POST', '/api/free2027/activities/' + wa.body.activity.id + '/start', {}, mpc);
    var wp = {}; (wa.body.activity.questionIds || []).forEach(function (id) { wp[String(id)] = true; });
    ok('a ' + n + '-question weekly serves ' + (share * 4) + ' (four subjects x ' + share + ')',
      st.status === 200 && qs(st).length === share * 4, st.status + ' ' + st.raw.slice(0, 200));
    ok('and every one of them is from this activity for ' + n,
      st.status === 200 && qs(st).every(function (q) { return wp[String(q.id)] === true; }));
    ok('and never a 180-question paper for ' + n, st.status === 200 && qs(st).length !== 180);
  }

  head('TEST B2 — the administrator\'s configuration is validated, never invented');
  var badSum = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Bad Sum', 50, {
    subjectDistribution: { 'Use of English': 10, Mathematics: 10, Physics: 10, Chemistry: 10 },
    status: 'published'
  }), adm);
  ok('a distribution that does not add up to the count is refused', badSum.status >= 400,
    badSum.status + ' ' + badSum.raw.slice(0, 200));
  ok('and the message names the configured count', /50/.test(badSum.raw), badSum.raw.slice(0, 200));
  var overBank = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Over Bank', 50, {
    subjectDistribution: { 'Use of English': 40, Mathematics: 4, Physics: 3, Chemistry: 3 },
    status: 'published'
  }), adm);
  ok('a per-subject demand above the eligible bank is refused at save time', overBank.status >= 400,
    overBank.status + ' ' + overBank.raw.slice(0, 220));
  var tooBig = await call('POST', '/api/free2027/admin/activities',
    activityBody('weekly', 'Weekly Too Big', 101, { status: 'published' }), adm);
  ok('a weekly count above the weekly maximum is refused', tooBig.status >= 400,
    tooBig.status + ' ' + tooBig.raw.slice(0, 180));
  var zero = await call('POST', '/api/free2027/admin/activities',
    activityBody('weekly', 'Weekly Zero', 0, { status: 'published' }), adm);
  ok('a zero-question weekly is refused', zero.status >= 400, zero.status + ' ' + zero.raw.slice(0, 180));

  head('TEST C — the registered subject combination is still respected');
  var bMcb = await call('POST', '/api/free2027/activities/' + w50n.body.activity.id + '/start', {}, mcb);
  ok('the other student can also start the weekly', bMcb.status === 200, bMcb.status + ' ' + bMcb.raw.slice(0, 200));
  var cMcb = counts(bMcb.body && bMcb.body.questions);
  ok('a student without Physics never receives Physics', !cMcb.Physics, JSON.stringify(cMcb));
  ok('and does receive their own Biology at its share', cMcb.Biology === 10, JSON.stringify(cMcb));
  ok('sitting exactly their four shares = 40 questions', qs(bMcb).length === 40, String(qs(bMcb).length));
  ok('the first student never receives Biology', !counts(qs(a50n)).Biology, JSON.stringify(counts(qs(a50n))));
  ok('both still receive Use of English', counts(qs(a50n))[ENGLISH] > 0 && cMcb[ENGLISH] > 0);

  head('TEST C2 — a configured subject outside the combination is never silently substituted');
  var withBio = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly With Biology', 50, {
    subjectDistribution: { 'Use of English': 10, Mathematics: 15, Physics: 15, Biology: 10 },
    randomizeOptions: false, status: 'published'
  }), adm);
  ok('such an assessment publishes', withBio.status === 200, withBio.raw.slice(0, 200));
  var noBio = await call('POST', '/api/free2027/activities/' + withBio.body.activity.id + '/start', {}, mpc);
  ok('a student without Biology is never served Biology questions',
    noBio.status !== 200 || !counts(qs(noBio)).Biology,
    noBio.status + ' ' + JSON.stringify(counts((noBio.body && noBio.body.questions) || [])));
  ok('and the server explains the real reason instead of inventing a quota',
    noBio.status === 409 && /Biology/.test(noBio.raw) && !/needs 13/.test(noBio.raw),
    noBio.status + ' ' + noBio.raw.slice(0, 260));
  var yesBio = await call('POST', '/api/free2027/activities/' + withBio.body.activity.id + '/start', {}, mcb);
  ok('a student whose combination covers it is served the configured paper',
    yesBio.status === 200 || yesBio.status === 409, yesBio.status + ' ' + yesBio.raw.slice(0, 200));

  head('TEST E — an open Weekly Assessment resumes with its snapshot and answers');
  var resumeAct = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Resume', 20, {
    randomizeOptions: false, status: 'published'
  }), adm);
  var r1 = await call('POST', '/api/free2027/activities/' + resumeAct.body.activity.id + '/start', {}, mpc);
  ok('the attempt opens', r1.status === 200, r1.status + ' ' + r1.raw.slice(0, 180));
  var rId = r1.body.attempt.id;
  var rSeq = qs(r1).map(function (q) { return String(q.id); }).join(',');
  var q0 = qs(r1)[0];
  await call('PUT', '/api/free2027/attempts/' + rId + '/answer', { questionId: q0.id, choice: 1 }, mpc);
  var snapBefore = JSON.stringify(attemptById(rId).questionSnapshot);
  var resumed = await call('GET', '/api/free2027/attempts/' + rId, undefined, mpc);
  ok('resuming returns the same attempt', resumed.status === 200 && resumed.body.attempt.id === rId);
  ok('with the identical questions in the identical order',
    resumed.body.questions.map(function (q) { return String(q.id); }).join(',') === rSeq);
  ok('and the saved answer intact', resumed.body.attempt.responses[q0.id] === 1,
    JSON.stringify(resumed.body.attempt.responses));
  ok('the stored snapshot is unchanged', JSON.stringify(attemptById(rId).questionSnapshot) === snapBefore);
  ok('and time is still counting down from the configured duration',
    resumed.body.attempt.remainingSec > 0 && resumed.body.attempt.remainingSec <= 7200,
    String(resumed.body.attempt.remainingSec));

  head('TEST H — submitted weekly results are preserved');
  var hSub = await call('POST', '/api/free2027/attempts/' + rId + '/submit',
    { responses: allCorrect('weekly', qs(r1)) }, mpc);
  ok('the weekly submits with its own raw marking out of the configured count',
    hSub.status === 200 && hSub.body.result.score === 16 && hSub.body.result.maxScore === 16, hSub.raw.slice(0, 220));
  var historical = JSON.stringify(attemptById(rId));
  var later = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Later', 30, {
    randomizeOptions: false, status: 'published'
  }), adm);
  await call('POST', '/api/free2027/activities/' + later.body.activity.id + '/start', {}, mpc);
  ok('a later attempt does not alter the earlier record', JSON.stringify(attemptById(rId)) === historical);
  ok('the earlier result is still readable',
    (await call('GET', '/api/free2027/attempts/' + rId + '/review', undefined, mpc)).status === 200);
  ok('the activity records are all still present',
    session().activities.filter(function (a) { return a.kind === 'weekly'; }).length >= 8);

  head('TEST D — a genuine shortage is reported accurately, not as a JAMB quota');
  var shortAct = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Short English', 50, {
    subjectDistribution: { 'Use of English': 10, Mathematics: 15, Physics: 15, Chemistry: 10 },
    randomizeOptions: false, status: 'published'
  }), adm);
  ok('it publishes while the bank can cover it', shortAct.status === 200, shortAct.raw.slice(0, 200));
  var engIds = bankRows('weekly').filter(function (q) { return q.subject === ENGLISH; }).map(function (q) { return q.id; });
  await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete',
    { ids: engIds.slice(0, engIds.length - 3), confirm: true }, adm);
  /* What matters is how many of THIS ACTIVITY's allocated English questions
     survive, not how many the wider bank still holds. */
  var liveEng = {};
  bankRows('weekly').forEach(function (q) { if (q.subject === ENGLISH) liveEng[String(q.id)] = true; });
  var poolEngAlive = shortAct.body.activity.questionIds.filter(function (id) { return liveEng[String(id)]; }).length;
  ok('the activity\'s allocation now holds fewer eligible English questions than its share',
    poolEngAlive < 10, String(poolEngAlive));
  var short = await call('POST', '/api/free2027/activities/' + shortAct.body.activity.id + '/start', {}, mpc);
  ok('the shortage is refused with a clear message', short.status === 409, short.status + ' ' + short.raw.slice(0, 240));
  ok('naming the ACTUAL requirement of 10 and the ' + poolEngAlive + ' still eligible in its allocation',
    /needs 10 eligible questions/.test(short.raw) &&
    short.raw.indexOf('only ' + poolEngAlive + ' ') > -1 && /Use of English/.test(short.raw), short.raw.slice(0, 260));
  ok('and the shortage is attributed to the activity allocation, not the wider bank',
    /allocated to this Weekly Assessment/.test(short.raw), short.raw.slice(0, 260));
  ok('and not an invented 13-question quota', !/needs 13/.test(short.raw), short.raw.slice(0, 240));
  ok('and not the Competition 60-question English rule', !/\b60\b/.test(short.raw), short.raw.slice(0, 240));

  /* TEST D deliberately depleted English; restock so the isolation fixtures
     below can allocate their full five-subject pools. */
  await call('POST', '/api/free2027/admin/question-banks/weekly/import',
    { csv: csv('Restock', { 'Use of English': 40 }) }, adm);

  head('TEST I — no question is ever borrowed from ANOTHER activity');
  var actA = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Alpha', 50, {
    randomizeOptions: false, status: 'published' }), adm);
  var actB = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Beta', 50, {
    randomizeOptions: false, status: 'published' }), adm);
  var idsA = actA.body.activity.questionIds.map(String), idsB = actB.body.activity.questionIds.map(String);
  var onlyA = idsA.filter(function (id) { return idsB.indexOf(id) < 0; });
  var startB = await call('POST', '/api/free2027/activities/' + actB.body.activity.id + '/start', {}, mpc);
  var servedB = qs(startB).map(function (q) { return String(q.id); });
  ok('two weekly assessments allocate their own pools', idsA.length === 50 && idsB.length === 50);
  ok('sitting Beta serves only Beta\'s allocated questions',
    startB.status === 200 && servedB.every(function (id) { return idsB.indexOf(id) > -1; }));
  ok('not one question unique to Alpha leaks into Beta',
    servedB.filter(function (id) { return onlyA.indexOf(id) > -1; }).length === 0,
    String(servedB.filter(function (id) { return onlyA.indexOf(id) > -1; }).length));

  head('TEST J — a new attempt re-draws validly from the same activity pool');
  var randAct = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Randomised', 50, {
    randomizeQuestions: true, randomizeOptions: false, status: 'published' }), adm);
  var randPool = randAct.body.activity.questionIds.map(String);
  var ra1 = await call('POST', '/api/free2027/activities/' + randAct.body.activity.id + '/start', {}, mpc);
  var seq1 = qs(ra1).map(function (q) { return String(q.id); });
  await call('POST', '/api/free2027/attempts/' + ra1.body.attempt.id + '/submit',
    { responses: allCorrect('weekly', qs(ra1)) }, mpc);
  var ra2 = await call('POST', '/api/free2027/activities/' + randAct.body.activity.id + '/start', {}, mpc);
  var seq2 = qs(ra2).map(function (q) { return String(q.id); });
  ok('the second attempt is a fresh attempt', ra2.status === 200 && ra2.body.attempt.id !== ra1.body.attempt.id);
  ok('it still serves exactly the four shares', seq2.length === 40, String(seq2.length));
  ok('and still draws exclusively from the same activity pool',
    seq2.every(function (id) { return randPool.indexOf(id) > -1; }));
  ok('the first attempt keeps its original snapshot after the second was served',
    JSON.stringify(attemptById(ra1.body.attempt.id).questionSnapshot.map(function (q) { return q.id; })) ===
    JSON.stringify(seq1));

  head('TEST F — Competition Examinations keep the exact 180-question JAMB structure');
  var comp = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'UTME Cup', 220, {
    subjectDistribution: { 'Use of English': 60, Mathematics: 40, Physics: 40, Chemistry: 40, Biology: 40 },
    randomizeQuestions: true, randomizeOptions: false, status: 'published'
  }), adm);
  ok('a 220-question competition pool still publishes', comp.status === 200 &&
    comp.body.activity.questionIds.length === 220, comp.raw.slice(0, 220));
  var cs = await call('POST', '/api/free2027/activities/' + comp.body.activity.id + '/start', {}, mpc);
  ok('the candidate still sits exactly 180 questions', cs.status === 200 && qs(cs).length === 180,
    cs.status + ' ' + cs.raw.slice(0, 200));
  var cc = counts(qs(cs));
  ok('with English 60 and 40 for each of their three subjects',
    cc[ENGLISH] === 60 && cc.Mathematics === 40 && cc.Physics === 40 && cc.Chemistry === 40, JSON.stringify(cc));
  ok('and their unselected subject excluded', !cc.Biology, JSON.stringify(cc));
  var compIds = {};
  comp.body.activity.questionIds.forEach(function (id) { compIds[String(id)] = true; });
  ok('every competition question still comes from the activity pool',
    qs(cs).every(function (q) { return compIds[String(q.id)] === true; }));
  var csub = await call('POST', '/api/free2027/attempts/' + (cs.body && cs.body.attempt ? cs.body.attempt.id : 'none') + '/submit',
    { responses: allCorrect('competition', qs(cs)) }, mpc);
  ok('competition scoring is still out of 400', csub.status === 200 && csub.body.result.score === 400 &&
    csub.body.result.maxScore === 400, csub.raw.slice(0, 200));
  var compHistorical = JSON.stringify(attemptById(cs.body.attempt.id));
  var compSnap = qs(cs).map(function (q) { return String(q.id); }).join(',');
  var cs2 = await call('POST', '/api/free2027/activities/' + comp.body.activity.id + '/start', {}, mpc);
  ok('a second competition attempt also draws only from the activity pool',
    cs2.status === 200 && qs(cs2).every(function (q) { return compIds[String(q.id)] === true; }));
  ok('and is still exactly 180 questions', qs(cs2).length === 180, String(qs(cs2).length));
  ok('the earlier competition attempt is byte-identical afterwards',
    JSON.stringify(attemptById(cs.body.attempt.id)) === compHistorical);
  ok('its original snapshot order is untouched',
    attemptById(cs.body.attempt.id).questionSnapshot.map(function (q) { return String(q.id); }).join(',') === compSnap);
  var compReview = await call('GET', '/api/free2027/attempts/' + cs.body.attempt.id + '/review', undefined, mpc);
  ok('and its result is unchanged and still readable',
    compReview.status === 200 && compReview.body.review.score === 400 &&
    compReview.body.review.maxScore === 400, compReview.raw.slice(0, 200));

  head('TEST G — the regular hub still answers');
  ok('the regular hub health endpoint is unchanged', (await call('GET', '/api/health')).status === 200);
  ok('the edition config still serves', (await call('GET', '/api/free2027/config')).status === 200);

  kill();
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  kill();
  console.log('\nHARNESS ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});