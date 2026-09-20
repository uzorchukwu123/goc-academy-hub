/* test-security.js — the launch-hardening fixes, exercised over real HTTP.

   Spawns its own server on a spare port against a throwaway copy of the app
   that DELIBERATELY contains the sensitive files a real folder has — a readme
   that prints a password, start-server.ps1, a .pdf, a .csv — then proves that:

     1. none of those files can be downloaded over the web        (data leak)
     2. the server/ and test/ folders are refused, any capitalisation
     3. a malformed web address cannot crash the server          (denial of service)
     4. path traversal out of the app folder is refused
     5. sign-up is rate-limited, exactly like login and unlock

   No dependencies.  Run:  node test/test-security.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = core.normalizeSignupCode(core.SIGNUP_CODE_DEFAULT);
var PORT = Number(process.env.GOC_SEC_PORT) || 8151;

/* A throwaway copy of the app. Nothing here touches the real roster. */
var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-sec-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
/* Start with no database, so the first run seeds it with a known sign-up code. */
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

/* Plant the sensitive files, each stamped with a sentinel so the test can prove
   not one byte of them ever left the server. */
var SENTINEL = 'SENTINEL-SECRET-8f3c1a2d';
fs.writeFileSync(path.join(SANDBOX, 'readme.md'), '# readme\nFounder password: ' + SENTINEL + '\n');
fs.writeFileSync(path.join(SANDBOX, 'start-server.ps1'), '# passcode ' + SENTINEL + '\n');
fs.writeFileSync(path.join(SANDBOX, 'notes.csv'), 'question,answer\n' + SENTINEL + ',B\n');
fs.writeFileSync(path.join(SANDBOX, 'blueprint.pdf'), '%PDF-1.4 ' + SENTINEL);

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 120) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

/* A raw HTTP client: the path is sent verbatim, so a malformed escape like
   "/%zz" actually reaches the server instead of being tidied up on the way. */
function call(method, urlPath, body) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body);
    var headers = {};
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers },
      function (res) {
        var raw = '';
        res.on('data', function (c) { raw += c; });
        res.on('end', function () {
          var json = null; try { json = JSON.parse(raw); } catch (e) {}
          resolve({ status: res.statusCode, raw: raw, body: json });
        });
      });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null, err: true }); });
    if (payload) req.write(payload);
    req.end();
  });
}

var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, {
      PORT: String(PORT),
      NODE_PATH: path.join(APP, 'node_modules')
    }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', function (c) { serverLog += c; });
child.stderr.on('data', function (c) { serverLog += c; });

function stop() {
  try { child.kill(); } catch (e) {}
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
}
function waitForBoot(tries) {
  return call('GET', '/api/health').then(function (r) {
    if (r.status === 200) return true;
    if (tries <= 0) throw new Error('server did not start\n' + serverLog);
    return new Promise(function (r2) { setTimeout(r2, 100); }).then(function () { return waitForBoot(tries - 1); });
  });
}

waitForBoot(100).then(function () {

  head('sensitive files are never downloadable, whatever their extension');
  return call('GET', '/readme.md').then(function (r) {
    ok('readme.md is refused (it lists the demo passwords)', r.status === 404, 'status ' + r.status);
    ok('  and not one byte of it went out', r.raw.indexOf(SENTINEL) < 0);
    return call('GET', '/start-server.ps1');
  }).then(function (r) {
    ok('start-server.ps1 is refused', r.status === 404, 'status ' + r.status);
    ok('  and its contents did not leak', r.raw.indexOf(SENTINEL) < 0);
    return call('GET', '/notes.csv');
  }).then(function (r) {
    ok('a stray .csv is refused', r.status === 404, 'status ' + r.status);
    ok('  and its contents did not leak', r.raw.indexOf(SENTINEL) < 0);
    return call('GET', '/blueprint.pdf');
  }).then(function (r) {
    ok('a stray .pdf is refused (no more octet-stream fallback)', r.status === 404, 'status ' + r.status);
    ok('  and its contents did not leak', r.raw.indexOf(SENTINEL) < 0);

    head('the server/ folder — the database and the hashes — is never served');
    return call('GET', '/server/data.json');
  }).then(function (r) {
    ok('/server/data.json is refused', r.status === 404, 'status ' + r.status);
    ok('  and no password hash went out', r.raw.indexOf('scrypt$') < 0);
    return call('GET', '/SERVER/data.json');
  }).then(function (r) {
    ok('/SERVER/data.json (capitalised) is refused too', r.status === 404, 'status ' + r.status);
    ok('  and no password hash went out', r.raw.indexOf('scrypt$') < 0);
    return call('GET', '/Server/server.js');
  }).then(function (r) {
    ok('/Server/server.js is refused although .js is otherwise servable', r.status === 404, 'status ' + r.status);

    head('the real app is still served');
    return call('GET', '/');
  }).then(function (r) {
    ok('/ serves index.html', r.status === 200 && r.raw.indexOf('<') >= 0, 'status ' + r.status);
    return call('GET', '/js/app.js');
  }).then(function (r) {
    ok('/js/app.js is served', r.status === 200, 'status ' + r.status);
    return call('GET', '/manifest.webmanifest');
  }).then(function (r) {
    ok('/manifest.webmanifest is served', r.status === 200, 'status ' + r.status);

    head('a malformed web address cannot bring the server down');
    return call('GET', '/%zz');
  }).then(function (r) {
    ok('a bad percent-escape is answered, not fatal', r.status === 400 || r.status === 404, 'status ' + r.status);
    return call('GET', '/api/health');
  }).then(function (r) {
    ok('the server is STILL UP after the bad request', r.status === 200, 'status ' + r.status);

    head('path traversal out of the app folder is refused');
    return call('GET', '/..%2f..%2fserver%2fdata.json');
  }).then(function (r) {
    ok('an encoded ../../ escape is refused', r.status === 403 || r.status === 404, 'status ' + r.status);
    ok('  and no password hash went out', r.raw.indexOf('scrypt$') < 0);

    head('sign-up is rate-limited, the same as login and the console unlock');
    var seq = Promise.resolve();
    var seen = [];
    for (var i = 0; i < 8; i++) {
      seq = seq.then(function () {
        return call('POST', '/api/students', { signupCode: 'NOT-THE-CODE' }).then(function (r) { seen.push(r.status); });
      });
    }
    return seq.then(function () {
      ok('the first 8 wrong-code attempts are each refused with 403', seen.every(function (s) { return s === 403; }), seen.join(','));
      return call('POST', '/api/students', { signupCode: 'NOT-THE-CODE' });
    }).then(function (r) {
      ok('the 9th attempt from that address is throttled with 429', r.status === 429, 'status ' + r.status);
      return call('POST', '/api/students', { signupCode: SIGNUP, name: 'Late Comer', password: 'secret123',
        goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry'] });
    }).then(function (r) {
      ok('even a correct code is held off while throttled (it is by address)', r.status === 429, 'status ' + r.status);
    });
  });

}).then(function () {
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  stop();
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  console.log('  FAIL  harness error: ' + (e && e.message));
  stop();
  process.exit(1);
});
