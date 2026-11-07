/* test-free2027-combination.js — the student's registered JAMB subject
   combination: registration validation, persistence, the one-time choice for
   older records, and per-student allocation in BOTH Weekly Assessments and
   Competition Examinations, including subject grouping and /400 marking.
   node test/test-free2027-combination.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_COMB_PORT) || 8489;
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-comb-'));
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
      GOC_FREE_2027_OTP_SECRET: 'comb-test-otp-secret-0123456789abcdef',
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

var HEADER = 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId';
/* Explicit per-subject counts, so a bank can hold a full five-subject pool. */
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
var CANON = [ENGLISH, 'Mathematics', 'Physics', 'Chemistry', 'Biology'];

async function founder() {
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var t = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
  return t;
}
/* subjects omitted => a record from before combinations existed. */
async function registerStudent(email, name, subjects) {
  var body = { name: name, email: email, course: 'Law', password: 'AdaPass-2027' };
  if (subjects !== undefined) body.subjects = subjects;
  var start = await call('POST', '/api/free2027/register/start', body);
  if (start.status !== 200) return { error: start };
  var rows = fs.readFileSync(path.join(DATA, 'mail.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var code = String(mail.message.text).match(/verification code is (\d{6})/i)[1];
  var v = await call('POST', '/api/free2027/register/verify', { email: email, code: code });
  if (v.status !== 200) return { error: v };
  return { token: v.body.token, participant: v.body.participant };
}
async function login(email) {
  var r = await call('POST', '/api/free2027/login', { email: email, password: 'AdaPass-2027' });
  return r;
}
function activityBody(kind, title, count, extra) {
  var t = Date.now();
  return Object.assign({ kind: kind, title: title, questionCount: count, opensAt: t - 60000,
    closesAt: t + 3600000, durationMin: 120, maxAttempts: 3 }, extra || {});
}
function subjectCounts(questions) {
  var out = {};
  (questions || []).forEach(function (q) { out[q.subject] = (out[q.subject] || 0) + 1; });
  return out;
}
function subjectSequence(questions) {
  var out = [];
  (questions || []).forEach(function (q) { if (out[out.length - 1] !== q.subject) out.push(q.subject); });
  return out;
}
/* randomizeOptions is off in these papers, so the displayed index is the
   stored answer index and a full-marks paper can be built from the bank. */
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
  /* A competition bank able to serve ANY of the four possible combinations. */
  await call('POST', '/api/free2027/admin/question-banks/competition/import',
    { csv: csv('Comp', { 'Use of English': 90, Mathematics: 70, Physics: 70, Chemistry: 70, Biology: 70 }) }, adm);
  await call('POST', '/api/free2027/admin/question-banks/weekly/import',
    { csv: csv('Weekly', { 'Use of English': 20, Mathematics: 20, Physics: 20, Chemistry: 20, Biology: 20 }) }, adm);

  head('Registration: Use of English is compulsory and exactly three others are chosen');
  var good = await registerStudent('mpc@example.com', 'Ada MPC', ['Mathematics', 'Physics', 'Chemistry']);
  ok('a valid combination registers', !!good.token, JSON.stringify(good.error || {}).slice(0, 200));
  ok('Use of English is added even though the student never chose it',
    good.participant && good.participant.subjects.join('|') === 'Use of English|Mathematics|Physics|Chemistry',
    JSON.stringify(good.participant && good.participant.subjects));
  ok('the record no longer asks for a combination', good.participant && good.participant.needsSubjects === false);

  var four = await registerStudent('four@example.com', 'Four Subjects', ['Mathematics', 'Physics', 'Chemistry', 'Biology']);
  ok('all four additional subjects are rejected', four.error && four.error.status === 400 &&
    /exactly 3 additional subjects/i.test(four.error.raw), JSON.stringify(four.error || {}).slice(0, 200));
  var two = await registerStudent('two@example.com', 'Two Subjects', ['Mathematics', 'Physics']);
  ok('fewer than three additional subjects are rejected', two.error && two.error.status === 400 &&
    /exactly 3 additional subjects/i.test(two.error.raw), JSON.stringify(two.error || {}).slice(0, 200));
  var unknown = await registerStudent('unknown@example.com', 'Unknown Subject', ['Mathematics', 'Physics', 'Economics']);
  ok('an unknown subject is rejected', unknown.error && unknown.error.status === 400 &&
    /Unknown subject/.test(unknown.error.raw), JSON.stringify(unknown.error || {}).slice(0, 200));
  var explicitEnglish = await registerStudent('eng@example.com', 'Explicit English', [ENGLISH, 'Physics', 'Chemistry', 'Biology']);
  ok('sending Use of English explicitly does not count as a fourth choice',
    !!explicitEnglish.token && explicitEnglish.participant.subjects.join('|') === 'Use of English|Physics|Chemistry|Biology',
    JSON.stringify(explicitEnglish.participant && explicitEnglish.participant.subjects));

  head('The saved combination survives signing out and logging back in');
  var me1 = await call('GET', '/api/free2027/me', undefined, good.token);
  ok('the student payload carries the combination', me1.status === 200 &&
    me1.body.participant.subjects.join('|') === 'Use of English|Mathematics|Physics|Chemistry', me1.raw.slice(0, 200));
  await call('POST', '/api/free2027/logout', {}, good.token);
  var again = await login('mpc@example.com');
  ok('logging in again returns the same saved combination', again.status === 200 &&
    again.body.participant.subjects.join('|') === 'Use of English|Mathematics|Physics|Chemistry', again.raw.slice(0, 220));
  ok('and the student is not asked to choose again', again.body.participant.needsSubjects === false);
  ok('the identifier is unchanged', again.body.participant.id === good.participant.id);
  var rechoose = await call('PUT', '/api/free2027/subjects', { subjects: ['Physics', 'Chemistry', 'Biology'] }, again.body.token);
  ok('a saved combination cannot be accidentally replaced', rechoose.status === 409 &&
    /already saved/i.test(rechoose.raw), rechoose.status + ' ' + rechoose.raw.slice(0, 180));
  var stillMe = await call('GET', '/api/free2027/me', undefined, again.body.token);
  ok('the refused change left the saved combination intact',
    stillMe.body.participant.subjects.join('|') === 'Use of English|Mathematics|Physics|Chemistry');
  var stu = again.body.token;
  var pcb = explicitEnglish.token;

  head('Competition: each candidate sits their OWN combination from the same activity');
  /* TEST A: the activity owns a POOL of 220 questions spread over all five
     subjects. Every candidate still sits exactly 180 of them. */
  var pool220 = { 'Use of English': 60, Mathematics: 40, Physics: 40, Chemistry: 40, Biology: 40 };
  var comp = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'UTME Cup', 220, {
    subjectDistribution: pool220,
    randomizeQuestions: true, randomizeOptions: false, status: 'published'
  }), adm);
  ok('a 220-question competition pool saves and publishes', comp.status === 200 &&
    comp.body.activity.questionCount === 220, comp.raw.slice(0, 240));
  ok('all 220 question IDs are allocated to the activity',
    comp.body.activity.questionIds.length === 220, String(comp.body.activity.questionIds.length));
  var savedDist = comp.body.activity.subjectDistribution || {};
  ok('the saved distribution totals 220',
    Object.keys(savedDist).reduce(function (n, k) { return n + Number(savedDist[k]); }, 0) === 220,
    JSON.stringify(savedDist));
  var poolRows = (function () {
    var rows = bankRows('competition');
    return comp.body.activity.questionIds.map(function (id) {
      return rows.filter(function (x) { return String(x.id) === String(id); })[0];
    }).filter(Boolean);
  })();
  var poolCounts = subjectCounts(poolRows);
  ok('every allocated ID resolves in the competition bank', poolRows.length === 220, String(poolRows.length));
  ok('the allocated IDs match the saved distribution subject for subject',
    CANON.every(function (subj) { return (poolCounts[subj] || 0) === pool220[subj]; }) &&
    Object.keys(poolCounts).length === 5, JSON.stringify(poolCounts));
  ok('a pool larger than the eligible bank is still refused',
    (await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'Too Big', 400, {
      subjectDistribution: { 'Use of English': 120, Mathematics: 70, Physics: 70, Chemistry: 70, Biology: 70 }
    }), adm)).status === 400);
  var compId = comp.body.activity.id;

  var s1 = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, stu);
  ok('a candidate with Mathematics/Physics/Chemistry starts a 180 paper',
    s1.status === 200 && s1.body.questions.length === 180, s1.status + ' ' + s1.raw.slice(0, 200));
  var c1 = subjectCounts(s1.body.questions);
  ok('their counts are the real allocation: English 60 and 40 each',
    c1[ENGLISH] === 60 && c1.Mathematics === 40 && c1.Physics === 40 && c1.Chemistry === 40, JSON.stringify(c1));
  ok('the unselected subject is absent from the paper', !c1.Biology, JSON.stringify(c1));

  var s2 = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, pcb);
  ok('a candidate with Physics/Chemistry/Biology starts the SAME activity',
    s2.status === 200 && s2.body.questions.length === 180, s2.status + ' ' + s2.raw.slice(0, 200));
  var c2 = subjectCounts(s2.body.questions);
  ok('they receive Biology from the activity\'s own allocated pool',
    c2[ENGLISH] === 60 && c2.Physics === 40 && c2.Chemistry === 40 && c2.Biology === 40, JSON.stringify(c2));
  ok('and Mathematics is absent from their paper', !c2.Mathematics, JSON.stringify(c2));
  ok('the two candidates were served different papers',
    JSON.stringify(s1.body.questions.map(function (q) { return q.id; })) !==
    JSON.stringify(s2.body.questions.map(function (q) { return q.id; })));

  head('Subject grouping: canonical blocks, and the final question is the final subject');
  ok('the paper is served in canonical subject blocks',
    subjectSequence(s1.body.questions).join('|') === 'Use of English|Mathematics|Physics|Chemistry',
    subjectSequence(s1.body.questions).join('|'));
  ok('the other combination is grouped in canonical order too',
    subjectSequence(s2.body.questions).join('|') === 'Use of English|Physics|Chemistry|Biology',
    subjectSequence(s2.body.questions).join('|'));
  ok('the final question belongs to the last subject of the combination',
    s1.body.questions[179].subject === 'Chemistry', s1.body.questions[179].subject);
  ok('and for the other candidate it is their own last subject',
    s2.body.questions[179].subject === 'Biology', s2.body.questions[179].subject);
  ok('the first question is always Use of English', s1.body.questions[0].subject === ENGLISH);

  head('Marking uses the candidate\'s own subjects and stays out of 400');
  var a1 = s1.body.attempt.id;
  var sub1 = await call('POST', '/api/free2027/attempts/' + a1 + '/submit',
    { responses: allCorrect('competition', s1.body.questions) }, stu);
  ok('a fully correct paper scores 400', sub1.status === 200 && sub1.body.result.score === 400 &&
    sub1.body.result.maxScore === 400, sub1.raw.slice(0, 240));
  var stored1 = session().attempts.filter(function (a) { return a.id === a1; })[0];
  ok('the attempt remembers the distribution it was built from',
    !!stored1.subjectDistribution && stored1.subjectDistribution[ENGLISH] === 60 &&
    stored1.subjectDistribution.Chemistry === 40 && !stored1.subjectDistribution.Biology,
    JSON.stringify(stored1.subjectDistribution));
  ok('the subject scores name the candidate\'s own subjects in canonical order',
    (stored1.subjectScores || []).map(function (x) { return x.subject; }).join('|') ===
    'Use of English|Mathematics|Physics|Chemistry', JSON.stringify(stored1.subjectScores));
  ok('each subject is out of 100', (stored1.subjectScores || []).every(function (x) { return x.score === 100 && x.maxScore === 100; }));

  var a2 = s2.body.attempt.id;
  var sub2 = await call('POST', '/api/free2027/attempts/' + a2 + '/submit',
    { responses: allCorrect('competition', s2.body.questions) }, pcb);
  ok('the other combination also scores 400, so results stay comparable',
    sub2.status === 200 && sub2.body.result.score === 400, sub2.raw.slice(0, 200));
  var stored2 = session().attempts.filter(function (a) { return a.id === a2; })[0];
  ok('no subject is marked against a subject they never sat',
    (stored2.subjectScores || []).map(function (x) { return x.subject; }).join('|') ===
    'Use of English|Physics|Chemistry|Biology', JSON.stringify(stored2.subjectScores));
  var review2 = await call('GET', '/api/free2027/attempts/' + a2 + '/review', undefined, pcb);
  ok('the review shows the paper they actually sat', review2.status === 200 &&
    !subjectCounts(review2.body.questions).Mathematics, review2.status + ' ' + review2.raw.slice(0, 160));

  head('TEST E: the activity pool is the exclusive source of questions');
  var compIds = {};
  comp.body.activity.questionIds.forEach(function (id) { compIds[String(id)] = true; });
  ok('every question served to candidate A belongs to the activity pool',
    s1.body.questions.every(function (q) { return compIds[String(q.id)] === true; }));
  ok('every question served to candidate B belongs to the activity pool',
    s2.body.questions.every(function (q) { return compIds[String(q.id)] === true; }));
  var outside = bankRows('competition').filter(function (q) { return !compIds[String(q.id)]; });
  ok('the bank does hold eligible questions outside this pool', outside.length > 0, String(outside.length));
  var servedIds = {};
  s1.body.questions.concat(s2.body.questions).forEach(function (q) { servedIds[String(q.id)] = true; });
  ok('none of those outside questions is ever served',
    outside.every(function (q) { return servedIds[String(q.id)] !== true; }));
  /* A pool that cannot cover a combination says so precisely, instead of
     quietly borrowing the missing subject from the wider bank. */
  var narrow = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'Narrow Cup', 180, {
    subjectDistribution: { 'Use of English': 60, Mathematics: 40, Physics: 40, Chemistry: 40 },
    randomizeOptions: false, status: 'published'
  }), adm);
  ok('a 180 pool covering only four subjects still publishes', narrow.status === 200, narrow.raw.slice(0, 200));
  var cannot = await call('POST', '/api/free2027/activities/' + narrow.body.activity.id + '/start', {}, pcb);
  ok('a combination the pool cannot cover is refused with subject and counts',
    cannot.status === 409 && /Biology/.test(cannot.raw) && /requires 40/.test(cannot.raw) && /only 0/.test(cannot.raw),
    cannot.status + ' ' + cannot.raw.slice(0, 240));
  ok('even though the wider bank has plenty of Biology',
    bankRows('competition').filter(function (q) { return q.subject === 'Biology'; }).length >= 40);

  head('TEST D: every new attempt is an independent selection from the same pool');
  /* Surplus in every subject, so a later attempt can draw a different set. */
  var surplus = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'Surplus Cup', 320, {
    subjectDistribution: { 'Use of English': 80, Mathematics: 60, Physics: 60, Chemistry: 60, Biology: 60 },
    randomizeQuestions: true, randomizeOptions: false, status: 'published'
  }), adm);
  ok('a 320-question pool with surplus saves', surplus.status === 200 &&
    surplus.body.activity.questionIds.length === 320, surplus.raw.slice(0, 220));
  var surplusIds = {};
  surplus.body.activity.questionIds.forEach(function (id) { surplusIds[String(id)] = true; });
  var d1 = await call('POST', '/api/free2027/activities/' + surplus.body.activity.id + '/start', {}, stu);
  ok('the first attempt is still exactly 180 from a 320 pool',
    d1.status === 200 && d1.body.questions.length === 180, d1.status + ' ' + d1.raw.slice(0, 180));
  var dc1 = subjectCounts(d1.body.questions);
  ok('with the standard 60/40/40/40 distribution',
    dc1[ENGLISH] === 60 && dc1.Mathematics === 40 && dc1.Physics === 40 && dc1.Chemistry === 40, JSON.stringify(dc1));
  ok('and only from this activity\'s pool',
    d1.body.questions.every(function (q) { return surplusIds[String(q.id)] === true; }));
  var d1Id = d1.body.attempt.id;
  var d1Before = JSON.stringify(session().attempts.filter(function (a) { return a.id === d1Id; })[0]);
  var d1Sub = await call('POST', '/api/free2027/attempts/' + d1Id + '/submit',
    { responses: allCorrect('competition', d1.body.questions) }, stu);
  ok('the first attempt submits at 400', d1Sub.status === 200 && d1Sub.body.result.score === 400, d1Sub.raw.slice(0, 180));
  var d1Result = JSON.stringify(session().attempts.filter(function (a) { return a.id === d1Id; })[0]);

  var d2 = await call('POST', '/api/free2027/activities/' + surplus.body.activity.id + '/start', {}, stu);
  ok('a second attempt is served', d2.status === 200 && d2.body.questions.length === 180, d2.status + ' ' + d2.raw.slice(0, 180));
  ok('it is a different attempt record', d2.body.attempt.id !== d1Id);
  function idSet(payload) { return payload.body.questions.map(function (q) { return String(q.id); }).sort().join(','); }
  function idSeq(payload) { return payload.body.questions.map(function (q) { return String(q.id); }).join(','); }
  ok('with surplus available, the SELECTED QUESTIONS differ', idSet(d1) !== idSet(d2));
  ok('the question ORDER is randomised too', idSeq(d1) !== idSeq(d2));
  ok('the second selection is still entirely inside the activity pool',
    d2.body.questions.every(function (q) { return surplusIds[String(q.id)] === true; }));
  var dc2 = subjectCounts(d2.body.questions);
  ok('and still 60/40/40/40 with Biology excluded',
    dc2[ENGLISH] === 60 && dc2.Mathematics === 40 && dc2.Physics === 40 && dc2.Chemistry === 40 && !dc2.Biology, JSON.stringify(dc2));
  ok('the first attempt snapshot and result are untouched by the second attempt',
    JSON.stringify(session().attempts.filter(function (a) { return a.id === d1Id; })[0]) === d1Result);
  ok('and nothing about it changed since before it was submitted either',
    JSON.parse(d1Before).questionSnapshot.length === 180 &&
    JSON.stringify(JSON.parse(d1Result).questionSnapshot) === JSON.stringify(JSON.parse(d1Before).questionSnapshot));

  head('With no surplus, only the order can change — and that is all that is promised');
  var n1 = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, stu);
  ok('a further attempt on the exact-size pool is served', n1.status === 200 && n1.body.questions.length === 180,
    n1.status + ' ' + n1.raw.slice(0, 180));
  ok('the selected set matches the pool exactly (no surplus to vary)', idSet(n1) === idSet(s1));
  ok('but the order is independently randomised', idSeq(n1) !== idSeq(s1));

  head('TEST F: resuming restores the original paper and answers');
  var r1 = await call('POST', '/api/free2027/activities/' + surplus.body.activity.id + '/start', {}, pcb);
  ok('a fresh attempt opens for the other candidate', r1.status === 200, r1.status + ' ' + r1.raw.slice(0, 160));
  var rId = r1.body.attempt.id;
  var pickQ = r1.body.questions[0];
  var saved = await call('PUT', '/api/free2027/attempts/' + rId + '/answer', { questionId: pickQ.id, choice: 1 }, pcb);
  ok('an answer is saved against it', saved.status === 200, saved.raw.slice(0, 160));
  var resumed = await call('GET', '/api/free2027/attempts/' + rId, undefined, pcb);
  ok('resuming returns the same attempt', resumed.status === 200 && resumed.body.attempt.id === rId);
  ok('with the identical questions in the identical order',
    resumed.body.questions.map(function (q) { return String(q.id); }).join(',') ===
    r1.body.questions.map(function (q) { return String(q.id); }).join(','));
  ok('and the saved answer intact', resumed.body.attempt.responses[pickQ.id] === 1,
    JSON.stringify(resumed.body.attempt.responses));
  var rPid = session().attempts.filter(function (a) { return a.id === rId; })[0].participantId;
  function attemptsHere() {
    return session().attempts.filter(function (a) {
      return a.activityId === surplus.body.activity.id && a.participantId === rPid;
    }).length;
  }
  var countBefore = attemptsHere();
  var reStart = await call('POST', '/api/free2027/activities/' + surplus.body.activity.id + '/start', {}, pcb);
  ok('starting again resumes rather than replacing the open paper',
    reStart.status === 200 && reStart.body.attempt.id === rId && reStart.body.resumed === true,
    reStart.status + ' ' + reStart.raw.slice(0, 180));
  ok('and no extra attempt record was created', attemptsHere() === countBefore,
    countBefore + ' -> ' + attemptsHere());
  ok('the resumed paper still holds the saved answer',
    reStart.body.attempt.responses[pickQ.id] === 1, JSON.stringify(reStart.body.attempt.responses));

  head('Weekly Assessments enforce the same combination');
  var wk = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Week 1', 8, {
    randomizeOptions: false, status: 'published'
  }), adm);
  ok('the weekly assessment publishes with its configured length', wk.status === 200 &&
    wk.body.activity.questionCount === 8, wk.raw.slice(0, 200));
  var w1 = await call('POST', '/api/free2027/activities/' + wk.body.activity.id + '/start', {}, stu);
  var wc1 = subjectCounts(w1.body.questions);
  ok('the weekly paper keeps its configured length', w1.status === 200 && w1.body.questions.length === 8, w1.raw.slice(0, 200));
  ok('Use of English is always included', wc1[ENGLISH] > 0, JSON.stringify(wc1));
  ok('only the candidate\'s own subjects appear', !wc1.Biology && wc1.Mathematics > 0 &&
    wc1.Physics > 0 && wc1.Chemistry > 0, JSON.stringify(wc1));
  ok('the weekly paper is grouped in canonical order too',
    subjectSequence(w1.body.questions).join('|') === 'Use of English|Mathematics|Physics|Chemistry',
    subjectSequence(w1.body.questions).join('|'));
  var w2 = await call('POST', '/api/free2027/activities/' + wk.body.activity.id + '/start', {}, pcb);
  var wc2 = subjectCounts(w2.body.questions);
  ok('the other candidate gets Biology and no Mathematics in the weekly too',
    !wc2.Mathematics && wc2.Biology > 0 && wc2[ENGLISH] > 0, JSON.stringify(wc2));
  var wsub = await call('POST', '/api/free2027/attempts/' + w1.body.attempt.id + '/submit',
    { responses: allCorrect('weekly', w1.body.questions) }, stu);
  ok('weekly marking is unchanged: raw score out of the questions served',
    wsub.status === 200 && wsub.body.result.score === 8 && wsub.body.result.maxScore === 8, wsub.raw.slice(0, 220));

  head('An older record keeps its history and chooses its combination exactly once');
  var legacy = await registerStudent('legacy@example.com', 'Legacy Student');
  ok('a record created without a combination still registers', !!legacy.token,
    JSON.stringify(legacy.error || {}).slice(0, 200));
  ok('and is flagged as needing the one-time choice', legacy.participant.needsSubjects === true &&
    Array.isArray(legacy.participant.subjects) && legacy.participant.subjects.length === 0,
    JSON.stringify(legacy.participant));
  var refused = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, legacy.token);
  ok('a candidate with no combination is never handed the whole 220-question pool',
    refused.status === 409 && /choose your jamb subject combination/i.test(refused.raw),
    refused.status + ' ' + refused.raw.slice(0, 200));
  /* A smaller competition keeps the pre-existing fallback, so an attempt made
     before the choice exists can be used to prove history is never rewritten. */
  var smallComp = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'Small Cup', 4, {
    randomizeOptions: false, status: 'published'
  }), adm);
  var lstart = await call('POST', '/api/free2027/activities/' + smallComp.body.activity.id + '/start', {}, legacy.token);
  ok('a smaller competition still serves its own allocation as before',
    lstart.status === 200 && lstart.body.questions.length === 4,
    lstart.status + ' ' + JSON.stringify(subjectCounts(lstart.body.questions || [])));
  var legacyAttempt = lstart.body.attempt.id;
  var lsub = await call('POST', '/api/free2027/attempts/' + legacyAttempt + '/submit',
    { responses: allCorrect('competition', lstart.body.questions) }, legacy.token);
  ok('that paper submits and keeps its original raw marking',
    lsub.status === 200 && lsub.body.result.score === 4, lsub.raw.slice(0, 200));
  var beforeChoice = JSON.stringify(session().attempts.filter(function (a) { return a.id === legacyAttempt; })[0]);

  var badChoice = await call('PUT', '/api/free2027/subjects', { subjects: ['Mathematics', 'Biology'] }, legacy.token);
  ok('the one-time choice rejects an invalid combination', badChoice.status === 400 &&
    /exactly 3 additional subjects/i.test(badChoice.raw), badChoice.status + ' ' + badChoice.raw.slice(0, 180));
  var choice = await call('PUT', '/api/free2027/subjects', { subjects: ['Mathematics', 'Chemistry', 'Biology'] }, legacy.token);
  ok('a valid one-time choice is saved', choice.status === 200 &&
    choice.body.participant.subjects.join('|') === 'Use of English|Mathematics|Chemistry|Biology', choice.raw.slice(0, 220));
  ok('and the prompt is satisfied', choice.body.participant.needsSubjects === false);
  var afterChoice = JSON.stringify(session().attempts.filter(function (a) { return a.id === legacyAttempt; })[0]);
  ok('choosing subjects did not alter the earlier attempt in any way', beforeChoice === afterChoice);
  var repeat = await call('PUT', '/api/free2027/subjects', { subjects: ['Physics', 'Chemistry', 'Biology'] }, legacy.token);
  ok('the choice cannot be made a second time', repeat.status === 409, repeat.status + ' ' + repeat.raw.slice(0, 160));
  var lnext = await call('POST', '/api/free2027/activities/' + compId + '/start', {}, legacy.token);
  var lc = subjectCounts(lnext.body.questions);
  ok('their NEXT paper uses the combination they chose',
    lnext.status === 200 && lc.Biology === 40 && !lc.Physics, lnext.status + ' ' + JSON.stringify(lc));
  ok('the earlier result is still readable and unchanged',
    (await call('GET', '/api/free2027/attempts/' + legacyAttempt + '/review', undefined, legacy.token)).status === 200);

  head('Readiness is checked per combination against the candidate\'s own subjects');
  var thin = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Thin Subject', 400, {
    status: 'published'
  }), adm);
  ok('an activity larger than the bank is refused at save', thin.status === 400, thin.status + ' ' + thin.raw.slice(0, 160));
  var small = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Small Weekly', 4, {
    randomizeOptions: false, status: 'published'
  }), adm);
  var sm = await call('POST', '/api/free2027/activities/' + small.body.activity.id + '/start', {}, stu);
  ok('a short weekly still serves only the candidate\'s subjects',
    sm.status === 200 && !subjectCounts(sm.body.questions).Biology, sm.status + ' ' + JSON.stringify(subjectCounts(sm.body.questions || [])));

  head('Isolation: the regular hub and its own examinations are untouched');
  var hub = await call('GET', '/api/health');
  ok('the regular hub API still answers', hub.status === 200, hub.status);
  var cfg = await call('GET', '/api/free2027/config');
  ok('the edition config still serves', cfg.status === 200, cfg.status);
  var results = await call('GET', '/api/free2027/admin/activities', undefined, adm);
  var withAttempts = (results.body.activities || []).filter(function (a) { return a.attempts > 0; });
  ok('both competition and weekly results are listed for the administrator',
    withAttempts.some(function (a) { return a.kind === 'competition'; }) &&
    withAttempts.some(function (a) { return a.kind === 'weekly'; }), JSON.stringify(withAttempts.map(function (a) { return a.kind; })));
  var detail = await call('GET', '/api/free2027/admin/attempts/' + a1, undefined, adm);
  ok('an administrator can still open a submitted paper', detail.status === 200 &&
    detail.body.attempt.id === a1, detail.status + ' ' + detail.raw.slice(0, 160));

  kill();
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  kill();
  console.log('\nHARNESS ERROR: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});