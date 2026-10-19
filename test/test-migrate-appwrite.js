/* test-migrate-appwrite.js — implementation-map STEP 5 gate for STEP 4.

   Verifies the one-off migration route (POST /api/admin/migrate-appwrite):
   known questions/attempts sitting in a sandbox data.json blob are copied into
   the Appwrite `questions`/`attempts` collections, every field survives the
   xToRecord conversion, and a second run creates no duplicates (idempotency)
   with matching reconciliation counts.

   This suite needs a THROWAWAY Appwrite project (never a production one) and
   the node-appwrite package installed. When APPWRITE_ENDPOINT / _PROJECT_ID /
   _API_KEY are not all set, it SKIPS cleanly (exit 0) so the offline suite
   stays green. Run its provisioning first:  node server/setup-appwrite.js

   Run:  node test/test-migrate-appwrite.js  (or via test/run.js)

   WARNING: point this only at a disposable Appwrite project — it writes real
   documents into the questions/attempts collections. */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var haveConfig = process.env.APPWRITE_ENDPOINT && process.env.APPWRITE_PROJECT_ID && process.env.APPWRITE_API_KEY;
if (!haveConfig) {
  console.log('\ntest-migrate-appwrite.js');
  console.log('  skip  Appwrite not configured (APPWRITE_ENDPOINT/PROJECT_ID/API_KEY unset) — nothing to verify.');
  console.log('        Provision a throwaway project, run  node server/setup-appwrite.js , then re-run.');
  process.exit(0);
}

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_TEST_PORT) || 8155;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-migrate-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
var DATA = path.join(SANDBOX, 'server', 'data.json');
try { fs.rmSync(DATA, { force: true }); } catch (e) {}

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
        try { json = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, body: json, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

var child = null;
function boot(withAppwrite) {
  var env = Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027',
    GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027'
  });
  if (!withAppwrite) {
    // Phase 1: seed a plain local data.json only — hide Appwrite from the child.
    delete env.APPWRITE_ENDPOINT; delete env.APPWRITE_PROJECT_ID; delete env.APPWRITE_API_KEY;
  }
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX, env: env, stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function () {});
  child.stderr.on('data', function () {});
}
function stopChild() { return new Promise(function (r) { if (!child) return r(); child.on('exit', function () { r(); }); try { child.kill(); } catch (e) { r(); } }); }
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}
function done() {
  try { if (child) child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}

// Known records we will look for after migration.
var KNOWN_Q = { id: 999001, subject: 'Physics', topic: 'Kinematics', kind: 'objective', section: 'objective',
                period: core.PERIOD, text: 'A migration probe question about velocity.', difficulty: 'easy',
                explanation: 'Because migration preserves fields.', active: true,
                options: ['1 m/s', '2 m/s', '3 m/s', '4 m/s'], answer: 2, expected: '', maxMark: 1 };
var KNOWN_A = { id: 'MIGPROBE-1', scholarId: 'GOC-S-MIG1', studentName: 'Migration Probe',
                period: core.PERIOD, section: 'theory', subject: 'Physics', questionIds: [999001],
                startedAt: 1000, submittedAt: 2000, timeUsedSec: 30, durationSec: 0,
                total: 1, answered: 1, unanswered: 0, correct: 0, wrong: 0, score: 3, maxScore: 5,
                percent: 60, status: 'marked',
                answers: [{ questionId: 999001, kind: 'theory', topic: 'Kinematics', given: 'v=at',
                            isCorrect: true, markAwarded: 3, maxMark: 5 }],
                xpAwarded: 12, markedBy: 'GOC-A-001', markedAt: 3000 };

(async function () {
  head('test-migrate-appwrite — phase 1: seed a local blob with known records');
  boot(false);
  await waitForBoot(30);
  await stopChild();
  // Inject known question + attempt into the seeded blob.
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  db.questions = Array.isArray(db.questions) ? db.questions : [];
  db.attempts = Array.isArray(db.attempts) ? db.attempts : [];
  db.questions.push(JSON.parse(JSON.stringify(KNOWN_Q)));
  db.attempts.push(JSON.parse(JSON.stringify(KNOWN_A)));
  fs.writeFileSync(DATA, JSON.stringify(db, null, 2));
  ok('seeded blob carries the known question + attempt', true);

  head('phase 2: boot in Appwrite mode and run the migration');
  boot(true);
  await waitForBoot(30);

  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);

  var run1 = await call('POST', '/api/admin/migrate-appwrite', {}, adm);
  ok('first migration reports ok', run1.status === 200 && run1.body && run1.body.ok === true, run1.raw);
  ok('question read/written counts reconcile', run1.body && run1.body.questions.read === run1.body.questions.written, run1.raw);
  ok('attempt read/written counts reconcile', run1.body && run1.body.attempts.read === run1.body.attempts.written, run1.raw);

  // The known question is now readable through the Appwrite-backed accessor.
  var qlist = await call('GET', '/api/questions?subject=Physics', undefined, adm);
  var found = qlist.body && (qlist.body.questions || []).some(function (q) { return Number(q.id) === 999001 && q.topic === 'Kinematics'; });
  ok('migrated question is served from Appwrite with fields intact', found, qlist.raw);

  // The known marked attempt shows up in the results view.
  var rlist = await call('GET', '/api/results?scholarId=GOC-S-MIG1', undefined, adm);
  var aFound = rlist.body && (rlist.body.results || []).some(function (a) { return a.id === 'MIGPROBE-1' && a.percent === 60; });
  ok('migrated attempt is served from Appwrite with fields intact', aFound, rlist.raw);

  head('phase 3: idempotency — a second run creates no duplicates');
  var run2 = await call('POST', '/api/admin/migrate-appwrite', {}, adm);
  ok('second migration still reports ok', run2.status === 200 && run2.body && run2.body.ok === true, run2.raw);
  var qlist2 = await call('GET', '/api/questions?subject=Physics', undefined, adm);
  var dupes = qlist2.body ? (qlist2.body.questions || []).filter(function (q) { return Number(q.id) === 999001; }).length : -1;
  ok('the known question exists exactly once after a repeat run', dupes === 1, 'count=' + dupes);

  done();
})().catch(function (e) {
  console.error(e && e.stack || e);
  fails++;
  done();
});
