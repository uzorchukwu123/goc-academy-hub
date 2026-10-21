/* test-build.js — Phase 3D slice 3: the production build.
   Builds the app into a throwaway folder and proves that:
     1. the built scripts still parse, are smaller, and carry no comments or test-only hooks
     2. the shared rules (goc-core.js) behave the same built as in source
     3. every file the service worker caches is in the build
     4. the readable source is untouched
     5. the server serves the built files when GOC_PUBLIC_DIR is set, and still refuses server/ and test/
   Needs esbuild (npm install --save-dev esbuild); without it the suite says so and stops.
   Run:  node test/test-build.js  */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var vm = require('vm');
var http = require('http');
var spawn = require('child_process').spawn;
var execFileSync = require('child_process').execFileSync;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_BUILD_PORT) || 8153;

try { require('esbuild'); } catch (e) {
  try { require(path.join(APP, 'node_modules', 'esbuild')); } catch (e2) {
    console.log('  SKIPPED  esbuild is not installed (npm install --save-dev esbuild); build checks did not run');
    process.exit(0);
  }
}

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 160) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-build-test-'));
var OUT = path.join(SANDBOX, 'dist');
function src(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
function built(f) { return fs.readFileSync(path.join(OUT, f), 'utf8'); }

head('the build runs');
var srcBefore = ['js/api.js', 'js/app.js', 'js/goc-core.js', 'sw.js'].map(src);
var out = '';
try { out = execFileSync(process.execPath, [path.join(APP, 'build', 'build.js'), OUT], { encoding: 'utf8', env: process.env }); } catch (e) { out = 'ERR ' + e.message; }
ok('build.js finishes and reports sizes', /Built .* bytes/.test(out), out);

head('the built scripts');
['js/goc-core.js', 'js/api.js', 'js/app.js', 'js/pwa.js', 'sw.js'].forEach(function (f) {
  var b = built(f), s = src(f);
  var parses = true; try { new vm.Script(b); } catch (e) { parses = false; }
  ok(f + ' still parses', parses);
  ok(f + ' is smaller than the source', b.length < s.length * 0.9, b.length + ' vs ' + s.length);
  ok(f + ' carries no /* block comment */', !/\/\*[\s\S]*?\*\//.test(b.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, '')));
});
ok('the test-only hooks are gone from the built api.js', built('js/api.js').indexOf('_setJambReadyMin') < 0 && built('js/api.js').indexOf('_setTier') < 0);
ok('the production-needed _setPasscodeLength is kept', built('js/api.js').indexOf('_setPasscodeLength') > -1);
ok('the hooks are still in the readable source (tests use them)', src('js/api.js').indexOf('_setJambReadyMin') > -1);
ok('sw.js keeps its cache name', /goc-v\d+/.exec(built('sw.js')) && /goc-v\d+/.exec(built('sw.js'))[0] === /goc-v\d+/.exec(src('sw.js'))[0]);
ok('the built page has no HTML comments', built('index.html').indexOf('<!--') < 0);
ok('the built page still names the four scripts',
   ['js/goc-core.js', 'js/api.js', 'js/app.js', 'js/pwa.js'].every(function (f) { return built('index.html').indexOf('src="' + f + '"') > -1; }));
ok('the built stylesheet is smaller', built('css/styles.css').length < src('css/styles.css').length * 0.95);

head('the shared rules behave the same built');
function loadCore(code) {
  var win = {};
  var ctx = vm.createContext({ window: win, console: console });
  vm.runInContext(code, ctx);
  return win.GOC && win.GOC.core;
}
var a = loadCore(src('js/goc-core.js')), b = loadCore(built('js/goc-core.js'));
ok('goc-core loads in both forms', !!a && !!b);
if (a && b) {
  var ka = Object.keys(a).sort(), kb = Object.keys(b).sort();
  ok('the same ' + ka.length + ' public names are exported', ka.join() === kb.join());
  var probes = 0, same = 0;
  ka.forEach(function (k) {
    if (typeof a[k] !== 'function' || /^(now|today|random|uid|makeId)/i.test(k)) return;
    [[], [''], ['Chemistry'], [{}], [[]], [5]].forEach(function (args) {
      var ra, rb;
      try { ra = JSON.stringify(a[k].apply(null, JSON.parse(JSON.stringify(args)))); } catch (e) { ra = 'throws'; }
      try { rb = JSON.stringify(b[k].apply(null, JSON.parse(JSON.stringify(args)))); } catch (e) { rb = 'throws'; }
      if (k === 'makeApplication') {
          try {
            var va = JSON.parse(ra);
            if (va && typeof va === 'object' && 'submittedAt' in va) {
              va.submittedAt = '<generated timestamp>';
              ra = JSON.stringify(va);
            }
          } catch (e) {}
          try {
            var vb = JSON.parse(rb);
            if (vb && typeof vb === 'object' && 'submittedAt' in vb) {
              vb.submittedAt = '<generated timestamp>';
              rb = JSON.stringify(vb);
            }
          } catch (e) {}
        }
        if (k === 'srAfterAnswer') {
        try {
          var va = JSON.parse(ra);
          if (va && typeof va === 'object') {
            ['due', 'last'].forEach(function (field) {
              if (field in va) va[field] = '<generated timestamp>';
            });
            ra = JSON.stringify(va);
          }
        } catch (e) {}
        try {
          var vb = JSON.parse(rb);
          if (vb && typeof vb === 'object') {
            ['due', 'last'].forEach(function (field) {
              if (field in vb) vb[field] = '<generated timestamp>';
            });
            rb = JSON.stringify(vb);
          }
        } catch (e) {}
      }
      if (k === 'makeFlagAlert') {
        try {
          var va = JSON.parse(ra);
          if (va && typeof va === 'object' && 'at' in va) {
            va.at = '<generated timestamp>';
            ra = JSON.stringify(va);
          }
        } catch (e) {}
        try {
          var vb = JSON.parse(rb);
          if (vb && typeof vb === 'object' && 'at' in vb) {
            vb.at = '<generated timestamp>';
            rb = JSON.stringify(vb);
          }
        } catch (e) {}
      }
      probes++; if (ra === rb) same++;
    });
  });
  ok('every rule gave the same answer on ' + probes + ' probe calls', probes > 100 && same === probes, same + ' of ' + probes);
}

head('the service worker list');
var list = (built('sw.js').match(/ASSETS=\[([\s\S]*?)\]/) || [, ''])[1];
var files = (list.match(/"\.\/[^"]+"/g) || []).map(function (q) { return q.slice(3, -1); });
ok('the built sw.js lists its files', files.length >= 8, files.length);
ok('every listed file exists in the build', files.every(function (f) { return fs.existsSync(path.join(OUT, f)); }),
   files.filter(function (f) { return !fs.existsSync(path.join(OUT, f)); }).join());

head('the source is untouched');
['js/api.js', 'js/app.js', 'js/goc-core.js', 'sw.js'].forEach(function (f, i) {
  ok(f + ' is unchanged by the build', src(f) === srcBefore[i]);
});

head('the server serves the build');
var APPDIR = path.join(SANDBOX, 'app');
fs.mkdirSync(APPDIR, { recursive: true });
fs.cpSync(path.join(APP, 'server'), path.join(APPDIR, 'server'), { recursive: true });
try { fs.rmSync(path.join(APPDIR, 'server', 'data.json'), { force: true }); } catch (e) {}
fs.renameSync(OUT, path.join(APPDIR, 'dist'));
// The server itself loads the shared rules from js/goc-core.js, so that one source file sits beside it;
// the static route must never serve it, because with GOC_PUBLIC_DIR only dist/ answers.
fs.mkdirSync(path.join(APPDIR, 'js'), { recursive: true });
fs.copyFileSync(path.join(APP, 'js', 'goc-core.js'), path.join(APPDIR, 'js', 'goc-core.js'));
function call(urlPath) {
  return new Promise(function (resolve) {
    http.get({ host: '127.0.0.1', port: PORT, path: urlPath }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { resolve({ status: res.statusCode, raw: raw }); });
    }).on('error', function (e) { resolve({ status: 0, raw: String(e.message) }); });
  });
}
var log = '';
var child = spawn(process.execPath, [path.join(APPDIR, 'server', 'server.js')], {
  cwd: APPDIR,
  env: Object.assign({}, process.env, { PORT: String(PORT), GOC_PUBLIC_DIR: 'dist', NODE_PATH: path.join(APP, 'node_modules') }),
  stdio: ['ignore', 'pipe', 'pipe']
});
child.stdout.on('data', function (c) { log += c; });
child.stderr.on('data', function (c) { log += c; });
function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
function boot(n) {
  return call('/api/health').then(function (r) {
    if (r.status === 200) return;
    if (n <= 0) throw new Error('server did not start\n' + log);
    return new Promise(function (r2) { setTimeout(r2, 100); }).then(function () { return boot(n - 1); });
  });
}
var distDir = path.join(APPDIR, 'dist');
boot(100).then(function () { return call('/js/app.js'); }).then(function (r) {
  ok('/js/app.js is the built file', r.status === 200 && r.raw === fs.readFileSync(path.join(distDir, 'js/app.js'), 'utf8'), r.status);
  return call('/');
}).then(function (r) {
  ok('/ is the built page', r.status === 200 && r.raw.indexOf('<!--') < 0 && r.raw.indexOf('js/app.js') > -1, r.status);
  return call('/js/goc-core.js');
}).then(function (r) {
  ok('/js/goc-core.js is the built file, not the readable one the server loads', r.status === 200 && r.raw === fs.readFileSync(path.join(distDir, 'js/goc-core.js'), 'utf8') && r.raw !== fs.readFileSync(path.join(APPDIR, 'js/goc-core.js'), 'utf8'), r.status);
  return call('/sw.js');
}).then(function (r) {
  ok('/sw.js is served from the build', r.status === 200 && r.raw.indexOf('/*') < 0, r.status);
  return call('/server/server.js');
}).then(function (r) {
  ok('server code is still refused', r.status === 404, r.status);
  return call('/../server/data.json');
}).then(function (r) {
  ok('a path escape out of dist is refused', r.status === 403 || r.status === 404, r.status);
  return call('/api/health');
}).then(function (r) {
  ok('the API still answers', r.status === 200, r.status);
}).catch(function (e) {
  fails++; console.log('  FAIL  ' + e.message);
}).then(function () {
  stop();
  console.log('\n' + (fails ? 'build: ' + fails + ' check(s) failed' : 'build: all checks passed'));
  process.exit(fails ? 1 : 0);
});
