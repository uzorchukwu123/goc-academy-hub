/* test-tutors-top-route.js — Phase 3C, tutor top performers, slice 2: GET /api/tutor/top on the real
   server over HTTP.
   node test/test-tutors-top-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_TUT_PORT) || 8178;
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
  function mk(name, n) { return call('POST', '/api/admin/students', { name: name, email: n + '@example.com', phone: '0800000005' + n.slice(-1), goal: 'JAMB / UTME 2027', subjects: subs }, adm); }
  var g1 = await mk('Gina Goc', 'g1'), g2 = await mk('Bola Goc', 'g2'), g3 = await mk('Chi Goc', 'g3');
  var o = await call('POST', '/api/students', { name: 'Olu Open', password: 'secret123', email: 'olu@example.com', phone: '08000000059', goal: 'JAMB / UTME 2027', subjects: subs });
  var ID1 = g1.body.student.id, ID2 = g2.body.student.id, ID3 = g3.body.student.id, IDO = o.body && o.body.student && o.body.student.id;
  var tok1 = (await call('POST', '/api/auth/login', { id: ID1, password: g1.body.temporaryPassword })).body.token;
  ok('setup: three GOC students and one Open student', !!ID1 && !!ID2 && !!ID3 && !!IDO);
  await call('POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Physics'], password: 'start-pass-1' }, adm);
  var tk = (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' })).body.token;
  await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'my-own-pass-1' }, tk);
  tk = (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'my-own-pass-1' })).body.token;
  ok('setup: a Physics tutor is signed in', !!tk);

  console.log('\nwho may ask');
  ok('no session is refused', (await call('GET', '/api/tutor/top')).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('GET', '/api/tutor/top', null, tok1)).status) > -1);
  ok('management is refused', (await call('GET', '/api/tutor/top', null, adm)).status === 403);
  ok('a tutor cannot read a subject they do not teach', (await call('GET', '/api/tutor/top?subject=Chemistry', null, tk)).status === 403);
  ok('nor a made-up one', (await call('GET', '/api/tutor/top?subject=%27%20OR%201', null, tk)).status === 403);

  console.log('\nnothing to rank on day one');
  var r0 = await call('GET', '/api/tutor/top', null, tk);
  ok('own first subject by default, both lists empty, the floors are shown',
    r0.status === 200 && r0.body.subject === 'Physics' && r0.body.tests.items.length === 0 && r0.body.practice.items.length === 0 && r0.body.tests.minPapers === 2 && r0.body.practice.minAnswers === 20, r0.raw);

  console.log('\nwith some work on file');
  function rev(n, right, subj) { var a = []; for (var i = 0; i < n; i++) a.push({ given: 1, isCorrect: i < right, subject: subj }); return a; }
  var db = readDb();
  db.practiceRuns = db.practiceRuns || {};
  db.practiceRuns[ID1] = [{ ts: Date.now(), subject: 'Physics', review: rev(20, 18, 'Physics') }];   /* 90% */
  db.practiceRuns[ID2] = [{ ts: Date.now(), subject: 'Physics', review: rev(20, 12, 'Physics') }];   /* 60% */
  db.practiceRuns[ID3] = [{ ts: Date.now(), subject: 'Physics', review: rev(19, 19, 'Physics') }];   /* 19 answers: held back */
  db.practiceRuns[IDO] = [{ ts: Date.now(), subject: 'Physics', review: rev(30, 30, 'Physics') }];   /* Open: never counted */
  function att(id, pct, status, subj) { return { id: 'ATT-' + Math.random(), scholarId: id, subject: subj || 'Physics', status: status || 'marked', percent: pct, submittedAt: Date.now() }; }
  db.attempts = (db.attempts || []).concat([att(ID1, 70), att(ID1, 80), att(ID2, 95), att(ID2, 85), att(ID3, 99), att(IDO, 100), att(IDO, 100), att(ID1, 10, 'marked', 'Chemistry'), att(ID2, 10, 'awaiting-marking')]);
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db));
  var r1 = await call('GET', '/api/tutor/top?subject=Physics', null, tk);
  var tI = r1.body.tests.items, pI = r1.body.practice.items;
  ok('Web Tests: Bola (90 over two papers) is ahead of Gina (75)', r1.status === 200 && tI.length === 2 && tI[0].id === ID2 && tI[0].average === 90 && tI[1].id === ID1 && tI[1].average === 75, r1.raw);
  ok('one marked paper is held back, not ranked', r1.body.tests.hidden === 1 && !tI.some(function (x) { return x.id === ID3; }));
  ok('Practice: Gina (90%) is ahead of Bola (60%), with answers and correct counts', pI.length === 2 && pI[0].id === ID1 && pI[0].percent === 90 && pI[0].answers === 20 && pI[0].correct === 18 && pI[1].id === ID2, r1.raw);
  ok('19 answers is held back', r1.body.practice.hidden === 1 && !pI.some(function (x) { return x.id === ID3; }));
  ok('each row carries the name and the Scholar ID', tI[0].name === 'Bola Goc' && pI[0].name === 'Gina Goc');
  ok('the Open student never appears, whatever their score', !/Olu/.test(r1.raw) && r1.raw.indexOf(IDO) < 0);
  ok('a paper in another subject or still awaiting marking changes nothing', tI[1].papers === 2 && tI[0].papers === 2);
  ok('no email, phone or password hash leaves the server', !/example\.com|0800000005|hash|password|salt/i.test(r1.raw), r1.raw);

  console.log('\nthe other subject, and a switched-off tutor');
  var rc = await call('GET', '/api/tutor/top?subject=Chemistry', null, tk);
  ok('Chemistry stays closed to a Physics tutor', rc.status === 403);
  await call('PUT', '/api/tutors/GOC-T-001/active', { active: false }, adm);
  var off = await call('GET', '/api/tutor/top', null, tk);
  ok('a switched-off tutor is refused at once', off.status === 401 || off.status === 403, off.raw);

  console.log('\nwiring');
  var srv = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
  ok('the route uses the scope guard and the core rule', /api\\\/tutor\\\/top/.test(srv) && /core\.tutorTopPerformers\(subject/.test(srv));
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  stop(); process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-800)); stop(); process.exit(1); });
