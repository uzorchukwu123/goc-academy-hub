/* test-free2027-founder.js — Founder contact entrance, real HTTP + real frontend flow.
   Covers the configurable server-only gate word, explicit Founder email,
   one authoritative contact request, the existing staff login, the unchanged
   Admin Console Gate, ordinary contact delivery and Academic Director rights.
   node test/test-free2027-founder.js */
'use strict';
var http = require('http');
var path = require('path');
var fs = require('fs');
var os = require('os');
var vm = require('vm');
var spawn = require('child_process').spawn;
var md = require('./minidom.js');
/* minidom deliberately implements only what its suites need; the console menu
   injects its extra tiles with insertAdjacentHTML('beforeend', ...). */
if (!md.El.prototype.insertAdjacentHTML) {
  md.El.prototype.insertAdjacentHTML = function (where, html) { this.innerHTML += html; };
}

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var PORT = Number(process.env.GOC_F27_FOUNDER_PORT) || 8491;
var GATE = 'founder-test-gate-phrase-2027';
var EMAIL = 'founder@gocacademy.test';
var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 280) + ')' : '')); } }
function head(t) { console.log('\n' + t); }
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
function tick(ms) { return new Promise(function (r) { setTimeout(r, ms === undefined ? 30 : ms); }); }

/* ---------------------------------------------------------------- server harness */
function bootServer(tag, port, extraEnv) {
  var sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'goc-f27-founder-' + tag + '-'));
  var data = path.join(sandbox, 'data');
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(path.join(sandbox, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'server'), path.join(sandbox, 'server'), { recursive: true });
  fs.cpSync(path.join(APP, 'js'), path.join(sandbox, 'js'), { recursive: true });
  ['index.html', 'sw.js', 'manifest.webmanifest'].forEach(function (f) {
    var from = path.join(APP, f);
    if (fs.existsSync(from)) fs.cpSync(from, path.join(sandbox, f));
  });
  try { fs.rmSync(path.join(sandbox, 'server', 'data.json'), { force: true }); } catch (e) {}
  var log = '';
  var child = spawn(process.execPath, [path.join(sandbox, 'server', 'server.js')], {
    cwd: sandbox,
    env: Object.assign({}, process.env, {
      PORT: String(port),
      NODE_PATH: [path.join(APP, 'test', 'stubs'), path.join(APP, 'node_modules')].join(path.delimiter),
      GOC_APPWRITE_OFF: '1',
      GOC_TEST_MAIL_FILE: path.join(data, 'mail.jsonl'),
      GOC_SMTP_HOST: 'mailpit-test',
      GOC_SMTP_FROM: 'G.O.C Test <test@gocacademy.test>',
      GOC_FOUNDER_PW: 'founder2027',
      GOC_ACADDIR_PW: 'acaddir2027',
      GOC_PASSCODE: '2027',
      GOC_FOUNDER_EMAIL: EMAIL,
      GOC_FOUNDER_GATE_WORD: GATE,
      GOC_DATA_DIR: data,
      GOC_FREE_2027: '1',
      GOC_TRUST_PROXY: '1'
    }, extraEnv || {}),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', function (c) { log += c; });
  child.stderr.on('data', function (c) { log += c; });
  return { child: child, log: function () { return log; }, port: port, data: data, sandbox: sandbox };
}
function stop(srv) {
  return new Promise(function (resolve) {
    if (!srv || !srv.child || srv.child.exitCode !== null) return resolve();
    var done = false;
    function finish() { if (done) return; done = true; try { fs.rmSync(srv.sandbox, { recursive: true, force: true }); } catch (e) {} resolve(); }
    srv.child.once('exit', finish);
    try { srv.child.kill('SIGTERM'); } catch (e) { finish(); }
    setTimeout(function () { try { srv.child.kill('SIGKILL'); } catch (e) {} finish(); }, 1500).unref();
  });
}
function call(srv, method, urlPath, body, token, ip) {
  return new Promise(function (resolve) {
    var payload = body === undefined ? null : JSON.stringify(body);
    var headers = { Accept: 'application/json', 'X-Forwarded-For': ip || 'direct-test' };
    if (payload) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(payload); }
    if (token) headers.Authorization = 'Bearer ' + token;
    var req = http.request({ host: '127.0.0.1', port: srv.port, method: method, path: urlPath, headers: headers }, function (res) {
      var raw = ''; res.on('data', function (c) { raw += c; });
      res.on('end', function () { var j = null; try { j = JSON.parse(raw); } catch (e) {} resolve({ status: res.statusCode, raw: raw, body: j }); });
    });
    req.on('error', function (e) { resolve({ status: 0, raw: String(e && e.message), body: null }); });
    if (payload) req.write(payload);
    req.end();
  });
}
function waitForBoot(srv, tries) {
  return call(srv, 'GET', '/api/health').then(function (h) {
    if (h.status === 200) return h;
    if (tries <= 0) throw new Error('server did not start: ' + srv.log().slice(-500));
    return tick(100).then(function () { return waitForBoot(srv, tries - 1); });
  });
}
function records(srv) {
  var f = path.join(srv.data, 'data.json');
  if (!fs.existsSync(f)) return [];
  return JSON.parse(fs.readFileSync(f, 'utf8')).contactMessages || [];
}
function mails(srv) {
  var f = path.join(srv.data, 'mail.jsonl');
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map(function (x) { return JSON.parse(x); });
}
function waitForMail(srv, n) {
  var tries = 40;
  function step() {
    if (mails(srv).length >= n || tries-- <= 0) return tick(30);
    return tick(25).then(step);
  }
  return step();
}

/* ---------------------------------------------------------------- frontend harness
   Loads the REAL app scripts and index.html into minidom. fetch() is bridged to
   the real local HTTP server; only the third-party FormSubmit relay is captured
   so the test never sends external mail. Navigation is the app's own go(). */
function makeWorld(srv) {
  var html = read('index.html')
    .replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  var doc = new md.Doc();
  doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];
  var counts = { contact: 0, relay: 0, fetches: [] };
  var storage = {};
  var base = 'http://127.0.0.1:' + srv.port + '/';
  function bridgeFetch(url, opts) {
    var u = String(url);
    counts.fetches.push(u);
    if (u.indexOf('formsubmit.co') > -1) {
      counts.relay++;
      return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve('{"success":"true"}'); }, json: function () { return Promise.resolve({ success: 'true' }); } });
    }
    var absolute = /^https?:/.test(u) ? u : base + u.replace(/^\//, '');
    if (/\/api\/contact$/.test(absolute)) counts.contact++;
    var init = Object.assign({}, opts || {});
    init.headers = Object.assign({}, (opts && opts.headers) || {}, { 'X-Forwarded-For': 'frontend-flow' });
    return fetch(absolute, init);
  }
  var sandbox = {
    console: console, document: doc,
    location: { protocol: 'http:', href: base + 'index.html', host: '127.0.0.1:' + srv.port },
    navigator: { userAgent: 'node-founder-test' },
    innerWidth: 1280, innerHeight: 900,
    matchMedia: function () { return { matches: false, addListener: function () {}, addEventListener: function () {} }; },
    addEventListener: function () {}, removeEventListener: function () {},
    requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
    scrollTo: function () {}, alert: function () {}, confirm: function () { return true; },
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
    encodeURIComponent: encodeURIComponent, decodeURIComponent: decodeURIComponent,
    URL: URL, URLSearchParams: URLSearchParams,
    sessionStorage: { getItem: function (k) { return storage[k] || null; }, setItem: function (k, v) { storage[k] = String(v); }, removeItem: function (k) { delete storage[k]; } },
    localStorage: { getItem: function (k) { return storage[k] || null; }, setItem: function (k, v) { storage[k] = String(v); }, removeItem: function (k) { delete storage[k]; } },
    fetch: bridgeFetch
  };
  sandbox.window = sandbox; sandbox.self = sandbox;
  var ctx = vm.createContext(sandbox);
  vm.runInContext('window = this; self = this;', ctx);
  ['js/goc-core.js', 'js/goc-free-2027.js', 'js/api.js', 'js/app.js', 'js/free2027-api.js', 'js/free2027-ui.js', 'js/free2027-admin.js'].forEach(function (f) {
    vm.runInContext(read(f), ctx, { filename: f });
  });
  function run(code) { return vm.runInContext(code, ctx); }
  function active() { return doc.querySelectorAll('.screen.active').map(function (e) { return e.id; }); }
  function fill(name, email, msg) {
    doc.getElementById('cName').value = name;
    doc.getElementById('cEmail').value = email;
    doc.getElementById('cMsg').value = msg;
  }
  return { ctx: ctx, run: run, doc: doc, active: active, fill: fill, counts: counts,
    ready: Promise.all([run('GOC.api.ready'), run('GOC.freeUI.ready()')]).then(function () { return tick(50); }) };
}

/* ---------------------------------------------------------------- tests */
(async function () {
  var html = read('index.html');
  var appSrc = read('js/app.js');
  var apiSrc = read('js/api.js');
  var uiSrc = read('js/free2027-ui.js');
  var helper = require(path.join(APP, 'server', 'lib', 'founder-contact.js'));

  head('configuration is server-only and fail-closed');
  ok('the gate word is not embedded in frontend JavaScript or markup', [appSrc, apiSrc, uiSrc, html].every(function (s) { return s.indexOf(GATE) < 0 && s.indexOf('GOC_FOUNDER_GATE_WORD') < 0; }));
  ok('a valid configured phrase is read exactly', helper.configuredGateWord({ GOC_FOUNDER_GATE_WORD: GATE }) === GATE);
  ['', 'short', ' leading-space-phrase', 'trailing-space-phrase ', 'control\nphrase-2027', 'x'.repeat(201)].forEach(function (bad) {
    ok('an invalid gate word is refused (' + JSON.stringify(bad.slice(0, 18)) + ')', helper.configuredGateWord({ GOC_FOUNDER_GATE_WORD: bad }) === null);
  });
  ok('unset gate word is refused', helper.configuredGateWord({}) === null);
  ok('matching is exact, case/space sensitive', helper.matchesGateWord(GATE, GATE) && !helper.matchesGateWord(GATE.toUpperCase(), GATE) && !helper.matchesGateWord(GATE + ' ', GATE));
  ok('explicit email is required; no derived address', helper.configuredEmail({}) === null && helper.configuredEmail({ GOC_FOUNDER_EMAIL: 'goc-a-001@gocacademy.com' }) === 'goc-a-001@gocacademy.com' && helper.configuredEmail({ GOC_FOUNDER_EMAIL: 'not-an-email' }) === null);
  ok('configuration status never contains the configured values', helper.configurationStatus({ GOC_FOUNDER_GATE_WORD: GATE, GOC_FOUNDER_EMAIL: EMAIL }).indexOf(GATE) < 0 && helper.configurationStatus({ GOC_FOUNDER_GATE_WORD: GATE, GOC_FOUNDER_EMAIL: EMAIL }).indexOf(EMAIL) < 0);

  head('the old hidden entrance is still gone');
  ok('the fourth statistics card is ordinary (no gate attribute)', /<div class="lp-stat" id="lpStat4"><b>4<\/b><span>Science subjects<\/span><\/div>/.test(html) && !/data-f27-gate/.test(html));
  ok('no gate listener/handler remains in the edition script', !/data-f27-gate|freeGateClick|wireLanding/.test(uiSrc));
  ok('the existing staff login markup is free-admin, not the student login', /id="free-admin"/.test(html) && /freeAdminLogin\(\)/.test(html) && /id="loginId"/.test(html));

  var srv = bootServer('main', PORT, {});
  try {
    await waitForBoot(srv, 60);
    head('real HTTP: configured phrase + explicit Founder email');
    var health = await call(srv, 'GET', '/api/health');
    var pubConfig = await call(srv, 'GET', '/api/free2027/config');
    ok('public configuration endpoints do not expose the gate word or Founder email', [health.raw, pubConfig.raw].every(function (s) { return s.indexOf(GATE) < 0 && s.indexOf(EMAIL) < 0; }));

    var before = records(srv).length, mailBefore = mails(srv).length;
    var good = await call(srv, 'POST', '/api/contact', { name: 'Ernest Uzorchukwu', email: EMAIL, message: GATE }, null, 'http-good');
    ok('1. correct gate word + correct Founder email grants the Founder ROUTE only', good.status === 200 && good.body.founderRequest === true && good.body.next === 'free-admin', good.status + ' ' + good.raw);
    ok('the response issues no token and never names admin-gate', !good.body.token && good.raw.indexOf('admin-gate') < 0 && !good.body.user && !good.body.session, good.raw);
    ok('the gate word alone is not authentication', (await call(srv, 'GET', '/api/free2027/admin/participants')).status === 401);
    await waitForMail(srv, mailBefore + 1);
    ok('one Founder record and one server email attempt', records(srv).length === before + 1 && mails(srv).length === mailBefore + 1, JSON.stringify({ records: records(srv).length - before, mail: mails(srv).length - mailBefore }));

    var wrongWord = await call(srv, 'POST', '/api/contact', { name: 'Ernest', email: EMAIL, message: GATE.toUpperCase() }, null, 'http-word');
    ok('2. incorrect gate word is an ordinary message, never a Founder grant', wrongWord.status === 200 && wrongWord.body.ok === true && !wrongWord.body.founderRequest, wrongWord.status + ' ' + wrongWord.raw);
    var wrongEmail = await call(srv, 'POST', '/api/contact', { name: 'Stranger', email: 'stranger@example.com', message: GATE }, null, 'http-email');
    ok('3. correct gate word + incorrect email is rejected', wrongEmail.status === 403 && !wrongEmail.body.founderRequest, wrongEmail.status);
    ok('the rejection does not reveal the configured email or phrase', wrongEmail.raw.indexOf(EMAIL) < 0 && wrongEmail.raw.indexOf(GATE) < 0);
    var legacy = await call(srv, 'POST', '/api/contact', { name: 'Ernest', email: EMAIL, message: 'GOC FOUNDER' }, null, 'http-legacy');
    ok('the old hardcoded phrase is not a gate once a custom phrase is configured', legacy.status === 200 && !legacy.body.founderRequest, legacy.status);
    var missingName = await call(srv, 'POST', '/api/contact', { name: '', email: EMAIL, message: GATE }, null, 'http-name');
    ok('missing name is still rejected', missingName.status === 400, missingName.status);

    var burst = [];
    for (var i = 0; i < 4; i++) burst.push(await call(srv, 'POST', '/api/contact', { name: 'X', email: 'x' + i + '@example.com', message: GATE }, null, 'http-rate'));
    ok('repeated invalid Founder attempts keep the stricter rate limit', burst.map(function (r) { return r.status; }).join(',') === '403,403,403,429', burst.map(function (r) { return r.status; }).join(','));

    head('real frontend flow: contact -> existing staff login -> console gate');
    var w = makeWorld(srv);
    await w.ready;
    ok('the page boots to the original homepage', w.active().join(',') === 'landing', w.active().join(','));
    w.run("go('admin-gate')");
    ok('7. a visitor is never sent directly to admin-gate', w.active().indexOf('admin-gate') < 0 && w.run('role') !== 'admin' && w.run('adminUnlocked') === false, w.active().join(','));
    w.run("go('landing')");

    var c0 = w.counts.contact, r0 = w.counts.relay, rec0 = records(srv).length, m0 = mails(srv).length;
    w.fill('Visitor', 'visitor@example.com', 'Is the UTME bootcamp free?');
    await w.run('sendContact()');
    await waitForMail(srv, m0 + 1);
    ok('12. ordinary contact messages still work and keep the existing relay behaviour', w.active().join(',') === 'landing' && /Thanks Visitor/.test(w.doc.getElementById('cStatus').textContent) && w.counts.contact === c0 + 1 && w.counts.relay === r0 + 1 && records(srv).length === rec0 + 1, JSON.stringify({ active: w.active(), contact: w.counts.contact - c0, relay: w.counts.relay - r0 }));

    c0 = w.counts.contact; r0 = w.counts.relay; rec0 = records(srv).length; m0 = mails(srv).length;
    w.fill('Stranger', 'stranger@example.com', GATE);
    await w.run('sendContact()');
    ok('8. an incorrect Founder request does not navigate to staff login', w.active().join(',') === 'landing' && w.doc.getElementById('cStatus').classList.contains('err') && !/Thanks/.test(w.doc.getElementById('cStatus').textContent), w.active().join(',') + ' ' + w.doc.getElementById('cStatus').textContent);
    ok('a failed Founder check makes one request, no relay, no duplicate record/email', w.counts.contact === c0 + 1 && w.counts.relay === r0 && records(srv).length === rec0 && mails(srv).length === m0, JSON.stringify({ contact: w.counts.contact - c0, relay: w.counts.relay - r0, records: records(srv).length - rec0, mail: mails(srv).length - m0 }));
    ok('the failed form keeps the entered values for correction', w.doc.getElementById('cEmail').value === 'stranger@example.com' && w.doc.getElementById('cMsg').value === GATE);

    c0 = w.counts.contact; r0 = w.counts.relay; rec0 = records(srv).length; m0 = mails(srv).length;
    w.fill('Ernest Uzorchukwu', EMAIL, GATE);
    await w.run('sendContact()');
    await waitForMail(srv, m0 + 1);
    ok('6. a successful Founder request navigates to the existing staff login', w.active().join(',') === 'free-admin', w.active().join(','));
    ok('5. exactly one backend request per Founder submission (no second POST, no external relay)', w.counts.contact === c0 + 1 && w.counts.relay === r0, JSON.stringify({ contact: w.counts.contact - c0, relay: w.counts.relay - r0 }));
    ok('the successful Founder submission creates one record and one server email attempt', records(srv).length === rec0 + 1 && mails(srv).length === m0 + 1, JSON.stringify({ records: records(srv).length - rec0, mail: mails(srv).length - m0 }));
    ok('the visitor still has no staff session or unlocked console', w.run('role') !== 'admin' && w.run('adminUnlocked') === false && w.run('GOC.api.staffToken()') === null);
    ok('the contact fields are cleared after success', w.doc.getElementById('cMsg').value === '' && w.doc.getElementById('cEmail').value === '');

    w.doc.getElementById('freeAdminId').value = 'GOC-A-001';
    w.doc.getElementById('freeAdminPw').value = 'wrong-password';
    await w.run('freeAdminLogin()');
    ok('incorrect staff credentials keep the visitor on staff login', w.active().join(',') === 'free-admin' && w.run('role') !== 'admin' && /do not match/i.test(w.doc.getElementById('freeAdminErr').textContent), w.active().join(',') + ' ' + w.doc.getElementById('freeAdminErr').textContent);
    w.doc.getElementById('freeAdminPw').value = 'founder2027';
    await w.run('freeAdminLogin()');
    ok('9. correct staff credentials lead to admin-gate, still locked', w.active().join(',') === 'admin-gate' && w.run('role') === 'admin' && w.run('adminUnlocked') === false, w.active().join(','));
    ok('the staff password field is cleared', w.doc.getElementById('freeAdminPw').value === '');

    await w.run("gateKey('9'); gateKey('9'); gateKey('9'); gateKey('9')");
    ok('11. an incorrect console passcode keeps the console locked', w.active().join(',') === 'admin-gate' && w.run('adminUnlocked') === false && /passcode/i.test(w.doc.getElementById('gateErr').textContent), w.active().join(',') + ' ' + w.doc.getElementById('gateErr').textContent);
    ok('protected console data is still refused while locked', await w.run('GOC.api.listStudents().then(function(){return false;},function(){return true;})'));
    await w.run("gateKey('2'); gateKey('0'); gateKey('2'); gateKey('7')");
    await tick(120);
    ok('10. the correct console passcode unlocks the existing console', w.active().join(',') === 'admin' && w.run('adminUnlocked') === true, w.active().join(',') + ' unlocked=' + w.run('adminUnlocked') + ' err=' + w.doc.getElementById('gateErr').textContent);
    ok('the unlocked console can read protected data', await w.run('GOC.api.listStudents().then(function(){return true;},function(){return false;})'));

    head('13. Academic Director permissions remain intact');
    var acad = await call(srv, 'POST', '/api/auth/login', { id: 'GOC-A-002', password: 'acaddir2027' }, null, 'http-acad');
    ok('Academic Director signs in with the normal staff route', acad.status === 200 && acad.body.user.roleKey === 'academic-director', acad.status);
    var at = acad.body.token;
    ok('Academic Director unlocks with the normal console passcode', (await call(srv, 'POST', '/api/auth/unlock', { passcode: '2027' }, at, 'http-acad')).status === 200);
    ok('Academic Director keeps roster/programme access', (await call(srv, 'GET', '/api/students', undefined, at, 'http-acad')).status === 200 && (await call(srv, 'GET', '/api/free2027/admin/participants', undefined, at, 'http-acad')).status === 200);
    var lesson = await call(srv, 'POST', '/api/free2027/admin/lessons', { title: 'Academic Director lesson', subject: 'Biology', summary: 'Still allowed' }, at, 'http-acad');
    ok('Academic Director keeps academic programme management', lesson.status === 200 && /^F27-L-/.test(lesson.body.lesson.id), lesson.status + ' ' + lesson.raw);
    ok('Academic Director still cannot change Website Mode', (await call(srv, 'PUT', '/api/free2027/admin/mode', { mode: 'original', confirm: true }, at, 'http-acad')).status === 403);
    ok('Academic Director still cannot manage Founder-only manager accounts', (await call(srv, 'GET', '/api/managers', undefined, at, 'http-acad')).status === 403);
    ok('the server log never prints the configured phrase or Founder email', srv.log().indexOf(GATE) < 0 && srv.log().indexOf(EMAIL) < 0, srv.log().slice(-300));
  } finally { await stop(srv); }

  head('4. missing Founder email configuration fails safely');
  var noEmail = bootServer('no-email', PORT + 1, { GOC_FOUNDER_EMAIL: '' });
  try {
    await waitForBoot(noEmail, 60);
    /* Even a plausible staff-record/derived address must not become a fallback. */
    var f = path.join(noEmail.data, 'data.json');
    var db = JSON.parse(fs.readFileSync(f, 'utf8'));
    var founder = (db.staff || []).find(function (x) { return x.id === 'GOC-A-001'; });
    if (founder) founder.email = 'goc-a-001@gocacademy.com';
    fs.writeFileSync(f, JSON.stringify(db));
    var recBefore = records(noEmail).length, mailBefore = mails(noEmail).length;
    var r = await call(noEmail, 'POST', '/api/contact', { name: 'Ernest', email: 'goc-a-001@gocacademy.com', message: GATE }, null, 'no-email');
    ok('an exact gate word with no configured Founder email returns a safe configuration error', r.status === 503 && !r.body.founderRequest && !r.body.token, r.status + ' ' + r.raw);
    ok('the error reveals neither the phrase nor a derived/configured address', r.raw.indexOf(GATE) < 0 && r.raw.indexOf('goc-a-001@gocacademy.com') < 0 && r.raw.indexOf(EMAIL) < 0, r.raw);
    ok('no record or email attempt is made for the unconfigured Founder request', records(noEmail).length === recBefore && mails(noEmail).length === mailBefore);
    var ordinary = await call(noEmail, 'POST', '/api/contact', { name: 'Visitor', email: 'visitor@example.com', message: 'Ordinary message still works' }, null, 'no-email');
    ok('ordinary contact is unaffected by missing Founder email configuration', ordinary.status === 200 && ordinary.body.ok === true && !ordinary.body.founderRequest, ordinary.status);
    ok('missing-email startup log is value-free', noEmail.log().indexOf(GATE) < 0 && noEmail.log().indexOf('goc-a-001@gocacademy.com') < 0);
  } finally { await stop(noEmail); }

  head('unset/invalid gate-word configuration closes the Founder entrance safely');
  var noGate = bootServer('no-gate', PORT + 2, { GOC_FOUNDER_GATE_WORD: '' });
  try {
    await waitForBoot(noGate, 60);
    var attempt = await call(noGate, 'POST', '/api/contact', { name: 'Ernest', email: EMAIL, message: GATE }, null, 'no-gate');
    ok('with no configured gate word, no submitted phrase can grant the Founder route', attempt.status === 200 && attempt.body.ok === true && !attempt.body.founderRequest && !attempt.body.token, attempt.status + ' ' + attempt.raw);
    ok('ordinary contact still works while the Founder entrance is closed', (await call(noGate, 'POST', '/api/contact', { name: 'Visitor', email: 'visitor@example.com', message: 'Hello' }, null, 'no-gate')).status === 200);
    ok('startup says the entrance is closed without printing a phrase', /Founder contact entrance: closed/.test(noGate.log()) && noGate.log().indexOf(GATE) < 0 && noGate.log().indexOf(EMAIL) < 0, noGate.log().slice(-300));
  } finally { await stop(noGate); }

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(async function (e) {
  console.log('  FAIL  harness error: ' + (e && e.stack ? e.stack.split('\n').slice(0, 5).join('\n') : e));
  process.exit(1);
});
