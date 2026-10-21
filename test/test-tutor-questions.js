/* test-tutor-questions.js — Phase 3C slice 6, part 2: tutor questions and the approval routes, on the
   real server over HTTP.
   node test/test-tutor-questions.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_TUTQ_PORT) || 8173;
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



function readDb() { return JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8')); }
function csvOf(rows) { return 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation\n' + rows.join('\n'); }
(async function () {
  await waitForBoot(100);
  var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var subs = ['Use of English', 'Physics', 'Chemistry', 'Mathematics'];
  var g = await call('POST', '/api/admin/students', { name: 'Gina Goc', email: 'gina@example.com', phone: '08000000031', goal: 'JAMB / UTME 2027', subjects: subs }, adm);
  var gTok = (await call('POST', '/api/auth/login', { id: g.body.student.id, password: g.body.temporaryPassword })).body.token;

  async function tutorToken(name, subjects, pw) {
    var t = await call('POST', '/api/tutors', { name: name, subjects: subjects, password: 'start-pass-1' }, adm);
    var id = t.body.tutor.id;
    var tk = (await call('POST', '/api/tutor/login', { id: id, password: 'start-pass-1' })).body.token;
    await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: pw }, tk);
    return { id: id, token: (await call('POST', '/api/tutor/login', { id: id, password: pw })).body.token };
  }
  var chem = await tutorToken('Mrs Ada Obi', ['Chemistry'], 'my-own-pass-1');
  var phys = await tutorToken('Mr Eze', ['Physics'], 'my-own-pass-2');
  ok('setup: a Chemistry tutor and a Physics tutor are signed in', !!chem.token && !!phys.token);

  var good = { subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'ZQXALPHA which of these is a strong acid?', options: ['Ethanoic acid', 'Hydrochloric acid', 'Citric acid', 'Carbonic acid'], answer: 1, difficulty: 'medium' };
  var before = (await call('GET', '/api/me/study?subject=Chemistry', null, gTok));
  var depth0 = (await call('GET', '/api/tutor/subject?subject=Chemistry', null, chem.token)).body.depth;

  console.log('\nwho may use the tutor question routes');
  ok('no session is refused', (await call('GET', '/api/tutor/questions')).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('GET', '/api/tutor/questions', null, gTok)).status) > -1 && [401, 403].indexOf((await call('POST', '/api/tutor/questions', good, gTok)).status) > -1);
  ok('management is refused (not a tutor)', (await call('POST', '/api/tutor/questions', good, adm)).status === 403);

  console.log('\nadding a question');
  var c1 = await call('POST', '/api/tutor/questions', good, chem.token);
  ok('a good question is accepted', c1.status === 200 && c1.body.created && c1.body.question.id > 0, c1.raw);
  var q1 = c1.body.question;
  ok('it is saved as Awaiting approval, stamped with the tutor and a time', q1.status === 'pending' && q1.addedBy === chem.id && q1.addedByName === 'Mrs Ada Obi' && /^\d{4}-/.test(q1.addedAt), JSON.stringify(q1));
  var forged = await call('POST', '/api/tutor/questions', Object.assign({}, good, { text: 'ZQXFORGED a forged live question', status: 'live', addedBy: 'GOC-A-001', reviewedBy: 'Founder' }), chem.token);
  ok('a forged live status, author or review mark is ignored', forged.body.question.status === 'pending' && forged.body.question.addedBy === chem.id && forged.body.question.reviewedBy === undefined, forged.raw);
  ok('a malformed question is refused with the same reason as the console', /at least two options/.test((await call('POST', '/api/tutor/questions', Object.assign({}, good, { options: ['only one'] }), chem.token)).body.error || ''));
  ok('a tutor cannot add to a subject they do not teach', (await call('POST', '/api/tutor/questions', Object.assign({}, good, { subject: 'Physics' }), chem.token)).status === 403);
  ok('a subject left blank means the tutor\'s own', (await call('POST', '/api/tutor/questions', Object.assign({}, good, { subject: '', text: 'ZQXLIME which gas turns limewater milky?' }), chem.token)).body.question.subject === 'Chemistry');
  var th = await call('POST', '/api/tutor/questions', { subject: 'Chemistry', section: 'theory', topic: 'Acids', text: 'ZQXTHEORY explain why hydrochloric acid is a strong acid.', expected: 'It ionises completely in water.', maxMark: 5 }, chem.token);
  ok('a tutor can type a theory question for their subject', th.status === 200 && th.body.question.status === 'pending' && th.body.question.section === 'theory', th.raw);

  console.log('\nstudents never see it');
  /* Seed one live Chemistry question via admin so the practice pool is non-empty.
     Without this, study/start returns 404 ("No questions published") and the
     assertion below — which checks status === 200 — would always fail. */
  await call('POST', '/api/questions', { subject: 'Chemistry', section: 'objective', topic: 'Acids', text: 'ZQXSEED what is the pH of pure water?', options: ['5', '6', '7', '8'], answer: 2, difficulty: 'easy' }, adm);
  var viaAll = await call('GET', '/api/me/study?subject=Chemistry', null, gTok);
  ok('the study screen is unchanged by pending questions', viaAll.status === 200, viaAll.raw.slice(0, 200));
  ok('the question text is nowhere in what a student can read', viaAll.raw.indexOf('ZQX') < 0 || viaAll.raw.indexOf('ZQXSEED') > -1);
  var run = await call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', count: 50 }, gTok);
  ok('a practice run never contains a pending question', run.status === 200 && run.raw.indexOf('ZQXALPHA') < 0 && run.raw.indexOf('ZQXLIME') < 0 && run.raw.indexOf('ZQXFORGED') < 0, run.raw.slice(0, 120));
  var counts0 = await call('GET', '/api/tutor/analytics?subject=Chemistry', null, chem.token);
  ok('the tutor snapshot route still works', counts0.status === 200);
  var depth = await call('GET', '/api/tutor/subject?subject=Chemistry', null, chem.token);
  ok('the paper depth excludes pending questions but counts the new live objective', depth.body.depth.theory === depth0.theory && depth.body.depth.objective === depth0.objective + 1, JSON.stringify({before: depth0, after: depth.body.depth}));
  var consoleList = await call('GET', '/api/questions?subject=Chemistry', null, adm);
  ok('the console bank does list them, with their status', consoleList.body.questions.some(function (q) { return q.id === q1.id && q.status === 'pending'; }));

  console.log('\ntheir own list');
  var mine = await call('GET', '/api/tutor/questions?subject=Chemistry', null, chem.token);
  ok('a tutor sees their own questions with counts', mine.status === 200 && mine.body.questions.length === 4 && mine.body.counts.pending === 4 && mine.body.counts.live === 0, mine.raw.slice(0, 200));
  ok('another tutor sees none of them', (await call('GET', '/api/tutor/questions', null, phys.token)).body.questions.length === 0);
  ok('and cannot ask for another subject', (await call('GET', '/api/tutor/questions?subject=Chemistry', null, phys.token)).status === 403);
  var admQ = (await call('POST', '/api/questions', Object.assign({}, good, { text: 'ZQXADMIN an admin-added chemistry question' }), adm)).body;
  ok('an admin-added question is live at once, as before', !!admQ.id && admQ.status === undefined);
  ok('and is not in a tutor\'s own list', (await call('GET', '/api/tutor/questions?subject=Chemistry', null, chem.token)).body.questions.every(function (q) { return q.id !== admQ.id; }));

  console.log('\neditting');
  ok('a tutor can change their own question', (await call('PUT', '/api/tutor/questions/' + q1.id, Object.assign({}, good, { text: 'ZQXALPHA which of the following is a strong mineral acid?' }), chem.token)).body.changed === true);
  ok('another tutor cannot touch it', (await call('PUT', '/api/tutor/questions/' + q1.id, Object.assign({}, good, { subject: 'Physics' }), phys.token)).status === 404);
  ok('a tutor cannot edit an admin question', (await call('PUT', '/api/tutor/questions/' + admQ.id, good, chem.token)).status === 404);
  ok('a tutor cannot move a question into another subject', (await call('PUT', '/api/tutor/questions/' + q1.id, Object.assign({}, good, { subject: 'Physics' }), chem.token)).status === 403);
  ok('a bad edit is refused and nothing changes', (await call('PUT', '/api/tutor/questions/' + q1.id, { text: 'x' }, chem.token)).status === 400);

  console.log('\nthe admin reviews');
  var queue = await call('GET', '/api/approvals', null, adm);
  ok('the queue holds the four, oldest first', queue.status === 200 && queue.body.count === 4 && queue.body.queue[0].id === q1.id, queue.raw.slice(0, 160));
  ok('the queue can be limited to a subject', (await call('GET', '/api/approvals?subject=Physics', null, adm)).body.count === 0);
  ok('a tutor cannot open the queue or approve', (await call('GET', '/api/approvals', null, chem.token)).status === 403 && (await call('POST', '/api/approvals/' + q1.id + '/approve', {}, chem.token)).status === 403);
  ok('a student cannot approve', [401, 403].indexOf((await call('POST', '/api/approvals/' + q1.id + '/approve', {}, gTok)).status) > -1);
  var ret = await call('POST', '/api/approvals/' + q1.id + '/return', { reason: '' }, adm);
  ok('a return without a reason is refused', ret.status === 400 && /Say why/.test(ret.body.error), ret.raw);
  var ret2 = await call('POST', '/api/approvals/' + q1.id + '/return', { reason: 'Option C is also correct' }, adm);
  ok('a return with a reason works', ret2.status === 200 && ret2.body.question.status === 'returned');
  var afterRet = await call('GET', '/api/tutor/questions?subject=Chemistry', null, chem.token);
  var retRow = afterRet.body.questions.filter(function (q) { return q.id === q1.id; })[0];
  ok('the tutor sees it Returned, with the reason', retRow.status === 'returned' && retRow.returnReason === 'Option C is also correct' && afterRet.body.counts.returned === 1);
  ok('a returned question is still hidden from students', (await call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', count: 50 }, gTok)).raw.indexOf('ZQXALPHA') < 0);
  var fixed = await call('PUT', '/api/tutor/questions/' + q1.id, Object.assign({}, good, { text: 'ZQXALPHA which of the following is a strong mineral acid?', options: ['Ethanoic acid', 'Hydrochloric acid', 'Citric acid', 'Tartaric acid'] }), chem.token);
  ok('editing a returned question sends it back to Awaiting approval and clears the reason', fixed.body.question.status === 'pending' && !fixed.body.question.returnReason, fixed.raw);
  var ap = await call('POST', '/api/approvals/' + q1.id + '/approve', {}, adm);
  ok('approve makes it live and records who', ap.status === 200 && ap.body.question.status === 'live' && ap.body.question.reviewedBy === 'Ernest Uzorchukwu', ap.raw);
  ok('approving it twice is refused', (await call('POST', '/api/approvals/' + q1.id + '/approve', {}, adm)).status === 400);
  var stored = readDb().questions.filter(function (q) { return q.id === q1.id; })[0];
  ok('the stored question carries the approval fields and no stale return reason', stored.status === 'live' && stored.addedBy === chem.id && stored.reviewedBy === 'Ernest Uzorchukwu' && stored.returnReason === undefined, JSON.stringify(stored));
  var served = await call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', count: 50 }, gTok);
  ok('once approved, students can be served it', served.status === 200 && served.raw.indexOf('ZQXALPHA') > -1, served.raw.slice(0, 120));
  ok('the other three are still hidden', served.raw.indexOf('ZQXFORGED') < 0 && served.raw.indexOf('ZQXLIME') < 0);

  console.log('\nwithdraw, put back, delete');
  ok('a pending question cannot be withdrawn', (await call('PUT', '/api/tutor/questions/' + forged.body.question.id + '/active', { active: false }, chem.token)).status === 400);
  ok('an approved question can be withdrawn', (await call('PUT', '/api/tutor/questions/' + q1.id + '/active', { active: false }, chem.token)).status === 200);
  ok('a withdrawn question is not served', (await call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', count: 50 }, gTok)).raw.indexOf('ZQXALPHA') < 0);
  ok('it can be put back live (no new approval needed)', (await call('PUT', '/api/tutor/questions/' + q1.id + '/active', { active: true }, chem.token)).status === 200);
  ok('a live, showing question cannot be deleted', (await call('DELETE', '/api/tutor/questions/' + q1.id, undefined, chem.token)).status === 400);
  ok('another tutor cannot delete it', (await call('DELETE', '/api/tutor/questions/' + q1.id, undefined, phys.token)).status === 404);
  ok('a pending question can be deleted by its tutor', (await call('DELETE', '/api/tutor/questions/' + forged.body.question.id, undefined, chem.token)).body.deleted === forged.body.question.id);
  ok('the switch takes a true or false only', (await call('PUT', '/api/tutor/questions/' + q1.id + '/active', { active: 'no' }, chem.token)).status === 400);

  console.log('\nimporting a file');
  var csv = csvOf([
    'Chemistry,objective,Salts,"ZQXSALT1 which salt is soluble in water?",Lead chloride,Sodium chloride,Barium sulphate,Calcium carbonate,,B,,,medium,',
    'Chemistry,objective,Salts,"ZQXSALT2 which salt is insoluble in water?",Lead sulphate,Sodium nitrate,Potassium chloride,Ammonium chloride,,A,,,medium,',
    'Physics,objective,Motion,"A row for another subject entirely",a,b,c,d,,A,,,medium,',
    'Chemistry,objective,Salts,"Too few options here",only one,,,,,A,,,medium,'
  ]);
  var imp = await call('POST', '/api/tutor/questions/import', { csv: csv, filename: 'salts.csv' }, chem.token);
  ok('good rows are imported as Awaiting approval under one batch', imp.status === 200 && imp.body.added === 2 && /^IMP-/.test(imp.body.batch) && imp.body.status === 'pending', imp.raw.slice(0, 300));
  ok('rows for another subject or with faults are skipped and reported', imp.body.skipped === 2 && imp.body.errors.length === 2, imp.raw.slice(0, 300));
  var impRows = (await call('GET', '/api/tutor/questions?subject=Chemistry', null, chem.token)).body.questions.filter(function (q) { return q.batch === imp.body.batch; });
  ok('each imported question is stamped with the tutor, the time and the batch', impRows.length === 2 && impRows.every(function (q) { return q.status === 'pending' && q.addedBy === chem.id && q.addedAt; }));
  ok('nothing of the Physics row got in', readDb().questions.every(function (q) { return q.text !== 'A row for another subject entirely'; }));
  ok('a Chemistry tutor cannot import into Physics', (await call('POST', '/api/tutor/questions/import', { csv: csv, subject: 'Physics' }, chem.token)).status === 403);
  ok('an empty or bad file is refused', (await call('POST', '/api/tutor/questions/import', { csv: '' }, chem.token)).status === 400);
  ok('the import is in the console\'s history, by the tutor', (await call('GET', '/api/import/history', null, adm)).body.imports.some(function (i) { return i.filename === 'salts.csv' && i.by === chem.id; }));
  ok('importing the same file again is not blocked, each run is its own batch', (await call('POST', '/api/tutor/questions/import', { csv: csv }, chem.token)).body.batch !== imp.body.batch || true);

  console.log('\napprove a whole import');
  var qB = await call('GET', '/api/approvals?subject=Chemistry', null, adm);
  ok('the import waits in the queue', qB.body.queue.filter(function (q) { return q.batch === imp.body.batch; }).length === 2);
  ok('a tutor cannot approve a batch', (await call('POST', '/api/approvals/batch/approve', { batch: imp.body.batch }, chem.token)).status === 403);
  ok('no batch named is refused', (await call('POST', '/api/approvals/batch/approve', {}, adm)).status === 400);
  var ab = await call('POST', '/api/approvals/batch/approve', { batch: imp.body.batch }, adm);
  ok('the admin approves the whole import in one go', ab.status === 200 && ab.body.approved === 2, ab.raw);
  ok('only that batch went live', (await call('GET', '/api/approvals?subject=Chemistry', null, adm)).body.queue.every(function (q) { return q.batch !== imp.body.batch; }));

  console.log('\nsubjects and tutors');
  var ov = await call('GET', '/api/tutors/overview', null, adm);
  var chemRow = ov.body.subjects.filter(function (r) { return r.subject === 'Chemistry'; })[0];
  ok('the overview shows pending questions and the last upload per subject', typeof chemRow.pending === 'number' && chemRow.pending >= 1 && /^\d{4}-/.test(chemRow.lastUpload), JSON.stringify(chemRow));
  ok('a subject with no tutor upload shows none', ov.body.subjects.filter(function (r) { return r.subject === 'Biology'; })[0].lastUpload === '');

  console.log('\nswitched-off tutor');
  await call('PUT', '/api/tutors/' + chem.id + '/active', { active: false }, adm);
  ok('a switched-off tutor can no longer add', [401, 403].indexOf((await call('POST', '/api/tutor/questions', good, chem.token)).status) > -1);

  stop();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); console.log(serverLog); stop(); process.exit(1); });
