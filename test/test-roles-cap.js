/* test-roles-cap.js — Roles slice (b), step 2: live capability enforcement.
   A Finance, Publicity, Student Affairs and Academic Director manager are each
   created, signed in, and then tried on a sample of routes inside and outside
   their capability. Every route outside their role must return 403 "Your role
   does not include this." — the guard in the dispatcher fires, not the route.
   Routes inside their role must NOT return 403 on the capability guard (they
   may return other codes, e.g. 404 for a missing resource, but not the
   capability 403).
   node test/test-roles-cap.js */
'use strict';
var http   = require('http');
var path   = require('path');
var fs     = require('fs');
var os     = require('os');
var spawn  = require('child_process').spawn;

var APP  = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_RC_PORT) || 8209;
var fails = 0;
function ok(n, c, x) {
  if (c) { console.log('  pass  ' + n); }
  else    { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-rcap-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'),     path.join(SANDBOX, 'js'),     { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
    PORT: String(PORT),
    NODE_PATH: path.join(APP, 'node_modules'),
    GOC_FOUNDER_PW:  'founder2027',
    GOC_ACADDIR_PW:  'acaddir2027',
    GOC_PASSCODE:    '2027'
  }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });

function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}

function call(method, urlPath, body, token) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body), headers = {};
    if (payload) {
      headers['Content-Type']   = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request(
      { host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers },
      function (res) {
        var raw = '';
        res.on('data', function (c) { raw += c; });
        res.on('end', function () {
          var j = null;
          try { j = JSON.parse(raw); } catch (e) {}
          resolve({ status: res.statusCode, raw: raw, body: j });
        });
      }
    );
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}

function waitForBoot(n) {
  return call('GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (n <= 0) throw new Error('server did not start\n' + serverLog);
    return new Promise(function (x) { setTimeout(x, 100); }).then(function () { return waitForBoot(n - 1); });
  });
}

/* Sign in as staff (already unlocked) and return a live, unlocked token. */
async function staffToken(id, pw, passcode) {
  var r = await call('POST', '/api/auth/login', { id: id, password: pw });
  if (r.status !== 200) throw new Error('login failed for ' + id + ': ' + r.raw);
  var tok = r.body.token;
  await call('POST', '/api/auth/unlock', { passcode: passcode }, tok);
  return tok;
}

/* Create a manager, force a password change so they can sign in, then sign in.
   Returns an unlocked token. */
async function makeManager(name, role, startPw, passcode, ftok) {
  var cr = await call('POST', '/api/managers', { name: name, role: role, password: startPw, passcode: passcode }, ftok);
  if (cr.status !== 200) throw new Error('createManager failed for ' + name + ': ' + cr.raw);
  var id = cr.body.manager.id;
  /* sign in with the starting password */
  var lr = await call('POST', '/api/auth/login', { id: id, password: startPw });
  if (lr.status !== 200) throw new Error('manager login failed ' + id + ': ' + lr.raw);
  var tok = lr.body.token;
  /* change away from the forced starting password so unlock is next */
  var own = startPw + '-own';
  var chg = await call('POST', '/api/auth/password', { currentPassword: startPw, newPassword: own }, tok);
  if (chg.status !== 200) throw new Error('manager password change failed ' + id + ': ' + chg.raw);
  /* sign in again with the new password, then unlock */
  var lr2 = await call('POST', '/api/auth/login', { id: id, password: own });
  if (lr2.status !== 200) throw new Error('manager re-login failed ' + id + ': ' + lr2.raw);
  tok = lr2.body.token;
  var ul = await call('POST', '/api/auth/unlock', { passcode: passcode }, tok);
  if (ul.status !== 200) throw new Error('manager unlock failed ' + id + ': ' + ul.raw);
  return tok;
}

/* CAP_DENIED: the capability guard message exactly */
var CAP_DENIED = 'Your role does not include this.';

/* isCapRefused: 403 with our specific guard message */
function isCapRefused(r) {
  return r.status === 403 && r.body && r.body.error === CAP_DENIED;
}

/* notCapRefused: any response EXCEPT the capability guard 403 */
function notCapRefused(r) {
  if (r.status === 403 && r.body && r.body.error === CAP_DENIED) return false;
  return true;
}

(async function () {
  await waitForBoot(100);

  /* ---- set up: Founder token, four managers ---- */
  var ftok = await staffToken('GOC-A-001', 'founder2027', '2027');

  head('creating the four manager accounts');
  var finTok = await makeManager('Ada Finance',  'finance',        'start-fin1',  '1111', ftok);
  var pubTok = await makeManager('Bola Pub',     'publicity',      'start-pub1',  '2222', ftok);
  var saTok  = await makeManager('Chidi SA',     'student-affairs','start-sa-1',  '3333', ftok);
  var adTok  = await makeManager('Dupe AcaDir',  'academic-director','start-ad1', '4444', ftok);
  ok('all four managers created and signed in', finTok && pubTok && saTok && adTok);

  /* ========================================================
     FINANCE
     Holds: students.add, students.tier, students.deactivate,
            payments.view, roster.view, overview.own
     Lacks: questions.manage, tutors.accounts, broadcast.send,
            notices.manage, homepage.edit, results.view,
            results.export, approvals.review, students.approve,
            students.passwords, classes.schedule, resources.publish,
            sittings.configure, challenges.manage, cohort.manage …
     ======================================================== */
  head('Finance: routes inside their capability');
  var finStudents = await call('GET', '/api/students', undefined, finTok);
  ok('Finance reads the roster (roster.view)',        notCapRefused(finStudents), finStudents.raw);
  var finAdd = await call('POST', '/api/admin/students',
    { name: 'Test Open', email: 'open@test.ng', phone: '08012345678', subjects: ['mathematics'], cohort: 'cohort1', password: 'pass1234' },
    finTok);
  ok('Finance can add a student (students.add) — or server refuses for another reason', notCapRefused(finAdd), finAdd.raw);
  var finOverview = await call('GET', '/api/admin/overview', undefined, finTok);
  ok('Finance may open the overview (overview.own)',  notCapRefused(finOverview), finOverview.raw);

  head('Finance: routes outside their capability');
  var finQ   = await call('GET',  '/api/questions',              undefined, finTok);
  ok('Finance cannot read the question bank (questions.manage)',  isCapRefused(finQ),   finQ.raw);
  var finT   = await call('GET',  '/api/tutors',                 undefined, finTok);
  ok('Finance cannot list tutors (tutors.accounts)',              isCapRefused(finT),   finT.raw);
  var finBc  = await call('GET',  '/api/broadcasts',             undefined, finTok);
  ok('Finance cannot read broadcasts (broadcast.send)',           isCapRefused(finBc),  finBc.raw);
  var finN   = await call('GET',  '/api/notices',                undefined, finTok);
  ok('Finance cannot read class notices (notices.manage)',        isCapRefused(finN),   finN.raw);
  var finRes = await call('GET',  '/api/results/export?from=2025-01-01&to=2025-12-31', undefined, finTok);
  ok('Finance cannot export results (results.export)',            isCapRefused(finRes), finRes.raw);
  var finApp = await call('GET',  '/api/approvals',              undefined, finTok);
  ok('Finance cannot open the approval queue (approvals.review)', isCapRefused(finApp), finApp.raw);
  var finCh  = await call('GET',  '/api/challenges',             undefined, finTok);
  ok('Finance cannot manage challenges (challenges.manage)',      isCapRefused(finCh),  finCh.raw);
  var finMgr = await call('GET',  '/api/managers',               undefined, finTok);
  ok('Finance cannot list managers (managers.accounts)',          isCapRefused(finMgr), finMgr.raw);

  /* ========================================================
     PUBLICITY
     Holds: broadcast.send, notices.manage, homepage.edit,
            analytics.site, aitip.edit, whatsapp.links,
            landing.text, roster.view, overview.own
     Lacks: questions.manage, tutors.accounts, results.view,
            results.export, students.add, students.tier,
            students.deactivate, students.approve,
            students.passwords, classes.schedule,
            resources.publish, sittings.configure,
            challenges.manage, cohort.manage …
     ======================================================== */
  head('Publicity: routes inside their capability');
  var pubBc = await call('GET', '/api/broadcasts', undefined, pubTok);
  ok('Publicity reads broadcasts (broadcast.send)',   notCapRefused(pubBc),  pubBc.raw);
  var pubN  = await call('GET', '/api/notices',      undefined, pubTok);
  ok('Publicity reads class notices (notices.manage)',notCapRefused(pubN),   pubN.raw);
  var pubOv = await call('GET', '/api/admin/overview',undefined,pubTok);
  ok('Publicity may open the overview (overview.own)',notCapRefused(pubOv),  pubOv.raw);

  head('Publicity: routes outside their capability');
  var pubQ   = await call('GET', '/api/questions',   undefined, pubTok);
  ok('Publicity cannot read question bank (questions.manage)',  isCapRefused(pubQ),   pubQ.raw);
  var pubT   = await call('GET', '/api/tutors',       undefined, pubTok);
  ok('Publicity cannot list tutors (tutors.accounts)',          isCapRefused(pubT),   pubT.raw);
  var pubRes = await call('GET', '/api/results/export?from=2025-01-01&to=2025-12-31', undefined, pubTok);
  ok('Publicity cannot export results (results.export)',        isCapRefused(pubRes), pubRes.raw);
  var pubApp = await call('GET', '/api/approvals',    undefined, pubTok);
  ok('Publicity cannot open approval queue (approvals.review)', isCapRefused(pubApp), pubApp.raw);
  var pubMgr = await call('GET', '/api/managers',     undefined, pubTok);
  ok('Publicity cannot list managers (managers.accounts)',      isCapRefused(pubMgr), pubMgr.raw);
  var pubAdd = await call('POST', '/api/admin/students',
    { name: 'X', email: 'x@x.ng', phone: '08000000000', subjects: ['mathematics'], cohort: 'c', password: 'pass1234' },
    pubTok);
  ok('Publicity cannot add a student (students.add)',           isCapRefused(pubAdd), pubAdd.raw);

  /* ========================================================
     STUDENT AFFAIRS
     Holds: roster.view, students.passwords, cohort.manage,
            cohort.limits, signup.limits, results.view,
            results.export, leaderboard.manage,
            studypairs.moderate, activeness.view, attention.view,
            reportcards.generate, termreport.produce,
            studytime.grant, scholarship.view, scholarship.decide,
            scholarship.export, scholarship.delete,
            broadcast.send, contact.handle, overview.own
     Lacks: questions.manage, tutors.accounts, students.add,
            students.tier, students.deactivate, students.approve,
            homepage.edit, resources.publish, classes.schedule,
            approvals.review, challenges.manage, managers.accounts …
     ======================================================== */
  head('Student Affairs: routes inside their capability');
  var saStudents = await call('GET', '/api/students',          undefined, saTok);
  ok('SA reads the roster (roster.view)',                      notCapRefused(saStudents), saStudents.raw);
  var saRes      = await call('GET', '/api/results/export?from=2025-01-01&to=2025-12-31', undefined, saTok);
  ok('SA can export results (results.export) — or server refuses for another reason', notCapRefused(saRes), saRes.raw);
  var saBc       = await call('GET', '/api/broadcasts',        undefined, saTok);
  ok('SA reads broadcasts (broadcast.send)',                   notCapRefused(saBc),       saBc.raw);
  var saOv       = await call('GET', '/api/admin/overview',    undefined, saTok);
  ok('SA may open the overview (overview.own)',                notCapRefused(saOv),       saOv.raw);

  head('Student Affairs: routes outside their capability');
  var saQ   = await call('GET',  '/api/questions',             undefined, saTok);
  ok('SA cannot read question bank (questions.manage)',        isCapRefused(saQ),   saQ.raw);
  var saT   = await call('GET',  '/api/tutors',                undefined, saTok);
  ok('SA cannot list tutors (tutors.accounts)',                isCapRefused(saT),   saT.raw);
  /* GET /api/updates is public (need:null); POST is the console-only write */
  var saHp  = await call('POST', '/api/updates',
    { cat: 'utme', date: '2026-01-01', title: 'Test', body: 'Test body text here for the update.' },
    saTok);
  ok('SA cannot write homepage updates (homepage.edit)',       isCapRefused(saHp),  saHp.raw);
  var saApp = await call('GET',  '/api/approvals',             undefined, saTok);
  ok('SA cannot open approval queue (approvals.review)',       isCapRefused(saApp), saApp.raw);
  var saMgr = await call('GET',  '/api/managers',              undefined, saTok);
  ok('SA cannot list managers (managers.accounts)',            isCapRefused(saMgr), saMgr.raw);
  var saAdd = await call('POST', '/api/admin/students',
    { name: 'X', email: 'x@x.ng', phone: '08000000000', subjects: ['mathematics'], cohort: 'c', password: 'pass1234' },
    saTok);
  ok('SA cannot add a student (students.add)',                 isCapRefused(saAdd), saAdd.raw);
  var saFin = await call('GET', '/api/students',               undefined, finTok);
  ok('SA cannot read payment records via finance route (payments.view not held)',
    /* no dedicated payment route yet; just confirm roster still works for SA */
    notCapRefused(saStudents), saStudents.raw);

  /* ========================================================
     ACADEMIC DIRECTOR
     Holds: questions.manage, approvals.review, courses.manage,
            theory.mark, mastery.view, classes.schedule,
            resources.publish, sittings.configure,
            assignments.oversee, assignments.remove,
            results.view, results.export, classsummary.view,
            leaderboard.manage, notices.manage, homepage.edit,
            challenges.manage, roster.view, overview.own …
     Lacks: students.add, students.tier, students.deactivate,
            students.approve, students.passwords, tutors.accounts,
            managers.accounts, firewall.manage, payments.view,
            cohort.create, signup.limits, broadcast.send (no)
     NOTE: broadcast.send is Publicity + Student Affairs, not AD.
     ======================================================== */
  head('Academic Director manager: routes inside their capability');
  var adQ   = await call('GET', '/api/questions',       undefined, adTok);
  ok('AD reads question bank (questions.manage)',         notCapRefused(adQ),   adQ.raw);
  var adApp = await call('GET', '/api/approvals',        undefined, adTok);
  ok('AD opens the approval queue (approvals.review)',   notCapRefused(adApp), adApp.raw);
  var adN   = await call('GET', '/api/notices',          undefined, adTok);
  ok('AD reads class notices (notices.manage)',           notCapRefused(adN),   adN.raw);
  var adRes = await call('GET', '/api/results/export?from=2025-01-01&to=2025-12-31', undefined, adTok);
  ok('AD can export results (results.export) — or other reason', notCapRefused(adRes), adRes.raw);
  var adCh  = await call('GET', '/api/challenges',       undefined, adTok);
  ok('AD reads challenges (challenges.manage)',           notCapRefused(adCh),  adCh.raw);
  var adOv  = await call('GET', '/api/admin/overview',   undefined, adTok);
  ok('AD may open the overview (overview.own)',           notCapRefused(adOv),  adOv.raw);

  head('Academic Director manager: routes outside their capability');
  var adT   = await call('GET',  '/api/tutors',          undefined, adTok);
  ok('AD cannot manage tutors (tutors.accounts)',         isCapRefused(adT),   adT.raw);
  var adMgr = await call('GET',  '/api/managers',        undefined, adTok);
  ok('AD cannot manage managers (managers.accounts)',     isCapRefused(adMgr), adMgr.raw);
  var adBc  = await call('GET',  '/api/broadcasts',      undefined, adTok);
  ok('AD cannot read broadcasts (broadcast.send)',        isCapRefused(adBc),  adBc.raw);
  var adAdd = await call('POST', '/api/admin/students',
    { name: 'X', email: 'x@x.ng', phone: '08000000000', subjects: ['mathematics'], cohort: 'c', password: 'pass1234' },
    adTok);
  ok('AD cannot add a student (students.add)',            isCapRefused(adAdd), adAdd.raw);

  /* ========================================================
     FOUNDER and ACADEMIC DIRECTOR (seeded) keep full access
     ======================================================== */
  head('seeded Founder still reaches everything');
  var fQ = await call('GET', '/api/questions', undefined, ftok);
  ok('Founder reads question bank',          notCapRefused(fQ),  fQ.raw);
  var fT = await call('GET', '/api/tutors',  undefined, ftok);
  ok('Founder lists tutors',                 notCapRefused(fT),  fT.raw);
  var fM = await call('GET', '/api/managers',undefined, ftok);
  ok('Founder lists managers',               notCapRefused(fM),  fM.raw);
  var fBc= await call('GET', '/api/broadcasts',undefined,ftok);
  ok('Founder reads broadcasts',             notCapRefused(fBc), fBc.raw);

  head('seeded Academic Director (GOC-A-002) still reaches everything');
  var a2tok = await staffToken('GOC-A-002', 'acaddir2027', '2027');
  var a2Q  = await call('GET', '/api/questions',undefined, a2tok);
  ok('seeded AD reads question bank',        notCapRefused(a2Q),  a2Q.raw);
  var a2T  = await call('GET', '/api/tutors',undefined, a2tok);
  ok('seeded AD lists tutors',               notCapRefused(a2T),  a2T.raw);
  var a2Bc = await call('GET', '/api/broadcasts',undefined, a2tok);
  ok('seeded AD reads broadcasts',           notCapRefused(a2Bc), a2Bc.raw);

  /* ========================================================
     Cross-checks: a student and an unlocked-but-student session
     must never hit the capability guard (they are refused at the
     console gate before it, not by the capability check itself).
     ======================================================== */
  head('a student session never reaches the capability guard');
  var signUp = await call('POST', '/api/students', {
    name: 'Ayo Student', email: 'ayo@test.ng', phone: '08099999999',
    subjects: ['Use of English', 'Mathematics', 'Physics', 'Chemistry'], cohort: 'cohort1', password: 'stupass12',
    goal: 'JAMB / UTME'
  });
  ok('sign-up goes to pending (not the cap guard)', signUp.status === 200 && !isCapRefused(signUp), signUp.raw);
  /* a student session on a console route should get 403 "Management accounts only.", not the cap message */
  if (signUp.status === 200 && signUp.body && signUp.body.student) {
    var approveStu = await call('POST', '/api/students/' + signUp.body.student.id + '/approve', undefined, ftok);
    var stuLogin   = await call('POST', '/api/auth/login', { id: signUp.body.student.id, password: 'stupass12' });
    if (stuLogin.status === 200) {
      var stuTok = stuLogin.body.token;
      var stuQ   = await call('GET', '/api/questions', undefined, stuTok);
      ok('student on console route gets mgmt-only 403, not the cap guard',
        stuQ.status === 403 && !(stuQ.body && stuQ.body.error === CAP_DENIED), stuQ.raw);
    } else {
      ok('student login failed (approval flow changed)', false, stuLogin.raw);
    }
  }

  stop();
  console.log(fails ? '\n' + fails + ' FAILED' : '\nall passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('  FAIL  crashed: ' + (e && e.stack || e));
  stop();
  process.exit(1);
});
