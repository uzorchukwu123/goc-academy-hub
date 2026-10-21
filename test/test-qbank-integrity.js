/* test-qbank-integrity.js — Phase 10: regression tests for all question-bank
   integrity fixes and new endpoints introduced in the repair report.

   Covers:
   ✓ Defect 1 fix  — existing-ID collision is reported, not silently overwritten
   ✓ Defect 2 fix  — writeData called once after import loop (structural check)
   ✓ Defect 3 fix  — practicePool count matches studyPool() exactly (Phase 5)
   ✓ Phase 4       — bulk delete audit log, soft-delete / restore
   ✓ Phase 6       — /api/questions/jamb-integrity reports readiness + warnings
   ✓ Phase 8       — /api/questions/diagnostics detects structural problems
   ✓ Phase 9       — persistence guard stamps a warning when data.json is stale

   Run:  node test/test-qbank-integrity.js
   Or via test/run.js. No external dependencies beyond the project itself.     */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var http = require('http');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_QBANK_PORT) || 8191;

/* ── helpers ── */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 300) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json' };
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
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 300); }).then(function () { return waitForBoot(tries - 1); });
  });
}

/* ── sandbox ── */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-qbank-integrity-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var child = null;
function bootServer() {
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027',
      GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function () {});
  child.stderr.on('data', function () {});
  return waitForBoot(50);
}
function stopServer() {
  return new Promise(function (resolve) {
    if (!child) return resolve();
    child.once('exit', function () { resolve(); });
    try { child.kill(); } catch (e) { resolve(); }
  });
}
/* Re-authenticate after every restart (sessions are in-memory). */
async function auth() {
  var lr = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var t = lr.body && lr.body.token;
  if (!t) throw new Error('Login failed: ' + JSON.stringify(lr.body));
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
  return t;
}
function cleanup() {
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

var dbPath = path.join(SANDBOX, 'server', 'data.json');

/* CSV helpers */
var CSV_HEAD = 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation,active\n';
function csvRow(subject, section, text, ans, active) {
  active = active === undefined ? 'yes' : active;
  return [subject, section, 'General', '"' + text + '"', 'A', 'B', 'C', 'D', '', ans, '', '', 'medium', 'expl', active].join(',') + '\n';
}

/* Read the server source once (from sandbox so it reflects the fixes). */
var src = '';

/* ─────────────────────────────────────────────────────── */
(async function main() {
  await bootServer();
  src = fs.readFileSync(path.join(SANDBOX, 'server', 'server.js'), 'utf8');
  var tok = await auth();
  ok('server boots and auth works', !!tok);

  /* ══════════════════════════════════════════════════════
     DEFECT 1 — ID collision is reported, not silently overwritten
     ══════════════════════════════════════════════════════ */
  head('Defect 1 fix — ID collision reporting');

  /* Import a Physics question */
  var imp1 = await call('POST', '/api/questions/import', {
    csv: CSV_HEAD + csvRow('Physics', 'objective', 'What is velocity?', 'A'),
    subject: 'Physics', section: 'objective', stampSection: false
  }, tok);
  ok('first import succeeds', imp1.status === 200 && imp1.body && imp1.body.added === 1, JSON.stringify(imp1.body));
  var firstId = imp1.body && imp1.body.ids && imp1.body.ids[0];
  ok('first question got an id', typeof firstId === 'number', 'id=' + firstId);

  /* Read current seq then reset it so next import collides with firstId */
  var dbRaw = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  var savedSeq = dbRaw.settings.questionSeq;
  dbRaw.settings.questionSeq = firstId - 1;
  fs.writeFileSync(dbPath, JSON.stringify(dbRaw));

  await stopServer(); await bootServer(); tok = await auth();

  /* Import Mathematics — will collide with firstId */
  var imp2 = await call('POST', '/api/questions/import', {
    csv: CSV_HEAD + csvRow('Mathematics', 'objective', 'What is 2+2?', 'B'),
    subject: 'Mathematics', section: 'objective', stampSection: false
  }, tok);
  ok('colliding import returns 200 (no crash)', imp2.status === 200, JSON.stringify(imp2.body));
  ok('collision is reported in collisions field', imp2.body && imp2.body.collisions === 1, JSON.stringify(imp2.body));
  ok('added is 0 (nothing was saved)', imp2.body && imp2.body.added === 0, JSON.stringify(imp2.body));

  /* Original Physics question must survive untouched */
  var listR = await call('GET', '/api/questions?all=true', undefined, tok);
  var physics = (listR.body && listR.body.questions || []).find(function (q) { return q.id === firstId; });
  ok('existing Physics question was NOT overwritten', physics && physics.subject === 'Physics',
     physics ? physics.subject : 'missing');

  /* No Mathematics question should exist */
  var maths = (listR.body && listR.body.questions || []).find(function (q) { return q.subject === 'Mathematics' && /2\+2/.test(q.text); });
  ok('Mathematics question was NOT created with the collided id', !maths, maths ? JSON.stringify(maths) : 'ok');

  /* Restore sequence */
  var db2 = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  db2.settings.questionSeq = savedSeq;
  fs.writeFileSync(dbPath, JSON.stringify(db2));
  await stopServer(); await bootServer(); tok = await auth();

  /* ══════════════════════════════════════════════════════
     DEFECT 2 — writeData called once after import loop (structural check)
     ══════════════════════════════════════════════════════ */
  head('Defect 2 fix — single writeData per import');

  var importBlock = src.slice(
    src.indexOf("'/api/questions/import'"),
    src.indexOf("'/api/import/history'")
  );
  ok('writeData is not inside the import loop (structural)',
     !(/for\s*\(const rec of ri\.records\)[^}]*writeData/.test(importBlock)),
     'writeData found inside loop');

  /* Runtime: 3-row import should complete and add all 3 rows */
  var multiR = await call('POST', '/api/questions/import', {
    csv: CSV_HEAD +
      csvRow('Chemistry', 'objective', 'What is H2O?', 'A') +
      csvRow('Chemistry', 'objective', 'What is NaCl?', 'B') +
      csvRow('Chemistry', 'objective', 'What is CO2?', 'C'),
    subject: 'Chemistry', section: 'objective', stampSection: false
  }, tok);
  ok('multi-row import adds all 3 rows', multiR.status === 200 && multiR.body && multiR.body.added === 3,
     JSON.stringify(multiR.body));

  /* ══════════════════════════════════════════════════════
     DEFECT 3 / PHASE 5 — practicePool == studyPool()
     ══════════════════════════════════════════════════════ */
  head('Defect 3 fix / Phase 5 — practicePool = studyPool() count');

  /* Import English practice questions with stampSection=true so they are live */
  await call('POST', '/api/questions/import', {
    csv: CSV_HEAD +
      csvRow('English', 'practice', 'Practice English Q1', 'A', 'yes') +
      csvRow('English', 'practice', 'Practice English Q2', 'B', 'yes') +
      csvRow('English', 'practice', 'Practice inactive', 'C', 'no'),
    subject: 'English', section: 'practice', stampSection: true
  }, tok);

  var countsR = await call('GET', '/api/questions/counts', undefined, tok);
  ok('counts endpoint returns 200', countsR.status === 200, JSON.stringify(countsR.body));
  ok('counts response has practicePool field', countsR.body && 'practicePool' in countsR.body,
     JSON.stringify(countsR.body));

  /* Compare against studyPool() directly */
  var allQR = await call('GET', '/api/questions?all=true', undefined, tok);
  var localPool = core.studyPool(allQR.body && allQR.body.questions || [], null, null, []).length;
  ok('practicePool matches studyPool() exactly',
     countsR.body && countsR.body.practicePool === localPool,
     'counts=' + (countsR.body && countsR.body.practicePool) + ' studyPool()=' + localPool);

  ok('inactive question is excluded from practicePool',
     countsR.body && countsR.body.practicePool < 3,
     'pool=' + (countsR.body && countsR.body.practicePool));

  /* Structural: counts handler calls studyPool directly */
  ok('counts handler calls studyPool() directly (structural)',
     src.includes('core.studyPool(allQuestions') && src.includes('practicePool = core.studyPool'),
     'direct studyPool call not found');

  /* ══════════════════════════════════════════════════════
     PHASE 4 — bulk delete audit log
     ══════════════════════════════════════════════════════ */
  head('Phase 4 — bulk delete audit log');

  /* Import a Chemistry practice question to delete */
  await call('POST', '/api/questions/import', {
    csv: CSV_HEAD + csvRow('Chemistry', 'practice', 'Chem practice 1', 'A', 'yes'),
    subject: 'Chemistry', section: 'practice', stampSection: true
  }, tok);

  var beforeLog = await call('GET', '/api/questions/deletion-log', undefined, tok);
  ok('deletion-log endpoint returns 200', beforeLog.status === 200, JSON.stringify(beforeLog.body));
  ok('deletion-log returns log array', Array.isArray(beforeLog.body && beforeLog.body.log),
     JSON.stringify(beforeLog.body));
  var beforeCount = (beforeLog.body && beforeLog.body.log && beforeLog.body.log.length) || 0;

  var bulkDel = await call('DELETE', '/api/questions/bulk',
    { subject: 'Chemistry', section: 'practice' }, tok);
  ok('bulk delete returns 200', bulkDel.status === 200 && bulkDel.body && bulkDel.body.ok,
     JSON.stringify(bulkDel.body));

  var afterLog = await call('GET', '/api/questions/deletion-log', undefined, tok);
  var afterCount = (afterLog.body && afterLog.body.log && afterLog.body.log.length) || 0;
  ok('deletion log gains one entry', afterCount === beforeCount + 1,
     'before=' + beforeCount + ' after=' + afterCount);

  var entry = afterLog.body && afterLog.body.log && afterLog.body.log[0];
  ok('log entry: kind=hard-delete', entry && entry.kind === 'hard-delete', JSON.stringify(entry));
  ok('log entry: subject recorded', entry && entry.subject === 'Chemistry', JSON.stringify(entry));
  ok('log entry: section recorded', entry && entry.section === 'practice', JSON.stringify(entry));
  ok('log entry: by (actor) recorded', entry && typeof entry.by === 'string' && entry.by.length > 0,
     JSON.stringify(entry));
  ok('log entry: deletedIds array present', entry && Array.isArray(entry.deletedIds) && entry.deletedIds.length > 0,
     JSON.stringify(entry));
  ok('log entry: at timestamp present', entry && typeof entry.at === 'string', JSON.stringify(entry));

  /* ══════════════════════════════════════════════════════
     PHASE 4 — soft delete (archive) and restore
     ══════════════════════════════════════════════════════ */
  head('Phase 4 — soft delete (archive) and restore');

  /* Import Biology objective questions live */
  await call('POST', '/api/questions/import', {
    csv: CSV_HEAD +
      csvRow('Biology', 'objective', 'Bio archive test 1', 'A', 'yes') +
      csvRow('Biology', 'objective', 'Bio archive test 2', 'B', 'yes'),
    subject: 'Biology', section: 'objective', stampSection: true
  }, tok);

  var preLive = await call('GET', '/api/questions', undefined, tok);
  var bioCount = (preLive.body && preLive.body.questions || [])
    .filter(function (q) { return q.subject === 'Biology' && q.section === 'objective'; }).length;
  ok('biology objective questions visible before archive', bioCount > 0, 'count=' + bioCount);

  /* Soft-delete */
  var archR = await call('DELETE', '/api/questions/bulk',
    { subject: 'Biology', section: 'objective', archive: true }, tok);
  ok('archive soft-delete returns 200', archR.status === 200 && archR.body && archR.body.ok,
     JSON.stringify(archR.body));
  ok('response has archived:true', archR.body && archR.body.archived === true, JSON.stringify(archR.body));
  ok('response deleted count = bioCount', archR.body && archR.body.deleted === bioCount,
     'deleted=' + (archR.body && archR.body.deleted) + ' expected=' + bioCount);

  /* Questions invisible in normal list */
  var postArch = await call('GET', '/api/questions', undefined, tok);
  var bioAfter = (postArch.body && postArch.body.questions || [])
    .filter(function (q) { return q.subject === 'Biology' && q.section === 'objective'; }).length;
  ok('archived questions are invisible in normal list', bioAfter === 0, 'count=' + bioAfter);

  /* Deletion log records kind=archive */
  var archLog = await call('GET', '/api/questions/deletion-log', undefined, tok);
  var archEntry = archLog.body && archLog.body.log && archLog.body.log[0];
  ok('deletion log records kind=archive', archEntry && archEntry.kind === 'archive', JSON.stringify(archEntry));

  /* Diagnostics reports archivedQuestions > 0 */
  var diagArch = await call('GET', '/api/questions/diagnostics', undefined, tok);
  ok('diagnostics.archivedQuestions > 0 after soft delete',
     diagArch.body && diagArch.body.archivedQuestions > 0,
     'archived=' + (diagArch.body && diagArch.body.archivedQuestions));

  /* Restore */
  var restR = await call('POST', '/api/questions/restore',
    { subject: 'Biology', section: 'objective' }, tok);
  ok('restore returns 200', restR.status === 200 && restR.body && restR.body.ok, JSON.stringify(restR.body));
  ok('restore count matches archived count', restR.body && restR.body.restored === bioCount,
     'restored=' + (restR.body && restR.body.restored) + ' expected=' + bioCount);

  /* Questions visible again */
  var postRest = await call('GET', '/api/questions', undefined, tok);
  var bioBack = (postRest.body && postRest.body.questions || [])
    .filter(function (q) { return q.subject === 'Biology' && q.section === 'objective'; }).length;
  ok('restored questions visible again', bioBack === bioCount, 'count=' + bioBack);

  /* ══════════════════════════════════════════════════════
     PHASE 6 — JAMB integrity check
     ══════════════════════════════════════════════════════ */
  head('Phase 6 — JAMB integrity check');

  var jambR = await call('GET', '/api/questions/jamb-integrity', undefined, tok);
  ok('jamb-integrity returns 200', jambR.status === 200, JSON.stringify(jambR.body));
  ok('has ready field', jambR.body && 'ready' in jambR.body, JSON.stringify(jambR.body));
  ok('has subjects array', jambR.body && Array.isArray(jambR.body.subjects), JSON.stringify(jambR.body));
  ok('has short array', jambR.body && Array.isArray(jambR.body.short), JSON.stringify(jambR.body));
  ok('has min field', jambR.body && typeof jambR.body.min === 'number', JSON.stringify(jambR.body));
  ok('has recentDeletions array', jambR.body && Array.isArray(jambR.body.recentDeletions),
     JSON.stringify(jambR.body));

  /* With near-empty JAMB bank, ready should be false */
  ok('ready is false with empty JAMB bank', jambR.body && jambR.body.ready === false,
     'ready=' + (jambR.body && jambR.body.ready));
  ok('warning string is present when not ready', jambR.body && typeof jambR.body.warning === 'string',
     JSON.stringify(jambR.body && jambR.body.warning));

  /* Subject row structure */
  var subRow = jambR.body && jambR.body.subjects && jambR.body.subjects[0];
  ok('subject row has eligible', subRow && typeof subRow.eligible === 'number', JSON.stringify(subRow));
  ok('subject row has need', subRow && typeof subRow.need === 'number', JSON.stringify(subRow));
  ok('subject row has ok', subRow && typeof subRow.ok === 'boolean', JSON.stringify(subRow));
  ok('subject row has total, active, live',
     subRow && typeof subRow.total === 'number' && typeof subRow.active === 'number' && typeof subRow.live === 'number',
     JSON.stringify(subRow));

  /* threshold=0 → every subject is ready */
  var jambZero = await call('GET', '/api/questions/jamb-integrity?threshold=0', undefined, tok);
  ok('threshold=0 makes ready=true', jambZero.body && jambZero.body.ready === true,
     JSON.stringify(jambZero.body));
  ok('threshold=0 gives null warning', jambZero.body && jambZero.body.warning === null,
     JSON.stringify(jambZero.body));

  /* After a JAMB bulk delete, recentDeletions should appear */
  await call('POST', '/api/questions/import', {
    csv: CSV_HEAD + csvRow('Use of English', 'jamb', 'JAMB English Q1', 'A', 'yes'),
    subject: 'Use of English', section: 'jamb', stampSection: true
  }, tok);
  await call('DELETE', '/api/questions/bulk', { subject: 'Use of English', section: 'jamb' }, tok);
  var jambAfterDel = await call('GET', '/api/questions/jamb-integrity', undefined, tok);
  ok('recentDeletions lists the JAMB bulk delete',
     jambAfterDel.body && jambAfterDel.body.recentDeletions && jambAfterDel.body.recentDeletions.length > 0,
     JSON.stringify(jambAfterDel.body && jambAfterDel.body.recentDeletions));

  /* ══════════════════════════════════════════════════════
     PHASE 8 — diagnostics endpoint (clean bank)
     ══════════════════════════════════════════════════════ */
  head('Phase 8 — diagnostics endpoint');

  var diagR = await call('GET', '/api/questions/diagnostics', undefined, tok);
  ok('diagnostics returns 200', diagR.status === 200, JSON.stringify(diagR.body));
  ok('has healthy flag', diagR.body && 'healthy' in diagR.body, JSON.stringify(diagR.body));
  ok('has totalQuestions', diagR.body && typeof diagR.body.totalQuestions === 'number', JSON.stringify(diagR.body));
  ok('has archivedQuestions', diagR.body && typeof diagR.body.archivedQuestions === 'number',
     JSON.stringify(diagR.body));
  ok('has duplicateIds', diagR.body && Array.isArray(diagR.body.duplicateIds), JSON.stringify(diagR.body));
  ok('has unknownSections', diagR.body && Array.isArray(diagR.body.unknownSections), JSON.stringify(diagR.body));
  ok('has missingFields', diagR.body && Array.isArray(diagR.body.missingFields), JSON.stringify(diagR.body));
  ok('has badAnswerIndex', diagR.body && Array.isArray(diagR.body.badAnswerIndex), JSON.stringify(diagR.body));
  ok('has inactiveInPool', diagR.body && Array.isArray(diagR.body.inactiveInPool), JSON.stringify(diagR.body));
  ok('has checkedAt', diagR.body && typeof diagR.body.checkedAt === 'string', JSON.stringify(diagR.body));
  ok('clean bank: no duplicate IDs', diagR.body && diagR.body.duplicateIds.length === 0,
     JSON.stringify(diagR.body && diagR.body.duplicateIds));
  ok('clean bank: no unknown sections', diagR.body && diagR.body.unknownSections.length === 0,
     JSON.stringify(diagR.body && diagR.body.unknownSections));

  /* Inject a structurally broken question and verify detection */
  await stopServer();
  var injDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  var badId = (injDb.settings.questionSeq || 999) + 50;
  injDb.questions.push({
    id: badId, subject: '', text: '', kind: 'objective',
    section: 'unknown-xyz', options: ['A', 'B', 'C', 'D'], answer: 99, status: 'live'
  });
  fs.writeFileSync(dbPath, JSON.stringify(injDb));
  await bootServer(); tok = await auth();

  var diagBad = await call('GET', '/api/questions/diagnostics', undefined, tok);
  ok('detects unknown section', diagBad.body && diagBad.body.unknownSections.length > 0,
     JSON.stringify(diagBad.body && diagBad.body.unknownSections));
  ok('detects missing required fields (subject + text)', diagBad.body && diagBad.body.missingFields.length > 0,
     JSON.stringify(diagBad.body && diagBad.body.missingFields));
  ok('detects bad answer index (99 >= 4 options)', diagBad.body && diagBad.body.badAnswerIndex.length > 0,
     JSON.stringify(diagBad.body && diagBad.body.badAnswerIndex));
  ok('healthy is false when problems exist', diagBad.body && diagBad.body.healthy === false,
     'healthy=' + (diagBad.body && diagBad.body.healthy));

  /* Clean up injected question */
  await stopServer();
  var cleanDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  cleanDb.questions = cleanDb.questions.filter(function (q) { return q.id !== badId; });
  fs.writeFileSync(dbPath, JSON.stringify(cleanDb));
  await bootServer(); tok = await auth();

  /* ══════════════════════════════════════════════════════
     PHASE 9 — persistence guard (structural + settings stamp)
     ══════════════════════════════════════════════════════ */
  head('Phase 9 — persistence guard');

  ok('persistence guard code present',
     src.includes('_gocPersistenceGuardScheduled') && src.includes('PERSISTENCE GUARD'), 'not found');
  ok('guard stamps persistenceWarning into settings',
     src.includes('persistenceWarning') && src.includes('localMaxId') && src.includes('appwriteMaxId'),
     'fields not found');
  ok('diagnostics surfaces persistenceWarning',
     src.includes('db.settings.persistenceWarning'), 'not found in diagnostics handler');

  /* Simulate a stale-data scenario by writing persistenceWarning into settings */
  await stopServer();
  var pwDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  pwDb.settings.persistenceWarning = {
    detectedAt: new Date().toISOString(), localCount: 5, localMaxId: 10,
    appwriteCount: 200, appwriteMaxId: 300
  };
  fs.writeFileSync(dbPath, JSON.stringify(pwDb));
  await bootServer(); tok = await auth();

  var diagPW = await call('GET', '/api/questions/diagnostics', undefined, tok);
  ok('diagnostics.healthy=false when persistenceWarning set',
     diagPW.body && diagPW.body.healthy === false, 'healthy=' + (diagPW.body && diagPW.body.healthy));
  ok('diagnostics.persistenceWarning is populated',
     diagPW.body && diagPW.body.persistenceWarning && diagPW.body.persistenceWarning.localCount === 5,
     JSON.stringify(diagPW.body && diagPW.body.persistenceWarning));

  /* ══════════════════════════════════════════════════════
     IMPORT COLLISION RESPONSE FORMAT
     ══════════════════════════════════════════════════════ */
  head('Import collision response format');

  /* Clear persistenceWarning so healthy can be true again */
  await stopServer();
  var cleanPW = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  delete cleanPW.settings.persistenceWarning;
  fs.writeFileSync(dbPath, JSON.stringify(cleanPW));
  await bootServer(); tok = await auth();

  var cleanImp = await call('POST', '/api/questions/import', {
    csv: CSV_HEAD + csvRow('Mathematics', 'objective', 'What is 3+3?', 'C'),
    subject: 'Mathematics', section: 'objective', stampSection: false
  }, tok);
  ok('clean import response includes collisions field',
     cleanImp.body && 'collisions' in cleanImp.body, JSON.stringify(cleanImp.body));
  ok('clean import has collisions:0',
     cleanImp.body && cleanImp.body.collisions === 0,
     'collisions=' + (cleanImp.body && cleanImp.body.collisions));

  /* ══════════════════════════════════════════════════════
     PHASE 4 — deletion log cap (structural)
     ══════════════════════════════════════════════════════ */
  head('Phase 4 — deletion log cap');

  ok('deletion log capped at 500 (structural)',
     src.includes('deletionLog.length > 500') && src.includes('slice(-500)'), 'not found in source');

  /* ── final summary ── */
  await stopServer();
  cleanup();
  console.log('\n' + (fails === 0 ? 'ALL PASSED' : fails + ' FAILED') +
    ' — ' + passes + ' passed  ' + fails + ' failed');
  if (fails > 0) process.exit(1);
})().catch(function (err) {
  console.error('\nUnexpected error:', err);
  if (child) { try { child.kill(); } catch (e) {} }
  cleanup();
  process.exit(1);
});
