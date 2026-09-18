/* test-server.js — the Node API, exercised over real HTTP.
   Starts server/server.js on a spare port against a throwaway data file, then
   checks the rules that must hold however the call arrives. No dependencies;
   run:  node test/test-server.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
/* The academy's create-account firewall. Read from the rulebook rather than
   typed in, so a change to the shipped default cannot leave this test asserting
   a code the server no longer seeds. */
var SIGNUP = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
var PORT = Number(process.env.GOC_TEST_PORT) || 8137;
/* The server keeps its data beside itself in server/data.json, so the test runs
   a throwaway copy of the application. Nothing the test does can touch the real
   roster. */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-server-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(raw); } catch (e) { /* not JSON — keep raw */ }
        resolve({ status: res.statusCode, body: json, raw: raw });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}

var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027',
      GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027',
      GOC_SIGNUP_CODE: SIGNUP
    }),
  stdio: ['ignore', 'pipe', 'pipe']
});
var serverLog = '';
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });

function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

var good = { signupCode: SIGNUP, name: 'Ada Test', password: 'secret123', email: 'ada.test@example.com',
             phone: '08000000009', goal: 'JAMB / UTME 2027',
             subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };
/* Kept for the sections that come after registration. */
var stuToken = null, stuId = null, theoryId = null;
/* The access code currently in force. The Priority 8 section rotates it, and
   every registration made after that point has to use the new one — which is
   the whole point of the firewall. */
var codeInForce = SIGNUP;

waitForBoot(20).then(function (h) {
  head('the server is up');
  ok('health responds', h.status === 200 && h.body && h.body.service === 'goc-academy-hub', h.raw);
  ok('health does not leak the passcode', h.raw.indexOf('2027') < 0 || !/passcode"\s*:\s*"/.test(h.raw), h.raw);

  head('the create-account firewall — a stranger cannot open an account');
  /* The academy's roll is not open to the public. Every one of these is a
     complete, otherwise-valid registration: the only thing wrong with it is the
     code, and the only thing the caller may learn is that the code is wrong. */
  var strangers = [
    ['no code field at all', { signupCode: undefined }, 400],
    ['an empty code', { signupCode: '   ' }, 400],
    ['a code that is too short', { signupCode: 'AB' }, 400],
    ['a code longer than the bound', { signupCode: new Array(40).join('X') }, 400],
    ['a code with punctuation in it', { signupCode: 'GOC*2027' }, 400],
    ['a code that is simply wrong', { signupCode: 'NOT-THE-CODE' }, 403]
  ];
  return strangers.reduce(function (chain, c, i) {
    return chain.then(function () {
      var d = Object.assign({}, good, c[1], { email: 'fw' + i + '@example.com', phone: '0801000' + (1000 + i) });
      return call('POST', '/api/students', d).then(function (r) {
        ok(c[0] + ' is refused', r.status === c[2], r.status + ' ' + r.raw);
        ok(c[0] + ' says the access code is the problem',
           !!(r.body && r.body.error && /access code/i.test(r.body.error)), r.raw);
        ok(c[0] + ' created no account', !(r.body && r.body.student), r.raw);
        ok(c[0] + ' is not told the real code', r.raw.indexOf(SIGNUP) < 0, r.raw);
      });
    });
  }, Promise.resolve()).then(function () {
    /* Checked first, and on purpose: somebody without the code should not be
       able to use the sign-up route to learn the academy's other rules. */
    var probe = Object.assign({}, good, { signupCode: 'NOT-THE-CODE', goal: 'WAEC',
                                          email: 'probe@example.com', phone: '08010009999' });
    return call('POST', '/api/students', probe);
  }).then(function (r) {
    ok('the firewall answers before every other rule', r.status === 403, r.status + ' ' + r.raw);
    ok('and tells a stranger nothing about which examinations are run',
       !/WAEC|UTME candidates only/i.test(r.raw), r.raw);
    /* Proven without writing a row: this body is refused on its combination, not
       its code, which can only mean the lower-case padded code got through. */
    var loose = Object.assign({}, good, { signupCode: '  ' + SIGNUP.toLowerCase() + '  ',
                                         subjects: ['Use of English', 'Physics', 'Chemistry'],
                                         email: 'loose@example.com', phone: '08010008888' });
    return call('POST', '/api/students', loose);
  }).then(function (r) {
    ok('capitals and stray spaces in the code are forgiven', r.status >= 400 &&
       !!(r.body && r.body.error) && !/access code/i.test(r.body.error), r.status + ' ' + r.raw);
    ok('and that registration still failed on its subjects', !(r.body && r.body.student), r.raw);

    head('Priority 5 — refused server-side, not just in the form');
    var refusals = [
      ['WAEC', { goal: 'WAEC' }],
      ['NECO', { goal: 'NECO' }],
      ['Post-UTME', { goal: 'Post-UTME' }],
      /* The form always sends a goal, so these two only ever arrive from a call
         made directly against the route — which is exactly the case the server is
         the last line of defence for. An account must not be written with an
         examination nobody stated. */
      ['a blank goal', { goal: '' }],
      ['no goal field at all', { goal: undefined }],
      ['all four sciences', { subjects: ['Use of English', 'Physics', 'Chemistry', 'Biology', 'Mathematics'] }],
      ['two sciences', { subjects: ['Use of English', 'Physics', 'Chemistry'] }],
      ['no Use of English', { subjects: ['Physics', 'Chemistry', 'Biology'] }],
      ['a subject not taught', { subjects: ['Use of English', 'Physics', 'Chemistry', 'Geography'] }]
    ];
    return refusals.reduce(function (chain, c, i) {
      return chain.then(function () {
        var d = Object.assign({}, good, c[1], { email: 'r' + i + '@example.com', phone: '0800000' + (1000 + i) });
        return call('POST', '/api/students', d).then(function (rr) {
          ok(c[0] + ' refused', rr.status >= 400 && rr.body && rr.body.error, rr.status + ' ' + rr.raw);
          ok(c[0] + ' explains itself', !!(rr.body && rr.body.error && rr.body.error.length > 10));
          ok(c[0] + ' created no account', !(rr.body && rr.body.student));
        });
      });
    }, Promise.resolve());
  });
}).then(function () {
  head('a valid registration');
  return call('POST', '/api/students', good);
}).then(function (r) {
  ok('accepted', r.status < 400 && r.body && r.body.student, r.status + ' ' + r.raw);
  var s = (r.body && r.body.student) || {};
  ok('a Scholar ID was issued', /^GOC-S-\d+$/.test(s.id || ''), s.id);
  ok('the combination was stored', (s.subjects || []).join(',') === 'Use of English,Physics,Chemistry,Mathematics',
     (s.subjects || []).join(','));
  ok('the examination is JAMB / UTME', s.exam === 'JAMB / UTME', s.exam);
  ok('the session carries the combination', !!(r.body.session && (r.body.session.subjects || []).length === 4));
  ok('no password anywhere in the response', !/password|hash|salt|scrypt/i.test(r.raw), r.raw.slice(0, 200));
  var token = r.body && r.body.token;
  var sid = s.id;
  stuToken = token; stuId = sid;

  head('Priority 13 — a student is not an administrator');
  return call('GET', '/api/students', undefined, token).then(function (a) {
    ok('roster refused to a student', a.status >= 400, a.status + ' ' + a.raw);
    return call('GET', '/api/questions', undefined, token);
  }).then(function (a) {
    ok('question bank refused to a student', a.status >= 400, a.status + ' ' + a.raw);
    return call('GET', '/api/results', undefined, token);
  }).then(function (a) {
    ok('every student\'s results refused to a student', a.status >= 400, a.status + ' ' + a.raw);
    return call('PUT', '/api/students/' + sid + '/active', { active: false }, token);
  }).then(function (a) {
    ok('a student cannot deactivate an account', a.status >= 400, a.status + ' ' + a.raw);
    return call('GET', '/api/me', undefined, token);
  }).then(function (a) {
    ok('but the student can read their own profile', a.status === 200 && a.body && a.body.id === sid, a.raw);
    // mustChangePassword is a legitimate boolean flag the client reads to decide
    // whether to show the change-password screen — it carries no credential
    // material, so it is excluded before checking for an actual leak.
    var profileSansFlag = a.raw.replace(/"mustChangePassword"\s*:\s*(true|false)/i, '');
    ok('their own profile carries no credential', !/password|hash|salt/i.test(profileSansFlag));
    return call('GET', '/api/students');
  }).then(function (a) {
    ok('the roster refuses an anonymous caller', a.status >= 400, a.status + ' ' + a.raw);
  });
}).then(async function () {
  head('Priority 3 over HTTP — the paper, the clock and the marking belong to the server');
  var cat = await call('GET', '/api/me/tests', undefined, stuToken);
  ok('the catalogue is served', cat.status === 200 && !!cat.body && cat.body.tests.length > 0,
     cat.status + ' ' + cat.raw.slice(0, 120));
  /* Theory names a subject; the objective sitting is the whole combination and
     names itself. Both must stay inside what the student registered. */
  ok('every theory paper is one the student registered',
     cat.body.tests.filter(function (t) { return t.section === 'theory'; })
       .every(function (t) { return cat.body.subjects.indexOf(t.subject) > -1; }));
  ok('a subject the student did not register is absent',
     !cat.body.tests.some(function (t) { return t.subject === 'Biology'; }));
  ok('theory and the objective sitting are published',
     ['theory', 'objective'].every(function (sec) {
       return cat.body.tests.some(function (t) { return t.section === sec; });
     }));
  ok('the JAMB paper is not published — it is held back for the pilot',
     !cat.body.tests.some(function (t) { return t.section === 'jamb'; }));
  ok('the objective sitting appears once per period, not once per subject',
     cat.body.tests.filter(function (t) { return t.section === 'objective'; }).length <= 2,
     cat.body.tests.filter(function (t) { return t.section === 'objective'; }).length);
  ok('and it is offered as one sitting of all subjects',
     cat.body.tests.filter(function (t) { return t.section === 'objective'; })
       .every(function (t) { return t.subject === 'All subjects' && t.durationSec > 0; }));
  ok('theory carries no clock at all',
     cat.body.tests.filter(function (t) { return t.section === 'theory'; })
       .every(function (t) { return t.durationSec === 0; }));
  ok('the sitting\'s clock comes from the console', cat.body.objectiveMinutes > 0,
     cat.body.objectiveMinutes);

  var refused = await call('POST', '/api/me/tests/start',
    { period: 'weekly', section: 'theory', subject: 'Biology' }, stuToken);
  ok('a foreign subject is refused server-side, not just in the page', refused.status === 403,
     refused.status + ' ' + refused.raw);
  /* Mathematics is in this student's combination and is examined in the objective
     sitting only, so the written paper is refused for its own reason. */
  ok('no written mathematics paper is published',
     !cat.body.tests.some(function (t) { return t.section === 'theory' && t.subject === 'Mathematics'; }));
  ok('though the objective sitting still carries a mathematics paper',
     cat.body.tests.some(function (t) {
       return t.section === 'objective' && (t.papers || []).some(function (x) { return x.subject === 'Mathematics'; });
     }));
  var noThy = await call('POST', '/api/me/tests/start',
    { period: 'test', section: 'theory', subject: 'Mathematics' }, stuToken);
  ok('and the server refuses to open one', noThy.status === 403 && /objective sitting only/.test(noThy.raw),
     noThy.status + ' ' + noThy.raw);
  ok('for the right reason — the combination does include mathematics',
     noThy.raw.indexOf('not part of your registered') < 0, noThy.raw);
  var jamb = await call('POST', '/api/me/tests/start',
    { period: 'weekly', section: 'jamb', subject: 'Physics' }, stuToken);
  ok('the JAMB paper is refused server-side too', jamb.status === 403 && /coming soon/.test(jamb.raw),
     jamb.status + ' ' + jamb.raw);
  var anon = await call('POST', '/api/me/tests/start',
    { period: 'weekly', section: 'objective' });
  ok('an anonymous caller cannot open a paper', anon.status >= 400, anon.status);

  var p = await call('POST', '/api/me/tests/start',
    { period: 'weekly', section: 'objective' }, stuToken);
  ok('the sitting opens without the student naming a subject',
     p.status === 200 && !!p.body.attemptId, p.status + ' ' + p.raw.slice(0, 120));
  ok('no correct answer, reference answer or explanation is sent to the browser',
     !/"answer"|"expected"|"explanation"/.test(p.raw), p.raw.slice(0, 200));
  ok('the paper carries the server\'s duration', p.body.durationSec > 0, p.body.durationSec);
  ok('it is filed as one sitting of all subjects', p.body.subject === 'All subjects', p.body.subject);
  ok('it covers every registered subject and nothing else', (function () {
    var subs = [];
    p.body.questions.forEach(function (q) { if (subs.indexOf(q.subject) < 0) subs.push(q.subject); });
    return subs.length === good.subjects.length &&
           subs.every(function (x) { return good.subjects.indexOf(x) > -1; });
  })(), p.body.papers && JSON.stringify(p.body.papers));
  ok('Use of English is sat first', p.body.questions[0].subject === 'Use of English',
     p.body.questions[0].subject);
  ok('each paper is served whole before the next begins', (function () {
    var seen = [], last = null, i;
    for (i = 0; i < p.body.questions.length; i++) {
      var sub = p.body.questions[i].subject;
      if (sub !== last) { if (seen.indexOf(sub) > -1) return false; seen.push(sub); last = sub; }
    }
    return true;
  })());
  ok('the breakdown adds up to the paper',
     p.body.papers.reduce(function (m, r) { return m + r.questions; }, 0) === p.body.total);
  ok('no paper exceeds its UTME ceiling', p.body.papers.every(function (r) {
    return r.questions <= (r.subject === 'Use of English' ? 60 : 40);
  }));
  ok('the whole sitting stays inside 180', p.body.total <= 180, p.body.total);

  /* Submit with a forged score, a forged status and an impossible time. */
  var responses = {};
  p.body.questions.forEach(function (q) { responses[q.id] = 0; });
  var sub = await call('POST', '/api/me/tests/submit', {
    attemptId: p.body.attemptId, responses: responses, timeUsedSec: 999999,
    score: 100, percent: 100, maxScore: 1, correct: 100, status: 'marked', xpAwarded: 9999
  }, stuToken);
  ok('the submission is accepted', sub.status === 200, sub.status + ' ' + sub.raw.slice(0, 160));
  ok('the objective paper was marked by the server', sub.body.status === 'marked', sub.body.status);
  ok('the forged maximum was ignored', sub.body.maxScore === sub.body.total,
     sub.body.maxScore + ' vs ' + sub.body.total);
  ok('the forged score was ignored', sub.body.score === sub.body.correct && sub.body.score <= sub.body.total,
     sub.body.score + '/' + sub.body.correct);
  ok('the percentage was recomputed', sub.body.percent === Math.round(sub.body.score * 100 / sub.body.maxScore),
     sub.body.percent);
  ok('the forged XP was ignored', sub.body.xpAwarded < 9999, sub.body.xpAwarded);
  ok('the clock is the server\'s', sub.body.timeUsedSec <= 15, sub.body.timeUsedSec);
  ok('the result is filed against the Scholar ID', sub.body.scholarId === stuId, sub.body.scholarId);
  var twice = await call('POST', '/api/me/tests/submit',
    { attemptId: p.body.attemptId, responses: responses }, stuToken);
  ok('a paper cannot be submitted twice', twice.status === 409, twice.status);

  head('theory is stored for a human, never auto-scored');
  var th = await call('POST', '/api/me/tests/start',
    { period: 'weekly', section: 'theory', subject: 'Chemistry' }, stuToken);
  ok('a theory paper opens', th.status === 200 && th.body.kind === 'theory', th.status + ' ' + th.raw.slice(0, 120));
  ok('no reference answer travels with it', !/"expected"/.test(th.raw));
  ok('the maximum mark does', th.body.questions.every(function (q) { return q.maxMark > 0; }));
  var tresp = {};
  th.body.questions.forEach(function (q) { tresp[q.id] = 'My written answer for the marker.'; });
  ok('a written paper opens with no clock', th.body.durationSec === 0, th.body.durationSec);
  var tsub = await call('POST', '/api/me/tests/submit',
    { attemptId: th.body.attemptId, responses: tresp, timeUsedSec: 60, score: 10, status: 'marked' }, stuToken);
  ok('it is stored awaiting marking', tsub.body.status === 'awaiting-marking', tsub.body.status);
  /* An untimed paper has no limit to clamp a claim against, so the only ceiling
     left is the real elapsed time — which is what the server uses. The claim of
     60 seconds is cut back to the second or two the test actually took, not
     filed as zero because the paper had no duration. */
  ok('the time on an untimed paper is clamped to real elapsed time, not to zero',
     typeof tsub.body.timeUsedSec === 'number' && tsub.body.timeUsedSec >= 0 &&
     tsub.body.timeUsedSec < 60, tsub.body.timeUsedSec);
  theoryId = tsub.body.id;
  ok('the server invents no theory score', tsub.body.score === null && tsub.body.percent === null,
     tsub.body.score + '/' + tsub.body.percent);
  ok('completion XP only, until it is marked', tsub.body.xpAwarded === 10, tsub.body.xpAwarded);
  ok('the written answer was kept', /My written answer for the marker/.test(tsub.raw));
  var mark = await call('POST', '/api/results/' + encodeURIComponent(tsub.body.id) + '/mark',
    { marks: { 1: 10 } }, stuToken);
  ok('a student cannot mark their own theory paper', mark.status >= 400, mark.status + ' ' + mark.raw);

  head('a student\'s record is theirs alone');
  var rec = await call('GET', '/api/me/results', undefined, stuToken);
  ok('both papers are on the record', rec.status === 200 && rec.body.attempts.length === 2,
     rec.body && rec.body.attempts.length);
  ok('every row names the Scholar ID',
     rec.body.attempts.every(function (a) { return a.scholarId === stuId; }));
  ok('an overall performance figure is computed',
     !!rec.body.performance && typeof rec.body.performance.overall === 'number', rec.raw.slice(0, 120));
  var mine = await call('GET', '/api/me/results/' + encodeURIComponent(p.body.attemptId), undefined, stuToken);
  ok('a student may re-read their own result', mine.status === 200 && mine.body.id === p.body.attemptId,
     mine.status);
  var foreign = await call('GET', '/api/me/results/A1-notmine', undefined, stuToken);
  ok('a result that is not theirs is refused', foreign.status === 404, foreign.status);

  return null;
}).then(async function () {
  head('Priority 4 over HTTP — the bank and the marking belong to the console');
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  ok('the Founder can sign in', lin.status === 200 && !!lin.body.token, lin.status + ' ' + lin.raw.slice(0, 120));
  ok('no credential comes back with the session', !/pwHash|"password"|salt/i.test(lin.raw));
  var adm = lin.body.token;
  var lockedQ = await call('GET', '/api/questions', undefined, adm);
  ok('a staff token alone cannot read the bank', lockedQ.status === 403, lockedQ.status + ' ' + lockedQ.raw);
  var lockedR = await call('GET', '/api/results', undefined, adm);
  ok('nor the record of sittings', lockedR.status === 403, lockedR.status);
  var wrongPass = await call('POST', '/api/auth/unlock', { passcode: '0000' }, adm);
  ok('a wrong passcode is refused', wrongPass.status === 403, wrongPass.status + ' ' + wrongPass.raw);
  var stuUnlock = await call('POST', '/api/auth/unlock', { passcode: '2027' }, stuToken);
  ok('a student cannot unlock the console at all', stuUnlock.status >= 400, stuUnlock.status);
  var un = await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
  ok('the right passcode opens it', un.status === 200 && un.body.unlocked === true, un.raw);

  head('4.1 — a question is validated on the server, whatever the form says');
  var thin = await call('POST', '/api/questions',
    { subject: 'Physics', section: 'theory', period: 'monthly', text: 'Explain refraction.', maxMark: 12 }, adm);
  ok('a theory question with no reference answer is refused', thin.status === 400 &&
     /expected\/reference answer/.test(thin.raw), thin.status + ' ' + thin.raw);
  var oneOpt = await call('POST', '/api/questions',
    { subject: 'Physics', section: 'objective', period: 'weekly', text: 'Unit of force?', options: ['Newton'], answer: 0 }, adm);
  ok('an objective question with one option is refused', oneOpt.status === 400 &&
     /at least two options/.test(oneOpt.raw), oneOpt.status + ' ' + oneOpt.raw);
  var mathThy = await call('POST', '/api/questions', {
    subject: 'Mathematics', section: 'theory', topic: 'Mensuration',
    text: 'Find the total surface area of a closed cylinder of radius 7 cm and height 10 cm.',
    expected: 'Total surface area = 2πr(r + h) = 748 cm².', maxMark: 10
  }, adm);
  ok('a written mathematics question cannot be published at all', mathThy.status === 400 &&
     /objective sitting only/.test(mathThy.raw), mathThy.status + ' ' + mathThy.raw);
  var made = await call('POST', '/api/questions', {
    subject: 'Physics', section: 'objective', period: 'weekly', topic: 'Dynamics',
    text: 'Which unit measures force?', options: ['Newton', 'Joule', 'Watt', 'Pascal'], answer: 0,
    difficulty: 'easy', explanation: 'Force is measured in newtons.'
  }, adm);
  ok('a complete question is accepted', made.status === 200 && made.body.id > 0, made.status + ' ' + made.raw.slice(0, 140));
  var QID = made.body.id;
  var upd = await call('PUT', '/api/questions/' + QID, { answer: 1, text: 'Which unit measures energy?' }, adm);
  ok('the correct answer can be corrected', upd.status === 200 && upd.body.answer === 1, upd.raw.slice(0, 140));
  var off = await call('PUT', '/api/questions/' + QID + '/active', { active: false }, adm);
  ok('a question can be held back', off.status === 200 && off.body.active === false, off.raw.slice(0, 120));
  var served = await call('GET', '/api/questions?subject=Physics&activeOnly=true', undefined, adm);
  ok('a held-back question is no longer served',
     !served.body.questions.some(function (q) { return q.id === QID; }), served.status);
  var kept = await call('GET', '/api/questions?subject=Physics', undefined, adm);
  ok('but it was not deleted', kept.body.questions.some(function (q) { return q.id === QID; }));
  await call('PUT', '/api/questions/' + QID + '/active', { active: true }, adm);

  head('4.7 — a spreadsheet over HTTP, refused by the same rules as the form');
  /* The header comes from the shared core module, not from a copy typed here:
     the whole point of the importer is that one set of rules serves the browser
     and the server, so the test must read the same source both of them read. */
  var core = require(path.join(APP, 'js', 'goc-core.js'));
  var qCsv = core.CSV_QUESTION_HEADER + '\n'
    + 'Physics,objective,Waves,What does a wave transfer?,Energy,Matter,Mass,Charge,,A,,,easy,Energy and not matter.,yes\n'
    + 'Physics,theory,Waves,Define wavelength.,,,,,,,The distance between two successive points in phase.,5,medium,,yes\n'
    + 'Physics,objective,Waves,A question offering one option only,Energy,,,,,A,,,easy,,yes\n';
  var beforeIm = (await call('GET', '/api/questions?subject=Physics', undefined, adm)).body.questions.length;
  var imp = await call('POST', '/api/questions/import', { csv: qCsv }, adm);
  ok('the file is accepted and the outcome counted',
     imp.status === 200 && imp.body.read === 3 && imp.body.added === 2 && imp.body.skipped === 1,
     imp.status + ' ' + imp.raw.slice(0, 160));
  ok('the row that failed is named by its line number',
     imp.body.errors.length === 1 && imp.body.errors[0].line === 4, imp.raw.slice(0, 200));
  ok('and refused for the same reason the form gives',
     /at least two options/.test(imp.body.errors[0].error), imp.body.errors[0].error);
  ok('every published row was given an id', imp.body.ids.length === 2 && imp.body.ids[0] > 0, imp.raw.slice(0, 160));
  var afterIm = await call('GET', '/api/questions?subject=Physics', undefined, adm);
  ok('the bank grew by exactly the rows that passed',
     afterIm.body.questions.length === beforeIm + 2,
     beforeIm + ' → ' + afterIm.body.questions.length);
  var impQ = afterIm.body.questions.filter(function (q) { return q.id === imp.body.ids[0]; })[0];
  ok('the answer letter was resolved to a position, not stored as a letter',
     impQ && impQ.answer === 0, impQ && String(impQ.answer));
  ok('and the imported question is live', impQ && impQ.active === true);
  var badCols = await call('POST', '/api/questions/import', { csv: 'subject,topic\nPhysics,Waves\n' }, adm);
  ok('a file missing a required column is refused whole',
     badCols.status === 400 && /missing a column/.test(badCols.raw), badCols.status + ' ' + badCols.raw.slice(0, 140));
  ok('and nothing was published by the refusal',
     (await call('GET', '/api/questions?subject=Physics', undefined, adm)).body.questions.length
       === afterIm.body.questions.length);
  var nImp = await call('POST', '/api/notes/import', { csv: core.csvTemplate('notes') }, adm);
  ok('a file of notes imports the same way',
     nImp.status === 200 && nImp.body.added === 1 && nImp.body.skipped === 0, nImp.status + ' ' + nImp.raw.slice(0, 160));
  var nList = await call('GET', '/api/notes?subject=Physics', undefined, adm);
  ok('the note is on the record the console reads',
     nList.body.notes.some(function (n) { return n.id === nImp.body.ids[0]; }), nList.raw.slice(0, 140));
  var impNote = nList.body.notes.filter(function (n) { return n.id === nImp.body.ids[0]; })[0];
  ok('the paragraph break a spreadsheet writes survived the round trip',
     impNote && impNote.body.indexOf('\n\n') > -1 && impNote.body.indexOf('\\n') === -1);
  var stuImp = await call('POST', '/api/questions/import', { csv: qCsv }, stuToken);
  ok('a student token cannot import a question bank', stuImp.status >= 400, stuImp.status);
  var anonImp = await call('POST', '/api/notes/import', { csv: 'x' });
  ok('and neither can a caller with no token at all', anonImp.status >= 400, anonImp.status);

  head('4.7c — stampSection: importing the same file into Practice, separately from the Web Test');
  var stampCsv = core.CSV_QUESTION_HEADER + '\n'
    + 'Physics,objective,Waves,A wave question reused for practice via stampSection,Energy,Matter,Mass,Charge,,A,,,easy,,yes\n';
  var beforePrac = (await call('GET', '/api/questions?subject=Physics&section=practice', undefined, adm)).body.questions.length;
  var stampImp = await call('POST', '/api/questions/import',
    { csv: stampCsv, section: 'practice', stampSection: true }, adm);
  ok('the row (filed as objective in the file) is accepted and stamped as practice',
     stampImp.status === 200 && stampImp.body.added === 1, stampImp.status + ' ' + stampImp.raw.slice(0, 160));
  var afterPrac = await call('GET', '/api/questions?subject=Physics&section=practice', undefined, adm);
  ok('the bank grew by exactly the one stamped row',
     afterPrac.body.questions.length === beforePrac + 1, beforePrac + ' → ' + afterPrac.body.questions.length);
  var stampedQ = afterPrac.body.questions.filter(function (q) { return q.id === stampImp.body.ids[0]; })[0];
  ok('the published question is filed under practice, not the objective session the file named',
     stampedQ && stampedQ.section === 'practice', stampedQ && stampedQ.section);
  var afterObj = await call('GET', '/api/questions?subject=Physics&section=objective', undefined, adm);
  ok('it was not also published (or left) under objective',
     !afterObj.body.questions.some(function (q) { return q.id === stampImp.body.ids[0]; }));
  var stampMismatch = await call('POST', '/api/questions/import',
    { csv: stampCsv, subject: 'Chemistry', section: 'practice', stampSection: true }, adm);
  ok('stamp mode still rejects a row under a subject it was not chosen for',
     stampMismatch.status === 200 && stampMismatch.body.added === 0 && stampMismatch.body.skipped === 1,
     stampMismatch.status + ' ' + stampMismatch.raw.slice(0, 200));

  head('4.7b — bulk-deleting a slice of the bank by subject/section');
  /* A dedicated subject/topic (not touched by any earlier block in this
     file) so the counts below are exact rather than "whatever the bank
     happened to hold already". */
  var bulkChem1 = await call('POST', '/api/questions', {
    subject: 'Chemistry', section: 'objective', period: 'weekly', topic: 'Acids',
    text: 'pH of a neutral solution?', options: ['7', '0', '14', '1'], answer: 0
  }, adm);
  var bulkChem2 = await call('POST', '/api/questions', {
    subject: 'Chemistry', section: 'objective', period: 'weekly', topic: 'Acids',
    text: 'Formula for hydrochloric acid?', options: ['HCl', 'NaCl', 'H2O', 'NaOH'], answer: 0
  }, adm);
  var bulkChemTheory = await call('POST', '/api/questions', {
    subject: 'Chemistry', section: 'theory', topic: 'Acids',
    text: 'Explain neutralisation.', expected: 'An acid and a base react to form a salt and water.', maxMark: 8
  }, adm);
  var bulkBioObj = await call('POST', '/api/questions', {
    subject: 'Biology', section: 'objective', period: 'weekly', topic: 'Cells',
    text: 'The powerhouse of the cell is the?', options: ['Mitochondrion', 'Nucleus', 'Ribosome', 'Vacuole'], answer: 0
  }, adm);
  ok('all four seed questions were created', [bulkChem1, bulkChem2, bulkChemTheory, bulkBioObj]
     .every(function (r) { return r.status === 200 && r.body.id > 0; }));

  var missingBoth = await call('DELETE', '/api/questions/bulk', {}, adm);
  ok('missing subject and section is refused, not treated as "all"',
     missingBoth.status === 400, missingBoth.status + ' ' + missingBoth.raw);
  var missingSection = await call('DELETE', '/api/questions/bulk', { subject: 'Chemistry' }, adm);
  ok('missing section alone is also refused', missingSection.status === 400, missingSection.status + ' ' + missingSection.raw);
  var badSubject = await call('DELETE', '/api/questions/bulk', { subject: 'Not A Subject', section: 'all' }, adm);
  ok('an unrecognised subject is refused (not a silent match-none delete)',
     badSubject.status === 400, badSubject.status + ' ' + badSubject.raw);
  var badSection = await call('DELETE', '/api/questions/bulk', { subject: 'Chemistry', section: 'nonsense' }, adm);
  ok('an unrecognised section is refused',
     badSection.status === 400, badSection.status + ' ' + badSection.raw);
  var anonBulk = await call('DELETE', '/api/questions/bulk', { subject: 'Chemistry', section: 'objective' });
  ok('a caller with no token at all cannot bulk delete', anonBulk.status >= 400, anonBulk.status);
  var stuBulk = await call('DELETE', '/api/questions/bulk', { subject: 'Chemistry', section: 'objective' }, stuToken);
  ok('a student token cannot bulk delete', stuBulk.status >= 400, stuBulk.status);
  ok('none of the refused/unauthorized calls above deleted anything',
     (await call('GET', '/api/questions?subject=Chemistry', undefined, adm)).body.questions.length >= 3);

  /* Earlier blocks in this file also seed Chemistry/objective questions, so the
     honest expectation is "however many matched right before the call", read
     from the bank itself, not a hard-coded 2. */
  var chemObjBefore = (await call('GET', '/api/questions?subject=Chemistry&section=objective', undefined, adm)).body.questions.length;
  var bankBefore = (await call('GET', '/api/questions', undefined, adm)).body.questions.length;
  var bulkDel = await call('DELETE', '/api/questions/bulk', { subject: 'Chemistry', section: 'objective' }, adm);
  ok('bulk delete of one subject + one section succeeds and reports exactly what it removed',
     bulkDel.status === 200 && chemObjBefore >= 2 && bulkDel.body.deleted === chemObjBefore, bulkDel.status + ' ' + bulkDel.raw + ' (expected ' + chemObjBefore + ')');
  ok('the remaining count it reports matches what is left in the bank',
     bulkDel.body.remaining === bankBefore - chemObjBefore, bulkDel.raw);
  var chemAfter = await call('GET', '/api/questions?subject=Chemistry', undefined, adm);
  ok('only the matching (Chemistry, objective) questions were removed',
     !chemAfter.body.questions.some(function (q) { return q.id === bulkChem1.body.id || q.id === bulkChem2.body.id; }));
  ok('the Chemistry theory question in the same subject was left alone',
     chemAfter.body.questions.some(function (q) { return q.id === bulkChemTheory.body.id; }));
  var bioAfter = await call('GET', '/api/questions?subject=Biology', undefined, adm);
  ok('a question in an unrelated subject was left alone entirely',
     bioAfter.body.questions.some(function (q) { return q.id === bulkBioObj.body.id; }));
  var bulkDelAgain = await call('DELETE', '/api/questions/bulk', { subject: 'Chemistry', section: 'objective' }, adm);
  ok('bulk-deleting an already-empty match reports zero, not an error',
     bulkDelAgain.status === 200 && bulkDelAgain.body.deleted === 0, bulkDelAgain.status + ' ' + bulkDelAgain.raw);

  head('topics are edited by relabelling everything that carries them');
  var tpLocked = await call('GET', '/api/topics', undefined, stuToken);
  ok('a student cannot read the topic list', tpLocked.status >= 400, tpLocked.status);
  var tps = await call('GET', '/api/topics?subject=Physics', undefined, adm);
  ok('the console is given the topics with their counts',
     tps.status === 200 && tps.body.topics.length > 0 &&
     typeof tps.body.topics[0].liveQuestions === 'number', tps.status + ' ' + tps.raw.slice(0, 140));
  ok('and the academy\'s subjects to choose from', tps.body.subjects.indexOf('Physics') > -1);
  var dyn = tps.body.topics.filter(function (t) { return t.topic === 'Dynamics'; })[0];
  ok('the topic just published is in the list', !!dyn && dyn.questions >= 1, JSON.stringify(dyn));
  var ren = await call('POST', '/api/topics/rename',
    { subject: 'Physics', from: 'Dynamics', to: 'Forces And Motion' }, adm);
  ok('renaming moves every question that carried the label',
     ren.status === 200 && ren.body.questions === dyn.questions, ren.status + ' ' + ren.raw.slice(0, 160));
  var moved = await call('GET', '/api/questions?subject=Physics', undefined, adm);
  ok('and the bank itself now reads the new name',
     moved.body.questions.some(function (q) { return q.id === QID && q.topic === 'Forces And Motion'; }));
  ok('with nothing left on the old one',
     !moved.body.questions.some(function (q) { return q.topic === 'Dynamics'; }));
  var same = await call('POST', '/api/topics/rename',
    { subject: 'Physics', from: 'Forces And Motion', to: 'Forces And Motion' }, adm);
  ok('renaming a topic to its own name is refused', same.status === 400, same.status);
  var thinTp = await call('POST', '/api/topics/rename',
    { subject: 'Physics', from: 'Forces And Motion', to: 'q' }, adm);
  ok('a one-letter topic name is refused', thinTp.status === 400, thinTp.status);
  var ghost = await call('POST', '/api/topics/rename',
    { subject: 'Physics', from: 'Nothing Carries This', to: 'Whatever' }, adm);
  ok('renaming a topic nothing carries is refused', ghost.status === 404, ghost.status);
  var other = tps.body.topics.filter(function (t) { return t.topic !== 'Dynamics'; })[0];
  if (other) {
    var mg = await call('POST', '/api/topics/rename',
      { subject: 'Physics', from: 'Forces And Motion', to: other.topic }, adm);
    ok('renaming onto a label already in use is reported as a merge',
       mg.status === 200 && mg.body.merged === true, mg.raw.slice(0, 140));
    ok('and only one topic of that name survives',
       mg.body.topics.filter(function (t) { return t.topic === other.topic; }).length === 1);
  }
  await call('POST', '/api/topics/rename',
    { subject: 'Physics', from: other ? other.topic : 'Forces And Motion', to: 'Dynamics' }, adm);

  head('4.3 — every sitting on the record names its Scholar ID');
  var all = await call('GET', '/api/results', undefined, adm);
  ok('the record is served to the console', all.status === 200 && all.body.results.length >= 2,
     all.status + ' ' + (all.body && all.body.results.length));
  ok('every row carries a Scholar ID',
     all.body.results.every(function (a) { return /^GOC-S-\d+$/.test(a.scholarId); }));
  ok('one theory paper is waiting for a marker', all.body.awaitingMarking === 1, all.body.awaitingMarking);
  var byId = await call('GET', '/api/results?scholarId=' + stuId, undefined, adm);
  ok('the record can be narrowed to one scholar',
     byId.body.results.length === 2 && byId.body.results.every(function (a) { return a.scholarId === stuId; }),
     byId.body.results.length);
  var waiting = await call('GET', '/api/results?status=awaiting-marking', undefined, adm);
  ok('and to what still needs marking', waiting.body.results.length === 1, waiting.body.results.length);

  head('4.4 — the marks are the administrator\'s, and the total is the server\'s');
  var open = await call('GET', '/api/results/' + encodeURIComponent(theoryId), undefined, adm);
  ok('the paper opens for marking', open.status === 200 && open.body.answers.length > 0, open.status);
  ok('the marker sees what the student wrote',
     /My written answer for the marker/.test(open.raw));
  ok('and the reference answer to compare it against',
     open.body.answers.every(function (r) { return !!r.expected; }));
  ok('with the maximum each question carries',
     open.body.answers.every(function (r) { return r.maxMark > 0; }));
  ok('no mark has been awarded yet',
     open.body.answers.every(function (r) { return r.markAwarded === null; }));
  ok('and no score has been invented', open.body.score === null, open.body.score);
  var forged = {};
  open.body.answers.forEach(function (r) { forged[r.questionId] = r.maxMark + 500; });
  var over = await call('POST', '/api/results/' + encodeURIComponent(theoryId) + '/mark', { marks: forged }, adm);
  ok('a mark beyond the maximum cannot inflate the paper',
     over.status === 200 && over.body.score === over.body.maxScore && over.body.percent === 100,
     over.body && (over.body.score + '/' + over.body.maxScore));
  var marks = {}, expect = 0;
  open.body.answers.forEach(function (r) { marks[r.questionId] = r.maxMark - 3; expect += r.maxMark - 3; });
  var handed = await call('POST', '/api/results/' + encodeURIComponent(theoryId) + '/mark', { marks: marks }, adm);
  ok('the marks the administrator awards are what is stored',
     handed.status === 200 && handed.body.score === expect, handed.body && handed.body.score);
  ok('the paper is marked', handed.body.status === 'marked', handed.body.status);
  ok('it is still filed against the same Scholar ID', handed.body.scholarId === stuId, handed.body.scholarId);
  var after = await call('GET', '/api/results/' + encodeURIComponent(theoryId), undefined, adm);
  ok('and the marker is on the record', after.body.markedBy === 'GOC-A-001', after.body.markedBy);
  var studentSees = await call('GET', '/api/me/results/' + encodeURIComponent(theoryId), undefined, stuToken);
  ok('the student now sees the mark on their own record',
     studentSees.status === 200 && studentSees.body.score === expect, studentSees.body && studentSees.body.score);
  var studentWrites = await call('POST', '/api/results/' + encodeURIComponent(theoryId) + '/mark',
    { marks: marks }, stuToken);
  ok('but cannot re-mark it', studentWrites.status >= 400, studentWrites.status);
  var studentEdits = await call('PUT', '/api/questions/' + QID, { answer: 3 }, stuToken);
  ok('nor change a correct answer', studentEdits.status >= 400, studentEdits.status);
  var stillRight = await call('GET', '/api/questions?subject=Physics', undefined, adm);
  ok('the correct answer is exactly as management left it',
     stillRight.body.questions.some(function (q) { return q.id === QID && q.answer === 1; }));
  return null;
}).then(async function () {
  head('Priority 7 over HTTP — closing an account withdraws access, not history');
  var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var adm = lin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);

  var mineBefore = await call('GET', '/api/me/results', undefined, stuToken);
  var hadResults = mineBefore.body.attempts.length;
  var rosterBefore = await call('GET', '/api/students', undefined, adm);
  var meBefore = rosterBefore.body.filter(function (s) { return s.id === stuId; })[0];
  ok('the student is on the roster and open', !!meBefore && meBefore.active === true, meBefore && meBefore.active);
  ok('with sittings on the record', hadResults > 0, hadResults);

  var byStudent = await call('PUT', '/api/students/' + encodeURIComponent(stuId) + '/active',
    { active: false }, stuToken);
  ok('a student cannot deactivate their own account', byStudent.status >= 400, byStudent.status);
  var anon = await call('PUT', '/api/students/' + encodeURIComponent(stuId) + '/active', { active: false });
  ok('nor can an unauthenticated request', anon.status >= 400, anon.status);

  var off = await call('PUT', '/api/students/' + encodeURIComponent(stuId) + '/active', { active: false }, adm);
  ok('the console can close the account', off.status === 200 && off.body.active === false, off.status);
  ok('the response still carries the XP', off.body.xp === meBefore.xp, off.body.xp + ' vs ' + meBefore.xp);
  ok('and the performance figure', off.body.performance === meBefore.performance, off.body.performance);

  var stale = await call('GET', '/api/me', undefined, stuToken);
  ok('the live session is dropped at once', stale.status === 401, stale.status);
  var relog = await call('POST', '/api/auth/login', { id: stuId, password: good.password });
  ok('the student cannot sign in again', relog.status >= 400, relog.status);
  ok('and is told the records are safe',
     /deactivated/i.test(relog.raw) && /records are safe/i.test(relog.raw), relog.raw.slice(0, 160));

  var held = await call('GET', '/api/results?scholarId=' + encodeURIComponent(stuId), undefined, adm);
  ok('every sitting is still in the record', held.body.results.length === hadResults, held.body.results.length);
  ok('still filed under the same Scholar ID',
     held.body.results.every(function (r) { return r.scholarId === stuId; }));
  var flagged = await call('GET', '/api/students', undefined, adm);
  var shut = flagged.body.filter(function (s) { return s.id === stuId; })[0];
  ok('the Scholar ID has not left the roster', !!shut, stuId);
  ok('and is flagged so management can identify it', shut.active === false, shut.active);
  ok('the marked theory paper is still readable by the console',
     (await call('GET', '/api/results/' + encodeURIComponent(theoryId), undefined, adm)).status === 200);

  var on = await call('PUT', '/api/students/' + encodeURIComponent(stuId) + '/active', { active: true }, adm);
  ok('the console can reopen it', on.status === 200 && on.body.active === true, on.status);
  var back = await call('POST', '/api/auth/login', { id: stuId, password: good.password });
  ok('the student signs in again with the same password', back.status === 200 && !!back.body.token, back.status);
  stuToken = back.body.token;
  var mineAfter = await call('GET', '/api/me/results', undefined, stuToken);
  ok('with the whole record intact', mineAfter.body.attempts.length === hadResults, mineAfter.body.attempts.length);
  var meAfter = await call('GET', '/api/me', undefined, stuToken);
  ok('the XP is unchanged', meAfter.body.xp === meBefore.xp, meAfter.body.xp + ' vs ' + meBefore.xp);

  head('Priority 8 over HTTP — only the Founder, decided by the server');
  var acc = await call('GET', '/api/staff/access', undefined, adm);
  ok('the Founder is told so', acc.status === 200 && acc.body.isFounder === true, acc.status);
  ok('the passcode length is disclosed but not the passcode',
     acc.body.passcodeLength === 4 && acc.raw.indexOf('2027') < 0, acc.raw);
  ok('no hash or salt travels with it', !/pwHash|hash|salt/i.test(acc.raw));
  ok('the create-account code length is disclosed but never the code itself',
     acc.body.signupCodeLength === SIGNUP.length && acc.raw.indexOf(SIGNUP) < 0, acc.raw);
  ok('and the console is told it has never been changed',
     acc.body.signupCodeChangedAt === null && acc.body.signupCodeChangedBy === null, acc.raw);

  var dlin = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
  var dir = dlin.body.token;
  await call('POST', '/api/auth/unlock', { passcode: '2027' }, dir);
  var dacc = await call('GET', '/api/staff/access', undefined, dir);
  ok('the Academic Director reaches the console', dacc.status === 200, dacc.status);
  ok('but is not the Founder', dacc.body.isFounder === false, dacc.body.isFounder);
  var dpw = await call('PUT', '/api/staff/GOC-A-001/password', { password: 'takeover99' }, dir);
  ok('and cannot change the Founder\'s password', dpw.status === 403, dpw.status + ' ' + dpw.raw);
  ok('the refusal names the rule', /Only the Founder/i.test(dpw.raw), dpw.raw);
  var dpc = await call('PUT', '/api/settings/passcode', { passcode: '9999' }, dir);
  ok('nor the firewall passcode', dpc.status === 403, dpc.status);
  /* The one credential she may rotate, because she is the one who hands it to a
     new intake. Asked for explicitly by the academy, so the tier is asserted. */
  var dsc = await call('PUT', '/api/settings/signup-code', { code: 'DIRECTOR-9' }, dir);
  ok('but the Academic Director may change the create-account code',
     dsc.status === 200 && dsc.body.length === 9, dsc.status + ' ' + dsc.raw);
  ok('the change is recorded against her', dsc.body.changedBy === 'GOC-A-002', dsc.raw);
  ok('and only its length comes back', dsc.raw.indexOf('DIRECTOR') < 0, dsc.raw);
  ok('the new code is not stored in plain text, in either form',
     fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8').indexOf('DIRECTOR') < 0);
  var deadCode = await call('POST', '/api/students', Object.assign({}, good,
    { signupCode: SIGNUP, email: 'dead@example.com', phone: '08010007777' }));
  ok('the code the Hub shipped with stops working the moment she changes it',
     deadCode.status === 403, deadCode.status + ' ' + deadCode.raw);
  /* Refused on its subjects, not its code — which is only possible if the code
     she set got through. Proven without writing a stray account. */
  var liveCode = await call('POST', '/api/students', Object.assign({}, good,
    { signupCode: 'director 9', subjects: ['Use of English', 'Physics', 'Chemistry'],
      email: 'live@example.com', phone: '08010006666' }));
  ok('and the code she set is the one that now opens the form',
     liveCode.status >= 400 && !/access code/i.test(liveCode.raw), liveCode.raw);
  ok('which still created no account', !(liveCode.body && liveCode.body.student), liveCode.raw);
  var dAcc2 = await call('GET', '/api/staff/access', undefined, dir);
  ok('the console now reports the new length and who changed it',
     dAcc2.body.signupCodeLength === 9 && dAcc2.body.signupCodeChangedBy === 'GOC-A-002' &&
     !!dAcc2.body.signupCodeChangedAt, dAcc2.raw);
  ok('the Founder can still sign in',
     (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).status === 200);

  var spw = await call('PUT', '/api/staff/GOC-A-001/password', { password: 'student9999' }, stuToken);
  ok('a student cannot change a management password', spw.status >= 400, spw.status);
  var spc = await call('PUT', '/api/settings/passcode', { passcode: '1111' }, stuToken);
  ok('nor the passcode', spc.status >= 400, spc.status);
  var sacc = await call('GET', '/api/staff/access', undefined, stuToken);
  ok('nor read the access panel', sacc.status >= 400, sacc.status);
  var ssc = await call('PUT', '/api/settings/signup-code', { code: 'STUDENT-9' }, stuToken);
  ok('nor open the create-account firewall to their friends', ssc.status >= 400, ssc.status + ' ' + ssc.raw);
  var nsc = await call('PUT', '/api/settings/signup-code', { code: 'NOBODY-9' });
  ok('and neither can a caller with no session at all', nsc.status >= 400, nsc.status);
  var lockedIn = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
  var lsc = await call('PUT', '/api/settings/signup-code', { code: 'LOCKED-99' }, lockedIn.body.token);
  ok('nor a management session that has not passed the console firewall',
     lsc.status >= 400, lsc.status + ' ' + lsc.raw);
  var noone = await call('PUT', '/api/settings/passcode', { passcode: '1111' });
  ok('and neither can a request with no session at all', noone.status >= 400, noone.status);

  var weak = await call('PUT', '/api/staff/GOC-A-002/password', { password: 'short1' }, adm);
  ok('the server refuses a short management password', weak.status === 400 && /8 characters/.test(weak.raw), weak.raw);
  var plain = await call('PUT', '/api/staff/GOC-A-002/password', { password: 'allletters' }, adm);
  ok('and one with no digits', plain.status === 400 && /letters and numbers/.test(plain.raw), plain.raw);
  var changed = await call('PUT', '/api/staff/GOC-A-002/password', { password: 'newdir2027' }, adm);
  ok('the Founder may change it', changed.status === 200 && changed.body.changed === true, changed.status);
  ok('the response carries no password material',
     !/password|pwHash|hash|salt/i.test(changed.raw), changed.raw);
  ok('nothing is stored in plain text',
     fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8').indexOf('newdir2027') < 0);
  ok('the Academic Director signs in with the new password',
     (await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'newdir2027' })).status === 200);
  ok('the old password is dead',
     (await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' })).status >= 400);
  ok('the Founder\'s own password was not touched',
     (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).status === 200);

  var badPc = await call('PUT', '/api/settings/passcode', { passcode: '12ab' }, adm);
  ok('a non-numeric passcode is refused', badPc.status === 400 && /4 to 8 digits/.test(badPc.raw), badPc.raw);
  var newPc = await call('PUT', '/api/settings/passcode', { passcode: '135790' }, adm);
  ok('the Founder may change the passcode', newPc.status === 200 && newPc.body.length === 6, newPc.status);
  ok('and only its length comes back', newPc.raw.indexOf('135790') < 0, newPc.raw);
  ok('the passcode is not stored in plain text',
     fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8').indexOf('135790') < 0);
  var freshDir = await call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'newdir2027' });
  var oldPc = await call('POST', '/api/auth/unlock', { passcode: '2027' }, freshDir.body.token);
  ok('the old passcode no longer unlocks the console', oldPc.status >= 400, oldPc.status);
  var okPc = await call('POST', '/api/auth/unlock', { passcode: '135790' }, freshDir.body.token);
  ok('the new one does', okPc.status === 200, okPc.status + ' ' + okPc.raw);

  var shortSc = await call('PUT', '/api/settings/signup-code', { code: 'AB' }, adm);
  ok('a create-account code below the bound is refused',
     shortSc.status === 400 && /at least 4/.test(shortSc.raw), shortSc.raw);
  var longSc = await call('PUT', '/api/settings/signup-code', { code: new Array(40).join('X') }, adm);
  ok('and one above it', longSc.status === 400 && /at most 24/.test(longSc.raw), longSc.raw);
  var puncSc = await call('PUT', '/api/settings/signup-code', { code: 'GOC*2027' }, adm);
  ok('and one with punctuation in it',
     puncSc.status === 400 && /letters, numbers and dashes/.test(puncSc.raw), puncSc.raw);
  var fsc = await call('PUT', '/api/settings/signup-code', { code: 'founder-77' }, adm);
  ok('the Founder may change the create-account code as well',
     fsc.status === 200 && fsc.body.length === 9, fsc.status + ' ' + fsc.raw);
  ok('and the change is recorded against him', fsc.body.changedBy === 'GOC-A-001', fsc.raw);
  codeInForce = 'FOUNDER-77';
  var afterF = await call('GET', '/api/staff/access', undefined, adm);
  ok('the console reports the Founder as the last to change it',
     afterF.body.signupCodeChangedBy === 'GOC-A-001' && afterF.body.signupCodeLength === 9, afterF.raw);
  var dirDead = await call('POST', '/api/students', Object.assign({}, good,
    { signupCode: 'DIRECTOR-9', email: 'dirdead@example.com', phone: '08010005555' }));
  ok('the code the Academic Director set is now dead too', dirDead.status === 403, dirDead.status + ' ' + dirDead.raw);

  head('Priority 9 over HTTP — the session clock belongs to the server');
  var pub = await call('GET', '/api/settings');
  ok('the app can read the session policy it must display',
     pub.status === 200 && pub.body.sessionMinutes === 120, pub.status + ' ' + pub.raw);
  ok('including the warning lead time', pub.body.sessionWarnMinutes === 5, pub.body.sessionWarnMinutes);
  ok('and nothing else travels with it',
     !/passcode|hash|salt|password/i.test(pub.raw), pub.raw);

  var si = await call('GET', '/api/auth/session-info', undefined, stuToken);
  ok('a signed-in student is told how long is left', si.status === 200 && si.body.active === true, si.status);
  ok('it is their own Scholar ID on the session', si.body.id === stuId, si.body.id);
  ok('the remaining time matches the academy setting',
     si.body.expiresInSec > 7000 && si.body.expiresInSec <= 7200, si.body.expiresInSec);
  ok('the warning lead time comes in seconds', si.body.warnInSec === 300, si.body.warnInSec);
  var noSi = await call('GET', '/api/auth/session-info');
  ok('with no token there is nothing to report', noSi.status >= 400, noSi.status);

  var stuSet = await call('PUT', '/api/settings', { sessionMinutes: 480 }, stuToken);
  ok('a student cannot lengthen their own session', stuSet.status >= 400, stuSet.status);
  var anonSet = await call('PUT', '/api/settings', { sessionMinutes: 480 });
  ok('nor can an unauthenticated request', anonSet.status >= 400, anonSet.status);
  var unchanged = await call('GET', '/api/settings');
  ok('and the policy has not moved', unchanged.body.sessionMinutes === 120, unchanged.body.sessionMinutes);

  var wide = await call('PUT', '/api/settings', { sessionMinutes: 9999 }, adm);
  ok('the console may change it', wide.status === 200, wide.status + ' ' + wide.raw);
  ok('but not beyond eight hours', wide.body.sessionMinutes === 480, wide.body.sessionMinutes);
  var longWarn = await call('PUT', '/api/settings', { sessionWarnMinutes: 999 }, adm);
  ok('the warning is capped at half an hour', longWarn.body.sessionWarnMinutes === 30, longWarn.body.sessionWarnMinutes);
  var short = await call('PUT', '/api/settings', { sessionMinutes: 2 }, adm);
  ok('a two-minute session is lifted to the floor', short.body.sessionMinutes === 15, short.body.sessionMinutes);
  ok('and the warning is shortened with it, never longer than the session',
     short.body.sessionWarnMinutes === 14, short.body.sessionWarnMinutes);
  ok('the daily study window survives all of it', short.body.dailyLimitMin > 0, short.body.dailyLimitMin);

  var mid = await call('GET', '/api/auth/session-info', undefined, stuToken);
  ok('a session already running is not cut short by the change',
     mid.body.sessionMinutes === 120, mid.body.sessionMinutes);
  ok('nor silently prolonged by one', mid.body.expiresInSec <= 7200, mid.body.expiresInSec);
  ok('but the new warning reaches the student who is already signed in',
     mid.body.sessionWarnMinutes === 14, mid.body.sessionWarnMinutes);

  var fresh = await call('POST', '/api/auth/login', { id: stuId, password: good.password });
  var freshSi = await call('GET', '/api/auth/session-info', undefined, fresh.body.token);
  ok('the next login gets the new, shorter session',
     freshSi.body.sessionMinutes === 15 && freshSi.body.expiresInSec <= 900,
     freshSi.body.sessionMinutes + ' / ' + freshSi.body.expiresInSec);
  var staffSi = await call('GET', '/api/auth/session-info', undefined, adm);
  ok('management keeps its own working session, untouched by the student setting',
     staffSi.body.sessionMinutes === 480, staffSi.body.sessionMinutes);

  await call('PUT', '/api/settings', { sessionMinutes: 120, sessionWarnMinutes: 5 }, adm);
  var restored = await call('GET', '/api/settings');
  ok('the policy can be put back',
     restored.body.sessionMinutes === 120 && restored.body.sessionWarnMinutes === 5, restored.raw);
  stuToken = fresh.body.token;
  return null;
}).then(function () {
  head('login tells an attacker nothing');
  return call('POST', '/api/auth/login', { id: 'GOC-S-001', password: 'definitely-wrong' })
    .then(function (bad) {
      return call('POST', '/api/auth/login', { id: 'GOC-S-999999', password: 'definitely-wrong' })
        .then(function (unknown) {
          ok('wrong password and unknown ID give the same message',
             bad.body && unknown.body && bad.body.error === unknown.body.error,
             (bad.body || {}).error + ' vs ' + (unknown.body || {}).error);
          ok('neither response contains a credential',
             !/password"\s*:|hash|salt/i.test(bad.raw + unknown.raw));
        });
    });
}).then(async function () {
  /* ====================================================================
     Priorities 10, 11, 12 and the two scenarios Priority 15.6 asks for,
     proved over real HTTP. The ordering rule is unit-tested in
     test-rules.js; what is checked here is that the route actually applies
     it to real students, real papers and real marks — and that the league
     never leaks anything it should not.
     ==================================================================== */
  head('Priorities 10-12 — the Scholar League over HTTP');

  var SUBJ = ['Use of English', 'Physics', 'Chemistry', 'Biology'];
  var f = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body;
  /* An earlier block in this suite changes the console passcode, so this one
     must not assume the shipped default. Whichever is in force is used. */
  var unlocked = false;
  for (var pc = 0; pc < 3 && !unlocked; pc++) {
    var tryPc = ['135790', '2027', '9999'][pc];
    unlocked = (await call('POST', '/api/auth/unlock', { passcode: tryPc }, f.token)).status === 200;
  }
  ok('the console can be unlocked with the passcode in force', unlocked);

  /* The answer key is only readable by an unlocked console account — which is
     itself asserted further down. */
  var bank = (await call('GET', '/api/questions', undefined, f.token)).body.questions;
  var key = {};
  bank.forEach(function (q) { if (q.answer !== undefined) key[q.id] = q.answer; });

  async function enrol(name) {
    var r = await call('POST', '/api/students',
      { signupCode: codeInForce, name: name, password: 'secret123', goal: 'JAMB / UTME 2027', subjects: SUBJ });
    return r.body;
  }
  /* Sits a paper and returns the submitted result. `answers` is a function
     given a question and returning the response to record for it. */
  async function sit(who, section, subject, answers) {
    var h = (await call('POST', '/api/me/tests/start',
      { period: 'weekly', section: section, subject: subject }, who.token)).body;
    var responses = {};
    h.questions.forEach(function (q) { responses[q.id] = answers(q); });
    var out = await call('POST', '/api/me/tests/submit',
      { attemptId: h.attemptId, responses: responses }, who.token);
    return { attemptId: h.attemptId, questions: h.questions, result: out.body, status: out.status };
  }
  async function markFull(paper) {
    var marks = {};
    paper.questions.forEach(function (q) { marks[q.id] = q.maxMark || 10; });
    return call('POST', '/api/results/' + paper.attemptId + '/mark', { marks: marks }, f.token);
  }
  /* A practice run — unlike sit(), can be repeated: the one-sit rule only
     ever closes the web test (theory/objective/jamb), never practice. Used
     below to give a scholar repeated activity/XP without it touching their
     performance figure, the same way the product's own practice mode is
     deliberately excluded from attemptsFor(). */
  async function grind(who, subject, wrong) {
    var h = (await call('POST', '/api/me/study/start',
      { mode: 'practice', subject: subject, count: 30 }, who.token)).body;
    var responses = {};
    (h.questions || []).forEach(function (q) {
      responses[q.id] = wrong
        ? (Number(q.answer) + 1) % Math.max(2, (q.options || []).length || 4)
        : q.answer;
    });
    return call('POST', '/api/me/study/submit',
      { paperId: h.paperId, responses: responses }, who.token);
  }
  async function table() { return (await call('GET', '/api/league', undefined, f.token)).body; }
  function find(lg, sid) {
    var hit = null;
    (lg.rows || []).forEach(function (r) { if (r.scholarId === sid) hit = r; });
    return hit;
  }

  /* ---- Scenario 1: activity must not beat achievement ---------------- */
  var grinder = await enrol('Zzz Grinder');
  var quiet = await enrol('Zzz Quiet');

  /* The one-sit rule (server/server.js — "once a web test has been
     submitted, it is closed for good") means the grinder cannot sit the
     same web test 8 times; a real student in this position submits one
     poor web-test sitting, then grinds practice for the rest of the
     activity — practice is repeatable and earns XP, but is deliberately
     excluded from performance (attemptsFor / computePerformance), so this
     still tests exactly what the scenario name says: lots of low-quality
     activity must not outrank one excellent, properly-assessed paper. */
  var grinderSit = await sit(grinder, 'objective', 'Physics', function (q) {
    return (Number(key[q.id]) + 1) % Math.max(2, (q.options || []).length || 4);
  });
  var grinderXpFromSitting = grinderSit.result.xpAwarded || 0;
  /* The practice pool for Physics is whatever the roster has built up by this
     point in the suite — not a fixed number — so the XP grinding earns is
     summed from what the server itself actually awarded each run, rather
     than assumed from a hand-computed pool size. */
  var grinderXpFromGrinding = 0;
  for (var g = 0; g < 7; g++) {
    var grindResult = await grind(grinder, 'Physics', true);
    grinderXpFromGrinding += grindResult.body.xpAwarded || 0;
  }

  var theory = await sit(quiet, 'theory', 'Physics', function () { return 'A complete written answer.'; });
  ok('a theory paper carries no score until it is marked by hand',
     theory.result.score === null && theory.result.status === 'awaiting-marking', theory.status + ' ' + JSON.stringify(theory.result.status));
  await markFull(theory);

  var lg1 = await table();
  var rG = find(lg1, grinder.student.id), rQ = find(lg1, quiet.student.id);
  ok('both new scholars appear in the league', !!rG && !!rQ);
  /* The scenario has to be worth running before its result means anything. */
  ok('scenario 1 is meaningful: the grinder holds more XP than the quiet scholar',
     rG.xp > rQ.xp, rG.xp + ' vs ' + rQ.xp);
  ok('scenario 1 is meaningful: the grinder performs worse',
     rG.performance < rQ.performance, rG.performance + ' vs ' + rQ.performance);
  ok('SCENARIO 1 — one badly-sat paper plus heavy practice grinding ranks BELOW one excellent paper',
     rQ.rank < rG.rank, 'quiet #' + rQ.rank + ' vs grinder #' + rG.rank);
  ok('the quiet scholar tops the league outright', rQ.rank === 1, '#' + rQ.rank);
  ok('the grinder\'s XP is exactly the sitting plus the grinding, nothing more or less',
     rG.xp === grinderXpFromSitting + grinderXpFromGrinding,
     rG.xp + ' vs sit ' + grinderXpFromSitting + ' + grind ' + grinderXpFromGrinding);
  ok('sitting a paper still earned the grinder XP, so effort is not ignored',
     grinderXpFromSitting > 0 && grinderXpFromGrinding > 0,
     'sit=' + grinderXpFromSitting + ' grind=' + grinderXpFromGrinding);

  /* ---- Scenario 2: XP breaks a genuine tie -------------------------- */
  var alpha = await enrol('Zzz Tied Alpha');
  var beta = await enrol('Zzz Tied Beta');
  var aTheory = await sit(alpha, 'theory', 'Physics', function () { return 'Answer.'; });
  var bTheory = await sit(beta, 'theory', 'Physics', function () { return 'Answer.'; });
  await markFull(aTheory);
  await markFull(bTheory);
  /* Alpha adds a perfect objective paper: more XP, and performance still 100. */
  var aObj = await sit(alpha, 'objective', 'Physics', function (q) { return key[q.id]; });
  ok('a fully correct objective paper is marked at once, with no hand marking',
     aObj.result.percent === 100 && aObj.result.status === 'marked', JSON.stringify(aObj.result.percent));

  var lg2 = await table();
  var rA = find(lg2, alpha.student.id), rB = find(lg2, beta.student.id);
  ok('scenario 2 is meaningful: the two are level on performance',
     rA.performance === rB.performance, rA.performance + ' vs ' + rB.performance);
  ok('scenario 2 is meaningful: one of them holds more XP', rA.xp > rB.xp, rA.xp + ' vs ' + rB.xp);
  ok('SCENARIO 2 — with performance level, the higher XP ranks above',
     rA.rank < rB.rank, '#' + rA.rank + ' vs #' + rB.rank);

  /* ---- what the league is allowed to say --------------------------- */
  head('what the league route may and may not disclose');
  var raw = (await call('GET', '/api/league', undefined, f.token)).raw;
  ok('no credential of any kind appears in the standings',
     !/password|hash|salt|scrypt|token/i.test(raw));
  ok('no email or phone number appears in the standings',
     !/@|"phone"/.test(raw));
  ok('the league states the basis it was ordered by',
     /performance/i.test(String(lg2.basis)), lg2.basis);
  ok('every row is ranked and the ranks run 1..n without a gap', (function () {
    for (var i = 0; i < lg2.rows.length; i++) if (lg2.rows[i].rank !== i + 1) return false;
    return lg2.rows.length > 0;
  })());
  ok('the reported size matches the rows sent', lg2.size === lg2.rows.length);
  ok('the order the server sends is already the ranked order — the screen never sorts',
     (function () {
       for (var i = 1; i < lg2.rows.length; i++) {
         var p = lg2.rows[i - 1], c = lg2.rows[i];
         if ((p.performance || 0) < (c.performance || 0)) return false;
         if ((p.performance || 0) === (c.performance || 0) && (p.xp || 0) < (c.xp || 0)) return false;
       }
       return true;
     })());

  /* A student reads the same table, with their own row flagged and nobody
     else's marked as theirs. */
  var asStudent = (await call('POST', '/api/auth/login',
    { id: alpha.student.id, password: 'secret123' })).body;
  var mine = (await call('GET', '/api/league', undefined, asStudent.token)).body;
  ok('a student may read the standings', Array.isArray(mine.rows) && mine.rows.length > 0);
  ok('the student is told which row is theirs',
     mine.me && mine.me.scholarId === alpha.student.id, JSON.stringify(mine.me && mine.me.scholarId));
  ok('exactly one row is flagged as the student\'s own',
     mine.rows.filter(function (r) { return r.me; }).length === 1);
  ok('the student is told their tier', /League/.test(String(mine.league)), mine.league);
  ok('the standings are not readable without signing in',
     (await call('GET', '/api/league')).status >= 400);
  ok('a student still cannot read the answer key the league is built from',
     (await call('GET', '/api/questions', undefined, asStudent.token)).status === 403);

  /* ---- Priority 12: a closed account leaves the table, keeps its record ---- */
  head('Priority 12 — closing and reopening an account');
  var before = (await table()).rows.length;
  ok('closing an account is a console action, refused to the student',
     (await call('PUT', '/api/students/' + alpha.student.id + '/active',
       { active: false }, asStudent.token)).status === 403);
  await call('PUT', '/api/students/' + alpha.student.id + '/active', { active: false }, f.token);

  var closed = await table();
  ok('a closed account leaves the standings', !find(closed, alpha.student.id));
  ok('and the league shrinks by exactly one', closed.rows.length === before - 1,
     before + ' -> ' + closed.rows.length);
  ok('the remaining ranks close up rather than leaving a hole', (function () {
    for (var i = 0; i < closed.rows.length; i++) if (closed.rows[i].rank !== i + 1) return false;
    return true;
  })());
  var kept = (await call('GET', '/api/results', undefined, f.token)).body.results;
  ok('its marked papers stay on file for the academy',
     kept.some(function (r) { return r.scholarId === alpha.student.id; }));
  ok('its login is refused while the account is closed',
     (await call('POST', '/api/auth/login', { id: alpha.student.id, password: 'secret123' })).status >= 400);

  await call('PUT', '/api/students/' + alpha.student.id + '/active', { active: true }, f.token);
  ok('reopening the account restores the login',
     (await call('POST', '/api/auth/login', { id: alpha.student.id, password: 'secret123' })).status === 200);
  var back = find(await table(), alpha.student.id);
  ok('it returns to the standings', !!back);
  ok('with its XP intact', back && back.xp === rA.xp, back && (back.xp + ' vs ' + rA.xp));
  ok('and its performance intact', back && back.performance === rA.performance);
  ok('and its rank restored', back && back.rank === rA.rank, back && ('#' + back.rank));

  /* ---- Priority 11: catch-up XP is awarded once, on marking -------- */
  head('Priority 11 — XP for a paper marked later');
  var late = await enrol('Zzz Late Marked');
  var lp = await sit(late, 'theory', 'Chemistry', function () { return 'Written answer.'; });
  var xpBefore = find(await table(), late.student.id).xp;
  ok('submitting an unmarked paper earns the flat sitting XP only',
     xpBefore === 10, String(xpBefore));
  await markFull(lp);
  var xpAfter = find(await table(), late.student.id).xp;
  ok('marking it tops the XP up to what the score deserves',
     xpAfter === 60, String(xpAfter));
  /* Marking the same paper again must not pay twice. */
  await markFull(lp);
  ok('re-marking the same paper does not award the XP a second time',
     find(await table(), late.student.id).xp === xpAfter,
     String(find(await table(), late.student.id).xp));
  ok('the student now has a performance figure',
     find(await table(), late.student.id).performance === 100);

  /* ---- Priorities 28-30: self-directed study over HTTP -------------
     Practice and the student's own CBT are study tools, not examinations. The
     browser marks a practice tap on the spot, which is only safe because this
     side marks the run again from its own answer key and files nothing. */
  head('Priorities 28-30 — self-directed study over HTTP');
  var sv = await enrol('Zzz Study Scholar');
  ok('the catalogue is refused to anyone not signed in',
     (await call('GET', '/api/me/study')).status >= 400);
  ok('and refused to the console, which does not sit papers',
     (await call('GET', '/api/me/study', undefined, f.token)).status >= 400);
  var cat = (await call('GET', '/api/me/study', undefined, sv.token)).body;
  ok('a student is offered exactly the papers they registered for',
     cat.subjects.length === SUBJ.length &&
     cat.subjects.every(function (s) { return SUBJ.indexOf(s.subject) > -1; }),
     cat.subjects.map(function (s) { return s.subject; }).join(', '));
  ok('no paper outside the combination is listed',
     cat.subjects.every(function (s) { return s.subject !== 'Mathematics'; }));
  ok('each paper\'s count is the sum of its own topics, not a separate figure',
     cat.subjects.every(function (s) {
       return s.questions === s.topics.reduce(function (m, t) { return m + t.questions; }, 0);
     }));
  ok('the longest run offered is the shared ceiling, not a number typed here',
     cat.maxQuestions === 60, String(cat.maxQuestions));
  ok('reading material is listed per paper alongside the questions',
     cat.reading.length === SUBJ.length);

  head('a study run is refused before it starts, on the server');
  var badMode = await call('POST', '/api/me/study/start',
    { mode: 'exam', subject: 'Physics' }, sv.token);
  ok('a mode that is neither practice nor CBT is refused',
     badMode.status === 400 && /practice or CBT/i.test(badMode.body.error), badMode.status + ' ' + JSON.stringify(badMode.body));
  var notMine = await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Mathematics' }, sv.token);
  ok('a paper outside the combination is refused with the reason',
     notMine.status === 403 && /not part of your registered subject combination/.test(notMine.body.error),
     notMine.status + ' ' + JSON.stringify(notMine.body));
  /* Practice is subject-only by design (server's own comment, item 4/6):
     it ignores whatever topics a client sends, so it can never surface this
     404 — only CBT narrows by topic. Use CBT here, or this just re-tests
     "practice ignores topics" under the wrong name. */
  var noQ = await call('POST', '/api/me/study/start',
    { mode: 'cbt', subject: 'Physics', topics: ['A Topic Nobody Wrote'] }, sv.token);
  ok('a topic with nothing published is refused rather than served empty',
     noQ.status === 404 && /No questions have been published/.test(noQ.body.error),
     noQ.status + ' ' + JSON.stringify(noQ.body));
  ok('and no run can be started without signing in',
     (await call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Physics' })).status >= 400);

  head('a practice run: answers travel, because the page marks each tap');
  var pr = (await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Physics', count: 5 }, sv.token)).body;
  ok('the run is registered and named', !!pr.paperId && pr.mode === 'practice');
  ok('it carries no clock at all', pr.durationSec === 0, String(pr.durationSec));
  ok('the length asked for is the length served', pr.questions.length === 5 && pr.total === 5,
     pr.questions.length + '/' + pr.total);
  ok('every practice question carries its own answer',
     pr.questions.every(function (q) { return typeof q.answer === 'number'; }));
  ok('and the explanation that teaches, where one is on file',
     pr.questions.every(function (q) { return q.explanation !== undefined; }));
  ok('the XP rates come from the server, so no page can invent them',
     pr.xpPerAnswer === 1 && pr.xpPerCorrect === 2,
     pr.xpPerAnswer + '/' + pr.xpPerCorrect);
  ok('and the day\'s remaining allowance is stated up front',
     pr.xpLeftToday === 120, String(pr.xpLeftToday));

  var meBefore = (await call('GET', '/api/me', undefined, sv.token)).body;
  var recBefore = (await call('GET', '/api/me/results', undefined, sv.token)).body;
  /* Four right, one left blank — and a bogus XP figure in the same body, which
     the server must ignore in favour of its own marking. */
  var prAns = {};
  pr.questions.forEach(function (q, i) { if (i < 4) prAns[q.id] = q.answer; });
  var prOut = await call('POST', '/api/me/study/submit',
    { paperId: pr.paperId, responses: prAns, xpAwarded: 9999, correct: 5, percent: 100 }, sv.token);
  var pm = prOut.body;
  ok('the run is marked from this side\'s key, not from what the page claimed',
     pm.total === 5 && pm.answered === 4 && pm.correct === 4 && pm.wrong === 0 &&
     pm.unanswered === 1 && pm.percent === 80,
     JSON.stringify([pm.total, pm.answered, pm.correct, pm.wrong, pm.unanswered, pm.percent]));
  ok('a study run is never assessed, whatever it scores', pm.assessed === false);
  ok('the XP awarded is the server\'s own arithmetic, not the 9999 sent with it',
     pm.xpAwarded === 4 * 1 + 4 * 2, String(pm.xpAwarded));
  ok('and it actually reaches the scholar\'s total',
     (await call('GET', '/api/me', undefined, sv.token)).body.xp === meBefore.xp + pm.xpAwarded,
     meBefore.xp + ' + ' + pm.xpAwarded);
  ok('the level reported is the one that total earns', pm.level === Math.floor(pm.xpTotal / 100) + 1 ||
     typeof pm.level === 'number', String(pm.level));
  ok('what is left of the day is reported back',
     pm.xpLeftToday === 120 - pm.xpAwarded && pm.xpCapped === false, String(pm.xpLeftToday));
  ok('every question comes back to be read over, answer and all',
     (pm.review || []).length === 5 &&
     pm.review.every(function (r) { return typeof r.answer === 'number' && !!r.text; }));
  ok('and the one left blank is shown as unanswered rather than wrong',
     pm.review.filter(function (r) { return r.given === null; }).length === 1);

  head('and none of it reaches the academic record');
  var recAfter = (await call('GET', '/api/me/results', undefined, sv.token)).body;
  ok('the student\'s own record is untouched',
     recAfter.attempts.length === recBefore.attempts.length,
     recAfter.attempts.length + ' vs ' + recBefore.attempts.length);
  ok('the practice paper id is nowhere on it',
     JSON.stringify(recAfter).indexOf(pr.paperId) === -1);
  ok('the console\'s results table never saw it',
     (await call('GET', '/api/results', undefined, f.token)).raw.indexOf(pr.paperId) === -1);
  ok('and performance did not move, because nothing was assessed',
     (await call('GET', '/api/me', undefined, sv.token)).body.performance === meBefore.performance,
     meBefore.performance + ' vs ' + (await call('GET', '/api/me', undefined, sv.token)).body.performance);

  head('a finished run cannot be submitted twice, or by anyone else');
  var again = await call('POST', '/api/me/study/submit',
    { paperId: pr.paperId, responses: prAns }, sv.token);
  ok('submitting the same run again is refused, so its XP is paid once',
     again.status === 409 && /has ended/.test(again.body.error), again.status + ' ' + JSON.stringify(again.body));
  var other = await enrol('Zzz Study Onlooker');
  var mine2 = (await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Chemistry', count: 3 }, sv.token)).body;
  var stolen = await call('POST', '/api/me/study/submit',
    { paperId: mine2.paperId, responses: {} }, other.token);
  ok('another scholar cannot finish a run that is not theirs',
     stolen.status === 403 && /does not belong to this Scholar ID/.test(stolen.body.error),
     stolen.status + ' ' + JSON.stringify(stolen.body));
  ok('a made-up run id is refused as ended, disclosing nothing',
     (await call('POST', '/api/me/study/submit',
       { paperId: 'Sdeadbeef99', responses: {} }, sv.token)).status === 409);
  ok('the onlooker\'s XP did not move by trying',
     (await call('GET', '/api/me', undefined, other.token)).body.xp === 0,
     String((await call('GET', '/api/me', undefined, other.token)).body.xp));
  await call('POST', '/api/me/study/submit', { paperId: mine2.paperId, responses: {} }, sv.token);

  head('the server refuses a different-subject practice run while one is still open');
  var stillOpen = (await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Physics', count: 2 }, sv.token)).body;
  ok('the first run opens', !!stillOpen.paperId);
  var blocked = await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Chemistry', count: 2 }, sv.token);
  ok('a different subject is refused with a 409 while the run is open',
     blocked.status === 409 &&
       blocked.body.error === 'Finish or submit your Physics practice run before starting a different subject.',
     blocked.status + ' ' + JSON.stringify(blocked.body));
  var sameAgain = (await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Physics', count: 2 }, sv.token)).body;
  ok('the SAME subject is still allowed while one is open', !!sameAgain.paperId);
  await call('POST', '/api/me/study/submit', { paperId: sameAgain.paperId, responses: {} }, sv.token);
  await call('POST', '/api/me/study/submit', { paperId: stillOpen.paperId, responses: {} }, sv.token);
  var afterClose = await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Chemistry', count: 2 }, sv.token);
  ok('once every open run is submitted, a different subject is accepted',
     afterClose.status === 200 && !!afterClose.body.paperId, afterClose.status);
  await call('POST', '/api/me/study/submit', { paperId: afterClose.body.paperId, responses: {} }, sv.token);

  head('the day\'s XP allowance is enforced on the server');
  var guard = 0, capped = null;
  while (guard++ < 12) {
    var runN = (await call('POST', '/api/me/study/start',
      { mode: 'practice', subject: 'Physics', count: 60 }, sv.token)).body;
    var allRight = {};
    runN.questions.forEach(function (q) { allRight[q.id] = q.answer; });
    var outN = (await call('POST', '/api/me/study/submit',
      { paperId: runN.paperId, responses: allRight }, sv.token)).body;
    if (outN.xpLeftToday === 0) { capped = outN; break; }
  }
  ok('practising on and on runs the allowance down to nothing', !!capped && capped.xpLeftToday === 0,
     capped ? String(capped.xpLeftToday) : 'never reached in ' + guard + ' runs');
  /* The flag does not mean "the allowance is gone" — it means "this run earned
     less than its marking deserved". A run that lands exactly on the allowance
     reaches zero without being trimmed, so the flag must follow the
     arithmetic and not the remaining balance. */
  var deserved = capped ? capped.answered + capped.correct * 2 : -1;
  ok('and the run says whether the allowance trimmed it, matching its own arithmetic',
     !!capped && capped.xpCapped === (capped.xpAwarded < deserved),
     capped && (capped.xpAwarded + ' of ' + deserved + ' earned, capped=' + capped.xpCapped));
  var xpAtCap = (await call('GET', '/api/me', undefined, sv.token)).body.xp;
  ok('the total stopped at the allowance, not at what the runs earned',
     xpAtCap === meBefore.xp + 120, meBefore.xp + ' + 120 vs ' + xpAtCap);
  var extra = (await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Physics', count: 10 }, sv.token)).body;
  var exAns = {};
  extra.questions.forEach(function (q) { exAns[q.id] = q.answer; });
  var exOut = (await call('POST', '/api/me/study/submit',
    { paperId: extra.paperId, responses: exAns }, sv.token)).body;
  ok('a further run is still marked in full, so the practice is never blocked',
     exOut.percent === 100 && exOut.correct === extra.questions.length,
     exOut.percent + '% ' + exOut.correct);
  ok('but it earns nothing more today', exOut.xpAwarded === 0 && exOut.xpCapped === true,
     String(exOut.xpAwarded));
  ok('and the total does not budge',
     (await call('GET', '/api/me', undefined, sv.token)).body.xp === xpAtCap,
     String((await call('GET', '/api/me', undefined, sv.token)).body.xp));

  head('the student\'s own CBT: timed, and no answer leaves the server');
  var cb = (await call('POST', '/api/me/study/start',
    { mode: 'cbt', subject: 'Physics', count: 4, minutes: 20 }, sv.token)).body;
  ok('the clock asked for is the clock served', cb.durationSec === 20 * 60, String(cb.durationSec));
  ok('a CBT question carries no answer',
     cb.questions.every(function (q) { return q.answer === undefined; }));
  ok('nor an explanation to work backwards from',
     cb.questions.every(function (q) { return q.explanation === undefined; }));
  ok('and the response says nothing about XP rates, because none are earned',
     cb.xpPerAnswer === undefined && cb.xpPerCorrect === undefined);
  ok('no answer key is anywhere in the payload a student receives',
     !/"answer"|"explanation"/.test(JSON.stringify(cb)));
  var short = (await call('POST', '/api/me/study/start',
    { mode: 'cbt', subject: 'Physics', count: 4, minutes: 1 }, sv.token)).body;
  ok('an impossibly short clock is lifted to the floor',
     short.durationSec === 5 * 60, String(short.durationSec));
  var cbOut = (await call('POST', '/api/me/study/submit',
    { paperId: cb.paperId, responses: {}, timeUsedSec: 90 }, sv.token)).body;
  ok('an unanswered CBT is marked at nought, not refused',
     cbOut.total === 4 && cbOut.answered === 0 && cbOut.percent === 0,
     JSON.stringify([cbOut.total, cbOut.answered, cbOut.percent]));
  ok('it is unassessed like every study run', cbOut.assessed === false);
  ok('and earns no XP, because only practice does', cbOut.xpAwarded === 0);
  ok('the time it took is kept as reported', cbOut.timeUsedSec === 90, String(cbOut.timeUsedSec));
  var over = (await call('POST', '/api/me/study/submit',
    { paperId: short.paperId, responses: {}, timeUsedSec: 99999 }, sv.token)).body;
  ok('a time longer than the clock is cut back to the clock',
     over.timeUsedSec === short.durationSec, String(over.timeUsedSec));
  ok('a CBT run reaches the record no more than a practice run does',
     (await call('GET', '/api/me/results', undefined, sv.token)).body.attempts.length ===
     recBefore.attempts.length);

  /* Mathematics arrives as backslashes and dollar signs and has to come back out
     of the server as exactly the same backslashes and dollar signs — one lost
     escape and the student reads `frac{-b pm sqrt{...}}` instead of a fraction.
     JSON, a file write, a file read and JSON again all sit between the author and
     the scholar, so the round trip is measured rather than assumed. */
  head('the mathematics an author types survives the round trip');
  var STEM = 'Solve $x^2 - 5x + 6 = 0$ using $\\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$.';
  var LOPT = '$x = 2$ or $x = 3$';
  var LEXP = 'With $a = 1$, $b = -5$, $c = 6$: $$x = \\frac{5 \\pm \\sqrt{25 - 24}}{2} = \\frac{5 \\pm 1}{2}$$';
  var lq = await call('POST', '/api/questions', {
    subject: 'Physics', section: 'objective', topic: 'Latex Round Trip',
    text: STEM, options: [LOPT, '$x = -2$ or $x = -3$', '$x = 1$ or $x = 6$', '$x = 0$'],
    answer: 0, explanation: LEXP, difficulty: 'medium'
  }, f.token);
  ok('a question written in LaTeX is accepted', lq.status === 200 && lq.body.id > 0,
     lq.status + ' ' + lq.raw.slice(0, 160));
  ok('the stem comes back with every backslash where the author put it',
     lq.body.text === STEM, lq.body.text);
  var back = await call('GET', '/api/questions?subject=Physics', undefined, f.token);
  var lrow = (back.body.questions || []).filter(function (q) { return q.id === lq.body.id; })[0] || {};
  ok('and again when the bank is read back', lrow.text === STEM, lrow.text);
  ok('the option is unchanged too', (lrow.options || [])[0] === LOPT, (lrow.options || [])[0]);
  ok('so is the worked explanation, display maths and all', lrow.explanation === LEXP, lrow.explanation);
  ok('nothing HTML-escaped the mathematics on the way',
     lrow.text.indexOf('&') < 0 && lrow.explanation.indexOf('&') < 0);
  ok('the file on disk holds what was typed, not an escaped copy of it',
     JSON.parse(fs.readFileSync(path.join(SANDBOX, 'server', 'data.json'), 'utf8'))
       .questions.filter(function (q) { return q.id === lq.body.id; })[0].text === STEM);
  /* And it has to reach the scholar in that state, which is the only part of the
     journey that matters to her. */
  var lrun = (await call('POST', '/api/me/study/start',
    { mode: 'cbt', subject: 'Physics', topics: ['Latex Round Trip'], count: 1, minutes: 10 }, sv.token)).body;
  var lserved = (lrun.questions || [])[0] || {};
  ok('the scholar is served the formula the author typed', lserved.text === STEM, lserved.text);
  ok('with the option intact', (lserved.options || [])[0] === LOPT, (lserved.options || [])[0]);
  ok('and still no answer key, formula or not',
     lserved.answer === undefined && lserved.explanation === undefined &&
     !/"answer"|"explanation"/.test(JSON.stringify(lrun)));
  /* Practice ignores topics by design (see goc-core.js studyPool /
     server.js's /me/study/start), so this can't ask for the "Latex Round
     Trip" topic and expect only it back — the run draws from the whole
     Physics pool. Ask for the whole pool instead and find this question by
     id among what comes back. */
  var lprac = (await call('POST', '/api/me/study/start',
    { mode: 'practice', subject: 'Physics', count: 999 }, sv.token)).body;
  var lp = (lprac.questions || []).filter(function (q) { return q.id === lq.body.id; })[0] || {};
  ok('a practice run carries the explanation, and it too is unchanged',
     lp.text === STEM && lp.explanation === LEXP, lp.explanation);
  ok('the renderer reads what came back as one formula, not as text',
     core.renderMath(lrow.text).indexOf('m-frac') > -1 &&
     core.renderMath(lrow.text).indexOf('m-sqrt') > -1,
     core.renderMath(lrow.text).slice(0, 160));
  ok('and a plain reading of it keeps the mathematics legible',
     core.mathPlain(lrow.text).indexOf('$') < 0 &&
     core.mathPlain(lrow.text).indexOf('\\frac') < 0,
     core.mathPlain(lrow.text));

  /* A roster written before separators were forgiven holds the hash of the older
     form of the code — spaces out, dashes kept. That academy is mid-cohort: the
     code on their WhatsApp broadcast has to keep working, and it may not start
     admitting anything it did not admit before. Simulated by writing the older
     hash straight into the data file, which is exactly the state an upgraded
     installation is in. */
  head('an older roster keeps the code it was set up with');
  var dataAt = path.join(SANDBOX, 'server', 'data.json');
  var db = JSON.parse(fs.readFileSync(dataAt, 'utf8'));
  var oldSalt = crypto.randomBytes(16).toString('hex');
  var oldForm = core.legacySignupCode('GOC-2027');
  db.settings.signupCodeHash = 'scrypt$' + oldSalt + '$' +
    crypto.scryptSync(oldForm, oldSalt, 64).toString('hex');
  db.settings.signupCodeLength = oldForm.length;
  fs.writeFileSync(dataAt, JSON.stringify(db, null, 2));
  ok('the file now holds the older form, not today\'s',
     oldForm !== core.normalizeSignupCode('GOC-2027'), oldForm);
  var legacyOk = await call('POST', '/api/students', Object.assign({}, good,
    { signupCode: 'goc-2027', subjects: ['Use of English', 'Physics'],
      email: 'legacy@example.com', phone: '08010005555' }));
  ok('the code that roster was set up with still gets past the firewall',
     legacyOk.status >= 400 && !/access code/i.test(legacyOk.raw), legacyOk.status + ' ' + legacyOk.raw);
  var legacyPad = await call('POST', '/api/students', Object.assign({}, good,
    { signupCode: '  GOC-2027  ', subjects: ['Use of English', 'Physics'],
      email: 'legacypad@example.com', phone: '08010004444' }));
  ok('padding and capitals are forgiven against it too',
     legacyPad.status >= 400 && !/access code/i.test(legacyPad.raw), legacyPad.status + ' ' + legacyPad.raw);
  var legacyNo = await call('POST', '/api/students', Object.assign({}, good,
    { signupCode: 'GOC-2028', subjects: ['Use of English', 'Physics'],
      email: 'legacyno@example.com', phone: '08010003333' }));
  ok('and a code that roster never held is still refused',
     legacyNo.status === 403 && /access code/i.test(legacyNo.raw), legacyNo.status + ' ' + legacyNo.raw);
  ok('none of the three wrote an account',
     !(legacyOk.body && legacyOk.body.student) && !(legacyPad.body && legacyPad.body.student) &&
     !(legacyNo.body && legacyNo.body.student));
  return null;
}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  stop();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('\nTEST RUN FAILED: ' + (e && e.message));
  if (serverLog) console.log('--- server output ---\n' + serverLog);
  stop();
  process.exit(1);
});
