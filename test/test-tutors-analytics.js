/* test-tutors-analytics.js — Phase 3C slice 5, parts 2 and 3: GET /api/tutor/analytics and the counters
   kept as answers are marked, on the real server over HTTP.
   node test/test-tutors-analytics.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var activeStudent = require('./active-student.js');
var PORT = Number(process.env.GOC_TUT_PORT) || 8172;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tut-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' }), stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', function (c) { serverLog += c; }); child.stderr.on('data', function (c) { serverLog += c; });
function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body), headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j, headers: res.headers }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null, headers: {} }); });
    if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(n) {
  return call('GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (n <= 0) throw new Error('server did not start\n' + serverLog);
    return new Promise(function (x) { setTimeout(x, 100); }).then(function () { return waitForBoot(n - 1); });
  });
}


function flat(r) { return r.raw || ''; }
function sitPractice(token, subject, count, wrong) {
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: subject, count: count }, token).then(function (h) {
    var responses = {};
    ((h.body && h.body.questions) || []).forEach(function (q) {
      responses[q.id] = wrong ? (Number(q.answer) + 1) % Math.max(2, (q.options || []).length || 4) : q.answer;
    });
    return call('POST', '/api/me/study/submit', { paperId: h.body.paperId, responses: responses }, token).then(function (sub) {
      /* the app saves each finished run straight after the submit (savePracResult); do the same */
      var b = sub.body || {};
      var rec = { mode: 'practice', subject: subject, total: b.total, answered: b.answered, correct: b.correct, wrong: b.wrong, percent: b.percent, ts: Date.now(),
        review: (b.review || []).map(function (q) { return { n: q.n, topic: q.topic, text: q.text, options: q.options, answer: q.answer, given: q.given, isCorrect: q.isCorrect, explanation: q.explanation }; }) };
      return call('POST', '/api/me/practice', rec, token).then(function () { return sub; });
    });
  });
}
function readDb() { return JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8')); }
function total(stats, subject, which) {
  var b = (stats && stats[subject] && stats[subject][which]) || {}, n = 0, c = 0;
  Object.keys(b).forEach(function (k) { n += b[k].n; c += b[k].c; });
  return { n: n, c: c };
}
(async function () {
  await waitForBoot(100);
  var login = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = login.body && login.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var subs = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];

  /* a GOC student (console-made) and an Open student (public sign-up) */
  var g = await call('POST', '/api/admin/students', { name: 'Gina Goc', email: 'gina@example.com', phone: '08000000031', goal: 'JAMB / UTME 2027', subjects: subs }, adm);
  var gTok = (await call('POST', '/api/auth/login', { id: g.body.student.id, password: g.body.temporaryPassword })).body.token;
  var o = await activeStudent(call, { name: 'Olu Open', password: 'secret123', email: 'olu@example.com', phone: '08000000032', goal: 'JAMB / UTME 2027', subjects: subs }, adm);
  var oTok = o.token;
  ok('setup: one GOC student and one Open student', g.body.student.tier === 'goc' && !!oTok);

  var ten = await call('POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Physics'], password: 'start-pass-1' }, adm);
  var tk = (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' })).body.token;
  await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'my-own-pass-1' }, tk);
  tk = (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'my-own-pass-1' })).body.token;
  ok('setup: a Physics tutor is signed in', !!tk);

  console.log('\nwho may ask');
  ok('no session is refused', (await call('GET', '/api/tutor/analytics')).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('GET', '/api/tutor/analytics', null, gTok)).status) > -1);
  ok('management is refused (a manager is not a tutor)', (await call('GET', '/api/tutor/analytics', null, adm)).status === 403);
  ok('a tutor cannot read a subject they do not teach', (await call('GET', '/api/tutor/analytics?subject=Chemistry', null, tk)).status === 403);
  ok('nor a made-up one', (await call('GET', '/api/tutor/analytics?subject=%27%20OR%201', null, tk)).status === 403);

  console.log('\nbefore anyone has practised');
  var a0 = await call('GET', '/api/tutor/analytics', null, tk);
  ok('the tutor\'s first subject is the default', a0.status === 200 && a0.body.subject === 'Physics', flat(a0));
  ok('the snapshot counts the GOC student, and the Open one only as a count', a0.body.snapshot.gocStudents === 1 && a0.body.snapshot.openStudents === 1, flat(a0));
  ok('nobody is active and there is no average yet', a0.body.snapshot.active === 0 && a0.body.snapshot.practice.average === null && a0.body.snapshot.tests.average === null);
  ok('no weak topics or hard questions yet', a0.body.weakTopics.items.length === 0 && a0.body.hardestQuestions.items.length === 0);

  console.log('\ncounters are kept as answers are marked');
  var s1 = await sitPractice(gTok, 'Physics', 10, true);
  ok('the GOC student sits a Physics practice run, all wrong', s1.status === 200 && s1.body.answered > 0 && s1.body.correct === 0, flat(s1).slice(0, 200));
  var db1 = readDb(), answered = s1.body.answered;
  ok('the counters hold exactly those answers, none right', total(db1.answerStats, 'Physics', 'q').n === answered && total(db1.answerStats, 'Physics', 'q').c === 0, JSON.stringify(db1.answerStats).slice(0, 200));
  ok('per-topic and per-question totals agree', total(db1.answerStats, 'Physics', 't').n === answered);
  var s2 = await sitPractice(oTok, 'Physics', 10, true);
  ok('an Open student\'s answers are not counted', s2.status === 200 && total(readDb().answerStats, 'Physics', 'q').n === answered);
  ok('the stored counters hold no student ID, name or time', !/GOC-S-|Gina|Olu/.test(JSON.stringify(readDb().answerStats)));
  var s3 = await sitPractice(gTok, 'Physics', 10, false);
  var db3 = readDb();
  ok('a second run adds to the same counters', total(db3.answerStats, 'Physics', 'q').n === answered + s3.body.answered && total(db3.answerStats, 'Physics', 'q').c === s3.body.correct);
  var s4 = await sitPractice(gTok, 'Chemistry', 5, true);
  ok('another subject is kept apart', total(readDb().answerStats, 'Chemistry', 'q').n === s4.body.answered && total(readDb().answerStats, 'Physics', 'q').n === answered + s3.body.answered);

  console.log('\nthe route');
  var a1 = await call('GET', '/api/tutor/analytics?subject=Physics', null, tk);
  var sn = a1.body.snapshot;
  ok('the GOC student is active and the Open student is not counted as active', a1.status === 200 && sn.active === 1 && sn.gocStudents === 1 && sn.openStudents === 1, flat(a1).slice(0, 300));
  ok('answers kept on the server\'s own side count only after the app saves the run (the route reads stored runs)', typeof sn.practice.answers === 'number');
  ok('the reply holds no student ID, name, email or phone', !/GOC-S-|Gina|Olu|gina@|olu@|0800000/.test(flat(a1)), flat(a1).slice(0, 200));
  ok('Chemistry answers never appear in the Physics reply', !/Chemistry/.test(JSON.stringify(a1.body.weakTopics) + JSON.stringify(a1.body.hardestQuestions)));
  ok('with under 10 answers on every topic and question, nothing is ranked yet', a1.body.weakTopics.items.every(function (x) { return x.answers >= 10; }) && a1.body.hardestQuestions.items.every(function (x) { return x.answers >= 10; }));
  ok('and the screen is told how many were held back', a1.body.weakTopics.minAnswers === 10 && a1.body.hardestQuestions.minAnswers === 10);

  /* push the counters over the floor: plant answers the way a busy class would */
  var db = readDb();
  var bank = db.questions.filter(function (q) { return q.subject === 'Physics' && q.kind === 'objective'; });
  var q0 = bank[0], q1 = bank[1];
  db.answerStats.Physics.q[q0.id] = { n: 40, c: 4 };
  db.answerStats.Physics.q[q1.id] = { n: 12, c: 9 };
  db.answerStats.Physics.q.NOT_A_REAL_ID = { n: 99, c: 0 };
  db.answerStats.Physics.t[q0.topic] = { n: 40, c: 4 };
  db.answerStats.Physics.t.Tiny = { n: 3, c: 0 };
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db));
  await new Promise(function (r) { setTimeout(r, 50); });
  var a2 = await call('GET', '/api/tutor/analytics', null, tk);
  ok('a question and a topic with 10+ answers are now ranked, weakest first', a2.status === 200 && a2.body.hardestQuestions.items[0].id === String(q0.id) && a2.body.hardestQuestions.items[0].percent === 10 && a2.body.weakTopics.items[0].topic === q0.topic, flat(a2).slice(0, 400));
  ok('the question text is sent so the tutor can see what it is', a2.body.hardestQuestions.items[0].text === q0.text);
  ok('a counter for a question that is not in the bank is dropped', a2.body.hardestQuestions.items.every(function (x) { return x.id !== 'NOT_A_REAL_ID'; }));
  ok('a topic under 10 answers is counted as held back, not ranked', a2.body.weakTopics.items.every(function (x) { return x.topic !== 'Tiny'; }) && a2.body.weakTopics.hidden >= 1);
  ok('the correct answer index never leaves in the question list', !/"answer"/.test(JSON.stringify(a2.body.hardestQuestions)));


  console.log('\na Web Test counts too');
  function allAnswers() { var st = readDb().answerStats, n = 0; Object.keys(st).forEach(function (sj) { n += total(st, sj, 'q').n; }); return n; }
  var before = allAnswers();
  var ws = await call('POST', '/api/me/tests/start', { section: 'objective', subject: 'Physics' }, gTok);
  if (ws.status === 200 && ws.body && ws.body.attemptId) {
    var resp = {}; (ws.body.questions || []).forEach(function (q) { resp[q.id] = 0; });
    var wsub = await call('POST', '/api/me/tests/submit', { attemptId: ws.body.attemptId, responses: resp }, gTok);
    var after = allAnswers();
    ok('a submitted objective paper adds its answered questions to the counters (each under its own subject)', wsub.status === 200 && after - before === Object.keys(resp).length, before + ' -> ' + after + ' ' + wsub.status);
    var ow = await call('POST', '/api/me/tests/start', { section: 'objective', subject: 'Physics' }, oTok);
    ok('an Open student cannot sit it, so adds nothing', ow.status === 403 && allAnswers() === after);
  } else {
    console.log('  skip  Web Test counting: could not open an objective paper here (' + ws.status + ' ' + flat(ws).slice(0, 120) + ')');
  }

  console.log('\nthe tutor is switched off');
  await call('PUT', '/api/tutors/GOC-T-001/active', { active: false }, adm);
  var offR = await call('GET', '/api/tutor/analytics', null, tk);
  ok('the next analytics call is refused', offR.status === 401 || offR.status === 403, offR.status);

  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  stop();
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-600)); stop(); process.exit(1); });
