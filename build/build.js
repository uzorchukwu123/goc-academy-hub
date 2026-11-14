/* build/build.js — Phase 3D slice 3: make the code hard to read.
   Builds a production copy of the public app into dist/ (or the folder given):
     - JavaScript and CSS are minified, comments removed, local names shortened
     - the demo driver's test-only hooks (_setJambReadyMin) are removed
     - HTML comments are removed from index.html
     - sw.js keeps its cache name; every file it lists is checked to exist in the build
   The readable source in js/ css/ stays untouched and private. Tests keep running on it.
   Top-level names are NOT renamed: the scripts share globals (GOC, the app's functions),
   so renaming them would break the page. Honest limit: this slows reading, it cannot stop it.
   Needs esbuild once:  npm install --save-dev esbuild
   Run:  node build/build.js [outDir]        (then start the server with GOC_PUBLIC_DIR=dist) */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.resolve(__dirname, '..');
var OUT = path.resolve(ROOT, process.argv[2] || 'dist');

// Never build into the source or a folder that holds it.
if (OUT === ROOT || ROOT.startsWith(OUT + path.sep) || OUT === path.join(ROOT, 'js') || OUT === path.join(ROOT, 'css')) {
  console.error('Refusing to build into ' + OUT); process.exit(1);
}

/* Workstream A — a maintenance build for STATIC hosting (Appwrite Sites,
   where there is no Node process to gate requests). GOC_MAINTENANCE_MODE=1
   emits ONLY the announcement page and the cache-clearing service worker;
   the source tree is untouched and unsetting the variable rebuilds the full
   application exactly as before. No esbuild needed for this path. */
var maintenance = require(path.join(ROOT, 'server', 'lib', 'maintenance.js'));
if (maintenance.enabled(process.env)) {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, 'index.html'), maintenance.page());
  fs.writeFileSync(path.join(OUT, 'sw.js'), maintenance.serviceWorker());
  console.log('Maintenance build: ' + path.relative(ROOT, OUT) + '/index.html and sw.js only.');
  console.log('GOC_MAINTENANCE_MODE is on — no application asset was copied.');
  console.log('Unset GOC_MAINTENANCE_MODE and rebuild to restore the full app.');
  process.exit(0);
}

var esbuild;
try { esbuild = require('esbuild'); } catch (e) {
  try { esbuild = require(path.join(ROOT, 'node_modules', 'esbuild')); } catch (e2) {
    console.error('esbuild is not installed. Run:  npm install --save-dev esbuild');
    process.exit(1);
  }
}

var TEST_HOOKS = ['_setJambReadyMin', '_grantXp', '_setupTokenFor'];

function read(rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
function write(rel, data) {
  var full = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
}

function stripHooks(src, rel) {
  TEST_HOOKS.forEach(function (name) {
    // one-line member of an object literal:   _name: function (...) { ... },
    var re = new RegExp('^[ \\t]*' + name + ':[^\\n]*\\},?[ \\t]*\\r?\\n', 'm');
    if (re.test(src)) src = src.replace(re, '');
    if (src.indexOf(name) > -1) throw new Error(rel + ': test hook ' + name + ' could not be removed safely');
  });
  return src;
}

/* Appwrite migration: an Appwrite Sites build sets GOC_API_BASE to the goc-api
   Function's API base, including the /api suffix and no trailing slash, e.g.
     GOC_API_BASE=https://<function>.appwrite.global/api npm run build
   OneBit builds leave it unset, so js/api.js keeps its relative 'api' default
   and the existing deployment is byte-for-byte equivalent in behaviour.
   Nothing secret is ever injected here: this value is public by design. */
var API_BASE = String(process.env.GOC_API_BASE || '').trim().replace(/\/+$/, '');
if (API_BASE && !/^https?:\/\/[^\s]+$/i.test(API_BASE)) {
  console.error('GOC_API_BASE must be an absolute http(s) URL ending in /api (no trailing slash). Got: ' + API_BASE);
  process.exit(1);
}
var JS_DEFINE = API_BASE ? { __GOC_API_BASE__: JSON.stringify(API_BASE) } : {};

function minJs(rel) {
  var src = stripHooks(read(rel), rel);
  var r = esbuild.transformSync(src, {
    loader: 'js', minify: true, legalComments: 'none', charset: 'ascii', sourcemap: false,
    define: JS_DEFINE
  });
  write(rel, r.code);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* The 2027 Free Tutorial Edition's three scripts are built beside the hub's own,
   and its stylesheet is minified with them. Deleting this line only stops the
   edition being built; the original hub is unaffected. */
['js/goc-core.js', 'js/goc-free-2027.js', 'js/note-questions.js', 'js/api.js', 'js/app.js', 'js/onboarding.js',
 'js/free2027-api.js', 'js/free2027-ui.js', 'js/free2027-admin.js', 'js/pwa.js', 'sw.js'].forEach(minJs);

write('css/styles.css', esbuild.transformSync(read('css/styles.css'), { loader: 'css', minify: true, legalComments: 'none' }).code);
if (fs.existsSync(path.join(ROOT, 'css', 'free2027.css'))) {
  write('css/free2027.css', esbuild.transformSync(read('css/free2027.css'), { loader: 'css', minify: true, legalComments: 'none' }).code);
}

// index.html: drop comments (keep conditional comments, none today) and blank runs.
var html = read('index.html').replace(/<!--(?!\[if)[\s\S]*?-->/g, '').replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n');
write('index.html', html);

// Copied as they are.
fs.cpSync(path.join(ROOT, 'icons'), path.join(OUT, 'icons'), { recursive: true });
fs.cpSync(path.join(ROOT, 'js', 'vendor'), path.join(OUT, 'js', 'vendor'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'manifest.webmanifest'), path.join(OUT, 'manifest.webmanifest'));

// Every file the service worker caches (and every local file index.html names) must be in the build,
// otherwise addAll() fails on a student's phone and the app never installs.
var missing = [];
var sw = read('sw.js');
var list = (sw.match(/const ASSETS = \[([\s\S]*?)\]/) || [, ''])[1];
(list.match(/'\.\/[^']+'/g) || []).forEach(function (q) {
  var rel = q.slice(3, -1); if (!fs.existsSync(path.join(OUT, rel))) missing.push(rel);
});
(html.match(/(?:src|href)="(?!https?:|mailto:|tel:|data:|#)[^"]+"/g) || []).forEach(function (a) {
  var rel = a.replace(/^[a-z]+="/, '').slice(0, -1).split('?')[0];
  if (!fs.existsSync(path.join(OUT, rel))) missing.push(rel);
});
if (missing.length) { console.error('Build is missing: ' + missing.join(', ')); process.exit(1); }

function size(p) { return fs.statSync(path.join(OUT, p)).size; }
var before = 0, after = 0;
['js/goc-core.js', 'js/api.js', 'js/app.js', 'js/pwa.js', 'sw.js', 'css/styles.css', 'index.html',
 'js/goc-free-2027.js', 'js/free2027-api.js', 'js/free2027-ui.js', 'js/free2027-admin.js', 'css/free2027.css'].forEach(function (p) {
  before += fs.statSync(path.join(ROOT, p)).size; after += size(p);
});
console.log('Built ' + path.relative(ROOT, OUT) + ': ' + before + ' -> ' + after + ' bytes (' + Math.round(100 - after / before * 100) + '% smaller)');
