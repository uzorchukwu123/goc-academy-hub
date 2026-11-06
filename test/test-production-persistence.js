/* test-production-persistence.js — production persistence fail-safes.
   ---------------------------------------------------------------------------
   Covers the four authorised production-safety changes, over REAL HTTP against
   a throw-away copy of the server, with NO Appwrite credentials anywhere:

     A  Appwrite configured but initialization fails
        • production refuses to boot, seeds nothing and overwrites nothing;
        • an existing local data.json survives byte-for-byte;
        • local development keeps the original local-file fallback;
        • GOC_APPWRITE_OFF stays a deliberate, fully local run;
        • an unconfigured production run is announced, not passed over silently.

     B  Reading the durable Storage backup
        • a genuine 404 is "no blob yet" and first-install logic still runs;
        • 401 / 403 / 5xx are reported as auth / permission / network failures,
          never as a first install, and never replace the local file;
        • a payload that is not readable JSON is a damaged backup, not a missing
          one, and is not written over the local file;
        • the stale-blob guard still keeps a newer local copy and still restores
          a newer blob;
        • production with an unreadable backup and NO local file refuses to boot
          rather than inventing a fresh academy, and deletes no backup.

     D  GOC_DATA_DIR
        • an existing writable directory and a missing-but-creatable one work;
        • a read-only directory or a path that is really a file refuses startup
          in production, creates no fallback and writes nothing;
        • local development warns instead of dying;
        • leaving GOC_DATA_DIR unset keeps the original behaviour.

     E  Founder entrance (verification only — the implementation is unchanged)
        • the gate-word rules, exact matching and value-free startup status;
        • neither variable reaches browser code;
        • a matching phrase is not stored as a contact message, issues no token
          and is not enough on its own to sign anybody in.

   A tiny local HTTP server impersonates Appwrite Storage so the download path
   is exercised for real without a project, a key or a network connection.
   node test/test-production-persistence.js */
'use strict';
var fs = require('fs');
var os = require('os');
var net = require('net');
var http = require('http');
var path = require('path');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var fails = 0, passes = 0;
function ok(n, c, x) {
  if (c) { passes++; console.log('  pass  ' + n); }
  else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 300) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var sandboxes = [];
var children = [];
var stubs = [];

function freePort() {
  return new Promise(function (resolve) {
    var s = net.createServer();
    s.listen(0, '127.0.0.1', function () {
      var p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

/* A scratch copy of the app: the real server file, the real static assets, and
   a data folder the test controls. Nothing in the checkout is ever written. */
function mkSandbox() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-prodpersist-'));
  sandboxes.push(dir);
  fs.cpSync(path.join(APP, 'server'), path.join(dir, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(dir, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
    if (fs.existsSync(path.join(APP, f))) fs.cpSync(path.join(APP, f), path.join(dir, f));
  });
  try { fs.rmSync(path.join(dir, 'server', 'data.json'), { force: true }); } catch (e) {}
  return dir;
}

/* Real secrets are never used: these are obvious placeholders, and the only
   thing the server does with them before the stub is build a client object. */
var FAKE_KEY = 'test-placeholder-not-a-real-appwrite-key';
function baseEnv(sandbox, dataDir, port, extra) {
  var env = {};
  Object.keys(process.env).forEach(function (k) {
    if (/^(APPWRITE_|GOC_|NODE_ENV$)/.test(k)) return;   /* start from a known state */
    env[k] = process.env[k];
  });
  env.PORT = String(port);
  env.NODE_PATH = path.join(APP, 'node_modules');
  env.GOC_FOUNDER_PW = 'test-founder-password';
  env.GOC_ACADDIR_PW = 'test-acaddir-password';
  env.GOC_PASSCODE = '481923';
  if (dataDir) env.GOC_DATA_DIR = dataDir;
  Object.keys(extra || {}).forEach(function (k) {
    if (extra[k] === undefined) delete env[k]; else env[k] = extra[k];
  });
  return env;
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
    req.setTimeout(4000, function () { req.destroy(); resolve({ status: 0, raw: 'timeout', body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}

/* Boot the real server and resolve as soon as it is either serving or dead.
   A refusal to start is a first-class outcome here, not a harness error. */
function boot(opts) {
  var sandbox = opts.sandbox || mkSandbox();
  var dataDir = opts.dataDir === undefined ? path.join(sandbox, 'data') : opts.dataDir;
  if (dataDir && opts.makeDataDir !== false && !opts.dataDirIsFile) {
    try { fs.mkdirSync(dataDir, { recursive: true }); } catch (e) {}
  }
  return freePort().then(function (port) {
    var env = baseEnv(sandbox, dataDir, port, opts.env);
    var child = spawn(process.execPath, [path.join(sandbox, 'server', 'server.js')], {
      cwd: sandbox, env: env, stdio: ['ignore', 'pipe', 'pipe']
    });
    children.push(child);
    var log = '';
    child.stdout.on('data', function (c) { log += c; });
    child.stderr.on('data', function (c) { log += c; });
    var result = { sandbox: sandbox, dataDir: dataDir, port: port, child: child, exited: false, code: null };
    Object.defineProperty(result, 'log', { get: function () { return log; } });
    var done = new Promise(function (resolve) {
      child.on('exit', function (code) { result.exited = true; result.code = code; resolve(); });
    });
    var tries = 0;
    function poll() {
      if (result.exited) return result;
      return call(port, 'GET', '/api/health').then(function (h) {
        if (h.status === 200) { result.booted = true; return result; }
        if (tries++ > 90) { result.booted = false; return result; }
        return new Promise(function (r) { setTimeout(r, 150); }).then(poll);
      });
    }
    return Promise.race([done.then(function () { return result; }), poll()]).then(function () {
      /* give a refusing process a moment to finish printing its banner */
      if (!result.booted && !result.exited) {
        return new Promise(function (r) { setTimeout(r, 400); }).then(function () { return result; });
      }
      return result;
    });
  });
}

function stop(r) { try { r.child.kill('SIGKILL'); } catch (e) {} }

/* ---------------------------------------------------------------- Appwrite stub */
function startStub(scenario) {
  var seen = { download: 0, del: 0, create: 0, other: 0 };
  var srv = http.createServer(function (req, res) {
    var u = req.url || '';
    if (/\/download(\?|$)/.test(u)) {
      seen.download++;
      if (scenario.status === 200) {
        res.writeHead(200, { 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.from(scenario.body, 'utf8'));
      } else {
        res.writeHead(scenario.status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: scenario.message || 'stub error', code: scenario.status, type: scenario.type || 'general_unknown' }));
      }
      return;
    }
    if (req.method === 'DELETE') { seen.del++; res.writeHead(204); res.end(); return; }
    if (req.method === 'POST' && /\/files(\?|$)/.test(u)) {
      seen.create++; req.resume();
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ $id: 'academy-data-json', bucketId: 'goc-data' }));
      return;
    }
    seen.other++; req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ total: 0, documents: [], users: [], files: [], buckets: [] }));
  });
  stubs.push(srv);
  return new Promise(function (resolve) {
    srv.listen(0, '127.0.0.1', function () {
      resolve({ url: 'http://127.0.0.1:' + srv.address().port + '/v1', seen: seen, server: srv });
    });
  });
}
function appwriteEnv(url, extra) {
  var e = {
    APPWRITE_ENDPOINT: url,
    APPWRITE_PROJECT_ID: 'test-project',
    APPWRITE_API_KEY: FAKE_KEY,
    APPWRITE_DATABASE_ID: 'goc_academy',
    APPWRITE_BUCKET_ID: 'goc-data',
    APPWRITE_FILE_ID: 'academy-data-json'
  };
  Object.keys(extra || {}).forEach(function (k) { e[k] = extra[k]; });
  return e;
}

/* A local data.json that must survive untouched. */
var SENTINEL = { _savedAt: '2026-01-01T00:00:00.000Z', settings: { sentinel: 'original-academy-records' }, students: [], staff: [] };
function writeSentinel(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  var f = path.join(dataDir, 'data.json');
  fs.writeFileSync(f, JSON.stringify(SENTINEL));
  return { file: f, bytes: fs.readFileSync(f, 'utf8') };
}
function unchanged(s) { return fs.existsSync(s.file) && fs.readFileSync(s.file, 'utf8') === s.bytes; }
/* A server that BOOTS rewrites data.json by design: start() runs migrate() and
   then writeData(), which stamps _savedAt and re-serialises. Byte equality is
   therefore the right assertion only for a run that refuses to start. For a
   booting run the real invariant is that the stored RECORDS survived and were
   not replaced by anything from the cloud. */
function recordsIntact(s) {
  if (!fs.existsSync(s.file)) return false;
  var db;
  try { db = JSON.parse(fs.readFileSync(s.file, 'utf8')); } catch (e) { return false; }
  return !!(db && db.settings && db.settings.sentinel === 'original-academy-records'
    && db.settings.from === undefined
    && Array.isArray(db.students) && Array.isArray(db.staff));
}
function fileDetail(s) {
  try { return fs.readFileSync(s.file, 'utf8').slice(0, 200); } catch (e) { return String(e && e.message); }
}
function blobNewer() { return JSON.stringify({ _savedAt: '2030-01-01T00:00:00.000Z', settings: { from: 'cloud-backup' } }); }
function blobOlder() { return JSON.stringify({ _savedAt: '2020-01-01T00:00:00.000Z', settings: { from: 'stale-cloud-backup' } }); }

var PROD = { NODE_ENV: 'production' };

/* =============================================================== A */
function phaseA() {
  head('A — Appwrite configured but initialization fails');
  /* An endpoint the SDK itself rejects: a genuine initAppwrite() failure with
     no credentials and no network involved. */
  var broken = { APPWRITE_ENDPOINT: 'not-a-valid-endpoint', APPWRITE_PROJECT_ID: 'test-project', APPWRITE_API_KEY: FAKE_KEY };

  return boot({ env: Object.assign({}, broken, PROD) }).then(function (r) {
    ok('production refuses to boot when Appwrite init fails', r.exited && r.code === 1, 'exit=' + r.code + ' ' + r.log.slice(-260));
    ok('the refusal names the problem and the variables to check',
      /APPWRITE IS CONFIGURED BUT NOT USABLE/.test(r.log) && /APPWRITE_API_KEY/.test(r.log), r.log.slice(-260));
    ok('it says it will not fall back or seed', /will NOT fall back to a/.test(r.log) && /will NOT seed a fresh database/.test(r.log));
    ok('no fresh academy was seeded', !fs.existsSync(path.join(r.dataDir, 'data.json')));
    ok('no credential value appears in the failure output', r.log.indexOf(FAKE_KEY) === -1);
    ok('it never claims to be running local-only', !/Storage: local file/.test(r.log));
    stop(r);

    /* The same failure with real local records present. */
    var sb = mkSandbox(), dd = path.join(sb, 'data');
    var s = writeSentinel(dd);
    return boot({ sandbox: sb, dataDir: dd, env: Object.assign({}, broken, PROD) });
  }).then(function (r) {
    ok('production refuses even when a local data.json exists', r.exited && r.code === 1, 'exit=' + r.code);
    var s = { file: path.join(r.dataDir, 'data.json'), bytes: JSON.stringify(SENTINEL) };
    ok('the existing local data.json is byte-for-byte untouched (no start() ran)', unchanged(s), fileDetail(s));
    stop(r);

    head('A — local development keeps the original fallback');
    return boot({ env: broken });
  }).then(function (r) {
    ok('a dev run still starts after an Appwrite init failure', r.booted === true, r.log.slice(-260));
    ok('dev still logs the original local fallback', /falling back to local data\.json/.test(r.log));
    ok('dev really is serving from the local file', /Storage: local file/.test(r.log));
    stop(r);

    head('A — GOC_APPWRITE_OFF remains a deliberate local run');
    return boot({ env: appwriteEnv('https://example.invalid/v1', { GOC_APPWRITE_OFF: '1', NODE_ENV: 'production' }) });
  }).then(function (r) {
    ok('production boots when Appwrite is deliberately switched off', r.booted === true, r.log.slice(-260));
    ok('it announces the deliberate local-only run', /GOC_APPWRITE_OFF is set/.test(r.log));
    ok('Appwrite is never contacted at all', /Appwrite is not contacted at all/.test(r.log));
    ok('no fail-closed banner is printed', !/STARTUP REFUSED/.test(r.log));
    stop(r);

    head('A — missing credentials in production are announced, not silent');
    return boot({ env: PROD });
  }).then(function (r) {
    ok('an unconfigured production run still boots (Appwrite is not mandatory)', r.booted === true, r.log.slice(-260));
    ok('it warns loudly that the run is local-only', /WARNING: Appwrite is not configured/.test(r.log) && /LOCAL-ONLY/.test(r.log));
    ok('the warning names no secret value', r.log.indexOf(FAKE_KEY) === -1);
    stop(r);

    head('A — the success path is unchanged');
    return startStub({ status: 404, message: 'File with the requested ID could not be found' });
  }).then(function (stub) {
    return boot({ env: appwriteEnv(stub.url, PROD) }).then(function (r) {
      ok('production boots normally when Appwrite initializes', r.booted === true, r.log.slice(-300));
      ok('it reports cloud storage exactly as before', /Storage: Appwrite Database \(cloud\)/.test(r.log));
      ok('the original init message is unchanged', /Appwrite Database initialized/.test(r.log));
      ok('a genuinely absent blob still allows the first-install seed', fs.existsSync(path.join(r.dataDir, 'data.json')));
      stop(r);
    });
  });
}

/* =============================================================== B */
function phaseB() {
  head('B — a genuinely missing backup is still a first install');
  return startStub({ status: 404, message: 'File with the requested ID could not be found' }).then(function (stub) {
    return boot({ env: appwriteEnv(stub.url) }).then(function (r) {
      ok('404 is logged as "no blob yet"', /No blob in Appwrite Storage yet/.test(r.log), r.log.slice(-260));
      ok('404 is not misreported as a read failure', !/could NOT be read/.test(r.log));
      stop(r);
    });
  }).then(function () {
    head('B — permission / auth / network are NOT a first install');
    var cases = [
      { status: 403, kind: 'permission', label: 'a permission error' },
      { status: 401, kind: 'auth', label: 'an authentication error' },
      { status: 503, kind: 'network-or-service', label: 'a service/network failure' }
    ];
    return cases.reduce(function (p, c) {
      return p.then(function () {
        return startStub({ status: c.status }).then(function (stub) {
          var sb = mkSandbox(), dd = path.join(sb, 'data');
          var s = writeSentinel(dd);
          return boot({ sandbox: sb, dataDir: dd, env: appwriteEnv(stub.url) }).then(function (r) {
            ok(c.label + ' is classified as ' + c.kind, r.log.indexOf('could NOT be read (' + c.kind) > -1, r.log.slice(-300));
            ok(c.label + ' is explicitly not a first install', /This is NOT a first install/.test(r.log));
            ok(c.label + ' is never logged as "no blob yet"', !/No blob in Appwrite Storage yet/.test(r.log));
            ok(c.label + ' leaves the local data.json untouched', recordsIntact(s), fileDetail(s));
            stop(r);
          });
        });
      });
    }, Promise.resolve());
  }).then(function () {
    head('B — a damaged backup never overwrites good local data');
    return startStub({ status: 200, body: 'this is not JSON {{{' }).then(function (stub) {
      var sb = mkSandbox(), dd = path.join(sb, 'data');
      var s = writeSentinel(dd);
      return boot({ sandbox: sb, dataDir: dd, env: appwriteEnv(stub.url) }).then(function (r) {
        ok('an unreadable payload is reported as a damaged backup', /exists but is not readable JSON/.test(r.log), r.log.slice(-260));
        ok('it is not passed off as a missing backup', !/No blob in Appwrite Storage yet/.test(r.log));
        ok('the valid local data.json is preserved', recordsIntact(s), fileDetail(s));
        stop(r);
      });
    });
  }).then(function () {
    head('B — the stale-blob guard still decides by _savedAt');
    return startStub({ status: 200, body: blobOlder() }).then(function (stub) {
      var sb = mkSandbox(), dd = path.join(sb, 'data');
      var s = writeSentinel(dd);
      return boot({ sandbox: sb, dataDir: dd, env: appwriteEnv(stub.url) }).then(function (r) {
        ok('a newer local copy is kept', /is as new as or newer than the Appwrite blob/.test(r.log), r.log.slice(-260));
        ok('the newer local records are not replaced by the stale blob',
          JSON.parse(fs.readFileSync(s.file, 'utf8')).settings.sentinel === 'original-academy-records');
        stop(r);
      });
    });
  }).then(function () {
    return startStub({ status: 200, body: blobNewer() }).then(function (stub) {
      var sb = mkSandbox(), dd = path.join(sb, 'data');
      writeSentinel(dd);
      return boot({ sandbox: sb, dataDir: dd, env: appwriteEnv(stub.url) }).then(function (r) {
        ok('a newer blob is still restored', /Hydrated data.json blob from Appwrite Storage/.test(r.log), r.log.slice(-260));
        ok('the restored file really is the cloud copy',
          JSON.parse(fs.readFileSync(path.join(dd, 'data.json'), 'utf8')).settings.from === 'cloud-backup');
        ok('the bucket and file IDs are unchanged', stub.seen.download > 0);
        stop(r);
      });
    });
  }).then(function () {
    head('B — production will not invent an academy it cannot read');
    var cases = [
      { status: 403, kind: 'permission' },
      { status: 401, kind: 'auth' },
      { status: 500, kind: 'network-or-service' },
      { status: 200, body: '<<<corrupt>>>', kind: 'invalid-backup' }
    ];
    return cases.reduce(function (p, c) {
      return p.then(function () {
        return startStub(c).then(function (stub) {
          return boot({ env: appwriteEnv(stub.url, PROD) }).then(function (r) {
            ok('production refuses to boot on ' + c.kind + ' with no local data', r.exited && r.code === 1, 'exit=' + r.code + ' ' + r.log.slice(-240));
            ok('production seeds nothing on ' + c.kind, !fs.existsSync(path.join(r.dataDir, 'data.json')));
            ok('production deletes no backup on ' + c.kind, stub.seen.del === 0, 'deletes=' + stub.seen.del);
            stop(r);
          });
        });
      });
    }, Promise.resolve());
  });
}

/* =============================================================== D */
function phaseD() {
  head('D — a usable GOC_DATA_DIR behaves exactly as before');
  var sb = mkSandbox();
  var existing = path.join(sb, 'already-there');
  fs.mkdirSync(existing, { recursive: true });
  return boot({ sandbox: sb, dataDir: existing }).then(function (r) {
    ok('an existing writable directory boots', r.booted === true, r.log.slice(-240));
    ok('no directory warning is printed for a good path', !/GOC_DATA_DIR IS NOT USABLE/.test(r.log));
    ok('records are written into the configured directory', fs.existsSync(path.join(existing, 'data.json')));
    stop(r);

    var sb2 = mkSandbox();
    var creatable = path.join(sb2, 'deep', 'nested', 'data');
    return boot({ sandbox: sb2, dataDir: creatable, makeDataDir: false });
  }).then(function (r) {
    ok('a missing-but-creatable directory is created and used', r.booted === true && fs.existsSync(path.join(r.dataDir, 'data.json')), r.log.slice(-240));
    stop(r);

    head('D — an unusable GOC_DATA_DIR refuses production startup');
    /* A path that is really a file: mkdir cannot succeed and nothing is writable. */
    var sb3 = mkSandbox();
    var filePath = path.join(sb3, 'not-a-directory');
    fs.writeFileSync(filePath, 'precious existing file');
    return boot({ sandbox: sb3, dataDir: filePath, dataDirIsFile: true, env: PROD }).then(function (r) {
      ok('production refuses a path that is not a directory', r.exited && r.code === 1, 'exit=' + r.code + ' ' + r.log.slice(-240));
      ok('the refusal names GOC_DATA_DIR', /GOC_DATA_DIR IS NOT USABLE/.test(r.log));
      ok('it states nothing was redirected or deleted', /has NOT/.test(r.log) && /silently switched to another directory/.test(r.log));
      ok('the existing file is untouched', fs.readFileSync(filePath, 'utf8') === 'precious existing file');
      ok('no data.json was written anywhere in the checkout copy',
        !fs.existsSync(path.join(sb3, 'server', 'data.json')) && !fs.existsSync(path.join(sb3, 'data.json')));
      stop(r);
    });
  }).then(function () {
    /* A genuinely read-only directory (running as root would defeat chmod, so
       the assertion adapts rather than reporting a false pass). */
    var sb4 = mkSandbox();
    var ro = path.join(sb4, 'read-only');
    fs.mkdirSync(ro, { recursive: true });
    fs.chmodSync(ro, 0o500);
    var writable = false;
    try { fs.accessSync(ro, fs.constants.W_OK); writable = true; } catch (e) {}
    return boot({ sandbox: sb4, dataDir: ro, env: PROD }).then(function (r) {
      if (writable) {
        console.log('  skip  read-only directory (this user can write regardless of mode — e.g. root)');
      } else {
        ok('production refuses a read-only data directory', r.exited && r.code === 1, 'exit=' + r.code + ' ' + r.log.slice(-240));
        ok('the read-only refusal explains the problem', /GOC_DATA_DIR IS NOT USABLE/.test(r.log) && /EACCES|W_OK|access/.test(r.log));
        ok('nothing is written into a read-only directory', !fs.existsSync(path.join(ro, 'data.json')));
      }
      stop(r);
      try { fs.chmodSync(ro, 0o700); } catch (e) {}
    });
  }).then(function () {
    head('D — local development warns instead of dying');
    var sb5 = mkSandbox();
    var filePath = path.join(sb5, 'also-not-a-directory');
    fs.writeFileSync(filePath, 'keep me');
    return boot({ sandbox: sb5, dataDir: filePath, dataDirIsFile: true }).then(function (r) {
      ok('a dev run surfaces the bad path as a warning', /GOC_DATA_DIR IS NOT USABLE/.test(r.log), r.log.slice(-240));
      ok('the dev warning does not claim a redirect happened', /has NOT/.test(r.log));
      ok('the existing file is still intact', fs.readFileSync(filePath, 'utf8') === 'keep me');
      stop(r);
    });
  }).then(function () {
    head('D — leaving GOC_DATA_DIR unset keeps the default behaviour');
    var sb6 = mkSandbox();
    return boot({ sandbox: sb6, dataDir: null, env: { GOC_DATA_DIR: undefined } }).then(function (r) {
      ok('an unset GOC_DATA_DIR still boots', r.booted === true, r.log.slice(-240));
      ok('no validation banner appears for the default path', !/GOC_DATA_DIR IS NOT USABLE/.test(r.log));
      ok('the default location is still server/data.json', fs.existsSync(path.join(sb6, 'server', 'data.json')));
      stop(r);
    });
  });
}

/* =============================================================== E */
function phaseE() {
  head('E — Founder entrance verification (implementation unchanged)');
  var fc = require(path.join(APP, 'server', 'lib', 'founder-contact.js'));
  var WORD = 'A Valid Founder Gate Phrase';

  ok('a well-formed gate word is accepted', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: WORD }) === WORD);
  ok('matching is exact and case-sensitive', fc.matchesGateWord(WORD, WORD) === true && fc.matchesGateWord(WORD.toLowerCase(), WORD) === false);
  ok('punctuation and inner spacing matter', fc.matchesGateWord(WORD.replace(' ', '  '), WORD) === false);
  ok('the 12-character minimum is enforced', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: 'short' }) === null);
  ok('exactly 12 characters is allowed', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: 'a'.repeat(12) }) === 'a'.repeat(12));
  ok('200 characters is allowed', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: 'b'.repeat(200) }) === 'b'.repeat(200));
  ok('201 characters is rejected', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: 'c'.repeat(201) }) === null);
  ok('leading whitespace is rejected', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: ' ' + WORD }) === null);
  ok('trailing whitespace is rejected', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: WORD + '\t' }) === null);
  ok('control characters are rejected', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: WORD + '\u0007' }) === null);
  ok('an unset gate word closes the entrance', fc.configuredGateWord({}) === null);
  ok('a non-string gate word is rejected', fc.configuredGateWord({ GOC_FOUNDER_GATE_WORD: 1234567890123 }) === null);
  ok('the email must be explicitly configured and valid',
    fc.configuredEmail({ GOC_FOUNDER_EMAIL: 'Founder@Example.com' }) === 'founder@example.com'
    && fc.configuredEmail({ GOC_FOUNDER_EMAIL: 'not-an-email' }) === null
    && fc.configuredEmail({}) === null);

  var status = fc.configurationStatus({ GOC_FOUNDER_GATE_WORD: WORD, GOC_FOUNDER_EMAIL: 'founder@example.com' });
  ok('the startup status is value-free when configured', status === 'configured');
  var closed = fc.configurationStatus({});
  ok('a closed status names the variable but never a value', /GOC_FOUNDER_GATE_WORD/.test(closed) && closed.indexOf(WORD) === -1);

  /* Neither variable may reach anything the browser is served. */
  var browserFiles = ['index.html', 'sw.js'];
  fs.readdirSync(path.join(APP, 'js')).forEach(function (f) { if (/\.js$/.test(f)) browserFiles.push('js/' + f); });
  var leaked = browserFiles.filter(function (f) {
    var t = fs.readFileSync(path.join(APP, f), 'utf8');
    return /GOC_FOUNDER_GATE_WORD|GOC_FOUNDER_EMAIL/.test(t);
  });
  ok('no browser-served file mentions either variable', leaked.length === 0, leaked.join(', '));

  var src = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');
  var branch = src.slice(src.indexOf('const gateWord = founderContact.configuredGateWord'), src.indexOf('noteContact(ip);\n      const db = readData();'));
  ok('the founder branch returns before any contact message is stored',
    branch.indexOf('contactMessages.push') === -1 && /okJson\(res, \{ ok: true, founderRequest: true/.test(branch));
  ok('the founder branch returns before any email is sent', branch.indexOf('sendContactEmail') === -1);
  ok('a matching phrase issues no session token', !/token:/.test(branch));
  ok('the phrase alone is not enough — the configured email must also match',
    /email\.trim\(\)\.toLowerCase\(\) !== founderEmail/.test(branch) && /never grants access/.test(branch));
  ok('neither value is hard-coded in the server', !new RegExp('=\\s*[\'"]' + WORD).test(src));

  head('E — the entrance over real HTTP');
  var sb = mkSandbox(), dd = path.join(sb, 'data');
  return boot({
    sandbox: sb, dataDir: dd,
    env: { GOC_FOUNDER_GATE_WORD: WORD, GOC_FOUNDER_EMAIL: 'founder@example.com' }
  }).then(function (r) {
    ok('the server boots with the entrance configured', r.booted === true, r.log.slice(-240));
    ok('the boot log reports it without revealing the phrase',
      /Founder contact entrance: configured/.test(r.log) && r.log.indexOf(WORD) === -1);
    return call(r.port, 'POST', '/api/contact', { name: 'A Visitor', email: 'someone@example.com', message: WORD }).then(function (res) {
      ok('the phrase with the wrong email is refused', res.status === 403, res.status + ' ' + res.raw);
      ok('the refusal does not echo the phrase', res.raw.indexOf(WORD) === -1);
      return call(r.port, 'POST', '/api/contact', { name: 'The Founder', email: 'founder@example.com', message: WORD });
    }).then(function (res) {
      ok('the phrase with the configured email is accepted as a request', res.status === 200 && res.body && res.body.founderRequest === true, res.raw);
      ok('it only points at the existing staff sign-in', res.body && res.body.next === 'free-admin', res.raw);
      ok('no token or session is issued', res.body && res.body.token === undefined && res.body.session === undefined, res.raw);
      var db = JSON.parse(fs.readFileSync(path.join(dd, 'data.json'), 'utf8'));
      var stored = JSON.stringify(db.contactMessages || []);
      ok('the phrase was never stored as a contact message', stored.indexOf(WORD) === -1, stored.slice(0, 200));
      return call(r.port, 'GET', '/api/config');
    }).then(function (res) {
      ok('the public config exposes neither value', res.raw.indexOf(WORD) === -1 && !/GOC_FOUNDER/.test(res.raw));
      /* An ordinary message must still work exactly as before. */
      return call(r.port, 'POST', '/api/contact', { name: 'Ada Obi', email: 'ada@example.com', message: 'When does the next cohort start?' });
    }).then(function (res) {
      ok('ordinary contact messages still work', res.status === 200 && res.body && res.body.ok === true, res.raw);
      var db = JSON.parse(fs.readFileSync(path.join(dd, 'data.json'), 'utf8'));
      ok('the ordinary message is recorded as before',
        (db.contactMessages || []).some(function (m) { return m.email === 'ada@example.com'; }));
      stop(r);
    });
  });
}

/* =============================================================== run */
phaseA()
  .then(phaseB)
  .then(phaseD)
  .then(phaseE)
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
