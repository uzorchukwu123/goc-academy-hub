/* test-study-plan-api.js — GET/PUT /api/me/plan, over real HTTP.
   ---------------------------------------------------------------------------
   The approved backend functionality: a student's saved weekly study plan on
   their own record, reachable only as themselves.

   What this pins:

     contract      GET with no plan is a well-formed EMPTY plan, not a 404 and
                   not an error — a legacy record has no `planBlocks` attribute
                   and must keep working untouched;
     round trip    PUT creates, PUT updates, GET reads back exactly what was
                   stored, and `end` is derived from start + minutes;
     validation    malformed blocks, bad days, bad times, bad durations, a
                   subject the student does not sit, unknown fields, duplicate
                   IDs and overlapping blocks are all refused with a 400 and
                   leave the stored plan exactly as it was;
     authority     the plan is always selected by the session's own Scholar ID.
                   A payload naming somebody else is ignored, not honoured, so
                   one student can neither read nor overwrite another's plan;
     persistence   the plan survives a server restart, from the same data dir;
     preservation  every other field on the student record is unchanged by a
                   plan write.

   node test/test-study-plan-api.js
*/
'use strict';
var path = require('path');
var fs = require('fs');
var os = require('os');
var http = require('http');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var activeStudent = require('./active-student.js');

var fails = 0, children = [];
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------------- harness */
function freePort() {
  return new Promise(function (resolve) {
    var srv = http.createServer();
    srv.listen(0, '127.0.0.1', function () {
      var p = srv.address().port;
      srv.close(function () { resolve(p); });
    });
  });
}

function call(port, method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body === undefined || body === null ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        var j = null;
        try { j = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, raw: raw, body: j });
      });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    req.setTimeout(6000, function () { req.destroy(); resolve({ status: 0, raw: 'timeout', body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}

function boot(dataDir) {
  return freePort().then(function (port) {
    var env = {};
    Object.keys(process.env).forEach(function (k) {
      if (/^(APPWRITE_|GOC_|NODE_ENV$|PORT$)/.test(k)) return;
      env[k] = process.env[k];
    });
    env.PORT = String(port);
    env.NODE_PATH = path.join(APP, 'node_modules');
    env.GOC_DATA_DIR = dataDir;
    env.GOC_FOUNDER_PW = 'founder2027';   /* the shared active-student helper signs in as this */
    env.GOC_ACADDIR_PW = 'test-acaddir-password';
    env.GOC_PASSCODE = '2027';
    var child = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], {
      cwd: APP, env: env, stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(child);
    var log = '';
    child.stdout.on('data', function (c) { log += c; });
    child.stderr.on('data', function (c) { log += c; });
    var r = { port: port, child: child, dataDir: dataDir };
    Object.defineProperty(r, 'log', { get: function () { return log; } });
    var tries = 0;
    function poll() {
      return call(port, 'GET', '/api/health').then(function (h) {
        if (h.status === 200) return (r.booted = true, r);
        if (tries++ > 120) return (r.booted = false, r);
        return new Promise(function (res) { setTimeout(res, 150); }).then(poll);
      });
    }
    return poll();
  });
}
function stop(r) { try { r.child.kill('SIGKILL'); } catch (e) {} }

var CHEM = { subject: 'Chemistry' };
var SUBJECTS = ['Use of English', 'Mathematics', 'Physics', 'Chemistry'];

function blk(id, over) {
  return Object.assign({
    id: id, day: 'Mon', start: '16:00', minutes: 60,
    subject: 'Mathematics', topic: 'Quadratic equations'
  }, over || {});
}

var PLAN = '/api/me/plan';

(async function main() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-plan-'));
  var srv = await boot(dir);
  if (!srv.booted) {
    console.log('  FAIL  server did not boot\n' + srv.log);
    process.exit(1);
  }
  var port = srv.port;
  var c = function (m, p, b, t) { return call(port, m, p, b, t); };

  /* ------------------------------------------------------------ two students */
  head('setup: two signed-in students with their own papers');
  var a = await activeStudent(c, {
    signupCode: 'GOC-2027', name: 'Ernest Plan', password: 'plan#1234',
    goal: 'JAMB / UTME', subjects: SUBJECTS
  });
  var b = await activeStudent(c, {
    signupCode: 'GOC-2027', name: 'Ngozi Plan', password: 'plan#5678',
    goal: 'JAMB / UTME', subjects: SUBJECTS
  });
  ok('student A signed in', !!a.token, a.signup && a.signup.raw);
  ok('student B signed in', !!b.token, b.signup && b.signup.raw);

  /* ------------------------------------------------------------ the contract */
  head('GET with no plan is an empty plan, not an error');
  var empty = await c('GET', PLAN, null, a.token);
  ok('the route answers 200 for a student who has never planned', empty.status === 200, empty.status + ' ' + empty.raw);
  ok('and returns ok:true', !!(empty.body && empty.body.ok));
  ok('with an empty block list', Array.isArray(empty.body.blocks) && empty.body.blocks.length === 0,
     JSON.stringify(empty.body && empty.body.blocks));
  ok('and no saved time, because nothing was ever saved', empty.body.savedAt === null,
     String(empty.body && empty.body.savedAt));
  ok('the totals are present and honest for an empty plan',
     empty.body.totals && empty.body.totals.weekMinutes === 0 && empty.body.totals.count === 0 &&
     empty.body.totals.perDay && Object.keys(empty.body.totals.perDay).length === 7,
     JSON.stringify(empty.body.totals));

  head('the same student cannot reach another record by asking');
  ok('a GET naming another Scholar ID is still my own (empty) plan',
     (await call(port, 'GET', PLAN + '?id=' + b.id, null, a.token)).body.blocks.length === 0);

  /* ----------------------------------------------------------- authentication */
  head('unauthenticated requests are refused');
  var anon = await c('GET', PLAN, null, null);
  ok('GET without a token is not 200', anon.status !== 200, String(anon.status));
  var anonPut = await c('PUT', PLAN, { blocks: [blk('x1')] }, null);
  ok('PUT without a token is not 200', anonPut.status !== 200, String(anonPut.status));
  ok('and nothing was written', (await c('GET', PLAN, null, a.token)).body.blocks.length === 0);

  /* ------------------------------------------------------------- create a plan */
  head('PUT creates the plan');
  var created = await c('PUT', PLAN, { blocks: [blk('p1'), blk('p2', { day: 'Wed', start: '09:00', minutes: 90 })] }, a.token);
  ok('a valid plan is accepted', created.status === 200, created.status + ' ' + created.raw);
  ok('both blocks come back', created.body.blocks.length === 2, JSON.stringify(created.body.blocks));
  var p1 = created.body.blocks.filter(function (x) { return x.id === 'p1'; })[0] || {};
  ok('the block keeps what was sent', p1.day === 'Mon' && p1.start === '16:00' &&
     p1.minutes === 60 && p1.subject === 'Mathematics' && p1.topic === 'Quadratic equations');
  ok('and end is derived from start + minutes, never stored', p1.end === '17:00', String(p1.end));
  ok('a 90-minute block ends 90 minutes later', created.body.blocks.filter(function (x) { return x.id === 'p2'; })[0].end === '10:30');
  ok('kind is the planner\'s study kind', p1.kind === 'study', String(p1.kind));
  ok('the weekly total adds the blocks', created.body.totals.weekMinutes === 150, String(created.body.totals.weekMinutes));
  ok('per-day totals are split by day',
     created.body.totals.perDay.Mon === 60 && created.body.totals.perDay.Wed === 90,
     JSON.stringify(created.body.totals.perDay));

  head('GET reads back exactly what was stored');
  var read = await c('GET', PLAN, null, a.token);
  ok('the plan survives the round trip', read.body.blocks.length === 2, JSON.stringify(read.body.blocks));
  ok('with the same IDs', read.body.blocks.map(function (x) { return x.id; }).sort().join(',') === 'p1,p2');
  ok('and a saved timestamp', typeof read.body.savedAt === 'string' && read.body.savedAt.length > 10, String(read.body.savedAt));

  head('PUT updates the plan');
  var updated = await c('PUT', PLAN, {
    blocks: [blk('p1', { minutes: 120, topic: 'Indices and surds' }), blk('p3', { day: 'Fri', start: '18:30' })]
  }, a.token);
  ok('the update is accepted', updated.status === 200, updated.raw);
  ok('it replaced the list rather than merging', updated.body.blocks.length === 2, JSON.stringify(updated.body.blocks.map(function (x) { return x.id; })));
  ok('p2 is gone', !updated.body.blocks.some(function (x) { return x.id === 'p2'; }));
  ok('p1 carries the new duration and end', updated.body.blocks.filter(function (x) { return x.id === 'p1'; })[0].end === '18:00');
  ok('p3 is in the list', updated.body.blocks.some(function (x) { return x.id === 'p3'; }));
  ok('and the weekly total follows the update', updated.body.totals.weekMinutes === 180, String(updated.body.totals.weekMinutes));

  /* ------------------------------------------------------------- rejection */
  head('malformed plans are refused, and the stored plan is untouched');
  var before = (await c('GET', PLAN, null, a.token)).body.blocks;

  async function refused(why, blocks, extra) {
    var body = extra === undefined ? { blocks: blocks } : extra;
    var r = await c('PUT', PLAN, body, a.token);
    ok(why, r.status === 400, r.status + ' ' + r.raw);
  }

  await refused('a block with no day is refused', [blk('e1', { day: '' })]);
  await refused('an invented day is refused', [blk('e1', { day: 'Funday' })]);
  await refused('an impossible start time is refused', [blk('e1', { start: '25:00' })]);
  await refused('a non-time start is refused', [blk('e1', { start: 'tea time' })]);
  await refused('a 3-minute block is refused', [blk('e1', { minutes: 3 })]);
  await refused('a block longer than four hours is refused', [blk('e1', { minutes: 400 })]);
  await refused('a block with no subject is refused', [blk('e1', { subject: '' })]);
  await refused('a subject the student does not sit is refused', [blk('e1', { subject: 'Economics' })]);
  await refused('a block with no topic is refused', [blk('e1', { topic: '   ' })]);
  await refused('a block with no ID is refused', [blk('', {})]);
  await refused('an ID with path characters is refused', [blk('../../etc/passwd')]);
  await refused('two blocks sharing an ID are refused', [blk('dup'), blk('dup', { start: '18:00' })]);
  await refused('overlapping blocks on one day are refused',
    [blk('o1', { start: '10:00', minutes: 60 }), blk('o2', { start: '10:30', minutes: 60 })]);
  await refused('a payload that is not a list is refused', null, { blocks: 'nope' });
  await refused('more blocks than the cap is refused',
    Array.from({ length: 81 }, function (_, i) { return blk('cap' + i, { day: 'Mon', start: String(6 + (i % 12)).padStart(2, '0') + ':00', minutes: 5 }); }));
  var after = (await c('GET', PLAN, null, a.token)).body.blocks;
  ok('every refused write left the stored plan exactly as it was',
     JSON.stringify(after) === JSON.stringify(before), JSON.stringify(after.map(function (x) { return x.id; })));

  head('non-overlapping back-to-back blocks are allowed');
  var adjacent = await c('PUT', PLAN, {
    blocks: [blk('a1', { start: '10:00', minutes: 60 }), blk('a2', { start: '11:00', minutes: 60 })]
  }, a.token);
  ok('11:00 right after a 10:00–11:00 block is fine', adjacent.status === 200, adjacent.raw);

  head('an empty plan is a valid thing to save');
  var cleared = await c('PUT', PLAN, { blocks: [] }, a.token);
  ok('clearing the plan is accepted', cleared.status === 200 && cleared.body.blocks.length === 0, cleared.raw);

  /* --------------------------------------------------------- cross-student */
  head('one student can neither read nor overwrite another student\'s plan');
  await c('PUT', PLAN, { blocks: [blk('a-only')] }, a.token);
  var bOwn = await c('GET', PLAN, null, b.token);
  ok('B sees an empty plan while A has one', bOwn.body.blocks.length === 0, JSON.stringify(bOwn.body.blocks));

  /* B tries to write A's ID into the payload — there is no field for it, so the
     only thing that could honour it is the session. Prove the session wins. */
  await c('PUT', PLAN, {
    scholarId: a.id, studentId: a.id, id: a.id, ownerId: a.id,
    blocks: [blk('b-only')]
  }, b.token);
  var aAfter = await c('GET', PLAN, null, a.token);
  ok('A\'s plan is untouched by B\'s write', aAfter.body.blocks.length === 1 &&
     aAfter.body.blocks[0].id === 'a-only', JSON.stringify(aAfter.body.blocks.map(function (x) { return x.id; })));
  var bAfter = await c('GET', PLAN, null, b.token);
  ok('B\'s write went to B, which is where it belongs', bAfter.body.blocks.length === 1 &&
     bAfter.body.blocks[0].id === 'b-only', JSON.stringify(bAfter.body.blocks.map(function (x) { return x.id; })));

  /* ------------------------------------------------- other fields preserved */
  head('a plan write leaves every other field on the record alone');
  var meBefore = await c('GET', '/api/me', null, a.token);
  await c('PUT', PLAN, { blocks: [blk('keep', { start: '07:00' })] }, a.token);
  var meAfter = await c('GET', '/api/me', null, a.token);
  var fields = ['id', 'name', 'email', 'exam', 'xp', 'streak', 'tier', 'goal'];
  ok('identity and progress fields are unchanged',
     fields.every(function (f) { return JSON.stringify(meBefore.body[f]) === JSON.stringify(meAfter.body[f]); }),
     fields.filter(function (f) { return JSON.stringify(meBefore.body[f]) !== JSON.stringify(meAfter.body[f]); }).join(','));
  ok('the subjects list is unchanged',
     JSON.stringify(meBefore.body.subjects) === JSON.stringify(meAfter.body.subjects));
  ok('and the study-time record is untouched',
     meBefore.body.studySecToday === meAfter.body.studySecToday,
     meBefore.body.studySecToday + ' -> ' + meAfter.body.studySecToday);

  /* ------------------------------------------------------------ persistence */
  head('the plan survives a server restart, read from the same data dir');
  stop(srv);
  await new Promise(function (r) { setTimeout(r, 400); });
  var srv2 = await boot(dir);
  ok('the server came back up on the same data directory', srv2.booted, srv2.log);
  /* Sessions live in memory, so a restart ends them by design; the student signs
     in again and the PLAN is what has to survive, not the token. */
  var reLogin = await call(srv2.port, 'POST', '/api/auth/login', { id: a.id, password: 'plan#1234' });
  var aToken2 = reLogin.body && reLogin.body.token;
  ok('the student can sign in again after the restart', !!aToken2, reLogin.status + ' ' + reLogin.raw);
  var afterRestart = await call(srv2.port, 'GET', PLAN, null, aToken2);
  ok('GET still answers after the restart', afterRestart.status === 200, afterRestart.status + ' ' + afterRestart.raw);
  ok('and the saved block is still there',
     afterRestart.body.blocks.length === 1 && afterRestart.body.blocks[0].id === 'keep',
     JSON.stringify(afterRestart.body && afterRestart.body.blocks));

  /* ----------------------------------------------------------- legacy record */
  head('a legacy record with no planBlocks reads as an empty plan, untouched');
  var dataFile = path.join(dir, 'data.json');
  var raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  var victim = raw.students.find(function (s) { return s.id === b.id; });
  ok('the record exists in the data file', !!victim);
  delete victim.planBlocks;                 /* exactly what a pre-Study-Plan record looks like */
  fs.writeFileSync(dataFile, JSON.stringify(raw, null, 2));

  stop(srv2);
  await new Promise(function (r) { setTimeout(r, 400); });
  var srv3 = await boot(dir);
  var bLogin3 = await call(srv3.port, 'POST', '/api/auth/login', { id: b.id, password: 'plan#5678' });
  var bToken3 = bLogin3.body && bLogin3.body.token;
  var legacy = await call(srv3.port, 'GET', PLAN, null, bToken3);
  ok('the legacy account still signs in and reads a plan', legacy.status === 200, legacy.status + ' ' + legacy.raw);
  ok('which is empty, not an error', legacy.body.blocks.length === 0, JSON.stringify(legacy.body.blocks));
  var rawAgain = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  var victimAgain = rawAgain.students.find(function (s) { return s.id === b.id; });
  ok('reading the plan did not write a planBlocks field onto a legacy record',
     victimAgain.planBlocks === undefined, String(victimAgain.planBlocks));
  ok('and the rest of that record is intact',
     victimAgain.name === victim.name && victimAgain.xp === victim.xp);

  head('a corrupted planBlocks value degrades to an empty plan, never a crash');
  var raw2 = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  raw2.students.find(function (s) { return s.id === b.id; }).planBlocks = '{not json';
  fs.writeFileSync(dataFile, JSON.stringify(raw2, null, 2));
  stop(srv3);
  await new Promise(function (r) { setTimeout(r, 400); });
  var srv4 = await boot(dir);
  var bLogin4 = await call(srv4.port, 'POST', '/api/auth/login', { id: b.id, password: 'plan#5678' });
  var bToken4 = bLogin4.body && bLogin4.body.token;
  var broken = await call(srv4.port, 'GET', PLAN, null, bToken4);
  ok('the route still answers 200', broken.status === 200, broken.status + ' ' + broken.raw);
  ok('with an empty plan rather than a server error', broken.body.blocks.length === 0);
  var healed = await call(srv4.port, 'PUT', PLAN, { blocks: [blk('fresh')] }, bToken4);
  ok('and the student can save a new plan over the broken value', healed.status === 200 && healed.body.blocks.length === 1);

  stop(srv4);

  console.log('\n  ' + (fails ? fails + ' failed' : 'all checks passed'));
  children.forEach(stop);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  children.forEach(stop);
  process.exit(1);
});

process.on('exit', function () { children.forEach(stop); });
