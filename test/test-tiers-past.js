/* test-tiers-past.js — Phase 3B, access tiers slice 2: past questions by year. An Open student may pick only
   the newest year a subject holds; GOC may pick any. Enforced on the server.
   node test/test-tiers-past.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = 'GOC2027';
var PORT = Number(process.env.GOC_TIER_PAST_PORT) || 8158;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-tier-past-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
/* Open practice is unrestricted in the live table; this suite proves the limit
   machinery, so the sandbox copy of the core carries the old Open numbers. */
require('./legacy-limits.js').patchSandbox(SANDBOX);
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var DATA = path.join(SANDBOX, 'server', 'data.json');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); }
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
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
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

var child = null, serverLog = '';
function start() {
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (c) { serverLog += c; });
  child.stderr.on('data', function (c) { serverLog += c; });
  return waitForBoot(60);
}
function halt() {
  return new Promise(function (resolve) {
    if (!child) return resolve();
    child.once('exit', function () { child = null; resolve(); });
    child.kill();
  });
}
function cleanup() {
  try { if (child) child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}
function readDb() { return JSON.parse(fs.readFileSync(DATA, 'utf8')); }
function writeDb(db) { fs.writeFileSync(DATA, JSON.stringify(db)); }

function signupBody(name, phone) {
  return { signupCode: SIGNUP, name: name, password: 'secret123', email: name.split(' ')[0].toLowerCase() + '@example.com',
    phone: phone, goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] };
}





var staff, openToken, gocToken;
function pq(year, n) { return { subject: 'Chemistry', section: 'practice', topic: 'Acids', text: 'Past question ' + year + ' number ' + n + ' about acids?', options: ['a', 'b', 'c', 'd'], answer: 1, year: year }; }
function chem(r) { return ((r.body.subjects || []).filter(function (s) { return s.subject === 'Chemistry'; })[0]) || {}; }
function yrs(e) { return (e.years || []).map(function (y) { return y.year; }); }

/* The live table gives Open every year; the lock is proved on a patched copy. */
var old = require('./legacy-limits.js').loadCore(APP);
head('pure rules');
ok('live table: Open is offered every year, none locked', core.tierStudyYears([{ year: 2018 }, { year: 2021 }], 'open').length === 2 && core.lockedPastYears([2018], [{ year: 2018 }, { year: 2021 }], 'open').length === 0);
var list = [{ year: 2018, count: 2 }, { year: 2021, count: 3 }, { year: 2015, count: 1 }];
ok('Open is offered only the newest year', JSON.stringify(old.tierStudyYears(list, 'open').map(function (y) { return y.year; })) === '[2021]');
ok('GOC is offered every year, newest first', core.tierStudyYears(list, 'goc').map(function (y) { return y.year; }).join() === '2021,2018,2015');
ok('a missing tier reads as Open', old.tierStudyYears(list, undefined).length === 1);
ok('no years, no problem', core.tierStudyYears([], 'open').length === 0 && core.tierStudyYears(null, 'goc').length === 0);
ok('older held years are locked for Open', old.lockedPastYears([2018, 2021], list, 'open').join() === '2018');
ok('the newest alone is not locked', old.lockedPastYears([2021], list, 'open').length === 0);
ok('a year the subject does not hold is not "locked"', old.lockedPastYears([1999], list, 'open').length === 0);
ok('nothing is locked for GOC', core.lockedPastYears([2015, 2018], list, 'goc').length === 0);
ok('the message names the year and the way to join', /2021/.test(core.pastYearLockMessage(2021)) && /GOC/.test(core.pastYearLockMessage(2021)));

start().then(function () {
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  staff = r.body.token;
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, staff);
}).then(function () {
  var p = Promise.resolve();
  [2021, 2021, 2021, 2018, 2018].forEach(function (y, i) {
    p = p.then(function () { return call('POST', '/api/questions', pq(y, i + 1), staff); }).then(function (r) {
      if (r.status !== 200 && r.status !== 201) throw new Error('could not seed a question: ' + r.raw);
    });
  });
  return p;
}).then(function () {
  return call('POST', '/api/admin/students', { name: 'Chidi Past', email: 'chidi.past@example.com', phone: '08000000052',
    goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] }, staff);
}).then(function (r) {
  return call('POST', '/api/auth/login', { id: r.body.student.id, password: r.body.temporaryPassword });
}).then(function (r) {
  gocToken = r.body.token;
  return call('GET', '/api/me/study', undefined, gocToken);
}).then(function (r) {
  head('a GOC student');
  var e = chem(r);
  ok('is offered both years, newest first', yrs(e).join() === '2021,2018', r.raw);
  ok('  nothing is held back', e.yearsLocked === 0);
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', years: [2018], count: 5 }, gocToken);
}).then(function (r) {
  ok('can start a run from the older year', r.status === 200 && r.body.total === 2, r.raw);
  return call('POST', '/api/me/study/submit', { paperId: r.body.paperId, responses: {} }, gocToken);
}).then(function () {
  return activeStudent.signedUp(call, signupBody('Ada Past', '08000000051'));
}).then(function (r) {
  openToken = r.body.token;
  return call('GET', '/api/me/study', undefined, openToken);
}).then(function (r) {
  head('an Open student');
  var e = chem(r);
  ok('is offered only the newest year', yrs(e).join() === '2021', r.raw);
  ok('  with its real count', e.years[0].count === 3);
  ok('  and told one older year is held back', e.yearsLocked === 1, r.raw);
  ok('  the older year never appears in the reply', r.raw.indexOf('"year":2018') === -1);
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', years: [2018], count: 5 }, openToken);
}).then(function (r) {
  ok('is refused an older year (403, reason tier)', r.status === 403 && r.body.reason === 'tier', r.raw);
  ok('  the message names the newest year and how to join', /2021/.test(r.body.error || '') && /GOC/.test(r.body.error || ''), r.raw);
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', years: [2021, 2018], count: 5 }, openToken);
}).then(function (r) {
  ok('is refused when the older year is ticked among others', r.status === 403 && r.body.reason === 'tier', r.raw);
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', years: [2021], count: 5 }, openToken);
}).then(function (r) {
  ok('can start a run from the newest year', r.status === 200 && r.body.total === 3, r.raw);
  ok('  every question is from that year', (r.body.questions || []).every(function (q) { return /2021/.test(q.text); }), r.raw);
  return call('POST', '/api/me/study/submit', { paperId: r.body.paperId, responses: {} }, openToken);
}).then(function () {
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', years: [1999], count: 5 }, openToken);
}).then(function (r) {
  ok('a year the subject never held gets the ordinary "no questions" answer', r.status === 404, r.raw);
  return call('POST', '/api/me/study/start', { mode: 'practice', subject: 'Chemistry', count: 5 }, openToken);
}).then(function (r) {
  ok('ordinary practice with no year ticked is not affected', r.status === 200 && r.body.total > 0, r.raw);
}).then(function () {
  cleanup();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'tiers (past questions): all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  ' + (e && e.stack || e) + '\n' + serverLog.slice(-600));
  cleanup();
  process.exit(1);
});
