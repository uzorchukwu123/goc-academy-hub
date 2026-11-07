/* test-backup-integrity.js — the four final production-safety corrections.
   ---------------------------------------------------------------------------
   1  Structural validation of a downloaded Appwrite backup. Syntactically valid
      JSON is not a database: `{}` must never replace a real academy's records.
      Exercised directly against the real hydrateBlobFromStorage() in a VM with
      a write-recording fs, so "byte-for-byte unchanged" means exactly that —
      the normal migrate()/writeData() rewrite that every BOOT performs is not
      mixed into the measurement.

   2  404 classification. Appwrite answers 404 for storage_file_not_found,
      storage_bucket_not_found, project_not_found and general_route_not_found.
      Only the first is a first install; the rest (and any untyped 404) are
      unverified backups.

   3  Persistence protection. After a failed/unclassifiable hydration, no
      ordinary write, startup routine or request may delete or replace the
      cloud backup. Proved end-to-end over real HTTP against a stateful Storage
      double that keeps the existing cloud bytes and counts every operation.

   4  Read-only Database connectivity, reported independently of SDK client
      construction and of Storage.

   Everything runs in isolated temporary directories against a local HTTP
   double. No live Appwrite project, no credential, no production data.
   node test/test-backup-integrity.js */
'use strict';
var fs = require('fs');
var os = require('os');
var net = require('net');
var http = require('http');
var path = require('path');
var vm = require('vm');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var SERVER_SRC = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 300) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var sandboxes = [], children = [], stubs = [];
var FAKE_KEY = 'test-placeholder-not-a-real-appwrite-key';

/* ────────────────────────── extract the real code under test ───────────── */
function extractFn(name) {
  var re = new RegExp('\\n(?:async )?function ' + name + '\\s*\\(');
  var m = re.exec(SERVER_SRC);
  if (!m) throw new Error('function not found: ' + name);
  var i = SERVER_SRC.indexOf('{', m.index + m[0].length - 1), d = 0;
  for (var j = i; j < SERVER_SRC.length; j++) {
    if (SERVER_SRC[j] === '{') d++;
    else if (SERVER_SRC[j] === '}') { d--; if (d === 0) return SERVER_SRC.slice(m.index, j + 1); }
  }
  throw new Error('unbalanced: ' + name);
}
function extractArray(name) {
  var re = new RegExp('\\nconst ' + name + ' = \\[');
  var m = re.exec(SERVER_SRC);
  if (!m) throw new Error('array not found: ' + name);
  var i = SERVER_SRC.indexOf('[', m.index), d = 0;
  for (var j = i; j < SERVER_SRC.length; j++) {
    if (SERVER_SRC[j] === '[') d++;
    else if (SERVER_SRC[j] === ']') { d--; if (d === 0) return SERVER_SRC.slice(m.index, j + 2); }
  }
  throw new Error('unbalanced: ' + name);
}

var HYDRATION_CODE = [
  extractArray('ACADEMY_ARRAY_FIELDS'),
  extractArray('ACADEMY_OBJECT_FIELDS'),
  extractArray('ACADEMY_CORE_COLLECTIONS'),
  extractFn('isPlainObject'),
  extractFn('academyBackupProblem'),
  extractFn('hydrateBlobFromStorage')
].join('\n');

/* Run the REAL hydration function with a recording fs and a Storage double. */
function runHydration(opts) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-backup-unit-'));
  sandboxes.push(dir);
  var dataFile = path.join(dir, 'data.json');
  if (opts.local !== undefined) fs.writeFileSync(dataFile, opts.local);
  var before = fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf8') : null;
  var writes = [], renames = [], logs = [];
  var protectedReason = null;

  var fsProxy = {
    existsSync: function (p) { return fs.existsSync(p); },
    readFileSync: function (p, e) { return fs.readFileSync(p, e); },
    writeFileSync: function (p, d) { writes.push(String(p)); return fs.writeFileSync(p, d); },
    renameSync: function (a, b) { renames.push(String(b)); return fs.renameSync(a, b); }
  };
  var sandbox = {
    fs: fsProxy,
    DATA_FILE: dataFile,
    APPWRITE_BUCKET_ID: 'goc-data',
    APPWRITE_FILE_ID: 'academy-data-json',
    blobHydrationFailure: null,
    blobPersistenceProtected: false,
    appwriteStorageStatus: 'not-checked',
    blobStorageEnabled: function () { return true; },
    protectBlobPersistence: function (r) { protectedReason = r; sandbox.blobPersistenceProtected = true; },
    appwriteResourcesStorage: {
      getFileDownload: function () {
        if (opts.error) return Promise.reject(opts.error);
        return Promise.resolve(Buffer.from(opts.blob, 'utf8'));
      }
    },
    console: {
      log: function () { logs.push([].join.call(arguments, ' ')); },
      error: function () { logs.push([].join.call(arguments, ' ')); },
      warn: function () { logs.push([].join.call(arguments, ' ')); }
    },
    Buffer: Buffer, JSON: JSON, Date: Date, Number: Number, Object: Object,
    Array: Array, String: String, Promise: Promise, Error: Error
  };
  vm.createContext(sandbox);
  vm.runInContext(HYDRATION_CODE, sandbox);
  return sandbox.hydrateBlobFromStorage().then(function (result) {
    var after = fs.existsSync(dataFile) ? fs.readFileSync(dataFile, 'utf8') : null;
    return {
      result: result, before: before, after: after,
      byteIdentical: before === after,
      writes: writes, renames: renames, logs: logs.join('\n'),
      failure: sandbox.blobHydrationFailure,
      protected: sandbox.blobPersistenceProtected === true,
      protectedReason: protectedReason,
      storageStatus: sandbox.appwriteStorageStatus
    };
  });
}

/* Realistic academy databases, current and legacy. */
function currentDb(extra) {
  return JSON.stringify(Object.assign({
    _savedAt: '2030-01-01T00:00:00.000Z',
    staff: [{ id: 'GOC-A-001', name: 'Founder', title: 'Founder' }],
    students: [], updates: [], questions: [], notes: [], passages: [], attempts: [],
    tutors: [], alerts: [], notices: [], broadcasts: [], flags: [], challenges: [],
    challengeState: {}, broadcastMail: {}, tutorAudit: [], managerLog: [],
    scholarshipApplications: [], scholarshipWaitlist: [], answerStats: {},
    practiceRuns: {}, consentLog: {}, bookmarks: {}, reviewState: {}, reminderState: {},
    topics: [], contactMessages: [], affirmations: ['Keep going.'],
    settings: { questionSeq: 0, noteSeq: 0, attemptSeq: 0, consolePasscodeHash: 'x' },
    free2027: { enabled: false, questionBanks: {} }
  }, extra || {}));
}
/* A pre-Free-2027, pre-tutors file with no _savedAt and legacy period values:
   exactly the shape migrate() exists to upgrade. */
function legacyDb() {
  return JSON.stringify({
    staff: [{ id: 'GOC-A-001', name: 'Founder', title: 'Founder' }],
    students: [{ id: 'GOC-S-001', name: 'Old Student', period: 'weekly' }],
    questions: [{ id: 1, subject: 'Use of English', period: 'monthly' }],
    notes: [], attempts: [{ id: 1, period: 'weekly' }],
    settings: { dailyLimitMin: 90, questionSeq: 1 }
  });
}
var LOCAL_SENTINEL = JSON.stringify({
  _savedAt: '2026-01-01T00:00:00.000Z',
  staff: [{ id: 'GOC-A-001', name: 'Founder', title: 'Founder' }],
  students: [{ id: 'GOC-S-777', name: 'Real Student' }],
  questions: [{ id: 9, text: 'a real question' }], notes: [], attempts: [],
  settings: { sentinel: 'original-academy-records', questionSeq: 9 }
});

/* ────────────────────────── PART 1: structural validation ──────────────── */
function partOne() {
  head('1 — structural validation rejects payloads that are not a G.O.C database');
  var bad = [
    { name: 'empty object {}', blob: '{}' },
    { name: 'empty object with only metadata', blob: '{"_savedAt":"2030-01-01T00:00:00.000Z"}' },
    { name: 'unrelated JSON object', blob: '{"hello":"world","n":1}' },
    { name: 'settings present but no academy records', blob: '{"settings":{"questionSeq":4}}' },
    { name: 'structurally incomplete (settings only, empty)', blob: '{"settings":{}}' },
    { name: 'students is a string', blob: '{"settings":{},"students":"oops"}' },
    { name: 'questions is an object, not an array', blob: '{"settings":{},"questions":{}}' },
    { name: 'settings is an array', blob: '{"settings":[],"students":[]}' },
    { name: 'settings is a string', blob: '{"settings":"nope","students":[]}' },
    { name: 'attempts is null', blob: '{"settings":{},"students":[],"attempts":null}' },
    { name: 'free2027 is an array', blob: '{"settings":{},"students":[],"free2027":[]}' },
    { name: '_savedAt is a number', blob: '{"settings":{},"students":[],"_savedAt":123}' },
    { name: 'top-level array', blob: '[]' },
    { name: 'top-level string', blob: '"a string"' },
    { name: 'truncated JSON', blob: '{"settings":{},"students":[' },
    { name: 'not JSON at all', blob: '<<<corrupt>>>' }
  ];
  return bad.reduce(function (p, c) {
    return p.then(function () {
      return runHydration({ local: LOCAL_SENTINEL, blob: c.blob }).then(function (r) {
        ok('rejects ' + c.name, r.result === false && r.failure === 'invalid-backup', 'failure=' + r.failure);
        ok('  keeps the local database BYTE-FOR-BYTE for ' + c.name, r.byteIdentical, 'writes=' + r.writes.length);
        ok('  performs no write at all for ' + c.name, r.writes.length === 0 && r.renames.length === 0);
        ok('  protects cloud persistence for ' + c.name, r.protected === true);
      });
    });
  }, Promise.resolve()).then(function () {
    head('1 — legitimate databases are still accepted');
    return runHydration({ local: LOCAL_SENTINEL, blob: currentDb() }).then(function (r) {
      ok('a valid CURRENT database is restored', r.result === true, r.logs);
      ok('  it really replaced the older local copy', r.after !== LOCAL_SENTINEL && JSON.parse(r.after).settings.questionSeq === 0);
      ok('  cloud persistence stays enabled', r.protected === false);
    });
  }).then(function () {
    return runHydration({ local: LOCAL_SENTINEL, blob: legacyDb() }).then(function (r) {
      ok('a valid LEGACY database (no _savedAt, no tutors/free2027, old periods) is restored', r.result === true, r.logs);
      ok('  legacy records survive the restore', JSON.parse(r.after).students[0].id === 'GOC-S-001');
      ok('  legacy restore does not protect persistence', r.protected === false);
    });
  }).then(function () {
    return runHydration({ blob: currentDb() }).then(function (r) {
      ok('a valid database restores onto a volume with no local file', r.result === true && r.before === null);
    });
  }).then(function () {
    head('1 — validation failure never reseeds or overwrites');
    return runHydration({ local: LOCAL_SENTINEL, blob: '{}' }).then(function (r) {
      ok('the real student record is still present after an invalid blob',
        JSON.parse(r.after).students[0].id === 'GOC-S-777');
      ok('the real question bank is still present', JSON.parse(r.after).questions[0].id === 9);
      ok('the sentinel setting is untouched', JSON.parse(r.after).settings.sentinel === 'original-academy-records');
      ok('the invalid blob is reported, not silently accepted', /not a usable G\.O\.C database \(empty-object\)/.test(r.logs), r.logs);
    });
  });
}

/* ────────────────────────── HTTP doubles ───────────────────────────────── */
function freePort() {
  return new Promise(function (resolve) {
    var s = net.createServer();
    s.listen(0, '127.0.0.1', function () { var p = s.address().port; s.close(function () { resolve(p); }); });
  });
}
/* A stateful Appwrite double: it HOLDS a cloud backup and counts every call, so
   "the cloud backup was not replaced" is measured, not assumed. */
function startDouble(cfg) {
  var state = {
    cloud: cfg.blob === undefined ? null : Buffer.from(cfg.blob, 'utf8'),
    download: 0, del: 0, create: 0, dbGet: 0, dbDocs: 0, dbWrite: 0
  };
  var initial = state.cloud ? state.cloud.toString('utf8') : null;
  var srv = http.createServer(function (req, res) {
    var u = req.url || '';
    function fail(status, type) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: type, code: status, type: type }));
    }
    if (/\/storage\/buckets\/[^/]+\/files\/[^/]+\/download/.test(u)) {
      state.download++;
      if (cfg.storage && cfg.storage.status !== 200) return fail(cfg.storage.status, cfg.storage.type);
      if (state.cloud === null) return fail(404, 'storage_file_not_found');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      return res.end(state.cloud);
    }
    if (req.method === 'DELETE' && /\/storage\/buckets\//.test(u)) {
      state.del++; state.cloud = null; res.writeHead(204); return res.end();
    }
    if (req.method === 'POST' && /\/storage\/buckets\/[^/]+\/files/.test(u)) {
      state.create++;
      var chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () {
        state.cloud = Buffer.concat(chunks);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ $id: 'academy-data-json' }));
      });
      return;
    }
    if (/\/databases\//.test(u) && req.method !== 'GET') {
      /* Any create/update/delete against the Database is recorded. The probe
         must never produce one. */
      state.dbWrite++; req.resume();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ $id: 'unexpected-write' }));
    }
    if (/\/databases\/[^/]+\/collections\/[^/]+\/documents/.test(u)) {
      state.dbDocs++;
      if (cfg.dbDocs && cfg.dbDocs.status !== 200) return fail(cfg.dbDocs.status, cfg.dbDocs.type);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ total: 0, documents: [] }));
    }
    if (/^\/v1\/databases\/[^/?]+(\?|$)/.test(u)) {
      state.dbGet++;
      if (cfg.db && cfg.db.status !== 200) return fail(cfg.db.status, cfg.db.type);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ $id: 'goc_academy', name: 'G.O.C Academy' }));
    }
    req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: 0, documents: [], users: [], files: [], buckets: [] }));
  });
  stubs.push(srv);
  return new Promise(function (resolve) {
    srv.listen(0, '127.0.0.1', function () {
      resolve({
        url: 'http://127.0.0.1:' + srv.address().port + '/v1',
        state: state,
        cloudUnchanged: function () {
          return (state.cloud === null ? null : state.cloud.toString('utf8')) === initial;
        }
      });
    });
  });
}

function mkSandbox() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-backup-e2e-'));
  sandboxes.push(dir);
  fs.cpSync(path.join(APP, 'server'), path.join(dir, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(dir, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
    if (fs.existsSync(path.join(APP, f))) fs.cpSync(path.join(APP, f), path.join(dir, f));
  });
  try { fs.rmSync(path.join(dir, 'server', 'data.json'), { force: true }); } catch (e) {}
  return dir;
}
function call(port, method, urlPath, body) {
  return new Promise(function (resolve) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    var req = http.request({ host: '127.0.0.1', port: port, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    req.setTimeout(5000, function () { req.destroy(); resolve({ status: 0, raw: 'timeout', body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}
function boot(opts) {
  var sandbox = mkSandbox();
  var dataDir = path.join(sandbox, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  if (opts.local !== undefined) fs.writeFileSync(path.join(dataDir, 'data.json'), opts.local);
  return freePort().then(function (port) {
    var env = {};
    Object.keys(process.env).forEach(function (k) { if (!/^(APPWRITE_|GOC_|NODE_ENV$)/.test(k)) env[k] = process.env[k]; });
    Object.assign(env, {
      PORT: String(port), NODE_PATH: path.join(APP, 'node_modules'), GOC_DATA_DIR: dataDir,
      GOC_FOUNDER_PW: 'test-founder-password', GOC_ACADDIR_PW: 'test-acaddir-password', GOC_PASSCODE: '481923',
      APPWRITE_ENDPOINT: opts.url, APPWRITE_PROJECT_ID: 'test-project', APPWRITE_API_KEY: FAKE_KEY,
      APPWRITE_DATABASE_ID: 'goc_academy', APPWRITE_BUCKET_ID: 'goc-data', APPWRITE_FILE_ID: 'academy-data-json'
    }, opts.env || {});
    var child = spawn(process.execPath, [path.join(sandbox, 'server', 'server.js')], { cwd: sandbox, env: env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(child);
    var log = '';
    child.stdout.on('data', function (c) { log += c; });
    child.stderr.on('data', function (c) { log += c; });
    var r = { port: port, dataDir: dataDir, sandbox: sandbox, child: child, exited: false, code: null, booted: false };
    Object.defineProperty(r, 'log', { get: function () { return log; } });
    var done = new Promise(function (res) { child.on('exit', function (c) { r.exited = true; r.code = c; res(); }); });
    var tries = 0;
    function poll() {
      if (r.exited) return r;
      return call(port, 'GET', '/api/health').then(function (h) {
        if (h.status === 200) { r.booted = true; return r; }
        if (tries++ > 90) return r;
        return new Promise(function (x) { setTimeout(x, 150); }).then(poll);
      });
    }
    return Promise.race([done.then(function () { return r; }), poll()]).then(function () {
      if (!r.booted && !r.exited) return new Promise(function (x) { setTimeout(x, 400); }).then(function () { return r; });
      return r;
    });
  });
}
function stop(r) { try { r.child.kill('SIGKILL'); } catch (e) {} }
function settle(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

/* ────────────────────────── PART 2: 404 classification ─────────────────── */
function partTwo() {
  head('2 — only a positively identified missing FILE is a first install');
  var cases = [
    { type: 'storage_file_not_found', missing: true, label: 'genuine missing-file' },
    { type: 'storage_bucket_not_found', missing: false, label: 'wrong bucket ID' },
    { type: 'project_not_found', missing: false, label: 'wrong project ID' },
    { type: 'general_route_not_found', missing: false, label: 'wrong endpoint/route' },
    { type: 'general_unknown', missing: false, label: 'ambiguous typed 404' },
    { type: '', missing: false, label: 'untyped 404' }
  ];
  return cases.reduce(function (p, c) {
    return p.then(function () {
      return runHydration({ local: LOCAL_SENTINEL, error: { code: 404, type: c.type, message: 'not found' } }).then(function (r) {
        if (c.missing) {
          ok(c.label + ' IS treated as a first install', /No blob in Appwrite Storage yet \(storage_file_not_found\)/.test(r.logs), r.logs);
          ok('  ' + c.label + ' does not protect persistence', r.protected === false);
          ok('  ' + c.label + ' leaves the local file alone', r.byteIdentical);
        } else {
          ok(c.label + ' is NOT treated as a first install', !/No blob in Appwrite Storage yet/.test(r.logs), r.logs);
          ok('  ' + c.label + ' is reported as unverified', /could NOT be verified/.test(r.logs));
          ok('  ' + c.label + ' protects cloud persistence', r.protected === true);
          ok('  ' + c.label + ' leaves the local file BYTE-FOR-BYTE intact', r.byteIdentical);
        }
      });
    });
  }, Promise.resolve()).then(function () {
    head('2 — HTTP status alone is never trusted (real server, real HTTP)');
    return startDouble({ storage: { status: 404, type: 'storage_bucket_not_found' }, blob: currentDb() }).then(function (d) {
      return boot({ url: d.url, local: LOCAL_SENTINEL }).then(function (r) {
        ok('a bucket-not-found 404 does not seed over an existing academy', r.booted === true);
        ok('  it is classified as bucket-not-found', /bucket-not-found/.test(r.log), r.log.slice(-500));
        ok('  it is not announced as a first install', !/No blob in Appwrite Storage yet/.test(r.log));
        stop(r);
      });
    });
  });
}

/* ────────────────────────── PART 3: persistence protection ─────────────── */
function partThree() {
  head('3 — end-to-end: a failed hydration must not overwrite the cloud backup');
  var CLOUD = currentDb({ settings: { questionSeq: 4242, marker: 'existing-cloud-backup' } });
  var scenarios = [
    { label: 'permission error', cfg: { storage: { status: 403, type: 'general_api_disabled' }, blob: CLOUD } },
    { label: 'auth error', cfg: { storage: { status: 401, type: 'general_unauthorized_scope' }, blob: CLOUD } },
    { label: 'service failure', cfg: { storage: { status: 503, type: 'general_server_error' }, blob: CLOUD } },
    { label: 'ambiguous 404', cfg: { storage: { status: 404, type: 'project_not_found' }, blob: CLOUD } },
    { label: 'structurally invalid backup', cfg: { blob: '{}' } }
  ];
  return scenarios.reduce(function (p, sc) {
    return p.then(function () {
      return startDouble(sc.cfg).then(function (d) {
        /* 1. valid local database in an isolated temporary directory */
        return boot({ url: d.url, local: LOCAL_SENTINEL }).then(function (r) {
          ok(sc.label + ': the server starts through its intended path', r.booted === true, r.log.slice(-400));
          ok(sc.label + ': protection is announced', /CLOUD BACKUP PERSISTENCE PROTECTED/.test(r.log));
          var afterBoot = { del: d.state.del, create: d.state.create };
          /* 4. an ordinary application write */
          return call(r.port, 'POST', '/api/contact', { name: 'Ada Obi', email: 'ada@example.com', message: 'A normal enquiry.' })
            .then(function (res) {
              ok(sc.label + ': the ordinary write succeeds', res.status === 200, res.raw);
              return settle(900);
            })
            .then(function () {
              /* 5/6. neither Storage operation may have been called */
              ok(sc.label + ': deleteFile() was NEVER called', d.state.del === 0, 'boot=' + afterBoot.del + ' total=' + d.state.del);
              ok(sc.label + ': createFile() was NEVER called', d.state.create === 0, 'boot=' + afterBoot.create + ' total=' + d.state.create);
              /* 7. the existing cloud backup is unchanged */
              ok(sc.label + ': the existing cloud backup is unchanged', d.cloudUnchanged(), 'cloud bytes differ');
              /* 8. local data is intact AND the write landed */
              var db = JSON.parse(fs.readFileSync(path.join(r.dataDir, 'data.json'), 'utf8'));
              ok(sc.label + ': local academy records are intact',
                db.students.some(function (s) { return s.id === 'GOC-S-777'; }) && db.settings.sentinel === 'original-academy-records');
              ok(sc.label + ': the ordinary write was still saved locally',
                (db.contactMessages || []).some(function (m) { return m.email === 'ada@example.com'; }));
              /* a second write and a timer tick must not bypass it either */
              return call(r.port, 'POST', '/api/contact', { name: 'Second Write', email: 'second@example.com', message: 'Another enquiry.' });
            })
            .then(function () { return settle(900); })
            .then(function () {
              ok(sc.label + ': a later request still cannot bypass protection', d.state.del === 0 && d.state.create === 0);
              ok(sc.label + ': no credential value is logged', r.log.indexOf(FAKE_KEY) === -1);
              stop(r);
            });
        });
      });
    });
  }, Promise.resolve()).then(function () {
    head('3 — successful hydration keeps cloud persistence working');
    return startDouble({ blob: currentDb() }).then(function (d) {
      return boot({ url: d.url, local: LOCAL_SENTINEL }).then(function (r) {
        ok('a verified backup does NOT engage protection', !/CLOUD BACKUP PERSISTENCE PROTECTED/.test(r.log), r.log.slice(-400));
        ok('  the backup was hydrated', /Hydrated data.json blob from Appwrite Storage/.test(r.log));
        return settle(1200).then(function () {
          ok('  normal startup persistence still uploads', d.state.create > 0, 'create=' + d.state.create);
          ok('  cloud writes are reported enabled', /cloud backup writes: enabled/.test(r.log), r.log.slice(-400));
          stop(r);
        });
      });
    });
  }).then(function () {
    head('3 — a positively identified first install keeps persistence working');
    return startDouble({ blob: undefined }).then(function (d) {
      return boot({ url: d.url }).then(function (r) {
        ok('a genuine missing file allows the first-install seed', r.booted === true && fs.existsSync(path.join(r.dataDir, 'data.json')));
        ok('  it is announced as storage_file_not_found', /No blob in Appwrite Storage yet \(storage_file_not_found\)/.test(r.log));
        ok('  protection is not engaged', !/CLOUD BACKUP PERSISTENCE PROTECTED/.test(r.log));
        return settle(1200).then(function () {
          ok('  the first backup is created in the cloud', d.state.create > 0, 'create=' + d.state.create);
          stop(r);
        });
      });
    });
  });
}

/* ────────────────────────── PART 4: connectivity reporting ─────────────── */
function partFour() {
  head('4 — Database connectivity is verified and reported independently');
  var cases = [
    {
      label: 'client constructs but Database fails',
      cfg: { blob: currentDb(), db: { status: 500, type: 'general_server_error' }, dbDocs: { status: 500, type: 'general_server_error' } },
      expect: function (r) {
        ok('  SDK construction is reported separately', /Appwrite SDK clients constructed/.test(r.log));
        ok('  Database failure is reported accurately', /Database connectivity FAILED/.test(r.log), r.log.slice(-500));
        ok('  it never claims the Database initialised', !/Appwrite Database initialized/.test(r.log));
        ok('  Storage is still reported as readable', /Storage: readable/.test(r.log), r.log.slice(-500));
      }
    },
    {
      label: 'read-only Database connectivity succeeds',
      cfg: { blob: currentDb() },
      expect: function (r) {
        ok('  connectivity is verified read-only', /Appwrite Database connectivity verified read-only/.test(r.log), r.log.slice(-500));
        ok('  the summary reports Database connected', /Database: connected/.test(r.log), r.log.slice(-500));
      }
    },
    {
      label: 'Storage works while Database fails',
      cfg: { blob: currentDb(), db: { status: 404, type: 'database_not_found' }, dbDocs: { status: 404, type: 'database_not_found' } },
      expect: function (r) {
        ok('  Storage is reported readable', /Storage: readable/.test(r.log), r.log.slice(-500));
        ok('  Database is reported not-found', /Database: not-found/.test(r.log), r.log.slice(-500));
        ok('  the two findings are not conflated', /Storage: readable \| Database: not-found/.test(r.log));
      }
    },
    {
      label: 'Database works while Storage fails',
      cfg: { blob: currentDb(), storage: { status: 403, type: 'general_api_disabled' } },
      expect: function (r) {
        ok('  Database is reported connected', /Database: connected/.test(r.log), r.log.slice(-500));
        ok('  Storage is reported unreadable', /Storage: unreadable \(permission\)/.test(r.log), r.log.slice(-500));
        ok('  cloud writes are reported protected', /cloud backup writes: PROTECTED/.test(r.log));
      }
    },
    {
      label: 'credentials permit no read at all',
      cfg: { blob: currentDb(), db: { status: 401, type: 'general_unauthorized_scope' }, dbDocs: { status: 401, type: 'general_unauthorized_scope' } },
      expect: function (r) {
        ok('  the limitation is stated explicitly', /connectivity could NOT be verified/.test(r.log), r.log.slice(-500));
        ok('  it does not claim connectivity was established', !/connectivity verified read-only/.test(r.log));
        ok('  the summary says UNVERIFIABLE', /Database: UNVERIFIABLE/.test(r.log), r.log.slice(-500));
      }
    }
  ];
  return cases.reduce(function (p, c) {
    return p.then(function () {
      head('4 — ' + c.label);
      return startDouble(c.cfg).then(function (d) {
        return boot({ url: d.url, local: LOCAL_SENTINEL }).then(function (r) {
          ok(c.label + ': the server reports all four states', /Appwrite status — SDK clients: /.test(r.log), r.log.slice(-400));
          c.expect(r);
          ok(c.label + ': the probe issued NO Database write request', d.state.dbWrite === 0, 'dbWrite=' + d.state.dbWrite);
          ok(c.label + ': no Database record was created or deleted by the probe',
            d.state.dbGet > 0 || d.state.dbDocs > 0, 'dbGet=' + d.state.dbGet + ' dbDocs=' + d.state.dbDocs);
          stop(r);
        });
      });
    });
  }, Promise.resolve()).then(function () {
    head('4 — the probe is read-only by construction');
    var body = extractFn('probeAppwriteDatabase');
    var writes = ['createDocument', 'updateDocument', 'upsertDocument', 'deleteDocument',
      'createCollection', 'deleteCollection', 'createFile', 'deleteFile', 'seed(', 'migrateAppwriteTiers'];
    var found = writes.filter(function (w) { return body.indexOf(w) > -1; });
    ok('the connectivity probe contains no write, seed or migration call', found.length === 0, found.join(', '));
    ok('it uses only read operations', /appwriteDatabases\.get\(/.test(body) && /listDocuments\(/.test(body));
    ok('the documents fallback reads at most one record', /limit\(1\)/.test(body));
  });
}

/* ────────────────────────── run ────────────────────────────────────────── */
partOne()
  .then(partTwo)
  .then(partThree)
  .then(partFour)
  .then(function () {
    children.forEach(function (c) { try { c.kill('SIGKILL'); } catch (e) {} });
    stubs.forEach(function (s) { try { s.close(); } catch (e) {} });
    sandboxes.forEach(function (d) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} });
    console.log('\n' + passes + ' passed, ' + fails + ' failed');
    process.exit(fails ? 1 : 0);
  })
  .catch(function (e) {
    children.forEach(function (c) { try { c.kill('SIGKILL'); } catch (err) {} });
    stubs.forEach(function (s) { try { s.close(); } catch (err) {} });
    console.error('\nHARNESS ERROR: ' + (e && e.stack || e));
    process.exit(1);
  });
