/* test-tutors-atrisk-route.js — Phase 3C, tutor at-risk list, slice 2: GET /api/tutor/atrisk on the real
   server over HTTP.
   node test/test-tutors-atrisk-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var activeStudent = require('./active-student.js');
var PORT = Number(process.env.GOC_TUT_PORT) || 8176;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tut-atrisk-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
/* A server left over from an earlier run of THIS test (same sandbox prefix) can still hold the port.
   Stop only those, then give the port a moment to free up. pkill is missing on Windows; the try/catch
   makes this a no-op there. */
try {
  require('child_process').spawnSync('pkill', ['-f', 'goc-tut-atrisk-test-.*server\\.js'], { stdio: 'ignore' });
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
} catch (e) {}
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
  var DAY = 86400000;
  var login = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = login.body && login.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var subs = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
  function mk(name, n) { return call('POST', '/api/admin/students', { name: name, email: n + '@example.com', phone: '0800000004' + n.slice(-1), goal: 'JAMB / UTME 2027', subjects: subs }, adm); }
  var g1 = await mk('Gina Goc', 'g1'), g2 = await mk('Bola Goc', 'g2');
  var o = await activeStudent(call, { name: 'Olu Open', password: 'secret123', email: 'olu@example.com', phone: '08000000049', goal: 'JAMB / UTME 2027', subjects: subs }, adm);
  var ID1 = g1.body.student.id, ID2 = g2.body.student.id, IDO = o.id;
  var tok1 = (await call('POST', '/api/auth/login', { id: ID1, password: g1.body.temporaryPassword })).body.token;
  ok('setup: two GOC students and one Open student', !!ID1 && !!ID2 && g1.body.student.tier === 'goc' && !!o.token);
  await call('POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Physics'], password: 'start-pass-1' }, adm);
  var tk = (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' })).body.token;
  await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'my-own-pass-1' }, tk);
  tk = (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'my-own-pass-1' })).body.token;
  ok('setup: a Physics tutor is signed in', !!tk);

  console.log('\nwho may ask');
  ok('no session is refused', (await call('GET', '/api/tutor/atrisk')).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('GET', '/api/tutor/atrisk', null, tok1)).status) > -1);
  ok('management is refused', (await call('GET', '/api/tutor/atrisk', null, adm)).status === 403);
  ok('a tutor cannot read a subject they do not teach', (await call('GET', '/api/tutor/atrisk?subject=Chemistry', null, tk)).status === 403);
  ok('nor a made-up one', (await call('GET', '/api/tutor/atrisk?subject=%27%20OR%201', null, tk)).status === 403);

  console.log('\nnobody is at risk on day one');
  var r0 = await call('GET', '/api/tutor/atrisk', null, tk);
  ok('the tutor\'s first subject is the default, the list is empty, the limits are shown',
    r0.status === 200 && r0.body.subject === 'Physics' && r0.body.count === 0 && r0.body.students.length === 0 && r0.body.sort === 'inactive' && r0.body.limits.inactiveDays === 7 && r0.body.limits.lowAverage === 40, r0.raw);

  console.log('\nstudents who joined 8 days ago and did nothing');
  var db = readDb();
  db.students.forEach(function (s) { if (s.id === ID1 || s.id === ID2 || s.id === IDO) s.createdAt = new Date(Date.now() - 8 * DAY).toISOString(); });
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db));
  var r1 = await call('GET', '/api/tutor/atrisk', null, tk);
  var ids1 = (r1.body.students || []).map(function (x) { return x.id; });
  ok('both GOC students are listed as never started, the Open student is not',
    r1.status === 200 && r1.body.count === 2 && ids1.indexOf(ID1) > -1 && ids1.indexOf(ID2) > -1 && ids1.indexOf(IDO) < 0 && r1.body.students.every(function (x) { return x.never === true && x.reasons.join() === 'never-started'; }), r1.raw);
  ok('no email, phone or password hash leaves the server', !/example\.com|0800000004|hash|password|salt/i.test(r1.raw), r1.raw);

  console.log('\npractice takes a student off the list');
  var sp = await sitPractice(tok1, 'Physics', 10, false);
  var r2 = await call('GET', '/api/tutor/atrisk', null, tk);
  ok('after a Physics run the student is gone, the other stays', sp.status === 200 && r2.body.count === 1 && r2.body.students[0].id === ID2, r2.raw);
  var sc = await sitPractice(tok1, 'Chemistry', 5, false);
  var db2 = readDb();
  db2.practiceRuns[ID1].forEach(function (run) { run.ts = Date.now() - 9 * DAY; });
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db2));
  var r3 = await call('GET', '/api/tutor/atrisk', null, tk);
  var row1 = (r3.body.students || []).filter(function (x) { return x.id === ID1; })[0];
  ok('old practice (9 days) puts the student back, inactive for 9 days', sc.status === 200 && !!row1 && row1.daysInactive === 9 && row1.reasons.join() === 'inactive', r3.raw);

  console.log('\nlow Web Test average and the two orders');
  var db3 = readDb();
  db3.attempts = (db3.attempts || []).concat([{ id: 'ATT-T1', scholarId: ID1, subject: 'Physics', status: 'marked', percent: 30, submittedAt: Date.now() - 9 * DAY }]);
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db3));
  var byDays = await call('GET', '/api/tutor/atrisk?sort=inactive', null, tk);
  var byScore = await call('GET', '/api/tutor/atrisk?sort=score', null, tk);
  var rowS = (byDays.body.students || []).filter(function (x) { return x.id === ID1; })[0];
  ok('a 30% marked paper adds the low-average reason, with last score and average', !!rowS && rowS.reasons.join() === 'inactive,low-average' && rowS.average === 30 && rowS.lastScore === 30 && rowS.papers === 1, byDays.raw);
  ok('inactive order: never started (Bola) before 9 days (Gina)', byDays.body.students[0].id === ID2 && byDays.body.students[1].id === ID1, byDays.raw);
  ok('score order: lowest average first (Gina has 30, Bola has none)', byScore.body.sort === 'score' && byScore.body.students[0].id === ID1 && byScore.body.students[1].id === ID2, byScore.raw);
  var junk = await call('GET', '/api/tutor/atrisk?sort=%27%3Cscript%3E', null, tk);
  ok('an unknown sort reads as inactive and is reported as such', junk.status === 200 && junk.body.sort === 'inactive' && junk.body.students[0].id === ID2, junk.raw);
  var chem = await call('GET', '/api/tutor/atrisk?subject=Physics', null, tk);
  ok('a paper in another subject never counts here', chem.status === 200 && chem.body.students.length === 2);

  console.log('\nwiring');
  var srv = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
  ok('the route uses the scope guard and the two core rules', /api\\\/tutor\\\/atrisk/.test(srv) && /core\.sortAtRisk\(core\.tutorAtRisk\(subject/.test(srv));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  stop(); process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-800)); stop(); process.exit(1); });
