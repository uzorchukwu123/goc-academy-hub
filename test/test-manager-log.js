/* test-manager-signin.js - Roles slice (c), step 7: the manager-action log (sensitive actions only, newest 1,000, own entries for managers).
   node test/test-manager-log.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_ML_PORT) || 8208;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-mlg-test-'));
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


(async function () {
  head('the pure rules');
  var A = core.auditActionFor;
  ok('a tier change is recorded with the target and only the tier', JSON.stringify(A('PUT', '/api/students/GOC-0042/tier', { tier: ' GOC ', password: 'secret' })) === JSON.stringify({ action: 'student-tier', label: 'Changed a student access tier', target: 'GOC-0042', detail: 'goc' }));
  ok('an unknown tier value stores no detail', A('PUT', '/api/students/GOC-0042/tier', { tier: 'vip' }).detail === null);
  ok('on/off is recorded as a true or false and nothing else', A('PUT', '/api/managers/GOC-A-003/active', { active: false }).detail === false && A('PUT', '/api/managers/GOC-A-003/active', { active: 'no' }).detail === null);
  ok('a password reset is recorded with no detail at all', A('POST', '/api/students/GOC-0042/reset', { password: 'hunter22' }).detail === null && A('PUT', '/api/tutors/GOC-T-001/password', { password: 'hunter22' }).detail === null);
  ok('approvals, rejections and deletions are recorded', ['POST /api/students/GOC-0042/approve', 'DELETE /api/students/GOC-0042/approve', 'POST /api/approvals/7/approve', 'POST /api/approvals/7/return', 'POST /api/approvals/batch/approve', 'DELETE /api/questions/12', 'DELETE /api/questions/bulk', 'DELETE /api/notes/3', 'DELETE /api/admin/resources/r-1', 'DELETE /api/managers/GOC-A-003', 'DELETE /api/admin/cohorts/c1'].every(function (x) { var p = x.split(' '); return !!A(p[0], p[1], {}); }));
  ok('reading, creating and editing are not recorded', [['GET', '/api/students'], ['POST', '/api/questions'], ['PUT', '/api/questions/12'], ['POST', '/api/managers'], ['GET', '/api/audit/manager-actions'], ['POST', '/api/alerts/al-1/seen'], ['PUT', '/api/questions/12/active']].every(function (x) { return A(x[0], x[1], {}) === null; }));
  ok('a query string and letter case do not hide an action', A('put', '/api/students/GOC-0042/tier?x=1', { tier: 'open' }).action === 'student-tier');
  var list = [];
  for (var i = 1; i <= core.MANAGER_LOG_KEEP + 5; i++) list = core.addManagerAction(list, core.stampManagerAction({ id: i % 2 ? 'GOC-A-003' : 'GOC-A-004', name: 'X', roleKey: 'finance' }, A('PUT', '/api/students/GOC-0001/tier', { tier: 'open' }), i, Date.now()));
  ok('the newest 1,000 are kept and the oldest dropped', list.length === 1000 && list[0].id === 6 && list[999].id === 1005);
  var before = list.length; core.addManagerAction(list, list[0]);
  ok('adding never mutates the list passed in', list.length === before);
  ok('the Founder reads everything, newest first', core.managerLogFor(list, 'GOC-A-005', 'founder', { limit: 5000 }).length === 1000 && core.managerLogFor(list, 'GOC-A-001', null, { limit: 3 })[0].id === 1005);
  var mine = core.managerLogFor(list, 'GOC-A-003', 'finance', { limit: 5000 });
  ok('a manager reads only their own entries', mine.length === 500 && mine.every(function (e) { return e.by === 'GOC-A-003'; }));
  ok('and cannot widen that with the "by" filter', core.managerLogFor(list, 'GOC-A-003', 'finance', { by: 'GOC-A-004', limit: 5000 }).every(function (e) { return e.by === 'GOC-A-003'; }));
  ok('a role that is missing or mistyped sees only its own', core.managerLogFor(list, 'GOC-A-003', 'chairman', { limit: 5000 }).length === 500);
  ok('the action filter and the limit work', core.managerLogFor(list, 'GOC-A-001', 'founder', { action: 'nothing' }).length === 0 && core.managerLogFor(list, 'GOC-A-001', 'founder', { limit: 7 }).length === 7);

  await waitForBoot(100);
  var f = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var ftok = f.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, ftok);
  var tok = {};
  var who = [['Ada Obi', 'finance', 'GOC-A-003'], ['Ngozi Ade', 'student-affairs', 'GOC-A-004']];
  for (var j = 0; j < who.length; j++) {
    await call('POST', '/api/managers', { name: who[j][0], role: who[j][1], password: 'starter123', passcode: '4821' }, ftok);
    var lg = await call('POST', '/api/auth/login', { id: who[j][2], password: 'starter123' });
    var pw = await call('POST', '/api/auth/password', { currentPassword: 'starter123', newPassword: 'secret-pass77' }, lg.body.token);
    await call('POST', '/api/auth/unlock', { passcode: '4821' }, lg.body.token);
    tok[who[j][2]] = lg.body.token;
  }
  var log0 = await call('GET', '/api/audit/manager-actions', undefined, ftok);
  ok('the Founder sees the two managers changing their own passwords', log0.status === 200 && log0.body.count === 2 && log0.body.entries.every(function (e) { return e.action === 'own-password-change' && e.target === e.by; }), log0.raw);
  ok('with the actor taken from the session, in role and name', log0.body.entries.some(function (e) { return e.by === 'GOC-A-003' && e.byName === 'Ada Obi' && e.role === 'finance'; }), log0.raw);
  ok('the keep size is reported', log0.body.keep === 1000);

  head('what gets logged on the real server');
  var st = await call('POST', '/api/admin/students', { name: 'Test Student', goal: 'UTME', subjects: ['Use of English', 'Mathematics', 'Physics', 'Chemistry'] }, tok['GOC-A-003']);
  ok('set-up: Finance adds a student', st.status === 200 || st.status === 201, st.raw);
  var sid = st.body && (st.body.id || (st.body.student && st.body.student.id));
  var logAdd = await call('GET', '/api/audit/manager-actions', undefined, ftok);
  ok('adding a student is not a sensitive action, so it is not logged', logAdd.body.count === 2, logAdd.raw);
  var t1 = await call('PUT', '/api/students/' + sid + '/tier', { tier: 'open' }, tok['GOC-A-003']);
  ok('Finance restricts the student to Open', t1.status === 200, t1.raw);
  var bad = await call('PUT', '/api/students/' + sid + '/tier', { tier: 'vip' }, tok['GOC-A-003']);
  ok('a refused change (400) is not logged', bad.status === 400 && (await call('GET', '/api/audit/manager-actions', undefined, ftok)).body.count === 3);
  ok('nor one the role may not make (403)', (await call('PUT', '/api/students/' + sid + '/tier', { tier: 'goc' }, tok['GOC-A-004'])).status === 403 && (await call('GET', '/api/audit/manager-actions', undefined, ftok)).body.count === 3);
  ok('nor one for a student who does not exist (404)', (await call('PUT', '/api/students/GOC-9999/tier', { tier: 'goc' }, tok['GOC-A-003'])).status === 404 && (await call('GET', '/api/audit/manager-actions', undefined, ftok)).body.count === 3);
  var off = await call('PUT', '/api/students/' + sid + '/active', { active: false }, tok['GOC-A-003']);
  var rs = await call('POST', '/api/students/' + sid + '/reset', {}, tok['GOC-A-004']);
  ok('a deactivation and a password reset by Student Affairs', off.status === 200 && rs.status === 200, off.status + ' ' + rs.status + ' ' + rs.raw);
  await call('PUT', '/api/managers/GOC-A-004/active', { active: true }, ftok);
  await call('PUT', '/api/managers/GOC-A-004/password', { password: 'reset-pass5', passcode: '70707' }, ftok);

  head('who reads what');
  var all = await call('GET', '/api/audit/manager-actions', undefined, ftok);
  var acts = all.body.entries.map(function (e) { return e.action; });
  ok('the Founder sees every entry, newest first', all.body.count === 7 && acts[0] === 'manager-password-reset' && acts.indexOf('student-tier') > -1 && acts.indexOf('student-active') > -1 && acts.indexOf('student-password-reset') > -1 && acts.indexOf('manager-active') > -1, acts.join(','));
  var tierRow = all.body.entries.filter(function (e) { return e.action === 'student-tier'; })[0];
  ok('the tier entry names who, whom, and the new tier', tierRow.by === 'GOC-A-003' && tierRow.target === sid && tierRow.detail === 'open' && tierRow.role === 'finance', JSON.stringify(tierRow));
  ok('the Founder\'s own actions are logged too', all.body.entries.filter(function (e) { return e.by === 'GOC-A-001'; }).length === 2);
  var fin = await call('GET', '/api/audit/manager-actions', undefined, tok['GOC-A-003']);
  ok('Finance sees only their own three', fin.status === 200 && fin.body.count === 3 && fin.body.entries.every(function (e) { return e.by === 'GOC-A-003'; }) && fin.body.entries.map(function (e) { return e.action; }).sort().join(',') === 'own-password-change,student-active,student-tier', fin.raw);
  var wide = await call('GET', '/api/audit/manager-actions?by=GOC-A-001&limit=500', undefined, tok['GOC-A-003']);
  ok('asking for someone else\'s entries still gives Finance only their own', wide.body.entries.every(function (e) { return e.by === 'GOC-A-003'; }), wide.raw);
  var flt = await call('GET', '/api/audit/manager-actions?action=student-tier', undefined, ftok);
  ok('the Founder can filter by action', flt.body.count === 1 && flt.body.entries[0].action === 'student-tier');
  ok('no session is refused', (await call('GET', '/api/audit/manager-actions')).status === 401);

  head('no secrets in the log');
  var stored = fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8');
  var logJson = JSON.stringify(JSON.parse(stored).managerLog);
  ok('no password or passcode, new or old, appears in a stored entry or in the reply', !/reset-pass5|70707|secret-pass77|starter123|4821/.test(logJson) && !/reset-pass5|70707|secret-pass77|starter123/.test(all.raw));
  ok('the stored log holds the seven entries and its counter', JSON.parse(stored).managerLog.length === 7 && JSON.parse(stored).settings.managerLogSeq === 7);

  head('deleting a manager is logged, and survives the manager');
  var del = await call('DELETE', '/api/managers/GOC-A-003', undefined, ftok);
  var after = await call('GET', '/api/audit/manager-actions', undefined, ftok);
  ok('the delete is recorded and the deleted manager\'s own entries stay', del.status === 200 && after.body.count === 8 && after.body.entries[0].action === 'manager-delete' && after.body.entries[0].target === 'GOC-A-003' && after.body.entries.filter(function (e) { return e.by === 'GOC-A-003'; }).length === 3, after.raw);

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
