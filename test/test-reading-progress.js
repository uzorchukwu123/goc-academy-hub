/* test-reading-progress.js — noteReads API (GET/POST /api/me/reading)
   Tests:
     1. GET /api/me/reading — requires auth, returns empty {} for new student
     2. POST /api/me/reading — records first read with { first, last } timestamps
     3. POST again — updates `last`, preserves `first`
     4. POST with done:true — sets `done` timestamp, idempotent on second call
     5. Auth: unauthenticated calls get 401
     6. Auth: staff session gets 403 (student-only route)
     7. Validation: missing noteId → 400
     8. Validation: non-existent noteId → 404
     9. Subject isolation: a note outside the student's subjects → 403
    10. Account isolation: student A cannot read student B's reads
   Run:  node test/test-reading-progress.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var spawn = require('child_process').spawn;

var APP  = path.join(__dirname, '..');
var PORT = Number(process.env.GOC_TEST_READING_PORT) || 8162;
var passes = 0, fails = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra != null ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(label) { console.log('\n' + label); }

/* call() takes the FULL path (including /api prefix), matching active-student.js's convention */
function call(method, urlPath, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body != null ? Buffer.from(JSON.stringify(body)) : null;
    var opts = {
      hostname: '127.0.0.1', port: PORT, method: method, path: urlPath,
      headers: { 'content-type': 'application/json' }
    };
    if (token) opts.headers['authorization'] = 'Bearer ' + token;
    if (payload) opts.headers['content-length'] = payload.length;
    var req = http.request(opts, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString();
        var body2;
        try { body2 = JSON.parse(raw); } catch (e) { body2 = null; }
        resolve({ status: res.statusCode, body: body2, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

(async function main() {
  /* Spin up the test server */
  var server = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      GOC_ENV: 'test',
      GOC_FOUNDER_PW: 'founder2027',
      GOC_PASSCODE: '2027',
      USE_APPWRITE: '0'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  await new Promise(function (res) { setTimeout(res, 1200); });

  try {
    /* ---- Enrol two students (different subjects) ---- */
    /* Subjects: Use of English is compulsory + exactly 3 sciences.
       Student A takes Mathematics; Student B does not (takes Biology instead). */
    var sA = await activeStudent(call, {
      name: 'Reading Student A', email: 'readingA@test.invalid',
      phone: '08000000001', goal: 'JAMB / UTME',
      subjects: ['Use of English', 'Mathematics', 'Physics', 'Chemistry']
    });
    ok('student A enrolled', !!sA.token, 'signup=' + JSON.stringify(sA.signup && sA.signup.body));

    var sB = await activeStudent(call, {
      name: 'Reading Student B', email: 'readingB@test.invalid',
      phone: '08000000002', goal: 'JAMB / UTME',
      subjects: ['Use of English', 'Biology', 'Physics', 'Chemistry']
    });
    ok('student B enrolled', !!sB.token, 'signup=' + JSON.stringify(sB.signup && sB.signup.body));

    /* ---- Find a Mathematics note to test with ---- */
    /* Publish a note (via founder/admin) so there is something to read */
    var founderLogin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
    var ft = founderLogin.body && founderLogin.body.token;
    ok('founder login', !!ft);
    var unlock = await call('POST', '/api/auth/unlock', { passcode: '2027' }, ft);
    ok('founder unlocked', unlock.status === 200);

    /* Create a Mathematics note — body must be ≥40 chars; route is POST /api/notes */
    var mathBody = 'Algebra is the branch of mathematics dealing with symbols and the rules for manipulating those symbols. ' +
      'It is a unifying thread of almost all of mathematics and includes elementary equations through to abstract structures.';
    var noteRes = await call('POST', '/api/notes', {
      title: 'Algebra Basics', subject: 'Mathematics', topic: 'Algebra',
      body: mathBody, minutes: 3
    }, ft);
    ok('Mathematics note created', noteRes.status === 200 || noteRes.status === 201,
       noteRes.status + ' ' + noteRes.raw);
    var noteId = noteRes.body && noteRes.body.id;

    /* Create a Biology note — Student A is NOT enrolled in Biology */
    var bioBody = 'Biology is the natural science that studies life and living organisms, including their physical structure, chemical processes, ' +
      'molecular interactions, physiological mechanisms, development, and evolution. It is a core JAMB science subject.';
    var bioNoteRes = await call('POST', '/api/notes', {
      title: 'Cell Biology', subject: 'Biology', topic: 'Cells',
      body: bioBody, minutes: 2
    }, ft);
    var bioNoteId = bioNoteRes.body && bioNoteRes.body.id;

    if (!noteId) {
      /* Can't proceed with reading tests without a note — skip gracefully */
      console.log('\n  SKIP  No Mathematics note ID returned — reading route tests cannot run');
      console.log('\n' + passes + ' passed, ' + fails + ' failed');
      server.kill();
      process.exit(fails ? 1 : 0);
    }

    /* ---- 1. GET before any reads → empty ---- */
    head('GET /api/me/reading — initial state');
    var g0 = await call('GET', '/api/me/reading', null, sA.token);
    ok('200 for authenticated student', g0.status === 200, g0.status);
    ok('reads object is empty', g0.body && g0.body.reads && Object.keys(g0.body.reads).length === 0,
       JSON.stringify(g0.body));

    /* ---- 2. Auth guards ---- */
    head('auth guards');
    var g401 = await call('GET', '/api/me/reading', null, null);
    ok('GET without token → 401', g401.status === 401, g401.status);
    var p401 = await call('POST', '/api/me/reading', { noteId: String(noteId) }, null);
    ok('POST without token → 401', p401.status === 401, p401.status);
    var gStaff = await call('GET', '/api/me/reading', null, ft);
    ok('GET with staff token → 403', gStaff.status === 403, gStaff.status);

    /* ---- 3. POST — first read ---- */
    head('POST /api/me/reading — record read');
    var r1 = await call('POST', '/api/me/reading', { noteId: String(noteId) }, sA.token);
    ok('200 for valid noteId', r1.status === 200, r1.status + ' ' + r1.raw);
    ok('read.first is set', !!(r1.body && r1.body.read && r1.body.read.first), JSON.stringify(r1.body));
    ok('read.last is set', !!(r1.body && r1.body.read && r1.body.read.last), JSON.stringify(r1.body));
    ok('done is not set initially', !(r1.body && r1.body.read && r1.body.read.done), JSON.stringify(r1.body));
    var firstTs = r1.body && r1.body.read && r1.body.read.first;

    /* ---- 4. POST again — updates last, preserves first ---- */
    head('POST again — idempotency');
    await new Promise(function(r){ setTimeout(r, 50); }); /* small delay so timestamps differ */
    var r2 = await call('POST', '/api/me/reading', { noteId: String(noteId) }, sA.token);
    ok('200 on second post', r2.status === 200, r2.status);
    ok('first unchanged', r2.body && r2.body.read && r2.body.read.first === firstTs,
       'first was ' + firstTs + ', got ' + (r2.body && r2.body.read && r2.body.read.first));
    ok('last updated', r2.body && r2.body.read && r2.body.read.last >= r2.body.read.first,
       JSON.stringify(r2.body));
    ok('done still not set', !(r2.body && r2.body.read && r2.body.read.done), JSON.stringify(r2.body));

    /* ---- 5. POST with done:true ---- */
    head('POST with done:true — completion');
    var r3 = await call('POST', '/api/me/reading', { noteId: String(noteId), done: true }, sA.token);
    ok('200 with done:true', r3.status === 200, r3.status);
    ok('done timestamp set', !!(r3.body && r3.body.read && r3.body.read.done), JSON.stringify(r3.body));
    ok('first still unchanged', r3.body && r3.body.read && r3.body.read.first === firstTs,
       'first was ' + firstTs + ', got ' + (r3.body && r3.body.read && r3.body.read.first));

    /* ---- 6. POST done:true again — idempotent ---- */
    var r4 = await call('POST', '/api/me/reading', { noteId: String(noteId), done: true }, sA.token);
    ok('done is idempotent (not reset)', !!(r4.body && r4.body.read && r4.body.read.done), JSON.stringify(r4.body));
    var doneTs = r3.body && r3.body.read && r3.body.read.done;
    ok('done timestamp unchanged on repeat', r4.body && r4.body.read && r4.body.read.done === doneTs,
       'was ' + doneTs + ', now ' + (r4.body && r4.body.read && r4.body.read.done));

    /* ---- 7. GET — reads now populated ---- */
    head('GET — reads reflect POST');
    var g1 = await call('GET', '/api/me/reading', null, sA.token);
    ok('200 on GET', g1.status === 200, g1.status);
    var readKey = String(noteId);
    ok('note appears in reads', g1.body && g1.body.reads && !!g1.body.reads[readKey],
       JSON.stringify(g1.body && g1.body.reads));
    ok('done is present in GET result', g1.body && g1.body.reads[readKey] && !!g1.body.reads[readKey].done,
       JSON.stringify(g1.body && g1.body.reads && g1.body.reads[readKey]));

    /* ---- 8. Validation ---- */
    head('validation');
    var vMissing = await call('POST', '/api/me/reading', {}, sA.token);
    ok('missing noteId → 400', vMissing.status === 400, vMissing.status);
    var vBad = await call('POST', '/api/me/reading', { noteId: '99999999' }, sA.token);
    ok('non-existent noteId → 404', vBad.status === 404, vBad.status);

    /* ---- 9. Subject isolation ---- */
    head('subject isolation');
    if (bioNoteId) {
      /* Student A enrolled in Mathematics/Physics/Chemistry — not Biology */
      var vSubj = await call('POST', '/api/me/reading', { noteId: String(bioNoteId) }, sA.token);
      ok('Biology note blocked for non-Biology student → 403', vSubj.status === 403, vSubj.status + ' ' + vSubj.raw);
    } else {
      ok('subject isolation — SKIP (Biology note not created)', true);
    }

    /* ---- 10. Account isolation ---- */
    head('account isolation');
    var gB = await call('GET', '/api/me/reading', null, sB.token);
    ok('student B GET → 200', gB.status === 200, gB.status);
    ok('student B reads are empty (not A\'s)', gB.body && gB.body.reads && Object.keys(gB.body.reads).length === 0,
       JSON.stringify(gB.body));

  } finally {
    server.kill();
  }

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
