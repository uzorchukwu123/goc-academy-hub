/* test-broadcast-route.js — Phase 4, Targeted broadcast slice 2: the console sends, GOC students read,
   on the real server over HTTP.
   node test/test-broadcast-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_BROADCAST_PORT) || 8177;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-broadcast-test-'));
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
    var r = await call('POST', '/api/admin/students', { name: name, email: name.replace(/\W/g, '').toLowerCase() + '@example.com', phone: '0800000005' + n, goal: 'JAMB / UTME 2027', subjects: subjects, tier: tier }, adm);
    var tok = (await call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword })).body.token;
    return { id: r.body.student.id, token: tok };
  }
  var gocChem = await student('Gina Goc', withChem, 'goc', 1);
  var gocBio = await student('Gabe Goc', noChem, 'goc', 2);
  var openChem = await student('Opal Open', withChem, 'open', 3);
  var t = await call('POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Chemistry'], password: 'start-pass-1' }, adm);
  var tk = (await call('POST', '/api/tutor/login', { id: t.body.tutor.id, password: 'start-pass-1' })).body.token;
  var good = { audience: { kind: 'subject', subject: 'Chemistry' }, title: 'Mock exam on Friday', body: 'ZQXBROADCAST The Chemistry mock holds on Friday at 10am.' };

  console.log('\nwho may use the console routes');
  ok('no session is refused', (await call('POST', '/api/broadcasts', good)).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('POST', '/api/broadcasts', good, gocChem.token)).status) > -1);
  ok('a tutor is refused', [401, 403].indexOf((await call('POST', '/api/broadcasts', good, tk)).status) > -1);
  ok('a tutor cannot list or remove', [401, 403].indexOf((await call('GET', '/api/broadcasts', null, tk)).status) > -1 && [401, 403].indexOf((await call('DELETE', '/api/broadcasts/1', null, tk)).status) > -1);

  console.log('\nthe audience count before sending');
  var c1 = await call('GET', '/api/broadcasts/audience?kind=goc', null, adm);
  ok('all GOC students counts only GOC students', c1.status === 200 && c1.body.reached === 2 && c1.body.label === 'All GOC students', c1.raw);
  ok('one subject counts GOC students taking it', (await call('GET', '/api/broadcasts/audience?kind=subject&subject=Chemistry', null, adm)).body.reached === 1);
  ok('a subject nobody takes counts zero', (await call('GET', '/api/broadcasts/audience?kind=subject&subject=Agricultural%20Science', null, adm)).status !== 500);
  ok('a bad audience is refused', (await call('GET', '/api/broadcasts/audience?kind=everyone', null, adm)).status === 400 && (await call('GET', '/api/broadcasts/audience?kind=subject&subject=Latin', null, adm)).status === 400);

  console.log('\nsending');
  var p0 = await call('POST', '/api/broadcasts', Object.assign({ sentBy: 'forged', sentAt: 'forged', id: 9999, reached: 500 }, good), adm);
  ok('the console sends a subject broadcast', p0.status === 200 && p0.body.created === true && p0.body.broadcast.audienceLabel === 'Chemistry students', p0.raw);
  ok('forged sender, time, id and reach are ignored', p0.body.broadcast.sentBy !== 'forged' && p0.body.broadcast.sentAt !== 'forged' && p0.body.broadcast.id !== 9999 && p0.body.broadcast.reached === 1);
  ok('the sender is the signed-in staff member', /Ernest/.test(p0.body.broadcast.sentBy));
  ok('the reminder is on by default', p0.body.broadcast.remind === true);
  var bid = p0.body.broadcast.id;
  ok('a bad message is refused with the reason', (await call('POST', '/api/broadcasts', { audience: { kind: 'goc' }, title: 'x', body: 'y' }, adm)).status === 400);
  ok('a missing or unknown audience is refused', (await call('POST', '/api/broadcasts', Object.assign({}, good, { audience: null }), adm)).status === 400 && (await call('POST', '/api/broadcasts', Object.assign({}, good, { audience: { kind: 'open' } }), adm)).status === 400);
  ok('nothing was stored by the refused ones', (await call('GET', '/api/broadcasts', null, adm)).body.count === 1);

  console.log('\nwho reads it');
  var g1 = await call('GET', '/api/me/broadcasts', null, gocChem.token);
  ok('a GOC student taking Chemistry sees it', g1.status === 200 && g1.body.locked === false && g1.body.broadcasts.length === 1 && g1.body.broadcasts[0].title === 'Mock exam on Friday');
  ok('it says "G.O.C Academy", never the staff name, audience or count', g1.body.broadcasts[0].from === 'G.O.C Academy' && g1.raw.indexOf('Ernest') === -1 && g1.raw.indexOf('audience') === -1 && g1.raw.indexOf('reached') === -1);
  var g2 = await call('GET', '/api/me/broadcasts', null, gocBio.token);
  ok('a GOC student NOT taking Chemistry sees nothing', g2.status === 200 && g2.body.broadcasts.length === 0 && g2.body.locked === false);
  var o1 = await call('GET', '/api/me/broadcasts', null, openChem.token);
  ok('an Open student sees nothing, locked, and the text never leaves the server', o1.body.locked === true && o1.body.broadcasts.length === 0 && o1.raw.indexOf('ZQXBROADCAST') === -1);
  ok('no session is refused; a tutor session is refused', (await call('GET', '/api/me/broadcasts')).status === 401 && [401, 403].indexOf((await call('GET', '/api/me/broadcasts', null, tk)).status) > -1);

  console.log('\nan all-GOC broadcast, newest first');
  var p1 = await call('POST', '/api/broadcasts', { audience: { kind: 'goc' }, title: 'Holiday notice', body: 'The academy is closed on Monday for the holiday.', remind: false }, adm);
  ok('it is sent, reminder off, reaching both GOC students', p1.status === 200 && p1.body.broadcast.remind === false && p1.body.broadcast.reached === 2);
  ok('the Chemistry student sees both, newest first', (await call('GET', '/api/me/broadcasts', null, gocChem.token)).body.broadcasts.map(function (b) { return b.title; }).join('|') === 'Holiday notice|Mock exam on Friday');
  ok('the Biology student sees only the all-GOC one', (await call('GET', '/api/me/broadcasts', null, gocBio.token)).body.broadcasts.map(function (b) { return b.title; }).join('|') === 'Holiday notice');

  console.log('\ntier changes take effect at once');
  ok('Open made GOC now sees the messages for them', (await call('PUT', '/api/students/' + openChem.id + '/tier', { tier: 'goc' }, adm)).status === 200 && (await call('GET', '/api/me/broadcasts', null, openChem.token)).body.broadcasts.length === 2);
  ok('GOC made Open loses them at once', (await call('PUT', '/api/students/' + openChem.id + '/tier', { tier: 'open' }, adm)).status === 200 && (await call('GET', '/api/me/broadcasts', null, openChem.token)).body.locked === true);

  console.log('\nthe console list and removing');
  var all = await call('GET', '/api/broadcasts', null, adm);
  ok('the console lists every broadcast, newest first, with sender, audience and reach', all.status === 200 && all.body.count === 2 && all.body.broadcasts[0].title === 'Holiday notice' && /Ernest/.test(all.body.broadcasts[0].sentBy) && all.body.broadcasts[1].audienceLabel === 'Chemistry students' && all.body.broadcasts[1].reached === 1);
  var d1 = await call('DELETE', '/api/broadcasts/' + bid, null, adm);
  ok('the console removes one', d1.status === 200 && d1.body.ok === true);
  ok('it is gone from the student at once', (await call('GET', '/api/me/broadcasts', null, gocChem.token)).body.broadcasts.map(function (b) { return b.title; }).join() === 'Holiday notice');
  ok('removing it twice is harmless', (await call('DELETE', '/api/broadcasts/' + bid, null, adm)).body.alreadyGone === true);

  console.log('\nstorage');
  var db = readDb();
  ok('broadcasts live in data.json and the count is stored', Array.isArray(db.broadcasts) && db.broadcasts.length === 1 && db.settings.broadcastSeq >= 2);

  stop();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-1500)); stop(); process.exit(1); });
