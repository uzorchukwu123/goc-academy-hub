/* test-tutor-marking.js — Phase 3C slice 6.6: a tutor marks theory scripts in their own subjects with no approval,
   and the admin gets an alert only when a script is fully marked,
   on the real server over HTTP.
   node test/test-tutor-marking.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_TMARK_PORT) || 8178;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tmark-test-'));
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



function readDb() { return JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8')); }
(async function () {
  await waitForBoot(100);
  var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var subs = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
  var g = await call('POST', '/api/admin/students', { name: 'Gina Goc', email: 'gina@example.com', phone: '08000000031', goal: 'JAMB / UTME 2027', subjects: subs }, adm);
  var gTok = (await call('POST', '/api/auth/login', { id: g.body.student.id, password: g.body.temporaryPassword })).body.token;
  async function tutorToken(name, subjects, pw) {
    var t = await call('POST', '/api/tutors', { name: name, subjects: subjects, password: 'start-pass-1' }, adm);
    var id = t.body.tutor.id;
    var tk = (await call('POST', '/api/tutor/login', { id: id, password: 'start-pass-1' })).body.token;
    await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: pw }, tk);
    return { id: id, token: (await call('POST', '/api/tutor/login', { id: id, password: pw })).body.token };
  }
  var chem = await tutorToken('Mrs Ada Obi', ['Chemistry'], 'my-own-pass-1');
  var phys = await tutorToken('Mr Eze', ['Physics'], 'my-own-pass-2');

  /* two theory questions each in Chemistry and Physics, then the student sits both papers */
  async function theoryQ(subject, topic, text) {
    return call('POST', '/api/questions', { subject: subject, section: 'theory', topic: topic, text: text, expected: 'The reference answer for ' + text, maxMark: 10 }, adm);
  }
  await theoryQ('Chemistry', 'Acids', 'ZQXCHEM Explain neutralisation.');
  await theoryQ('Chemistry', 'Acids', 'ZQXCHEM Define a strong acid.');
  await theoryQ('Physics', 'Waves', 'ZQXPHYS Define wavelength.');
  await theoryQ('Physics', 'Waves', 'ZQXPHYS State the law of reflection.');
  async function sit(subject) {
    var th = await call('POST', '/api/me/tests/start', { period: 'weekly', section: 'theory', subject: subject }, gTok);
    var resp = {};
    (th.body.questions || []).forEach(function (q) { resp[q.id] = 'ZQXANSWER written for ' + subject; });
    var sub = await call('POST', '/api/me/tests/submit', { attemptId: th.body.attemptId, responses: resp }, gTok);
    return { id: sub.body.id, status: sub.body.status, start: th.status };
  }
  var cScript = await sit('Chemistry');
  var pScript = await sit('Physics');
  ok('both theory papers were sat and wait for a marker', cScript.status === 'awaiting-marking' && pScript.status === 'awaiting-marking' && !!cScript.id && !!pScript.id, JSON.stringify([cScript, pScript]));

  console.log('\nwho may use the tutor marking routes');
  ok('no session is refused', (await call('GET', '/api/tutor/scripts')).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('GET', '/api/tutor/scripts', null, gTok)).status) > -1);
  ok('management is refused (not a tutor)', (await call('GET', '/api/tutor/scripts', null, adm)).status === 403);
  ok('a tutor cannot reach the console alert list', [401, 403].indexOf((await call('GET', '/api/alerts', null, chem.token)).status) > -1);
  ok('nor mark through the console route', [401, 403].indexOf((await call('POST', '/api/results/' + cScript.id + '/mark', { marks: {} }, chem.token)).status) > -1);

  console.log('\nthe list is the tutor\'s own subject');
  var list = await call('GET', '/api/tutor/scripts?subject=Chemistry', null, chem.token);
  ok('a Chemistry tutor sees the Chemistry script', list.status === 200 && list.body.scripts.length === 1 && String(list.body.scripts[0].id) === String(cScript.id) && list.body.counts.waiting === 1, list.raw);
  ok('with no sign of the Physics script', !new RegExp(String(pScript.id)).test(list.raw) || String(pScript.id) === String(cScript.id) ? true : !list.body.scripts.some(function (s) { return String(s.id) === String(pScript.id); }));
  ok('asking for Physics is refused', (await call('GET', '/api/tutor/scripts?subject=Physics', null, chem.token)).status === 403);
  ok('the status filter works and rejects nonsense', (await call('GET', '/api/tutor/scripts?subject=Chemistry&status=marked', null, chem.token)).body.scripts.length === 0 && (await call('GET', '/api/tutor/scripts?subject=Chemistry&status=zzz', null, chem.token)).status === 400);

  console.log('\nopening a script');
  var open = await call('GET', '/api/tutor/scripts/' + encodeURIComponent(cScript.id), null, chem.token);
  var rows = open.body.answers || [];
  ok('it shows what the student wrote, the reference answer and the maximum', open.status === 200 && rows.length >= 2 && rows.every(function (r) { return /ZQXANSWER/.test(r.given) && !!r.expected && r.maxMark > 0 && r.markAwarded === null; }), open.raw);
  ok('a Physics tutor cannot open it', (await call('GET', '/api/tutor/scripts/' + encodeURIComponent(cScript.id), null, phys.token)).status === 403);
  ok('an unknown script is a 404', (await call('GET', '/api/tutor/scripts/nope', null, chem.token)).status === 404);

  console.log('\nmarking: no approval, scope held');
  var maxTotal = rows.reduce(function (t, r) { return t + r.maxMark; }, 0);
  function marksOf(fn) { var m = {}; rows.forEach(function (r, i) { var v = fn(r, i); if (v !== null) m[r.questionId] = v; }); return m; }
  function pct(score) { return Math.round(score / maxTotal * 1000) / 10; }
  function attemptOf(id) { return readDb().attempts.filter(function (a) { return String(a.id) === String(id); })[0]; }
  var onlyFirst = marksOf(function (r, i) { return i === 0 ? 7 : null; });
  var wrong = await call('POST', '/api/tutor/scripts/' + encodeURIComponent(cScript.id) + '/mark', { marks: onlyFirst }, phys.token);
  ok('a Physics tutor cannot mark a Chemistry script', wrong.status === 403, wrong.raw);
  ok('and nothing was stored or raised', attemptOf(cScript.id).status === 'awaiting-marking' && readDb().alerts.length === 0);
  var half = await call('POST', '/api/tutor/scripts/' + encodeURIComponent(cScript.id) + '/mark', { marks: onlyFirst }, chem.token);
  ok('a half-marked script keeps no score', half.status === 200 && half.body.status === 'awaiting-marking' && half.body.score === null && half.body.marked === 1, half.raw);
  ok('and raises no alert', half.body.alerted === false && (await call('GET', '/api/alerts', null, adm)).body.count === 0);
  var firstFull = marksOf(function (r, i) { return i === 0 ? 7 : r.maxMark + 50; });
  var fullScore = 7 + maxTotal - rows[0].maxMark;
  var full = await call('POST', '/api/tutor/scripts/' + encodeURIComponent(cScript.id) + '/mark', { marks: firstFull }, chem.token);
  ok('a mark beyond the maximum is held at the maximum', full.status === 200 && full.body.score === fullScore && full.body.maxScore === maxTotal && full.body.percent === pct(fullScore) && full.body.status === 'marked', full.raw);
  ok('the tutor\'s mark counts at once, with no approval step', attemptOf(cScript.id).status === 'marked');
  ok('the record shows which tutor marked it', (await call('GET', '/api/results/' + encodeURIComponent(cScript.id), null, adm)).body.markedBy === chem.id);
  var mine = await call('GET', '/api/me/results/' + encodeURIComponent(cScript.id), null, gTok);
  ok('the student sees the mark', mine.status === 200 && mine.body.score === fullScore, mine.raw);
  var xpFirst = 10 + Math.round(pct(fullScore) * 0.5);
  ok('the student was given the mark XP once', attemptOf(cScript.id).xpAwarded === xpFirst, attemptOf(cScript.id).xpAwarded + ' vs ' + xpFirst);

  console.log('\nthe admin alert');
  ok('the save raised an alert', full.body.alerted === true);
  var al = await call('GET', '/api/alerts', null, adm);
  ok('the console sees one unseen alert with tutor, subject, script, student, mark and time', al.status === 200 && al.body.count === 1 && al.body.alerts[0].tutorId === chem.id && al.body.alerts[0].tutorName === 'Mrs Ada Obi' && al.body.alerts[0].subject === 'Chemistry' && String(al.body.alerts[0].attemptId) === String(cScript.id) && al.body.alerts[0].scholarId === g.body.student.id && al.body.alerts[0].percent === pct(fullScore) && /^\d{4}-/.test(al.body.alerts[0].at) && al.body.alerts[0].changed === false, al.raw);

  console.log('\nany script in the subject can be marked again');
  var lessOne = marksOf(function (r) { return r.maxMark - 1; });
  var reScore = maxTotal - rows.length;
  var re = await call('POST', '/api/tutor/scripts/' + encodeURIComponent(cScript.id) + '/mark', { marks: lessOne }, chem.token);
  ok('a marked script can be changed by its subject tutor', re.status === 200 && re.body.score === reScore && re.body.percent === pct(reScore), re.raw);
  var al2 = await call('GET', '/api/alerts', null, adm);
  ok('the unseen alert is updated, not stacked, and says it was a change', al2.body.count === 1 && al2.body.alerts[0].percent === pct(reScore) && al2.body.alerts[0].changed === true, al2.raw);
  ok('re-marking gave no second helping of XP', attemptOf(cScript.id).xpAwarded === xpFirst);
  var viaAdmin = await call('POST', '/api/results/' + encodeURIComponent(cScript.id) + '/mark', { marks: marksOf(function (r) { return r.maxMark; }) }, adm);
  ok('the admin can still change a tutor\'s mark, and that raises no alert', viaAdmin.status === 200 && viaAdmin.body.score === maxTotal && (await call('GET', '/api/alerts', null, adm)).body.alerts[0].percent === pct(reScore));
  ok('a tutor may change a mark the admin gave', (await call('POST', '/api/tutor/scripts/' + encodeURIComponent(cScript.id) + '/mark', { marks: lessOne }, chem.token)).body.score === reScore);

  console.log('\nSeen');
  var seen = await call('POST', '/api/alerts/' + encodeURIComponent(al2.body.alerts[0].id) + '/seen', {}, adm);
  ok('the admin taps Seen and the list empties', seen.status === 200 && seen.body.count === 0 && (await call('GET', '/api/alerts', null, adm)).body.count === 0, seen.raw);
  ok('Seen twice is fine', (await call('POST', '/api/alerts/' + encodeURIComponent(al2.body.alerts[0].id) + '/seen', {}, adm)).status === 200);
  ok('an unknown alert is a 404', (await call('POST', '/api/alerts/AL-999/seen', {}, adm)).status === 404);
  ok('a tutor cannot tap Seen', [401, 403].indexOf((await call('POST', '/api/alerts/AL-1/seen', {}, chem.token)).status) > -1);
  ok('a fresh save after Seen raises a new alert', (await call('POST', '/api/tutor/scripts/' + encodeURIComponent(cScript.id) + '/mark', { marks: firstFull }, chem.token)).body.alerted === true && (await call('GET', '/api/alerts', null, adm)).body.count === 1);

  console.log('\nthe other subject is untouched');
  var pm = {}; (await call('GET', '/api/tutor/scripts/' + encodeURIComponent(pScript.id), null, phys.token)).body.answers.forEach(function (r) { pm[r.questionId] = 1; });
  ok('a Chemistry tutor cannot mark the Physics script', (await call('POST', '/api/tutor/scripts/' + encodeURIComponent(pScript.id) + '/mark', { marks: pm }, chem.token)).status === 403);
  ok('the Physics script is still waiting', readDb().attempts.filter(function (a) { return String(a.id) === String(pScript.id); })[0].status === 'awaiting-marking');
  ok('the Physics tutor marks it, and it is a second alert', (await call('POST', '/api/tutor/scripts/' + encodeURIComponent(pScript.id) + '/mark', { marks: pm }, phys.token)).status === 200 && (await call('GET', '/api/alerts', null, adm)).body.count === 2);

  console.log('\na switched-off tutor');
  await call('PUT', '/api/tutors/' + encodeURIComponent(chem.id) + '/active', { active: false }, adm);
  ok('is refused at once', [401, 403].indexOf((await call('POST', '/api/tutor/scripts/' + encodeURIComponent(cScript.id) + '/mark', { marks: firstFull }, chem.token)).status) > -1);
})().then(function () {
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  stop(); process.exit(fails ? 1 : 0);
}).catch(function (e) { console.log('  FAIL  harness: ' + (e && e.stack || e)); console.log(serverLog.slice(-600)); stop(); process.exit(1); });
