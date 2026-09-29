/* test-clear-hardening.js — the clear/restore/purge safeguards: Founder-only, no lost
   updates, a delete failing halfway, a restore rolling back, a real date range,
   the slim archive and the backup warning. Real server over HTTP; the fault
   checks need GOC_CLEAR_MODE=stub (see test-clear-hardening-appwrite.js).
   node test/test-clear-hardening.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
var PORT = Number(process.env.GOC_TEST_PORT) || 8153;
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-harden-test-'));
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
var FAULT = path.join(SANDBOX, 'fault.json');
function setFault(o) { fs.writeFileSync(FAULT, JSON.stringify(o || {})); }
setFault({});
var envx = {
  STUB_FAULT_FILE: FAULT,
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


function slimBlob() { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8')); }
async function register(name, email, phone) {
  var r = await call('POST', '/api/students', { signupCode: SIGNUP, name: name, password: 'secret123',
    email: email, phone: phone, goal: 'JAMB / UTME 2027',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  return { token: r.body.token, id: r.body.student.id };
}

waitForBoot(20).then(async function () {
  head('set-up: two students, a Founder session and an Academic Director session');
  var s1 = await register('Hard One', 'h1@example.com', '08000000081');
  var s2 = await register('Hard Two', 'h2@example.com', '08000000082');
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var founder = lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, founder);
  var lin2 = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  var director = lin2.body.token;
  var unl = await call('POST', '/api/auth/unlock', { passcode: '2027' }, director);
  ok('the Academic Director can log in and unlock the console', lin2.status === 200 && unl.status === 200, lin2.status + ' ' + unl.status);

  var a1 = await sit(s1.token, 'objective'), a2 = await sit(s1.token, 'jamb'), a3 = await sit(s2.token, 'objective');
  ok('three attempts submitted', [a1, a2, a3].every(function (x) { return x.sub && x.sub.status === 200; }));
  var all = await call('GET', '/api/results', undefined, founder);
  var mine = all.body.results.filter(function (a) { return a.scholarId === s1.id; });
  var oId = mine.filter(function (a) { return a.section === 'objective'; })[0].id;
  var jId = mine.filter(function (a) { return a.section === 'jamb'; })[0].id;
  var tId = all.body.results.filter(function (a) { return a.scholarId === s2.id; })[0].id;

  head('only the Founder can clear, restore or purge');
  var dClear = await call('POST', '/api/results/clear', { ids: [oId], confirm: true }, director);
  ok('the Academic Director is refused a clear (403)', dClear.status === 403, dClear.status + ' ' + dClear.raw);
  ok('and is told why', /Founder/.test(dClear.raw), dClear.raw);
  var dDry = await call('POST', '/api/results/clear', { ids: [oId], dryRun: true }, director);
  ok('not even a preview is available to the Director', dDry.status === 403, dDry.status);
  var dPurge = await call('POST', '/api/cleared-attempts/purge', { olderThanDays: 0, confirm: true }, director);
  ok('the Director is refused a purge', dPurge.status === 403, dPurge.status);
  var dRestore = await call('POST', '/api/cleared-attempts/C1-abc/restore', {}, director);
  ok('the Director is refused a restore', dRestore.status === 403, dRestore.status);
  var dList = await call('GET', '/api/cleared-attempts', undefined, director);
  ok('the Director can still read the archive list', dList.status === 200, dList.status);
  var still = await call('GET', '/api/results', undefined, founder);
  ok('nothing was cleared by any of that', still.body.results.length === 3);

  head('a real date range matches exactly the attempts inside it');
  var full = await call('GET', '/api/results?scholarId=' + s1.id, undefined, founder);
  var tObj = full.body.results.filter(function (a) { return a.id === oId; })[0].submittedAt;
  var tJmb = full.body.results.filter(function (a) { return a.id === jId; })[0].submittedAt;
  var lo = Math.min(tObj, tJmb), hi = Math.max(tObj, tJmb);
  var inRange = await call('GET', '/api/results?scholarId=' + s1.id + '&from=' + (lo - 1) + '&to=' + (hi + 1), undefined, founder);
  ok('a range around both returns both', inRange.body.results.length === 2, inRange.raw.slice(0, 160));
  var future = await call('GET', '/api/results?from=' + (hi + 60000), undefined, founder);
  ok('a range after everything returns none', future.body.results.length === 0);
  var past = await call('GET', '/api/results?to=' + (lo - 60000), undefined, founder);
  ok('a range before everything returns none', past.body.results.length === 0);
  var cutAt = await call('GET', '/api/results?scholarId=' + s1.id + '&from=' + hi + '&to=' + hi, undefined, founder);
  var expectedAtEdge = tObj === tJmb ? 2 : 1;
  ok('the bounds are inclusive (a range of exactly one instant)', cutAt.body.results.length === expectedAtEdge, cutAt.body.results.length);
  var dryRange = await call('POST', '/api/results/clear',
    { filter: { scholarId: s1.id, from: lo - 1, to: hi + 1 }, dryRun: true }, founder);
  ok('the clear preview agrees with the list', dryRange.status === 200 && dryRange.body.count === 2, dryRange.raw.slice(0, 200));
  var dryMiss = await call('POST', '/api/results/clear',
    { filter: { scholarId: s1.id, to: lo - 60000 }, dryRun: true }, founder);
  ok('and matches nothing outside the range', dryMiss.body.count === 0, dryMiss.raw.slice(0, 200));

  head('the archive is slim');
  var xp0 = await xpOf(s2.token);
  var c1 = await call('POST', '/api/results/clear', { ids: [tId], confirm: true, reason: 'slim check' }, founder);
  ok('the Founder can clear', c1.status === 200 && c1.body.cleared === 1, c1.raw.slice(0, 200));
  ok('the reply says whether the archive backup is safe',
     ['saved', 'failed', 'not-configured'].indexOf(c1.body.archiveBackup) > -1, c1.body.archiveBackup);
  ok(STUB ? 'in Appwrite mode the backup upload is confirmed' : 'with no Appwrite it says not-configured',
     c1.body.archiveBackup === (STUB ? 'saved' : 'not-configured'), c1.body.archiveBackup);
  var blob = slimBlob();
  var ent = blob.clearedAttempts[blob.clearedAttempts.length - 1];
  ok('the archived attempt keeps its score and date', ent.attempt.score !== undefined && ent.attempt.submittedAt > 1e12);
  ok('but not the answers or the question list', ent.attempt.answers.length === 0 && ent.attempt.questionIds.length === 0 && ent.attempt.slim === true);
  var listA = await call('GET', '/api/cleared-attempts', undefined, founder);
  ok('the list reports the archive size', listA.body.archive && listA.body.archive.count === 1 && listA.body.archive.bytes > 0 && listA.body.archive.warn === false, JSON.stringify(listA.body.archive));
  var rest = await call('POST', '/api/cleared-attempts/' + ent.archiveId + '/restore', {}, founder);
  ok('the slim entry restores', rest.status === 200, rest.raw);
  ok('and the XP comes back', (await xpOf(s2.token)) === xp0, xp0);

  head('purge — deliberate, previewed, Founder-only');
  var pNone = await call('POST', '/api/cleared-attempts/purge', {}, founder);
  ok('a purge with no choice is refused', pNone.status === 400, pNone.status);
  var pDry = await call('POST', '/api/cleared-attempts/purge', { olderThanDays: 0, dryRun: true }, founder);
  ok('the preview counts the restored entry', pDry.status === 200 && pDry.body.count === 1, pDry.raw);
  var pNoConfirm = await call('POST', '/api/cleared-attempts/purge', { olderThanDays: 0 }, founder);
  ok('a real purge needs confirm', pNoConfirm.status === 400, pNoConfirm.status);
  var c2 = await call('POST', '/api/results/clear', { ids: [oId], confirm: true }, founder);
  ok('a fresh, unrestored entry now exists', c2.body.cleared === 1);
  var pKeep = await call('POST', '/api/cleared-attempts/purge', { olderThanDays: 0, confirm: true }, founder);
  ok('an age-based purge removes only the restored entry', pKeep.body.purged === 1 && pKeep.body.archive.count === 1, pKeep.raw);
  var pOld = await call('POST', '/api/cleared-attempts/purge', { olderThanDays: 30, includeUnrestored: true, confirm: true }, founder);
  ok('nothing younger than the age is purged', pOld.body.purged === 0, pOld.raw);
  var arch2 = await call('GET', '/api/cleared-attempts', undefined, founder);
  var keepId = arch2.body.cleared[0].archiveId;
  var pNamed = await call('POST', '/api/cleared-attempts/purge', { archiveIds: [keepId], confirm: true }, founder);
  ok('an entry can be purged by name', pNamed.body.purged === 1 && pNamed.body.archive.count === 0, pNamed.raw);
  var gone = await call('POST', '/api/cleared-attempts/' + keepId + '/restore', {}, founder);
  ok('a purged entry can no longer be restored', gone.status === 404, gone.status);
  await call('POST', '/api/results/clear', { ids: [], filter: { scholarId: s1.id }, confirm: true }, founder); // leaves s1 clean for the next block
  var backOn = await sit(s1.token, 'objective');
  ok('set-up for the fault checks: s1 sits once more', backOn.sub && backOn.sub.status === 200);

  if (!STUB) {
    head('fault checks need Appwrite mode');
    console.log('  (skipped here — run test-clear-hardening-appwrite.js)');
    console.log('\n' + passes + ' passed, ' + fails + ' failed');
    stop(); process.exit(fails ? 1 : 0);
  }

  /* ---------------------------------------------------------------- faults */
  var cur = await call('GET', '/api/results', undefined, founder);
  var ids3 = cur.body.results.map(function (a) { return a.id; });
  var scholarOf = {}; cur.body.results.forEach(function (a) { scholarOf[a.id] = a.scholarId; });

  head('a delete that fails halfway leaves a consistent state');
  var pair = await sit(s1.token, 'jamb');
  var s2b = await sit(s2.token, 'objective');
  var cur2 = await call('GET', '/api/results', undefined, founder);
  var three = cur2.body.results.slice(0, 3).map(function (a) { return a.id; });
  var doomedId = three[1];
  var xpBeforeAll = {};
  for (var st of [s1, s2]) xpBeforeAll[st.id] = await xpOf(st.token);
  setFault({ failDeleteIds: [doomedId] });
  var half = await call('POST', '/api/results/clear', { ids: three, confirm: true }, founder);
  setFault({});
  ok('the request still answers 200 with a partial result', half.status === 200, half.status + ' ' + half.raw.slice(0, 200));
  ok('two attempts cleared, one reported failed', half.body.cleared === 2 && half.body.failed.length === 1 && half.body.failed[0].id === doomedId, half.raw.slice(0, 300));
  var afterHalf = await call('GET', '/api/results', undefined, founder);
  ok('the attempt that could not be deleted is still on the record', afterHalf.body.results.some(function (a) { return a.id === doomedId; }));
  ok('the other two are gone', afterHalf.body.results.filter(function (a) { return three.indexOf(a.id) > -1; }).length === 1);
  var archHalf = await call('GET', '/api/cleared-attempts', undefined, founder);
  var archIds = archHalf.body.cleared.map(function (c) { return c.attempt.id; });
  ok('the failed one has no archive entry (nothing to restore that still exists)', archIds.indexOf(doomedId) === -1, archIds.join(','));
  ok('the two that were deleted are archived', three.filter(function (i) { return i !== doomedId; }).every(function (i) { return archIds.indexOf(i) > -1; }));
  var xpDelta = 0;
  for (var st2 of [s1, s2]) xpDelta += xpBeforeAll[st2.id] - (await xpOf(st2.token));
  ok('XP was taken back only for the two that were deleted', xpDelta === half.body.xpRemoved, xpDelta + ' vs ' + half.body.xpRemoved);
  var again = await call('POST', '/api/results/clear', { ids: [doomedId], confirm: true }, founder);
  ok('the failed one can simply be cleared again once Appwrite recovers', again.body.cleared === 1, again.raw.slice(0, 200));

  head('a restore that fails rolls back completely');
  var arch3 = await call('GET', '/api/cleared-attempts', undefined, founder);
  var target = arch3.body.cleared.filter(function (c) { return !c.restoredAt && c.xpRemoved > 0; })[0];
  ok('there is an unrestored entry that took XP back', !!target, JSON.stringify(arch3.body.cleared.map(function (c) { return c.xpRemoved; })));
  var owner = [s1, s2].filter(function (x) { return x.id === target.attempt.scholarId; })[0];
  var need = await call('GET', '/api/results?scholarId=' + owner.id + '&section=' + target.attempt.section, undefined, founder);
  for (var r0 of need.body.results.filter(function (a) { return a.subject === target.attempt.subject; })) {
    await call('POST', '/api/results/clear', { ids: [r0.id], confirm: true }, founder);   // make room so the one-sit rule doesn't block
  }
  var xpPre = await xpOf(owner.token);
  setFault({ failStudentUpdate: true });
  var bad = await call('POST', '/api/cleared-attempts/' + target.archiveId + '/restore', {}, founder);
  setFault({});
  ok('the restore reports failure (500) and says nothing changed', bad.status === 500 && /Nothing was changed/.test(bad.raw), bad.status + ' ' + bad.raw);
  var chk = await call('GET', '/api/results/' + encodeURIComponent(target.attempt.id), undefined, founder);
  ok('the attempt was not left behind half-restored', chk.status === 404, chk.status);
  ok('the student\'s XP is unchanged', (await xpOf(owner.token)) === xpPre);
  var arch4 = await call('GET', '/api/cleared-attempts', undefined, founder);
  ok('the entry is still marked unrestored', !arch4.body.cleared.filter(function (c) { return c.archiveId === target.archiveId; })[0].restoredAt);
  var good = await call('POST', '/api/cleared-attempts/' + target.archiveId + '/restore', {}, founder);
  ok('and it restores normally once the fault is gone', good.status === 200, good.status + ' ' + good.raw);
  ok('with its XP returned', (await xpOf(owner.token)) === xpPre + target.xpRemoved);

  head('the backup warning: a failed Appwrite upload is reported');
  var ex = await sit(s2.token, 'jamb');
  var exId = (await call('GET', '/api/results?scholarId=' + s2.id + '&section=jamb', undefined, founder)).body.results[0].id;
  setFault({ failBlobUpload: true });
  var noBackup = await call('POST', '/api/results/clear', { ids: [exId], confirm: true }, founder);
  setFault({});
  ok('the clear itself succeeds', noBackup.status === 200 && noBackup.body.cleared === 1, noBackup.raw.slice(0, 200));
  ok('but the reply says the backup upload FAILED', noBackup.body.archiveBackup === 'failed', noBackup.body.archiveBackup);
  var okAgain = await call('POST', '/api/cleared-attempts/' + noBackup.body.items[0].archiveId + '/restore', {}, founder);
  ok('(restore, to leave the data tidy)', okAgain.status === 200, okAgain.status);

  head('nothing written during a slow clear is lost');
  var s3 = await register('Hard Three', 'h3@example.com', '08000000083');
  var sitS = await sit(s3.token, 'objective');
  var slowId = (await call('GET', '/api/results?scholarId=' + s3.id, undefined, founder)).body.results[0].id;
  var seqBefore = slimBlob().settings.attemptSeq || 0;
  setFault({ delayDeleteMs: 500 });
  var slowClear = call('POST', '/api/results/clear', { ids: [slowId], confirm: true }, founder);
  await new Promise(function (r) { setTimeout(r, 120); });                 // the clear is now waiting on Appwrite
  var started = await call('POST', '/api/me/tests/start', { period: 'weekly', section: 'jamb' }, s3.token);
  var cleared = await slowClear;
  setFault({});
  ok('the clear finished', cleared.status === 200 && cleared.body.cleared === 1, cleared.raw.slice(0, 160));
  ok('a test started during the clear was answered', started.status === 200, started.status + ' ' + started.raw.slice(0, 120));
  ok('and the counter it advanced is still in the data file',
     (slimBlob().settings.attemptSeq || 0) >= seqBefore + 1, seqBefore + ' -> ' + (slimBlob().settings.attemptSeq || 0));
  var blobNow = slimBlob();
  ok('the clear\'s own archive entry is in the data file too',
     blobNow.clearedAttempts.some(function (e) { return e.attempt.id === slowId; }));

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  stop();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('\nTEST RUN FAILED: ' + (e && e.stack || e));
  if (serverLog) console.log('--- server output ---\n' + serverLog);
  stop();
  process.exit(1);
});
