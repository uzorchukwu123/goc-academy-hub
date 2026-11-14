/* test-tutors-appwrite-students.js — regression: the tutor dashboard's at-risk
   and top-performers lists must reflect the students held in Appwrite.

   Reported defect: "the student at risk and top performers function in the tutor
   dashboard is not reflecting the students details in appwrite." Both routes
   (GET /api/tutor/atrisk, GET /api/tutor/top) read the roster through
   listAppwriteStudents() and the papers through listAttempts() when Appwrite is
   configured, but the existing route suites only ever exercised the LOCAL mode
   (they edit db.students directly), so the Appwrite path was untested.

   This boots the server against the in-memory Appwrite stand-in with the tutor,
   the students and the marked papers seeded in Appwrite and a deliberately EMPTY
   local cache (db.students / db.attempts / db.practiceRuns), then asserts:
     · at-risk lists the student with the low marked average, by name, and
       excludes the high-average students;
     · top-performers ranks the students by their Appwrite marked-paper
       average (highest first).
   If the routes ever fall back to the empty local roster, both lists come back
   empty and these checks fail.
   node test/test-tutors-appwrite-students.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TUTOR_AW_STUDENTS_PORT) || 8179;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tutor-aw-stu-'));
var DATA_DIR = path.join(TMP, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* A tutor whose password hash the server can verify (same scrypt$ shape). */
var TPW = 'tutorpass1';
var tutorRec = {
  id: 'GOC-T-001', name: 'Phys Tutor', subjects: ['Physics'],
  pwHash: 'scrypt$00$' + crypto.scryptSync(TPW, '00', 64).toString('hex'),
  active: true, mustChangePassword: false
};

var SUBS = ['Use of English', 'Physics', 'Chemistry', 'Biology'];
var NOW = Date.now();
function student(id, name, createdAt) {
  var d = {
    $id: id, scholarId: id, name: name, email: id.toLowerCase() + '@example.com',
    phone: '08000000000', exam: 'JAMB / UTME 2027', subjects: JSON.stringify(SUBS),
    active: true, xp: 0, streak: 0, goal: 'JAMB / UTME 2027',
    $createdAt: new Date(createdAt).toISOString()
  };
  return { col: 'students', data: d };
}
var attemptSeq = 0;
function attempt(scholarId, percent) {
  attemptSeq++;
  return { col: 'attempts', data: {
    $id: 'ATT-' + attemptSeq, scholarId: scholarId, studentName: '',
    period: 'test', section: 'objective', subject: 'Physics',
    startedAt: NOW - 3600000, submittedAt: NOW - 1800000,
    total: 10, answered: 10, correct: Math.round(percent / 10),
    score: percent, maxScore: 100, percent: percent, status: 'marked'
  } };
}
var seed = { files: [], docs: [
  { col: 'tutors', data: { $id: 'GOC-T-001', record: JSON.stringify(tutorRec) } },
  student('GOC-S-001', 'Gina Low', NOW - 86400000),
  student('GOC-S-002', 'Bola High', NOW - 86400000),
  student('GOC-S-003', 'Ope Strong', NOW - 86400000),
  /* Gina: two marked Physics papers at 30% -> low average (at-risk) and ranked. */
  attempt('GOC-S-001', 30), attempt('GOC-S-001', 30),
  /* Bola: two marked Physics papers at 90% -> tops the class, not at-risk. */
  attempt('GOC-S-002', 90), attempt('GOC-S-002', 90),
  /* Ope: the strongest papers of the three. */
  attempt('GOC-S-003', 95), attempt('GOC-S-003', 95)
] };
var SEED = path.join(TMP, 'seed.json'); fs.writeFileSync(SEED, JSON.stringify(seed));

/* The local cache is deliberately EMPTY: the fresh-deploy state. If the routes
   read db.students / db.attempts instead of Appwrite, both lists come back empty. */
fs.writeFileSync(path.join(DATA_DIR, 'data.json'), JSON.stringify({
  questions: [], tutors: [], students: [], attempts: [], practiceRuns: {}, settings: {},
  staff: [
    { id: 'GOC-A-001', name: 'Founder', title: 'Founder' },
    { id: 'GOC-A-002', name: 'Academic Director', title: 'Academic Director' }
  ]
}));

var child = null, log = '';
function boot() {
  log = '';
  child = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), GOC_DATA_DIR: DATA_DIR, STUB_SEED: SEED,
      APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub', APPWRITE_API_KEY: 'stubkey',
      GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027',
      NODE_OPTIONS: '-r ' + path.join(__dirname, 'appwrite-stub', 'hook.js')
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (d) { log += d; });
  child.stderr.on('data', function (d) { log += d; });
  return (async function () {
    for (var n = 0; n < 80 && log.indexOf('is running') < 0; n++) await wait(150);
    await wait(600);
  })();
}
function halt() {
  return new Promise(function (resolve) {
    if (!child) return resolve();
    child.once('exit', function () { child = null; resolve(); });
    child.kill();
  });
}
function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var data = body ? JSON.stringify(body) : null;
    var h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = 'Bearer ' + token;
    if (data) h['Content-Length'] = Buffer.byteLength(data);
    var r = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: h }, function (resp) {
      var raw = ''; resp.on('data', function (c) { raw += c; });
      resp.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: resp.statusCode, body: j, raw: raw }); });
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}

(async function main() {
  await boot();
  ok('the server starts in Appwrite-stub mode', log.indexOf('is running') > -1, log.slice(-300));

  var local = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8'));
  ok('the local roster is empty (fresh-deploy premise)', Array.isArray(local.students) && local.students.length === 0, JSON.stringify(local.students));

  var tl = await call('POST', '/api/auth/login', { id: 'GOC-T-001', password: TPW });
  ok('the tutor signs in from the Appwrite tutor record', tl.status === 200 && tl.body && tl.body.token, tl.status + ' ' + tl.raw);
  var tt = tl.body && tl.body.token;

  /* ---- at-risk ---- */
  var ar = await call('GET', '/api/tutor/atrisk?subject=Physics', undefined, tt);
  ok('the at-risk route answers', ar.status === 200, ar.status + ' ' + ar.raw);
  var arRows = (ar.body && ar.body.students) || [];
  var arIds = arRows.map(function (r) { return r.id; });
  ok('at-risk reflects the Appwrite GOC student with the low average (Gina, by name)',
    arIds.indexOf('GOC-S-001') > -1 && arRows.some(function (r) { return r.id === 'GOC-S-001' && r.name === 'Gina Low' && r.average === 30 && r.reasons.indexOf('low-average') > -1; }),
    JSON.stringify(arRows));
  ok('at-risk excludes the high-average students',
    arIds.indexOf('GOC-S-002') < 0 && arIds.indexOf('GOC-S-003') < 0, JSON.stringify(arIds));

  /* ---- top performers ---- */
  var top = await call('GET', '/api/tutor/top?subject=Physics', undefined, tt);
  ok('the top-performers route answers', top.status === 200, top.status + ' ' + top.raw);
  var tests = (top.body && top.body.tests && top.body.tests.items) || [];
  var testIds = tests.map(function (r) { return r.id; });
  ok('top-performers reflects the Appwrite students ranked by marked average (Ope 95, Bola 90, Gina 30)',
    testIds.length === 3 && testIds[0] === 'GOC-S-003' && testIds[1] === 'GOC-S-002' && testIds[2] === 'GOC-S-001' &&
    tests[0].name === 'Ope Strong' && tests[0].average === 95 && tests[1].name === 'Bola High' && tests[1].average === 90 && tests[2].name === 'Gina Low' && tests[2].average === 30,
    JSON.stringify(tests));

  await halt();
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch(async function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  console.log(log.slice(-800));
  await halt();
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e2) {}
  process.exit(1);
});
