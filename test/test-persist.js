/* test-persist.js — Priority (Task 4): admin-console settings and student
   attempt records must survive a refresh, and specifically must survive the
   server itself restarting (a redeploy, a crash-and-recover), not just a
   normal read-after-write within the same process.

   Unlike test-server.js, this suite kills and respawns the server process
   partway through, against the SAME sandboxed data.json, so a value that
   only "persisted" in an in-memory cache (and was never actually written to
   disk) would be caught here — it would come back as the old default after
   the restart instead of the value this suite set.

   No dependencies. Run:  node test/test-persist.js  (or via test/run.js) */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
var PORT = Number(process.env.GOC_TEST_PORT) || 8143;

/* A throwaway copy of the application, same pattern as test-server.js — the
   real roster is never touched, and this suite's own data.json is deleted
   with the rest of the sandbox when it finishes. */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-persist-test-'));
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
        var json = null;
        try { json = JSON.parse(raw); } catch (e) { /* not JSON — keep raw */ }
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

var child = null;
function bootServer() {
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027',
      GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027',
      GOC_SIGNUP_CODE: SIGNUP
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  var log = '';
  child.stdout.on('data', function (c) { log += c; });
  child.stderr.on('data', function (c) { log += c; });
  child._log = function () { return log; };
  return waitForBoot(40);
}

/* Kills the running server and starts a fresh process against the SAME
   sandbox folder — i.e. the same data.json on disk — the way a redeploy or
   a crash recovery would. Anything that only lived in the old process's
   memory does not survive this; anything actually written to disk does. */
function restartServer() {
  return new Promise(function (resolve) {
    child.once('exit', function () { resolve(); });
    child.kill();
  }).then(function () { return bootServer(); });
}

function stop() {
  try { if (child) child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

(async function () {
  await bootServer();

  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);

  /* ------------------------------------------------------------------ */
  head('Question Bank records survive restart, and deletions stay deleted');

  var qMade = await call('POST', '/api/questions', {
    subject: 'Physics',
    section: 'objective',
    period: 'weekly',
    topic: 'Persistence Test',
    text: 'Which unit is used to measure force in this persistence test?',
    options: ['Newton', 'Joule', 'Watt', 'Pascal'],
    answer: 0,
    difficulty: 'easy',
    explanation: 'Force is measured in newtons.'
  }, adm);

  var persistQid = qMade.body && qMade.body.id;
  ok(
    'the Question Bank accepts a new question',
    qMade.status === 200 && Number(persistQid) > 0,
    qMade.status + ' ' + qMade.raw
  );

  var qBeforeRestart = await call(
    'GET',
    '/api/questions?subject=Physics',
    undefined,
    adm
  );

  ok(
    'the new question is visible before restart',
    qBeforeRestart.status === 200 &&
      qBeforeRestart.body.questions.some(function (q) {
        return q.id === persistQid;
      }),
    qBeforeRestart.raw.slice(0, 180)
  );

  /* Restart #1: this is the important persistence check. The server is
     respawned against the same sandbox data.json. */
  await restartServer();

  var qLogin2 = await call('POST', '/api/auth/login', {
    id: 'GOC-A-001',
    password: 'founder2027'
  });
  var qAdm2 = qLogin2.body.token;

  await call('POST', '/api/auth/unlock', {
    passcode: '2027'
  }, qAdm2);

  var qAfterRestart = await call(
    'GET',
    '/api/questions?subject=Physics',
    undefined,
    qAdm2
  );

  ok(
    'the uploaded question survives a server restart',
    qAfterRestart.status === 200 &&
      qAfterRestart.body.questions.some(function (q) {
        return q.id === persistQid &&
          q.text === 'Which unit is used to measure force in this persistence test?';
      }),
    qAfterRestart.raw.slice(0, 220)
  );

  var qDeactivate = await call(
    'PUT',
    '/api/questions/' + persistQid + '/active',
    { active: false },
    qAdm2
  );

  ok(
    'the persisted question can be deactivated',
    qDeactivate.status === 200 && qDeactivate.body.active === false,
    qDeactivate.status + ' ' + qDeactivate.raw
  );

  var qDelete = await call(
    'DELETE',
    '/api/questions/' + persistQid,
    undefined,
    qAdm2
  );

  ok(
    'the deactivated question can be permanently deleted',
    qDelete.status === 200 &&
      qDelete.body.deleted === persistQid,
    qDelete.status + ' ' + qDelete.raw
  );

  /* Restart #2: deletion must be durable, not merely an in-memory UI
     change. */
  await restartServer();

  var qLogin3 = await call('POST', '/api/auth/login', {
    id: 'GOC-A-001',
    password: 'founder2027'
  });
  var qAdm3 = qLogin3.body.token;

  await call('POST', '/api/auth/unlock', {
    passcode: '2027'
  }, qAdm3);

  var qAfterDeleteRestart = await call(
    'GET',
    '/api/questions?subject=Physics',
    undefined,
    qAdm3
  );

  ok(
    'a deleted question stays deleted after a server restart',
    qAfterDeleteRestart.status === 200 &&
      !qAfterDeleteRestart.body.questions.some(function (q) {
        return q.id === persistQid;
      }),
    qAfterDeleteRestart.raw.slice(0, 220)
  );

  // The Question Bank persistence checks restarted the server twice.
  // Refresh the shared admin token before the existing settings-persistence test.
  adm = qAdm3;

  /* ------------------------------------------------------------------ */
  head('Settings written before a restart are the settings read after it');

  var beforeSet = await call('PUT', '/api/settings', {
    dailyLimitMin: 111,
    sessionMinutes: 47,
    sessionWarnMinutes: 5,
    objectiveMinutes: 63,
    guardianPin: '4321'
  }, adm);
  ok('the console accepts the new settings', beforeSet.status === 200, beforeSet.status + ' ' + beforeSet.raw);

  var beforeCount = await call('PUT', '/api/settings/objective-count',
    { subject: 'Physics', questions: 17 }, adm);
  ok('the console accepts the new objective count', beforeCount.status === 200, beforeCount.status + ' ' + beforeCount.raw);

  /* A brand-new student, enrolled and sitting a paper before the restart, to
     check attempt records the same way settings are checked below. */
  var enrolled = await call('POST', '/api/students', {
    signupCode: SIGNUP, name: 'Persist Test Student', password: 'secret123',
    goal: 'JAMB / UTME 2027',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology']
  });
  var student = enrolled.body;
  ok('the student enrolled', enrolled.status === 200 && !!(student && student.token), enrolled.status + ' ' + enrolled.raw);

  var started = await call('POST', '/api/me/tests/start',
    { period: 'weekly', section: 'objective', subject: 'Physics' }, student.token);
  var responses = {};
  (started.body.questions || []).forEach(function (q) { responses[q.id] = 0; });
  var submitted = await call('POST', '/api/me/tests/submit',
    { attemptId: started.body.attemptId, responses: responses }, student.token);
  ok('the attempt was submitted before the restart',
     submitted.status === 200 && submitted.body.status === 'marked',
     submitted.status + ' ' + submitted.raw);

  var beforeResults = await call('GET', '/api/me/results', undefined, student.token);
  var beforeCount2 = (beforeResults.body && beforeResults.body.attempts || []).length;
  ok('the attempt appears in the student\'s record before the restart', beforeCount2 === 1, beforeCount2);

  /* -------------------------- the actual restart -------------------- */
  await restartServer();

  /* Sessions are held in memory (by design — see Task 6), so a restart signs
     everyone out on purpose; log back in the same way a real refresh would
     force a real user to. That re-auth step is the known, already-tracked
     behaviour under Task 6 — what THIS suite checks is only whether the
     underlying data came back correctly once logged back in. */
  var lin2 = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm2 = lin2.body.token;
  var unlock2 = await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm2);
  ok('the console passcode set before the restart still unlocks it after',
     unlock2.status === 200, unlock2.status + ' ' + unlock2.raw);

  var after = await call('GET', '/api/settings', undefined, adm2);
  ok('dailyLimitMin survived the restart', after.body.dailyLimitMin === 111, after.raw);
  ok('sessionMinutes survived the restart', after.body.sessionMinutes === 47, after.raw);
  ok('sessionWarnMinutes survived the restart', after.body.sessionWarnMinutes === 5, after.raw);
  ok('objectiveMinutes survived the restart', after.body.objectiveMinutes === 63, after.raw);
  ok('the guardian PIN survived the restart', after.body.hasGuardianPin === true, after.raw);

  var afterBp = await call('GET', '/api/objective/blueprint?period=weekly', undefined, adm2);
  var physicsRow = (afterBp.body.papers || []).filter(function (r) { return r.subject === 'Physics'; })[0];
  ok('the objective question count for Physics survived the restart',
     !!physicsRow && physicsRow.want === 17,
     physicsRow && JSON.stringify(physicsRow));

  var studentLogin2 = await call('POST', '/api/auth/login', { id: student.student.id, password: 'secret123' });
  var afterResults = await call('GET', '/api/me/results', undefined, studentLogin2.body.token);
  var afterCount = (afterResults.body && afterResults.body.attempts || []).length;
  ok('the attempt submitted before the restart is still on the student\'s record',
     afterCount === 1, afterCount);
  ok('the attempt still carries its result, not a reset/blank one',
     afterResults.body.attempts[0] && typeof afterResults.body.attempts[0].percent === 'number',
     JSON.stringify(afterResults.body.attempts && afterResults.body.attempts[0]));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  stop();
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('\nTEST RUN FAILED: ' + (e && e.stack || e));
  if (child && child._log) console.log('--- server output ---\n' + child._log());
  stop();
  process.exit(1);
});
