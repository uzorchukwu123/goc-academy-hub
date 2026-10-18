/* test-passages-ui.js — Comprehension passages, slice 4 part 2: the console
   Passages panel (list, add, edit, hold back, delete). Runs the real functions
   from js/app.js against stubs.  node test/test-passages-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }
var html = read('index.html'), app = read('js/app.js'), sw = read('sw.js');

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
function fakeEl(v) {
  var el = { value: v == null ? '' : v, textContent: '', innerHTML: '' };
  return el;
}
function tick() { var p = Promise.resolve(); for (var i = 0; i < 8; i++) p = p.then(function () {}); return p; }

console.log('\nWiring: the section is selectable and the panel loads itself');
ok('the console selector offers Comprehension passages', /<option value="passages">Comprehension passages<\/option>/.test(html));
ok('it sits next to Reading notes', /value="notes"[^\n]*\n\s*<option value="passages"/.test(html));
var pi = app.indexOf("passages: function(){ return (");
var panel = app.slice(pi, app.indexOf("'import': function(){", pi));
ok('the panel has a form, a tabbed list and a totals line',
   /id="admPForm"/.test(panel) && /id="admPTabs"/.test(panel) && /id="admPList"/.test(panel) && /id="admPTotals"/.test(panel));
ok('the panel offers the five real subjects only (no GOC Materials tab)', /subjSeg\(\)/.test(panel) && !/subjSeg\(true\)/.test(panel));
ok("admOpen('passages') calls admPLoad", /if\(section === 'passages'\) admPLoad\(\);/.test(app));
ok('the service worker cache was bumped past v81', /CACHE = 'goc-v(\d+)'/.test(sw) && Number(RegExp.$1) >= 82);

var els = {};
var toasts = [], calls = [], confirms = [], confirmAnswer = true, impl = {};
var sandbox = {
  document: { getElementById: function (id) { return els[id] || null; } },
  esc: function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
  toast: function (m) { toasts.push(m); },
  busy: function () {},
  confirm: function (m) { confirms.push(m); return confirmAnswer; },
  admSubj: 'Use of English',
  admPeek: function (t, n) { t = String(t); return t.length <= n ? t : t.slice(0, n) + '…'; },
  admQOpts: function (pairs, cur) {
    return pairs.map(function (p) { return '<option value="' + p[0] + '"' + (String(p[0]) === String(cur) ? ' selected' : '') + '>' + p[1] + '</option>'; }).join('');
  },
  GOC: { api: {
    listPassages: function (f) { calls.push(['list', f]); return impl.list(f); },
    createPassage: function (d) { calls.push(['create', d]); return impl.create(d); },
    updatePassage: function (id, d) { calls.push(['update', id, d]); return impl.update(id, d); },
    setPassageActive: function (id, on) { calls.push(['active', id, on]); return Promise.resolve({ id: id, active: on }); },
    deletePassage: function (id) { calls.push(['delete', id]); return impl.del ? impl.del(id) : Promise.resolve({ ok: true }); }
  } },
  Promise: Promise, Number: Number, String: String
};
var ctx = vm.createContext(sandbox);
['admPBlank', 'admPNeeds', 'admPCountHTML', 'admPFormHTML', 'admPCount', 'admPRead', 'admPRepaint', 'admPCancel', 'admPSave',
 'admPFind', 'admPEdit', 'admPToggle', 'admPDelete', 'admPSetFilter', 'admPTabsHTML', 'admPLoad', 'admPTotalsLoad', 'admPRender', 'admPCardHTML']
  .forEach(function (n) {
    var src = grab(n);
    if (!src) { fails++; console.log('  FAIL  function ' + n + ' exists'); return; }
    vm.runInContext(src, ctx);
  });
vm.runInContext("var admPFilter = 'all', admPDraft = null, admPCache = [], P_TEXT_MIN = 60, P_TEXT_MAX = 8000;", ctx);

console.log('\nThe form');
var f = sandbox.admPFormHTML();
ok('a new passage says Publish, with no Cancel button', /Publish passage/.test(f) && !/Cancel edit/.test(f));
ok('it names the subject it will be filed under', /filed under Use of English/.test(f));
ok('the character counter states the 60–8000 bounds', /0 characters · between 60 and 8000 — not yet/.test(f));
ok('Active is the default availability', /<option value="yes" selected>/.test(f));
sandbox.admPDraft = { id: 7, title: '<b>T</b>', text: 'x"y', active: false };
f = sandbox.admPFormHTML();
ok('an edit says Update #7 and offers Cancel', /Update passage #7/.test(f) && /Cancel edit/.test(f));
ok('title and text are escaped into the form', !/<b>T<\/b>/.test(f) && /&lt;b&gt;T&lt;\/b&gt;/.test(f) && /x&quot;y/.test(f));
ok('an inactive passage reopens as Inactive', /<option value="no" selected>/.test(f));
sandbox.admPDraft = null;

console.log('\nSaving a new passage');
els.admPTitle = fakeEl('  The  Market '); els.admPText = fakeEl('A'.repeat(70)); els.admPActive = fakeEl('yes');
els.admPForm = fakeEl(); els.admPSaveBtn = fakeEl(); els.admPList = fakeEl(); els.admPTabs = fakeEl(); els.admPCount = fakeEl(); els.admPTotals = fakeEl();
impl.list = function () { return Promise.resolve({ passages: [], total: 0 }); };
impl.create = function (d) { return Promise.resolve({ id: 11, subject: d.subject }); };
sandbox.admPSave();
tick().then(function () {
  var c = calls.filter(function (x) { return x[0] === 'create'; })[0];
  ok('create is sent with the open subject and a trimmed title', c && c[1].subject === 'Use of English' && c[1].title === 'The  Market' && c[1].text.length === 70 && c[1].active === true, JSON.stringify(c));
  ok('staff are told which subject it joined', /Passage #11 published to Use of English/.test(toasts[toasts.length - 1] || ''), toasts.join('|'));
  ok('the form is reset to a blank draft and the list reloads', vm.runInContext('admPDraft.id === null && admPDraft.title === ""', ctx) && calls.some(function (x) { return x[0] === 'list'; }));

  console.log('\nA refusal shows the server\'s own words');
  impl.create = function () { return Promise.reject(new Error('The passage is too short to set questions on — write at least a paragraph.')); };
  els.admPText.value = 'short';
  sandbox.admPSave();
  return tick();
}).then(function () {
  ok('the message is toasted and the draft keeps what was typed', /too short/.test(toasts[toasts.length - 1]) && vm.runInContext('admPDraft.text === "short"', ctx));

  console.log('\nEditing and updating');
  vm.runInContext('admPCache = ' + JSON.stringify([
    { id: 3, subject: 'Use of English', title: 'Live and linked', text: 'Line one.\nLine two.', active: true, questions: 4 },
    { id: 5, subject: 'Use of English', title: 'Held <b>back</b>', text: 'Body', active: false, questions: 0 },
    { id: 6, subject: 'Use of English', title: 'Live, unused', text: 'Body', active: true, questions: 0 }]) + ';', ctx);
  sandbox.admPEdit(3);
  ok('Edit fills the draft from the card', vm.runInContext('admPDraft.id === 3 && admPDraft.title === "Live and linked"', ctx) && /Editing passage #3/.test(toasts[toasts.length - 1]));
  sandbox.admPEdit(99);
  ok('editing one that has gone says so', /no longer published/.test(toasts[toasts.length - 1]));
  impl.update = function (id, d) { return Promise.resolve({ id: id }); };
  els.admPTitle.value = 'Renamed'; els.admPText.value = 'B'.repeat(80);
  sandbox.admPEdit(3); els.admPTitle.value = 'Renamed'; els.admPText.value = 'B'.repeat(80);
  sandbox.admPSave();
  return tick();
}).then(function () {
  var u = calls.filter(function (x) { return x[0] === 'update'; })[0];
  ok('Save on an edit calls update with the passage id', u && u[1] === 3 && u[2].title === 'Renamed', JSON.stringify(u));
  ok('and says it was updated', /Passage #3 updated/.test(toasts[toasts.length - 1]));

  console.log('\nThe list');
  sandbox.admPFilter = 'all';
  vm.runInContext("admPFilter = 'all'", ctx);
  vm.runInContext('admPCache = ' + JSON.stringify([
    { id: 3, title: 'Live and linked', text: 'Line one.\nLine two.', active: true, questions: 4 },
    { id: 5, title: 'Held <b>back</b>', text: 'Body', active: false, questions: 0 },
    { id: 6, title: 'Live, unused', text: 'Body', active: true, questions: 0 }]) + ';', ctx);
  sandbox.admPRender();
  var h = els.admPList.innerHTML;
  ok('every passage is drawn with its id and question count', /#3/.test(h) && /4 questions/.test(h) && /0 questions/.test(h));
  ok('a one-question passage is singular', /1 question</.test(sandbox.admPCardHTML({ id: 9, title: 't', text: 'x', active: true, questions: 1 })));
  ok('a held-back passage is tagged and the button offers Activate', /Held back/.test(h) && /Activate/.test(h));
  ok('a live passage offers Hold back', /Hold back/.test(h));
  ok('a hostile title is escaped', !/<b>back<\/b>/.test(h) && /&lt;b&gt;back&lt;\/b&gt;/.test(h));
  ok('line breaks in the preview are kept', /Line one\.<br>Line two\./.test(h));
  ok('a live passage with no questions is flagged as never seen by students', /Live, unused[\s\S]*No question is linked/.test(h));
  ok('the count line reports passages and how many are live', /3 in Use of English · 2 live/.test(els.admPCount.textContent), els.admPCount.textContent);
  sandbox.admPSetFilter('held');
  ok('the Held back tab shows only the held passage', /#5/.test(els.admPList.innerHTML) && !/#3/.test(els.admPList.innerHTML) && !/#6/.test(els.admPList.innerHTML));
  sandbox.admPSetFilter('live');
  ok('the Active tab hides it', !/#5/.test(els.admPList.innerHTML) && /#3/.test(els.admPList.innerHTML));
  vm.runInContext('admPCache = []', ctx);
  sandbox.admPRender();
  ok('an empty tab explains itself instead of showing nothing', /No passage in Use of English/.test(els.admPList.innerHTML));
  vm.runInContext('admPCache = ' + JSON.stringify([
    { id: 3, title: 'Live and linked', text: 'x', active: true, questions: 4 },
    { id: 5, title: 'Held', text: 'x', active: false, questions: 0 },
    { id: 6, title: 'Live, unused', text: 'x', active: true, questions: 0 }]) + ';', ctx);

  console.log('\nHold back / activate');
  calls.length = 0;
  sandbox.admPToggle(3, false);
  return tick();
}).then(function () {
  ok('Hold back calls setPassageActive(false) and warns the questions go with it', calls[0] && calls[0][0] === 'active' && calls[0][2] === false && /questions are not served either/.test(toasts[toasts.length - 1]));
  calls.length = 0;
  sandbox.admPToggle(5, true);
  return tick();
}).then(function () {
  ok('Activate calls setPassageActive(true)', calls[0] && calls[0][2] === true && /live again/.test(toasts[toasts.length - 1]));

  console.log('\nDelete');
  /* the toggles above reloaded the stubbed list; seed the cache again */
  vm.runInContext('admPCache = ' + JSON.stringify([
    { id: 3, title: 'Live and linked', text: 'x', active: true, questions: 4 },
    { id: 5, title: 'Held', text: 'x', active: false, questions: 0 },
    { id: 6, title: 'Live, unused', text: 'x', active: true, questions: 0 }]) + ';', ctx);
  impl.list = function () { return Promise.resolve({ passages: vm.runInContext('admPCache', ctx), total: 3 }); };
  calls.length = 0; confirms.length = 0;
  sandbox.admPDelete(3);
  ok('a passage with questions is refused before any prompt or call', calls.length === 0 && confirms.length === 0 && /4 questions still use this passage/.test(toasts[toasts.length - 1]), toasts[toasts.length - 1]);
  confirmAnswer = false;
  sandbox.admPDelete(6);
  ok('declining the confirmation deletes nothing', confirms.length === 1 && calls.length === 0);
  confirmAnswer = true; confirms.length = 0;
  sandbox.admPDelete(6);
  return tick();
}).then(function () {
  var kinds = calls.map(function (c) { return c[0] + ':' + c[1] + (c[0] === 'active' ? ':' + c[2] : ''); }).join(' ');
  ok('a live unused passage is held back first, then deleted', /^active:6:false delete:6/.test(kinds), kinds);
  ok('staff are told it is gone', /Passage #6 deleted/.test(toasts[toasts.length - 1]));
  calls.length = 0;
  vm.runInContext('admPCache = [{ id: 5, title: "Held", text: "x", active: false, questions: 0 }]', ctx);
  sandbox.admPDelete(5);
  return tick();
}).then(function () {
  var kinds = calls.map(function (c) { return c[0]; }).join(' ');
  ok('an already-held passage is deleted directly', /^delete/.test(kinds) && kinds.indexOf('active') === -1, kinds);
  impl.del = function () { return Promise.reject(new Error('1 question still use this passage — unlink or delete it first.')); };
  sandbox.admPDelete(5);
  return tick();
}).then(function () {
  ok("a server refusal is shown in the server's words", /still use this passage/.test(toasts[toasts.length - 1]));

  console.log('\nTotals card');
  impl.list = function () { return Promise.resolve({ passages: [{ active: true, questions: 3 }, { active: false, questions: 1 }, { active: true, questions: 0 }], total: 3 }); };
  sandbox.admPTotalsLoad();
  return tick();
}).then(function () {
  ok('it counts passages, live ones and linked questions', /3 passages · 2 live · 4 linked questions/.test(els.admPTotals.innerHTML), els.admPTotals.innerHTML);
  impl.list = function () { return Promise.reject(new Error('locked')); };
  sandbox.admPTotalsLoad();
  return tick();
}).then(function () {
  ok('a failure degrades to "unavailable"', /unavailable/.test(els.admPTotals.innerHTML));
}).catch(function (e) { fails++; console.log('  FAIL  suite crashed   (' + (e && e.stack || e) + ')'); })
.then(function () { console.log('\n' + (fails ? fails + ' FAILED' : 'all passed')); process.exit(fails ? 1 : 0); });
