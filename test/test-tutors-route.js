/* test-tutors-route.js — Phase 3C slices 2-3: tutor accounts, sign-in, the scope guard and the
   console Tutors routes, on the real server over HTTP.
   node test/test-tutors-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var activeStudent = require('./active-student.js');
var PORT = Number(process.env.GOC_TUT_PORT) || 8171;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tut-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' }), stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.on('data', function (c) { serverLog += c; }); child.stderr.on('data', function (c) { serverLog += c; });
function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body), headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j, headers: res.headers }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null, headers: {} }); });
    if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(n) {
  return call('GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (n <= 0) throw new Error('server did not start\n' + serverLog);
    return new Promise(function (x) { setTimeout(x, 100); }).then(function () { return waitForBoot(n - 1); });
  });
}

function flat(r) { return r.raw || ''; }
(async function () {
  await waitForBoot(100);
  var login = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = login.body && login.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var stu = await activeStudent(call, { name: 'Test Student', password: 'secret123', email: 's@example.com', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology'] }, adm);
  var stuTok = stu.token;

  console.log('\nthe console creates tutors');
  var noSess = await call('POST', '/api/tutors', { name: 'X', subjects: ['Physics'], password: 'longenough' });
  ok('no session cannot create a tutor', noSess.status === 401, noSess.status);
  var viaStudent = await call('POST', '/api/tutors', { name: 'X', subjects: ['Physics'], password: 'longenough' }, stuTok);
  ok('a student cannot create a tutor', viaStudent.status === 403 || viaStudent.status === 401, viaStudent.status);
  var c1 = await call('POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Chemistry'], password: 'start-pass-1' }, adm);
  ok('a tutor is created and gets GOC-T-001', c1.status === 200 && c1.body.tutor.id === 'GOC-T-001', flat(c1));
  var c2 = await call('POST', '/api/tutors', { name: 'Mr Bayo Ade', subjects: ['Physics', 'Mathematics'], password: 'start-pass-2' }, adm);
  ok('the next gets GOC-T-002', c2.status === 200 && c2.body.tutor.id === 'GOC-T-002', flat(c2));
  ok('the reply never carries a password or hash', !/pwHash|scrypt\$|start-pass/.test(flat(c1) + flat(c2)));
  ok('a new tutor must change the password at first login', c1.body.tutor.mustChangePassword === true && c1.body.tutor.active === true);
  ok('an unknown subject is refused', (await call('POST', '/api/tutors', { name: 'Z Z', subjects: ['Geography'], password: 'longenough' }, adm)).status === 400);
  ok('a short password is refused', (await call('POST', '/api/tutors', { name: 'Z Z', subjects: ['Physics'], password: 'short' }, adm)).status === 400);
  ok('a duplicate ID is refused', (await call('POST', '/api/tutors', { id: 'GOC-T-001', name: 'Z Z', subjects: ['Physics'], password: 'longenough' }, adm)).status === 409);
  var list = await call('GET', '/api/tutors', null, adm);
  ok('the list shows both and leaks no hash', list.status === 200 && list.body.tutors.length === 2 && !/pwHash|scrypt\$/.test(flat(list)), flat(list));
  ok('the file stores a hash, not the password', (function () {
    var f = fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8');
    return /"pwHash": "scrypt\$/.test(f) && f.indexOf('start-pass-1') === -1;
  })());

  console.log('\ntutor sign-in');
  var anon = await call('GET', '/api/tutor/me');
  ok('no session is refused', anon.status === 401, anon.status);
  var unknown = await call('POST', '/api/tutor/login', { id: 'GOC-T-099', password: 'start-pass-1' });
  var wrong = await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'not-the-one' });
  ok('unknown ID and wrong password get the same status and words', unknown.status === 401 && wrong.status === 401 && unknown.body.error === wrong.body.error, flat(unknown) + flat(wrong));
  var asStudentId = await call('POST', '/api/tutor/login', { id: 'GOC-S-001', password: 'secret123' });
  ok('a student ID cannot sign in here', asStudentId.status === 401);
  var t1 = await call('POST', '/api/tutor/login', { id: 'goc-t-001', password: 'start-pass-1' });
  var tok1 = t1.body && t1.body.token;
  ok('the right ID and password sign in (ID case ignored)', t1.status === 200 && tok1 && t1.body.user.role === 'tutor', flat(t1));
  ok('the reply says a password change is due', t1.body.user.mustChangePassword === true && t1.body.user.subjects.join() === 'Chemistry');
  ok('the staff login does not accept a tutor ID', (await call('POST', '/api/auth/login', { id: 'GOC-T-001', password: 'start-pass-1' })).status === 401);

  console.log('\nforced password change');
  ok('/me works before the change', (await call('GET', '/api/tutor/me', null, tok1)).status === 200);
  var early = await call('GET', '/api/tutor/subject', null, tok1);
  ok('subject data is refused until the password is changed', early.status === 403 && /new password/.test(early.body.error), flat(early));
  ok('a wrong current password is refused', (await call('POST', '/api/tutor/password', { currentPassword: 'nope', newPassword: 'brand-new-pass' }, tok1)).status === 400);
  ok('a short new password is refused', (await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'short' }, tok1)).status === 400);
  ok('the same password is refused', (await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'start-pass-1' }, tok1)).status === 400);
  ok('a good change is accepted', (await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'brand-new-pass' }, tok1)).status === 200);
  ok('the old password no longer signs in', (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' })).status === 401);
  var again = await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'brand-new-pass' });
  ok('the new password signs in and nothing is due', again.status === 200 && again.body.user.mustChangePassword === false, flat(again));
  tok1 = again.body.token;

  console.log('\nthe scope: a Chemistry tutor cannot reach Physics');
  var own = await call('GET', '/api/tutor/subject', null, tok1);
  ok('no subject asked means their own', own.status === 200 && own.body.subject === 'Chemistry', flat(own));
  ok('the reply holds only their subject', own.body.depth && own.body.depth.subject === 'Chemistry' && !/Physics/.test(JSON.stringify(own.body.depth)));
  var phys = await call('GET', '/api/tutor/subject?subject=Physics', null, tok1);
  ok('Physics is refused 403', phys.status === 403 && !phys.body.depth, flat(phys));
  ok('so is any other subject, and a made-up one', (await call('GET', '/api/tutor/subject?subject=Biology', null, tok1)).status === 403 && (await call('GET', '/api/tutor/subject?subject=%27%20OR%201', null, tok1)).status === 403);

  console.log('\na tutor session opens nothing else');
  ok('not the console tutor list', (await call('GET', '/api/tutors', null, tok1)).status === 403);
  ok('not creating a tutor', (await call('POST', '/api/tutors', { name: 'Evil Twin', subjects: ['Chemistry'], password: 'longenough' }, tok1)).status === 403);
  ok('not the console question bank', (await call('GET', '/api/questions', null, tok1)).status === 403);
  ok('not the student area', (await call('GET', '/api/me', null, tok1)).status === 403);
  ok('not the subjects & tutors overview', (await call('GET', '/api/tutors/overview', null, tok1)).status === 403);
  ok('not the shared league route', (await call('GET', '/api/league', null, tok1)).status === 403);
  ok('the session check itself works', (await call('GET', '/api/auth/session', null, tok1)).status === 200);
  ok('a student cannot use tutor routes', (await call('GET', '/api/tutor/me', null, stuTok)).status === 403);
  ok('nor can management (a tutor is not a manager)', (await call('GET', '/api/tutor/subject', null, adm)).status === 403);

  console.log('\nchanging subjects, switching off, resetting');
  var edit = await call('PUT', '/api/tutors/GOC-T-001', { name: 'Mrs Ada Obi', subjects: ['Physics'] }, adm);
  ok('the console changes a tutor\'s subjects', edit.status === 200 && edit.body.tutor.subjects.join() === 'Physics', flat(edit));
  ok('it takes effect on the very next request of the open session',
     (await call('GET', '/api/tutor/subject?subject=Chemistry', null, tok1)).status === 403 && (await call('GET', '/api/tutor/subject?subject=Physics', null, tok1)).status === 200);
  ok('editing with no subject is refused', (await call('PUT', '/api/tutors/GOC-T-001', { name: 'Mrs Ada Obi', subjects: [] }, adm)).status === 400);
  ok('an unknown tutor is 404', (await call('PUT', '/api/tutors/GOC-T-077', { name: 'No One', subjects: ['Physics'] }, adm)).status === 404);

  var off = await call('PUT', '/api/tutors/GOC-T-001/active', { active: false }, adm);
  ok('switching off works', off.status === 200 && off.body.tutor.active === false, flat(off));
  var dead = await call('GET', '/api/tutor/subject', null, tok1);
  ok('the open session ends at once', dead.status === 401 || dead.status === 403, dead.status);
  ok('and they cannot sign in', (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'brand-new-pass' })).status === 401);
  ok('"on or off" must be a real yes or no', (await call('PUT', '/api/tutors/GOC-T-001/active', { active: 'no' }, adm)).status === 400);
  await call('PUT', '/api/tutors/GOC-T-001/active', { active: true }, adm);
  var back = await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'brand-new-pass' });
  ok('switched back on, they sign in again', back.status === 200);
  var reset = await call('PUT', '/api/tutors/GOC-T-001/password', { password: 'reset-pass-77' }, adm);
  ok('the console can reset the password', reset.status === 200 && reset.body.tutor.mustChangePassword === true && !/reset-pass/.test(flat(reset)), flat(reset));
  ok('a reset ends the open session', [401, 403].indexOf((await call('GET', '/api/tutor/me', null, back.body.token)).status) > -1);
  ok('the old password is dead, the reset one works and must be changed', (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'brand-new-pass' })).status === 401
     && (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'reset-pass-77' })).body.user.mustChangePassword === true);
  ok('a short reset password is refused', (await call('PUT', '/api/tutors/GOC-T-001/password', { password: 'abc' }, adm)).status === 400);

  console.log('\nsubjects & tutors');
  var ov = await call('GET', '/api/tutors/overview', null, adm);
  ok('every subject is listed with its depth', ov.status === 200 && ov.body.subjects.length === core.ALL_SUBJECTS.length && ov.body.subjects[0].objective >= 0, flat(ov).slice(0, 200));
  var physRow = ov.body.subjects.filter(function (r) { return r.subject === 'Physics'; })[0];
  var chemRow = ov.body.subjects.filter(function (r) { return r.subject === 'Chemistry'; })[0];
  ok('Physics shows both tutors who teach it', physRow.tutors.map(function (t) { return t.id; }).sort().join() === 'GOC-T-001,GOC-T-002', JSON.stringify(physRow.tutors));
  ok('Chemistry now shows no tutor', chemRow.tutors.length === 0);
  ok('a thin paper is flagged', physRow.status.objective === 'thin' && physRow.weak.indexOf('objective') > -1);
  ok('a switched-off tutor drops off the subject', (await call('PUT', '/api/tutors/GOC-T-002/active', { active: false }, adm)).status === 200
     && (await call('GET', '/api/tutors/overview', null, adm)).body.subjects.filter(function (r) { return r.subject === 'Physics'; })[0].tutors.length === 1);

  console.log('\nguessing is slowed down');
  var codes = [];
  for (var i = 0; i < 9; i++) codes.push((await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'guess-' + i })).status);
  ok('after repeated misses even the right password waits', (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'reset-pass-77' })).status === 429, codes.join());

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  stop(); process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  harness error: ' + (e && e.message) + '\n' + serverLog); stop(); process.exit(1); });
