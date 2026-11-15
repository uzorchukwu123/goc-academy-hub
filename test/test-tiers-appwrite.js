/* test-tiers-appwrite.js — Phase 3B, access tiers slice 2 (part 1): the
   one-time tier migration for Appwrite deployments, against the in-memory
   stand-in (test/appwrite-stub).
     - students already stored become GOC, once
     - a student stored as open stays open
     - a student created after the migration's cutoff is NEVER promoted,
       even if the migration could not finish the first time
     - if the optional `tier` attribute is missing the migration stops with a
       clear message, sets no finished marker, and succeeds on a later boot
   node test/test-tiers-appwrite.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TIER_AW_PORT) || 8155;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-aw-'));
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
var seed = { files: [], docs: [
  stu('GOC-S-001', 'Old Legacy', '2020-01-01T00:00:00.000Z'),
  stu('GOC-S-002', 'Old Open', '2020-01-01T00:00:00.000Z', 'open'),
  stu('GOC-S-003', 'Future Signup', '2099-01-01T00:00:00.000Z')
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
    // the migration runs just after the port opens; give it a moment to finish
    await wait(900);
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
async function roster() {
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var tok = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, tok);
  var r = await call('GET', '/api/students', undefined, tok);
  var by = {}; (Array.isArray(r.body) ? r.body : []).forEach(function (s) { by[s.id] = s.tier; });
  return by;
}
function settings() { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8')).settings; }

async function main() {
  head('first boot: the `tier` attribute is missing (the update is refused)');
  await boot({ STUB_FAIL_TIER: '1' });
  ok('the server still starts', log.indexOf('is running') > -1, log.slice(-300));
  ok('the log says what to add', /attribute "tier"/.test(log) && /students collection/.test(log), log.slice(-400));
  var st = settings();
  ok('a cutoff time is recorded', !!st.tierCutoff && !isNaN(Date.parse(st.tierCutoff)), st.tierCutoff);
  ok('NO finished marker is set (it will try again)', !st.tierAppwriteMigrated);
  var r1 = await roster();
  ok('until it finishes, nobody is promoted (all read as open)', r1['GOC-S-001'] === 'open' && r1['GOC-S-003'] === 'open', JSON.stringify(r1));
  await halt();

  head('second boot: the attribute exists, so the migration completes');
  await boot();
  var r2 = await roster();
  ok('the student already on file is now GOC', r2['GOC-S-001'] === 'goc', JSON.stringify(r2));
  ok('a student stored as open stays open', r2['GOC-S-002'] === 'open', JSON.stringify(r2));
  ok('a student created after the cutoff is NOT promoted', r2['GOC-S-003'] === 'open', JSON.stringify(r2));
  ok('the log reports how many were promoted', /1 existing student\(s\) set to GOC/.test(log), log.slice(-300));
  var st2 = settings();
  ok('the finished marker is now set', !!st2.tierAppwriteMigrated);
  ok('the cutoff from the first boot was kept, not reset', st2.tierCutoff === st.tierCutoff);
  await halt();

  head('third boot: it does not run again');
  await boot();
  ok('no migration message the third time', !/Tier migration/.test(log), log.slice(-300));
  /* The stand-in forgets its data between boots (it re-reads the seed), so the
     promoted student reads as open again here; only the marker is meaningful. */
  ok('the finished marker is unchanged', settings().tierAppwriteMigrated === st2.tierAppwriteMigrated);
  var r3 = await roster();
  ok('nobody new was promoted by the third boot', r3['GOC-S-002'] === 'open' && r3['GOC-S-003'] === 'open', JSON.stringify(r3));
  await halt();
}

main().then(function () {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (appwrite migration): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + log.slice(-600));
  try { if (child) child.kill(); } catch (x) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) {}
  process.exit(1);
});
