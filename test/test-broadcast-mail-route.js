/* test-broadcast-mail-route.js — Phase 4, Broadcast slice 6: the reminder email on the REAL server.
   Delivery is a dry run (each email is written to reminders-outbox.jsonl instead of mailed), the sending
   window is every hour and the sweep runs every ~1 second, so a whole send can be watched over HTTP.
   node test/test-broadcast-mail-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_BROADCAST_MAIL_PORT) || 8178;
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
  cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_PUBLIC_URL: 'https://hub.example.ng', GOC_REMINDER_DRY_RUN: '1', GOC_REMINDER_HOURS: '0-24', GOC_REMINDER_INTERVAL_MIN: '0.02' }), stdio: ['ignore', 'pipe', 'pipe'] });
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
function outbox() {
  try { return fs.readFileSync(path.join(SANDBOX, 'server', 'reminders-outbox.jsonl'), 'utf8').split('\n').filter(Boolean).map(function (l) { return JSON.parse(l); }); }
  catch (e) { return []; }
}
function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
async function waitFor(fn, ms) { var t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250); } return false; }

(async function () {
  await waitForBoot(100);
  var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var withChem = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
  var noChem = ['Use of English', 'Physics', 'Biology', 'Mathematics'];
  async function student(name, subjects, tier, n) {
    var r = await call('POST', '/api/admin/students', { name: name, email: name.replace(/\W/g, '').toLowerCase() + '@example.com', phone: '0800000006' + n, goal: 'JAMB / UTME 2027', subjects: subjects, tier: tier }, adm);
    var tok = (await call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword })).body.token;
    return { id: r.body.student.id, token: tok, email: name.replace(/\W/g, '').toLowerCase() + '@example.com' };
  }
  var gina = await student('Gina Goc', withChem, 'goc', 1);
  var gabe = await student('Gabe Goc', noChem, 'goc', 2);
  var opal = await student('Opal Open', withChem, 'open', 3);
  var quin = await student('Quin Quiet', withChem, 'goc', 4);
  ok('a student can switch their reminder emails off', (await call('POST', '/api/me/reminders', { email: false }, quin.token)).status === 200);

  console.log('\nsending a Chemistry broadcast with the reminder ticked');
  var p = await call('POST', '/api/broadcasts', { audience: { kind: 'subject', subject: 'Chemistry' }, title: 'Chemistry mock on Friday', body: 'ZQXMAIL The Chemistry mock holds on Friday at 10am.\nBring a calculator.' }, adm);
  ok('it is sent and reaches the two Chemistry GOC students', p.status === 200 && p.body.broadcast.reached === 2 && p.body.broadcast.remind === true, p.raw);
  var bid = p.body.broadcast.id;

  var got = await waitFor(function () { return outbox().filter(function (m) { return /ZQXMAIL/.test(m.text); }).length >= 1; }, 15000);
  ok('the next sweep emails it', got, serverLog.slice(-600));
  await sleep(3500);  /* several more sweeps: nobody may be mailed twice */
  var sent = outbox().filter(function (m) { return /ZQXMAIL/.test(m.text); });
  var tos = sent.map(function (m) { return m.to; }).sort();
  ok('exactly one email, to the Chemistry GOC student who has reminders on', tos.join() === gina.email, tos.join());
  ok('nothing to the Biology student, the Open student or the student who opted out', tos.indexOf(gabe.email) === -1 && tos.indexOf(opal.email) === -1 && tos.indexOf(quin.email) === -1);
  ok('the email carries the title as subject, the message, and is from the academy not the staff member',
    sent[0].subject === 'Chemistry mock on Friday' && /Bring a calculator\./.test(sent[0].text) && /G\.O\.C Academy/.test(sent[0].text) && !/Ernest/.test(sent[0].text));
  ok('it carries a one-tap opt-out link on the configured address', /https:\/\/hub\.example\.ng\/api\/unsubscribe\?id=/.test(sent[0].text));

  console.log('\nthe console list and storage');
  var list = await call('GET', '/api/broadcasts', null, adm);
  ok('the console list says how many were emailed', list.status === 200 && list.body.broadcasts[0].emailed === 1 && list.body.broadcasts[0].reached === 2, list.raw);
  var db = readDb();
  ok('who was emailed is kept in data.json', db.broadcastMail && db.broadcastMail[String(bid)] && Object.keys(db.broadcastMail[String(bid)].sent).join() === gina.id);
  ok('students never see the email record (card shows no staff name or counts)', !/emailed|broadcastMail|Ernest/.test(JSON.stringify((await call('GET', '/api/me/broadcasts', null, gina.token)).body)));

  console.log('\na second broadcast without the reminder');
  var q = await call('POST', '/api/broadcasts', { audience: { kind: 'goc' }, title: 'Quiet notice', body: 'ZQXQUIET This one is a card only, no email.', remind: false }, adm);
  ok('it is sent', q.status === 200 && q.body.broadcast.remind === false);
  await sleep(4000);
  ok('no email goes out for it', outbox().filter(function (m) { return /ZQXQUIET/.test(m.text); }).length === 0);
  var l2 = (await call('GET', '/api/broadcasts', null, adm)).body.broadcasts.filter(function (b) { return b.title === 'Quiet notice'; })[0];
  ok('and the console shows it as emailed 0', l2 && l2.emailed === 0);

  console.log('\nremoving');
  ok('removing the first broadcast succeeds', (await call('DELETE', '/api/broadcasts/' + bid, null, adm)).status === 200);
  ok('its who-was-emailed record is deleted with it', !readDb().broadcastMail[String(bid)]);
  await sleep(3500);
  ok('and nothing is re-sent after the removal', outbox().filter(function (m) { return /ZQXMAIL/.test(m.text); }).length === 1);

  console.log('\nopt-out');
  var off = outbox().filter(function (m) { return /ZQXMAIL/.test(m.text); })[0].text.match(/https:\/\/hub\.example\.ng(\/api\/unsubscribe\?[^\s]+)/);
  ok('the opt-out link is in the right form', !!off);
  var un = await call('GET', off[1]);
  ok('following it switches that student\'s email off', un.status === 200 && /turned off/i.test(un.raw));
  var next = await call('POST', '/api/broadcasts', { audience: { kind: 'goc' }, title: 'After opting out', body: 'ZQXAFTER This should not reach the student who opted out.' }, adm);
  ok('a later broadcast is sent', next.status === 200);
  await sleep(4500);
  var after = outbox().filter(function (m) { return /ZQXAFTER/.test(m.text); }).map(function (m) { return m.to; });
  ok('the student who opted out is not emailed it, the other GOC students are', after.indexOf(gina.email) === -1 && after.indexOf(gabe.email) > -1 && after.indexOf(opal.email) === -1 && after.indexOf(quin.email) === -1, after.join());

  stop();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-1500)); stop(); process.exit(1); });
