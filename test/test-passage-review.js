/* test-passage-review.js — Comprehension passages, slice 4 part 4: the review screens
   (Mistakes review, Review due, and Try again inside it) show a question's passage.
   Covers the pure rule, the demo driver, the real server routes and both screens.
   node test/test-passage-review.js  */
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
var PORT = Number(process.env.GOC_TEST_PORT) || 8161;

var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }

var PTXT = 'The river had risen overnight, and by morning the whole village stood at its edge, watching the water carry away the old footbridge.';
var P = { id: 7, subject: 'Use of English', title: 'The Flood', text: PTXT, active: true };
var BANK = [
  { id: 1, subject: 'Use of English', passageId: 7 },
  { id: 2, subject: 'Use of English' },
  { id: 3, subject: 'Use of English', passageId: 8 },
  { id: 4, subject: 'Biology', passageId: 7 }
];
var ROWS = [
  { key: 'a', id: 1, subject: 'Use of English', text: 't1', answer: 0 },
  { key: 'b', id: 2, subject: 'Use of English', text: 't2', answer: 0 },
  { key: 'c', id: 3, subject: 'Use of English', text: 't3', answer: 0 },
  { key: 'd', id: null, subject: 'Use of English', text: 't4', answer: 0 },
  { key: 'e', id: 4, subject: 'Biology', text: 't5', answer: 0 },
  { key: 'f', id: 99, subject: 'Use of English', text: 't6', answer: 0 }
];

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function coreRule() {
  head('Pure rule: core.attachPassagesToMistakes');
  var out = core.attachPassagesToMistakes(ROWS, BANK, [P, { id: 8, subject: 'Use of English', title: 'Held', text: 'x', active: false }]);
  ok('a mistake whose question links to a live passage carries a copy of it',
     out[0].passage && out[0].passage.id === 7 && out[0].passage.title === 'The Flood' && out[0].passage.text === PTXT);
  ok('a standalone question gets no passage', out[1].passage === undefined);
  ok('a held-back passage is not attached', out[2].passage === undefined);
  ok('a row with no id is left alone', out[3].passage === undefined && out[3].key === 'd');
  ok('a passage from another subject is not attached', out[4].passage === undefined);
  ok('a question no longer in the bank is left alone', out[5].passage === undefined);
  ok('the key and answer fields are untouched', out[0].key === 'a' && out[0].answer === 0);
  ok('the stored rows are not changed', ROWS[0].passage === undefined);
  ok('only id, title and text are carried', Object.keys(out[0].passage).sort().join() === 'id,text,title');
  ok('empty and missing input are safe', core.attachPassagesToMistakes(null, null, null).length === 0 && core.attachPassagesToMistakes(ROWS, null, null)[0].passage === undefined);
}

async function demoDriver() {
  head('Demo driver: mistakes and review carry the passage');
  var sandbox = {
    console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {},
    Promise: Promise, JSON: JSON, Math: Math, Date: Date, parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
    encodeURIComponent: encodeURIComponent
  };
  var ctx = vm.createContext(sandbox);
  vm.runInContext('window = this; self = this;', ctx);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(read(f), ctx, { filename: f }); });
  var A = vm.runInContext('GOC.api', ctx);

  await A.login('GOC-A-001', 'founder2027');
  await A.unlockConsole('2027');
  var p = await A.createPassage({ subject: 'Use of English', title: 'The Flood', text: PTXT });
  var qIn = await A.createQuestion({ subject: 'Use of English', section: 'practice', topic: 'Comprehension',
    text: 'What did the villagers watch being carried away?', options: ['The old footbridge', 'A boat', 'A market'], answer: 0, passageId: p.id });
  var qOut = await A.createQuestion({ subject: 'Use of English', section: 'practice', topic: 'Grammar',
    text: 'Pick the correct word.', options: ['their', 'there', 'they'], answer: 1 });
  await activeStudent.demo(A, { signupCode: SIGNUP, name: 'Pat Passage', password: 'secret123', goal: 'JAMB / UTME 2027',
    subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  function rrow(q, n) { return { n: n, id: q.id, subject: 'Use of English', topic: q.topic, text: q.text, options: q.options, answer: 0, given: 1, isCorrect: false, explanation: 'because' }; }
  await A.recordPractice({ mode: 'practice', subject: 'Use of English', total: 2, answered: 2, ts: Date.now() - 3 * 86400000,
    review: [rrow(qIn, 1), rrow(qOut, 2)] });

  var m = (await A.listMistakes()).mistakes;
  var withP = m.filter(function (x) { return x.id === qIn.id; })[0], without = m.filter(function (x) { return x.id === qOut.id; })[0];
  ok('listMistakes: the passage question carries its passage', withP && withP.passage && withP.passage.id === p.id && withP.passage.text === PTXT);
  ok('listMistakes: the standalone question has none', without && without.passage === undefined);
  var rv = (await A.listReview()).review;
  var due = rv.due.filter(function (x) { return x.id === qIn.id; })[0];
  ok('listReview: a due question carries its passage too', due && due.passage && due.passage.title === 'The Flood', JSON.stringify(rv).slice(0, 200));
}

function call(method, url, body, token) {
  return new Promise(function (resolve, reject) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { 'Accept': 'application/json' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers['Authorization'] = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: PORT, path: url, method: method, headers: headers }, function (res) {
      var raw = '';
      res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, body: j, raw: raw }); });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(tries) {
  return call('GET', '/api/health').catch(function (e) {
    if (tries <= 0) throw e;
    return new Promise(function (r) { setTimeout(r, 250); }).then(function () { return waitForBoot(tries - 1); });
  });
}

async function serverRoutes() {
  head('Server: /api/me/mistakes and /api/me/review carry the passage');
  var SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-passage-review-test-'));
  fs.mkdirSync(path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'server'), path.join(SANDBOX, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(SANDBOX, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
    var from = path.join(APP, f);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(SANDBOX, f));
  });
  try { fs.rmSync(path.join(SANDBOX, 'server', 'data.json'), { force: true }); } catch (e) {}
  var child = spawn(process.execPath, [path.join(SANDBOX, 'server', 'server.js')], {
    cwd: SANDBOX,
    env: Object.assign({}, process.env, { PORT: String(PORT), NODE_PATH: path.join(APP, 'node_modules'),
      GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027', GOC_SIGNUP_CODE: SIGNUP }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  var log = '';
  child.stdout.on('data', function (c) { log += c; });
  child.stderr.on('data', function (c) { log += c; });
  try {
    await waitForBoot(40);
    var lin = await call('POST', '/api/auth/login', { id: 'GOC-A-001', password: 'founder2027' });
    var adm = lin.body.token;
    await call('POST', '/api/auth/unlock', { passcode: '2027' }, adm);
    var pr = await call('POST', '/api/passages', { subject: 'Use of English', title: 'The Flood', text: PTXT }, adm);
    var pid = pr.body.id;
    function mk(extra) {
      return Object.assign({ subject: 'Use of English', section: 'practice', topic: 'Comprehension', text: 'What did the villagers watch being carried away?',
        options: ['The old footbridge', 'A boat', 'A market'], answer: 0 }, extra || {});
    }
    var qIn = (await call('POST', '/api/questions', mk({ passageId: pid }), adm)).body;
    var qOut = (await call('POST', '/api/questions', mk({ text: 'Pick the correct word.', topic: 'Grammar' }), adm)).body;
    ok('set-up: a passage and two questions exist', pid > 0 && qIn.id > 0 && qOut.id > 0, JSON.stringify([pr.body, qIn, qOut]).slice(0, 200));

    var su = await activeStudent.signedUp(call, { signupCode: SIGNUP, name: 'Pat Passage', password: 'secret123', email: 'pat.p@example.com',
      phone: '08000000011', goal: 'JAMB / UTME 2027', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
    var tok = su.body.token;
    function rrow(q, n) { return { n: n, id: q.id, subject: 'Use of English', topic: q.topic, text: q.text, options: q.options, answer: 0, given: 1, isCorrect: false, explanation: 'because' }; }
    var rec = await call('POST', '/api/me/practice', { mode: 'practice', subject: 'Use of English', total: 2, answered: 2, correct: 0, wrong: 2, percent: 0,
      ts: Date.now() - 3 * 86400000, topics: [], review: [rrow(qIn, 1), rrow(qOut, 2)] }, tok);
    ok('set-up: a practice run with two wrong answers is stored', rec.status === 200, rec.raw.slice(0, 120));

    var ms = (await call('GET', '/api/me/mistakes', undefined, tok)).body.mistakes;
    var a = ms.filter(function (x) { return x.id === qIn.id; })[0], b = ms.filter(function (x) { return x.id === qOut.id; })[0];
    ok('mistakes: the passage question carries its passage', a && a.passage && a.passage.id === pid && a.passage.title === 'The Flood' && a.passage.text === PTXT);
    ok('mistakes: the standalone question has none', b && b.passage === undefined);
    ok('mistakes: no answer-side field is added beyond what the row already had', a && Object.keys(a.passage).sort().join() === 'id,text,title');

    var rv = (await call('GET', '/api/me/review', undefined, tok)).body.review;
    var d = rv.due.filter(function (x) { return x.id === qIn.id; })[0];
    ok('review: the due session carries the passage', d && d.passage && d.passage.id === pid, JSON.stringify(rv).slice(0, 200));
    ok('review: counts are unchanged by it', rv.dueCount === 2 && rv.due.length === 2, JSON.stringify(rv).slice(0, 200));

    var ans = await call('POST', '/api/me/review', { key: d.key, given: 0 }, tok);
    ok('answering a review still works and is judged by the server', ans.status === 200 && ans.body.correct === true, ans.raw.slice(0, 160));

    await call('PUT', '/api/passages/' + pid + '/active', { active: false }, adm);
    var ms2 = (await call('GET', '/api/me/mistakes', undefined, tok)).body.mistakes;
    var a2 = ms2.filter(function (x) { return x.id === qIn.id; })[0];
    ok('once the passage is held back it is no longer shown, and the question is still listed', a2 && a2.passage === undefined);
  } finally {
    try { child.kill(); } catch (e) {}
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (e) {}
  }
  if (fails) console.log(log.slice(-1500));
}

function screens() {
  head('Screens: the real mkRender and rvRender show the passage');
  var app = read('js/app.js');
  function grab(name) {
    var i = app.indexOf('function ' + name + '(');
    var depth = 0, j = app.indexOf('{', i);
    for (var k = j; k < app.length; k++) {
      if (app[k] === '{') depth++;
      else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
    }
  }
  ok('the helper and both screens call it', /reviewPassageHTML\(m\)/.test(grab('mkRender')) && /reviewPassageHTML\(m\)/.test(grab('rvRender')));
  var els = { mkCount: {}, mkSub: {}, mkList: { innerHTML: '' }, rvHost: { innerHTML: '' }, rvSub: {} };
  var sandbox = {
    studentId: 'GOC-1', document: { getElementById: function (id) { return els[id] || null; } },
    esc: esc, mth: function (s) { return String(s == null ? '' : s); }, rvQueue: [], rvIndex: 0, rvRight: 0, rvAnswered: 0, rvMore: 0, rvNextDue: null,
    rvWhen: function () { return 'tomorrow'; }, Date: Date
  };
  var ctx = vm.createContext(sandbox);
  sandbox.paintQImage = function () {};
  sandbox.askTutorButton = function () { return ''; };   // Ask a tutor button (Phase 4.A) — stubbed here
  ['reviewPassageHTML', 'reviewImageHTML', 'paintReviewImages', 'mkRender', 'rvRender'].forEach(function (n) { vm.runInContext(grab(n), ctx); });
  var withP = { key: 'a', subject: 'Use of English', topic: 'Comprehension', text: 'Q one', options: ['x', 'y'], answer: 0, given: 1, passage: { id: 7, title: 'The Flood', text: 'Line one.\nLine two.' } };
  var plain = { key: 'b', subject: 'Use of English', topic: 'Grammar', text: 'Q two', options: ['x', 'y'], answer: 0, given: 1 };

  sandbox.mkRender([withP, plain]);
  var html = els.mkList.innerHTML, rows = html.split('id="mk1"');
  ok('Mistakes review: the passage box is shown on the passage question', /q-passage[^>]*>.*The Flood/.test(rows[0]) && /Line one\.<br>Line two\./.test(rows[0]));
  ok('Mistakes review: the passage sits above the question text', html.indexOf('The Flood') > -1 && html.indexOf('The Flood') < html.indexOf('Q one'));
  ok('Mistakes review: Try again is still offered', /mkRedo\(0\)/.test(html) && /mkRedo\(1\)/.test(html));
  ok('Mistakes review: a standalone question shows no passage box', rows[1].indexOf('q-passage') === -1);

  sandbox.rvQueue = [withP, plain]; sandbox.rvIndex = 0;
  vm.runInContext('rvRender()', ctx);
  ok('Review due: the passage box is shown above the question', /q-passage/.test(els.rvHost.innerHTML) && els.rvHost.innerHTML.indexOf('The Flood') < els.rvHost.innerHTML.indexOf('Q one'));
  ok('Review due: the options are still drawn', /rvPick\(0\)/.test(els.rvHost.innerHTML) && /rvPick\(1\)/.test(els.rvHost.innerHTML));
  vm.runInContext('rvIndex = 1; rvRender()', ctx);
  ok('Review due: the next, standalone question has no passage box', els.rvHost.innerHTML.indexOf('q-passage') === -1);

  sandbox.mkRender([{ key: 'h', subject: 'Use of English', text: 'Q', options: ['x'], answer: 0, given: 0, passage: { id: 1, title: '<b>t</b>', text: '<img src=x onerror=alert(1)>' } }]);
  ok('a hostile passage is escaped on the review screen', !/<img|<b>/.test(els.mkList.innerHTML) && /&lt;img/.test(els.mkList.innerHTML));
  sandbox.mkRender([{ key: 'i', subject: 'Use of English', text: 'Q', options: ['x'], answer: 0, given: 0, passage: { id: 1, text: 'Body only.' } }]);
  ok('a missing title falls back to "Passage"', />Passage</.test(els.mkList.innerHTML));
}

(async function () {
  try {
    coreRule();
    await demoDriver();
    await serverRoutes();
    screens();
  } catch (e) {
    fails++;
    console.log('THREW: ' + (e && e.stack || e));
  }
  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
})();
