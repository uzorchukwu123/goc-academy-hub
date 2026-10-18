/* test-approvals-edit.js — Phase 3C slice 6.4: "Edit then approve" on the real server over HTTP.
   node test/test-approvals-edit.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_APED_PORT) || 8174;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-aped-test-'));
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
function csvOf(rows) { return 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation\n' + rows.join('\n'); }
(async function () {
  await waitForBoot(100);
  var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var t = await call('POST', '/api/tutors', { name: 'Mrs Ada Obi', subjects: ['Chemistry'], password: 'start-pass-1' }, adm);
  var tid = t.body.tutor.id;
  var tk = (await call('POST', '/api/tutor/login', { id: tid, password: 'start-pass-1' })).body.token;
  await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: 'my-own-pass-1' }, tk);
  tk = (await call('POST', '/api/tutor/login', { id: tid, password: 'my-own-pass-1' })).body.token;

  var good = { subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'ZQXEDIT which of these is a strong acid?', options: ['Ethanoic acid', 'Hydrochloric acid', 'Citric acid', 'Carbonic acid'], answer: 1, difficulty: 'medium' };
  var q = (await call('POST', '/api/tutor/questions', good, tk)).body.question;
  ok('setup: a pending tutor question', q && q.status === 'pending');

  console.log('\nan edit that is not valid');
  var bad = await call('POST', '/api/approvals/' + q.id + '/approve', { edit: { options: ['only one'], answer: 0 } }, adm);
  ok('one option is refused with the console\'s own reason', bad.status === 400 && /at least two options/.test(bad.body.error || ''), bad.raw);
  var still = (await call('GET', '/api/approvals?subject=Chemistry', null, adm)).body.queue.filter(function (x) { return x.id === q.id; })[0];
  ok('the question is still waiting and unchanged', still && still.status === 'pending' && still.options.length === 4 && still.text === good.text);
  ok('an answer that points at no option is refused', (await call('POST', '/api/approvals/' + q.id + '/approve', { edit: { answer: 9 } }, adm)).status === 400);

  console.log('\nreturning ignores any edit');
  var rt = await call('POST', '/api/approvals/' + q.id + '/return', { reason: 'Please tidy the options', edit: { text: 'ZQXSNEAKY changed text on a return' } }, adm);
  ok('a return works', rt.status === 200 && rt.body.question.status === 'returned');
  ok('the text was not changed by the return', readDb().questions.filter(function (x) { return x.id === q.id; })[0].text === good.text);
  var q2 = (await call('PUT', '/api/tutor/questions/' + q.id, good, tk)).body.question || q;
  ok('the tutor can send it back for review', (await call('GET', '/api/approvals?subject=Chemistry', null, adm)).body.queue.some(function (x) { return x.id === q.id; }));

  console.log('\nedit then approve');
  var edit = { text: 'ZQXEDIT which of these is a STRONG acid in water?', topic: 'Strength of acids', options: ['Ethanoic acid', 'Hydrochloric acid', 'Citric acid'], answer: 1, explanation: 'HCl ionises fully.',
               status: 'pending', addedBy: 'GOC-A-001', addedByName: 'The Founder', reviewedBy: 'Nobody' };
  var ap = await call('POST', '/api/approvals/' + q.id + '/approve', { edit: edit }, adm);
  ok('the edited question is approved', ap.status === 200 && ap.body.decision === 'approve' && ap.body.edited === true && ap.body.question.status === 'live', ap.raw);
  var row = readDb().questions.filter(function (x) { return x.id === q.id; })[0];
  ok('the admin\'s changes are stored', row.text === edit.text && row.topic === 'Strength of acids' && row.options.length === 3 && row.answer === 1 && row.explanation === 'HCl ionises fully.', JSON.stringify(row));
  ok('the tutor stays the author; a forged author or status in the edit is ignored', row.addedBy === tid && row.addedByName === 'Mrs Ada Obi' && row.status === 'live' && row.reviewedBy !== 'Nobody');
  ok('it records who approved it and when', row.reviewedBy && /^\d{4}-/.test(row.reviewedAt));
  ok('it has left the queue', !(await call('GET', '/api/approvals', null, adm)).body.queue.some(function (x) { return x.id === q.id; }));
  ok('approving it again is refused', (await call('POST', '/api/approvals/' + q.id + '/approve', { edit: edit }, adm)).status === 400);

  console.log('\nplain approve still works');
  var q3 = (await call('POST', '/api/tutor/questions', Object.assign({}, good, { text: 'ZQXPLAIN another strong acid question' }), tk)).body.question;
  var ap3 = await call('POST', '/api/approvals/' + q3.id + '/approve', {}, adm);
  ok('no edit sent means no edit made', ap3.status === 200 && ap3.body.edited === false && ap3.body.question.text === 'ZQXPLAIN another strong acid question');

  stop();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); console.log(serverLog); stop(); process.exit(1); });
