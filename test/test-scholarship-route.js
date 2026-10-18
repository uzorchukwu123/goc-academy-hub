/* test-scholarship-route.js — B#2 slice 2: server store + routes.
   Boots a throwaway server and exercises all scholarship HTTP endpoints.
   node test/test-scholarship-route.js */
'use strict';
var http    = require('http');
var path    = require('path');
var fs      = require('fs');
var os      = require('os');
var spawn   = require('child_process').spawn;

var APP  = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_SCHOL_PORT) || 8188;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-schol-route-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'),     path.join(SANDBOX, 'js'),     { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
var DATA = path.join(SANDBOX, 'server', 'data.json');

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else       { fails++;  console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token)   headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        var j = null; try { j = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, body: j, raw: raw, headers: res.headers });
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

var child = null;
function start() {
  child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, {
      PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: 'GOC2027'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  var log = '';
  child.stdout.on('data', function (c) { log += c; });
  child.stderr.on('data', function (c) { log += c; });
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

/* ---- shared helpers ---- */
var VALID_APPLICATION = {
  name:        'Adaeze Okonkwo',
  email:       'adaeze@example.com',
  phone:       '08012345678',
  state:       'Lagos',
  city:        'Ikeja',
  examStatus:  'Preparing for JAMB 2027',
  subjects:    ['Use of English', 'Physics', 'Chemistry', 'Biology'],
  parentName:  'Mrs Okonkwo',
  parentEmail: 'parent@example.com',
  parentPhone: '08098765432',
  pledge:      true
};

function app2(overrides) {
  return Object.assign({}, VALID_APPLICATION, { name: 'Bola Ade', email: 'bola@example.com', phone: '08011111111', parentEmail: 'b-parent@example.com' }, overrides || {});
}

var founderToken, acadToken, appId, app2Id;

start().then(function () {

  /* ---- GET /api/scholarship/status — public ---- */
  head('GET /api/scholarship/status (public)');
  return call('GET', '/api/scholarship/status');

}).then(function (r) {
  ok('status 200 with no auth', r.status === 200, r.raw);
  ok('mode is "open" on a fresh install', r.body && r.body.mode === 'open', r.raw);
  ok('places field present and is 30', r.body && r.body.places === 30, r.raw);

  /* ---- POST /api/scholarship/apply ---- */
  head('POST /api/scholarship/apply');
  return call('POST', '/api/scholarship/apply', VALID_APPLICATION);

}).then(function (r) {
  ok('valid application accepted (200)', r.status === 200, r.raw);
  ok('response has application field',   r.body && r.body.application, r.raw);
  ok('application.id starts with SCH-',  r.body && r.body.application && /^SCH-\d+$/.test(r.body.application.id), r.raw);
  ok('status is pending',                r.body && r.body.application && r.body.application.status === 'pending', r.raw);
  ok('application saved in data.json',   readDb().scholarshipApplications.length === 1);
  appId = r.body && r.body.application && r.body.application.id;

  /* duplicate email blocked */
  return call('POST', '/api/scholarship/apply', VALID_APPLICATION);
}).then(function (r) {
  ok('duplicate email (pending) blocked with 409', r.status === 409, r.raw);
  ok('error mentions review',            r.body && /review/i.test(r.body.error || ''), r.raw);

  /* validation error */
  return call('POST', '/api/scholarship/apply', Object.assign({}, VALID_APPLICATION, { name: '' }));
}).then(function (r) {
  ok('missing name returns 400', r.status === 400, r.raw);

  /* only 3 subjects → rejected */
  return call('POST', '/api/scholarship/apply', Object.assign({}, VALID_APPLICATION, { email: 'new@example.com', subjects: ['Use of English', 'Physics', 'Chemistry'] }));
}).then(function (r) {
  ok('only 3 subjects returns 400', r.status === 400, r.raw);

  /* no parent contact */
  return call('POST', '/api/scholarship/apply', Object.assign({}, VALID_APPLICATION, { email: 'new2@example.com', parentEmail: '', parentPhone: '' }));
}).then(function (r) {
  ok('no parent contact returns 400', r.status === 400, r.raw);

  /* second valid application */
  return call('POST', '/api/scholarship/apply', app2());
}).then(function (r) {
  ok('second valid application accepted', r.status === 200, r.raw);
  app2Id = r.body && r.body.application && r.body.application.id;
  ok('ids are distinct', appId !== app2Id);

  /* ---- console login ---- */
  head('console login (Founder + Academic Director)');
  return call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
}).then(function (r) {
  founderToken = r.body && r.body.token;
  ok('Founder login OK', r.status === 200, r.raw);
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, founderToken);
}).then(function (r) {
  ok('Founder unlock OK', r.status === 200, r.raw);
  return call('POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' });
}).then(function (r) {
  acadToken = r.body && r.body.token;
  ok('Academic Director login OK', r.status === 200, r.raw);
  return call('POST', '/api/auth/unlock', { passcode: '2027' }, acadToken);
}).then(function () {

  /* ---- GET /api/scholarship/applications ---- */
  head('GET /api/scholarship/applications (scholarship.view)');
  return call('GET', '/api/scholarship/applications', undefined, founderToken);
}).then(function (r) {
  ok('Founder can list applications', r.status === 200, r.raw);
  ok('returns an array',             Array.isArray(r.body), r.raw);
  ok('contains both applications',   r.body && r.body.length === 2, r.raw);
  ok('no pledge field in public projection', r.body && r.body[0] && r.body[0].pledge === undefined, r.raw);
  return call('GET', '/api/scholarship/applications', undefined, acadToken);
}).then(function (r) {
  ok('Academic Director can list applications (scholarship.view)', r.status === 200, r.raw);
  return call('GET', '/api/scholarship/applications');
}).then(function (r) {
  ok('unauthenticated list returns 401', r.status === 401, r.raw);

  /* ---- POST /api/scholarship/applications/:id/decide ---- */
  head('POST /api/scholarship/applications/:id/decide (scholarship.decide = SA = Founder)');
  return call('POST', '/api/scholarship/applications/' + appId + '/decide',
    { decision: 'accept', message: 'You have been selected!' }, founderToken);
}).then(function (r) {
  ok('Founder can accept an application', r.status === 200, r.raw);
  ok('status is now accepted',            r.body && r.body.application && r.body.application.status === 'accepted', r.raw);
  ok('decidedAt is set',                  r.body && r.body.application && !!r.body.application.decidedAt, r.raw);
  ok('decisionMsg is stored',             r.body && r.body.application && r.body.application.decisionMsg === 'You have been selected!', r.raw);

  /* rejecting the second */
  return call('POST', '/api/scholarship/applications/' + app2Id + '/decide',
    { decision: 'reject', message: 'Not this time.' }, founderToken);
}).then(function (r) {
  ok('Founder can reject an application', r.status === 200, r.raw);
  ok('status is now rejected',            r.body && r.body.application && r.body.application.status === 'rejected', r.raw);

  /* deciding an already-decided application */
  return call('POST', '/api/scholarship/applications/' + appId + '/decide',
    { decision: 'reject' }, founderToken);
}).then(function (r) {
  ok('cannot decide an already-accepted application (409)', r.status === 409, r.raw);

  /* bad decision value */
  return call('POST', '/api/scholarship/applications/' + app2Id + '/decide',
    { decision: 'maybe' }, founderToken);
}).then(function (r) {
  ok('bad decision value returns 400', r.status === 400, r.raw);

  /* ---- POST /api/scholarship/applications/:id/approve ---- */
  head('POST /api/scholarship/applications/:id/approve (Founder only)');
  return call('POST', '/api/scholarship/applications/' + appId + '/approve', {}, founderToken);
}).then(function (r) {
  ok('Founder can approve an accepted application', r.status === 200, r.raw);
  ok('status is now approved',                      r.body && r.body.application && r.body.application.status === 'approved', r.raw);
  ok('approvedAt is set',                           r.body && r.body.application && !!r.body.application.approvedAt, r.raw);
  ok('tempPassword in response',                    r.body && r.body.application && !!r.body.application.tempPassword, r.raw);
  ok('a new student was created in data.json',      readDb().students.some(function (s) { return s.scholarshipId === appId; }));
  ok('the new student is GOC tier',                 (function () { var db = readDb(); var s = db.students.find(function(x){return x.scholarshipId===appId;}); return s && s.tier === 'GOC'; })());

  /* Academic Director cannot approve */
  return call('POST', '/api/scholarship/applications/' + app2Id + '/decide',
    { decision: 'accept' }, founderToken);
}).then(function () {
  return call('POST', '/api/scholarship/applications/' + app2Id + '/approve', {}, acadToken);
}).then(function (r) {
  ok('Academic Director cannot approve (403)', r.status === 403, r.raw);

  /* approving a pending application → rejected */
  var r3 = Object.assign({}, VALID_APPLICATION, { email: 'extra@example.com', phone: '08033333333', parentPhone: '08044444444', parentEmail: '' });
  return call('POST', '/api/scholarship/apply', r3);
}).then(function (r) {
  var pendingId = r.body && r.body.application && r.body.application.id;
  return call('POST', '/api/scholarship/applications/' + pendingId + '/approve', {}, founderToken);
}).then(function (r) {
  ok('approving a pending application (not accepted) returns 409', r.status === 409, r.raw);

  /* ---- POST /api/scholarship/waitlist ---- */
  head('POST /api/scholarship/waitlist (only when mode = waitlist)');
  /* force-close scholarship and open waitlist via settings */
  var db = readDb();
  db.settings.scholarshipOpen = false;
  db.settings.waitlistOpen    = true;
  fs.writeFileSync(DATA, JSON.stringify(db));
  return call('GET', '/api/scholarship/status');
}).then(function (r) {
  ok('status is now waitlist', r.body && r.body.mode === 'waitlist', r.raw);
  return call('POST', '/api/scholarship/waitlist', { name: 'Chika', email: 'chika@example.com', phone: '08055555555' });
}).then(function (r) {
  ok('waitlist submission accepted (200)', r.status === 200, r.raw);
  ok('returns an entry with WL- id',       r.body && r.body.entry && /^WL-\d+$/.test(r.body.entry.id), r.raw);
  ok('entry stored in data.json',          readDb().scholarshipWaitlist.length === 1);

  /* duplicate waitlist email */
  return call('POST', '/api/scholarship/waitlist', { name: 'Chika2', email: 'chika@example.com', phone: '08066666666' });
}).then(function (r) {
  ok('duplicate waitlist email returns 409', r.status === 409, r.raw);

  /* waitlist when mode is open */
  var db = readDb();
  db.settings.scholarshipOpen = true;
  db.settings.waitlistOpen    = false;
  fs.writeFileSync(DATA, JSON.stringify(db));
  return call('POST', '/api/scholarship/waitlist', { name: 'Ola', email: 'ola@example.com', phone: '08077777777' });
}).then(function (r) {
  ok('waitlist POST when mode=open returns 409', r.status === 409, r.raw);

  /* ---- GET /api/scholarship/applications/export ---- */
  head('GET /api/scholarship/applications/export (scholarship.export = SA = Founder)');
  return call('GET', '/api/scholarship/applications/export', undefined, founderToken);
}).then(function (r) {
  ok('Founder gets a CSV response (200)', r.status === 200, r.raw.slice(0, 60));
  ok('Content-Type is text/csv',          r.headers && /text\/csv/i.test(r.headers['content-type'] || ''), r.headers['content-type']);
  ok('contains CSV header row',           /Status.*Name/i.test(r.raw));
  ok('contains an application id',        r.raw.indexOf('SCH-') !== -1);
  return call('GET', '/api/scholarship/applications/export', undefined, acadToken);
}).then(function (r) {
  /* Academic Director has scholarship.view but not scholarship.export */
  ok('Academic Director cannot export (403)', r.status === 403, r.raw);

  /* ---- DELETE /api/scholarship/applications/:id ---- */
  head('DELETE /api/scholarship/applications/:id (scholarship.delete = SA)');
  return call('DELETE', '/api/scholarship/applications/' + app2Id, undefined, founderToken);
}).then(function (r) {
  ok('Founder can delete an application (200)', r.status === 200, r.raw);
  ok('deleted from data.json', !readDb().scholarshipApplications.some(function (a) { return a.id === app2Id; }));
  ok('deletion logged to managerLog', readDb().managerLog.some(function (e) { return e.action === 'scholarship.delete' && e.target === app2Id; }));

  return call('DELETE', '/api/scholarship/applications/' + app2Id, undefined, founderToken);
}).then(function (r) {
  ok('deleting a non-existent application returns 404', r.status === 404, r.raw);

  /* ---- unauthenticated apply when closed ---- */
  head('POST /api/scholarship/apply when scholarship is closed');
  var db = readDb();
  db.settings.scholarshipOpen = false;
  db.settings.waitlistOpen    = false;
  fs.writeFileSync(DATA, JSON.stringify(db));
  return call('POST', '/api/scholarship/apply', Object.assign({}, VALID_APPLICATION, { email: 'late@example.com', phone: '08099999999', parentPhone: '08088888888', parentEmail: '' }));
}).then(function (r) {
  ok('apply when closed returns 409', r.status === 409, r.raw);

  /* ---- rejected applicant may reapply ---- */
  head('rejected applicant may reapply');
  var db = readDb();
  db.settings.scholarshipOpen = true;
  db.settings.waitlistOpen    = false;
  fs.writeFileSync(DATA, JSON.stringify(db));
  return call('POST', '/api/scholarship/apply', app2());   /* bola@example.com was rejected */
}).then(function (r) {
  ok('rejected applicant can reapply (200)', r.status === 200, r.raw);

  return halt();
}).then(function () {
  cleanup();
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.error(e);
  cleanup();
  process.exit(1);
});
