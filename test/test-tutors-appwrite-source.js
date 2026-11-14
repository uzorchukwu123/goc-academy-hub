/* test-tutors-appwrite-source.js — audit regression: tutor figures must read
   the Appwrite question bank, not the local data.json cache.

   The defect: /api/tutor/subject counted a tutor's pending/returned questions
   from db.questions, and /api/admin/tutors/analytics derived its subject list
   from db.questions. In Appwrite mode db.questions is only a local cache that
   is EMPTY on a fresh deploy, so both came back zero/empty while the real bank
   (the Appwrite questions collection) held the tutor's rows.

   This boots the server against the in-memory Appwrite stand-in with the
   questions and the tutor seeded in Appwrite and a deliberately EMPTY local
   question cache, then asserts the tutor's status counts and the admin
   analytics subject list come from Appwrite.
   node test/test-tutors-appwrite-source.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TUTOR_AW_PORT) || 8178;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tutor-aw-'));
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
function q(id, status) {
  return { col: 'questions', data: {
    $id: String(id), legacyId: id, subject: 'Physics', topic: 'Waves', kind: 'objective',
    section: 'practice', period: 'test', text: 'Q' + id, options: ['a', 'b', 'c', 'd'],
    answer: 0, active: true, status: status, addedBy: 'GOC-T-001', addedByName: 'Phys Tutor'
  } };
}
var seed = { files: [], docs: [
  { col: 'tutors', data: { $id: 'GOC-T-001', record: JSON.stringify(tutorRec) } },
  q(101, 'live'), q(102, 'pending'), q(103, 'returned')
] };
var SEED = path.join(TMP, 'seed.json'); fs.writeFileSync(SEED, JSON.stringify(seed));

/* The local cache is deliberately EMPTY: this is the fresh-deploy state the
   bug used to read its zeros from. migrate() keeps an existing empty array. */
fs.writeFileSync(path.join(DATA_DIR, 'data.json'), JSON.stringify({
  questions: [], tutors: [], students: [], attempts: [], settings: {},
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

  /* The local cache really is empty — the premise of the regression. */
  var local = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8'));
  ok('the local question cache is empty (fresh-deploy premise)', Array.isArray(local.questions) && local.questions.length === 0, JSON.stringify(local.questions));

  var tl = await call('POST', '/api/auth/login', { id: 'GOC-T-001', password: TPW });
  ok('the tutor signs in from the Appwrite tutor record', tl.status === 200 && tl.body && tl.body.token, tl.status + ' ' + tl.raw);
  var tt = tl.body && tl.body.token;

  var subj = await call('GET', '/api/tutor/subject?subject=Physics', undefined, tt);
  ok('the subject route answers', subj.status === 200, subj.status + ' ' + subj.raw);
  var sc = (subj.body && subj.body.statusCounts) || {};
  ok('status counts come from Appwrite, not the empty cache (1 live / 1 pending / 1 returned)',
    sc.live === 1 && sc.pending === 1 && sc.returned === 1, JSON.stringify(sc));

  /* Admin analytics: the subject list must also come from Appwrite. */
  var fl = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var ft = fl.body && fl.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ft);
  var an = await call('GET', '/api/admin/tutors/analytics', undefined, ft);
  ok('admin tutor analytics answers', an.status === 200, an.status + ' ' + an.raw);
  var subjects = ((an.body && an.body.reports) || []).map(function (r) { return r.subject; });
  ok('the analytics subject list comes from Appwrite (Physics present)', subjects.indexOf('Physics') > -1, JSON.stringify(subjects));

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