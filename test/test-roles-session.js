/* test-roles-session.js - Roles slice (b), step 1: the server session carries the role KEY.
   Nothing is refused on it yet; this only proves login and the session route report it.
   node test/test-roles-session.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_RS_PORT) || 8199;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

head('the guard rule (pure)');
var c0 = core.allCapabilities()[0];
ok('GOC-A-001 and GOC-A-002 keep full access, whatever the capability', core.adminMayUse('GOC-A-001', 'founder', undefined) && core.adminMayUse('GOC-A-002', 'academic-director', undefined) && core.adminMayUse('GOC-A-002', 'academic-director', 'no-such-cap'));
ok('a later manager with no capability on the route is refused', core.adminMayUse('GOC-A-003', 'finance', undefined) === false && core.adminMayUse('GOC-A-003', 'finance', '') === false);
ok('a later manager is refused a capability that is not listed', core.adminMayUse('GOC-A-003', 'finance', 'no-such-cap') === false);
ok('a later manager with a missing or mistyped role is refused', core.adminMayUse('GOC-A-004', null, c0) === false && core.adminMayUse('GOC-A-004', 'chairman', c0) === false);
var held = core.capabilitiesOf('finance'), notHeld = core.allCapabilities().filter(function (x) { return held.indexOf(x) < 0; });
ok('a later manager gets exactly what the map gives their role', held.length > 0 && held.every(function (x) { return core.adminMayUse('GOC-A-005', 'finance', x); }) && notHeld.every(function (x) { return core.adminMayUse('GOC-A-005', 'finance', x) === false; }));

head('routes tagged with a capability use real capability names');
var srcText = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
var tagged = (srcText.match(/need: 'console', cap: '[^']+'/g) || []).map(function (m) { return m.replace(/.*cap: '/, '').replace(/'$/, ''); });
ok('every one of the 109 console routes carries a capability', tagged.length === 109, tagged.length);
ok('every tag is a real capability in the map', tagged.length > 0 && tagged.every(function (c) { return core.allCapabilities().indexOf(c) > -1; }), tagged.join(','));
ok('the tags are the thirty-four chosen, nothing stray', tagged.every(function (c) { return ['signup.limits', 'broadcast.send', 'notices.manage', 'results.view', 'results.export', 'theory.mark', 'students.deactivate', 'students.approve', 'students.passwords', 'students.add', 'cohort.manage', 'cohort.create', 'students.tier', 'tutors.accounts', 'tutors.audit', 'questions.manage', 'resources.publish', 'classes.schedule', 'approvals.review', 'roster.view', 'challenges.manage', 'sittings.configure', 'homepage.edit', 'managers.accounts', 'alerts.all', 'overview.all', 'overview.own', 'system.migrate', 'scholarship.view', 'scholarship.export', 'scholarship.decide', 'scholarship.approve', 'scholarship.delete', 'analytics.site'].indexOf(c) > -1; }), tagged.join(','));
var fo = ['alerts.all', 'system.migrate', 'overview.all', 'managers.accounts'].every(function (c) { var r = core.rolesWithCapability(c); return r.length === 1 && r[0] === 'founder'; });
ok('alerts, the migration, the full overview and manager accounts are Founder-only', fo);
var allConsole = (srcText.match(/need: 'console',/g) || []).length;
ok('no console route is left without a capability', allConsole === tagged.length && allConsole === 109, allConsole + ' vs ' + tagged.length);
var rvw = core.rolesWithCapability('roster.view'), chm = core.rolesWithCapability('challenges.manage'), sc = core.rolesWithCapability('sittings.configure');
ok('every manager role reads the roster; challenges and sitting settings are for the Founder and the Academic Director only', rvw.length === 5 && chm.length === 2 && chm.indexOf('academic-director') > -1 && sc.length === 2 && sc.indexOf('academic-director') > -1);
var ar = core.rolesWithCapability('approvals.review');
ok('reviewing tutor submissions is for the Founder and the Academic Director only', ar.length === 2 && ar.indexOf('academic-director') > -1);
var rp = core.rolesWithCapability('resources.publish'), cs = core.rolesWithCapability('classes.schedule');
ok('publishing resources and scheduling classes are for the Founder and the Academic Director only', rp.length === 2 && cs.length === 2 && rp.indexOf('academic-director') > -1 && cs.indexOf('academic-director') > -1);
var qm = core.rolesWithCapability('questions.manage');
ok('the question bank is for the Founder and the Academic Director only', qm.length === 2 && qm.indexOf('founder') > -1 && qm.indexOf('academic-director') > -1);
var ta = core.rolesWithCapability('tutors.accounts'), tu = core.rolesWithCapability('tutors.audit');
ok('tutor accounts and the tutor audit log are Founder-only', ta.length === 1 && ta[0] === 'founder' && tu.length === 1 && tu[0] === 'founder');
var cm = core.rolesWithCapability('cohort.manage'), cc = core.rolesWithCapability('cohort.create'), st = core.rolesWithCapability('students.tier');
ok('only the Founder creates or deletes cohorts; student affairs manage them; finance sets tiers, student affairs cannot', cc.length === 1 && cc[0] === 'founder' && cm.indexOf('student-affairs') > -1 && cm.indexOf('finance') < 0 && st.indexOf('finance') > -1 && st.indexOf('student-affairs') < 0);
var sa = core.rolesWithCapability('students.add'), sp = core.rolesWithCapability('students.passwords');
ok('finance may add students but not reset passwords; student affairs the reverse; publicity neither', sa.indexOf('finance') > -1 && sp.indexOf('finance') < 0 && sp.indexOf('student-affairs') > -1 && sa.indexOf('student-affairs') < 0 && sa.indexOf('publicity') < 0 && sp.indexOf('publicity') < 0);
var rv = core.rolesWithCapability('results.view'), rm = core.rolesWithCapability('theory.mark');
ok('finance is kept out of results and marking, student affairs may view results but not mark', rv.indexOf('finance') < 0 && rm.indexOf('finance') < 0 && rv.indexOf('student-affairs') > -1 && rm.indexOf('student-affairs') < 0);
ok('no route is tagged without being a console route', (srcText.match(/cap: '/g) || []).length === tagged.length);

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-lim-test-'));
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
  await waitForBoot(100);
  head('login reports the role key, worked out on the server');
  var f = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  ok('the Founder account is the founder role', f.status === 200 && f.body.user.roleKey === 'founder', f.raw);
  var a = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  ok('the Academic Director account is the academic-director role', a.status === 200 && a.body.user.roleKey === 'academic-director', a.raw);
  head('the session route says the same');
  var s = await call('GET', '/api/auth/session', undefined, f.body.token);
  ok('Founder session carries founder', s.status === 200 && s.body.roleKey === 'founder', s.raw);
  var s2 = await call('GET', '/api/auth/session', undefined, a.body.token);
  ok('Academic Director session carries academic-director', s2.status === 200 && s2.body.roleKey === 'academic-director', s2.raw);
  head('nothing about access has changed yet');
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, a.body.token);
  var r = await call('GET', '/api/students', undefined, a.body.token);
  ok('the Academic Director still reads the roster', r.status === 200, r.status);
  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); stop(); process.exit(1); });
