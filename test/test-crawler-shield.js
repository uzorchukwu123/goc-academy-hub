/* test-crawler-shield.js — the public site is open to crawlers.

   The old "crawler shield" deliberately blocked AI training crawlers and
   search bots and marked every response noindex. That policy has been
   reversed: robots.txt allows everyone, no X-Robots-Tag is sent, no bot
   User-Agent is refused, and every public static file can be fetched
   individually. Private paths and APIs keep their normal protections.

   Spawns its own server on a spare port against a throwaway copy of the app.
   Run:  node test/test-crawler-shield.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_SHIELD_PORT) || 8152;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-crawl-test-'));
fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
['js', 'css', 'icons'].forEach(function (d) {
  var from = path.join(APP, d);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, d), { recursive: true });
});
['index.html', 'sw.js', 'manifest.webmanifest', 'robots.txt', 'sitemap.xml'].forEach(function (f) {
  var from = path.join(APP, f);
  if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
});
try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 180) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

function call(method, urlPath, ua) {
  return new Promise(function (resolve) {
    var headers = {};
    if (ua) headers['User-Agent'] = ua;
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: headers }, function (res) {
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
function hasNoindex(v) {
  return /noindex|nofollow|noarchive|nosnippet|noimageindex/i.test(String(v || ''));
}
function seq(items, fn) {
  return items.reduce(function (p, it) { return p.then(function () { return fn(it); }); }, Promise.resolve());
}

var CRAWLERS = ['GPTBot', 'OAI-SearchBot', 'ClaudeBot', 'anthropic-ai',
  'Google-Extended', 'CCBot', 'PerplexityBot', 'Bytespider', 'Amazonbot', 'Applebot-Extended'];

var PUBLIC_FILES = [
  ['/', 'the homepage', 'text/html'],
  ['/index.html', 'index.html', 'text/html'],
  ['/css/styles.css', 'the main stylesheet', 'text/css'],
  ['/css/free2027.css', 'the Free Tutorial stylesheet', 'text/css'],
  ['/js/app.js', 'the app script', 'javascript'],
  ['/js/goc-core.js', 'the shared rules script', 'javascript'],
  ['/js/api.js', 'the API client', 'javascript'],
  ['/js/pwa.js', 'the PWA script', 'javascript'],
  ['/sw.js', 'the service worker', 'javascript'],
  ['/manifest.webmanifest', 'the manifest', 'json'],
  ['/icons/icon-192.png', 'an icon', 'image/png']
];

head('the static deployment copy also allows everyone');
var staticRobots = fs.readFileSync(path.join(APP, 'robots.txt'), 'utf8');
ok('robots.txt exists at the site root', staticRobots.length > 0);
ok('  its wildcard group allows the whole site', /User-agent: \*\s*\nAllow: \//.test(staticRobots));
ok('  it contains no Disallow directive', !/^\s*Disallow:/m.test(staticRobots));
ok('  it points to the sitemap', /^Sitemap: https:\/\/gocacademy\.live\/sitemap\.xml$/m.test(staticRobots));
['GPTBot', 'ChatGPT-User', 'ClaudeBot', 'Google-Extended', 'PerplexityBot', 'CCBot', 'Applebot-Extended'].forEach(function (n) {
  ok('  the static copy explicitly allows ' + n, new RegExp('User-agent: ' + n + '\\s*\\nAllow: /').test(staticRobots));
});

head('the static deployment copy also lists every public file');
var staticSitemap = fs.readFileSync(path.join(APP, 'sitemap.xml'), 'utf8');
var staticLocs = (staticSitemap.match(/<loc>[^<]+<\/loc>/g) || []).map(function (m) {
  return m.slice(5, -6);
});
ok('sitemap.xml exists and is well formed enough to read', /^<\?xml/.test(staticSitemap) && /<urlset[^>]+>/.test(staticSitemap));
ok('  it lists at least the app shell', staticLocs.length >= 20, staticLocs.length);
ok('  every entry points at the public origin', staticLocs.every(function (u) { return /^https:\/\/gocacademy\.live\//.test(u); }), staticLocs.join(' '));
ok('  no private path is listed', staticLocs.every(function (u) {
  return !/\/(server|test)\//.test(u) && !/readme\.md|package\.json|\/api\//.test(u);
}), staticLocs.join(' '));

waitForBoot(100).then(function () {
  head('robots.txt allows everyone');
  return call('GET', '/robots.txt');
}).then(function (r) {
  ok('/robots.txt is served as plain text', r.status === 200 && /^text\/plain/.test(r.headers['content-type'] || ''), r.status + ' ' + r.headers['content-type']);
  ok('  the wildcard group allows the whole public site', /User-agent: \*\s*\nAllow: \/\s*(\n|$)/.test(r.raw), r.raw);
  ok('  nothing is disallowed', !/^\s*Disallow:/m.test(r.raw), r.raw);
  CRAWLERS.forEach(function (n) {
    ok('  ' + n + ' is explicitly allowed', new RegExp('User-agent: ' + n + '\\s*\\nAllow: /').test(r.raw));
  });
  ok('  robots.txt does not carry a noindex header', !hasNoindex(r.headers['x-robots-tag']), r.headers['x-robots-tag']);
  ok('  robots.txt points crawlers at the sitemap', /^Sitemap: https:\/\/gocacademy\.live\/sitemap\.xml$/m.test(r.raw), r.raw);
  return call('HEAD', '/robots.txt');
}).then(function (r) {
  ok('HEAD /robots.txt answers 200 with no body', r.status === 200 && r.raw === '', r.status);
  return call('POST', '/robots.txt');
}).then(function (r) {
  ok('POST /robots.txt is refused (405)', r.status === 405, r.status);

  head('no response is marked noindex');
  var paths = [
    ['/', 'the home page'],
    ['/index.html', 'index.html'],
    ['/js/app.js', 'a script'],
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
  return seq(paths, function (item) {
    return call('GET', item[0]).then(function (r) {
      ok(item[1] + ' is not noindex', !hasNoindex(r.headers['x-robots-tag']), r.status + ' ' + r.headers['x-robots-tag']);
    });
  });
}).then(function () {
  return call('POST', '/api/login');
}).then(function (r) {
  ok('a POST to the API is not noindex', !hasNoindex(r.headers['x-robots-tag']), r.headers['x-robots-tag']);
  return call('PUT', '/index.html');
}).then(function (r) {
  ok('a refused method (405) is not noindex', r.status === 405 && !hasNoindex(r.headers['x-robots-tag']), r.status);

  head('sitemap.xml names each public file');
  return call('GET', '/sitemap.xml');
}).then(function (r) {
  ok('/sitemap.xml is served as XML', r.status === 200 && /xml/.test(r.headers['content-type'] || ''), r.status + ' ' + r.headers['content-type']);
  var locs = (r.raw.match(/<loc>[^<]+<\/loc>/g) || []).map(function (m) { return m.slice(5, -6); });
  ok('  it lists the public files', locs.length >= 20, locs.length);
  var have = {};
  locs.forEach(function (u) { try { have[new URL(u).pathname] = true; } catch (e) {} });
  PUBLIC_FILES.forEach(function (item) {
    ok('  ' + item[0] + ' is listed', !!have[item[0]], Object.keys(have).join(' '));
  });
  return seq(locs, function (u) {
    var p = new URL(u).pathname;
    return call('GET', p).then(function (g) {
      ok('  listed ' + p + ' opens without authentication', g.status === 200 && g.raw.length > 0, g.status + ' bytes=' + g.raw.length);
    });
  });

  head('public files can be fetched one by one');
  return seq(PUBLIC_FILES, function (item) {
    return call('GET', item[0]).then(function (r) {
      ok(item[1] + ' (' + item[0] + ') is crawlable',
        r.status === 200 && String(r.headers['content-type'] || '').indexOf(item[2]) >= 0
        && r.raw.length > 0, r.status + ' ' + r.headers['content-type'] + ' bytes=' + r.raw.length);
    });
  });
}).then(function () {
  head('private and unknown files remain private');
  return seq([
    ['/server/data.json', 'the database'],
    ['/server/server.js', 'the server source'],
    ['/test/run.js', 'the test runner'],
    ['/readme.md', 'a non-public document'],
    ['/package.json', 'a non-public manifest']
  ], function (item) {
    return call('GET', item[0]).then(function (r) {
      ok(item[1] + ' is not served', r.status === 404 && !/GOC|password|student/i.test(r.raw), r.status);
    });
  });
}).then(function () {
  return call('GET', '/api/me');
}).then(function (r) {
  ok('a signed-out API route still refuses access', r.status === 401, r.status);

  head('the page itself');
  return call('GET', '/');
}).then(function (r) {
  var m = /<meta\s+name="robots"\s+content="([^"]*)"/i.exec(r.raw);
  ok('index.html carries no noindex robots <meta> tag', !m || !/noindex|nofollow/i.test(m[1]), m && m[1]);
  ok('  it carries a description and Open Graph preview', /<meta\s+name="description"/i.test(r.raw) && /<meta\s+property="og:title"/i.test(r.raw));
  ok('  the page still serves normally', r.status === 200 && r.headers['content-type'].indexOf('text/html') === 0);
  ok('  it is framed only by its own origin (X-Frame-Options)', r.headers['x-frame-options'] === 'SAMEORIGIN', r.headers['x-frame-options']);
  return call('GET', '/api/health');
}).then(function (r) {
  var body = {};
  try { body = JSON.parse(r.raw); } catch (e) {}
  ok('health names no filesystem path or storage identifier', r.status === 200 && body.free2027 && body.free2027.storageFile === undefined && body.free2027.archiveDir === undefined && !/[/\\]/.test(String(body.free2027.storage || '')), r.raw);
}).then(function () {
  stop();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'crawler access: all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  stop();
  console.log('  FAIL  ' + (e && e.message || e));
  process.exit(1);
});
