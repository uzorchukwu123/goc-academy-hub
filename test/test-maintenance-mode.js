/* test-maintenance-mode.js — the temporary full-platform announcement gate.
   Starts the real server twice against a throwaway data directory: once with
   GOC_MAINTENANCE_MODE=1 and once with it off. Checks that maintenance hides
   every page and API, that the page is served as HTTP 200 (so OneBit does not
   replace it with its own 503 wake screen), that the kill-switch worker is
   served, and that turning the switch off restores the application without
   touching the data file. No dependencies; run: node test/test-maintenance-mode.js */
'use strict';
var http = require('http');
var net = require('net');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var M = require(path.join(APP, 'server', 'lib', 'maintenance.js'));

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-maintenance-test-'));
var DATA_DIR = path.join(SANDBOX, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
var PORT = 0;
var child = null;
var serverLog = '';

function freePort() {
  return new Promise(function (resolve, reject) {
    var s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', function () {
      var p = s.address().port;
      s.close(function () { resolve(p); });
    });
  });
}

function request(method, urlPath, options) {
  options = options || {};
  var body = options.body === undefined ? null : JSON.stringify(options.body);
  var headers = Object.assign({ Accept: '*/*' }, options.headers || {});
  if (body !== null) {
    headers['Content-Type'] = 'application/json';
    headers['Content-Length'] = Buffer.byteLength(body);
  }
  return new Promise(function (resolve, reject) {
    var req = http.request({ host: '127.0.0.1', port: PORT, path: urlPath, method: method, headers: headers }, function (res) {
      var chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        var raw = Buffer.concat(chunks).toString('utf8');
        var json = null;
        try { json = JSON.parse(raw); } catch (e) { /* not JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, raw: raw, body: json });
      });
    });
    req.on('error', reject);
    if (body !== null) req.write(body);
    req.end();
  });
}

function start(mode) {
  child = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], {
    cwd: APP,
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      GOC_DATA_DIR: DATA_DIR,
      GOC_MAINTENANCE_MODE: mode,
      GOC_FOUNDER_PW: 'founder2027',
      GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027',
      GOC_SIGNUP_CODE: 'GOC2027',
      GOC_JAMB_READY_MIN: '1'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (c) { serverLog += c; });
  child.stderr.on('data', function (c) { serverLog += c; });
  return waitForBoot(80);
}

function waitForBoot(tries) {
  return request('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw new Error('server did not boot: ' + e.message + '\n' + serverLog);
    return new Promise(function (r) { setTimeout(r, 125); }).then(function () { return waitForBoot(tries - 1); });
  });
}

function stop() {
  if (!child) return Promise.resolve();
  var c = child;
  child = null;
  return new Promise(function (resolve) {
    var done = false;
    function finish() { if (!done) { done = true; resolve(); } }
    c.once('exit', finish);
    try { c.kill(); } catch (e) { finish(); }
    setTimeout(finish, 2500);
  });
}

function sha(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function isPage(r) {
  return r.status === 200 &&
    /text\/html/.test(r.headers['content-type'] || '') &&
    r.raw.indexOf('<h1 id="maintenanceTitle">' + M.HEADLINE + '</h1>') > -1 &&
    r.raw.indexOf(M.OPENING) > -1 &&
    r.raw.indexOf(M.CLOSING) > -1;
}

(async function () {
  PORT = await freePort();

  head('the switch itself');
  ['1', 'true', 'on', 'yes', 'TRUE', ' On ', 'YES'].forEach(function (v) {
    ok('enabled: ' + JSON.stringify(v), M.enabled({ GOC_MAINTENANCE_MODE: v }) === true);
  });
  ['', '0', 'false', 'off', 'no', 'maintenance', null, undefined].forEach(function (v) {
    ok('off: ' + JSON.stringify(v), M.enabled({ GOC_MAINTENANCE_MODE: v }) === false);
  });

  head('the announcement page is self-contained');
  var page = M.page();
  ok('it is a full HTML document', /^<!DOCTYPE html>/i.test(page) && /<\/html>\s*$/i.test(page));
  ok('the exact headline is present', page.indexOf('<h1 id="maintenanceTitle">' + M.HEADLINE + '</h1>') > -1);
  ok('it explains the improvements', page.indexOf(M.OPENING) > -1 && page.indexOf(M.UNDERWAY) > -1);
  ok('it thanks and reassures the visitor', page.indexOf(M.THANKS) > -1 && page.indexOf(M.CLOSING) > -1);
  ok('it draws its own illustration', (page.match(/<svg\b/g) || []).length >= 1);
  ok('it loads no script', !/<script\b/i.test(page));
  ok('it loads no image, stylesheet, font or frame', !/<(?:img|link|iframe|object|embed)\b/i.test(page));
  ok('it has no external URL', !/(?:src|href)\s*=\s*["']https?:/i.test(page) && !/url\(\s*['"]?https?:/i.test(page));
  ok('it never names the app behind it', page.indexOf('js/app.js') < 0 && page.indexOf('goc-v') < 0);
  ok('it is a real, substantial page', page.length > 9000);

  head('switched on: the whole application is closed');
  var onBoot = await start('1');
  ok('health answers during maintenance', onBoot.status === 200);
  ok('health exposes only the maintenance fact',
    onBoot.body && onBoot.body.service === 'goc-academy-hub' && onBoot.body.version === 1 &&
    onBoot.body.maintenance === true && onBoot.body.passcodeLength === undefined && onBoot.body.free2027 === undefined);
  var dataBefore = sha(path.join(DATA_DIR, 'data.json'));

  var home = await request('GET', '/');
  ok('GET / is the announcement page', isPage(home), home.status + ' ' + (home.headers['content-type'] || ''));
  ok('GET / is HTTP 200, not 503', home.status === 200, home.status);
  ok('GET / cannot be cached', /no-store/.test(home.headers['cache-control'] || ''));
  ok('GET / is noindex', /noindex/.test(home.headers['x-robots-tag'] || ''));
  ok('GET / has a strict CSP', /default-src 'none'/.test(home.headers['content-security-policy'] || ''));
  ok('GET / advertises a retry', home.headers['retry-after'] === '3600', home.headers['retry-after']);

  for (var i = 0; i < ['/tutor', '/index.html', '/setup/aaaaaaaaaaaaaaaa', '/free2027', '/does-not-exist', '/js/app.js', '/css/app.css'].length; i++) {
    var p = ['/tutor', '/index.html', '/setup/aaaaaaaaaaaaaaaa', '/free2027', '/does-not-exist', '/js/app.js', '/css/app.css'][i];
    var r = await request('GET', p);
    ok('GET ' + p + ' is the announcement, not the app', isPage(r), r.status + ' ' + (r.headers['content-type'] || ''));
  }

  var headHome = await request('HEAD', '/');
  ok('HEAD / is 200 with no body', headHome.status === 200 && headHome.raw === '', headHome.status + ' bytes=' + headHome.raw.length);

  var robots = await request('GET', '/robots.txt');
  ok('robots.txt disallows everything', robots.status === 200 && robots.raw === 'User-agent: *\nDisallow: /\n');

  var sw = await request('GET', '/sw.js');
  ok('sw.js is the kill-switch worker', sw.status === 200 && /text\/javascript/.test(sw.headers['content-type'] || '') &&
    sw.raw.indexOf('unregister') > -1 && sw.raw.indexOf('caches.keys') > -1);

  var health = await request('GET', '/api/health');
  ok('GET /api/health is minimal 200 JSON', health.status === 200 && health.body.maintenance === true &&
    Object.keys(health.body).sort().join(',') === 'maintenance,service,version');
  var headHealth = await request('HEAD', '/api/health');
  ok('HEAD /api/health is 200 with no body', headHealth.status === 200 && headHealth.raw === '');
  var postHealth = await request('POST', '/api/health');
  ok('POST /api/health is refused', postHealth.status === 405, postHealth.status);

  var me = await request('GET', '/api/me', { headers: { Authorization: 'Bearer not-a-real-token' } });
  ok('a bearer token cannot open /api/me', me.status === 503 && me.body && me.body.maintenance === true, me.status);
  var login = await request('POST', '/api/tutor/login', { body: { id: 'GOC-T-001', password: 'x' } });
  ok('tutor sign-in is refused before the body is read', login.status === 503 && login.body && login.body.maintenance === true, login.status);
  var tutorApp = await request('GET', '/api/tutor/app');
  ok('/api/tutor/app is closed', tutorApp.status === 503 && tutorApp.body && tutorApp.body.maintenance === true);
  var postPage = await request('POST', '/');
  ok('POST to a page URL is refused, not served the app', postPage.status === 503 && postPage.body && postPage.body.maintenance === true);
  var unknownApi = await request('GET', '/api/nothing');
  ok('an unknown API route is refused', unknownApi.status === 503 && unknownApi.body && unknownApi.body.maintenance === true);

  var dataAfter = sha(path.join(DATA_DIR, 'data.json'));
  ok('maintenance touched no stored record', dataBefore === dataAfter);

  head('switched off: the normal application returns');
  await stop();
  var offBoot = await start('0');
  ok('health answers normally', offBoot.status === 200 && !offBoot.body.maintenance &&
    typeof offBoot.body.passcodeLength === 'number' && offBoot.body.free2027 !== undefined);
  var normalHome = await request('GET', '/');
  ok('GET / is the normal app', normalHome.status === 200 && /text\/html/.test(normalHome.headers['content-type'] || '') &&
    normalHome.raw.indexOf('js/app.js') > -1 && normalHome.raw.indexOf('maintenanceTitle') < 0);
  ok('the headline is gone', normalHome.raw.indexOf(M.HEADLINE) < 0);
  var normalRobots = await request('GET', '/robots.txt');
  ok('robots.txt is back to normal', normalRobots.status === 200 &&
    normalRobots.raw.indexOf('Allow: /') > -1 && normalRobots.raw !== 'User-agent: *\nDisallow: /\n');
  var normalSw = await request('GET', '/sw.js');
  ok('sw.js is the normal caching worker', normalSw.status === 200 && normalSw.raw.indexOf('goc-v') > -1 &&
    normalSw.raw.indexOf('unregister') < 0);
  var normalMe = await request('GET', '/api/me');
  ok('/api/me is back to its normal 401', normalMe.status === 401, normalMe.status);
  var dataOffStart = sha(path.join(DATA_DIR, 'data.json'));
  await request('GET', '/');
  await request('GET', '/api/health');
  var dataOffEnd = sha(path.join(DATA_DIR, 'data.json'));
  ok('reading the normal app touched no stored record', dataOffStart === dataOffEnd);

  await stop();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})().catch(async function (e) {
  console.error('\nFAILED: ' + (e && e.stack || e));
  await stop();
  try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e2) {}
  process.exit(1);
});
