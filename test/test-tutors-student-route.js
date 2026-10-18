/* test-tutors-student-route.js — Phase 3C, student detail page, slice 2: GET /api/tutor/student, GET /api/tutor/audit and
   GET /api/audit/tutor-views on the real server over HTTP.
   node test/test-tutors-student-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_TUT_PORT) || 8179;
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
  var all = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
  function mk(name, n, subs) { return call('POST', '/api/admin/students', { name: name, email: n + '@example.com', phone: '0800000005' + n.slice(-1), goal: 'JAMB / UTME 2027', subjects: subs || all }, adm); }
  var g1 = await mk('Gina Goc', 'g1'), g2 = await mk('Bola Goc', 'g2'), g3 = await mk('Chi Goc', 'g3', ['Use of English', 'Chemistry', 'Mathematics', 'Biology']);
  var o = await call('POST', '/api/students', { name: 'Olu Open', password: 'secret123', email: 'olu@example.com', phone: '08000000059', goal: 'JAMB / UTME 2027', subjects: all });
  var ID1 = g1.body.student.id, ID2 = g2.body.student.id, ID3 = g3.body.student.id, IDO = o.body && o.body.student && o.body.student.id;
  var tok1 = (await call('POST', '/api/auth/login', { id: ID1, password: g1.body.temporaryPassword })).body.token;
  ok('setup: three GOC students and one Open student', !!ID1 && !!ID2 && !!ID3 && !!IDO);
  var tutorN = 0;
  async function newTutor(name, subjects, pw) {
    var c = await call('POST', '/api/tutors', { name: name, subjects: subjects, password: pw }, adm);
    var tid = 'GOC-T-00' + (++tutorN);
    var t = (await call('POST', '/api/tutor/login', { id: tid, password: pw })).body.token;
    await call('POST', '/api/tutor/password', { currentPassword: pw, newPassword: pw + '-own' }, t);
    return { id: tid, token: (await call('POST', '/api/tutor/login', { id: tid, password: pw + '-own' })).body.token };
  }
  var tp = await newTutor('Mrs Ada Obi', ['Physics'], 'start-pass-1');
  var tc = await newTutor('Mr Chike Eze', ['Chemistry'], 'start-pass-2');
  ok('setup: a Physics tutor and a Chemistry tutor are signed in', !!tp.token && !!tc.token);

  function rev(n, right, subj, topic) { var a = []; for (var i = 0; i < n; i++) a.push({ given: 1, isCorrect: i < right, subject: subj, topic: topic }); return a; }
  var db = readDb();
  db.practiceRuns = db.practiceRuns || {};
  db.practiceRuns[ID1] = [{ ts: Date.now() - 86400000, subject: 'Physics', review: rev(5, 1, 'Physics', 'Optics').concat(rev(5, 5, 'Physics', 'Motion')) }, { ts: Date.now(), subject: 'Chemistry', review: rev(8, 8, 'Chemistry', 'Acids') }];
  function att(id, pct, status, subj) { return { id: 'ATT-' + Math.random(), scholarId: id, subject: subj, status: status, percent: pct, score: pct / 5, maxScore: 20, section: 'objective', submittedAt: Date.now() - 3600000 }; }
  db.attempts = (db.attempts || []).concat([att(ID1, 70, 'marked', 'Physics'), att(ID1, 40, 'marked', 'Physics'), att(ID1, 12, 'marked', 'Chemistry'), att(ID2, 88, 'marked', 'Physics')]);
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db));
  var URL1 = '/api/tutor/student?subject=Physics&id=' + ID1;

  console.log('\nwho may ask');
  ok('no session is refused', (await call('GET', URL1)).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('GET', URL1, null, tok1)).status) > -1);
  ok('management is refused', (await call('GET', URL1, null, adm)).status === 403);
  ok('a tutor cannot open a student through a subject they do not teach', (await call('GET', '/api/tutor/student?subject=Chemistry&id=' + ID1, null, tp.token)).status === 403);
  ok('nor through a made-up subject', (await call('GET', '/api/tutor/student?subject=%27%20OR%201&id=' + ID1, null, tp.token)).status === 403);
  ok('nothing was logged by any refusal', (readDb().tutorAudit || []).length === 0);

  console.log('\nwho may be opened');
  var no1 = await call('GET', '/api/tutor/student?subject=Physics&id=' + IDO, null, tp.token);
  var no2 = await call('GET', '/api/tutor/student?subject=Physics&id=' + ID3, null, tp.token);
  var no3 = await call('GET', '/api/tutor/student?subject=Physics&id=GOC-S-999', null, tp.token);
  var no4 = await call('GET', '/api/tutor/student?subject=Physics&id=..%2F..%2Fx', null, tp.token);
  var no5 = await call('GET', '/api/tutor/student?subject=Physics', null, tp.token);
  ok('an Open student is a plain 404', no1.status === 404 && !/Olu|example\.com/.test(no1.raw), no1.raw);
  ok('a GOC student who never took Physics is a plain 404', no2.status === 404);
  ok('a student who does not exist gives the very same answer', no3.status === 404 && no3.raw === no1.raw && no3.raw === no2.raw, no3.raw);
  ok('a malformed or missing ID gives the same answer too', no4.status === 404 && no5.status === 404 && no4.raw === no1.raw);
  ok('none of those were logged', (readDb().tutorAudit || []).length === 0);

  console.log('\nthe page');
  var r1 = await call('GET', URL1, null, tp.token);
  var s = r1.body && r1.body.student;
  ok('opens for a Physics tutor', r1.status === 200 && s && s.id === ID1 && s.name === 'Gina Goc' && r1.body.subject === 'Physics', r1.raw);
  ok('email and phone are NOT on the page', !/example\.com|0800000005/.test(r1.raw) && s.email === undefined && s.phone === undefined, r1.raw);
  ok('Physics tests: two marked papers, average 55', s.tests.papers === 2 && s.tests.average === 55 && s.tests.lastScore !== null, JSON.stringify(s.tests));
  ok('Physics practice: 10 answers, 6 right', s.practice.answers === 10 && s.practice.correct === 6 && s.practice.percent === 60, JSON.stringify(s.practice));
  ok('weak topics are the student\'s own Physics ones, weakest first', s.weakTopics.items.length === 2 && s.weakTopics.items[0].topic === 'Optics', JSON.stringify(s.weakTopics));
  ok('recent attempts are Physics only', s.recent.length === 3 && s.recent.every(function (x) { return x.kind === 'practice' || x.kind === 'test'; }));
  ok('nothing from Chemistry reaches a Physics tutor', !/Acids|Chemistry/.test(JSON.stringify(s)) && s.practice.answers === 10);
  ok('no password hash, salt or tier leaves the server', !/hash|salt|password|"tier"/i.test(r1.raw), r1.raw);
  var CU = '/api/tutor/student/contact?subject=Physics&id=' + ID1;
  var rc = await call('GET', '/api/tutor/student?subject=Chemistry&id=' + ID1, null, tc.token);
  ok('the Chemistry tutor sees the Chemistry side only', rc.status === 200 && rc.body.student.tests.papers === 1 && rc.body.student.practice.answers === 8 && !/Optics|Motion/.test(rc.raw), rc.raw);

  console.log('\nShow contact');
  ok('no session, a student, management and a wrong subject are all refused', (await call('GET', CU)).status === 401 && [401, 403].indexOf((await call('GET', CU, null, tok1)).status) > -1 && (await call('GET', CU, null, adm)).status === 403 && (await call('GET', '/api/tutor/student/contact?subject=Chemistry&id=' + ID1, null, tp.token)).status === 403);
  var nA = (readDb().tutorAudit || []).length;
  var cn1 = await call('GET', '/api/tutor/student/contact?subject=Physics&id=' + IDO, null, tp.token);
  var cn2 = await call('GET', '/api/tutor/student/contact?subject=Physics&id=' + ID3, null, tp.token);
  ok('an Open student or one who never took the subject is the same plain 404, and nothing is logged', cn1.status === 404 && cn2.status === 404 && cn1.raw === cn2.raw && (readDb().tutorAudit || []).length === nA && !/Olu|example\.com/.test(cn1.raw));
  var c1 = await call('GET', CU, null, tp.token);
  ok('email and phone come back on request', c1.status === 200 && c1.body.contact.email === 'g1@example.com' && /^0800000005/.test(c1.body.contact.phone) && c1.body.contact.id === ID1, c1.raw);
  ok('no hash comes with them', !/hash|salt|password/i.test(c1.raw));
  var ac = readDb().tutorAudit;
  ok('showing contact is logged as its own entry, with no email or phone in it', ac.length === nA + 1 && ac[ac.length - 1].kind === 'contact-view' && ac[ac.length - 1].tutorId === tp.id && ac[ac.length - 1].studentId === ID1 && !/example\.com|0800000005/.test(JSON.stringify(ac)), JSON.stringify(ac[ac.length - 1]));
  await call('GET', CU, null, tp.token);
  ok('every tap is logged, a second one too', readDb().tutorAudit.length === nA + 2);
  var dbR = readDb(); dbR.tutorAudit = dbR.tutorAudit.slice(0, nA); dbR.settings.auditSeq = nA; fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(dbR));

  console.log('\nthe audit log');
  var a1 = readDb().tutorAudit || [];
  ok('each successful open is logged: who, which student, which subject, when', a1.length === 2 && a1[0].tutorId === tp.id && a1[0].studentId === ID1 && a1[0].subject === 'Physics' && a1[0].tutorName === 'Mrs Ada Obi' && a1[0].studentName === 'Gina Goc' && a1[0].at > 0, JSON.stringify(a1));
  await call('GET', URL1, null, tp.token);
  await call('GET', URL1, null, tp.token);
  var a2 = readDb().tutorAudit;
  ok('every open counts, opening the same page again too', a2.length === 4 && a2.filter(function (x) { return x.tutorId === tp.id; }).length === 3);
  ok('entries have their own distinct ids', new Set(a2.map(function (x) { return x.id; })).size === 4);
  ok('the log holds no email, phone or hash', !/example\.com|0800000005|hash/i.test(JSON.stringify(a2)));
  var mine = await call('GET', '/api/tutor/audit', null, tp.token);
  ok('a tutor reads their own entries, newest first', mine.status === 200 && mine.body.count === 3 && mine.body.keptDays === 365 && mine.body.entries.every(function (x) { return x.tutorId === tp.id; }) && mine.body.entries[0].at >= mine.body.entries[2].at, mine.raw);
  var theirs = await call('GET', '/api/tutor/audit', null, tc.token);
  ok('another tutor sees only theirs, never the Physics tutor\'s', theirs.body.count === 1 && theirs.body.entries[0].tutorId === tc.id && theirs.body.entries[0].subject === 'Chemistry');
  ok('a tutor cannot ask for someone else\'s entries', (await call('GET', '/api/tutor/audit?tutorId=' + tc.id, null, tp.token)).body.count === 3);
  ok('students and management are refused on the tutor\'s own log', [401, 403].indexOf((await call('GET', '/api/tutor/audit', null, tok1)).status) > -1 && (await call('GET', '/api/tutor/audit', null, adm)).status === 403);
  var adminAll = await call('GET', '/api/audit/tutor-views', null, adm);
  ok('management reads every entry', adminAll.status === 200 && adminAll.body.count === 4 && adminAll.body.keptDays === 365, adminAll.raw);
  ok('management can narrow by tutor and by student', (await call('GET', '/api/audit/tutor-views?tutorId=' + tc.id, null, adm)).body.count === 1 && (await call('GET', '/api/audit/tutor-views?studentId=' + ID1, null, adm)).body.count === 4 && (await call('GET', '/api/audit/tutor-views?studentId=' + ID2, null, adm)).body.count === 0);
  var kOpen = await call('GET', '/api/audit/tutor-views?kind=tutor-view', null, adm), kCon = await call('GET', '/api/audit/tutor-views?kind=contact-view', null, adm);
  ok('management can narrow by action: the two kinds add up to the whole log', kOpen.status === 200 && kCon.status === 200 && kOpen.body.count + kCon.body.count === 4 && kOpen.body.entries.every(function (x) { return x.kind === 'tutor-view'; }) && kCon.body.entries.every(function (x) { return x.kind === 'contact-view'; }), kOpen.raw);
  ok('an unknown action is ignored, not an error', (await call('GET', '/api/audit/tutor-views?kind=bogus', null, adm)).body.count === 4);
  var todayStr = core.lagosDay(Date.now());
  ok('management can narrow by date: today holds all four, a range in the past none', (await call('GET', '/api/audit/tutor-views?from=' + todayStr + '&to=' + todayStr, null, adm)).body.count === 4 && (await call('GET', '/api/audit/tutor-views?from=2020-01-01&to=2020-12-31', null, adm)).body.count === 0);
  ok('filters combine (tutor + action + date)', (await call('GET', '/api/audit/tutor-views?tutorId=' + tc.id + '&kind=tutor-view&from=' + todayStr, null, adm)).body.count === 1);
  ok('a tutor still cannot use the date or action filters on management\'s log', [401, 403].indexOf((await call('GET', '/api/audit/tutor-views?kind=tutor-view&from=' + todayStr, null, tp.token)).status) > -1);
  ok('a tutor and a student are refused on management\'s log', [401, 403].indexOf((await call('GET', '/api/audit/tutor-views', null, tp.token)).status) > -1 && [401, 403].indexOf((await call('GET', '/api/audit/tutor-views', null, tok1)).status) > -1);

  console.log('\none year only');
  var db2 = readDb();
  db2.tutorAudit = db2.tutorAudit.concat([{ id: 'AU-old', kind: 'tutor-view', tutorId: tp.id, tutorName: 'Mrs Ada Obi', studentId: ID1, studentName: 'Gina Goc', subject: 'Physics', at: Date.now() - 400 * 86400000 }]);
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db2));
  await call('GET', URL1, null, tp.token);
  var a3 = readDb().tutorAudit;
  ok('an entry over a year old is dropped at the next open; newer ones stay', !a3.some(function (x) { return x.id === 'AU-old'; }) && a3.length === 5, a3.length);

  console.log('\na student switched off since');
  var off = await call('PUT', '/api/students/' + ID2 + '/active', { active: false }, adm);
  var r2 = await call('GET', '/api/tutor/student?subject=Physics&id=' + ID2, null, tp.token);
  ok('the page still opens, and says the account is off', off.status === 200 && r2.status === 200 && r2.body.student.active === false && r2.body.student.tests.papers === 1, r2.raw);
  ok('and that open is logged too', readDb().tutorAudit.filter(function (x) { return x.studentId === ID2; }).length === 1);

  console.log('\na switched-off tutor');
  await call('PUT', '/api/tutors/' + tp.id + '/active', { active: false }, adm);
  var n0 = readDb().tutorAudit.length;
  var rOff = await call('GET', URL1, null, tp.token);
  ok('is refused at once and nothing is logged', (rOff.status === 401 || rOff.status === 403) && readDb().tutorAudit.length === n0, rOff.raw);

  console.log('\nwiring');
  var srv = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
  ok('the route uses the scope guard, the core rules and writes the log before answering', /api\\\/tutor\\\/student/.test(srv) && /core\.tutorMayOpenStudent\(subject/.test(srv) && /core\.tutorStudentDetail\(subject/.test(srv) && srv.indexOf('writeData(db); } catch (e) { console.error(\'[goc] Audit log not written') > -1);
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  stop(); process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-800)); stop(); process.exit(1); });
