/* test-import-replace.js — Phase 3E.C slice 3: re-importing a corrected file can REPLACE the questions
   already in the bank (same id) instead of skipping them as duplicates. Core rules, the offline
   driver, the real server over HTTP, and the screen.   node test/test-import-replace.js */
'use strict';
var fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http'), os = require('os');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var core = require(path.join(APP, 'js', 'goc-core.js'));
var PORT = Number(process.env.GOC_REPLACE_PORT) || 8183;
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 200) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var HEAD = 'subject,section,topic,text,optionA,optionB,optionC,optionD,optionE,answer,expected,maxMark,difficulty,explanation,active\n';
function row(text, opts, ans, expl, section) { return 'Mathematics,' + (section || 'objective') + ',Algebra,"' + text + ' Which option is right?",' + opts.join(',') + ',' + ans + ',,,medium,"' + expl + '",yes\n'; }
var WRONG = row('Double of two', ['2', '3', '5', '8', ''], 'A', 'Two doubled is four.');          /* answer wrongly stored as 2 */
var FIXED = row('Double of two', ['2', '3', '4', '8', ''], 'C', 'Two doubled is four.');
var OTHER = row('Triple of two', ['2', '3', '6', '8', ''], 'C', 'Two tripled is six.');

head('The rules (core)');
var first = core.importCSV('questions', HEAD + WRONG, null, [], []);
var bank = first.records.map(function (r, i) { r.id = 41 + i; r.imageId = 'img9'; r.imageAlt = 'a graph'; r.active = false; return r; });
var plain = core.importCSV('questions', HEAD + FIXED + OTHER, null, bank, []);
ok('without replace a matching row is still skipped as a duplicate', plain.records.length === 1 && plain.errors.length === 1 && /duplicate/i.test(plain.errors[0].error) && plain.replacements === undefined);
var rep = core.importCSV('questions', HEAD + FIXED + OTHER, null, bank, [], { replace: true });
ok('with replace the matching row becomes a replacement and the new one a record', rep.records.length === 1 && rep.replacements.length === 1 && rep.errors.length === 0, JSON.stringify(rep.errors));
var rp = rep.replacements[0];
ok('the replacement names the existing question\'s id and its file line', rp.id === 41 && rp.line === 2);
ok('it carries the corrected options, answer and explanation', rp.patch.answer === 2 && rp.patch.options.join('|') === '2|3|4|8' && rp.patch.explanation === 'Two doubled is four.');
ok('it never carries the id, the picture or the live flag', !('id' in rp.patch) && !('imageId' in rp.patch) && !('imageAlt' in rp.patch) && !('active' in rp.patch));
var twice = core.importCSV('questions', HEAD + FIXED + FIXED, null, bank, [], { replace: true });
ok('the same question twice in one file replaces once and refuses the repeat', twice.replacements.length === 1 && twice.errors.length === 1 && /line 2/.test(twice.errors[0].error));
var sec = core.importCSV('questions', HEAD + row('Double of two', ['2', '3', '4', '8', ''], 'C', 'Two doubled is four.', 'practice'), null, bank, [], { replace: true });
ok('the same wording in another section is a new question, not a replacement', sec.records.length === 1 && sec.replacements.length === 0);
var bad = core.importCSV('questions', HEAD + row('Double of two', ['2', '4', '6', '8', ''], '4', 'x'), null, bank, [], { replace: true });
ok('a row that cannot be read never replaces anything', bad.replacements.length === 0 && bad.errors.length === 1);
var notes = core.importCSV('notes', 'subject,topic,title,body,minutes,active\nPhysics,Motion,"Speed","Speed is the distance covered in a given time. Velocity is speed in a stated direction, so it can be negative.",2,yes\n', null, [], [], { replace: true });
ok('notes are unaffected by the option', notes.records.length === 1 && notes.replacements === undefined);
var pv = core.importCSV('questions', HEAD + FIXED + OTHER, null, bank, [], { replace: true, preview: true });
ok('preview marks the replacement and says which question it overwrites', pv.preview.length === 2 && pv.preview[0].replaces === 41 && /Replaces the question already in the bank \(id 41\)/.test(pv.preview[0].flags[0]) && pv.preview[1].replaces === undefined);

head('The offline driver');
var sandbox = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' }, setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
var mock = vm.runInContext('GOC.api._drivers.mock', ctx);
(async function () {
  await mock.login('GOC-A-001', 'founder2027'); await mock.unlockConsole('2027');
  var a = await mock.importQuestions(HEAD + WRONG, 'a.csv', false, '', '', false);
  var id = a.ids[0];
  var b = await mock.importQuestions(HEAD + FIXED, 'b.csv', false, '', '', false);
  ok('demo: without replace the corrected row is skipped and the bank is unchanged', b.added === 0 && b.skipped === 1 && !b.replaced);
  var c = await mock.importQuestions(HEAD + FIXED + OTHER, 'c.csv', false, '', '', false, true);
  ok('demo: with replace one is corrected and one added', c.replaced === 1 && c.added === 1 && c.replacedIds[0] === id && c.skipped === 0, JSON.stringify(c));
  var all = (await mock.listQuestions({})).questions;
  var q = all.filter(function (x) { return x.id === id; })[0];
  ok('demo: the question kept its id and now has the right answer', !!q && q.answer === 2 && q.options[q.answer] === '4');
  ok('demo: no second copy was made', all.filter(function (x) { return /Double of two/.test(x.text); }).length === 1);
  var hist = (await mock.importHistory()).imports[0];
  ok('demo: the import history records how many were replaced', hist.replaced === 1);
  ok('GOC.api forwards the replace choice', /stampSection, replace\)/.test(read('js/api.js')) && /active\.importQuestions\(csv, filename, confirmDuplicate, subject, section, stampSection, replace\)/.test(read('js/api.js')));
  ok('the server driver sends replace in the request body', /stampSection: !!stampSection, replace: !!replace/.test(read('js/api.js')));

  head('The real server');
  var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-replace-test-'));
  fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
  try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
  var log = '';
  var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], { cwd: SANDBOX, env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' }) });
  child.stdout.on('data', function (d) { log += d; }); child.stderr.on('data', function (d) { log += d; });
  function stop() { try { child.kill(); } catch (e) {} try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {} }
  function call(method, urlPath, body, token) {
    return new Promise(function (resolve) {
      var payload = body == null ? null : JSON.stringify(body), h = {};
      if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
      if (token) h.Authorization = 'Bearer ' + token;
      var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: h }, function (res) {
        var raw = ''; res.on('data', function (d) { raw += d; });
        res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j }); });
      });
      req.on('error', function (e) { resolve({ status: 0, body: null }); });
      if (payload) req.write(payload); req.end();
    });
  }
  async function boot(n) { var r = await call('GET', '/api/health'); if (r.status === 200) return; if (n <= 0) throw new Error('server did not start\n' + log); await new Promise(function (x) { setTimeout(x, 100); }); return boot(n - 1); }
  try {
    await boot(100);
    var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
    await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
    var imp = function (csv, replace) { return call('POST', '/api/questions/import', { csv: csv, filename: 'f.csv', replace: replace }, adm); };
    var r1 = await imp(HEAD + WRONG, false);
    var sid = r1.body.ids[0];
    var r2 = await imp(HEAD + FIXED, false);
    ok('server: without replace the corrected row is skipped', r2.status === 200 && r2.body.added === 0 && r2.body.skipped === 1 && r2.body.replaced === 0, JSON.stringify(r2.body));
    var before = (await call('GET', '/api/questions', null, adm)).body.total;
    var r3 = await imp(HEAD + FIXED + OTHER, true);
    ok('server: with replace one is corrected in place and one added', r3.status === 200 && r3.body.replaced === 1 && r3.body.added === 1 && r3.body.replacedIds[0] === sid, JSON.stringify(r3.body));
    var list = (await call('GET', '/api/questions', null, adm)).body;
    var q = list.questions.filter(function (x) { return x.id === sid; })[0];
    ok('server: the question kept its id and the right answer', !!q && q.answer === 2 && q.options[2] === '4');
    ok('server: the bank grew by the one new question only', list.total === before + 1, list.total + ' vs ' + before);
    var hist = (await call('GET', '/api/import/history', null, adm)).body.imports;
    ok('server: the history says how many were replaced', hist[0].replaced === 1);
    var again = await imp(HEAD + FIXED, true);
    ok('server: replacing the same thing again is harmless', again.status === 200 && again.body.replaced === 1 && again.body.added === 0);
    var anon = await call('POST', '/api/questions/import', { csv: HEAD + FIXED, replace: true });
    ok('server: replace is refused without a console session', anon.status === 401 || anon.status === 403, anon.status);
  } finally { stop(); }

  head('The screen');
  var app = read('js/app.js');
  function grab(name) { var i = app.indexOf('function ' + name + '('); if (i < 0) return ''; var d = 0, j = app.indexOf('{', i); for (var k = j; k < app.length; k++) { if (app[k] === '{') d++; else if (app[k] === '}') { d--; if (d === 0) return app.slice(i, k + 1); } } }
  var els = { admImCsv: { value: '' }, admImOut: { innerHTML: '' }, admImTarget: { innerHTML: '' } }, toasts = [], listed = 0;
  var sb = {
    document: { getElementById: function (id) { return els[id] || null; } },
    esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
    toast: function (m) { toasts.push(m); }, wtSectionLabel: function (s) { return s; },
    admQOpts: function (opts, sel) { return opts.map(function (o) { return '<option value="' + o[0] + '"' + (o[0] === sel ? ' selected' : '') + '>' + o[1] + '</option>'; }).join(''); },
    admImKind: 'questions', admImSubject: '', admImSection: '', admImStamp: false, admImReplace: false,
    GOC: { api: { rules: core, listQuestions: function () { listed++; return Promise.resolve({ questions: bank }); } } }, String: String, Promise: Promise
  };
  var c2 = vm.createContext(sb);
  ['admImTargetHTML', 'admImSetReplace', 'admImPaintTarget', 'admImPreview', 'admImPaintPreview'].forEach(function (n) { vm.runInContext(grab(n), c2); });
  vm.runInContext('var ADM_IM_PREVIEW_MAX = 50;', c2);
  var run = function (x) { return vm.runInContext(x, c2); };
  var h0 = run('admImTargetHTML()');
  ok('the import screen offers skip or replace, skip first', /admImReplaceSel/.test(h0) && h0.indexOf('Skip it') < h0.indexOf('Replace it') && !/Use Preview first/.test(h0));
  run("admImSetReplace('yes')");
  ok('choosing replace repaints the screen with a plain warning', run('admImReplace') === true && /overwrites that question/.test(els.admImTarget.innerHTML) && /Use Preview first/.test(els.admImTarget.innerHTML));
  els.admImCsv.value = HEAD + FIXED + OTHER;
  run('admImPreview()'); await new Promise(function (x) { setTimeout(x, 5); });
  var out = els.admImOut.innerHTML;
  ok('preview in replace mode reads the bank first', listed === 1);
  ok('preview counts what would be replaced separately', /Would replace existing<\/span><b>1</.test(out) && /Would be published<\/span><b>1</.test(out));
  ok('preview names the question that would be overwritten', /Replaces the question already in the bank \(id 41\)/.test(out));
  run("admImSetReplace('no')"); listed = 0; run('admImPreview()');
  ok('preview with replace off never reads the bank', listed === 0 && !/Would replace existing/.test(els.admImOut.innerHTML));
  ok('the result and history show the replaced count', /Replaced<\/span>/.test(app) && /esc\(e\.replaced\) \+ ' replaced'/.test(app));
  ok('the run passes the choice to GOC.api', /stampSection\b[^\n]*|admImStamp, admImReplace\)/.test(app) && /admImStamp, admImReplace\)/.test(app));
  ok('the cache was bumped past v142', /CACHE = 'goc-v(\d+)'/.test(read('sw.js')) && Number(RegExp.$1) >= 143);

  console.log(fails ? '\n' + fails + ' FAILED' : '\nimport replace: all passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  crashed: ' + (e && e.stack || e)); process.exit(1); });
