/* test-deploy.js — Phase 3D slice 5: the deploy folder and .gitignore.
   Proves that:
     1. refusal() names every kind of file that must never ship, and lets normal files through
     2. a deploy folder holds only the allow-list plus the built public/ folder
     3. a backup, .bak, .env, data file, test file or log in the source stops the deploy BEFORE anything is written
     4. the folder is audited after writing, and an output folder inside the source is refused
     5. .gitignore covers every secret, data and build path
     6. the real project deploys when esbuild is installed (skipped, and said so, when it is not)
   Run:  node test/test-deploy.js  */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var execFileSync = require('child_process').execFileSync;

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var D = require(path.join(APP, 'build', 'deploy.js'));

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function threw(fn) { try { fn(); return ''; } catch (e) { return e.message; } }

head('what is refused');
['server/backups/data-1.json', 'server/data.json.shipped.bak', 'notes.BAK', '.env', '.env.production', 'server/.env',
 'server/data.json', 'server/data.json.tmp', 'test/run.js', 'server/test/x.js', '.git/config', 'node_modules/a/b.js',
 'reminders-outbox.jsonl', 'server/question-images/QIMG-1.png', 'server.log', 'key.pem'].forEach(function (p) {
  ok(p + ' is refused', D.refusal(p) !== '', D.refusal(p));
});
['server/server.js', 'server/lib/reminders.js', 'js/goc-core.js', 'package.json', 'public/js/app.js', 'server/tutor/tutor-app.js'].forEach(function (p) {
  ok(p + ' is allowed', D.refusal(p) === '');
});

// A small stand-in project.
function project(extra) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-deploy-src-'));
  var files = {
    'package.json': '{}', 'package-lock.json': '{}', 'js/goc-core.js': 'x', 'js/app.js': 'app',
    'server/server.js': 's', 'server/setup-appwrite.js': 's', 'server/verify-media.js': 's', 'server/export-questions.js': 's',
    'server/lib/appwrite.js': 'l', 'server/lib/reminders.js': 'l', 'server/tutor/tutor-app.js': 't',
    'test/run.js': 'tests', 'DEPLOYMENT.md': 'docs', 'index.html': '<html>'
  };
  Object.keys(extra || {}).forEach(function (k) { files[k] = extra[k]; });
  Object.keys(files).forEach(function (rel) {
    var f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, files[rel]);
  });
  return root;
}
function fakeBuild(dir) { fs.mkdirSync(path.join(dir, 'js'), { recursive: true }); fs.writeFileSync(path.join(dir, 'index.html'), '<min>'); fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'm'); }
function list(dir, base, out) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach(function (e) {
    var rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) list(path.join(dir, e.name), rel, out); else out.push(rel);
  });
  return out.sort();
}

head('a clean deploy');
var root = project(), out = path.join(os.tmpdir(), 'goc-deploy-out-' + process.pid);
var r = D.assemble({ root: root, out: out, build: fakeBuild });
var got = list(out, '', []);
ok('reports the file count', r.files === got.length && r.bytes > 0, r.files + ' vs ' + got.length);
ok('holds the server, its libraries and the core', ['server/server.js', 'server/lib/appwrite.js', 'server/lib/reminders.js', 'server/tutor/tutor-app.js', 'js/goc-core.js', 'package.json', 'package-lock.json'].every(function (f) { return got.indexOf(f) > -1; }));
ok('holds the built public/ folder', got.indexOf('public/index.html') > -1 && got.indexOf('public/js/app.js') > -1);
ok('has no tests, docs or readable page source', !got.some(function (f) { return /^test\//.test(f) || f === 'DEPLOYMENT.md' || f === 'index.html' || f === 'js/app.js'; }), got.join(','));
ok('every file is on the allow-list or in public/', got.every(function (f) {
  return f === 'DEPLOY-NOTES.txt' || /^public\//.test(f) || D.ALLOW_FILES.indexOf(f) > -1 || D.ALLOW_DIRS.some(function (d) { return f.indexOf(d + '/') === 0; });
}));
ok('the notes say where the data and secrets go', /GOC_DATA_DIR/.test(fs.readFileSync(path.join(out, 'DEPLOY-NOTES.txt'), 'utf8')));
ok('the source folder is untouched', fs.existsSync(path.join(root, 'test/run.js')) && fs.readFileSync(path.join(root, 'index.html'), 'utf8') === '<html>');

head('deploying again replaces the folder');
fs.writeFileSync(path.join(out, 'stray.txt'), 'old');
D.assemble({ root: root, out: out, build: fakeBuild });
ok('a stray file from an earlier run is gone', !fs.existsSync(path.join(out, 'stray.txt')));

head('dangerous files stop the deploy');
var cases = {
  'a backups folder in server/': { 'server/backups/data-2026.json': '{}' },
  'a .bak file in server/': { 'server/data.json.shipped.bak': '{}' },
  'a .bak file inside server/lib': { 'server/lib/old.js.bak': 'x' },
  'a .env in the project': { '.env': 'GOC_FOUNDER_PW=secret' },
  'a .env inside server/': { 'server/.env': 'k=v' },
  'a live data file in server/': { 'server/data.json': '{}' },
  'a log inside server/tutor': { 'server/tutor/debug.log': 'x' }
};
Object.keys(cases).forEach(function (name) {
  var rt = project(cases[name]), o = path.join(os.tmpdir(), 'goc-deploy-bad-' + process.pid);
  fs.rmSync(o, { recursive: true, force: true });
  var built = false;
  var msg = threw(function () { D.assemble({ root: rt, out: o, build: function (d) { built = true; fakeBuild(d); } }); });
  var key = Object.keys(cases[name])[0];
  ok(name + ' is refused', /Deploy refused/.test(msg), msg);
  ok('  and the message names ' + key, msg.indexOf(key) > -1 || (key === '.env' && msg.indexOf('.env') > -1), msg);
  ok('  and nothing was built or written', !built && !fs.existsSync(o));
});

head('output folder and build problems');
var rt2 = project();
ok('an output folder inside server/ is refused', /Refusing/.test(threw(function () { D.assemble({ root: rt2, out: path.join(rt2, 'server', 'out'), build: fakeBuild }); })));
ok('an output folder that is the source is refused', /Refusing/.test(threw(function () { D.assemble({ root: rt2, out: rt2, build: fakeBuild }); })));
var o3 = path.join(os.tmpdir(), 'goc-deploy-nobuild-' + process.pid);
ok('a build with no index.html is refused and the folder removed', /did not produce/.test(threw(function () { D.assemble({ root: rt2, out: o3, build: function () {} }); })) && !fs.existsSync(o3));
var o4 = path.join(os.tmpdir(), 'goc-deploy-audit-' + process.pid);
ok('the audit catches a build that wrote a secret', /audit failed/.test(threw(function () {
  D.assemble({ root: rt2, out: o4, build: function (d) { fakeBuild(d); fs.writeFileSync(path.join(d, '.env'), 'x'); } });
})) && !fs.existsSync(o4));

head('.gitignore');
var gi = fs.readFileSync(path.join(APP, '.gitignore'), 'utf8').split(/\r?\n/).map(function (l) { return l.trim(); });
['node_modules/', 'dist/', 'deploy/', '.env', '.env.*', 'server/data.json', 'server/backups/', 'server/question-images/', '*.bak', '*.tmp', '*.log', 'reminders-outbox.jsonl'].forEach(function (p) {
  ok('.gitignore lists ' + p, gi.indexOf(p) > -1);
});

head('the real project');
var esb = true;
try { require('esbuild'); } catch (e) { try { require(path.join(APP, 'node_modules', 'esbuild')); } catch (e2) { esb = false; } }
if (!esb) console.log('  SKIPPED  esbuild is not installed (npm install); the real-project deploy did not run');
else {
  var realSource = path.join(os.tmpdir(), 'goc-deploy-source-' + process.pid);
  var real = path.join(os.tmpdir(), 'goc-deploy-real-' + process.pid), txt = '';
  try {
    fs.rmSync(realSource, { recursive: true, force: true });
    fs.rmSync(real, { recursive: true, force: true });
    fs.cpSync(APP, realSource, {
      recursive: true,
      filter: function (src) {
        var rel = path.relative(APP, src).split(path.sep).join('/');
        if (!rel) return true;
        if (rel === 'node_modules' || rel.startsWith('node_modules/') ||
            rel === '.git' || rel.startsWith('.git/') ||
            rel === '.build-debug' || rel.startsWith('.build-debug/')) return false;
        if (rel === 'server/data.json') return false;
        if (/(^|\/)\.env[^/]*$/.test(rel) ||
            /(^|\/)(backups|question-images)(\/|$)/i.test(rel) ||
            /\.(bak|tmp|log|pem|key)$/i.test(rel)) return false;
        return true;
      }
    });
    fs.symlinkSync(path.join(APP, 'node_modules'), path.join(realSource, 'node_modules'), 'dir');
    txt = execFileSync(process.execPath, [path.join(realSource, 'build', 'deploy.js'), real], { encoding: 'utf8' });
  } catch (e) {
    txt = 'ERR ' + (e.stdout || '') + e.message;
  }
  ok('deploy.js finishes and says the audit passed', /Audit passed/.test(txt), txt);
  var rf = fs.existsSync(real) ? list(real, '', []) : [];
  ok('the real folder has no refused file', rf.length > 0 && rf.every(function (f) { return D.refusal(f) === ''; }));
  ok('the real folder has the built page and the server', rf.indexOf('public/index.html') > -1 && rf.indexOf('server/server.js') > -1);
  fs.rmSync(real, { recursive: true, force: true });
  fs.rmSync(realSource, { recursive: true, force: true });
}

[out, root, rt2].forEach(function (p) { fs.rmSync(p, { recursive: true, force: true }); });
console.log(fails ? '\n' + fails + ' FAILED' : '\nAll deploy checks passed.');
process.exit(fails ? 1 : 0);
