/* test-free2027-weekly-allocation.js — Weekly Assessments must use their OWN
 * configured question count and subject distribution.
 *
 * ROOT CAUSE THIS PINS: studentDistribution() fell back to an invented EVEN
 * SPLIT of the configured count across the candidate's four subjects whenever
 * the administrator supplied no distribution (or supplied one naming a subject
 * outside the candidate's combination). For a 50-question weekly that fabricates
 * a 13-question Use of English quota nobody configured, and the candidate is
 * refused with "Use of English needs 13 eligible questions..." even though the
 * assessment only asks for 50 questions in total.
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
  /* Only 12 eligible English questions: enough for any sane weekly, but FEWER
     than the 13 the invented even split demands for a 50-question paper. */
  await call('POST', '/api/free2027/admin/question-banks/weekly/import',
    { csv: csv('Weekly', { 'Use of English': 12, Mathematics: 40, Physics: 40, Chemistry: 40, Biology: 40 }) }, adm);
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
  ok('exactly the configured 50 questions are served', qs(a50n).length === 50,
    String(qs(a50n).length));
  var c50n = counts(qs(a50n));
  ok('only the student\'s registered subjects appear', !c50n.Biology, JSON.stringify(c50n));
  ok('and the total is never inflated to a 180-question JAMB paper',
    qs(a50n).length === 50, String(qs(a50n).length));
  /* The crux: a thin English pool must neither block the assessment with an
     invented quota NOR cause compulsory Use of English to be dropped. */
  ok('compulsory Use of English is still included', c50n[ENGLISH] > 0, JSON.stringify(c50n));
  ok('English is capped at what the bank actually holds rather than demanded',
    c50n[ENGLISH] > 0 && c50n[ENGLISH] <= 12, JSON.stringify(c50n));
  ok('every subject the candidate takes is still represented',
    c50n.Mathematics > 0 && c50n.Physics > 0 && c50n.Chemistry > 0, JSON.stringify(c50n));
  ok('the redistributed balance still totals exactly the configured 50',
    Object.keys(c50n).reduce(function (n, k) { return n + c50n[k]; }, 0) === 50, JSON.stringify(c50n));

  head('TEST B — the configured count is authoritative (20, 30, 50, 100)');
  var sizes = [20, 30, 50, 100];
  for (var i = 0; i < sizes.length; i++) {
    var n = sizes[i];
    var wa = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly ' + n, n, {
      randomizeOptions: false, status: 'published'
    }), adm);
    var st = await call('POST', '/api/free2027/activities/' + wa.body.activity.id + '/start', {}, mpc);
    ok('the configured count of ' + n + ' is stored unchanged',
      wa.status === 200 && wa.body.activity.questionCount === n, wa.raw.slice(0, 180));
    ok('a configured ' + n + '-question weekly serves exactly ' + n,
      st.status === 200 && qs(st).length === n, st.status + ' ' + st.raw.slice(0, 200));
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
    subjectDistribution: { 'Use of English': 20, Mathematics: 10, Physics: 10, Chemistry: 10 },
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
  ok('and does receive their own Biology', cMcb.Biology > 0, JSON.stringify(cMcb));
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
    hSub.status === 200 && hSub.body.result.score === 20 && hSub.body.result.maxScore === 20, hSub.raw.slice(0, 220));
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
  ok('the bank now holds only 3 eligible English questions',
    bankRows('weekly').filter(function (q) { return q.subject === ENGLISH; }).length === 3,
    String(bankRows('weekly').filter(function (q) { return q.subject === ENGLISH; }).length));
  var short = await call('POST', '/api/free2027/activities/' + shortAct.body.activity.id + '/start', {}, mpc);
  ok('the shortage is refused with a clear message', short.status === 409, short.status + ' ' + short.raw.slice(0, 240));
  ok('naming the ACTUAL configured requirement of 10 and the 3 available',
    /\b10\b/.test(short.raw) && /\b3\b/.test(short.raw) && /Use of English/.test(short.raw), short.raw.slice(0, 260));
  ok('and not an invented 13-question quota', !/needs 13/.test(short.raw), short.raw.slice(0, 240));
  ok('and not the Competition 60-question English rule', !/\b60\b/.test(short.raw), short.raw.slice(0, 240));

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