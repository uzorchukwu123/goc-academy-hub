/* test-clear-attempts.js — clearing chosen attempts so a student can resit.
   Runs the real server over HTTP against a throwaway copy of the app.
   node test/test-clear-attempts.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
var PORT = Number(process.env.GOC_TEST_PORT) || 8151;
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-clear-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        var json = null; try { json = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, body: json, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}

/* GOC_CLEAR_MODE=stub runs the very same checks with the server in Appwrite
   mode, against the in-memory stand-in (test/appwrite-stub) — attempts and
   student XP then live in Appwrite-style collections, never a real project. */
var STUB = process.env.GOC_CLEAR_MODE === 'stub';
var DATA_DIR = STUB ? path.join(SANDBOX, 'data') : path.join(SANDBOX, 'server');
if (STUB) fs.mkdirSync(DATA_DIR, { recursive: true });
var envx = {
  PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
  GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
  GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
};
if (STUB) {
  /* In Appwrite mode the question bank is a collection too — seed the shipped
     questions into the stand-in, in the shape questionToDoc writes them. */
  var seedDocs = core.seedQuestions().map(function (q) {
    return { col: 'questions', data: {
      $id: String(q.id), legacyId: Number(q.id) || 0, subject: q.subject || '', topic: q.topic || '',
      kind: q.kind || '', section: q.section || '', period: q.period || core.PERIOD, text: q.text || '',
      difficulty: q.difficulty || '', explanation: q.explanation || '', active: q.active !== false,
      options: (q.options || []).map(String), answer: (q.answer == null ? null : Number(q.answer)),
      expected: q.expected || '', maxMark: Number(q.maxMark) || 0 } };
  });
  var seedFile = path.join(SANDBOX, 'seed.json');
  fs.writeFileSync(seedFile, JSON.stringify({ files: [], docs: seedDocs }));
  envx.STUB_SEED = seedFile;
}
if (STUB) Object.assign(envx, {
  GOC_DATA_DIR: DATA_DIR,
  APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub', APPWRITE_API_KEY: 'stubkey',
  NODE_OPTIONS: '-r ' + path.join(APP, 'test', 'appwrite-stub', 'hook.js')
});
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, envx),
  stdio: ['ignore', 'pipe', 'pipe']
});
var serverLog = '';
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });
function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

/* sit a paper as the student; returns the submit reply */
async function sit(token, section) {
  var p = await call('POST', '/api/me/tests/start', { period: 'weekly', section: section }, token);
  if (p.status !== 200) return { startStatus: p.status, startRaw: p.raw };
  var responses = {};
  p.body.questions.forEach(function (q) { responses[q.id] = 0; });
  var sub = await call('POST', '/api/me/tests/submit', { attemptId: p.body.attemptId, responses: responses }, token);
  return { startStatus: 200, sub: sub };
}
async function xpOf(token) { var me = await call('GET', '/api/me', undefined, token); return me.body && me.body.xp; }

waitForBoot(20).then(async function () {
  head('set-up: one student, one console session');
  var reg = await call('POST', '/api/students', { signupCode: SIGNUP, name: 'Clear Test', password: 'secret123',
    email: 'clear.test@example.com', phone: '08000000077', goal: 'JAMB / UTME 2027',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  ok('student registered', reg.status < 400 && reg.body && reg.body.token, reg.status + ' ' + reg.raw.slice(0, 120));
  var stu = reg.body.token, sid = reg.body.student.id;
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);

  head('two attempts on record, each dated');
  var obj1 = await sit(stu, 'objective');
  var jmb = await sit(stu, 'jamb');
  ok('objective attempt submitted', obj1.sub && obj1.sub.status === 200, JSON.stringify(obj1).slice(0, 160));
  ok('jamb attempt submitted', jmb.sub && jmb.sub.status === 200, JSON.stringify(jmb).slice(0, 160));
  var xpAfterSits = await xpOf(stu);
  var list = await call('GET', '/api/results?scholarId=' + sid, undefined, adm);
  ok('both attempts are listed', list.body.results.length === 2, list.raw.slice(0, 200));
  ok('each carries a submission date', list.body.results.every(function (a) { return a.submittedAt > 1e12; }));
  var objAttempt = list.body.results.filter(function (a) { return a.section === 'objective'; })[0];
  var jambAttempt = list.body.results.filter(function (a) { return a.section === 'jamb'; })[0];
  var again = await call('POST', '/api/me/tests/start', { period: 'weekly', section: 'objective' }, stu);
  ok('before clearing, the student cannot sit objective again', again.status === 403, again.status);

  head('guards — this can only clear what was chosen');
  var noAuth = await call('POST', '/api/results/clear', { ids: [objAttempt.id], confirm: true });
  ok('anonymous caller refused', noAuth.status >= 401 && noAuth.status <= 403, noAuth.status);
  var byStudent = await call('POST', '/api/results/clear', { ids: [objAttempt.id], confirm: true }, stu);
  ok('a student cannot clear attempts', byStudent.status >= 400, byStudent.status);
  var empty = await call('POST', '/api/results/clear', { confirm: true }, adm);
  ok('an empty request is refused, not treated as "everything"', empty.status === 400, empty.status + ' ' + empty.raw);
  var emptyFilter = await call('POST', '/api/results/clear', { filter: {}, confirm: true }, adm);
  ok('an empty filter is refused', emptyFilter.status === 400, emptyFilter.status);
  var noConfirm = await call('POST', '/api/results/clear', { ids: [objAttempt.id] }, adm);
  ok('a clear without confirm is refused', noConfirm.status === 400, noConfirm.status);
  var tooMany = await call('POST', '/api/results/clear',
    { ids: Array.from({ length: 201 }, function (_, i) { return 'x' + i; }), confirm: true }, adm);
  ok('more than 200 at once is refused', tooMany.status === 400, tooMany.status);
  var stillTwo = await call('GET', '/api/results?scholarId=' + sid, undefined, adm);
  ok('none of that removed anything', stillTwo.body.results.length === 2);

  head('dry run — shows what would go, changes nothing');
  var dry = await call('POST', '/api/results/clear', { ids: [objAttempt.id], dryRun: true }, adm);
  ok('dry run names the attempt', dry.status === 200 && dry.body.dryRun === true && dry.body.count === 1 &&
     dry.body.attempts[0].id === objAttempt.id, dry.raw.slice(0, 200));
  var dryFilter = await call('POST', '/api/results/clear',
    { filter: { scholarId: sid, section: 'objective' }, dryRun: true }, adm);
  ok('a filter preview matches the same single attempt', dryFilter.body.count === 1, dryFilter.raw.slice(0, 200));
  var dryDate = await call('POST', '/api/results/clear',
    { filter: { scholarId: sid, from: Date.now() + 86400000 }, dryRun: true }, adm);
  ok('a date range in the future matches nothing', dryDate.body.count === 0, dryDate.raw.slice(0, 200));
  var stillTwo2 = await call('GET', '/api/results?scholarId=' + sid, undefined, adm);
  ok('dry runs removed nothing', stillTwo2.body.results.length === 2);

  head('clearing ONE chosen attempt');
  var xpBefore = await xpOf(stu);
  var expectGone = Math.min(objAttempt.xpAwarded || 0, xpBefore || 0);
  var results = await Promise.all([
    call('POST', '/api/results/clear', { ids: [objAttempt.id], confirm: true, reason: 'wrong paper opened' }, adm),
    call('POST', '/api/results/clear', { ids: [objAttempt.id], confirm: true }, adm)
  ]);
  var clearedTotal = results.reduce(function (t, r) { return t + (r.body && r.body.cleared || 0); }, 0);
  ok('two simultaneous clears of the same attempt remove it exactly once', clearedTotal === 1, JSON.stringify(results.map(function (r) { return r.body; })));
  var win = results.filter(function (r) { return r.body && r.body.cleared === 1; })[0];
  ok('the reply says how much XP was taken back', win && win.body.xpRemoved === expectGone, win && win.raw);
  var xpAfterClear = await xpOf(stu);
  ok('the student\'s XP dropped by exactly that', xpAfterClear === xpBefore - expectGone, xpBefore + ' -> ' + xpAfterClear);
  var afterList = await call('GET', '/api/results?scholarId=' + sid, undefined, adm);
  ok('only the chosen attempt is gone; the other is untouched',
     afterList.body.results.length === 1 && afterList.body.results[0].id === jambAttempt.id, afterList.raw.slice(0, 200));

  head('the student can resit the cleared test — and only that one');
  var cat = await call('GET', '/api/me/tests', undefined, stu);
  var objEntry = cat.body.tests.filter(function (t) { return t.section === 'objective'; })[0];
  ok('the catalogue shows objective as open again', objEntry && objEntry.completed === false, JSON.stringify(objEntry).slice(0, 160));
  var jambEntry = cat.body.tests.filter(function (t) { return t.section === 'jamb'; })[0];
  ok('the jamb sitting is still closed', jambEntry && jambEntry.completed === true);
  var jambAgain = await call('POST', '/api/me/tests/start', { period: 'weekly', section: 'jamb' }, stu);
  ok('the server still refuses a second jamb sitting', jambAgain.status === 403, jambAgain.status);

  head('the archive keeps a restorable copy');
  var arch = await call('GET', '/api/cleared-attempts', undefined, adm);
  ok('the cleared attempt is archived with who, when and why',
     arch.status === 200 && arch.body.cleared.length === 1 && arch.body.cleared[0].clearedBy === 'GOC-A-001' &&
     arch.body.cleared[0].reason === 'wrong paper opened' && arch.body.cleared[0].clearedAt > 1e12, arch.raw.slice(0, 240));
  var archId = arch.body.cleared[0].archiveId;
  var archStu = await call('GET', '/api/cleared-attempts', undefined, stu);
  ok('a student cannot read the archive', archStu.status >= 400, archStu.status);

  var resit = await sit(stu, 'objective');
  ok('the student sits objective again', resit.sub && resit.sub.status === 200, JSON.stringify(resit).slice(0, 160));
  var blocked = await call('POST', '/api/cleared-attempts/' + archId + '/restore', {}, adm);
  ok('restore is refused while a newer attempt exists (one-sit rule holds)', blocked.status === 409, blocked.status + ' ' + blocked.raw);

  var now = await call('GET', '/api/results?scholarId=' + sid + '&section=objective', undefined, adm);
  var newer = now.body.results[0];
  var xpMid = await xpOf(stu);
  var clr2 = await call('POST', '/api/results/clear', { ids: [newer.id], confirm: true }, adm);
  ok('the newer attempt can be cleared', clr2.status === 200 && clr2.body.cleared === 1, clr2.raw);
  var xpLow = await xpOf(stu);
  var rest = await call('POST', '/api/cleared-attempts/' + archId + '/restore', {}, adm);
  ok('now the original restores', rest.status === 200 && rest.body.id === objAttempt.id, rest.status + ' ' + rest.raw);
  var xpRestored = await xpOf(stu);
  ok('its XP is returned', xpRestored === xpLow + expectGone, xpLow + ' -> ' + xpRestored);
  var back = await call('GET', '/api/results/' + encodeURIComponent(objAttempt.id), undefined, adm);
  ok('the restored attempt keeps its score and date (answers are not archived)',
     back.status === 200 && back.body.score === objAttempt.score && back.body.submittedAt === objAttempt.submittedAt &&
     Array.isArray(back.body.answers) && back.body.answers.length === 0, back.raw.slice(0, 200));
  var twice = await call('POST', '/api/cleared-attempts/' + archId + '/restore', {}, adm);
  ok('it cannot be restored twice', twice.status === 409, twice.status);
  var locked = await call('POST', '/api/me/tests/start', { period: 'weekly', section: 'objective' }, stu);
  ok('after a restore the test is closed again', locked.status === 403, locked.status);

  head('nothing else was disturbed');
  var data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8'));
  ok('data.json is valid and still holds the roster and question bank', data.staff.length === 2 && data.questions.length > 0);
  ok('the archive lives in the blob, not in attempts', Array.isArray(data.clearedAttempts) && data.clearedAttempts.length === 2);
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  stop();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('\nTEST RUN FAILED: ' + (e && e.stack || e));
  if (serverLog) console.log('--- server output ---\n' + serverLog);
  stop();
  process.exit(1);
});
