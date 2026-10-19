/* test-jamb-ready-route.js — Phase 3, JAMB mock slice 2: the server holds the
   sitting back until the bank is deep enough, in the catalogue AND at start.
   node test/test-jamb-ready-route.js */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8171;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-jamb-ready-'));
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

/* NOTE: GOC_JAMB_READY_MIN is deliberately NOT set — this suite runs on the default bar. */
var env = Object.assign({}, process.env, {
  PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
  GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
});
delete env.GOC_JAMB_READY_MIN;
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
var nextQ = 90000;
function addJamb(subject, n) {
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var proto = db.questions.filter(function (q) { return q.section === 'jamb' && q.subject === subject; })[0];
  for (var i = 0; i < n; i++) {
    var q = JSON.parse(JSON.stringify(proto));
    q.id = nextQ++; q.text = 'Extra ' + subject + ' ' + q.id; q.active = true;
    db.questions.push(q);
  }
  fs.writeFileSync(DATA, JSON.stringify(db));
}
function jambRows(r) { return (r.body.tests || []).filter(function (t) { return t.section === 'jamb'; }); }

waitForBoot(40).then(async function () {
  var su = await activeStudent.signedUp(call, { signupCode: SIGNUP, name: 'Ada Test', password: 'secret123',
    email: 'ada.jamb@example.com', phone: '08000000011', goal: 'JAMB / UTME 2027', subjects: COMBO });
  var tok = su.body.token;
  ok('a student is registered', su.status < 300 && !!tok, su.raw.slice(0, 120));
  /* These students stand in for academy students (GOC); a public sign-up is Open
     and may not sit Web Tests (Phase 3B). Only the test can flip it, in the sandbox file. */
  (function () {
    var dbf = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    dbf.students.forEach(function (x) { x.tier = 'goc'; });
    fs.writeFileSync(DATA, JSON.stringify(dbf));
  })();
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);

  head('on the seeded (thin) bank the sitting is held back');
  var cat = await call('GET', '/api/me/tests', undefined, tok);
  ok('the catalogue is served', cat.status === 200, cat.raw.slice(0, 100));
  ok('no JAMB-oriented paper is listed', jambRows(cat).length === 0, JSON.stringify(jambRows(cat)));
  ok('the Objective sitting is unaffected', cat.body.tests.some(function (t) { return t.section === 'objective'; }));
  var st = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb', subject: 'All subjects' }, tok);
  ok('starting it directly is refused, not just hidden', st.status === 403 && /not open yet/.test(st.raw), st.status + ' ' + st.raw);
  ok('and it says why in plain words', /question bank is still being built/.test(st.raw));
  ok('nothing was recorded or opened by the refusal', !/attemptId/.test(st.raw));
  var anon = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb' });
  ok('an anonymous caller is still turned away first', anon.status === 401 || anon.status === 403, anon.status);

  head('the console sees the readiness');
  var bp = await call('GET', '/api/jamb/blueprint', undefined, adm);
  ok('the blueprint carries the bar and a readiness report', bp.status === 200 && bp.body.readyMin === 20 && bp.body.readiness && bp.body.readiness.ready === false, bp.raw.slice(0, 200));
  ok('naming the subjects that are short', bp.body.readiness.short.length > 0 && bp.body.readiness.subjects.every(function (r) { return typeof r.need === 'number'; }));
  var sget = await call('GET', '/api/settings', undefined, adm);
  ok('the bar is readable in settings', sget.body.jambReadyMin === 20, sget.raw);

  head('depth in every subject opens it — one subject short does not');
  addJamb('Use of English', 25); addJamb('Chemistry', 25); addJamb('Mathematics', 25);
  cat = await call('GET', '/api/me/tests', undefined, tok);
  ok('three deep subjects and one thin one: still held back', jambRows(cat).length === 0);
  st = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb' }, tok);
  ok('and still refused at start', st.status === 403, st.status + ' ' + st.raw);
  addJamb('Physics', 25);
  cat = await call('GET', '/api/me/tests', undefined, tok);
  ok('once every subject is deep the sitting is listed, once', jambRows(cat).length === 1 && jambRows(cat)[0].durationSec > 0, JSON.stringify(jambRows(cat)));
  bp = await call('GET', '/api/jamb/blueprint', undefined, adm);
  ok('the console report turns ready for the subjects it covers',
     bp.body.readiness.subjects.filter(function (r) { return COMBO.indexOf(r.subject) > -1; }).every(function (r) { return r.ok; }));
  st = await call('POST', '/api/me/tests/start', { period: 'test', section: 'jamb' }, tok);
  ok('it now opens as a full timed paper', st.status === 200 && !!st.body.attemptId && st.body.section === 'jamb' && st.body.durationSec > 0, st.status + ' ' + st.raw.slice(0, 120));

  head('the bar belongs to the academy');
  var put = await call('PUT', '/api/settings', { jambReadyMin: 30 }, adm);
  ok('the console can raise the bar', put.status === 200 && put.body.jambReadyMin === 30, put.raw);
  var stu = await call('PUT', '/api/settings', { jambReadyMin: 1 }, tok);
  ok('a student cannot move it', stu.status >= 400, stu.status);
  cat = await call('GET', '/api/me/tests', undefined, tok);
  ok('a raised bar hides the sitting again (26 deep < 30)', jambRows(cat).length === 0, JSON.stringify(jambRows(cat)));
  put = await call('PUT', '/api/settings', { jambReadyMin: 9999 }, adm);
  ok('an out-of-range bar is clamped to 40', put.body.jambReadyMin === 40, put.raw);
  put = await call('PUT', '/api/settings', { jambReadyMin: 26 }, adm);
  cat = await call('GET', '/api/me/tests', undefined, tok);
  ok('the bar can be set to exactly what the bank holds', jambRows(cat).length === 1);
}).catch(function (e) {
  fails++; console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')\n' + serverLog.slice(-400));
}).then(function () {
  stop();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
});
