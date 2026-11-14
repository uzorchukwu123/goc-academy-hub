/* test-account-isolation.js — Part Three.
   Real HTTP against a throwaway server:
     1. study reminders are stored under the authenticated Scholar ID, not a
        value supplied by the page, so student A cannot change B's choices;
     2. a streak freeze bought by A persists across a reload/login as A and is
        never visible to B;
     3. buying is capped and cannot double-spend under concurrent taps.
   Run:  node test/test-account-isolation.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_ISOLATION_PORT) || 8191;
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-isolation-'));
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  if (fs.existsSync(path.join(APP, f))) fs.cpSync(path.join(APP, f), path.join(SANDBOX, f));
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
    var headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function boot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return boot(tries - 1); });
  });
}
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
var log = '';
child.stdout.on('data', function (c) { log += c; });
child.stderr.on('data', function (c) { log += c; });
function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
var DATA = path.join(SANDBOX, 'server', 'data.json');
function patch(id, fields) {
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  var s = db.students.filter(function (x) { return x.id === id; })[0];
  if (s) Object.assign(s, fields);
  fs.writeFileSync(DATA, JSON.stringify(db));
}
function read(id) {
  var db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
  return (db.students || []).filter(function (x) { return x.id === id; })[0] || null;
}
var A, B;
(async function () {
  await boot(50);
  var base = { goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'], password: 'secret123' };
  A = await activeStudent(call, Object.assign({}, base, { name: 'Ada One', email: 'ada.one@example.com', phone: '08000000101' }));
  B = await activeStudent(call, Object.assign({}, base, { name: 'Bola Two', email: 'bola.two@example.com', phone: '08000000102' }));
  ok('two distinct active students were created', !!A.token && !!B.token && A.id !== B.id, A.id + ' / ' + B.id);

  head('study reminders are bound to the authenticated student');
  var a0 = await call('GET', '/api/me/reminders', undefined, A.token);
  var b0 = await call('GET', '/api/me/reminders', undefined, B.token);
  ok('both start from their own (default on) row', a0.status === 200 && b0.status === 200
    && a0.body.reminders.email === true && b0.body.reminders.email === true, a0.raw + ' / ' + b0.raw);
  var aOff = await call('POST', '/api/me/reminders', { email: false }, A.token);
  ok('A can turn A off', aOff.status === 200 && aOff.body.reminders.email === false, aOff.raw);
  var bStill = await call('GET', '/api/me/reminders', undefined, B.token);
  ok('B is unaffected by A\'s choice', bStill.body.reminders.email === true, bStill.raw);
  var spoof = await call('POST', '/api/me/reminders', { email: false, sms: false, studentId: B.id, id: B.id }, A.token);
  ok('A cannot address B by putting an id in the body', spoof.status === 200 && spoof.body.reminders.email === false, spoof.raw);
  var bAfterSpoof = await call('GET', '/api/me/reminders', undefined, B.token);
  ok('B\'s row is still untouched', bAfterSpoof.body.reminders.email === true && bAfterSpoof.body.reminders.sms === false, bAfterSpoof.raw);
  var dbMid = JSON.parse(fs.readFileSync(DATA, 'utf8')).reminderState || {};
  ok('only A holds a preference record; B is still on defaults', !!dbMid[A.id] && !dbMid[B.id] && A.id !== B.id,
    JSON.stringify(Object.keys(dbMid)));
  ok('A\'s record says off, B\'s does not exist yet (still default)', dbMid[A.id].prefs.email === false && !dbMid[B.id],
    JSON.stringify(dbMid));

  head('streak freeze is owned, persisted and capped');
  patch(A.id, { xp: 1000, streakFreezes: 0 });
  var buy1 = await call('POST', '/api/me/streak-freeze', {}, A.token);
  ok('A buys the first freeze', buy1.status === 200 && buy1.body.streakFreezes === 1, buy1.raw);
  var buy2 = await call('POST', '/api/me/streak-freeze', {}, A.token);
  ok('A buys the second freeze', buy2.status === 200 && buy2.body.streakFreezes === 2, buy2.raw);
  var buy3 = await call('POST', '/api/me/streak-freeze', {}, A.token);
  ok('a third is refused at the cap with a machine reason', buy3.status === 409 && buy3.body.reason === 'max', buy3.raw);
  var aMe = await call('GET', '/api/me', undefined, A.token);
  ok('A\'s reload shows both the spent XP and the two freezes',
    aMe.body.streakFreezes === 2 && aMe.body.xp === 0, aMe.raw);
  var bMe = await call('GET', '/api/me', undefined, B.token);
  ok('B sees none of A\'s freezes', bMe.body.streakFreezes === 0 && bMe.body.xp === 0, bMe.raw);
  ok('the local record persisted the same values', read(A.id).streakFreezes === 2 && read(A.id).xp === 0,
    JSON.stringify(read(A.id)));

  patch(B.id, { xp: 1200, streakFreezes: 0 });
  var race = await Promise.all([
    call('POST', '/api/me/streak-freeze', {}, B.token),
    call('POST', '/api/me/streak-freeze', {}, B.token)
  ]);
  var bAfterRace = await call('GET', '/api/me', undefined, B.token);
  ok('two concurrent taps never exceed the cap or double-spend',
    bAfterRace.body.streakFreezes === 2 && bAfterRace.body.xp === 200
    && race.filter(function (r) { return r.status === 200; }).length === 2, bAfterRace.raw + ' ' + JSON.stringify(race.map(function (r) { return r.status; })));

  var relog = await call('POST', '/api/auth/login', { id: A.id, password: A.tempPassword });
  ok('A can sign out and back in with the issued password', relog.status === 200 && !!relog.body.token, relog.raw);
  var afterRelog = await call('GET', '/api/me', undefined, relog.body.token);
  ok('the freeze count survives logout/login', afterRelog.body.streakFreezes === 2, afterRelog.raw);
  var remAfter = await call('GET', '/api/me/reminders', undefined, relog.body.token);
  ok('the reminder choice survives logout/login', remAfter.body.reminders.email === false, remAfter.raw);

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  stop();
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  console.log(log.slice(-2000));
  stop();
  process.exit(1);
});
