/* test-tiers-switch-appwrite.js — Phase 3B, slice 3: the tier switch on an Appwrite deployment
   (against test/appwrite-stub): the tier and who/when are stored on the student document; a missing
   `tier` attribute is refused plainly; missing who/when attributes do not block the change.
   node test/test-tiers-switch-appwrite.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TIER_SW_PORT) || 8162;
var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-sw-'));
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
  stu('GOC-S-001', 'Has Goc', '2020-01-01T00:00:00.000Z', 'goc'),
  stu('GOC-S-002', 'Is Open', '2020-01-01T00:00:00.000Z', 'open')   // explicit, so the boot-time migration leaves it Open
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
  head('Appwrite: the switch stores the tier and who/when on the student document');
  await boot();
  var tok = await consoleToken();
  var a = await call('PUT', '/api/students/GOC-S-001/tier', { tier: 'open' }, tok);
  ok('restricting a GOC student works', a.status === 200 && a.body.tier === 'open', a.raw);
  ok('  the reply carries who (name) and when', a.body.tierChangedBy === 'Ernest Uzorchukwu' && Date.now() - Date.parse(a.body.tierChangedAt) < 10000, a.raw);
  var r1 = await row(tok, 'GOC-S-001');
  ok('  the roster reads it back: Open, with who and when', r1.tier === 'open' && r1.tierChangedBy === 'Ernest Uzorchukwu' && !!r1.tierChangedAt, JSON.stringify(r1));
  var b = await call('PUT', '/api/students/GOC-S-002/tier', { tier: 'goc' }, tok);
  ok('making an Open student GOC works', b.status === 200 && b.body.tier === 'goc' && b.body.tierChangedBy === 'Ernest Uzorchukwu', b.raw);
  var stamp = b.body.tierChangedAt;
  await wait(30);
  var c = await call('PUT', '/api/students/GOC-S-002/tier', { tier: 'goc' }, tok);
  ok('asking for the tier it already has records nothing new', c.status === 200 && c.body.tierChangedAt === stamp, c.raw);
  var d = await call('PUT', '/api/students/GOC-S-404/tier', { tier: 'goc' }, tok);
  ok('an unknown Scholar ID is 404', d.status === 404, d.raw);
  var e = await call('PUT', '/api/students/GOC-S-002/tier', { tier: 'platinum' }, tok);
  ok('an unknown tier is 400', e.status === 400, e.raw);
  await halt();

  head('Appwrite: the `tier` attribute is missing - refused plainly, nothing claimed');
  await boot({ STUB_FAIL_TIER: '1' });
  tok = await consoleToken();
  var f = await call('PUT', '/api/students/GOC-S-002/tier', { tier: 'goc' }, tok);
  ok('the change is refused with 503 and a message that says what to add', f.status === 503 && /"tier" attribute/.test((f.body && f.body.error) || ''), f.raw);
  await new Promise(function (r) { setTimeout(r, 200); });   /* the server's log line reaches this process a moment after the reply */
  ok('  and the log says the same', /attribute "tier"/.test(log), log.slice(-300));
  var r2 = await row(tok, 'GOC-S-002');
  ok('  the student was not changed', r2.tier === 'open' && !r2.tierChangedAt, JSON.stringify(r2));
  await halt();

  head('Appwrite: only the who/when attributes are missing - the change still happens');
  await boot({ STUB_FAIL_TIER_AUDIT: '1' });
  tok = await consoleToken();
  var g = await call('PUT', '/api/students/GOC-S-002/tier', { tier: 'goc' }, tok);
  ok('the tier changes (200) even though who/when cannot be stored', g.status === 200 && g.body.tier === 'goc', g.raw);
  ok('  the reply does not invent a name or time', g.body.tierChangedBy === null && g.body.tierChangedAt === null, g.raw);
  await new Promise(function (r) { setTimeout(r, 200); });
  ok('  the log says which attributes to add', /tierChangedBy/.test(log) && /tierChangedAt/.test(log), log.slice(-300));
  await halt();
}

main().then(function () {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tier switch (appwrite): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + log.slice(-600));
  try { if (child) child.kill(); } catch (x) {}
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (x) {}
  process.exit(1);
});
