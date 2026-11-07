/* test-free2027-local.js — the 2027 Free Tutorial Edition with the Appwrite
   Database API unavailable, and programme data that must survive a restart.

   The scenario is the real one this was written for: the deployment's .env
   still carries APPWRITE_* credentials, but the Appwrite Database API answers
   403 (plan allowance exhausted / API suspended). The edition must keep working
   — registration, lessons, papers, marking, administration, archiving — and
   every one of its records must live in the local JSON data file.

   A stub server stands in for Appwrite: it records every request it receives
   and refuses all of them. Two things are then asserted separately:
     • the edition never sends it a DATABASE request (no reads, no writes);
     • the hub's OWN question route still does — proving Appwrite was not
       switched off globally, only bypassed by the edition.

   Then the server is restarted on the same data folder, and finally started
   with GOC_APPWRITE_OFF=1, where no Appwrite request may be made at all.

   node test/test-free2027-local.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_LOCAL_PORT) || 8321;
var STUB_PORT = PORT + 1;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 300) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---------------------------------------------------------- the sandbox app */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-local-'));
var DATA = path.join(SANDBOX, 'local-test-data');
var MAIL_FILE = path.join(DATA, 'mail-capture.jsonl');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
fs.cpSync(path.join(APP, 'css'), path.join(SANDBOX, 'css'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var DATA_FILE = path.join(DATA, 'data.json');

/* --------------------------------------- the "suspended Appwrite" stand-in */
var stub = { hits: 0, databaseHits: 0, paths: [] };
var stubServer = http.createServer(function (req, res) {
  stub.hits++;
  stub.paths.push(req.method + ' ' + req.url);
  if (/\/databases\//.test(req.url)) stub.databaseHits++;
  res.writeHead(403, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ message: 'Database API access is suspended for this project.', code: 403 }));
});

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
    if (h && h.status === 200) return h;
    if (tries <= 0) return h;
    return new Promise(function (r) { setTimeout(r, 200); }).then(function () { return waitForBoot(tries - 1); });
  });
}
function dataFile() { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }

var current = null, log = '';
function bootApp(extraEnv) {
  log = '';
  var env = Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
    GOC_TEST_MAIL_FILE: MAIL_FILE,
    GOC_FREE_2027_OTP_SECRET: 'local-test-otp-secret-0123456789abcdef',
    GOC_SMTP_HOST: 'mailpit-test',
    GOC_SMTP_FROM: 'G.O.C Academy Hub <verification@gocacademy.test>',
    GOC_DATA_DIR: DATA,
    GOC_FREE_2027: '1',
    /* a real deployment's .env, copied to this box: Appwrite is configured,
       and the API it points at refuses everything. */
    APPWRITE_ENDPOINT: 'http://127.0.0.1:' + STUB_PORT + '/v1',
    APPWRITE_PROJECT_ID: 'local-test-project',
    APPWRITE_API_KEY: 'local-test-key-not-a-secret',
    APPWRITE_BUCKET_ID: 'goc-data',
    APPWRITE_FILE_ID: 'academy-data-json',
    GOC_FOUNDER_PW: 'local-founder-2027',
    GOC_ACADDIR_PW: 'local-acaddir-2027',
    GOC_PASSCODE: '481516'
  }, extraEnv || {});
  /* an inherited .env must not decide this test */
  current = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX, env: env, stdio: ['ignore', 'pipe', 'pipe']
  });
  current.stdout.on('data', function (c) { log += c; });
  current.stderr.on('data', function (c) { log += c; });
  return waitForBoot(50);
}
function stopApp() {
  if (!current) return Promise.resolve();
  try { current.kill(); } catch (e) {}
  current = null;
  return new Promise(function (r) { setTimeout(r, 600); });
}

function mailedCode(email) {
  if (!fs.existsSync(MAIL_FILE)) return null;
  var rows = fs.readFileSync(MAIL_FILE, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  var mail = rows.filter(function (x) { return x.message && x.message.to === email; }).slice(-1)[0];
  var m = mail && String(mail.message.text || '').match(/verification code is (\d{6})/i);
  return m ? m[1] : null;
}
function register(name, email) {
  return call('POST', '/api/free2027/register/start', { name: name, email: email, course: 'Medicine and Surgery', password: 'AdaPass-2027' })
    .then(function (r) {
      var code = mailedCode(email);
      if (!r.body || r.status !== 200 || !code) return Promise.reject(new Error('verification email unavailable: ' + r.raw));
      return call('POST', '/api/free2027/register/verify', { email: email, code: code });
    });
}
function adminLogin(id, password, passcode) {
  return call('POST', '/api/auth/login', { id: id, password: password }).then(function (r) {
    var token = r.body && r.body.token;
    if (!token) return Promise.reject(new Error('staff login failed: ' + r.raw));
    return call('POST', '/api/auth/unlock', { passcode: passcode }, token).then(function (u) {
      if (u.status !== 200) return Promise.reject(new Error('unlock failed: ' + u.raw));
      return token;
    });
  });
}

(async function () {
  try {
    await new Promise(function (r) { stubServer.listen(STUB_PORT, '127.0.0.1', r); });

    /* ------------------------------------------------ first run */
    var h = await bootApp();
    head('the edition opens locally while the Appwrite Database API refuses everything');
    ok('the server is up', h.status === 200, h.raw + ' ' + log.slice(-300));
    ok('the edition is on', h.body && h.body.free2027 && h.body.free2027.on === true, h.raw);
    ok('health says where the edition keeps its records', h.body.free2027.storage === 'local-json', JSON.stringify(h.body.free2027));
    ok('and names the local file it uses', h.body.free2027.storageFile === DATA_FILE, h.body.free2027.storageFile);
    ok('the boot log says the edition is local, not Appwrite', /2027 Free Tutorial: ON — records in .*data\.json \(no Appwrite Database\)/.test(log), log.slice(-400));

    /* from here on, only requests made BY the free tutorial count */
    stub.hits = 0; stub.databaseHits = 0; stub.paths = [];

    var reg = await register('Ada Obi', 'ada@example.com');
    ok('a candidate registers without Appwrite and receives the first sequential student ID', reg.status === 200 && reg.body.participant.id === 'GOC-F-001', reg.raw);
    var ada = reg.body.token;

    var prog0 = await call('GET', '/api/free2027/programme', undefined, ada);
    ok('the programme record is read locally', prog0.status === 200 && prog0.body.profile.id === reg.body.participant.id, prog0.raw.slice(0, 200));
    ok('it carries the course enrolment', prog0.body.enrolment.course === 'Medicine and Surgery' && prog0.body.enrolment.status === 'enrolled', JSON.stringify(prog0.body.enrolment));
    ok('it carries the programme access', prog0.body.access.status === 'active' && /free-tutorial/.test(prog0.body.access.programme), JSON.stringify(prog0.body.access));

    var founder = await adminLogin('GOC-A-001', 'local-founder-2027', '481516');
    var acad = await adminLogin('GOC-A-002', 'local-acaddir-2027', '481516');
    ok('the Founder signs in against the local staff record', !!founder);
    ok('the Academic Director signs in against the local staff record', !!acad);

    head('programme lessons: created by the two programme administrators');
    var l1 = await call('POST', '/api/free2027/admin/lessons', { title: 'Cell biology — the basics', subject: 'Biology', summary: 'Cells, membranes and division' }, founder);
    ok('the Founder adds a lesson', l1.status === 200 && /^F27-L-\d{3}$/.test(l1.body.lesson.id), l1.raw.slice(0, 200));
    var l2 = await call('POST', '/api/free2027/admin/lessons', { title: 'Organic chemistry — alkanes', subject: 'Chemistry' }, acad);
    ok('the Academic Director adds a lesson too', l2.status === 200 && l2.body.lesson.id !== l1.body.lesson.id, l2.raw.slice(0, 200));
    ok('a lesson without a title is refused', (await call('POST', '/api/free2027/admin/lessons', { title: 'x' }, founder)).status === 400);
    ok('a candidate cannot create lessons', (await call('POST', '/api/free2027/admin/lessons', { title: 'Sneaky lesson' }, ada)).status === 401);
    ok('an unknown lesson cannot be edited', (await call('PUT', '/api/free2027/admin/lessons/F27-L-999', { title: 'Ghost lesson' }, founder)).status === 404);

    var lessons = await call('GET', '/api/free2027/admin/lessons', undefined, acad);
    ok('both administrators read the same catalogue', lessons.body.lessons.length === 2, lessons.raw.slice(0, 200));

    head('the candidate works through the programme, and it is all stored locally');
    var prog1 = await call('GET', '/api/free2027/programme', undefined, ada);
    ok('the candidate sees both lessons, none done yet', prog1.body.progress.total === 2 && prog1.body.progress.completed === 0 &&
      prog1.body.progress.lessons.every(function (l) { return l.done === false; }), JSON.stringify(prog1.body.progress));
    var done1 = await call('POST', '/api/free2027/lessons/' + l1.body.lesson.id + '/complete', {}, ada);
    ok('marking a lesson done is accepted', done1.status === 200 && done1.body.completed === true && done1.body.already === false, done1.raw.slice(0, 200));
    ok('progress moves to one of two', done1.body.progress.completed === 1 && done1.body.progress.percent === 50, JSON.stringify(done1.body.progress));
    var again = await call('POST', '/api/free2027/lessons/' + l1.body.lesson.id + '/complete', {}, ada);
    ok('marking it again changes nothing (idempotent)', again.body.already === true && again.body.progress.completed === 1, again.raw.slice(0, 200));
    ok('an unknown lesson cannot be completed', (await call('POST', '/api/free2027/lessons/F27-L-999/complete', {}, ada)).status === 404);

    head('a paper is built from the edition\'s OWN question bank and marked without Appwrite');
    var imp = await call('POST', '/api/free2027/admin/question-banks/weekly/import', {
      csv: 'subject,topic,text,optionA,optionB,optionC,optionD,optionE,answer,difficulty,explanation,active,year,passageId\n' +
        'Physics,Motion,"A body accelerates uniformly from rest; which value fits a = 2 m/s^2 after 3 s?",3 m/s,6 m/s,9 m/s,12 m/s,,B,easy,"v = u + at = 6 m/s.",TRUE,,\n' +
        'Mathematics,Algebra,"Solve for x: 2x + 6 = 14",3,4,5,6,,C,easy,"2x = 8 so x = 4.",TRUE,,\n' +
        'Use of English,Vocabulary,"Choose the word nearest in meaning to CANDID",honest,brave,kind,gentle,,B,easy,"Candid means honest.",TRUE,,'
    }, founder);
    ok('questions import into the Weekly bank of the local data file', imp.status === 200 && imp.body.imported === 3, imp.raw.slice(0, 200));
    var pick = await call('GET', '/api/free2027/admin/questions?bank=weekly', undefined, founder);
    ok('the console picker reads the edition bank, never Appwrite', pick.status === 200 && pick.body.source === 'free2027-question-bank' && pick.body.questions.length === 3,
      pick.raw.slice(0, 220));
    ok('the picker says nothing about an answer key', !/answer/i.test(pick.raw) || pick.body.questions.every(function (q) { return q.answer === undefined; }));
    var ids = pick.body.questions.slice(0, 3).map(function (q) { return q.id; });
    var t = Date.now();
    var act = await call('POST', '/api/free2027/admin/activities', {
      kind: 'weekly', title: 'Week 1 — Local run', questionCount: ids.length,
      opensAt: t - 60000, closesAt: t + 3600000, durationMin: 15, maxAttempts: 1
    }, acad);
    ok('the Academic Director schedules a paper from the local bank', act.status === 200 && act.body.activity.status === 'draft', act.raw.slice(0, 220));
    await call('POST', '/api/free2027/admin/activities/' + act.body.activity.id + '/publish', {}, acad);
    var sit = await call('POST', '/api/free2027/activities/' + act.body.activity.id + '/start', {}, ada);
    ok('the candidate is served the paper', sit.status === 200 && sit.body.questions.length === 3, sit.raw.slice(0, 220));
    var resp = {};
    sit.body.questions.forEach(function (q) { resp[q.id] = 0; });
    var sub = await call('POST', '/api/free2027/attempts/' + sit.body.attempt.id + '/submit', { responses: resp }, ada);
    ok('the paper is marked by the hub engine, locally', sub.status === 200 && typeof sub.body.result.score === 'number', sub.raw.slice(0, 220));
    var prog2 = await call('GET', '/api/free2027/programme', undefined, ada);
    ok('the candidate\'s programme counts the quiz', prog2.body.quizzes.submitted === 1 && prog2.body.quizzes.average !== null, JSON.stringify(prog2.body.quizzes));

    head('the console reads progress and the programme audit trail');
    var pr = await call('GET', '/api/free2027/admin/progress', undefined, founder);
    ok('the progress view lists the candidate', pr.status === 200 && pr.body.participants.length === 1 &&
      pr.body.participants[0].lessonsDone === 1 && pr.body.participants[0].quizzes === 1, pr.raw.slice(0, 260));
    var audit = await call('GET', '/api/free2027/admin/audit', undefined, acad);
    var actions = ((audit.body && audit.body.entries) || []).map(function (e) { return e.action; });
    ok('every administrative change is recorded', audit.status === 200 &&
      actions.indexOf('lesson.create') > -1 && actions.indexOf('activity.create') > -1 &&
      actions.indexOf('activity.publish') > -1, actions.join(','));
    ok('the audit names the administrator, never a secret',
      audit.body.entries.every(function (e) { return !!e.actorId && !/@/.test(JSON.stringify(e)) && !/481516/.test(JSON.stringify(e)); }),
      JSON.stringify(audit.body.entries.slice(0, 2)));
    ok('a candidate cannot read the audit trail', (await call('GET', '/api/free2027/admin/audit', undefined, ada)).status === 401);

    head('strict isolation: the edition never touches the Appwrite Database');
    await new Promise(function (r) { setTimeout(r, 700); });   /* let any fire-and-forget call land */
    ok('no Database request was made during the whole free-tutorial flow', stub.databaseHits === 0,
      stub.databaseHits + ' — ' + stub.paths.slice(0, 6).join(' | '));
    var hubQuestions = await call('GET', '/api/questions?section=practice&kind=objective', undefined, founder);
    ok('the hub\'s own question route still goes to Appwrite (nothing was disabled globally)',
      hubQuestions.status !== 200, hubQuestions.status + ' ' + hubQuestions.raw.slice(0, 160));
    ok('and that is what the edition would have hit without its own route', stub.databaseHits > 0, stub.databaseHits);

    head('everything is on disk, under db.free2027 and the archive folder');
    var disk = dataFile();
    ok('the participant is in the local data file', disk.free2027.sessions[0].participants.length === 1, JSON.stringify(disk.free2027.sessions[0].participants.length));
    ok('the lessons are in the local data file', disk.free2027.sessions[0].lessons.length === 2);
    ok('the completion stamp is stored on the participant',
      !!disk.free2027.sessions[0].participants[0].progress.lessons[l1.body.lesson.id], JSON.stringify(disk.free2027.sessions[0].participants[0].progress));
    ok('the audit trail is in the local data file', disk.free2027.sessions[0].audit.length >= 3);
    ok('no data file was written inside the app folder', !fs.existsSync(path.join(SANDBOX, 'server', 'data.json')));
    var arch = await call('POST', '/api/free2027/admin/sessions/new', { label: 'Term Two', confirm: true }, founder);
    ok('a session archives to its own local file', arch.status === 200 &&
      fs.existsSync(path.join(DATA, 'free2027-archives', arch.body.archive.file)), arch.raw.slice(0, 200));
    var arc = JSON.parse(fs.readFileSync(path.join(DATA, 'free2027-archives', arch.body.archive.file), 'utf8'));
    ok('the archive holds the lessons and the audit trail, not only the papers',
      arc.session.lessons.length === 2 && arc.session.audit.length >= 3, JSON.stringify({ l: arc.session.lessons.length, a: arc.session.audit.length }));

    /* ------------------------------------------------ restart: a new session
       The archive took the first session; the candidate registers again in the
       new one. What must survive is the file itself: the lessons, the previous
       session, the audit and the archived records. */
    head('restarting the server keeps every programme record');
    await stopApp();
    var h2 = await bootApp();
    ok('the server comes back on the same data folder', h2.status === 200, h2.raw + ' ' + log.slice(-300));
    var reg2 = await register('Ada Obi', 'ada@example.com');
    ok('the candidate registers again and keeps their participant ID', reg2.status === 200 && reg2.body.participant.id === reg.body.participant.id,
      reg2.raw.slice(0, 200));
    var disk2 = dataFile();
    var archivePath = path.join(DATA, 'free2027-archives', arch.body.archive.file);
    ok('the archive file is still on disk after the restart', fs.existsSync(archivePath), archivePath);
    ok('the live session is the new, empty one the archive opened',
      disk2.free2027.sessions.length === 1 && disk2.free2027.sessions[0].id === arch.body.session.id,
      JSON.stringify(disk2.free2027.sessions.map(function (x) { return x.id; })));
    ok('and the re-registered candidate is in it, with an empty lesson sheet',
      disk2.free2027.sessions[0].participants.length === 1 && disk2.free2027.sessions[0].lessons.length === 0 &&
      Object.keys(disk2.free2027.sessions[0].participants[0].progress.lessons).length === 0,
      JSON.stringify({ p: disk2.free2027.sessions[0].participants.length, l: disk2.free2027.sessions[0].lessons.length }));
    var arcAfter = JSON.parse(fs.readFileSync(archivePath, 'utf8'));
    ok('the archived session still holds its participants, lessons and audit trail',
      arcAfter.session.participants.length === 1 && arcAfter.session.lessons.length === 2 && arcAfter.session.audit.length >= 3,
      JSON.stringify({ p: arcAfter.session.participants.length, l: arcAfter.session.lessons.length, a: arcAfter.session.audit.length }));
    var admAfter = await adminLogin('GOC-A-001', 'local-founder-2027', '481516');
    ok('the archive list survives the restart', (await call('GET', '/api/free2027/admin/archives', undefined, admAfter)).body.archives.length === 1);
    ok('and the archived programme record is readable back through the console',
      (await call('GET', '/api/free2027/admin/archives/' + arch.body.archive.file, undefined, admAfter)).status === 200);

    /* ------------------------------------------- GOC_APPWRITE_OFF=1: no client */
    head('GOC_APPWRITE_OFF=1 makes the whole box local, with no Appwrite call at all');
    await stopApp();
    stub.hits = 0; stub.databaseHits = 0; stub.paths = [];
    var h3 = await bootApp({ GOC_APPWRITE_OFF: '1' });
    ok('the server boots local-only', h3.status === 200, h3.raw + ' ' + log.slice(-300));
    ok('the boot log says Appwrite is not contacted', /GOC_APPWRITE_OFF is set — running fully local/.test(log), log.slice(-400));
    var f3 = await adminLogin('GOC-A-001', 'local-founder-2027', '481516');
    var q3 = await call('GET', '/api/questions?section=practice&kind=objective', undefined, f3);
    ok('the hub\'s own question route now answers from the local bank too', q3.status === 200 && q3.body.questions.length > 0, q3.status + ' ' + q3.raw.slice(0, 160));
    ok('the edition still works', (await call('GET', '/api/free2027/admin/questions?bank=weekly', undefined, f3)).body.questions.length > 0);
    await new Promise(function (r) { setTimeout(r, 600); });
    ok('not a single Appwrite request was made in that run', stub.hits === 0, stub.hits + ' — ' + stub.paths.slice(0, 6).join(' | '));

    head('the original hub is untouched by all of this');
    ok('staff, questions and students are exactly as they were',
      dataFile().staff.length >= 2 && dataFile().questions.length > 0 && Array.isArray(dataFile().students));
    ok('the hub still serves its own screens', (await new Promise(function (resolve) {
      http.get({ host: '127.0.0.1', port: PORT, path: '/' }, function (res) {
        var b = ''; res.on('data', function (c) { b += c; }); res.on('end', function () { resolve(res.statusCode === 200 && /id="study"/.test(b)); });
      }).on('error', function () { resolve(false); });
    })));
  } catch (e) {
    fails++;
    console.log('  FAIL  ' + (e && e.stack ? e.stack.split('\n').slice(0, 3).join(' ') : e));
    if (log) console.log('\nserver log tail:\n' + log.slice(-1500));
  } finally {
    await stopApp();
    try { stubServer.close(); } catch (e) {}
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
    console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
    process.exit(fails ? 1 : 0);
  }
})();
