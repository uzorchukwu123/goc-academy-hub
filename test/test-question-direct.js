/* test-question-direct.js — final cleanup (18 Nov 2026): tutor questions go
   directly into the Question Bank. There is no approval queue, no publish step
   and no return workflow. Replaces test-question-publish.js.

   Proves, on the real server over HTTP and on the console card:
     1. a tutor's valid question is stored live and is served to a student at once,
        with its subject, topic, section, difficulty and explanation intact;
     2. it is listed in the console Question Bank, and subject/section filters work;
     3. invalid or incomplete questions are refused and nothing is stored;
     4. tutor permissions hold: own subject only, own questions only, and no
        student or stranger can add one;
     5. an edit keeps the question live and served; an import stores valid rows
        live and skips invalid ones;
     6. existing questions are untouched, and a historical 'pending' record from
        the retired approval process is preserved as stored and not served
        until its tutor edits it;
     7. the publish, approval queue, approve, return and batch routes are gone;
        Question flags still work;
     8. the console card has no Publish button and labels a historical record.

   node test/test-question-direct.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var vm = require('vm');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_QDIRECT_PORT) || 8297;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-qdirect-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_APPWRITE_OFF: '1' }) });
child.stdout.on('data', function (c) { serverLog += c; }); child.stderr.on('data', function (c) { serverLog += c; });
function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body), headers = {};
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
  var seedIds = readDb().questions.map(function (q) { return q.id; }).sort().join();
  var seedSnapshot = JSON.stringify(readDb().questions);
  var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  var g = await call('POST', '/api/admin/students', { name: 'Dara Direct', email: 'dara@example.com', phone: '08000000072', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, adm);
  var gTok = (await call('POST', '/api/auth/login', { id: g.body.student.id, password: g.body.temporaryPassword })).body.token;
  async function tutor(name, subjects, pw) {
    var t = await call('POST', '/api/tutors', { name: name, subjects: subjects, password: 'start-pass-1' }, adm);
    var tk0 = (await call('POST', '/api/auth/login', { id: t.body.tutor.id, password: 'start-pass-1' })).body.token;
    await call('POST', '/api/tutor/password', { currentPassword: 'start-pass-1', newPassword: pw }, tk0);
    return { id: t.body.tutor.id, token: (await call('POST', '/api/auth/login', { id: t.body.tutor.id, password: pw })).body.token };
  }
  var chem = await tutor('Mrs Ada Obi', ['Chemistry'], 'my-own-pass-9');
  var phys = await tutor('Mr Eze', ['Physics'], 'my-own-pass-8');
  ok('setup: a student and two tutors are signed in', !!gTok && !!chem.token && !!phys.token);

  function served(marker, subject) {
    return call('POST', '/api/me/study/start', { mode: 'practice', subject: subject || 'Chemistry', count: 50 }, gTok)
      .then(function (r) { return r.raw.indexOf(marker) > -1; });
  }
  function stored(id) { return readDb().questions.filter(function (q) { return q.id === id; })[0]; }

  head('1. a tutor question goes straight into the Question Bank, live');
  var good = { subject: 'Chemistry', section: 'practice', topic: 'Acids', text: 'ZQXDIRECT which of these is a strong acid?',
    options: ['Ethanoic acid', 'Hydrochloric acid', 'Citric acid', 'Carbonic acid'], answer: 1, difficulty: 'hard',
    explanation: 'Hydrochloric acid ionises completely in water.', year: 2019 };
  var made = await call('POST', '/api/tutor/questions', good, chem.token);
  var qid = made.body && made.body.question && made.body.question.id;
  ok('the tutor saves the question', made.status === 200 && !!qid, made.raw);
  ok('it is stored live, stamped with the tutor', made.body.question.status === 'live' && stored(qid).status === 'live' && stored(qid).addedBy === chem.id && !!stored(qid).addedAt);
  ok('subject, topic, section, difficulty, year, answer and explanation are kept', (function (q) {
    return q.subject === 'Chemistry' && q.topic === 'Acids' && q.section === 'practice' && q.difficulty === 'hard' &&
      Number(q.year) === 2019 && q.answer === 1 && q.options.length === 4 && /ionises completely/.test(q.explanation);
  })(stored(qid)));
  ok('a student is served it at once — no approval, no publish step', await served('ZQXDIRECT'));

  head('2. the console Question Bank lists it, and filters work');
  var bank = await call('GET', '/api/questions?subject=Chemistry', null, adm);
  ok('it is in the Chemistry bank', (bank.body.questions || []).some(function (q) { return q.id === qid && q.status === 'live'; }));
  var bySec = await call('GET', '/api/questions?subject=Chemistry&section=practice', null, adm);
  ok('the section filter keeps it', (bySec.body.questions || []).some(function (q) { return q.id === qid; }));
  var other = await call('GET', '/api/questions?subject=Physics', null, adm);
  ok('the subject filter leaves it out of Physics', !(other.body.questions || []).some(function (q) { return q.id === qid; }));
  var tl = await call('GET', '/api/tutor/questions?subject=Chemistry', null, chem.token);
  ok('the tutor sees it, counted live', tl.status === 200 && tl.body.counts.live >= 1 && tl.body.questions.some(function (q) { return q.id === qid; }));

  head('3. validation still decides what may be saved');
  var n0 = readDb().questions.length;
  var bad = [
    ['no question text', Object.assign({}, good, { text: '' })],
    ['an answer that is not one of the options', Object.assign({}, good, { text: 'ZQXBAD1 answer out of range', answer: 9 })],
    ['too few options', Object.assign({}, good, { text: 'ZQXBAD2 only one option', options: ['Only'], answer: 0 })],
    ['an unknown section', Object.assign({}, good, { text: 'ZQXBAD3 strange section', section: 'nonsense' })]
  ];
  for (var i = 0; i < bad.length; i++) {
    var r = await call('POST', '/api/tutor/questions', bad[i][1], chem.token);
    ok('refused: ' + bad[i][0], r.status === 400 && typeof (r.body && r.body.error) === 'string', r.status + ' ' + r.raw.slice(0, 120));
  }
  ok('nothing invalid was stored', readDb().questions.length === n0 && !/ZQXBAD/.test(JSON.stringify(readDb().questions)));

  head('4. tutor permissions are enforced');
  ok('a tutor cannot add to a subject they do not teach', (await call('POST', '/api/tutor/questions', Object.assign({}, good, { subject: 'Physics', text: 'ZQXWRONG subject' }), chem.token)).status === 403);
  ok('a student cannot add a tutor question', [401, 403].indexOf((await call('POST', '/api/tutor/questions', good, gTok)).status) > -1);
  ok('a stranger cannot add one', (await call('POST', '/api/tutor/questions', good)).status === 401);
  ok('management is not a tutor on the tutor route', (await call('POST', '/api/tutor/questions', good, adm)).status === 403);
  ok('another tutor cannot edit it', (await call('PUT', '/api/tutor/questions/' + qid, { text: 'ZQXHIJACK edited by another tutor' }, phys.token)).status === 404);
  ok('a forged status or author is ignored', (function (r) { return r; })(await (async function () {
    var f = await call('POST', '/api/tutor/questions', Object.assign({}, good, { text: 'ZQXFORGE forged fields', status: 'pending', addedBy: 'GOC-T-999', reviewedBy: 'x' }), chem.token);
    var q = f.body && f.body.question && stored(f.body.question.id);
    return !!q && q.status === 'live' && q.addedBy === chem.id && !q.reviewedBy;
  })()));
  ok('no tutor question was stored by the refused calls', !/ZQXWRONG|ZQXHIJACK/.test(JSON.stringify(readDb().questions)));

  head('5. edits and imports');
  var ed = await call('PUT', '/api/tutor/questions/' + qid, Object.assign({}, good, { text: 'ZQXEDITED which of these is a strong acid?' }), chem.token);
  ok('the tutor edits their question and it stays live', ed.status === 200 && stored(qid).status === 'live' && /ZQXEDITED/.test(stored(qid).text), ed.raw.slice(0, 200));
  ok('the edited text is what students are served', await served('ZQXEDITED'));
  var csv = 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation\n' +
    'Chemistry,practice,Salts,ZQXIMP1 which salt is soluble?,Silver chloride,Sodium chloride,Lead sulphate,Barium sulphate,,B,,,medium,Sodium salts are soluble.\n' +
    'Chemistry,practice,Salts,ZQXIMP2 a row with no options,,,,,,A,,,easy,\n';
  var imp = await call('POST', '/api/tutor/questions/import', { subject: 'Chemistry', csv: csv, section: 'practice', stampSection: true }, chem.token);
  ok('the import adds the valid row and skips the invalid one', imp.status === 200 && imp.body.added === 1 && imp.body.skipped >= 1 && imp.body.status === 'live', imp.raw.slice(0, 300));
  var impRec = readDb().questions.filter(function (q) { return /ZQXIMP1/.test(q.text); })[0];
  ok('the imported question is live, with its batch id', !!impRec && impRec.status === 'live' && /^IMP-/.test(impRec.batch || ''));
  ok('the invalid row was not stored', !/ZQXIMP2/.test(JSON.stringify(readDb().questions)));
  ok('students are served the imported question', await served('ZQXIMP1'));

  head('6. existing records are preserved');
  var db = readDb();
  ok('every seeded question is still present', seedIds.split(',').every(function (id) { return db.questions.some(function (q) { return String(q.id) === id; }); }));
  ok('seeded questions are unchanged', JSON.stringify(db.questions.filter(function (q) { return seedIds.split(',').indexOf(String(q.id)) > -1; })) === seedSnapshot);
  /* A record the retired approval process left behind, exactly as it was stored. */
  db.settings.questionSeq = (db.settings.questionSeq || 0) + 1;
  var hid = db.settings.questionSeq;
  var hist = Object.assign({}, stored(qid), { id: hid, text: 'ZQXHIST a question left awaiting approval', status: 'pending', addedAt: '2026-10-01T09:00:00.000Z' });
  delete hist.editedAt;
  db.questions.push(hist);
  fs.writeFileSync(path.join(SANDBOX, 'server', 'data.json'), JSON.stringify(db, null, 2));
  var before = JSON.stringify(stored(hid));
  ok('a historical pending record is not served', !(await served('ZQXHIST')));
  await call('GET', '/api/questions?subject=Chemistry', null, adm);
  await call('GET', '/api/tutor/questions?subject=Chemistry', null, chem.token);
  ok('reading the bank leaves it exactly as stored (no automatic publishing, no migration)', JSON.stringify(stored(hid)) === before);
  var tl2 = await call('GET', '/api/tutor/questions?subject=Chemistry', null, chem.token);
  ok('its tutor sees it, counted apart from live', tl2.body.counts.pending === 1 && tl2.body.questions.some(function (q) { return q.id === hid; }));
  var fix = await call('PUT', '/api/tutor/questions/' + hid, { text: 'ZQXHIST a question its tutor has now saved again' }, chem.token);
  ok('once its tutor edits and saves it, it is live and served', fix.status === 200 && stored(hid).status === 'live' && await served('ZQXHIST'), fix.raw.slice(0, 200));
  ok('its author and first-added time are kept', stored(hid).addedBy === chem.id && stored(hid).addedAt === '2026-10-01T09:00:00.000Z');

  head('7. the approval and publish routes are gone');
  ok('POST /api/questions/:id/publish is gone', (await call('POST', '/api/questions/' + qid + '/publish', {}, adm)).status === 404);
  ok('GET /api/approvals is gone', (await call('GET', '/api/approvals', null, adm)).status === 404);
  ok('approve / return / batch are gone',
    (await call('POST', '/api/approvals/' + qid + '/approve', {}, adm)).status === 404 &&
    (await call('POST', '/api/approvals/' + qid + '/return', { reason: 'Because' }, adm)).status === 404 &&
    (await call('POST', '/api/approvals/batch/approve', { batch: 'IMP-1' }, adm)).status === 404);
  ok('Question flags still open for management', (await call('GET', '/api/flags', null, adm)).status === 200);
  ok('a tutor cannot open the console flags', [401, 403].indexOf((await call('GET', '/api/flags', null, chem.token)).status) > -1);

  head('8. the console card');
  var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
  var api = fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8');
  var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
  function grab(name) {
    var i = app.indexOf('function ' + name + '('); var depth = 0, j = app.indexOf('{', i);
    for (var k = j; k < app.length; k++) { if (app[k] === '{') depth++; else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); } }
  }
  var ctx = vm.createContext({
    GOC: { core: core }, admQSelected: {},
    esc: function (x) { return String(x == null ? '' : x); }, mth: function (x) { return String(x == null ? '' : x); },
    admLetter: function (i) { return 'ABCDE'[i]; }
  });
  vm.runInContext(grab('admQStatusTag') + '\n' + grab('admQCardHTML'), ctx);
  var liveCard = ctx.admQCardHTML({ id: 6, status: 'live', addedByName: 'Mrs Ada Obi', kind: 'objective', section: 'objective', text: 't', options: ['a', 'b'], answer: 0 });
  var histCard = ctx.admQCardHTML({ id: 5, status: 'pending', addedByName: 'Mrs Ada Obi', kind: 'objective', section: 'objective', text: 't', options: ['a', 'b'], answer: 0 });
  ok('a live tutor question card carries no status tag and no Publish', !/Not shown to students|Publish/.test(liveCard));
  ok('a historical record is labelled as not shown to students, with no Publish', /Not shown to students/.test(histCard) && !/Publish/.test(histCard));
  ok('no publish code is left in the console or the API layer', !/admQPublish|publishQuestion/.test(app) && !/publishQuestion/.test(api));
  ok('the console has no Approvals section', !/value="approvals"/.test(html) && core.allConsoleSections().indexOf('approvals') < 0);

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  stop();
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); console.log(serverLog.slice(-600)); stop(); process.exit(1); });
