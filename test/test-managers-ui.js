/* test-managers-ui.js — roles slice (c): the console Managers panel (create, reset, switch off,
   delete) and the offline driver's behaviour.
   node test/test-managers-ui.js */
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

console.log('\nthe section is on the console');
ok('the selector offers Managers', /<option value="managers">Managers<\/option>/.test(html));
ok('opening it loads the managers', /if\(section === 'managers'\)\{[^}]*admMgLoad[^}]*admMgLogLoad[^}]*\}/.test(app));
ok('the panel is one of the section views', /managers: function\(\)\{ return \(/.test(app));

var calls = [], toasts = [], confirms = [], answer = true, managers = [];
var els = {};
function el(id) { return els[id] || (els[id] = { id: id, value: '', innerHTML: '', disabled: false, textContent: '' }); }
var sandbox = {
  GOC: { core: core, api: {
    listManagers: function () { return Promise.resolve({ managers: managers }); },
    createManager: function (b) { calls.push(['create', b]); return Promise.resolve({ manager: { id: 'GOC-A-003' } }); },
    setManagerActive: function (id, on) { calls.push(['active', id, on]); return Promise.resolve({}); },
    resetManagerPassword: function (id, pw, pc) { calls.push(['reset', id, pw, pc]); return Promise.resolve({ passcodeChanged: !!pc }); },
    deleteManager: function (id) { calls.push(['delete', id]); return Promise.resolve({ deleted: true }); }
  } },
  document: { getElementById: function (id) { return /^admMg/.test(id) ? el(id) : null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  initials: function (n) { return String(n).split(' ').map(function (p) { return p[0]; }).join(''); },
  confirm: function (m) { confirms.push(m); return answer; },
  toast: function (m) { toasts.push(m); },
  Promise: Promise, String: String, Number: Number, Array: Array, RegExp: RegExp
};
var ctx = vm.createContext(sandbox);
var code = ['admMgRoleOptions', 'admMgLoad', 'admMgRender', 'admMgMode', 'admMgCreate', 'admMgReset', 'admMgActive', 'admMgDelete'].map(grab).join('\n');
ok('all the panel functions exist', code.split('function ').length - 1 === 8);
vm.runInContext('var admMgCache = [], admMgOpen = {};\n' + code, ctx);
function run(src) { return vm.runInContext(src, ctx); }
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

(async function () {
  console.log('\nthe role choice');
  var opts = run('admMgRoleOptions()');
  ok('offers each of the four manager roles', (opts.match(/<option /g) || []).length === 4, opts);
  ok('never offers the Founder', !/founder/i.test(opts));

  console.log('\nthe list');
  managers = [
    { id: 'GOC-A-003', name: 'Emeka <b>Eze', role: 'student-affairs', title: 'Student Affairs', active: true, mustChangePassword: true },
    { id: 'GOC-A-004', name: 'Ngozi Obi', role: 'finance', title: 'Finance', active: false, mustChangePassword: false },
    { id: 'GOC-A-005', name: 'Tunde Ade', role: 'finance', title: 'Finance', active: true, mustChangePassword: false }
  ];
  await run('admMgLoad()'); await tick();
  var h = el('admMgList').innerHTML;
  ok('every manager is listed with their ID', /GOC-A-003/.test(h) && /GOC-A-004/.test(h) && /GOC-A-005/.test(h));
  ok('a hostile name is escaped', /Emeka &lt;b&gt;Eze/.test(h) && !/<b>Eze/.test(h));
  ok('a first-time manager shows Password change due', /Password change due/.test(h));
  ok('a switched-off manager shows Off and offers Switch on', /ad-tag r">Off/.test(h) && /Switch on/.test(h));
  ok('an active manager shows Active', /ad-tag g">Active/.test(h));
  ok('each row has Delete', (h.match(/>Delete</g) || []).length === 3);
  ok('no password, hash or passcode appears', !/hash|passcode"|pwHash/i.test(h.replace(/Console passcode/g, '')));

  managers = [];
  await run('admMgLoad()'); await tick();
  ok('an empty list says so', /No managers yet/.test(el('admMgList').innerHTML));

  console.log('\ncreate');
  el('admMgName').value = 'A'; el('admMgRole').value = 'finance'; el('admMgPw').value = 'abc12345'; el('admMgPc').value = '4821';
  calls = []; toasts = [];
  run('admMgCreate()');
  ok('a name that is too short is refused on the page', toasts.length === 1 && calls.length === 0, toasts[0]);
  el('admMgName').value = 'Ngozi Obi'; el('admMgPc').value = '12';
  toasts = []; run('admMgCreate()');
  ok('a bad passcode is refused on the page', /4 to 8 digits/.test(toasts[0] || '') && calls.length === 0, toasts[0]);
  el('admMgPc').value = '4821'; el('admMgPw').value = 'short';
  toasts = []; run('admMgCreate()');
  ok('a short password is refused on the page', /at least 8/.test(toasts[0] || '') && calls.length === 0, toasts[0]);
  el('admMgPw').value = 'abc12345'; toasts = [];
  run('admMgCreate()'); await tick();
  ok('a good form is sent', calls.length === 1 && calls[0][0] === 'create' && calls[0][1].role === 'finance' && calls[0][1].passcode === '4821', JSON.stringify(calls));
  ok('the fields are cleared afterwards', el('admMgName').value === '' && el('admMgPw').value === '' && el('admMgPc').value === '');
  ok('the toast names the new ID', /GOC-A-003/.test(toasts[0] || ''), toasts[0]);

  console.log('\nreset');
  managers = [{ id: 'GOC-A-003', name: 'Emeka Eze', role: 'finance', title: 'Finance', active: true, mustChangePassword: false }];
  await run('admMgLoad()'); await tick();
  run("admMgMode('GOC-A-003','reset')");
  ok('the reset form opens inline', /admMgR_pw_GOC-A-003/.test(el('admMgList').innerHTML) && /admMgR_pc_GOC-A-003/.test(el('admMgList').innerHTML));
  el('admMgR_pw_GOC-A-003').value = 'abc'; calls = []; toasts = [];
  run("admMgReset('GOC-A-003')");
  ok('a short password is refused on the page', calls.length === 0 && toasts.length === 1, toasts[0]);
  el('admMgR_pw_GOC-A-003').value = 'newpass123'; el('admMgR_pc_GOC-A-003').value = 'abcd'; toasts = [];
  run("admMgReset('GOC-A-003')");
  ok('a bad passcode is refused on the page', /4 to 8 digits/.test(toasts[0] || '') && calls.length === 0, toasts[0]);
  el('admMgR_pc_GOC-A-003').value = ''; toasts = [];
  run("admMgReset('GOC-A-003')"); await tick();
  ok('a reset without a passcode keeps the passcode', calls.length === 1 && calls[0][0] === 'reset' && calls[0][2] === 'newpass123' && calls[0][3] === '', JSON.stringify(calls));
  ok('the form closes after a reset', !/admMgR_pw_/.test(el('admMgList').innerHTML));
  run("admMgMode('GOC-A-003','reset')");
  el('admMgR_pw_GOC-A-003').value = 'newpass123'; el('admMgR_pc_GOC-A-003').value = '9999'; calls = []; toasts = [];
  run("admMgReset('GOC-A-003')"); await tick();
  ok('a typed passcode is sent and the toast says both changed', calls[0] && calls[0][3] === '9999' && /passcode/.test(toasts[0] || ''), JSON.stringify(calls) + toasts[0]);

  console.log('\nswitch off, on, and delete');
  calls = []; answer = false; confirms = [];
  run("admMgActive('GOC-A-003', false)");
  ok('switching off asks first, and No sends nothing', confirms.length === 1 && calls.length === 0);
  answer = true; run("admMgActive('GOC-A-003', false)"); await tick();
  ok('switching off, once confirmed, is sent', calls.length === 1 && calls[0][0] === 'active' && calls[0][2] === false);
  confirms = []; calls = [];
  run("admMgActive('GOC-A-003', true)"); await tick();
  ok('switching on does not ask and is sent', confirms.length === 0 && calls.length === 1 && calls[0][2] === true);
  calls = []; confirms = []; answer = false;
  run("admMgDelete('GOC-A-003')");
  ok('delete asks first, names the ID, and No sends nothing', confirms.length === 1 && /GOC-A-003/.test(confirms[0]) && calls.length === 0);
  answer = true; run("admMgDelete('GOC-A-003')"); await tick();
  ok('delete, once confirmed, is sent', calls.length === 1 && calls[0][0] === 'delete' && calls[0][1] === 'GOC-A-003');

  console.log('\na refusal from the server is shown as it comes');
  sandbox.GOC.api.createManager = function () { return Promise.reject(new Error('Only the Founder can do that.')); };
  el('admMgName').value = 'Ngozi Obi'; el('admMgPw').value = 'abc12345'; el('admMgPc').value = '4821'; toasts = [];
  run('admMgCreate()'); await tick();
  ok('the server message reaches the toast and the form is kept', /Only the Founder/.test(toasts[0] || '') && el('admMgName').value === 'Ngozi Obi', toasts[0]);

  console.log('\nthe offline driver');
  var sb = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var dctx = vm.createContext(sb);
  vm.runInContext('window = this; self = this;', dctx);
  vm.runInContext(fs.readFileSync(path.join(APP, 'js', 'goc-core.js'), 'utf8'), dctx);
  vm.runInContext(apiSrc, dctx);
  var drivers = null;
  drivers = vm.runInContext('GOC.api._drivers', dctx);
  ok('both drivers carry every manager call', !!drivers && ['listManagers', 'createManager', 'setManagerActive', 'resetManagerPassword', 'deleteManager'].every(function (m) { return typeof drivers.mock[m] === 'function' && typeof drivers.http[m] === 'function'; }));
  ok('GOC.api forwards every manager call', ['listManagers', 'createManager', 'setManagerActive', 'resetManagerPassword', 'deleteManager'].every(function (m) { return new RegExp(m + ': function').test(apiSrc.slice(apiSrc.indexOf('active.listManagers') - 200)); }));
  if (drivers) {
    var mock = drivers.mock;
    var r1 = await mock.listManagers().then(function (x) { return x; }, function (e) { return { err: e.message }; });
    ok('the offline panel is refused until the console is unlocked', !!(r1 && r1.err), JSON.stringify(r1));
    var rc = await mock.createManager({ name: 'A', role: 'finance', password: 'abc12345', passcode: '4821' }).then(function () { return {}; }, function (e) { return { err: e.message }; });
    ok('creating offline is refused (locked first)', !!rc.err, JSON.stringify(rc));
    await mock.login('GOC-A-001', 'founder2027');
    await mock.unlockConsole('2027');
    var rl = await mock.listManagers();
    ok('unlocked, the offline list is empty and carries the four roles', rl && rl.managers && rl.managers.length === 0 && rl.roles.length === 4, JSON.stringify(rl));
    function fail(p) { return p.then(function () { return {}; }, function (e) { return { err: e.message }; }); }
    var e1 = await fail(mock.createManager({ name: 'A', role: 'finance', password: 'abc12345', passcode: '4821' }));
    ok('offline create checks the form first', /name/i.test(e1.err || ''), e1.err);
    var e2 = await fail(mock.createManager({ name: 'Ngozi Obi', role: 'finance', password: 'abc12345', passcode: '4821' }));
    ok('offline create then says it needs a server', /server connection/.test(e2.err || ''), e2.err);
    var e3 = await fail(mock.resetManagerPassword('GOC-A-003', 'abc', ''));
    ok('offline reset checks the password first', /at least 8/.test(e3.err || ''), e3.err);
    var e4 = await fail(mock.setManagerActive('GOC-A-003', 'yes'));
    ok('offline on/off wants a true or false', /on or off/.test(e4.err || ''), e4.err);
    var e5 = await fail(mock.deleteManager('GOC-A-003'));
    ok('offline delete says it needs a server', /server connection/.test(e5.err || ''), e5.err);
  }

  console.log('\n' + (fails ? fails + ' FAILED' : 'managers panel: passed'));
  process.exit(fails ? 1 : 0);
})();
