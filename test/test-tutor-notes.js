/* test-tutor-notes.js — Phase 3C slice 6.5: tutor notes (live at once, own subject and own notes only),
   on the real server over HTTP.
   node test/test-tutor-notes.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_TNOTE_PORT) || 8175;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

/* ---- the real server ---- */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tnote-test-'));
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
  var BODY = 'ZQXNOTE Acids donate hydrogen ions in water. A strong acid ionises completely, a weak acid only partly.';
  var good = { subject: 'Chemistry', topic: 'Acids and bases', title: 'Strong and weak acids', body: BODY };

  console.log('\nwho may use the tutor note routes');
  ok('no session is refused', (await call('GET', '/api/tutor/notes')).status === 401);
  ok('a student is refused', [401, 403].indexOf((await call('GET', '/api/tutor/notes', null, gTok)).status) > -1 && [401, 403].indexOf((await call('POST', '/api/tutor/notes', good, gTok)).status) > -1);
  ok('management is refused (not a tutor)', (await call('POST', '/api/tutor/notes', good, adm)).status === 403);

  console.log('\nwriting a note');
  var before = (await call('GET', '/api/tutor/subject?subject=Chemistry', null, chem.token)).body.depth.notes;
  var c1 = await call('POST', '/api/tutor/notes', Object.assign({ addedBy: 'GOC-A-001', addedByName: 'The Founder', id: 9999 }, good), chem.token);
  ok('a good note is accepted', c1.status === 200 && c1.body.created && c1.body.note.id > 0, c1.raw);
  var n1 = c1.body.note;
  ok('it is stamped with the tutor and a time, and is live', n1.addedBy === chem.id && n1.addedByName === 'Mrs Ada Obi' && /^\d{4}-/.test(n1.addedAt) && n1.active === true, JSON.stringify(n1));
  ok('a forged author or id in the body is ignored', n1.id !== 9999 && n1.addedBy !== 'GOC-A-001');
  ok('a note that is too short is refused with the console\'s own reason', /too short/.test((await call('POST', '/api/tutor/notes', Object.assign({}, good, { body: 'tiny' }), chem.token)).body.error || ''));
  ok('a tutor cannot write for a subject they do not teach', (await call('POST', '/api/tutor/notes', Object.assign({}, good, { subject: 'Physics' }), chem.token)).status === 403);
  ok('the paper depth now counts the note', (await call('GET', '/api/tutor/subject?subject=Chemistry', null, chem.token)).body.depth.notes === before + 1);

  console.log('\nstudents see it at once, without the author');
  var mine = await call('GET', '/api/me/notes?subject=Chemistry', null, gTok);
  var seen = (mine.body.notes || []).filter(function (n) { return n.id === n1.id; })[0];
  ok('a GOC student can read the new note', seen && seen.body === BODY, mine.raw.slice(0, 200));
  ok('the student never receives the tutor\'s ID, name or time', seen && seen.addedBy === undefined && seen.addedByName === undefined && seen.addedAt === undefined && seen.editedAt === undefined);

  console.log('\nthe list');
  var l = await call('GET', '/api/tutor/notes?subject=Chemistry', null, chem.token);
  ok('a tutor sees their own notes with counts', l.status === 200 && l.body.counts.live >= 1 && l.body.notes.some(function (n) { return n.id === n1.id; }));
  ok('a Chemistry tutor cannot list Physics', (await call('GET', '/api/tutor/notes?subject=Physics', null, chem.token)).status === 403);
  var adminNote = (await call('POST', '/api/notes', { subject: 'Chemistry', topic: 'Salts', title: 'Soluble salts', body: 'Admin note: all sodium, potassium and ammonium salts are soluble in water, always.' }, adm)).body;
  ok('a note the admin wrote is not in the tutor\'s list', !(await call('GET', '/api/tutor/notes?subject=Chemistry', null, chem.token)).body.notes.some(function (n) { return n.id === adminNote.id; }));

  console.log('\nchanging notes');
  var ed = await call('PUT', '/api/tutor/notes/' + n1.id, { subject: 'Chemistry', topic: 'Acids and bases', title: 'Strong and weak acids (revised)', body: BODY + ' Revised.', addedBy: 'GOC-T-099' }, chem.token);
  ok('a tutor can edit their own note', ed.status === 200 && ed.body.note.title === 'Strong and weak acids (revised)', ed.raw);
  ok('the author and first-added time are kept and an edit time is added', ed.body.note.addedBy === chem.id && ed.body.note.addedAt === n1.addedAt && /^\d{4}-/.test(ed.body.note.editedAt));
  ok('the edit is live for students at once', ((await call('GET', '/api/me/notes?subject=Chemistry', null, gTok)).body.notes || []).some(function (n) { return n.id === n1.id && /Revised/.test(n.body); }));
  ok('another tutor cannot edit it', (await call('PUT', '/api/tutor/notes/' + n1.id, good, phys.token)).status === 404);
  ok('a tutor cannot edit the admin\'s note', (await call('PUT', '/api/tutor/notes/' + adminNote.id, good, chem.token)).status === 404);
  ok('a tutor cannot move their note into a subject they do not teach', (await call('PUT', '/api/tutor/notes/' + n1.id, Object.assign({}, good, { subject: 'Physics' }), chem.token)).status === 403);
  var ad = await call('PUT', '/api/notes/' + n1.id, { title: 'Strong and weak acids (admin tidy)' }, adm);
  ok('the console can still edit it, and the author stamp survives', ad.status === 200 && ad.body.addedBy === chem.id && ad.body.addedByName === 'Mrs Ada Obi');
  ok('the console list shows who wrote it', (await call('GET', '/api/notes?subject=Chemistry', null, adm)).body.notes.some(function (n) { return n.id === n1.id && n.addedByName === 'Mrs Ada Obi'; }));

  console.log('\nhold back, put back, delete');
  ok('deleting a live note is refused', (await call('DELETE', '/api/tutor/notes/' + n1.id, null, chem.token)).status === 400);
  ok('a bad switch is refused', (await call('PUT', '/api/tutor/notes/' + n1.id + '/active', { active: 'no' }, chem.token)).status === 400);
  ok('another tutor cannot switch it', (await call('PUT', '/api/tutor/notes/' + n1.id + '/active', { active: false }, phys.token)).status === 404);
  ok('the tutor holds it back', (await call('PUT', '/api/tutor/notes/' + n1.id + '/active', { active: false }, chem.token)).body.note.active === false);
  ok('students no longer see it', !((await call('GET', '/api/me/notes?subject=Chemistry', null, gTok)).body.notes || []).some(function (n) { return n.id === n1.id; }));
  ok('the tutor puts it back live', (await call('PUT', '/api/tutor/notes/' + n1.id + '/active', { active: true }, chem.token)).body.note.active === true);
  await call('PUT', '/api/tutor/notes/' + n1.id + '/active', { active: false }, chem.token);
  ok('another tutor cannot delete it', (await call('DELETE', '/api/tutor/notes/' + n1.id, null, phys.token)).status === 404);
  ok('the tutor deletes a held-back note', (await call('DELETE', '/api/tutor/notes/' + n1.id, null, chem.token)).body.deleted === n1.id);
  ok('it is gone for good', !readDb().notes.some(function (n) { return n.id === n1.id; }));
  await call('PUT', '/api/notes/' + adminNote.id + '/active', { active: false }, adm);
  ok('a tutor cannot delete the admin\'s note, even held back', (await call('DELETE', '/api/tutor/notes/' + adminNote.id, null, chem.token)).status === 404 && readDb().notes.some(function (n) { return n.id === adminNote.id; }));

  console.log('\nswitched-off tutor');
  await call('PUT', '/api/tutors/' + chem.id + '/active', { active: false }, adm);
  ok('a switched-off tutor can no longer write', [401, 403].indexOf((await call('POST', '/api/tutor/notes', good, chem.token)).status) > -1);

  stop();
  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); console.log(serverLog); stop(); process.exit(1); });
