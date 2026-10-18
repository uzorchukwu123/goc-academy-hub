/* test-tutors-ui.js — Phase 3C slice 3: the console Tutors panel (create, edit, reset, switch
   off) and the Subjects & tutors view, plus the offline driver's behaviour.
   node test/test-tutors-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
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
ok('the selector offers Tutors', /<option value="tutors">Tutors<\/option>/.test(html));
ok('opening it loads the tutors (and the access log)', /if\(section === 'tutors'\)\{ admTutLoad\(\); admAuditLoad\(\); \}/.test(app));

var calls = [], toasts = [], confirms = [], answer = true, tutors = [];
var els = {};
function el(id) { return els[id] || (els[id] = { id: id, value: '', checked: false, innerHTML: '', disabled: false, textContent: '' }); }
var sandbox = {
  GOC: { core: core, api: {
    listTutors: function () { return Promise.resolve({ tutors: tutors }); },
    tutorOverview: function () { return Promise.resolve({ subjects: core.subjectDepth([], []).map(function (r) { r.tutors = r.subject === 'Physics' ? [{ id: 'GOC-T-001', name: 'Ada <b>' }] : []; return r; }) }); },
    createTutor: function (b) { calls.push(['create', b]); return Promise.resolve({ tutor: { id: 'GOC-T-009' } }); },
    updateTutor: function (id, b) { calls.push(['update', id, b]); return Promise.resolve({}); },
    resetTutorPassword: function (id, pw) { calls.push(['reset', id, pw]); return Promise.resolve({}); },
    setTutorActive: function (id, on) { calls.push(['active', id, on]); return Promise.resolve({}); }
  } },
  document: { getElementById: function (id) { return /^(admTutList|admTutOver|admTutSubjNew|admTutName|admTutPw|admTutNewBtn)$/.test(id) || /^admTut[A-Z]_/.test(id) || /^admTutNew_|^admTutE_/.test(id) ? el(id) : null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  initials: function (n) { return String(n).split(' ').map(function (p) { return p[0]; }).join(''); },
  admWhen: function (v) { return 'WHEN(' + v + ')'; },
  confirm: function (m) { confirms.push(m); return answer; },
  toast: function (m) { toasts.push(m); },
  Promise: Promise, String: String, Number: Number, Array: Array
};
var ctx = vm.createContext(sandbox);
var code = ['admTutSubjectBoxes', 'admTutPicked', 'admTutLoad', 'admTutOverLoad', 'admTutOverHTML', 'admTutRender', 'admAuditFillTutors', 'admTutMode', 'admTutCreate', 'admTutSave', 'admTutReset', 'admTutActive'].map(grab).join('\n');
ok('all the panel functions exist', code.split('function ').length - 1 === 12);
vm.runInContext('var admTutCache = [], admTutOpen = {};\n' + code, ctx);
function run(src) { return vm.runInContext(src, ctx); }
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

(async function () {
  console.log('\nthe list');
  tutors = [
    { id: 'GOC-T-001', name: 'Ada Obi', subjects: ['Physics'], active: true, mustChangePassword: true, lastLogin: null },
    { id: 'GOC-T-002', name: 'Bayo Ade', subjects: ['Chemistry', 'Biology'], active: false, mustChangePassword: false, lastLogin: '2026-10-08T10:00:00Z' }
  ];
  run('admTutLoad()'); await tick();
  var list = el('admTutList').innerHTML;
  ok('both tutors are listed with their IDs and subjects', /GOC-T-001/.test(list) && /GOC-T-002/.test(list) && /Chemistry · Biology/.test(list));
  ok('a tutor who must change the password is labelled', /Password change due/.test(list));
  ok('a switched-off tutor is labelled Off and offers Switch on', /ad-tag r">Off/.test(list) && /Switch on/.test(list) && /Switch off/.test(list));
  ok('a tutor who never signed in says so', /Never signed in/.test(list));
  ok('there is no password or hash anywhere in the list', !/pwHash|password"/.test(list));
  var over = el('admTutOver').innerHTML;
  ok('the overview lists every subject', core.ALL_SUBJECTS.every(function (s) { return over.indexOf(s) > -1; }));
  ok('a subject with no tutor says so, one with a tutor names them (escaped)', /No tutor yet/.test(over) && /Ada &lt;b&gt;/.test(over) && !/Ada <b>/.test(over));
  ok('empty papers are flagged', /empty/.test(over));
  tutors = [];
  run('admTutLoad()'); await tick();
  ok('no tutors reads as an empty state', /No tutors yet/.test(el('admTutList').innerHTML));

  console.log('\ncreating');
  el('admTutName').value = 'Mrs New'; el('admTutPw').value = 'short';
  run('admTutCreate()'); await tick();
  ok('no subject chosen is stopped on screen, no request sent', calls.length === 0 && /at least one subject/.test(toasts[toasts.length - 1]), toasts);
  el('admTutNew_1').checked = true; el('admTutNew_2').checked = true;
  run('admTutCreate()'); await tick();
  ok('a short password is stopped on screen', calls.length === 0 && /8 characters/.test(toasts[toasts.length - 1]), toasts);
  el('admTutPw').value = 'long-enough-1';
  run('admTutCreate()'); await tick();
  ok('a good form is sent with the chosen subjects', calls.length === 1 && calls[0][0] === 'create' && calls[0][1].subjects.join() === 'Physics,Chemistry' && calls[0][1].password === 'long-enough-1', JSON.stringify(calls));
  ok('the form clears and the new ID is announced', el('admTutName').value === '' && el('admTutPw').value === '' && /GOC-T-009/.test(toasts[toasts.length - 1]));

  console.log('\nediting, resetting and switching');
  tutors = [{ id: 'GOC-T-001', name: 'Ada Obi', subjects: ['Physics'], active: true, mustChangePassword: false, lastLogin: null }];
  run('admTutLoad()'); await tick();
  run("admTutMode('GOC-T-001','edit')");
  ok('Edit opens the form with their subject ticked', /admTutE_name_GOC-T-001/.test(el('admTutList').innerHTML) && /value="Physics" checked/.test(el('admTutList').innerHTML));
  calls.length = 0;
  el('admTutE_name_GOC-T-001').value = 'Ada Obi-Eze';
  el('admTutE_GOC-T-001_1').checked = true;
  run("admTutSave('GOC-T-001')"); await tick();
  ok('Save sends the name and the ticked subjects', calls.length === 1 && calls[0][0] === 'update' && calls[0][2].name === 'Ada Obi-Eze' && calls[0][2].subjects.join() === 'Physics', JSON.stringify(calls));
  el('admTutE_GOC-T-001_0').checked = false; el('admTutE_GOC-T-001_1').checked = false;
  calls.length = 0;
  run("admTutMode('GOC-T-001','edit')");
  run("admTutSave('GOC-T-001')"); await tick();
  ok('unticking every subject is stopped on screen', calls.length === 0 && /at least one subject/.test(toasts[toasts.length - 1]));
  run("admTutMode('GOC-T-001','reset')");
  el('admTutR_GOC-T-001').value = 'abc';
  run("admTutReset('GOC-T-001')"); await tick();
  ok('a short reset password is stopped on screen', calls.length === 0);
  el('admTutR_GOC-T-001').value = 'new-start-pass';
  run("admTutReset('GOC-T-001')"); await tick();
  ok('a good reset is sent', calls.length === 1 && calls[0][0] === 'reset' && calls[0][2] === 'new-start-pass');
  calls.length = 0; confirms.length = 0; answer = false;
  run("admTutActive('GOC-T-001', false)"); await tick();
  ok('switching off asks first and does nothing on No', confirms.length === 1 && /signed out at once/.test(confirms[0]) && calls.length === 0);
  answer = true;
  run("admTutActive('GOC-T-001', false)"); await tick();
  ok('switching off goes through on Yes', calls.length === 1 && calls[0][2] === false);
  calls.length = 0; confirms.length = 0;
  run("admTutActive('GOC-T-001', true)"); await tick();
  ok('switching on needs no confirm', confirms.length === 0 && calls.length === 1 && calls[0][2] === true);

  console.log('\nthe offline demo driver');
  var s2 = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var c2 = vm.createContext(s2);
  vm.runInContext('window = this; self = this;', c2);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), c2, { filename: f }); });
  var api = vm.runInContext('GOC.api._drivers.mock', c2);
  await api.login('GOC-A-001', 'founder2027'); await api.unlockConsole('2027');
  var names = ['listTutors', 'createTutor', 'updateTutor', 'resetTutorPassword', 'setTutorActive', 'tutorOverview'];
  ok('the offline driver and the wrapper carry every tutor method', names.every(function (n) { return typeof api[n] === 'function' && typeof vm.runInContext('GOC.api', c2)[n] === 'function'; }));
  ok('the HTTP driver defines the same six', names.every(function (n) { return new RegExp('\\b' + n + ': function').test(fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8')); }));
  var r = await api.createTutor({ name: 'A', subjects: ['Physics'], password: 'longenough' }).then(function () { return null; }, function (e) { return e.message; });
  ok('offline, the same validation wording applies (name too short)', /name/i.test(r || ''), r);
  r = await api.createTutor({ name: 'Ada Obi', subjects: ['Physics'], password: 'longenough' }).then(function () { return 'ok'; }, function (e) { return e.message; });
  ok('offline, a good request says it needs a server connection', /server connection/i.test(r), r);
  var ov = await api.tutorOverview();
  ok('offline, the overview still lists every subject with no tutors', ov.subjects.length === core.ALL_SUBJECTS.length && ov.subjects.every(function (x) { return x.tutors.length === 0; }));
  ok('offline, the list is empty', (await api.listTutors()).tutors.length === 0);

  console.log('\n' + (fails ? fails + ' FAILED' : 'all passed'));
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.log('  FAIL  harness error: ' + (e && e.stack || e)); process.exit(1); });
