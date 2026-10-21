/* test-notices.js — Phase 3C slice 7: class notices (tutor posts, GOC students of that subject read,
   admin alert on a NEW notice only), on the real server over HTTP.
   node test/test-notices.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_NOTICE_PORT) || 8176;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-notice-test-'));
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



function readDb() { return JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8')); }
(async function () {
  await waitForBoot(100);
  var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var withChem = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
  var noChem = ['Use of English', 'Physics', 'Biology', 'Mathematics'];
  async function student(name, subjects, tier, n) {
    var r = await call('POST', '/api/admin/students', { name: name, email: name.replace(/\W/g, '').toLowerCase() + '@example.com', phone: '0800000004' + n, goal: 'JAMB / UTME 2027', subjects: subjects, tier: tier }, adm);
    var tok = (await call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword })).body.token;
    return { id: r.body.student.id, token: tok };
  }
  var gocChem = await student('Gina Goc', withChem, 'goc', 1);
  var gocNoChem = await student('Gabe Goc', noChem, 'goc', 2);
  var openChem = await student('Opal Open', withChem, 'open', 3);
  async function tutorToken(name, subjects, pw) {
    var t = await call('POST', '/api/tutors', { name: name, subjects: subjects, password: 'start-pass-1' }, adm);
    var id = t.body.tutor.id;
    var tk = (await call('POST', '/api/tutor/login', { id: id, password: 'start-pass-1' })).body.token;
    await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: pw }, tk);
    return { id: id, token: (await call('POST', '/api/tutor/login', { id: id, password: pw })).body.token };
  }
  var chem = await tutorToken('Mrs Ada Obi', ['Chemistry'], 'my-own-pass-1');
  var phys = await tutorToken('Mr Eze', ['Physics'], 'my-own-pass-2');
  var good = { subject: 'Chemistry', title: 'Lab moved to Friday', body: 'ZQXNOTICE The titration practical is now on Friday at 10am in Lab 2.' };

  console.log('\nwho may use the tutor notice routes');
  ok('no session is refused', (await call('GET', '/api/tutor/notices')).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('POST', '/api/tutor/notices', good, gocChem.token)).status) > -1);
  ok('management is refused (not a tutor)', (await call('POST', '/api/tutor/notices', good, adm)).status === 403);

  console.log('\nposting');
  var p0 = await call('POST', '/api/tutor/notices', Object.assign({ addedBy: 'GOC-A-001', addedByName: 'The Founder', id: 9999 }, good), chem.token);
  ok('a tutor posts a notice for their own subject', p0.status === 200 && p0.body.created === true && p0.body.notice.subject === 'Chemistry');
  ok('forged author and id are ignored', p0.body.notice.addedBy === chem.id && p0.body.notice.addedByName === 'Mrs Ada Obi' && p0.body.notice.id !== 9999);
  var nid = p0.body.notice.id;
  ok('it carries no expiry, pin or hold-back flag', p0.body.notice.expires === undefined && p0.body.notice.pinned === undefined && p0.body.notice.active === undefined);
  ok('a Chemistry tutor cannot post to Physics', (await call('POST', '/api/tutor/notices', Object.assign({}, good, { subject: 'Physics' }), chem.token)).status === 403);
  ok('a bad notice is refused with the reason', (await call('POST', '/api/tutor/notices', { subject: 'Chemistry', title: 'x', body: 'y' }, chem.token)).status === 400);
  ok('a Physics tutor cannot list Chemistry notices', (await call('GET', '/api/tutor/notices?subject=Chemistry', null, phys.token)).status === 403);
  var mine = await call('GET', '/api/tutor/notices?subject=Chemistry', null, chem.token);
  ok('the tutor lists their own', mine.status === 200 && mine.body.count === 1 && mine.body.notices[0].id === nid);
  ok('another tutor lists none of them', (await call('GET', '/api/tutor/notices?subject=Physics', null, phys.token)).body.count === 0);

  console.log('\nwho reads it');
  var g1 = await call('GET', '/api/me/notices', null, gocChem.token);
  ok('a GOC student taking Chemistry sees it', g1.status === 200 && g1.body.locked === false && g1.body.notices.length === 1 && g1.body.notices[0].title === 'Lab moved to Friday');
  ok('it says "Chemistry tutor", never the tutor\'s name or ID', g1.body.notices[0].from === 'Chemistry tutor' && g1.raw.indexOf('Ada') === -1 && g1.raw.indexOf(chem.id) === -1);
  var g2 = await call('GET', '/api/me/notices', null, gocNoChem.token);
  ok('a GOC student NOT taking Chemistry sees nothing', g2.status === 200 && g2.body.notices.length === 0 && g2.body.locked === false);
  var o1 = await call('GET', '/api/me/notices', null, openChem.token);
  ok('an Open student sees nothing, locked, and the text never leaves the server', o1.status === 200 && o1.body.locked === true && o1.body.notices.length === 0 && o1.raw.indexOf('ZQXNOTICE') === -1);
  ok('no session is refused', (await call('GET', '/api/me/notices')).status === 401);
  ok('a tutor session is refused on the student route', [401, 403].indexOf((await call('GET', '/api/me/notices', null, chem.token)).status) > -1);
  ok('a switched-over tier takes effect at once: Open made GOC now sees it', (await call('PUT', '/api/students/' + openChem.id + '/tier', { tier: 'goc' }, adm)).status === 200 && (await call('GET', '/api/me/notices', null, openChem.token)).body.notices.length === 1);

  console.log('\nthe admin alert');
  var a1 = await call('GET', '/api/alerts', null, adm);
  var na = a1.body.alerts.filter(function (a) { return a.kind === 'class-notice'; });
  ok('a NEW notice raised one alert', na.length === 1 && na[0].tutorName === 'Mrs Ada Obi' && na[0].subject === 'Chemistry' && na[0].title === 'Lab moved to Friday' && na[0].noticeId === nid && na[0].seen === false, a1.raw);

  console.log('\nediting is quiet');
  var e1 = await call('PUT', '/api/tutor/notices/' + nid, { title: 'Lab moved to Saturday', body: 'ZQXNOTICE The titration practical is now on Saturday at 10am in Lab 2.' }, chem.token);
  ok('the tutor edits their own notice', e1.status === 200 && e1.body.notice.title === 'Lab moved to Saturday' && !!e1.body.notice.editedAt && e1.body.notice.addedBy === chem.id);
  var a2 = await call('GET', '/api/alerts', null, adm);
  ok('the edit raised NO new alert (still one)', a2.body.alerts.filter(function (a) { return a.kind === 'class-notice'; }).length === 1);
  var g3 = await call('GET', '/api/me/notices', null, gocChem.token);
  ok('the student sees the edited text and an edited flag', g3.body.notices[0].title === 'Lab moved to Saturday' && g3.body.notices[0].edited === true);
  ok('the subject cannot be changed by an edit', (await call('PUT', '/api/tutor/notices/' + nid, { subject: 'Physics' }, chem.token)).status === 403);
  ok('another tutor cannot edit it', (await call('PUT', '/api/tutor/notices/' + nid, { title: 'Hijacked notice' }, phys.token)).status === 404);
  ok('an edit that breaks the rules is refused and changes nothing', (await call('PUT', '/api/tutor/notices/' + nid, { title: 'x' }, chem.token)).status === 400 && (await call('GET', '/api/me/notices', null, gocChem.token)).body.notices[0].title === 'Lab moved to Saturday');

  console.log('\nseveral notices, and Seen');
  var p1 = await call('POST', '/api/tutor/notices', { subject: 'Chemistry', title: 'Second notice', body: 'Bring your calculators to the next class please.' }, chem.token);
  var a3 = (await call('GET', '/api/alerts', null, adm)).body.alerts.filter(function (a) { return a.kind === 'class-notice'; });
  ok('a second new notice is its own alert', a3.length === 2);
  ok('the student sees both, newest first', (await call('GET', '/api/me/notices', null, gocChem.token)).body.notices.map(function (n) { return n.id; }).join() === [p1.body.notice.id, nid].join());
  var seen = await call('POST', '/api/alerts/' + a3.filter(function (a) { return a.noticeId === nid; })[0].id + '/seen', {}, adm);
  ok('Seen clears that alert', seen.status === 200 && (await call('GET', '/api/alerts', null, adm)).body.alerts.filter(function (a) { return a.kind === 'class-notice'; }).length === 1);
  await call('PUT', '/api/tutor/notices/' + nid, { body: 'ZQXNOTICE The titration practical is now on Saturday at 11am in Lab 2.' }, chem.token);
  ok('an edit after Seen still raises nothing', (await call('GET', '/api/alerts', null, adm)).body.alerts.filter(function (a) { return a.kind === 'class-notice'; }).length === 1);

  console.log('\nremoving');
  ok('another tutor cannot remove it', (await call('DELETE', '/api/tutor/notices/' + p1.body.notice.id, null, phys.token)).status === 404);
  var d1 = await call('DELETE', '/api/tutor/notices/' + p1.body.notice.id, null, chem.token);
  ok('the tutor removes their own (no hold-back step; it stays until they remove it)', d1.status === 200 && d1.body.ok === true);
  ok('it is gone from the student at once', (await call('GET', '/api/me/notices', null, gocChem.token)).body.notices.map(function (n) { return n.id; }).join() === String(nid));
  var gone = (await call('GET', '/api/alerts', null, adm)).body.alerts.filter(function (a) { return a.noticeId === p1.body.notice.id; })[0];
  ok('its unseen alert stays but is flagged gone', gone && gone.gone === true);
  ok('removing it twice is harmless', (await call('DELETE', '/api/tutor/notices/' + p1.body.notice.id, null, chem.token)).body.alreadyGone === true);

  console.log('\nthe admin');
  var all = await call('GET', '/api/notices', null, adm);
  ok('the admin lists every notice, with the tutor\'s name', all.status === 200 && all.body.count === 1 && all.body.notices[0].addedByName === 'Mrs Ada Obi');
  ok('a filter by subject works', (await call('GET', '/api/notices?subject=Physics', null, adm)).body.count === 0);
  ok('a student and a tutor cannot use the admin list', [401, 403].indexOf((await call('GET', '/api/notices', null, gocChem.token)).status) > -1 && [401, 403].indexOf((await call('GET', '/api/notices', null, chem.token)).status) > -1);
  ok('a tutor cannot use the admin remove', [401, 403].indexOf((await call('DELETE', '/api/notices/' + nid, null, chem.token)).status) > -1);
  var dd = await call('DELETE', '/api/notices/' + nid, null, adm);
  ok('the admin removes any notice', dd.status === 200 && (await call('GET', '/api/me/notices', null, gocChem.token)).body.notices.length === 0);
  ok('the tutor no longer sees it', (await call('GET', '/api/tutor/notices?subject=Chemistry', null, chem.token)).body.count === 0);

  console.log('\nstorage');
  var db = readDb();
  ok('notices live in data.json and the count is stored', Array.isArray(db.notices) && db.notices.length === 0 && db.settings.noticeSeq >= 2);
  ok('alerts of both kinds sit in the same list', db.alerts.some(function (a) { return a.kind === 'class-notice'; }));

  stop();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-1500)); stop(); process.exit(1); });
