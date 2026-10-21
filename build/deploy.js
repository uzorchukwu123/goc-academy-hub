/* build/deploy.js — Phase 3D slice 5: build a deploy folder from an allow-list.
   Makes deploy/ (or the folder given) holding ONLY what a live host needs:
     public/            the minified app (node build/build.js writes it here)
     js/goc-core.js     the shared rules; the server loads this file (readable, never served)
     server/            server.js, lib/, tutor/, setup-appwrite.js, verify-media.js, export-questions.js
     package.json, package-lock.json
   Nothing else is copied. Anything on the REFUSE list found where a copy would read it
   (server/backups, any .bak, .env*, data.json*, test/, .git, outbox logs, question pictures)
   stops the deploy with a message naming the file, and the finished folder is audited again.
   Run:  node build/deploy.js [outDir]      then on the host:  npm install --omit=dev
         and start with  GOC_PUBLIC_DIR=public node server/server.js
   Honest limit: this keeps secrets and data out of the folder. It does not check your host settings. */
'use strict';
var fs = require('fs');
var path = require('path');

var ALLOW_FILES = [
  'package.json', 'package-lock.json',
  'js/goc-core.js',
  'server/server.js', 'server/setup-appwrite.js', 'server/verify-media.js', 'server/export-questions.js'
];
var ALLOW_DIRS = ['server/lib', 'server/tutor'];
var BUILT_DIR = 'public';

// Returns why a path must never be deployed, or '' when it is fine. rel uses forward slashes.
function refusal(rel) {
  var parts = rel.split('/');
  var base = parts[parts.length - 1];
  var dirs = parts.slice(0, -1).map(function (s) { return s.toLowerCase(); });
  if (dirs.indexOf('backups') > -1) return 'a backups folder';
  if (dirs.indexOf('test') > -1 || dirs.indexOf('tests') > -1) return 'the test folder';
  if (dirs.indexOf('.git') > -1 || base.toLowerCase() === '.git') return 'git history';
  if (dirs.indexOf('node_modules') > -1) return 'node_modules';
  if (dirs.indexOf('question-images') > -1) return 'uploaded question pictures';
  var b = base.toLowerCase();
  if (/\.bak$/.test(b) || /\.bak[.\-_]/.test(b)) return 'a backup file';
  if (/^\.env/.test(b)) return 'an environment (secrets) file';
  if (/^data\.json/.test(b)) return 'the live data file';
  if (/\.jsonl$/.test(b)) return 'a data log';
  if (/\.(tmp|log|pem|key)$/.test(b)) return 'a temporary, log or key file';
  return '';
}

function walk(dir, base, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out);
    else out.push(rel);
  });
  return out;
}

// opts: { root, out, build: function(buildOutDir) }  — returns { files, bytes } or throws Error with every problem.
function assemble(opts) {
  var root = path.resolve(opts.root), out = path.resolve(opts.out);
  if (out === root || root.startsWith(out + path.sep)) throw new Error('Refusing to deploy into ' + out + ' (it holds the source).');
  ['js', 'css', 'server', 'test', 'build', 'icons'].forEach(function (d) {
    var p = path.join(root, d);
    if (out === p || out.startsWith(p + path.sep)) throw new Error('Refusing to deploy into ' + out + ' (inside ' + d + '/).');
  });

  // 1. Choose what to copy, and refuse before anything is written.
  var copy = [], problems = [];
  ALLOW_FILES.forEach(function (rel) {
    var why = refusal(rel);
    if (why) problems.push(rel + ' is on the allow-list but is ' + why);
    else if (!fs.existsSync(path.join(root, rel))) problems.push(rel + ' is missing from the source');
    else copy.push(rel);
  });
  ALLOW_DIRS.forEach(function (d) {
    var full = path.join(root, d);
    if (!fs.existsSync(full)) { problems.push(d + '/ is missing from the source'); return; }
    walk(full, d, []).forEach(function (rel) {
      var why = refusal(rel);
      if (why) problems.push(rel + ' is inside ' + d + '/ and is ' + why + ' — move it out and deploy again');
      else copy.push(rel);
    });
  });
  // A backup or secret sitting next to server.js is refused too, even though it is not copied.
  walk(path.join(root, 'server'), 'server', []).forEach(function (rel) {
    var why = refusal(rel);
    if (why && rel.split('/').length > 1 && problems.every(function (p) { return p.indexOf(rel + ' ') !== 0; })) {
      problems.push(rel + ' is in server/ and is ' + why + ' — it was NOT copied, but remove it from the source before deploying so it cannot be copied by hand');
    }
  });
  if (fs.existsSync(path.join(root, '.env'))) problems.push('.env is in the project folder — it was NOT copied; set secrets on the host instead');
  if (problems.length) throw new Error('Deploy refused:\n  - ' + problems.join('\n  - '));

  // 2. Write.
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  copy.forEach(function (rel) {
    var to = path.join(out, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(path.join(root, rel), to);
  });
  opts.build(path.join(out, BUILT_DIR));
  if (!fs.existsSync(path.join(out, BUILT_DIR, 'index.html'))) {
    fs.rmSync(out, { recursive: true, force: true });
    throw new Error('Deploy refused: the build did not produce ' + BUILT_DIR + '/index.html');
  }
  fs.writeFileSync(path.join(out, 'DEPLOY-NOTES.txt'),
    'Built by build/deploy.js. Contains only what the server needs.\n' +
    '  npm install --omit=dev\n' +
    '  set GOC_PUBLIC_DIR=public, GOC_DATA_DIR=<persistent folder>, and your secrets on the host\n' +
    '  node server/server.js\n' +
    'Secrets, data and backups are never in this folder. Rebuild after every source change.\n');

  // 3. Audit what was actually written.
  var all = walk(out, '', []), bad = [];
  all.forEach(function (rel) { var why = refusal(rel); if (why) bad.push(rel + ' (' + why + ')'); });
  if (bad.length) { fs.rmSync(out, { recursive: true, force: true }); throw new Error('Deploy audit failed, folder removed:\n  - ' + bad.join('\n  - ')); }
  var bytes = all.reduce(function (n, rel) { return n + fs.statSync(path.join(out, rel)).size; }, 0);
  return { files: all.length, bytes: bytes };
}

module.exports = { assemble: assemble, refusal: refusal, ALLOW_FILES: ALLOW_FILES, ALLOW_DIRS: ALLOW_DIRS, BUILT_DIR: BUILT_DIR };

if (require.main === module) {
  var ROOT = path.resolve(__dirname, '..');
  var OUT = path.resolve(ROOT, process.argv[2] || 'deploy');
  try {
    var r = assemble({
      root: ROOT, out: OUT,
      build: function (dir) {
        require('child_process').execFileSync(process.execPath, [path.join(__dirname, 'build.js'), dir], { stdio: 'inherit' });
      }
    });
    console.log('Deploy folder ' + path.relative(ROOT, OUT) + ': ' + r.files + ' files, ' + r.bytes + ' bytes. Audit passed.');
  } catch (e) { console.error(e.message); process.exit(1); }
}
