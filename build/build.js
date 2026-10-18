/* build/build.js — Phase 3D slice 3: make the code hard to read.
   Builds a production copy of the public app into dist/ (or the folder given):
     - JavaScript and CSS are minified, comments removed, local names shortened
     - the demo driver's test-only hooks (_setJambReadyMin, _setTier) are removed
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

var esbuild;
try { esbuild = require('esbuild'); } catch (e) {
  try { esbuild = require(path.join(ROOT, 'node_modules', 'esbuild')); } catch (e2) {
    console.error('esbuild is not installed. Run:  npm install --save-dev esbuild');
    process.exit(1);
  }
}

// Never build into the source or a folder that holds it.
if (OUT === ROOT || ROOT.startsWith(OUT + path.sep) || OUT === path.join(ROOT, 'js') || OUT === path.join(ROOT, 'css')) {
  console.error('Refusing to build into ' + OUT); process.exit(1);
}

var TEST_HOOKS = ['_setJambReadyMin', '_setTier'];

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

function minJs(rel) {
  var src = stripHooks(read(rel), rel);
  var r = esbuild.transformSync(src, {
    loader: 'js', minify: true, legalComments: 'none', charset: 'ascii', sourcemap: false
  });
  write(rel, r.code);
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

['js/goc-core.js', 'js/api.js', 'js/app.js', 'js/pwa.js', 'sw.js'].forEach(minJs);

write('css/styles.css', esbuild.transformSync(read('css/styles.css'), { loader: 'css', minify: true, legalComments: 'none' }).code);

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
['js/goc-core.js', 'js/api.js', 'js/app.js', 'js/pwa.js', 'sw.js', 'css/styles.css', 'index.html'].forEach(function (p) {
  before += fs.statSync(path.join(ROOT, p)).size; after += size(p);
});
console.log('Built ' + path.relative(ROOT, OUT) + ': ' + before + ' -> ' + after + ' bytes (' + Math.round(100 - after / before * 100) + '% smaller)');
