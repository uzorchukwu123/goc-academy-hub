/* test-passage-picker.js — Comprehension passages, slice 4 part 3: the passage picker
   on the console question form. Runs the real functions from js/app.js against stubs.
   node test/test-passage-picker.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var app = read('js/app.js'), sw = read('sw.js');

var fails = 0;
function ok(name, cond, extra) {
  if (cond) console.log('  pass  ' + name);
  else { fails++; console.log('  FAIL  ' + name + (extra ? '   (' + extra + ')' : '')); }
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
function tick() { var p = Promise.resolve(); for (var i = 0; i < 8; i++) p = p.then(function () {}); return p; }

ok('the service worker cache was bumped past v82', /CACHE = 'goc-v(\d+)'/.test(sw) && Number(RegExp.$1) >= 83);

var els = {}, calls = [], toasts = [], impl = {};
function fakeEl(v) { return { value: v == null ? '' : v, innerHTML: '', parentNode: null }; }
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  toast: function (m) { toasts.push(m); },
  busy: function () {},
  mathPrev: function () { return ''; },
  admSubj: 'Use of English',
  GOC: { api: {
    rules: { PERIOD: 'monthly', theoryAllowed: function () { return true; }, noTheoryMessage: function () { return ''; }, normalizePeriod: function (p) { return p; } },
    listPassages: function (f) { calls.push(['listPassages', f]); return impl.passages(f); },
    createQuestion: function (d) { calls.push(['create', d]); return Promise.resolve({ id: 5 }); },
    updateQuestion: function (id, d) { calls.push(['update', id, d]); return Promise.resolve({ id: id }); }
  } },
  paintQImage: function () {},
  Promise: Promise, Number: Number, String: String
};
var ctx = vm.createContext(sandbox);
['admPeek', 'admQBlank', 'admQNeeds', 'admQOpts', 'admLetter', 'admQPassageHTML', 'admQPassagesLoad', 'admQImageHTML', 'admQImagePaint', 'admQFormHTML',
 'admQRead', 'admQRepaint', 'admQPrevHTML', 'admQSave', 'admQEditQ', 'admQLoad']
  .forEach(function (n) {
    var src = grab(n);
    if (!src) { fails++; console.log('  FAIL  function ' + n + ' exists'); return; }
    vm.runInContext(src, ctx);
  });
vm.runInContext("var admQDraft = null, admQBank = 'webtest', admQCache = [], admQPassages = [];" +
  "function admQTotalsLoad(){} function admQRefLoad(){} function admQPracticeRefLoad(){} function admQRender(){}", ctx);

var PASSAGES = [
  { id: 3, subject: 'Use of English', title: 'The Old Footbridge', active: true, questions: 2 },
  { id: 8, subject: 'Use of English', title: 'A <b>held</b> text', active: false, questions: 0 }
];

console.log('\nThe picker on the form');
var f = sandbox.admQFormHTML();
ok('an objective form has the passage select with None first', /id="admQPassage"/.test(f) && /<option value="" selected>None/.test(f));
ok('with no passage filed, it points to the Passages panel', /No passage is filed under Use of English/.test(f));
vm.runInContext('admQPassages = ' + JSON.stringify(PASSAGES), ctx);
f = sandbox.admQFormHTML();
ok('every passage of the subject is offered by id and title', /<option value="3">#3 · The Old Footbridge<\/option>/.test(f));
ok('a held-back passage is marked, and its title is escaped', /\(held back\)/.test(f) && !/<b>held<\/b>/.test(f));
vm.runInContext("admQDraft = admQBlank(); admQDraft.section = 'theory';", ctx);
f = sandbox.admQFormHTML();
ok('a theory question gets no picker', !/admQPassage/.test(f));
vm.runInContext("admQBank = 'practice'; admQDraft = admQBlank();", ctx);
ok('a practice question gets the picker too', /id="admQPassage"/.test(sandbox.admQFormHTML()));
vm.runInContext("admQBank = 'webtest'; admQDraft = admQBlank(); admQDraft.passageId = 8;", ctx);
ok('an edit reopens with its passage selected', /<option value="8" selected>/.test(sandbox.admQFormHTML()));

console.log('\nSaving');
function fillObjective(pg) {
  vm.runInContext("admQDraft = admQBlank(); admQDraft.topic='Comprehension'; admQDraft.text='What was crossed?';" +
    "admQDraft.options=['A river','B','','']; admQDraft.answer=0;", ctx);
  els.admQPassage = fakeEl(pg); els.admQSaveBtn = fakeEl(); els.admQForm = fakeEl();
}
fillObjective('3');
sandbox.admQSave();
var c = calls.filter(function (x) { return x[0] === 'create'; })[0];
ok('a chosen passage is sent as passageId', c && c[1].passageId === '3', JSON.stringify(c));
calls.length = 0;
fillObjective('');
sandbox.admQSave();
c = calls.filter(function (x) { return x[0] === 'create'; })[0];
ok('None sends a blank passageId, so an edit unlinks', c && c[1].passageId === '', JSON.stringify(c));
calls.length = 0;
vm.runInContext("admQDraft = admQBlank(); admQDraft.section='theory'; admQDraft.id=null; admQDraft.topic='T'; admQDraft.text='Discuss.'; admQDraft.expected='x'; admQDraft.maxMark=10;", ctx);
els.admQPassage = null;
sandbox.admQSave();
c = calls.filter(function (x) { return x[0] === 'create'; })[0];
ok('a theory question never sends a passageId', c && !('passageId' in c[1]), JSON.stringify(c));

console.log('\nEditing');
vm.runInContext("admQCache = [{id:12, section:'objective', topic:'t', text:'q', options:['a','b'], answer:1, passageId:3, period:'monthly'},{id:13, section:'objective', topic:'t', text:'q', options:['a','b'], answer:0, period:'monthly'}];", ctx);
els.admQForm = fakeEl();
sandbox.admQEditQ(12);
ok('editing a linked question loads its passageId', vm.runInContext('admQDraft.passageId', ctx) === 3);
sandbox.admQEditQ(13);
ok('an unlinked question loads a blank one', vm.runInContext('admQDraft.passageId', ctx) === '');

console.log('\nLoading the subject\'s passages');
impl.passages = function () { return Promise.resolve({ passages: PASSAGES, total: 2 }); };
calls.length = 0;
var wrap = { outerHTML: '' };
els.admQPassage = { value: '', parentNode: wrap };
vm.runInContext("admQPassages = []; admQDraft = admQBlank();", ctx);
sandbox.admQPassagesLoad();
tick().then(function () {
  ok('it asks for the open subject only', calls[0] && calls[0][1].subject === 'Use of English');
  ok('only the picker is repainted, with the new passages', /#3 · The Old Footbridge/.test(wrap.outerHTML));
  vm.runInContext("admQDraft.passageId = 99;", ctx);
  sandbox.admQPassagesLoad();
  return tick();
}).then(function () {
  ok('a draft linked to a passage this subject lacks is unlinked', vm.runInContext("admQDraft.passageId", ctx) === '');
  impl.passages = function () { return Promise.reject(new Error('locked')); };
  sandbox.admQPassagesLoad();
  return tick();
}).then(function () {
  ok('a failure leaves an empty list without crashing', vm.runInContext('admQPassages.length', ctx) === 0);
  ok('opening the Questions panel loads the passages', /admQTotalsLoad\(\);\s*admQPassagesLoad\(\);/.test(app));
}).catch(function (e) { fails++; console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')'); })
.then(function () { console.log('\n' + (fails ? fails + ' FAILED' : 'all passed')); process.exit(fails ? 1 : 0); });
