/* test-crawler-refusal.js — Phase 3D slice 2: turn crawlers away.

   Real server on a spare port, throwaway copy of the app. Proves that:
     1. a request naming a known AI crawler / search bot / scraper gets 403
        (pages, scripts and the API alike), with nothing of the app in the body
     2. robots.txt stays readable to them, so a polite crawler can obey it
     3. ordinary browsers and a client with no User-Agent are untouched
        (including the Go-http-client that hosting health checks use)
     4. static files are rate-limited per IP (429 + Retry-After), while the API
        and robots.txt stay reachable
   No dependencies.  Run:  node test/test-crawler-refusal.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var spawn = require('child_process').spawn;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_REFUSE_PORT) || 8153;
var LIMIT = 60;

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-refuse-test-'));
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
  env: Object.assign({}, process.env, {
    PORT: String(PORT), GOC_STATIC_RATE_MAX: String(LIMIT), NODE_PATH: path.join(APP, 'node_modules')
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
function seq(items, fn) {
  return items.reduce(function (p, it) { return p.then(function () { return fn(it); }); }, Promise.resolve());
}

var BOTS = [
  ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)', 'GPTBot'],
  ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)', 'ClaudeBot'],
  ['anthropic-ai', 'anthropic-ai'],
  ['CCBot/2.0 (https://commoncrawl.org/faq/)', 'CCBot'],
  ['Mozilla/5.0 (compatible; PerplexityBot/1.0)', 'PerplexityBot'],
  ['Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)', 'Bytespider'],
  ['Mozilla/5.0 (compatible; Amazonbot/0.1)', 'Amazonbot'],
  ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'Googlebot'],
  ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)', 'bingbot'],
  ['Mozilla/5.0 (compatible; AhrefsBot/7.0; +http://ahrefs.com/robot/)', 'AhrefsBot'],
  ['Scrapy/2.11 (+https://scrapy.org)', 'Scrapy'],
  ['python-requests/2.31.0', 'python-requests'],
  ['gptbot', 'lower-case gptbot']
];
var HUMANS = [
  ['Mozilla/5.0 (Linux; Android 13; Tecno KF6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36', 'Chrome on Android'],
  ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1', 'Safari on iPhone'],
  ['Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0', 'Firefox'],
  ['Go-http-client/2.0', 'a hosting health check (Go-http-client)'],
  [null, 'a client with no User-Agent']
];

waitForBoot(100).then(function () {
  head('known crawlers are refused');
  return seq(BOTS, function (b) {
    return call('GET', '/', b[0]).then(function (r) {
      ok(b[1] + ' gets 403 on /', r.status === 403, r.status);
      ok('  and no part of the app went out', r.raw.indexOf('<') < 0 && r.raw.indexOf('GOC') < 0);
    });
  });
}).then(function () {
  return call('GET', '/js/app.js', BOTS[0][0]);
}).then(function (r) {
  ok('a crawler cannot fetch the app script either', r.status === 403 && r.raw.length < 40, r.status);
  return call('GET', '/api/health', BOTS[1][0]);
}).then(function (r) {
  ok('a crawler is refused on the API too', r.status === 403, r.status);
  ok('  the refusal still says noindex', /noindex/.test(r.headers['x-robots-tag'] || ''));
  return call('GET', '/sw.js', BOTS[7][0]);
}).then(function (r) {
  ok('a search-engine bot cannot fetch the service worker', r.status === 403, r.status);
  return call('GET', '/robots.txt', BOTS[0][0]);
}).then(function (r) {
  ok('robots.txt stays readable to a crawler (so it can obey)', r.status === 200 && /Disallow: \//.test(r.raw), r.status);

  head('people and tools that must keep working');
  return seq(HUMANS, function (h) {
    return call('GET', '/', h[0]).then(function (r) {
      ok(h[1] + ' still gets the app', r.status === 200 && r.raw.indexOf('<html') >= 0, r.status);
    });
  });
}).then(function () {
  return call('GET', '/api/health', 'Go-http-client/2.0');
}).then(function (r) {
  ok('the health check still passes for Go-http-client', r.status === 200, r.status);

  head('static files are rate-limited per IP');
  var codes = [], retry = null, i = 0;
  function burst() {
    if (i >= LIMIT + 40) return Promise.resolve();
    i++;
    return call('GET', '/css/styles.css', HUMANS[0][0]).then(function (r) {
      codes.push(r.status);
      if (r.status === 429 && !retry) retry = r.headers['retry-after'];
      return burst();
    });
  }
  return burst().then(function () {
    var first429 = codes.indexOf(429);
    ok('a burst of static requests eventually gets 429', first429 > 0, 'first 429 at ' + first429);
    ok('  the early ones were served normally', codes.slice(0, 10).every(function (c) { return c === 200; }));
    ok('  the 429 tells the client when to retry', retry === '60', retry);
    ok('  once limited, it stays limited for the window', codes.slice(first429).every(function (c) { return c === 429; }));
    return call('GET', '/api/health', HUMANS[0][0]);
  });
}).then(function (r) {
  ok('the API is not caught by the static limit', r.status === 200, r.status);
  return call('GET', '/robots.txt', HUMANS[0][0]);
}).then(function (r) {
  ok('robots.txt is not caught by it either', r.status === 200, r.status);
  return call('GET', '/', HUMANS[0][0]);
}).then(function (r) {
  ok('the limited response carries X-Robots-Tag', r.status === 429 && /noindex/.test(r.headers['x-robots-tag'] || ''), r.status);
}).then(function () {
  stop();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'crawler refusal: all checks passed'));
  process.exit(fails ? 1 : 0);
}).catch(function (e) {
  stop();
  console.log('  FAIL  ' + (e && e.message || e));
  process.exit(1);
});
