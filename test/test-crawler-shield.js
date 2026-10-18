/* test-crawler-shield.js — Phase 3D slice 1: tell crawlers no.

   Spawns its own server on a spare port against a throwaway copy of the app,
   then proves that:
     1. /robots.txt disallows everything and names the known AI crawlers
     2. there is no sitemap
     3. EVERY kind of response carries X-Robots-Tag: pages, scripts, styles,
        the service worker, the manifest, images, 404s, and the API
     4. index.html carries the same instruction as a <meta> tag
   No dependencies.  Run:  node test/test-crawler-shield.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_SHIELD_PORT) || 8152;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-shield-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
['js', 'css', 'icons'].forEach(function (d) {
  var from = path.join(APP, d);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, d), { recursive: true });
});
['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 140) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, urlPath) {
  return new Promise(function (resolve) {
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, raw: raw }); });
    });
    req.on('error', function (e) { resolve({ status: 0, headers: {}, raw: String(e && e.message), err: true }); });
    req.end();
  });
}

var serverLog = '';
var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
  cwd: SANDBOX,
  env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules') }),
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

var NEEDED = ['noindex', 'nofollow', 'noarchive', 'noimageindex'];
function hasAll(v) {
  v = String(v || '').toLowerCase();
  return NEEDED.every(function (w) { return v.indexOf(w) >= 0; });
}

var CRAWLERS = ['GPTBot', 'ChatGPT-User', 'OAI-SearchBot', 'ClaudeBot', 'Claude-Web', 'anthropic-ai',
  'Google-Extended', 'CCBot', 'PerplexityBot', 'Bytespider', 'Amazonbot', 'Applebot-Extended'];

waitForBoot(100).then(function () {
  head('robots.txt');
  return call('GET', '/robots.txt');
}).then(function (r) {
  ok('/robots.txt is served as plain text', r.status === 200 && /^text\/plain/.test(r.headers['content-type'] || ''), r.status + ' ' + r.headers['content-type']);
  ok('  it disallows everything for every crawler', /User-agent: \*\s*\nDisallow: \/\s*(\n|$)/.test(r.raw));
  CRAWLERS.forEach(function (n) {
    ok('  it names ' + n + ' and bars it', new RegExp('User-agent: ' + n + '\\s*\\nDisallow: /').test(r.raw));
  });
  ok('  it offers no Allow rule', !/^\s*Allow:/mi.test(r.raw));
  ok('  it points to no sitemap', !/sitemap/i.test(r.raw));
  ok('  /robots.txt itself carries X-Robots-Tag', hasAll(r.headers['x-robots-tag']), r.headers['x-robots-tag']);
  return call('HEAD', '/robots.txt');
}).then(function (r) {
  ok('HEAD /robots.txt answers 200 with no body', r.status === 200 && r.raw === '', r.status);
  return call('POST', '/robots.txt');
}).then(function (r) {
  ok('POST /robots.txt is refused (405)', r.status === 405, r.status);
  return call('GET', '/sitemap.xml');
}).then(function (r) {
  ok('there is no /sitemap.xml', r.status === 404, r.status);

  head('X-Robots-Tag on every kind of response');
  var paths = [
    ['/', 'the home page'],
    ['/index.html', 'index.html'],
    ['/js/app.js', 'a script'],
    ['/js/goc-core.js', 'the shared rules script'],
    ['/css/styles.css', 'the stylesheet'],
    ['/sw.js', 'the service worker'],
    ['/manifest.webmanifest', 'the manifest'],
    ['/icons/icon-192.png', 'an icon'],
    ['/readme.md', 'a refused file type (404)'],
    ['/server/data.json', 'a refused folder (404)'],
    ['/nope.html', 'a missing page (404)'],
    ['/%zz', 'a malformed address (400)'],
    ['/api/health', 'the API health check'],
    ['/api/nope', 'an unknown API route (404)'],
    ['/api/me', 'a signed-out API route (401)']
  ];
  return paths.reduce(function (p, item) {
    return p.then(function () {
      return call('GET', item[0]).then(function (r) {
        ok(item[1] + ' (' + item[0] + ') carries it', hasAll(r.headers['x-robots-tag']), r.status + ' ' + r.headers['x-robots-tag']);
      });
    });
  }, Promise.resolve());
}).then(function () {
  return call('POST', '/api/login');
}).then(function (r) {
  ok('a POST to the API carries it too', hasAll(r.headers['x-robots-tag']), r.status + ' ' + r.headers['x-robots-tag']);
  return call('PUT', '/index.html');
}).then(function (r) {
  ok('a refused method (405) carries it', r.status === 405 && hasAll(r.headers['x-robots-tag']), r.status);

  head('the page itself');
  return call('GET', '/');
}).then(function (r) {
  var m = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(r.raw);
  ok('index.html has a robots <meta> tag', !!m);
  ok('  it says noindex, nofollow, noarchive, noimageindex', !!m && hasAll(m[1]), m && m[1]);
  ok('  the page still serves normally', r.status === 200 && r.headers['content-type'].indexOf('text/html') === 0);
}).then(function () {
  stop();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'crawler shield: all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  stop();
  console.log('  FAIL  ' + (e && e.message || e));
  process.exit(1);
});
