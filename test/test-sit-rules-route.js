/* test-sit-rules-route.js — Phase 3, Web Test sit rules slice 2: the server lets
   Theory and Objective be sat once, and JAMB-oriented as often as wanted,
   keeping every attempt.   node test/test-sit-rules-route.js */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = 'GOC2027';
var PORT = Number(process.env.GOC_TEST_PORT) || 8183;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-sit-rules-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return sleep(250).then(function () { return waitForBoot(tries - 1); });
  });
}

/* The depth bar is lowered to 1: this suite tests sitting mechanics on the thin seed bank. */
var env = Object.assign({}, process.env, {
  PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
  GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
});
env.GOC_JAMB_READY_MIN = '1';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], { cwd: SANDBOX, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
var serverLog = '';
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

var DATA = path.join(SANDBOX, 'server', 'data.json');
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];

/* Answer every question correctly, reading the key from the sandbox's own data
   file (the page is never sent it). */
function answers(paper) {
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var out = {};
  paper.questions.forEach(function (q) {
    var rec = db.questions.filter(function (x) { return x.id === q.id; })[0];
    if (rec && rec.answer !== undefined) out[q.id] = rec.answer;
  });
  return out;
}

waitForBoot(40).then(async function () {
  var su = await activeStudent.signedUp(call, { signupCode: SIGNUP, name: 'Ada Sit', password: 'secret123',
    email: 'ada.sit@example.com', phone: '08000000012', goal: 'JAMB / UTME 2027', subjects: COMBO });
  var tok = su.body.token;
  ok('a student is registered', su.status < 300 && !!tok, su.raw.slice(0, 120));
  var other = await activeStudent.signedUp(call, { signupCode: SIGNUP, name: 'Bola Sit', password: 'secret123',
    email: 'bola.sit@example.com', phone: '08000000013', goal: 'JAMB / UTME 2027', subjects: COMBO });
  var tok2 = other.body.token;
  /* These students stand in for academy students (GOC); a public sign-up is Open
     and may not sit Web Tests (Phase 3B). Only the test can flip it, in the sandbox file. */
  (function () {
    var dbf = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    dbf.students.forEach(function (x) { x.tier = 'goc'; });
    fs.writeFileSync(DATA, JSON.stringify(dbf));
  })();

  head('Objective: one sitting, then closed for good');
  var o1 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'objective' }, tok);
  ok('the first Objective sitting opens', o1.status === 200 && !!o1.body.attemptId, o1.status + ' ' + o1.raw.slice(0, 120));
  var os1 = await call('POST', '/api/me/tests/submit', { attemptId: o1.body.attemptId, responses: answers(o1.body) }, tok);
  ok('and is submitted', os1.status === 200, os1.status + ' ' + os1.raw.slice(0, 120));
  var o2 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'objective' }, tok);
  ok('a second Objective sitting is refused with 403', o2.status === 403 && /cannot be sat again/.test(o2.raw), o2.status + ' ' + o2.raw);
  ok('nothing is opened by the refusal', !/attemptId/.test(o2.raw));
  var o3 = await call('POST', '/api/me/tests/start', { period: 'weekly', section: 'objective' }, tok);
  ok('a different period label does not get round it', o3.status === 403, o3.status);
  var o4 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'objective' }, tok2);
  ok('another student is unaffected', o4.status === 200 && !!o4.body.attemptId, o4.status + ' ' + o4.raw.slice(0, 100));

  head('Theory: one sitting per subject, then closed');
  var t1 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'theory', subject: 'Physics' }, tok);
  ok('the first Physics theory sitting opens', t1.status === 200 && !!t1.body.attemptId, t1.status + ' ' + t1.raw.slice(0, 120));
  var ts1 = await call('POST', '/api/me/tests/submit', { attemptId: t1.body.attemptId, responses: {} }, tok);
  ok('and is submitted', ts1.status === 200, ts1.status + ' ' + ts1.raw.slice(0, 120));
  var t2 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'theory', subject: 'Physics' }, tok);
  ok('a second Physics theory sitting is refused', t2.status === 403 && /cannot be sat again/.test(t2.raw), t2.status + ' ' + t2.raw);

  head('JAMB-oriented: may be sat again, and every attempt is kept');
  var j1 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb' }, tok);
  ok('the first JAMB-oriented sitting opens', j1.status === 200 && !!j1.body.attemptId, j1.status + ' ' + j1.raw.slice(0, 120));
  var js1 = await call('POST', '/api/me/tests/submit', { attemptId: j1.body.attemptId, responses: answers(j1.body) }, tok);
  ok('and is submitted', js1.status === 200, js1.status + ' ' + js1.raw.slice(0, 120));
  var j2 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb' }, tok);
  ok('a second JAMB-oriented sitting opens', j2.status === 200 && !!j2.body.attemptId && j2.body.attemptId !== j1.body.attemptId, j2.status + ' ' + j2.raw.slice(0, 120));
  /* FRESH FIRST: the repeat draws what the student has not met before repeating anything. */
  var dbF = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var A1 = j1.body.questions.map(function (q) { return q.id; });
  var B1 = j2.body.questions.map(function (q) { return q.id; });
  var freshOk = true, detail = [];
  COMBO.forEach(function (sub) {
    var pool = core.eligible(dbF.questions, { section: 'jamb', subject: sub }).map(function (q) { return q.id; });
    var inB = B1.filter(function (id) { return pool.indexOf(id) > -1; });
    var unseen = pool.filter(function (id) { return A1.indexOf(id) < 0; });
    var usedUnseen = inB.filter(function (id) { return A1.indexOf(id) < 0; }).length;
    if (usedUnseen !== Math.min(unseen.length, inB.length)) freshOk = false;
    detail.push(sub + ': pool ' + pool.length + ', unseen ' + unseen.length + ', fresh used ' + usedUnseen + '/' + inB.length);
  });
  ok('the repeat uses every unseen question it has room for before re-using any', freshOk, detail.join('; '));
  var js2 = await call('POST', '/api/me/tests/submit', { attemptId: j2.body.attemptId, responses: {} }, tok);
  ok('and is submitted too', js2.status === 200, js2.status + ' ' + js2.raw.slice(0, 120));
  head('JAMB-style score out of 400');
  ok('the submit response carries the score: all correct = 400', !!js1.body.jambScore && js1.body.jambScore.total === 400 && js1.body.jambScore.max === 400, JSON.stringify(js1.body.jambScore));
  ok('four subjects, each out of 100', !!js1.body.jambScore && js1.body.jambScore.subjects.length === 4 && js1.body.jambScore.subjects.every(function (s) { return s.score === 100; }));
  ok('a blank repeat scores 0 / 400', !!js2.body.jambScore && js2.body.jambScore.total === 0, JSON.stringify(js2.body.jambScore));
  ok('the Objective result has no /400', !os1.body.jambScore);
  var resJ = await call('GET', '/api/me/results', undefined, tok);
  var listJ = ((resJ.body && resJ.body.attempts) || []).filter(function (a) { return a.section === 'jamb'; });
  ok('the results list carries it for every JAMB-oriented row', listJ.length === 2 && listJ.every(function (a) { return a.jambScore && a.jambScore.max === 400; }), JSON.stringify(listJ.map(function (a) { return a.jambScore && a.jambScore.total; })));
  ok('and not for Objective or Theory rows', ((resJ.body && resJ.body.attempts) || []).filter(function (a) { return a.section !== 'jamb'; }).every(function (a) { return !a.jambScore; }));
  var adm = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var admTok = adm.body && adm.body.token;
  var un = await call('POST', '/api/auth/unlock', { passcode: '2027' }, admTok);
  var cons = await call('GET', '/api/results', undefined, admTok);
  var consJ = ((cons.body && (cons.body.results || cons.body.attempts)) || []).filter(function (a) { return a.section === 'jamb'; });
  ok('the console results carry it too', consJ.length === 2 && consJ.every(function (a) { return a.jambScore && a.jambScore.max === 400; }), cons.status + ' ' + cons.raw.slice(0, 160));
  var j3 = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb' }, tok);
  ok('a third opens as well', j3.status === 200 && !!j3.body.attemptId, j3.status);

  head('the record keeps every attempt');
  var res = await call('GET', '/api/me/results', undefined, tok);
  var rows = (res.body && res.body.attempts) || [];
  var jr = rows.filter(function (a) { return a.section === 'jamb'; });
  ok('both submitted JAMB-oriented attempts are on the record', jr.length === 2, JSON.stringify(rows.map(function (a) { return a.section; })));
  ok('with different ids', jr.length === 2 && jr[0].id !== jr[1].id);
  ok('Objective and Theory appear once each', rows.filter(function (a) { return a.section === 'objective'; }).length === 1 &&
     rows.filter(function (a) { return a.section === 'theory'; }).length === 1);

  head('repeat attempts earn XP every time');
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var mine = db.attempts.filter(function (a) { return a.section === 'jamb'; });
  ok('the first JAMB-oriented attempt earned XP', mine.length === 2 && mine.some(function (a) { return a.id === j1.body.attemptId && a.xpAwarded > 0; }), JSON.stringify(mine.map(function (a) { return a.xpAwarded; })));
  ok('so did the repeat', mine.some(function (a) { return a.id === j2.body.attemptId && a.xpAwarded > 0; }), JSON.stringify(mine.map(function (a) { return a.xpAwarded; })));

  head('the catalogue tells the card what to show');
  var cat = await call('GET', '/api/me/tests', undefined, tok);
  var rowsC = (cat.body && cat.body.tests) || [];
  var cObj = rowsC.filter(function (r) { return r.section === 'objective'; })[0];
  var cThp = rowsC.filter(function (r) { return r.section === 'theory' && r.subject === 'Physics'; })[0];
  var cThc = rowsC.filter(function (r) { return r.section === 'theory' && r.subject === 'Chemistry'; })[0];
  var cJ = rowsC.filter(function (r) { return r.section === 'jamb'; })[0];
  ok('a sat Objective row is completed, not repeatable, with 1 attempt', !!cObj && cObj.completed === true && cObj.repeatable === false && cObj.attempts === 1, JSON.stringify(cObj));
  ok('a sat Theory row is completed', !!cThp && cThp.completed === true && cThp.repeatable === false && cThp.attempts === 1, JSON.stringify(cThp));
  ok('an unsat Theory row is open with 0 attempts', !cThc || (cThc.completed === false && cThc.attempts === 0), JSON.stringify(cThc));
  ok('the JAMB-oriented row is NOT completed, is repeatable, and counts submitted attempts', !!cJ && cJ.completed === false && cJ.repeatable === true && cJ.attempts === 2, JSON.stringify(cJ));
  var cat2 = await call('GET', '/api/me/tests', undefined, tok2);
  var cJ2 = ((cat2.body && cat2.body.tests) || []).filter(function (r) { return r.section === 'jamb'; })[0];
  ok('another student has a fresh JAMB-oriented row (0 attempts, open)', !!cJ2 && cJ2.completed === false && cJ2.attempts === 0, JSON.stringify(cJ2));

  head('the gate still guards its edges');
  var bad = await call('POST', '/api/me/tests/start', { period: 'test', section: 'practice', subject: 'Physics' }, tok);
  ok('a non-Web-Test section is refused, and never as "already sat"', bad.status >= 400 && !/already submitted/.test(bad.raw), bad.status + ' ' + bad.raw);
  var anon = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb' });
  ok('an anonymous caller is still turned away', anon.status === 401 || anon.status === 403, anon.status);
}).catch(function (e) {
  fails++; console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')\n' + serverLog.slice(-400));
}).then(function () {
  stop();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
});
