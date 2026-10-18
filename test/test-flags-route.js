/* test-flags-route.js — Phase 4.A "Ask a tutor", slices 2-4: the student, tutor
   and console routes over real HTTP, plus a short offline-driver parity check.
   node test/test-flags-route.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var vm = require('vm');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var activeStudent = require('./active-student.js');
var PORT = Number(process.env.GOC_FLAG_PORT) || 8176;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 180) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-flag-test-'));
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
    var payload = body === undefined ? null : JSON.stringify(body), headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').then(function (h) {
    if (h && h.status === 200) return h;
    if (tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}
var COMBO = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
var adm = null, stuTok = null, stuId = null, qid = null, qsubject = null, chemTok = null, flagId = null;

waitForBoot(20).then(async function (h) {
  head('setup: a GOC student and a live Chemistry question');
  ok('server is up', h.status === 200, h.raw);
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  adm = lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var reg = await call('POST', '/api/students', { name: 'Tobi Flag', password: 'secret123',
    email: 'tobi.flag@example.com', phone: '08011110000', goal: 'JAMB / UTME 2027', subjects: COMBO });
  stuId = reg.body.student.id;
  await call('POST', '/api/students/' + stuId + '/approve', {}, adm);
  await call('PUT', '/api/students/' + stuId + '/tier', { tier: 'goc' }, adm);
  stuTok = (await call('POST', '/api/auth/login', { id: stuId, password: 'secret123' })).body.token;
  var qs = await call('GET', '/api/questions?subject=Chemistry&activeOnly=true', undefined, adm);
  var liveQ = ((qs.body && qs.body.questions) || []).filter(function (q) { return q.active && (q.status === undefined || q.status === 'live'); });
  qid = liveQ.length ? liveQ[0].id : null;
  ok('there is a live Chemistry question to ask about', !!qid, qs.raw.slice(0, 120));

  head('the student asks a tutor');
  var ask = await call('POST', '/api/me/flags', { questionId: qid, reason: 'wrong-answer', note: 'I think the key is B, not A.' }, stuTok);
  ok('a GOC student can flag a live question', ask.status === 200 && ask.body.created === true, ask.status + ' ' + ask.raw.slice(0, 160));
  flagId = ask.body.flag && ask.body.flag.id;
  var mine = await call('GET', '/api/me/flags', undefined, stuTok);
  ok('the student sees their own flag: open, no reply, subject from the question', mine.status === 200 && mine.body.flags.length === 1
     && mine.body.flags[0].status === 'open' && mine.body.flags[0].reply === null && mine.body.flags[0].subject === 'Chemistry', mine.raw.slice(0, 200));
  var dup = await call('POST', '/api/me/flags', { questionId: qid, reason: 'typo', note: 'again' }, stuTok);
  ok('a second waiting flag on the same question is refused (409)', dup.status === 409 && /already asked/i.test((dup.body && dup.body.error) || ''), dup.status + ' ' + dup.raw);

  head('the console sees it with the student named');
  var cf = await call('GET', '/api/flags', undefined, adm);
  ok('the console sees the flag with the student name and ID', cf.status === 200 && cf.body.flags.some(function (f) { return f.id === flagId && f.studentId === stuId && f.studentName === 'Tobi Flag'; }), cf.raw.slice(0, 200));
  ok('the console counts show one open', cf.body.counts && cf.body.counts.open === 1, JSON.stringify(cf.body.counts));

  head('a Chemistry tutor replies; a Physics tutor cannot');
  await call('POST', '/api/tutors', { name: 'Ada Chem', subjects: ['Chemistry'], password: 'start-pass-1' }, adm);
  await call('POST', '/api/tutors', { name: 'Eze Phys', subjects: ['Physics'], password: 'start-pass-2' }, adm);
  var tl = await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'start-pass-1' });
  await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'brand-new-pass' }, tl.body.token);
  chemTok = (await call('POST', '/api/tutor/login', { id: 'GOC-T-001', password: 'brand-new-pass' })).body.token;
  var pl = await call('POST', '/api/tutor/login', { id: 'GOC-T-002', password: 'start-pass-2' });
  await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-2', newPassword: 'brand-new-pass2' }, pl.body.token);
  var physTok = (await call('POST', '/api/tutor/login', { id: 'GOC-T-002', password: 'brand-new-pass2' })).body.token;
  var tChem = await call('GET', '/api/tutor/flags?subject=Chemistry', undefined, chemTok);
  ok('the Chemistry tutor sees the Chemistry flag', tChem.status === 200 && tChem.body.flags.some(function (f) { return f.id === flagId; }), tChem.raw.slice(0, 200));
  var tPhys = await call('GET', '/api/tutor/flags', undefined, physTok);
  ok('the Physics tutor sees none of it', tPhys.status === 200 && !tPhys.body.flags.some(function (f) { return f.id === flagId; }), tPhys.raw.slice(0, 160));
  var crossReply = await call('POST', '/api/tutor/flags/' + flagId + '/reply', { text: 'Not my subject.' }, physTok);
  ok('a Physics tutor cannot reply to a Chemistry flag', crossReply.status === 404 || crossReply.status === 403, crossReply.status + ' ' + crossReply.raw);
  var reply = await call('POST', '/api/tutor/flags/' + flagId + '/reply', { text: 'Good question — the key is A because of the lone pair.' }, chemTok);
  ok('the Chemistry tutor replies', reply.status === 200 && reply.body.flag.status === 'answered', reply.status + ' ' + reply.raw.slice(0, 160));
  var mine2 = await call('GET', '/api/me/flags', undefined, stuTok);
  var f0 = mine2.body.flags[0];
  ok('the student sees the reply as "Chemistry tutor", with no name/ID leaked', f0.status === 'answered'
     && f0.reply && f0.reply.from === 'Chemistry tutor' && /lone pair/.test(f0.reply.text)
     && mine2.raw.indexOf('Ada Chem') === -1 && mine2.raw.indexOf('GOC-T-001') === -1, JSON.stringify(f0).slice(0, 220));

  head('closing, and the Open gate');
  var close = await call('POST', '/api/flags/' + flagId + '/close', {}, adm);
  ok('the console closes the flag', close.status === 200 && close.body.flag.status === 'closed', close.status + ' ' + close.raw.slice(0, 120));
  ok('after closing, the student may ask again', (await call('POST', '/api/me/flags', { questionId: qid, reason: 'unclear', note: 'one more thing' }, stuTok)).status === 200, '');
  await call('PUT', '/api/students/' + stuId + '/tier', { tier: 'open' }, adm);
  var openAsk = await call('POST', '/api/me/flags', { questionId: qid, reason: 'typo', note: 'x' }, stuTok);
  ok('an Open student cannot ask (403) and reads no flags', openAsk.status === 403
     && (await call('GET', '/api/me/flags', undefined, stuTok)).body.locked === true, openAsk.status + ' ' + openAsk.raw);

  demoParity();
}).catch(function (e) {
  console.error('crashed:', e && e.stack || e);
  console.error('--- server log ---\n' + serverLog.slice(-1200));
  stop();
  process.exit(1);
});

/* ---- slice 4: the offline demo driver does the real work with the same core rules ---- */
function demoParity() {
  head('offline-driver parity: a student asks, the console answers');
  var sandbox = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var ctx = vm.createContext(sandbox);
  vm.runInContext('window = this; self = this;', ctx);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f }); });
  var mock = vm.runInContext('GOC.api._drivers', ctx).mock;
  var dflag = null;
  activeStudent.demo(mock, { signupCode: 'GOC2027', name: 'Demo Flag', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: COMBO }).then(function (r) {
    vm.runInContext('GOC.api._drivers.mock._setTier', ctx)(r.student.id, 'goc');
    var all = vm.runInContext('GOC.core.seedQuestions()', ctx);
    var q = all.filter(function (x) { return x.subject === 'Chemistry' && x.active !== false; })[0];
    return mock.askTutor({ questionId: q && q.id, reason: 'wrong-answer', note: 'demo note here' });
  }).then(function (r) {
    ok('demo: a GOC student can ask a tutor', r.created === true && r.flag.subject === 'Chemistry', JSON.stringify(r).slice(0, 160));
    dflag = r.flag.id;
    return mock.listMyFlags();
  }).then(function (r) {
    ok('demo: the student sees their flag', r.flags.length === 1 && r.flags[0].status === 'open', JSON.stringify(r).slice(0, 160));
    return mock.login('GOC-A-001', 'founder2027');
  }).then(function () { return mock.unlockConsole('2027'); }).then(function () {
    return mock.listFlags({});
  }).then(function (r) {
    ok('demo: the console sees it with the student named', r.flags.some(function (f) { return f.id === dflag && f.studentName === 'Demo Flag'; }), JSON.stringify(r).slice(0, 160));
    return mock.replyFlag(dflag, 'Thanks — the academy will look at it.');
  }).then(function (r) {
    ok('demo: the console reply makes it answered', r.flag.status === 'answered', JSON.stringify(r).slice(0, 120));
    done();
  }, function (e) { ok('demo parity ran without error', false, e && e.message); done(); });
}
function done() {
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  stop();
  process.exit(fails ? 1 : 0);
}
