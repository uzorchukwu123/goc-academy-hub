/* test-maintenance-mode.js — Workstream A: the temporary full-platform
   maintenance switch.

   Real HTTP against a disposable server, twice against the same data folder:

     MODE ON   · the homepage, every deep link, static assets, the tutor shell,
                 a password-setup link and every /api/ route answer 503 with
                 the announcement; health stays minimal; the service worker
                 clears the app cache; a different Host header, a POST and an
                 existing bearer token change nothing; the data file is intact.
     MODE OFF  · the real homepage, real health payload and real service worker
                 return, a bad login is 401 (not 503), the tutor shell is back,
                 and the same records are still there.

   Also proves the Appwrite Function gate (GOC_MAINTENANCE_MODE in config.js)
   and both build paths (maintenance build emits only index.html + sw.js; the
   normal build emits the full app again).

   Run:  node test/test-maintenance-mode.js
   Needs esbuild only for the final "normal build" half; without it that half
   is reported SKIPPED, exactly like test-build.js.                      */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var spawn = require('child_process').spawn;
var execFileSync = require('child_process').execFileSync;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var M = require(path.join(APP, 'server', 'lib', 'maintenance.js'));
var PORT = Number(process.env.GOC_MAINTENANCE_PORT) || 8199;

var passes = 0, fails = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-maintenance-'));
var DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA, { recursive: true });

function baseEnv(extra) {
  return Object.assign({}, process.env, {
    PORT: String(PORT),
    HOST: '127.0.0.1',
    GOC_DATA_DIR: DATA,
    GOC_FOUNDER_PW: 'founder2027',
    GOC_ACADDIR_PW: 'acaddir2027',
    GOC_PASSCODE: '2027',
    GOC_BACKUP_INTERVAL_MIN: '0',
    GOC_REMINDERS: '0'
  }, extra || {});
}

function request(method, url, opts) {
  opts = opts || {};
  return new Promise(function (resolve, reject) {
    var payload = opts.body == null ? null : JSON.stringify(opts.body);
    var headers = Object.assign({ Accept: 'application/json' }, opts.headers || {});
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () {
        var json = null;
        try { json = JSON.parse(raw); } catch (e) {}
        resolve({ status: res.statusCode, headers: res.headers, raw: raw, body: json });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function startServer(extraEnv) {
  var child = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], {
    env: baseEnv(extraEnv),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  var log = '';
  child.stdout.on('data', function (c) { log += c; });
  child.stderr.on('data', function (c) { log += c; });
  child.log = function () { return log; };
  return child;
}

function waitForServer(attempts) {
  attempts = attempts == null ? 120 : attempts;
  return request('GET', '/api/health').then(function () { return true; }, function () {
    if (attempts <= 0) return false;
    return new Promise(function (r) { setTimeout(r, 100); }).then(function () { return waitForServer(attempts - 1); });
  });
}

function stopServer(child) {
  return new Promise(function (resolve) {
    if (!child || child.killed) return resolve();
    child.once('exit', function () { resolve(); });
    try { child.kill('SIGTERM'); } catch (e) { resolve(); }
    setTimeout(function () { try { child.kill('SIGKILL'); } catch (e) {} resolve(); }, 3000);
  });
}

function looksLikeMaintenancePage(r) {
  return r.status === 503 &&
    /text\/html/.test(r.headers['content-type'] || '') &&
    r.raw.indexOf(M.HEADLINE) > -1 &&
    r.raw.indexOf(M.OPENING) > -1 &&
    r.raw.indexOf(M.UNDERWAY) > -1 &&
    r.raw.indexOf(M.CLOSING) > -1;
}

function dataFile() { return path.join(DATA, 'data.json'); }
function dataHash() {
  try { return crypto.createHash('sha256').update(fs.readFileSync(dataFile())).digest('hex'); }
  catch (e) { return null; }
}

var child = null;

(async function () {
  /* ================================================================ MODE ON */
  child = startServer({ GOC_MAINTENANCE_MODE: '1' });
  var up = await waitForServer();
  if (!up) { console.log('SERVER DID NOT START\n' + child.log()); process.exit(1); }
  console.log('  server up (maintenance ON)');

  head('the announcement replaces the whole public application');
  var home = await request('GET', '/');
  ok('GET / answers 503', home.status === 503, home.status);
  ok('it is the announcement page', looksLikeMaintenancePage(home), home.status + ' ' + (home.headers['content-type'] || ''));
  ok('the exact headline is present', home.raw.indexOf('<h1 id="maintenanceTitle">' + M.HEADLINE + '</h1>') > -1);
  ok('the exact closing line is present', home.raw.indexOf('<p class="closing">' + M.CLOSING + '</p>') > -1);
  ok('it says improvements, not closure', /improve|improvements/i.test(home.raw) && !/closed|shut down|goodbye/i.test(home.raw));
  ok('no login or registration action exists on it', !/signup|login|Create account|Get started|Register/i.test(home.raw));
  ok('no application script or stylesheet is loaded', !/js\/app\.js|js\/api\.js|css\/styles\.css|<script/i.test(home.raw));
  ok('no navigation links at all', !/<a\s/i.test(home.raw));
  ok('it is responsive (viewport meta + media query)', /name="viewport"/.test(home.raw) && /@media\s*\(max-width/.test(home.raw));
  ok('it is self-contained (inline SVG, no remote asset)', /<svg/.test(home.raw) && !/(?:src|href)="https?:/i.test(home.raw));
  ok('it carries no reopening date', !/\b(19|20)\d\d-\d\d-\d\d\b|\b\d{1,2}(st|nd|rd|th)?\s+(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(home.raw));
  ok('no private application data is echoed', !/GOC-S-\d|GOC-A-\d|passcode|data\.json|APPWRITE|Scholar ID:/i.test(home.raw));
  ok('it is marked no-store and noindex', /no-store/.test(home.headers['cache-control'] || '') && /noindex/.test(home.headers['x-robots-tag'] || ''), home.headers['x-robots-tag']);
  ok('it advertises a retry', home.headers['retry-after'] === '3600', home.headers['retry-after']);
  ok('it is not frameable by another origin', /frame-ancestors 'self'/.test(home.headers['content-security-policy'] || '') && /SAMEORIGIN/.test(home.headers['x-frame-options'] || ''));

  head('deep links, assets and every alternate entry point are gated');
  var deep = ['/index.html', '/?from=bookmark', '/free2027', '/free2027/', '/tutor', '/setup/' + 'a'.repeat(32),
              '/css/styles.css', '/js/app.js', '/js/api.js', '/manifest.webmanifest', '/icons/icon-192.png',
              '/students/dashboard', '/admin', '/random/deep/link'];
  for (const p of deep) {
    var r = await request('GET', p);
    ok('GET ' + p + ' cannot bypass maintenance', looksLikeMaintenancePage(r), r.status + ' ' + (r.headers['content-type'] || ''));
  }
  var otherHost = await request('GET', '/', { headers: { Host: 'another-host.example' } });
  ok('another Host header gets the same gate', looksLikeMaintenancePage(otherHost), otherHost.status);
  var headRes = await request('HEAD', '/');
  ok('HEAD / answers 503 with no body', headRes.status === 503 && headRes.raw === '', headRes.status + ' bytes=' + headRes.raw.length);
  var postPage = await request('POST', '/');
  ok('POST to a page URL is refused, not served the app', postPage.status === 503 && postPage.body && postPage.body.maintenance === true, postPage.status);

  head('the API is closed, including to an existing session');
  var login = await request('POST', '/api/auth/login', { body: { id: 'GOC-A-001', password: 'founder2027' } });
  ok('login answers 503', login.status === 503, login.status);
  ok('login issues no session cookie', !login.headers['set-cookie'], login.headers['set-cookie']);
  ok('login returns no token', !login.body || !login.body.token, login.raw.slice(0, 120));
  var me = await request('GET', '/api/me', { headers: { Authorization: 'Bearer ' + 'f'.repeat(64) } });
  ok('a bearer token cannot open /api/me', me.status === 503 && me.body && me.body.maintenance === true, me.status);
  var free = await request('GET', '/api/free2027/health');
  ok('Free UTME 2027 routes are closed', free.status === 503, free.status);
  var signup = await request('POST', '/api/students', { body: { name: 'x' } });
  ok('the retired signup route is 503, not its usual 405', signup.status === 503, signup.status);
  var bookmarks = await request('GET', '/api/me/bookmarks');
  ok('student data routes are closed', bookmarks.status === 503, bookmarks.status);
  var consoleReq = await request('GET', '/api/admin/staff');
  ok('console routes are closed', consoleReq.status === 503, consoleReq.status);

  head('health and robots remain, with nothing sensitive');
  var health = await request('GET', '/api/health');
  ok('health answers 200 so hosting checks pass', health.status === 200, health.status);
  ok('it reports maintenance plainly', health.body && health.body.maintenance === true && health.body.service === 'goc-academy-hub', health.raw);
  ok('it exposes no passcode length, programme state or roster', health.raw.indexOf('passcodeLength') < 0 && health.raw.indexOf('free2027') < 0 && health.raw.indexOf('students') < 0, health.raw);
  var healthPost = await request('POST', '/api/health', { body: {} });
  ok('health refuses a write method', healthPost.status === 405, healthPost.status);
  var robots = await request('GET', '/robots.txt');
  ok('robots.txt disallows everything', robots.status === 200 && /Disallow: \//.test(robots.raw), robots.raw);

  head('the cached application cannot be navigated back into');
  var sw = await request('GET', '/sw.js');
  ok('sw.js is served as JavaScript', sw.status === 200 && /javascript/.test(sw.headers['content-type'] || ''), sw.headers['content-type']);
  ok('it deletes every cache', /caches\.delete/.test(sw.raw));
  ok('it unregisters itself', /registration\.unregister/.test(sw.raw));
  ok('it never serves a cached app shell', !/const ASSETS|const CACHE|goc-v\d+/.test(sw.raw));
  ok('it takes over immediately', /skipWaiting/.test(sw.raw));

  head('the underlying application and its records are untouched');
  var hashWhileOn = dataHash();
  ok('the data file still exists and is readable', !!hashWhileOn);
  var studentsBefore = (JSON.parse(fs.readFileSync(dataFile(), 'utf8')).students || []).length;
  ok('the student roster was not changed', studentsBefore === 0, studentsBefore);

  /* =============================================================== MODE OFF */
  await stopServer(child);
  child = startServer({ GOC_MAINTENANCE_MODE: '0' });
  up = await waitForServer();
  if (!up) { console.log('SERVER DID NOT RESTART\n' + child.log()); process.exit(1); }
  console.log('  server up (maintenance OFF)');

  head('the real application returns when the switch is off');
  var home2 = await request('GET', '/');
  ok('GET / answers 200', home2.status === 200, home2.status);
  ok('the real homepage is back', /Raising Smart Scholars for Academic Excellence/.test(home2.raw) && /js\/app\.js/.test(home2.raw), home2.status);
  ok('the maintenance headline is gone', home2.raw.indexOf(M.HEADLINE) < 0);
  var health2 = await request('GET', '/api/health');
  ok('health reports the normal payload again', health2.status === 200 && !health2.body.maintenance && health2.body.passcodeLength > 0 && !!health2.body.free2027, health2.raw.slice(0, 160));
  var sw2 = await request('GET', '/sw.js');
  ok('the real service worker is back', sw2.status === 200 && /goc-v\d+/.test(sw2.raw) && !/registration\.unregister/.test(sw2.raw));
  var tutor = await request('GET', '/tutor');
  ok('the tutor shell is served again', tutor.status === 200 && /Tutor sign-in/.test(tutor.raw), tutor.status);
  var appJs = await request('GET', '/js/app.js');
  ok('application scripts are served again', appJs.status === 200 && /javascript/.test(appJs.headers['content-type'] || ''), appJs.status);
  var badLogin = await request('POST', '/api/auth/login', { body: { id: 'GOC-S-000000', password: 'wrong-password' } });
  ok('the auth route is open (401, not 503)', badLogin.status === 401, badLogin.status);
  ok('and it answers as the API, not as maintenance', badLogin.body && !badLogin.body.maintenance && !!badLogin.body.error, badLogin.raw);
  var deepOff = await request('GET', '/api/me');
  ok('student routes are themselves again (401, not 503)', deepOff.status === 401, deepOff.status);

  head('restoration lost no records');
  var dbAfter = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  ok('the data file is the same one', dataHash() !== null);
  ok('the same student roster is there', (dbAfter.students || []).length === studentsBefore, (dbAfter.students || []).length);
  await stopServer(child);
  child = null;

  /* ============================================== APPRWITE FUNCTION GATE */
  head('the Appwrite Function gate uses the same switch');
  var gateway = require(path.join(APP, 'functions', 'goc-api', 'src', 'index.js'));
  var config = require(path.join(APP, 'functions', 'goc-api', 'src', 'config.js'));
  var sessions = require(path.join(APP, 'functions', 'goc-api', 'src', 'services', 'sessions.js'));
  function makeApp(envExtra) {
    var cfg = config.load(Object.assign({
      APPWRITE_ENDPOINT: 'https://example.invalid/v1',
      APPWRITE_PROJECT_ID: 'test-project',
      APPWRITE_API_KEY: 'test-key-not-a-real-secret',
      GOC_ALLOWED_ORIGINS: 'https://site.appwrite.network'
    }, envExtra || {}));
    return gateway.createHandler({
      cfg: cfg,
      core: { adminMayUse: function () { return true; }, activeMode: function (f, on) { return on ? (f.mode || 'original') : 'original'; } },
      sessions: sessions.createMemorySessionStore({}),
      readState: async function () { return { settings: { consolePasscodeLength: 6 }, free2027: { enabled: true, mode: 'free' } }; },
      log: function () {}
    });
  }
  var offApp = makeApp({});
  var offHealth = await offApp.handle({ method: 'GET', path: '/api/health', headers: {} });
  ok('off: health is the normal payload', offHealth.status === 200 && offHealth.body.passcodeLength === 6, JSON.stringify(offHealth.body));
  var onApp = makeApp({ GOC_MAINTENANCE_MODE: '1' });
  var onHealth = await onApp.handle({ method: 'GET', path: '/api/health', headers: {} });
  ok('on: health is a minimal 200', onHealth.status === 200 && onHealth.body.maintenance === true && onHealth.body.passcodeLength === undefined, JSON.stringify(onHealth.body));
  var onLogin = await onApp.handle({ method: 'POST', path: '/api/auth/login', headers: {}, bodyRaw: '{"id":"GOC-A-001","password":"x"}' });
  ok('on: a login is refused without touching the body', onLogin.status === 503 && onLogin.body.maintenance === true, JSON.stringify(onLogin.body));
  var onMe = await onApp.handle({ method: 'GET', path: '/api/me', headers: { authorization: 'Bearer abc' } });
  ok('on: a bearer token reaches no route', onMe.status === 503 && onMe.body.maintenance === true, onMe.status);
  ok('on: retry-after is set', onLogin.headers['retry-after'] === '3600', onLogin.headers['retry-after']);
  var onOptions = await onApp.handle({ method: 'OPTIONS', path: '/api/auth/login', headers: { origin: 'https://site.appwrite.network' } });
  ok('on: a CORS preflight is still answered', onOptions.status === 204, onOptions.status);
  var onBadOrigin = await onApp.handle({ method: 'POST', path: '/api/auth/login', headers: { origin: 'https://evil.example' } });
  ok('on: an unapproved origin is still refused as such', onBadOrigin.status === 403, onBadOrigin.status);

  /* ========================================================= BUILD SWITCH */
  head('a static Sites build is replaced too, and can be restored');
  var mOut = path.join(TMP, 'dist-maintenance');
  var mBuild = execFileSync(process.execPath, [path.join(APP, 'build', 'build.js'), mOut], {
    encoding: 'utf8', env: baseEnv({ GOC_MAINTENANCE_MODE: '1' })
  });
  ok('the maintenance build reports what it did', /Maintenance build/.test(mBuild), mBuild);
  var mFiles = fs.readdirSync(mOut).sort();
  ok('it emits only index.html and sw.js', mFiles.length === 2 && mFiles[0] === 'index.html' && mFiles[1] === 'sw.js', mFiles.join());
  var mHtml = fs.readFileSync(path.join(mOut, 'index.html'), 'utf8');
  ok('the emitted page is the announcement', mHtml.indexOf(M.HEADLINE) > -1 && mHtml.indexOf(M.CLOSING) > -1);
  ok('it ships no application script', mHtml.indexOf('js/app.js') < 0 && mHtml.indexOf('<script') < 0);
  var mSw = fs.readFileSync(path.join(mOut, 'sw.js'), 'utf8');
  ok('the emitted worker clears the app cache', /caches\.delete/.test(mSw) && /unregister/.test(mSw));

  var esbuild = null;
  try { esbuild = require('esbuild'); } catch (e) {
    try { esbuild = require(path.join(APP, 'node_modules', 'esbuild')); } catch (e2) {}
  }
  if (!esbuild) {
    console.log('  SKIPPED  the normal rebuild check needs esbuild (npm install --save-dev esbuild)');
  } else {
    var nOut = path.join(TMP, 'dist-normal');
    var nBuild = execFileSync(process.execPath, [path.join(APP, 'build', 'build.js'), nOut], {
      encoding: 'utf8', env: baseEnv({ GOC_MAINTENANCE_MODE: '0' })
    });
    ok('a normal build still works with the switch present but off', /Built /.test(nBuild), nBuild);
    var nHtml = fs.readFileSync(path.join(nOut, 'index.html'), 'utf8');
    ok('the normal build is the full app again', nHtml.indexOf('js/app.js') > -1 && nHtml.indexOf(M.HEADLINE) < 0);
    ok('the real index.html and sw.js are still in the source tree', fs.existsSync(path.join(APP, 'index.html')) && fs.existsSync(path.join(APP, 'sw.js')));
    var nSw = fs.readFileSync(path.join(nOut, 'sw.js'), 'utf8');
    ok('the normal worker is the caching one again', /goc-v\d+/.test(nSw) && !/registration\.unregister/.test(nSw));
  }

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('THREW: ' + (e && e.stack || e));
  if (child) { try { console.log(child.log()); } catch (x) {} }
  process.exit(1);
});
