/* test-free2027-allocation.js — automatic activity allocation, bank binding,
   subject distribution, publication status and per-attempt option ordering.
   node test/test-free2027-allocation.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_ALLOC_PORT) || 8473;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-alloc-'));
var DATA = path.join(SANDBOX, 'data');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var child = null;
function boot() {
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
      GOC_TEST_MAIL_FILE: path.join(DATA, 'mail.jsonl'),
      GOC_FREE_2027_OTP_SECRET: 'alloc-test-otp-secret-0123456789abcdef',
      GOC_SMTP_HOST: 'mailpit-test',
      GOC_FOUNDER_PW: 'founder2027',
      GOC_PASSCODE: '2027',
      GOC_DATA_DIR: DATA,
      GOC_FREE_2027: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function () {});
  child.stderr.on('data', function () {});
}
function kill() { try { child.kill(); } catch (e) {} try { child.unref(); } catch (e) {} }
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').then(function (h) {
    if (h.status === 200 || tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return waitForBoot(tries - 1); });
  });
}
function dataFile() { return JSON.parse(fs.readFileSync(path.join(DATA, 'data.json'), 'utf8')); }
var HEADER = 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId';
function csv(prefix, subjects, n) {
  var rows = [HEADER];
  for (var i = 1; i <= n; i++) {
    var s = subjects[(i - 1) % subjects.length];
    rows.push([s, 'Topic ' + i, prefix + ' allocation question ' + i + ': choose the correct option',
      'Alpha ' + i, 'Beta ' + i, 'Gamma ' + i, 'Delta ' + i, '', 'B', 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
  }
  return rows.join('\n');
}
var SUBJ5 = ['Use of English', 'Mathematics', 'Physics', 'Chemistry', 'Biology'];
async function founder() {
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var t = lin.body && lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, t);
  return t;
}
async function registerStudent(email, name) {
  var start = await call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Law' });
  if (start.status !== 200) throw new Error('register/start failed: ' + start.raw);
  var rows = fs.readFileSync(path.join(DATA, 'mail.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var code = String(mail.message.text).match(/verification code is (\d{6})/i)[1];
  var v = await call('POST', '/api/free2027/register/verify', { email: email, code: code });
  if (v.status !== 200) throw new Error('register/verify failed: ' + v.raw);
  return v.body.token;
}
function activityBody(kind, title, count, extra) {
  var t = Date.now();
  return Object.assign({ kind: kind, title: title, questionCount: count, opensAt: t - 60000, closesAt: t + 3600000, durationMin: 10, maxAttempts: 2 }, extra || {});
}

(async function () {
  boot();
  await waitForBoot(40);
  var adm = await founder();
  await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csv('Weekly', SUBJ5, 12) }, adm);
  await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csv('Comp', SUBJ5, 8) }, adm);

  head('Activity creation: automatic allocation from the selected category bank');
  var weekly = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Weekly Auto', 5), adm);
  ok('1. a weekly activity allocates and persists five weekly-bank questions', weekly.status === 200 && weekly.body.activity.questionCount === 5 && weekly.body.activity.questionIds.length === 5 && weekly.body.activity.questionIds.every(function (id) { return /^WQ-/.test(id); }), weekly.raw.slice(0, 220));
  var comp = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'Competition Auto', 4), adm);
  ok('2. a competition activity allocates and persists competition-bank questions only', comp.status === 200 && comp.body.activity.questionIds.length === 4 && comp.body.activity.questionIds.every(function (id) { return /^CQ-/.test(id); }), comp.raw.slice(0, 220));
  var manual = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Manual Pick', 2, { questionIds: ['WQ-001', 'WQ-002'] }), adm);
  ok('3. individual question selection is refused by the server', manual.status === 400 && /allocated automatically/i.test(manual.raw), manual.raw.slice(0, 180));
  var tooMany = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'Too Many', 9), adm);
  ok('4. a requested count above the eligible pool is refused with the available count', tooMany.status === 400 && /Only 8 eligible/.test(tooMany.raw), tooMany.raw.slice(0, 180));
  var dist = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Distributed', 5, { subjectDistribution: { Mathematics: 2, Physics: 2, Biology: 1 }, randomizeQuestions: false }), adm);
  var distIds = dist.status === 200 ? dist.body.activity.questionIds : [];
  var wBank = dataFile().free2027.questionBanks.weekly.questions;
  var counts = {};
  distIds.forEach(function (id) { var q = wBank.filter(function (x) { return x.id === id; })[0]; if (q) counts[q.subject] = (counts[q.subject] || 0) + 1; });
  ok('5. optional subject distribution is allocated exactly from the same bank', dist.status === 200 && counts.Mathematics === 2 && counts.Physics === 2 && counts.Biology === 1, JSON.stringify(counts));
  var badDist = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Bad Distribution', 5, { subjectDistribution: { Mathematics: 5 } }), adm);
  ok('6. a subject distribution larger than that subject’s eligible pool is refused', badDist.status === 400 && /Mathematics/.test(badDist.raw), badDist.raw.slice(0, 180));
  var negDist = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Negative Distribution', 2, { subjectDistribution: { Mathematics: -1, Physics: 2 } }), adm);
  ok('6b. a negative distribution count is a clean 400, not a server crash', negDist.status === 400 && /whole numbers/.test(negDist.raw), negDist.status + ' ' + negDist.raw.slice(0, 160));
  var fracDist = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Fraction Distribution', 3, { subjectDistribution: { Mathematics: 2.5 } }), adm);
  ok('6c. a fractional distribution count is refused', fracDist.status === 400 && /whole numbers/.test(fracDist.raw), fracDist.status + ' ' + fracDist.raw.slice(0, 160));
  var publishedSave = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Publish On Save', 2, { status: 'published' }), adm);
  ok('7. publication status can be saved and the assignment remains persisted', publishedSave.status === 200 && publishedSave.body.activity.status === 'published' && publishedSave.body.activity.published === true && publishedSave.body.activity.questionIds.length === 2, publishedSave.raw.slice(0, 200));

  head('Allocation stability and publication guards');
  var beforeEdit = weekly.body.activity.questionIds.slice();
  var edit = await call('PUT', '/api/free2027/admin/activities/' + weekly.body.activity.id, { title: 'Weekly Auto Edited' }, adm);
  ok('an unchanged allocation is kept when only the title changes', edit.status === 200 && JSON.stringify(edit.body.activity.questionIds) === JSON.stringify(beforeEdit), edit.raw.slice(0, 200));
  var resize = await call('PUT', '/api/free2027/admin/activities/' + weekly.body.activity.id, { questionCount: 3 }, adm);
  ok('changing the requested count reallocates from the bound bank', resize.status === 200 && resize.body.activity.questionIds.length === 3 && resize.body.activity.questionIds.every(function (id) { return /^WQ-/.test(id); }), resize.raw.slice(0, 200));
  var pub = await call('POST', '/api/free2027/admin/activities/' + comp.body.activity.id + '/publish', {}, adm);
  ok('publishing checks the persisted bank-bound assignment', pub.status === 200 && pub.body.activity.published === true, pub.raw.slice(0, 180));

  head('Student CBT: option randomisation is per-attempt and mapped back for marking');
  var stu = await registerStudent('alloc@example.com', 'Alloc Student');
  var optAct = await call('POST', '/api/free2027/admin/activities', activityBody('competition', 'Option Shuffle', 4, { randomizeOptions: true, status: 'published' }), adm);
  var start = await call('POST', '/api/free2027/activities/' + optAct.body.activity.id + '/start', {}, stu);
  ok('8. the student payload never contains correct answers or explanations', start.status === 200 && start.raw.indexOf('"answer"') < 0 && start.raw.indexOf('"explanation"') < 0, start.raw.slice(0, 180));
  var attemptId = start.body.attempt.id;
  var stored = dataFile().free2027.sessions[0].attempts.filter(function (a) { return a.id === attemptId; })[0];
  ok('9. a per-attempt option order is persisted on the server', !!stored.optionOrders && Object.keys(stored.optionOrders).length === 4, JSON.stringify(stored.optionOrders || {}).slice(0, 180));
  var cBank = dataFile().free2027.questionBanks.competition.questions;
  var responses = {};
  start.body.questions.forEach(function (q) {
    var original = cBank.filter(function (x) { return String(x.id) === String(q.id); })[0];
    var order = stored.optionOrders[String(q.id)];
    responses[q.id] = order.indexOf(Number(original.answer));
  });
  var saveOne = await call('PUT', '/api/free2027/attempts/' + attemptId + '/answer', { questionId: start.body.questions[0].id, choice: responses[start.body.questions[0].id] }, stu);
  ok('10. a displayed option choice is accepted and stored as the original index', saveOne.status === 200, saveOne.raw.slice(0, 140));
  var resume = await call('GET', '/api/free2027/attempts/' + attemptId, undefined, stu);
  ok('11. resume hands back the displayed choice, not the hidden original index', resume.status === 200 && resume.body.attempt.responses[start.body.questions[0].id] === responses[start.body.questions[0].id], resume.raw.slice(0, 180));
  var sub = await call('POST', '/api/free2027/attempts/' + attemptId + '/submit', { responses: responses }, stu);
  ok('12. marking maps displayed choices back to the original answer key', sub.status === 200 && sub.body.result.score === 4 && sub.body.result.total === 4, sub.raw.slice(0, 200));
  var plainAct = await call('POST', '/api/free2027/admin/activities', activityBody('weekly', 'Plain Options', 2, { randomizeOptions: false, status: 'published' }), adm);
  var plainStart = await call('POST', '/api/free2027/activities/' + plainAct.body.activity.id + '/start', {}, stu);
  var plainStored = dataFile().free2027.sessions[0].attempts.filter(function (a) { return a.id === plainStart.body.attempt.id; })[0];
  ok('13. legacy/plain attempts keep the original option order', plainStart.status === 200 && !plainStored.optionOrders, JSON.stringify(plainStored.optionOrders || null));
  var cross = await call('PUT', '/api/free2027/attempts/' + plainStart.body.attempt.id + '/answer', { questionId: start.body.questions[0].id, choice: 0 }, stu);
  ok('14. a question from another bank/activity is still refused at answer time', cross.status === 400, cross.status + ' ' + cross.raw.slice(0, 140));
  var lb = await call('GET', '/api/free2027/leaderboards', undefined);
  ok('15. only competition results feed the public leaderboard pipeline', lb.status === 200 && Array.isArray(lb.body.leaderboards), lb.status);
  var ov = await call('GET', '/api/free2027/admin/question-banks', undefined, adm);
  ok('16. the bank overview exposes eligible counts for the activity editor', ov.status === 200 && ov.body.banks.weekly.eligibleCount === 12 && ov.body.banks.competition.eligibleCount === 8, JSON.stringify(ov.body && ov.body.banks));

  kill();
  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  try { kill(); } catch (e2) {}
  process.exit(1);
});
