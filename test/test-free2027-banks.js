/* test-free2027-banks.js — PR #9 Parts 3–9, 13: the two INDEPENDENT question
   banks (weekly / competition), the bank-bound assessment engine,
   and persistence/regression checks.
   node test/test-free2027-banks.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_BANK_PORT) || 8471;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-banks-'));
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

var child = null, serverLog = '';
function boot(extraEnv) {
  serverLog = '';
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
      GOC_TEST_MAIL_FILE: path.join(DATA, 'mail.jsonl'),
      GOC_FREE_2027_OTP_SECRET: 'banks-test-otp-secret-0123456789abcdef',
      GOC_SMTP_HOST: 'mailpit-test',
      GOC_FOUNDER_PW: 'founder2027',
      GOC_PASSCODE: '2027',
      GOC_DATA_DIR: DATA,
      GOC_FREE_2027: '1'
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (c) { serverLog += c; });
  child.stderr.on('data', function (c) { serverLog += c; });
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
function csvText(prefix, subjects, n, opts) {
  opts = opts || {};
  var rows = [opts.header || 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId'];
  for (var i = 1; i <= n; i++) {
    var s = subjects[(i - 1) % subjects.length];
    var text = prefix + ' question ' + i + ': pick the correct option';
    if (opts.quoteComma && i === 1) text = '"' + prefix + ', with a quoted comma, question 1"';
    if (opts.escapeQuote && i === 2) text = '"Say ""hello"" loudly, question 2"';
    if (opts.multiline && i === 3) text = '"Line one of question 3\nLine two of question 3"';
    var answer = opts.badAnswer && i === 1 ? 'Z' : 'B';
    if (opts.badSubject && i === 1) s = 'Astrology';
    rows.push([s, 'Topic ' + i, text, 'Alpha ' + i, 'Beta ' + i, 'Gamma ' + i, 'Delta ' + i, '', answer, 'easy', 'Beta is correct.', 'TRUE', '', ''].join(','));
  }
  var out = rows.join('\n');
  if (opts.bom) out = '﻿' + out;
  return out;
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

(async function () {
  boot();
  await waitForBoot(40);
  var adm = await founder();

  /* ---------------------------------------------------------- A. storage */
  head('A. separate bank storage');
  var ov = await call('GET', '/api/free2027/admin/question-banks', undefined, adm);
  ok('the overview names both banks with zero counts', ov.status === 200 && ov.body.banks.weekly.count === 0 && ov.body.banks.competition.count === 0, ov.raw.slice(0, 200));
  ok('an unknown bank is refused by the allowlist', (await call('GET', '/api/free2027/admin/question-banks/science/questions', undefined, adm)).status === 400);
  ok('path-style bank names are refused too', (await call('GET', '/api/free2027/admin/question-banks/../questions', undefined, adm)).status !== 200);
  var impW = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('Weekly', SUBJ5, 10) }, adm);
  var impC = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csvText('Comp', SUBJ5, 6) }, adm);
  ok('1/6/8. mixed-subject CSVs import into each bank', impW.status === 200 && impW.body.imported === 10 && impC.status === 200 && impC.body.imported === 6, impW.raw.slice(0, 120) + '|' + impC.raw.slice(0, 120));
  var db1 = dataFile();
  var wRows = db1.free2027.questionBanks.weekly.questions, cRows = db1.free2027.questionBanks.competition.questions;
  ok('1/2. questions are stored independently under db.free2027.questionBanks', wRows.length === 10 && cRows.length === 6);
  ok('3. IDs are per-bank sequences with no cross-bank collision', wRows.every(function (q) { return /^WQ-\d{3}$/.test(q.id); }) && cRows.every(function (q) { return /^CQ-\d{3}$/.test(q.id); }) && wRows.map(function (q) { return q.id; }).join() !== cRows.map(function (q) { return q.id; }).join());
  ok('7. all five subjects were categorised from the subject column in each bank', [wRows, cRows].every(function (rows) { var s = {}; rows.forEach(function (q) { s[q.subject] = 1; }); return Object.keys(s).length === 5; }));
  ok('the shared db.questions was not used as the source', Array.isArray(db1.questions) && db1.questions.length > 0 && wRows.every(function (q) { return db1.questions.every(function (h) { return String(h.id) !== String(q.id); }); }));
  /* 4/5/10/11: updating/deleting one bank never touches the other */
  await call('POST', '/api/free2027/admin/question-banks/weekly/questions', { subject: 'Physics', topic: 'Motion', text: 'A weekly manual question about motion and forces.', options: ['a', 'b', 'c', 'd'], answer: 2, difficulty: 'easy', explanation: 'c' }, adm);
  var db2 = dataFile();
  ok('4. creating in weekly leaves competition untouched', db2.free2027.questionBanks.competition.questions.length === 6 && db2.free2027.questionBanks.weekly.questions.length === 11);
  var wqId = db2.free2027.questionBanks.weekly.questions[10].id;
  await call('PUT', '/api/free2027/admin/question-banks/weekly/questions/' + wqId, { text: 'An edited weekly question about motion and forces.', options: ['a', 'b', 'c', 'd'], answer: 1, subject: 'Physics', topic: 'Motion', difficulty: 'hard', explanation: 'b' }, adm);
  var db3 = dataFile();
  ok('4b. editing a weekly question leaves competition untouched', db3.free2027.questionBanks.competition.questions.length === 6 && /edited/.test(db3.free2027.questionBanks.weekly.questions[10].text));
  await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete', { ids: [wqId], confirm: true }, adm);
  var db4 = dataFile();
  ok('5. deleting from weekly leaves competition untouched', db4.free2027.questionBanks.weekly.questions.length === 10 && db4.free2027.questionBanks.competition.questions.length === 6);

  /* ------------------------------------------------------- B. CSV engine */
  head('B. CSV import engine (through the bank routes)');
  var dupFile = csvText('Dup', SUBJ5, 3) + '\n' + csvText('Dup', SUBJ5, 1).split('\n').slice(1).join('\n'); /* row 1 repeated */
  var dup = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: dupFile }, adm);
  ok('12/13. repeated import and within-file duplicates are skipped, not saved', dup.status === 200 && dup.body.imported === 3 && dup.body.skipped === 1, JSON.stringify({ i: dup.body.imported, s: dup.body.skipped }));
  ok('10/11. the weekly bank is unaffected by competition imports', dataFile().free2027.questionBanks.weekly.questions.length === 10);
  var prev = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('Prev', SUBJ5, 2), preview: true }, adm);
  ok('a preview reports without saving', prev.status === 200 && prev.body.preview === true && prev.body.wouldImport === 2 && dataFile().free2027.questionBanks.weekly.questions.length === 10, JSON.stringify(prev.body && { p: prev.body.preview, w: prev.body.wouldImport }));
  var badH = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: 'foo,bar\n1,2' }, adm);
  ok('14. invalid headers are refused with the expected format', badH.status === 400 && /exact Free Tutorial header/i.test(badH.raw), badH.raw.slice(0, 160));
  var badS = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('Bad', SUBJ5, 2, { badSubject: true }) }, adm);
  ok('15. invalid subjects are rejected row-level', badS.status === 200 && badS.body.imported === 1 && badS.body.skipped === 1 && /subject/i.test(badS.body.errors[0].error), badS.raw.slice(0, 200));
  var badA = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('BadA', SUBJ5, 2, { badAnswer: true }) }, adm);
  ok('16. invalid answers are rejected row-level', badA.status === 200 && badA.body.imported === 1 && badA.body.skipped === 1, badA.raw.slice(0, 200));
  var malformed = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId\nPhysics,T,"short",A,B,C,D,,X,easy,"x",TRUE,,' }, adm);
  ok('17. malformed rows are reported, not imported', malformed.status === 200 && malformed.body.imported === 0 && malformed.body.skipped === 1, malformed.raw.slice(0, 200));
  var big = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csvText('Big', SUBJ5, 501) }, adm);
  ok('18. more than 500 rows is refused', big.status === 400 && /500/.test(big.raw), big.status + ' ' + big.raw.slice(0, 120));
  var feats = await call('POST', '/api/free2027/admin/question-banks/weekly/import', { csv: csvText('Feat', SUBJ5, 4, { quoteComma: true, escapeQuote: true, multiline: true, bom: true }) }, adm);
  ok('19–22. quoted commas, escaped quotes, multiline fields and a UTF-8 BOM all parse', feats.status === 200 && feats.body.imported === 4 && feats.body.skipped === 0, feats.raw.slice(0, 240));
  var banks = dataFile().free2027.questionBanks;
  ok('the BOM did not leak into a subject', banks.weekly.questions.every(function (q) { return SUBJ5.indexOf(q.subject) > -1; }));
  var ansFmt = await call('POST', '/api/free2027/admin/question-banks/weekly/import', {
    csv: 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId\n' +
      'Biology,T1,"Uppercase letter answer row",a,b,c,d,,C,easy,"c",TRUE,,\n' +
      'Chemistry,T2,"Lowercase letter answer row",a,b,c,d,e,e,easy,"e",TRUE,,\n' +
      'Physics,T3,"Numeric answers are not the Free Tutorial contract",x,yes,no,maybe,,2,easy,"numeric",TRUE,,\n' +
      'Mathematics,T4,"Option-text answers are not the Free Tutorial contract",x,yes,no,maybe,,yes,easy,"text",TRUE,,'
  }, adm);
  ok('23. answer letters A–E import; numeric/option-text answers are refused', ansFmt.status === 200 && ansFmt.body.imported === 2 && ansFmt.body.skipped === 2, ansFmt.raw.slice(0, 240));

  /* ------------------------------------------------------ C. CRUD + safety */
  head('C. question-bank CRUD and deletion safety');
  var c1 = await call('POST', '/api/free2027/admin/question-banks/weekly/questions', { subject: 'Biology', topic: 'Cells', text: 'A manually created weekly question about cells.', options: ['x', 'y', 'z', 'w'], answer: 0, difficulty: 'medium', explanation: 'x' }, adm);
  ok('24. a weekly question is created manually', c1.status === 200 && /^WQ-/.test(c1.body.question.id), c1.raw.slice(0, 160));
  var c2 = await call('POST', '/api/free2027/admin/question-banks/competition/questions', { subject: 'Chemistry', topic: 'Atoms', text: 'A manually created competition question about atoms.', options: ['x', 'y', 'z', 'w'], answer: 1, difficulty: 'hard', explanation: 'y' }, adm);
  ok('25. a competition question is created manually', c2.status === 200 && /^CQ-/.test(c2.body.question.id), c2.raw.slice(0, 160));
  var e1 = await call('PUT', '/api/free2027/admin/question-banks/competition/questions/' + c2.body.question.id, { text: 'An edited competition question about atoms and bonds.', options: ['x', 'y', 'z', 'w'], answer: 0, subject: 'Chemistry', topic: 'Atoms', difficulty: 'easy', explanation: 'x' }, adm);
  ok('26. editing works in both banks', e1.status === 200 && /edited/.test(e1.body.question.text));
  var noConf = await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete', { ids: [c1.body.question.id] }, adm);
  ok('32. deletion without confirm is rejected by the server', noConf.status === 400 && /confirm/i.test(noConf.raw), noConf.raw.slice(0, 140));
  var del1 = await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete', { ids: [c1.body.question.id], confirm: true }, adm);
  ok('27. an individual question is deleted', del1.status === 200 && del1.body.deleted === 1, del1.raw.slice(0, 140));
  var wq = await call('GET', '/api/free2027/admin/question-banks/weekly/questions', undefined, adm);
  var bulkIds = wq.body.questions.slice(0, 3).map(function (q) { return q.id; });
  var bulk = await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete', { ids: bulkIds, confirm: true }, adm);
  ok('28. bulk delete removes exactly the selected weekly questions', bulk.status === 200 && bulk.body.deleted === 3, bulk.raw.slice(0, 140));
  var cq2 = await call('GET', '/api/free2027/admin/question-banks/competition/questions', undefined, adm);
  ok('29. the competition bank is untouched by weekly bulk deletion', dataFile().free2027.questionBanks.competition.questions.length === cq2.body.total);
  /* delete-all isolation + referenced-question refusal */
  var t = Date.now();
  var act = await call('POST', '/api/free2027/admin/activities', { kind: 'weekly', title: 'Week A', questionCount: 2, opensAt: t - 60000, closesAt: t + 3600000, durationMin: 10, maxAttempts: 1 }, adm);
  ok('an activity is created from weekly-bank questions', act.status === 200 && act.body.activity.questionIds.every(function (id) { return /^WQ-/.test(id); }), act.raw.slice(0, 160));
  var refId = act.body.activity.questionIds[0];
  var refDel = await call('POST', '/api/free2027/admin/question-banks/weekly/questions/delete', { ids: [refId], confirm: true }, adm);
  ok('42. deleting a question referenced by an activity is refused', refDel.status === 409, refDel.status + ' ' + refDel.raw.slice(0, 140));
  var delAllBlocked = await call('POST', '/api/free2027/admin/question-banks/weekly/delete-all', { confirm: true }, adm);
  ok('delete-all is refused while a question is referenced', delAllBlocked.status === 409, delAllBlocked.status);
  var delAllNoConf = await call('POST', '/api/free2027/admin/question-banks/competition/delete-all', {}, adm);
  ok('32b. delete-all without confirm is rejected, naming bank and count', delAllNoConf.status === 400 && /Competition Question Bank/.test(delAllNoConf.raw) && /confirm/i.test(delAllNoConf.raw), delAllNoConf.raw.slice(0, 180));
  var compBefore = dataFile().free2027.questionBanks.competition.questions.length;
  var delAllC = await call('POST', '/api/free2027/admin/question-banks/competition/delete-all', { confirm: true }, adm);
  ok('31. delete-all clears the competition bank only', delAllC.status === 200 && delAllC.body.deleted === compBefore && dataFile().free2027.questionBanks.weekly.questions.length > 0, JSON.stringify(delAllC.body));
  /* re-import competition questions for the engine tests */
  await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csvText('Comp2', SUBJ5, 4) }, adm);

  /* ------------------------------------------- D. engine bank binding */
  head('D. assessment/competition isolation at the engine');
  var cq3 = await call('GET', '/api/free2027/admin/question-banks/competition/questions', undefined, adm);
  var compIds = cq3.body.questions.map(function (q) { return q.id; });
  var comp = await call('POST', '/api/free2027/admin/activities', { kind: 'competition', title: 'Cup', questionCount: compIds.length, opensAt: t - 60000, closesAt: t + 3600000, durationMin: 5, maxAttempts: 1 }, adm);
  ok('34. a competition is created from competition-bank questions', comp.status === 200 && comp.body.activity.questionIds.every(function (id) { return /^CQ-/.test(id); }), comp.raw.slice(0, 160));
  var forgedW = await call('POST', '/api/free2027/admin/activities', { kind: 'weekly', title: 'Forged', questionIds: compIds, opensAt: t - 60000, closesAt: t + 3600000, durationMin: 5, maxAttempts: 1 }, adm);
  ok('35a. manual question selection is refused for a weekly activity', forgedW.status === 400 && /allocated automatically/.test(forgedW.raw), forgedW.status + ' ' + forgedW.raw.slice(0, 140));
  var wq2 = await call('GET', '/api/free2027/admin/question-banks/weekly/questions', undefined, adm);
  var forgedC = await call('POST', '/api/free2027/admin/activities', { kind: 'competition', title: 'ForgedC', questionIds: wq2.body.questions.slice(0, 2).map(function (q) { return q.id; }), opensAt: t - 60000, closesAt: t + 3600000, durationMin: 5, maxAttempts: 1 }, adm);
  ok('35b. manual question selection is refused for a competition', forgedC.status === 400 && /allocated automatically/.test(forgedC.raw), forgedC.status + ' ' + forgedC.raw.slice(0, 140));
  await call('POST', '/api/free2027/admin/activities/' + act.body.activity.id + '/publish', {}, adm);
  await call('POST', '/api/free2027/admin/activities/' + comp.body.activity.id + '/publish', {}, adm);
  var stu = await registerStudent('banker@example.com', 'Banker Student');
  var weeklyId = act.body.activity.id, compId2 = comp.body.activity.id;
  var sW = await call('POST', '/api/free2027/activities/' + weeklyId + '/start', {}, stu);
  ok('33. a weekly attempt serves weekly-bank questions only', sW.status === 200 && sW.body.questions.length === 2 && sW.body.questions.every(function (q) { return /^WQ-/.test(q.id); }), sW.raw.slice(0, 200));
  ok('answer keys and explanations are not exposed to the student', sW.raw.indexOf('"answer"') < 0 && sW.raw.indexOf('"explanation"') < 0);
  var pickerNoBank = await call('GET', '/api/free2027/admin/questions', undefined, adm);
  ok('the legacy picker refuses an unscoped read', pickerNoBank.status === 400 && /bank=weekly/.test(pickerNoBank.raw), pickerNoBank.status + ' ' + pickerNoBank.raw.slice(0, 140));
  var pickerW = await call('GET', '/api/free2027/admin/questions?bank=weekly', undefined, adm);
  ok('the legacy picker is bank-scoped and hides answer keys', pickerW.status === 200 && pickerW.body.bank === 'weekly' && pickerW.body.source === 'free2027-question-bank' && pickerW.body.questions.every(function (q) { return /^WQ-/.test(q.id) && q.answer === undefined && q.explanation === undefined; }), pickerW.raw.slice(0, 180));
  var sC = await call('POST', '/api/free2027/activities/' + compId2 + '/start', {}, stu);
  ok('34b. a competition attempt serves competition-bank questions only', sC.status === 200 && sC.body.questions.length === 4 && sC.body.questions.every(function (q) { return /^CQ-/.test(q.id); }), sC.raw.slice(0, 200));
  var aW = sW.body.attempt.id;
  var q0 = sW.body.questions[0];
  var crossQ = sC.body.questions[0].id;
  var forgedAns = await call('PUT', '/api/free2027/attempts/' + aW + '/answer', { questionId: crossQ, choice: 0 }, stu);
  ok('35c. a cross-bank forged question ID is rejected at answer time', forgedAns.status === 400, forgedAns.status + ' ' + forgedAns.raw.slice(0, 100));
  var a1 = await call('PUT', '/api/free2027/attempts/' + aW + '/answer', { questionId: q0.id, choice: 1 }, stu);
  ok('36. answer saving still works', a1.status === 200 && a1.body.saved === true, a1.raw.slice(0, 120));
  var res = await call('GET', '/api/free2027/attempts/' + aW, undefined, stu);
  ok('37. resumption still works with the saved answer', res.status === 200 && res.body.attempt.responses[q0.id] === 1);
  var sub = await call('POST', '/api/free2027/attempts/' + aW + '/submit', {}, stu);
  ok('38/39/40. submission and marking still work', sub.status === 200 && sub.body.result && sub.body.result.total === 2, sub.raw.slice(0, 160));
  var lb = await call('GET', '/api/free2027/leaderboards', undefined);
  ok('41. the public leaderboard route still answers (top-10 shape unchanged)', lb.status === 200 && Array.isArray(lb.body.leaderboards), lb.status);

  /* ------------------------------------------- F. persistence / regression */
  head('F. persistence and regression');
  var dbBefore = dataFile();
  var sharedBefore = JSON.stringify(dbBefore.questions);
  kill();
  boot();
  await waitForBoot(40);
  var adm2 = await founder();
  var dbAfter = dataFile();
  ok('57. both banks persist across a server restart', dbAfter.free2027.questionBanks.weekly.questions.length === dbBefore.free2027.questionBanks.weekly.questions.length && dbAfter.free2027.questionBanks.competition.questions.length === 4, JSON.stringify({ w: dbAfter.free2027.questionBanks.weekly.questions.length, c: dbAfter.free2027.questionBanks.competition.questions.length }));
  ok('55. db.questions is unchanged', JSON.stringify(dbAfter.questions) === sharedBefore);
  ok('54. existing edition records are intact after restart', (dbAfter.free2027.sessions[0].participants || []).length >= 1 && (dbAfter.free2027.sessions[0].activities || []).length >= 2);
  var wqAfter = await call('GET', '/api/free2027/admin/question-banks/weekly/questions', undefined, adm2);
  ok('59. imported questions are still served after restart', wqAfter.status === 200 && wqAfter.body.total === dbBefore.free2027.questionBanks.weekly.questions.length);
  var big500 = await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csvText('Five', SUBJ5, 500) }, adm2);
  ok('58. a real HTTP import of 500 rows succeeds', big500.status === 200 && big500.body.imported === 500, big500.status + ' ' + (big500.body && big500.body.imported) + ' ' + big500.raw.slice(0, 120));
  ok('the bank caps at the 500-row limit per file', (await call('POST', '/api/free2027/admin/question-banks/competition/import', { csv: csvText('Over', SUBJ5, 501) }, adm2)).status === 400);
  kill();

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  fails++;
  console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n')[0] : e));
  try { kill(); } catch (e2) {}
  process.exit(1);
});
