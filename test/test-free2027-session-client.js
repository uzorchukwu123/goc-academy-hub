/* test-free2027-session-client.js — the BROWSER side of the student session.
   ---------------------------------------------------------------------------
   The server contract lives in test-free2027-auth.js. This suite proves the
   browser half of the same promise, using the real js/free2027-api.js in a vm
   with realistic localStorage / sessionStorage objects:

     • a login token is stored durably, so closing and reopening the browser
       keeps a still-valid session (sessionStorage would not);
     • a token left in the old sessionStorage location is adopted once, so
       nobody who is already signed in is interrupted by the change;
     • signing out sends the request WHILE the token is still held (otherwise
       the server cannot tell which session to end) and only then clears both
       stores;
     • a refused login stores nothing;
     • the login and registration markup the page actually ships is wired to
       these calls.

   node test/test-free2027-session-client.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var apiSrc = read('js/free2027-api.js');
var html = read('index.html');
var rules = require(path.join(APP, 'js', 'goc-free-2027.js'));

var fails = 0;
function ok(n, c, x) { if (c) console.log('  pass  ' + n); else { fails++; console.log('  FAIL  ' + n + (x !== undefined ? '   (' + String(x).slice(0, 240) + ')' : '')); } }
function head(t) { console.log('\n' + t); }

function store(seed) {
  var map = Object.assign({}, seed || {});
  return {
    map: map,
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(map, k) ? map[k] : null; },
    setItem: function (k, v) { map[k] = String(v); },
    removeItem: function (k) { delete map[k]; }
  };
}
var KEY = 'goc.free2027.token';

/* A browser world. `reply` decides what the server answers with. */
function world(opts) {
  var o = opts || {};
  var calls = [];
  var local = store(o.local);
  var session = store(o.session);
  var sandbox = {
    console: console,
    localStorage: local,
    sessionStorage: session,
    GOC: { free2027: rules, api: { staffToken: function () { return 'STAFF'; } } },
    fetch: function (url, init) {
      calls.push({ url: url, init: init });
      var r = o.reply ? o.reply(url, init) : { ok: true, status: 200, body: { token: 'NEW-TOKEN', participant: { id: 'GOC-F-001', name: 'Ada' } } };
      return Promise.resolve({
        ok: r.ok !== false,
        status: r.status || 200,
        text: function () { return Promise.resolve(JSON.stringify(r.body === undefined ? {} : r.body)); }
      });
    },
    Promise: Promise, JSON: JSON, Object: Object, Error: Error, String: String, encodeURIComponent: encodeURIComponent
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  var ctx = vm.createContext(sandbox);
  vm.runInContext(apiSrc, ctx);
  return { ctx: ctx, api: sandbox.GOC.free, calls: calls, local: local, session: session };
}

(async function () {
  head('a login token is stored durably, not per-tab');
  var w = world({});
  await w.api.login({ email: 'ada@example.com', password: 'AdaPass-2027' });
  ok('the login request went to the edition\'s own login route', w.calls.length === 1 && /api\/free2027\/login$/.test(w.calls[0].url), JSON.stringify(w.calls.map(function (c) { return c.url; })));
  ok('the credentials were sent in the body, never in the URL', w.calls[0].url.indexOf('ada@') < 0 && JSON.parse(w.calls[0].init.body).password === 'AdaPass-2027');
  ok('the returned token is kept in localStorage', w.local.map[KEY] === 'NEW-TOKEN', JSON.stringify(w.local.map));
  ok('nothing usable is left in sessionStorage', w.session.map[KEY] === undefined, JSON.stringify(w.session.map));

  head('closing and reopening the browser keeps a still-valid session');
  /* A brand-new page load, with only localStorage carried over — exactly what
     happens when the browser is closed and opened again. */
  var reopened = world({ local: w.local.map });
  ok('the token is read back on a fresh page load', reopened.api.hasToken() && reopened.api.token() === 'NEW-TOKEN');
  var me = await reopened.api.me();
  ok('the reopened browser can read the student\'s own record', !!me && w_lastAuth(reopened) === 'Bearer NEW-TOKEN', w_lastAuth(reopened));

  head('a refresh keeps the session too');
  var refreshed = world({ local: { 'goc.free2027.token': 'NEW-TOKEN' } });
  ok('a refresh still holds the token', refreshed.api.token() === 'NEW-TOKEN');

  head('a token from the older per-tab store is adopted, not discarded');
  var migrated = world({ session: { 'goc.free2027.token': 'OLD-TAB-TOKEN' } });
  ok('the existing signed-in student is not interrupted', migrated.api.token() === 'OLD-TAB-TOKEN');
  ok('it is moved into the durable store', migrated.local.map[KEY] === 'OLD-TAB-TOKEN', JSON.stringify(migrated.local.map));
  ok('and removed from the old one, so sign-out cannot miss it', migrated.session.map[KEY] === undefined);

  head('signing out ends the session on the server BEFORE dropping the token');
  var signed = world({ local: { 'goc.free2027.token': 'LIVE-TOKEN' }, reply: function () { return { ok: true, status: 200, body: { ok: true } }; } });
  var out = await signed.api.logout();
  ok('the logout route was actually called', signed.calls.length === 1 && /api\/free2027\/logout$/.test(signed.calls[0].url), JSON.stringify(signed.calls.map(function (c) { return c.url; })));
  ok('the request carried the token, so the server knows WHICH session to end',
    signed.calls[0].init.headers.Authorization === 'Bearer LIVE-TOKEN', JSON.stringify(signed.calls[0].init.headers));
  ok('the browser copy is gone afterwards', !signed.api.hasToken() && signed.local.map[KEY] === undefined);
  ok('signing out reports success', out && out.ok === true);
  ok('signing out sent no delete/account payload at all', (function () {
    var b = JSON.parse(signed.calls[0].init.body || '{}');
    return Object.keys(b).length === 0;
  })(), signed.calls[0].init.body);

  head('signing out clears both stores even if the server cannot be reached');
  var offline = world({
    local: { 'goc.free2027.token': 'LIVE-TOKEN' },
    session: { 'goc.free2027.token': 'LIVE-TOKEN' },
    reply: function () { return { ok: false, status: 500, body: { error: 'offline' } }; }
  });
  await offline.api.logout();
  ok('the durable copy is cleared', offline.local.map[KEY] === undefined && !offline.api.hasToken());
  ok('the old per-tab copy is cleared as well', offline.session.map[KEY] === undefined);

  head('an expired session is dropped without another round trip');
  var expired = world({ local: { 'goc.free2027.token': 'DEAD-TOKEN' } });
  expired.api.forgetToken();
  ok('the dead token is forgotten locally', !expired.api.hasToken() && expired.local.map[KEY] === undefined);
  ok('no request was needed to forget it', expired.calls.length === 0);

  head('a refused login stores nothing');
  var refused = world({ reply: function () { return { ok: false, status: 403, body: { error: 'That email address or password is not right.' } }; } });
  var msg = null;
  await refused.api.login({ email: 'ada@example.com', password: 'wrong' }).catch(function (e) { msg = e.message; });
  ok('the server\'s own message is surfaced', /not right/.test(msg || ''), msg);
  ok('no token was stored from a failed login', !refused.api.hasToken() && refused.local.map[KEY] === undefined);

  head('the registration code path also stores the session durably');
  var verified = world({});
  await verified.api.registerVerify({ email: 'ada@example.com', code: '123456' });
  ok('verifying the emailed code signs the student in durably too', verified.local.map[KEY] === 'NEW-TOKEN');

  head('the page ships the login screen wired to these calls');
  ok('a dedicated free-login screen exists', /id="free-login"/.test(html));
  (function () {
    var i = html.indexOf('id="free-login"');
    var seg = html.slice(i, html.indexOf('</section>', i));
    ok('it asks for the registered email and password', /id="freeLoginEmail"/.test(seg) && /id="freeLoginPassword"/.test(seg));
    ok('the password field is a real password input', /id="freeLoginPassword" type="password"/.test(seg));
    ok('submitting calls the edition\'s login, not the hub\'s', /freeLogin\(\)/.test(seg) && !/loginNow\(/.test(seg));
    ok('it links to registration', /free-register/.test(seg) && /Register free/.test(seg));
    ok('it offers the code-only student a way to set a password', /set a password/.test(seg));
    ok('it has an error region for the server\'s answer', /id="freeLoginErr"/.test(seg));
  })();
  (function () {
    var i = html.indexOf('id="free-register"');
    var seg = html.slice(i, html.indexOf('</section>', i));
    ok('registration asks for name, email, password and course',
      /id="freeName"/.test(seg) && /id="freeEmail"/.test(seg) && /id="freePassword"/.test(seg) && /id="freeCourse"/.test(seg));
    ok('registration still verifies the email with a code', /id="freeOtp"/.test(seg) && /freeRegisterVerify\(\)/.test(seg));
    ok('registration links to the login page', /free-login/.test(seg) && /Log in/.test(seg));
    ok('the stale "no password to remember" promise is gone', !/no password to remember/i.test(html));
  })();
  ok('the hub\'s own login and signup screens are untouched and separate',
    /id="login-v2"/.test(html) && /id="signup"/.test(html) && /id="loginId"/.test(html) && /id="signPw"/.test(html));

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) {
  console.log('  FAIL  ' + ((e && e.stack) || e));
  process.exit(1);
});

function w_lastAuth(w) {
  var last = w.calls[w.calls.length - 1];
  return last && last.init && last.init.headers ? last.init.headers.Authorization : null;
}
