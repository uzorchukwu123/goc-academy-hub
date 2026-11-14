/* test-demo-preview.js — Stage 10: Try G.O.C anonymous preview.

   Real HTTP against a disposable server. Proves:
     1. the draw is exactly five questions with answers/explanations
        withheld, from the dedicated 15-question sample pool only;
     2. submission marks exactly, returns score/percent/full review, and
        the token is single-use;
     3. validation and the per-IP draw limit engage;
     4. isolation: no student record, attempt, XP or data-file change is
        created by playing the demo, and student endpoints stay closed;
     5. the client journey (open, answer, navigate, submit, review,
        try again, unlock) is wired without storing anything.
   Run:  node test/test-demo-preview.js  */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var crypto = require('crypto');
var spawn = require('child_process').spawn;
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_DEMO_PORT) || 8185;
var pool = require(path.join(APP, 'server', 'lib', 'demo-questions.js'));
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var index = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var serverSrc = fs.readFileSync(path.join(APP, 'server', 'server.js'), 'utf8');

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x ? '   (' + String(x).slice(0, 160) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

var TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-demo-'));
var DATA = path.join(TMP, 'data');
fs.mkdirSync(DATA, { recursive: true });
var env = Object.assign({}, process.env, { PORT: String(PORT), GOC_DATA_DIR: DATA, GOC_FOUNDER_PW: 'founder2027', GOC_ACADDIR_PW: 'acaddir2027', GOC_PASSCODE: '2027' });
var child = spawn(process.execPath, [path.join(APP, 'server', 'server.js')], { env: env, stdio: ['ignore', 'pipe', 'pipe'] });
var log = '';
child.stdout.on('data', function (c) { log += c; });
child.stderr.on('data', function (c) { log += c; });
process.on('exit', function () { try { child.kill(); } catch (e) {} });

function call(method, urlPath, body) {
  return new Promise(function (resolve) {
    var payload = body == null ? null : JSON.stringify(body);
    var h = {};
    if (payload) { h['Content-Type'] = 'application/json'; h['Content-Length'] = Buffer.byteLength(payload); }
    var req = http.request({ host: '127.0.0.1', port: PORT, method: method, path: urlPath, headers: h }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e), body: null }); });
    if (payload) req.write(payload); req.end();
  });
}
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function correctIndex(q) {
  var src = pool.filter(function (p) { return p.text === q.text; })[0];
  return q.options.indexOf(src.options[src.answer]);
}
function dataHash() {
  var f = path.join(DATA, 'data.json');
  return fs.existsSync(f) ? crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') : 'none';
}

(async function () {
  for (var n = 0; n < 60 && log.indexOf('is running') < 0; n++) await wait(150);
  ok('the server boots', log.indexOf('is running') >= 0, log.slice(-200));
  var before = dataHash();

  head('the pool itself');
  ok('fifteen original sample questions, four options each, one answer, an explanation',
    pool.length === 15 && pool.every(function (q) { return q.options.length === 4 && q.answer >= 0 && q.answer < 4 && q.explanation.length > 20; }));
  ok('pool ids are demo-only and unique', pool.every(function (q) { return /^demo-/.test(q.id); })
    && new Set(pool.map(function (q) { return q.id; })).size === 15);
  ok('the pool file connects to no bank', !/questions\b.*(db|data)|readData|writeData/.test(fs.readFileSync(path.join(APP, 'server', 'lib', 'demo-questions.js'), 'utf8')));

  head('an anonymous draw');
  var draw = await call('GET', '/api/demo/questions');
  ok('exactly five questions come back', draw.status === 200 && draw.body.questions.length === 5, draw.raw.slice(0, 120));
  ok('no answer or explanation is ever sent in the draw', draw.body.questions.every(function (q) {
    return q.answer === undefined && q.explanation === undefined && q.id === undefined;
  }), draw.raw.slice(0, 200));
  ok('every drawn question is from the sample pool', draw.body.questions.every(function (q) {
    return pool.some(function (p) { return p.text === q.text; });
  }));
  ok('numbering and subjects travel with the questions', draw.body.questions[0].n === 1 && !!draw.body.questions[0].subject);

  head('marking, review, single use');
  var perfect = draw.body.questions.map(correctIndex);
  var res = await call('POST', '/api/demo/submit', { token: draw.body.token, answers: perfect });
  ok('a perfect run scores 5 of 5 at 100%', res.status === 200 && res.body.score === 5 && res.body.percent === 100, res.raw.slice(0, 140));
  ok('the review carries correct answers and explanations', res.body.review.length === 5
    && res.body.review.every(function (r) { return r.isCorrect && r.explanation.length > 20 && r.options[r.answer]; }));
  var replay = await call('POST', '/api/demo/submit', { token: draw.body.token, answers: perfect });
  ok('the same token cannot be redeemed twice', replay.status === 410, replay.status);

  var draw2 = await call('GET', '/api/demo/questions');
  var wrong = draw2.body.questions.map(function (q) { return (correctIndex(q) + 1) % 4; });
  var res2 = await call('POST', '/api/demo/submit', { token: draw2.body.token, answers: wrong });
  ok('a fully wrong run scores 0 with incorrect verdicts', res2.body.score === 0 && res2.body.review.every(function (r) { return !r.isCorrect; }));

  var draw3 = await call('GET', '/api/demo/questions');
  var bad = await call('POST', '/api/demo/submit', { token: draw3.body.token, answers: [0, 1, 2] });
  ok('a malformed submission is refused', bad.status === 400, bad.status);
  ok('an unknown token is refused as expired', (await call('POST', '/api/demo/submit', { token: 'nope', answers: [0, 0, 0, 0, 0] })).status === 410);

  head('abuse protection');
  var limited = false;
  for (var i = 0; i < 35 && !limited; i++) { var d = await call('GET', '/api/demo/questions'); if (d.status === 429) limited = true; }
  ok('repeated draws from one connection are rate-limited', limited);

  head('isolation from student operations');
  ok('playing the demo changed nothing in the data file', dataHash() === before, before + ' vs ' + dataHash());
  ok('student endpoints stay closed to the anonymous visitor', (await call('GET', '/api/me/tests')).status === 401
    && (await call('GET', '/api/me/mynotes')).status === 401);
  ok('the demo routes touch no student machinery', !/submitStudy|recordPractice|xpAwarded|attempts\.push/.test(
    serverSrc.slice(serverSrc.indexOf('Try G.O.C: anonymous'), serverSrc.indexOf('The daily affirmation flyer'))));

  head('client journey wiring');
  ok('the homepage Try button opens the demo', /onclick="demoOpen\(\)"/.test(index) && /function demoOpen\(\)/.test(app));
  ok('the demo screen carries intro, play and result states', /id="demoIntro"/.test(index) && /id="demoPlay"/.test(index) && /id="demoResult"/.test(index));
  ok('navigation, palette and answer states mirror real Practice', /id="demoPalette"/.test(index) && /function demoRender\(\)/.test(app) && /demoAns\[demoI\] = i/.test(app));
  ok('submission confirms when questions are unanswered', /unanswered question/.test(app) && /demoSubmit\(\)/.test(app));
  ok('results offer Try again and an honest Unlock path', /onclick="demoStart\(\)">Try again<\/button>/.test(app) && /Unlock the full G\.O\.C experience/.test(app) && /Registration comes first/.test(app));
  var demoCode = app.slice(app.indexOf('TRY G.O.C — ANONYMOUS PREVIEW'));
  demoCode = demoCode.slice(0, demoCode.indexOf('function setResFilter'));
  ok('the client stores nothing and awards nothing', !/localStorage|sessionStorage|xpAward|awardXp|XP earned/.test(demoCode));
  ok('the client never touches an authenticated API helper', !/GOC\.api/.test(demoCode));

  child.kill();
  console.log('\n' + (fails ? fails + ' check(s) FAILED' : 'demo preview: all checks passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('FAIL  ' + (e && e.stack || e)); try { child.kill(); } catch (_) {} process.exit(1); });
