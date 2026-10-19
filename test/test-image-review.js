/* test-image-review.js — Question images, slice 4 part 2: Mistakes review and
   Review due show a question's picture. Pure rule, demo driver, real server
   routes (picture file seeded straight into the data folder, so busboy is not
   needed) and both screens.   node test/test-image-review.js  */
'use strict';
var activeStudent = require('./active-student.js');
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var vm = require('vm');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var core = require(path.join(APP, 'js', 'goc-core.js'));
var SIGNUP = 'GOC2027';
var PORT = Number(process.env.GOC_TEST_PORT) || 8162;
var IMG = 'QIMG-0123456789abcdef';
var PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), Buffer.alloc(64, 1)]);
var fails = 0, passes = 0;
function ok(name, cond, extra) { if (cond) { passes++; console.log('  pass  ' + name); } else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); } }
function head(t) { console.log('\n' + t); }
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function coreRule() {
  head('Pure rule: core.attachImagesToMistakes');
  var BANK = [{ id: 1, imageId: IMG, imageAlt: 'A circuit' }, { id: 2 }];
  var ROWS = [{ key: 'a', id: 1, text: 't1' }, { key: 'b', id: 2, text: 't2' }, { key: 'c', id: null, text: 't3' }, { key: 'd', id: 99, text: 't4' }];
  var out = core.attachImagesToMistakes(ROWS, BANK);
  ok('a mistake whose question has a picture carries { id, alt }', out[0].image && out[0].image.id === IMG && out[0].image.alt === 'A circuit' && Object.keys(out[0].image).sort().join() === 'alt,id');
  ok('a question without a picture gets none', out[1].image === undefined);
  ok('a row with no id, or a question gone from the bank, is left alone', out[2].image === undefined && out[3].image === undefined);
  ok('the stored rows are not changed', ROWS[0].image === undefined && out[0].key === 'a');
  ok('empty and missing input are safe', core.attachImagesToMistakes(null, null).length === 0 && core.attachImagesToMistakes(ROWS, null)[0].image === undefined);
}

async function demoDriver() {
  head('Demo driver: mistakes and review carry the picture');
  var sandbox = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var ctx = vm.createContext(sandbox);
  vm.runInContext('window = this; self = this;', ctx);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
  var A = vm.runInContext('GOC.api', ctx);
  await A.login('GOC-A-001', 'founder2027');
  await A.unlockConsole('2027');
  var up = await A.uploadQuestionImage({ get: function () { return { name: 'c.png', type: 'image/png', size: 900 }; } });
  function mk(extra) { return Object.assign({ subject: 'Physics', section: 'practice', topic: 'Electricity', text: 'Total resistance?', options: ['2', '4', '6'], answer: 1 }, extra || {}); }
  var qIn = await A.createQuestion(mk({ imageId: up.imageId, imageAlt: 'A circuit with two resistors' }));
  var qOut = await A.createQuestion(mk({ text: 'Unit of current?' }));
  await activeStudent.demo(A, { signupCode: SIGNUP, name: 'Pic Test', password: 'secret123', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  function rrow(q, n) { return { n: n, id: q.id, subject: 'Physics', topic: q.topic, text: q.text, options: q.options, answer: 1, given: 0, isCorrect: false, explanation: 'because' }; }
  await A.recordPractice({ mode: 'practice', subject: 'Physics', total: 2, answered: 2, ts: Date.now() - 3 * 86400000, review: [rrow(qIn, 1), rrow(qOut, 2)] });
  var m = (await A.listMistakes()).mistakes;
  var a = m.filter(function (x) { return x.id === qIn.id; })[0], b = m.filter(function (x) { return x.id === qOut.id; })[0];
  ok('listMistakes: the picture question carries its picture', a && a.image && a.image.id === up.imageId && /circuit/.test(a.image.alt));
  ok('listMistakes: the plain question has none', b && b.image === undefined);
  var due = (await A.listReview()).review.due.filter(function (x) { return x.id === qIn.id; })[0];
  ok('listReview: a due question carries its picture too', due && due.image && due.image.id === up.imageId);
}

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject); if (payload) req.write(payload); req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}

async function serverRoutes() {
  head('Server: /api/me/mistakes and /api/me/review carry the picture');
  var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-image-review-test-'));
  fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) { var from = path.join(APP, f); if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f)); });
  try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
  fs.mkdirSync(path.join(SANDBOX, 'server', 'question-images'), { recursive: true });
  fs.writeFileSync(path.join(SANDBOX, 'server', 'question-images', IMG + '.png'), PNG);
  var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], { cwd: SANDBOX,
    env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'), GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP }),
    stdio: ['ignore', 'pipe', 'pipe'] });
  var log = ''; child.stdout.on('data', function (c) { log += c; }); child.stderr.on('data', function (c) { log += c; });
  try {
    await waitForBoot(40);
    var adm = (await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' })).body.token;
    await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
    function mk(extra) { return Object.assign({ subject: 'Physics', section: 'practice', topic: 'Electricity', text: 'Total resistance?', options: ['2', '4', '6'], answer: 1 }, extra || {}); }
    var qIn = (await call('POST', '/api/questions', mk({ imageId: IMG, imageAlt: 'A circuit with two resistors' }), adm)).body;
    var qOut = (await call('POST', '/api/questions', mk({ text: 'Unit of current?' }), adm)).body;
    ok('set-up: a picture question and a plain one exist', qIn.id > 0 && qIn.imageId === IMG && qOut.id > 0, JSON.stringify([qIn, qOut]).slice(0, 200));
    var tok = (await activeStudent.signedUp(call, { signupCode: SIGNUP, name: 'Pic Test', password: 'secret123', email: 'pic.t@example.com', phone: '08000000012', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] })).body.token;
    function rrow(q, n) { return { n: n, id: q.id, subject: 'Physics', topic: q.topic, text: q.text, options: q.options, answer: 1, given: 0, isCorrect: false, explanation: 'because' }; }
    var rec = await call('POST', '/api/me/practice', { mode: 'practice', subject: 'Physics', total: 2, answered: 2, correct: 0, wrong: 2, percent: 0, ts: Date.now() - 3 * 86400000, topics: [], review: [rrow(qIn, 1), rrow(qOut, 2)] }, tok);
    ok('set-up: a practice run with two wrong answers is stored', rec.status === 200, rec.raw.slice(0, 120));
    var ms = (await call('GET', '/api/me/mistakes', undefined, tok)).body.mistakes;
    var a = ms.filter(function (x) { return x.id === qIn.id; })[0], b = ms.filter(function (x) { return x.id === qOut.id; })[0];
    ok('mistakes: the picture question carries { id, alt }', a && a.image && a.image.id === IMG && /circuit/.test(a.image.alt) && Object.keys(a.image).sort().join() === 'alt,id');
    ok('mistakes: the plain question has none', b && b.image === undefined);
    var rv = (await call('GET', '/api/me/review', undefined, tok)).body.review;
    var d = rv.due.filter(function (x) { return x.id === qIn.id; })[0];
    ok('review: the due session carries the picture', d && d.image && d.image.id === IMG, JSON.stringify(rv).slice(0, 200));
    ok('review: counts are unchanged by it', rv.dueCount === 2 && rv.due.length === 2);
    var ans = await call('POST', '/api/me/review', { key: d.key, given: 1 }, tok);
    ok('answering a review still works and is judged by the server', ans.status === 200 && ans.body.correct === true, ans.raw.slice(0, 160));
  } finally {
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
  }
  if (fails) console.log(log.slice(-1500));
}

function screens() {
  head('Screens: the real mkRender and rvRender place and paint the picture');
  var app = read('js/app.js');
  function grab(name) {
    var i = app.indexOf('function ' + name + '(');
    var depth = 0, j = app.indexOf('{', i);
    for (var k = j; k < app.length; k++) { if (app[k] === '{') depth++; else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); } }
  }
  var painted = [];
  var els = { mkCount: {}, mkSub: {}, mkList: { innerHTML: '' }, rvHost: { innerHTML: '' }, rvSub: {} };
  var sandbox = { studentId: 'GOC-1', document: { getElementById: function (id) { return els[id] || null; } },
    esc: esc, mth: function (s) { return String(s == null ? '' : s); }, rvQueue: [], rvIndex: 0, rvRight: 0, rvAnswered: 0, rvMore: 0, rvNextDue: null,
    rvWhen: function () { return 'tomorrow'; }, Date: Date, paintQImage: function (id, m) { painted.push([id, m.key]); } };
  var ctx = vm.createContext(sandbox);
  sandbox.askTutorButton = function () { return ''; };   // Ask a tutor button (Phase 4.A) — stubbed here
  ['reviewPassageHTML', 'reviewImageHTML', 'paintReviewImages', 'mkRender', 'rvRender'].forEach(function (n) { vm.runInContext(grab(n), ctx); });
  var withI = { key: 'a', subject: 'Physics', topic: 'Electricity', text: 'Q one', options: ['x', 'y'], answer: 0, given: 1, image: { id: IMG, alt: 'A circuit' } };
  var plain = { key: 'b', subject: 'Physics', topic: 'Motion', text: 'Q two', options: ['x', 'y'], answer: 0, given: 1 };

  sandbox.mkRender([withI, plain]);
  var html = els.mkList.innerHTML;
  ok('Mistakes review: a hidden picture box sits above the question text', /id="mkImg0"[^>]*hidden/.test(html) && html.indexOf('id="mkImg0"') < html.indexOf('Q one'));
  ok('Mistakes review: no box for the plain question', html.indexOf('mkImg1') === -1);
  ok('Mistakes review: the picture is painted into box 0 only', painted.length === 1 && painted[0][0] === 'mkImg0' && painted[0][1] === 'a');
  ok('Mistakes review: Try again is still offered', /mkRedo\(0\)/.test(html) && /mkRedo\(1\)/.test(html));

  painted.length = 0;
  sandbox.rvQueue = [withI, plain]; sandbox.rvIndex = 0;
  vm.runInContext('rvRender()', ctx);
  ok('Review due: a picture box sits above the question and is painted', /id="rvImg"/.test(els.rvHost.innerHTML) && els.rvHost.innerHTML.indexOf('rvImg') < els.rvHost.innerHTML.indexOf('Q one') && painted.length === 1 && painted[0][0] === 'rvImg');
  ok('Review due: the options are still drawn', /rvPick\(0\)/.test(els.rvHost.innerHTML));
  painted.length = 0;
  vm.runInContext('rvIndex = 1; rvRender()', ctx);
  ok('Review due: the next, plain question has no box and nothing is painted', els.rvHost.innerHTML.indexOf('rvImg') === -1 && painted.length === 0);
}

(async function () {
  try { coreRule(); await demoDriver(); await serverRoutes(); screens(); }
  catch (e) { fails++; console.log('THREW: ' + (e && e.stack || e)); }
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
