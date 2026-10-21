/* test-manager-change-ui.js — roles slice (c): the forced password-change page a new manager sees
   at first sign-in, before the console passcode gate.
   node test/test-manager-change-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var apiSrc = fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8');
var core = require(path.join(APP, 'js', 'goc-core.js'));
var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + String(extra).slice(0, 200) + ')' : '')); }
}
function grab(name) {
  var i = app.indexOf('function ' + name + '(');
  if (i < 0) return '';
  var depth = 0, j = app.indexOf('{', i);
  for (var k = j; k < app.length; k++) {
    if (app[k] === '{') depth++;
    else if (app[k] === '}') { depth--; if (depth === 0) return app.slice(i, k + 1); }
  }
}

console.log('\nthe page');
var sec = html.slice(html.indexOf('id="staff-change-password"'));
sec = sec.slice(0, sec.indexOf('</section>'));
ok('the screen exists and is an auth screen', /<section class="screen auth" id="staff-change-password">/.test(html));
ok('it has the three password fields', ['staffCurPw', 'staffNewPw', 'staffConfirmPw'].every(function (i) { return sec.indexOf('id="' + i + '"') > -1; }));
ok('every field is a password field, not plain text', (sec.match(/type="password"/g) || []).length === 3);
ok('it has a message line and a save button', /id="staffChangeMsg"/.test(sec) && /id="staffChangeBtn"/.test(sec));
ok('submitting runs changeStaffPassword and does not reload the page', /onsubmit="changeStaffPassword\(\);return false"/.test(sec));
ok('there is a way out (Sign out)', /staffChangeCancel\(\)/.test(sec));
ok('it never says the console passcode is changed here', /passcode stays as the Founder set it/.test(sec));
ok('the student change screen is untouched', /<section class="screen auth" id="change-password">/.test(html) && /changeStudentPassword\(\)/.test(html));

console.log('\nsign-in sends a manager with a pending change to the page');
var loginSrc = grab('loginNow');
var iAdmin = loginSrc.indexOf("role === 'admin'"), iChange = loginSrc.indexOf("go('staff-change-password')"), iGate = loginSrc.indexOf("go('admin-gate')");
ok('the redirect is inside the admin branch and before the gate', iAdmin > -1 && iChange > iAdmin && iGate > iChange);

var navs = [], toasts = [], msgs = {}, calls = [], logouts = 0, els = {}, nextUser = null, role = 'student';
function el(id) { return els[id] || (els[id] = { id: id, value: '', disabled: false, textContent: '', dataset: {} }); }
var sandbox = {
  GOC: { core: core, api: {
    ready: Promise.resolve(),
    login: function () { return Promise.resolve(nextUser); },
    changeStaffPassword: function (c, n) { calls.push([c, n]); return sandbox.__result(); }
  } },
  document: { getElementById: function (id) { return /^(staff|loginBtn|loginId|loginPw)/.test(id) ? el(id) : null; } },
  go: function (id) { navs.push(id); },
  toast: function (m) { toasts.push(m); },
  formMsg: function (id, t) { msgs[id] = t; },
  busy: function (b, on) { if (b) b.disabled = !!on; },
  logout: function () { logouts++; },
  animEnter: function () {}, loadSettings: function () {}, ssStart: function () {}, swStart: function () {}, openFlyer: function () {},
  buildWeek: function () {}, renderClasses: function () {}, renderResources: function () {}, loadPublishedResources: function () {},
  loadPublishedVideos: function () {}, loadUpcomingClasses: function () {}, refreshMe: function () {}, renderLeague: function () {},
  applyIdentity: function (u) { sandbox.role = u.role; return true; },
  wtCatalogue: null, role: 'student',
  setTimeout: function () { return 0; },
  console: console, Promise: Promise, String: String, Array: Array
};
sandbox.__result = function () { return Promise.resolve({ ok: true }); };
var ctx = vm.createContext(sandbox);
vm.runInContext([grab('loginNow'), grab('changeStaffPassword'), grab('staffChangeCancel')].join('\n'), ctx);
function run(src) { return vm.runInContext(src, ctx); }
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

(async function () {
  nextUser = { id: 'GOC-A-003', name: 'Ada Obi', role: 'admin', title: 'Finance', mustChangePassword: true };
  navs = []; toasts = [];
  await run("loginNow('GOC-A-003','starter123')"); await tick();
  ok('a manager with a pending change lands on the change page', navs[navs.length - 1] === 'staff-change-password' && navs.indexOf('admin-gate') < 0, JSON.stringify(navs));

  nextUser = { id: 'GOC-A-003', name: 'Ada Obi', role: 'admin', title: 'Finance', mustChangePassword: false };
  navs = [];
  await run("loginNow('GOC-A-003','fresh-pass9')"); await tick();
  ok('a manager with nothing pending goes straight to the passcode gate', navs[navs.length - 1] === 'admin-gate' && navs.indexOf('staff-change-password') < 0, JSON.stringify(navs));

  nextUser = { id: 'GOC-A-001', name: 'Founder', role: 'admin', title: 'Founder', mustChangePassword: false };
  navs = [];
  await run("loginNow('GOC-A-001','x')"); await tick();
  ok('the Founder is unaffected', navs[navs.length - 1] === 'admin-gate');

  nextUser = { id: 'GOC-S-0001', name: 'Student', role: 'student', title: null, mustChangePassword: true };
  navs = [];
  await run("loginNow('GOC-S-0001','x')"); await tick();
  ok('a student with a pending change still gets the student page', navs[navs.length - 1] === 'change-password' && navs.indexOf('staff-change-password') < 0, JSON.stringify(navs));

  console.log('\nsaving');
  function fill(c, n, n2) { el('staffCurPw').value = c; el('staffNewPw').value = n; el('staffConfirmPw').value = n2; }
  calls = []; navs = []; toasts = []; msgs = {};
  fill('', 'fresh-pass9', 'fresh-pass9'); run('changeStaffPassword()');
  ok('a missing starting password is refused on the page', calls.length === 0 && /starting password/i.test(msgs.staffChangeMsg || ''), msgs.staffChangeMsg);
  fill('starter123', '', ''); run('changeStaffPassword()');
  ok('a missing new password is refused on the page', calls.length === 0 && /new password/i.test(msgs.staffChangeMsg || ''), msgs.staffChangeMsg);
  fill('starter123', 'fresh-pass9', 'fresh-pass8'); run('changeStaffPassword()');
  ok('two different new passwords are refused on the page', calls.length === 0 && /do not match/.test(msgs.staffChangeMsg || ''), msgs.staffChangeMsg);
  fill('starter123', 'short1', 'short1'); run('changeStaffPassword()');
  ok('a short password is refused with the shared rule\u2019s words', calls.length === 0 && /at least 8/.test(msgs.staffChangeMsg || ''), msgs.staffChangeMsg);
  fill('starter123', 'lettersonly', 'lettersonly'); run('changeStaffPassword()');
  ok('letters only is refused', calls.length === 0 && /letters and numbers/.test(msgs.staffChangeMsg || ''), msgs.staffChangeMsg);
  fill('starter123', 'starter123', 'starter123'); run('changeStaffPassword()');
  ok('the same password again is refused', calls.length === 0 && /different/.test(msgs.staffChangeMsg || ''), msgs.staffChangeMsg);

  fill('starter123', 'fresh-pass9', 'fresh-pass9'); msgs = {};
  run('changeStaffPassword()'); await tick();
  ok('a good form sends the current and new password, in that order', calls.length === 1 && calls[0][0] === 'starter123' && calls[0][1] === 'fresh-pass9', JSON.stringify(calls));
  ok('the manager goes on to the passcode gate', navs[navs.length - 1] === 'admin-gate', JSON.stringify(navs));
  ok('the three fields are emptied', el('staffCurPw').value === '' && el('staffNewPw').value === '' && el('staffConfirmPw').value === '');
  ok('the button is free again', el('staffChangeBtn').disabled === false);
  ok('the toast points to the passcode', /passcode/.test(toasts[toasts.length - 1] || ''), toasts[toasts.length - 1]);

  console.log('\na refusal from the server');
  sandbox.__result = function () { return Promise.reject(new Error('Your current password is not right.')); };
  fill('wrongpass1', 'fresh-pass9', 'fresh-pass9'); calls = []; navs = []; msgs = {};
  run('changeStaffPassword()'); await tick();
  ok('the server\u2019s words are shown on the page', /current password is not right/.test(msgs.staffChangeMsg || ''), msgs.staffChangeMsg);
  ok('the manager stays on the page and the fields are kept', navs.length === 0 && el('staffNewPw').value === 'fresh-pass9');
  ok('the button is free again', el('staffChangeBtn').disabled === false);

  console.log('\nSign out');
  fill('a', 'b', 'c'); logouts = 0; msgs = {};
  run('staffChangeCancel()');
  ok('it signs out and empties the fields', logouts === 1 && el('staffCurPw').value === '' && el('staffNewPw').value === '' && el('staffConfirmPw').value === '');

  console.log('\nthe drivers');
  var sb = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var dctx = vm.createContext(sb);
  vm.runInContext('window = this; self = this;', dctx);
  vm.runInContext(fs.readFileSync(path.join(APP, 'js', 'goc-core.js'), 'utf8'), dctx);
  vm.runInContext(apiSrc, dctx);
  var drivers = vm.runInContext('GOC.api._drivers', dctx);
  ok('both drivers carry changeStaffPassword', typeof drivers.mock.changeStaffPassword === 'function' && typeof drivers.http.changeStaffPassword === 'function');
  ok('GOC.api forwards it', /changeStaffPassword: function \(c, n\) \{ return active\.changeStaffPassword\(c, n\); \}/.test(apiSrc));
  ok('the HTTP driver posts to the route the server serves, with the names it reads',
    /req\('POST', '\/auth\/password', \{ currentPassword: [^}]*newPassword: /.test(apiSrc));
  function fail(p) { return p.then(function () { return {}; }, function (e) { return { err: e.message }; }); }
  var m = drivers.mock;
  var r0 = await fail(m.changeStaffPassword('a', 'fresh-pass9'));
  ok('offline: refused when nobody is signed in', /Management accounts only/.test(r0.err || ''), r0.err);
  await m.login('GOC-A-001', 'founder2027');
  var r1 = await fail(m.changeStaffPassword('founder2027', 'short'));
  ok('offline: the same checks as the server come first', /at least 8/.test(r1.err || ''), r1.err);
  var r2 = await fail(m.changeStaffPassword('founder2027', 'fresh-pass9'));
  ok('offline: a seeded account is told the Founder changes it in the console', /Founder in the console/.test(r2.err || ''), r2.err);

  console.log('\n' + (fails ? fails + ' FAILED' : 'manager password page: passed'));
  process.exit(fails ? 1 : 0);
})();
