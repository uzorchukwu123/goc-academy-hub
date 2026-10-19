/* test-tiers-cohort.js — Phase 3B, slice 3: move a whole cohort between Open and GOC
   (PUT /api/admin/cohorts/:id/tier) against the Appwrite stand-in: only the cohort's students
   change, those already on the tier are left alone and record nothing, who/when are stamped on
   each one moved, and a missing attribute is refused plainly.   node test/test-tiers-cohort.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TIER_SW_PORT) || 8163;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-co-'));
var DATA_DIR = path.join(TMP, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

function stu(id, name, created, tier) {
  var d = { $id: id, scholarId: id, name: name, email: id.toLowerCase() + '@example.com', phone: '', passwordHash: 'x', pwHash: 'x',
    exam: 'JAMB / UTME', subjects: JSON.stringify(['Use of English', 'Physics', 'Chemistry', 'Mathematics']), active: true,
    xp: 0, streak: 0, $createdAt: created };
  if (tier) d.tier = tier;
  return { col: 'students', data: d };
}
function withCohort(rec, cohort) { if (cohort) rec.data.cohort = cohort; return rec; }
var seed = { files: [], docs: [
  { col: 'cohorts', data: { $id: 'C1', cohortId: 'C1', name: 'SS3 Morning', status: 'active' } },
  { col: 'cohorts', data: { $id: 'C2', cohortId: 'C2', name: 'SS3 Evening', status: 'active' } },
  withCohort(stu('GOC-S-001', 'Already Goc', '2020-01-01T00:00:00.000Z', 'goc'), 'C1'),
  withCohort(stu('GOC-S-002', 'Open One', '2020-01-01T00:00:00.000Z', 'open'), 'C1'),
  withCohort(stu('GOC-S-003', 'Open Two', '2020-01-01T00:00:00.000Z', 'open'), 'C1'),
  stu('GOC-S-004', 'No Cohort', '2020-01-01T00:00:00.000Z', 'open'),
  withCohort(stu('GOC-S-005', 'Other Cohort', '2020-01-01T00:00:00.000Z', 'goc'), 'C2')
] };
var SEED = path.join(TMP, 'seed.json'); fs.writeFileSync(SEED, JSON.stringify(seed));

function env(extra) {
  return Object.assign({}, process.env, {
    PORT: String(PORT), GOC_DATA_DIR: DATA_DIR, STUB_SEED: SEED,
    APPWRITE_ENDPOINT: 'http://stub.invalid/v1', APPWRITE_PROJECT_ID: 'stub', APPWRITE_API_KEY: 'stubkey', GOC_SIGNUP_CODE: 'GOC-2027',
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027',
    NODE_OPTIONS: '-r ' + path.join(__dirname, 'appwrite-stub', 'hook.js')
  }, extra || {});
}
var child = null, log = '';
function boot(extra) {
  log = '';
  child = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], { env: env(extra), stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', function (d) { log += d; });
  child.stderr.on('data', function (d) { log += d; });
  return (async function () {
    for (var n = 0; n < 80 && log.indexOf('is running') < 0; n++) await wait(150);
    await wait(900);   // the tier migration runs just after the port opens
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
async function consoleToken() {
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var tok = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, tok);
  return tok;
}
async function row(tok, id) {
  var r = await call('GET', '/api/students', undefined, tok);
  return (Array.isArray(r.body) ? r.body : []).filter(function (s) { return s.id === id; })[0];
}


async function main() {
  head('Make all GOC: only that cohort, only those who are not already GOC');
  await boot();
  var tok = await consoleToken();
  var a = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'goc' }, tok);
  ok('the cohort is moved', a.status === 200 && a.body.tier === 'goc' && a.body.total === 3, a.raw);
  ok('  two changed, one was already GOC, none failed', a.body.changed === 2 && a.body.unchanged === 1 && a.body.failed.length === 0, a.raw);
  var s1 = await row(tok, 'GOC-S-001'), s2 = await row(tok, 'GOC-S-002'), s3 = await row(tok, 'GOC-S-003'), s4 = await row(tok, 'GOC-S-004'), s5 = await row(tok, 'GOC-S-005');
  ok('  both Open students are now GOC, stamped with the staff name and a time',
     s2.tier === 'goc' && s3.tier === 'goc' && s2.tierChangedBy === 'Ernest Uzorchukwu' && s3.tierChangedBy === 'Ernest Uzorchukwu' && !!s2.tierChangedAt, JSON.stringify([s2, s3]));
  ok('  the one already GOC was not touched, so no note was invented for them', s1.tier === 'goc' && !s1.tierChangedAt, JSON.stringify(s1));
  ok('  a student with no cohort and a student in another cohort are untouched', s4.tier === 'open' && s5.tier === 'goc' && !s4.tierChangedAt && !s5.tierChangedAt);
  var again = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'goc' }, tok);
  ok('doing it again changes nothing', again.status === 200 && again.body.changed === 0 && again.body.unchanged === 3, again.raw);

  head('Restrict all to Open');
  var b = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'open' }, tok);
  ok('all three are moved to Open', b.status === 200 && b.body.changed === 3 && b.body.unchanged === 0, b.raw);
  var o5 = await row(tok, 'GOC-S-005'), o1 = await row(tok, 'GOC-S-001');
  ok('  the other cohort is still GOC', o5.tier === 'goc');
  ok('  the first student is now Open and carries the new note', o1.tier === 'open' && o1.tierChangedBy === 'Ernest Uzorchukwu' && !!o1.tierChangedAt, JSON.stringify(o1));

  head('refusals');
  var c = await call('PUT', '/api/admin/cohorts/NOPE/tier', { tier: 'goc' }, tok);
  ok('an unknown cohort is 404', c.status === 404, c.raw);
  var d = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'platinum' }, tok);
  ok('an unknown tier is 400', d.status === 400, d.raw);
  var e = await call('PUT', '/api/admin/cohorts/C1/tier', {}, tok);
  ok('no tier named is 400', e.status === 400, e.raw);
  var f = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'goc' });
  ok('no session is refused', f.status === 401 || f.status === 403, f.status);
  var g = await call('POST', '/api/students', { signupCode: 'GOC-2027', name: 'Plain Student', password: 'secret123', email: 'p@example.com', phone: '08000000077', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  var st = g.body && g.body.token;
  var h = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'goc' }, st);
  ok('a student cannot move a cohort', h.status === 401 || h.status === 403, h.status + ' ' + h.raw);
  await halt();

  head('the `tier` attribute is missing: refused once, nobody half-changed');
  await boot({ STUB_FAIL_TIER: '1' });
  tok = await consoleToken();
  var i = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'goc' }, tok);
  ok('503 with a message that says what to add', i.status === 503 && /"tier" attribute/.test((i.body && i.body.error) || ''), i.raw);
  var r2 = await row(tok, 'GOC-S-002');
  ok('  nobody was changed', r2.tier === 'open' && !r2.tierChangedAt, JSON.stringify(r2));
  await halt();

  head('only the who/when attributes are missing: the tiers still change');
  await boot({ STUB_FAIL_TIER_AUDIT: '1' });
  tok = await consoleToken();
  var j = await call('PUT', '/api/admin/cohorts/C1/tier', { tier: 'goc' }, tok);
  ok('the two Open students are moved (the third was already GOC; the stand-in re-reads its seed each boot)', j.status === 200 && j.body.changed === 2 && j.body.unchanged === 1 && j.body.failed.length === 0, j.raw);
  var r3 = await row(tok, 'GOC-S-002');
  ok('  no name or time is invented', r3.tier === 'goc' && r3.tierChangedBy === null && r3.tierChangedAt === null, JSON.stringify(r3));
  ok('  the log says which attributes to add', /tierChangedBy/.test(log) && /tierChangedAt/.test(log), log.slice(-300));
  await halt();
}

main().then(function () {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tier cohort switch (appwrite): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + log.slice(-600));
  try { if (child) child.kill(); } catch (x) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) {}
  process.exit(1);
});
