/* Isolated tests of the actual public tutor shell and tutor API response handler. */
'use strict';
var assert = require('assert');
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var src = fs.readFileSync(path.join(__dirname, '..', 'server', 'server.js'), 'utf8');
var tutor = fs.readFileSync(path.join(__dirname, '..', 'server', 'tutor', 'tutor-app.js'), 'utf8');
var shellDecl = src.slice(src.indexOf('const TUTOR_SHELL = '), src.indexOf('\n\n/* Turn barred crawlers away.'));
var shell = vm.runInNewContext(shellDecl + '\nTUTOR_SHELL');
var code = shell.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
var passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  pass  ' + name); }
function response(status, type, body) {
  return { status: status, ok: status >= 200 && status < 300, headers: { get: function () { return type; } }, text: function () { return Promise.resolve(body); } };
}
function json(status, body) { return response(status, 'application/json; charset=utf-8', JSON.stringify(body)); }
function harness() {
  var ids = ['tutorGo', 'tutorErr', 'tutorId', 'tutorPw', 'tutorForm', 'tutorUnavailable', 'tutorUnavailableHeading', 'tutorUnavailableMessage', 'tutorRetry', 'tutorGate'];
  var els = {}, calls = [], queue = [], scripts = [], timers = [];
  ids.forEach(function (id) { els[id] = { value: '', textContent: '', disabled: false, hidden: id === 'tutorUnavailable', style: {}, addEventListener: function (event, fn) { this[event] = fn; } }; });
  var window = {};
  var document = { getElementById: function (id) { return els[id]; }, createElement: function () { return {}; }, body: { appendChild: function (s) { scripts.push(s); } } };
  vm.runInNewContext(code, { window: window, document: document, fetch: function (url, opts) {
    calls.push({ url: url, opts: opts });
    var v = queue.shift(); if (typeof v === 'function') return v();
    if (v instanceof Error) return Promise.reject(v);
    if (!v) throw new Error('Unexpected request: ' + url);
    return Promise.resolve(v);
  }, Blob: function () {}, URL: { createObjectURL: function () { return 'blob:test'; } }, setTimeout: function (fn, delay) { timers.push(delay); }, Promise: Promise });
  return { els: els, calls: calls, queue: queue, scripts: scripts, timers: timers, window: window,
    login: function () { els.tutorId.value = 'GOC-T-001'; els.tutorPw.value = 'secret'; els.tutorGo.click(); },
    retry: function () { els.tutorRetry.click(); } };
}
function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
var success = { token: 'token', user: { id: 'GOC-T-001', role: 'tutor', subjects: ['Physics'] } };
(async function () {
  var h = harness();
  h.queue.push(json(200, success), response(200, 'text/javascript; charset=utf-8', '/* app */'));
  h.login(); await tick();
  ok('valid JSON login loads authenticated app only after bearer verification', function () {
    assert.equal(h.calls.length, 2); assert.equal(h.calls[0].url, 'api/tutor/login'); assert.equal(h.calls[1].url, 'api/tutor/app');
    assert.equal(h.calls[1].opts.headers.Authorization, 'Bearer token'); assert.equal(h.window.__zxSession.token, 'token'); assert.equal(h.scripts.length, 1); assert.equal(h.els.tutorGate.style.display, 'none'); assert.equal(h.els.tutorPw.value, '');
  });
  h = harness(); h.queue.push(json(401, {error:'That ID and password do not match.'})); h.login(); await tick();
  ok('invalid credentials retain normal error and clear password', function () { assert.match(h.els.tutorErr.textContent, /do not match/); assert.equal(h.els.tutorForm.hidden, false); assert.equal(h.els.tutorPw.value, ''); assert.equal(h.els.tutorId.value, 'GOC-T-001'); });
  for (var status of [502, 503, 504]) {
    h = harness(); h.queue.push(response(status, 'text/html', '<html>Starting your app</html>')); h.login(); await tick();
    ok('HTTP ' + status + ' HTML shows waking screen', function () { assert.equal(h.els.tutorUnavailableHeading.textContent, 'G.O.C is waking up'); assert.match(h.els.tutorUnavailableMessage.textContent, /Your tutor account is safe/); assert.equal(h.els.tutorForm.hidden, true); assert.equal(h.els.tutorRetry.textContent, 'Retry Connection'); assert.equal(h.els.tutorPw.value, ''); assert.equal(h.scripts.length, 0); });
  }
  h = harness(); h.queue.push(new Error('network')); h.login(); await tick();
  ok('network failure shows connection error and retry', function () { assert.equal(h.els.tutorUnavailableHeading.textContent, 'Connection problem'); assert.equal(h.els.tutorUnavailable.hidden, false); });
  for (var bad of [response(200, 'text/html', '<html>wrong</html>'), response(200, 'application/json', '{broken'), response(401, 'text/html', 'wrong'), json(200, { token: 'x' })]) {
    h = harness(); h.queue.push(bad); h.login(); await tick();
    ok('unexpected response is never treated as invalid credentials or authentication', function () { assert.equal(h.els.tutorUnavailableHeading.textContent, 'Temporary service error'); assert.equal(h.scripts.length, 0); assert.equal(h.window.__zxSession, undefined); });
  }
  h = harness(); h.queue.push(json(503, {error:'Maintenance underway',maintenance:true})); h.login(); await tick();
  ok('maintenance JSON is distinguished from host 503', function () { assert.equal(h.els.tutorUnavailableHeading.textContent, 'G.O.C is under maintenance'); assert.equal(h.els.tutorUnavailableMessage.textContent, 'Maintenance underway'); });
  h = harness(); h.queue.push(response(503, 'text/html', 'wake')); h.login(); await tick();
  ok('automatic retry limit is zero, with no background requests or timers', function () { assert.equal(h.calls.length, 1); assert.equal(h.timers.length, 0); });
  h.queue.push(response(503, 'text/html', 'wake')); h.retry(); await tick();
  ok('manual retry checks health without credentials and stops after one failed probe', function () { assert.equal(h.calls.length, 2); assert.equal(h.calls[1].url, 'api/health'); assert.equal(h.calls[1].opts.body, undefined); assert.equal(h.timers.length, 0); assert.equal(h.els.tutorUnavailableHeading.textContent, 'G.O.C is waking up'); });
  h.queue.push(json(200, {service:'goc-academy-hub',version:1,passcodeLength:4,free2027:{}})); h.retry(); await tick();
  ok('available health restores the form with ID but no password, without logging in', function () { assert.equal(h.els.tutorForm.hidden, false); assert.equal(h.els.tutorId.value, 'GOC-T-001'); assert.equal(h.els.tutorPw.value, ''); assert.equal(h.calls.length, 3); assert.equal(h.window.__zxSession, undefined); });
  h = harness(); var resolveLogin; h.queue.push(function () { return new Promise(function (resolve) { resolveLogin = resolve; }); }); h.login(); h.els.tutorGo.click();
  ok('duplicate sign-in while pending sends no second POST', function () { assert.equal(h.calls.length, 1); });
  resolveLogin(json(401, {error:'Invalid'})); await tick();
  h = harness(); h.queue.push(json(200, success), response(200, 'text/html', '<html>wake</html>')); h.login(); await tick();
  ok('HTML in place of protected app is never executed', function () { assert.equal(h.scripts.length, 0); assert.equal(h.window.__zxSession, undefined); assert.equal(h.els.tutorUnavailableHeading.textContent, 'Temporary service error'); });
  h = harness(); h.queue.push(json(200, success), json(403, {error:'This tutor account has been switched off.'})); h.login(); await tick();
  ok('server refusal during session verification never opens dashboard', function () { assert.equal(h.scripts.length, 0); assert.equal(h.window.__zxSession, undefined); assert.match(h.els.tutorErr.textContent, /switched off/); });
  h = harness(); h.queue.push(response(503, 'text/html', 'wake')); h.login(); await tick(); var resolveProbe;
  h.queue.push(function () { return new Promise(function (resolve) { resolveProbe = resolve; }); }); h.retry(); h.retry();
  ok('manual retries are single-flight', function () { assert.equal(h.calls.length, 2); }); resolveProbe(json(200, {service:'goc-academy-hub'})); await tick();
  ok('shell never persists passwords or sessions in browser storage', function () { assert.doesNotMatch(shell, /localStorage|sessionStorage|document\.cookie/); });
  // The authenticated tutor app handles all its JSON endpoints through call().
  var fn = tutor.slice(tutor.indexOf('  function connectionError('), tutor.indexOf('\n\n  /* ------------------------------------------------------------------ styles */'));
  async function appCall(r) { var ctx = { st:{token:'t'}, fetch:function(){return Promise.resolve(r);}, JSON:JSON, Promise:Promise }; return vm.runInNewContext(fn + '\ncall("GET", "/tutor/me")', ctx); }
  var result = await appCall(json(200, {tutor:{id:'GOC-T-001'}}));
  ok('tutor session JSON remains readable', function () { assert.equal(result.tutor.id, 'GOC-T-001'); });
  try { await appCall(response(401, 'text/html', 'bad')); assert.fail('expected error'); } catch (e) { ok('HTML cannot falsely expire a tutor session', function () { assert.equal(e.status, undefined); assert.match(e.message, /unexpected/); }); }
  try { await appCall(json(401, {error:'Please sign in again.'})); assert.fail('expected error'); } catch (e) { ok('verified JSON session refusal still expires session', function () { assert.equal(e.status, 401); }); }
  console.log('\n' + passed + ' passed, 0 failed');
})().catch(function (e) { console.error(e.stack || e); process.exitCode = 1; });
