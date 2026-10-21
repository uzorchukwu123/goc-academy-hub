/* test-approvals-ui.js — Phase 3C slice 6.4: the console "Awaiting approval" screen and its badge,
   plus the offline driver's behaviour.
   node test/test-approvals-ui.js */
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
ok('the selector offers Awaiting approval', /<option value="approvals">Awaiting approval<\/option>/.test(html));
ok('opening it loads the queue', /if\(section === 'approvals'\) admApLoad\(\);/.test(app));
ok('opening the console reads the badge', /if\(id === 'admin'\)\{ admOpen\('overview'\); admKpiLoad\(\); if\(typeof admApBadge === 'function'\) admApBadge\(\); \}/.test(app));
ok('the panel is in the section map', /approvals: function\(\)\{ return \(/.test(app));
ok('the three drivers carry the four approval methods', ['listApprovals', 'approveQuestion', 'returnQuestion', 'approveBatch'].every(function (m) { return (apiSrc.split(m + ':').length - 1) >= 3; }));

var calls = [], toasts = [], confirms = [], answer = true, queue = [], fail = null;
var els = {};
function el(id) { return els[id] || (els[id] = { id: id, value: '', innerHTML: '', textContent: '', options: [] }); }
var sel = { options: [{ value: 'overview', textContent: 'Overview' }, { value: 'approvals', textContent: 'Awaiting approval' }] };
function done(v) { return fail ? Promise.reject(new Error(fail)) : Promise.resolve(v || {}); }
var sandbox = {
  GOC: { core: core, api: {
    listApprovals: function (s) { calls.push(['list', s]); return Promise.resolve({ count: queue.length, queue: queue.filter(function (q) { return !s || q.subject === s; }) }); },
    approveQuestion: function (id, edit) { calls.push(['approve', id, edit]); return done({}); },
    returnQuestion: function (id, why) { calls.push(['return', id, why]); return done({}); },
    approveBatch: function (b) { calls.push(['batch', b]); return done({ approved: 2, skipped: 0 }); }
  } },
  document: { getElementById: function (id) { return id === 'admSelect' ? sel : (/^adm(Ap|ApList|ApSubject)/.test(id) || /^admApE_|^admApR_/.test(id) ? el(id) : null); } },
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); },
  admWhen: function (v) { return 'WHEN(' + v + ')'; },
  confirm: function (m) { confirms.push(m); return answer; },
  toast: function (m) { toasts.push(m); },
  Promise: Promise, String: String, Number: Number, Array: Array
};
var ctx = vm.createContext(sandbox);
var names = ['admApBadge', 'admApSetBadge', 'admApLoad', 'admApOptionsHTML', 'admApRender', 'admApSetMode', 'admApDone', 'admApFail', 'admApApprove', 'admApVal', 'admApSaveApprove', 'admApReturn', 'admApBatch'];
var code = names.map(grab).join('\n');
ok('all the screen functions exist', code.split('function ').length - 1 === names.length);
vm.runInContext('var admApCache = [], admApMode = {}, admApBusy = false;\n' + code, ctx);
function run(src) { return vm.runInContext(src, ctx); }
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

(async function () {
  queue = [
    { id: 11, subject: 'Chemistry', topic: 'Acids <i>', kind: 'objective', section: 'objective', text: 'Which is a strong acid <b>?', options: ['Ethanoic', 'Hydrochloric', 'Citric'], answer: 1, explanation: 'HCl ionises fully.', addedBy: 'GOC-T-001', addedByName: 'Ada <u>Obi', addedAt: '2026-10-08T09:00:00Z', batch: 'IMP-A', status: 'pending' },
    { id: 12, subject: 'Chemistry', topic: 'Salts', kind: 'objective', section: 'objective', text: 'Which salt is soluble?', options: ['AgCl', 'NaCl'], answer: 1, addedByName: 'Ada Obi', addedAt: '2026-10-08T09:01:00Z', batch: 'IMP-A', status: 'pending' },
    { id: 13, subject: 'Physics', topic: 'Waves', kind: 'theory', section: 'theory', text: 'Explain refraction of light.', expected: 'Bending of light at a boundary because speed changes.', maxMark: 5, addedByName: 'Mr Eze', addedAt: '2026-10-08T09:02:00Z', status: 'pending' }
  ];

  console.log('\nthe queue');
  run('admApLoad()'); await tick();
  var list = el('admApList').innerHTML;
  ok('every waiting question is listed', /Which is a strong acid/.test(list) && /Which salt is soluble/.test(list) && /Explain refraction/.test(list));
  ok('the tutor, subject, topic and time are shown', /Ada/.test(list) && /Chemistry/.test(list) && /Salts/.test(list) && /WHEN\(2026-10-08T09:00:00Z\)/.test(list));
  ok('tutor text is escaped (no markup gets through)', /Ada &lt;u&gt;Obi/.test(list) && /&lt;b&gt;\?/.test(list) && !/<u>Obi|<b>\?/.test(list));
  ok('the correct option is marked, a theory question shows its reference answer and mark', /✓ correct/.test(list) && /Bending of light/.test(list) && /out of 5/.test(list));
  ok('Approve, Edit then approve and Return are offered', /Approve<\/button>/.test(list) && /Edit then approve/.test(list) && />Return</.test(list));
  ok('an import shows ONE batch button with its count', (list.match(/Approve all 2 from this import/g) || []).length === 1);
  ok('the badge shows the count when nothing is filtered', sel.options[1].textContent === 'Awaiting approval (3)', sel.options[1].textContent);
  el('admApSubject').value = 'Physics'; run('admApLoad()'); await tick();
  ok('a subject filter asks the server for just that subject', calls[calls.length - 1][1] === 'Physics' && !/Which salt/.test(el('admApList').innerHTML));
  ok('a filtered view leaves the badge alone', sel.options[1].textContent === 'Awaiting approval (3)');
  el('admApSubject').value = '';

  console.log('\nbadge');
  queue = []; await run('admApBadge()');
  ok('an empty queue clears the badge', sel.options[1].textContent === 'Awaiting approval');
  run('admApLoad()'); await tick();
  ok('an empty queue says so', /Nothing is waiting for approval/.test(el('admApList').innerHTML));

  queue = [
    { id: 11, subject: 'Chemistry', topic: 'Acids', kind: 'objective', section: 'objective', text: 'Which is a strong acid?', options: ['Ethanoic', 'Hydrochloric', 'Citric'], answer: 1, addedByName: 'Ada', addedAt: 'x', batch: 'IMP-A', status: 'pending' },
    { id: 13, subject: 'Physics', topic: 'Waves', kind: 'theory', section: 'theory', text: 'Explain refraction of light.', expected: 'Bending of light.', maxMark: 5, addedByName: 'Mr Eze', addedAt: 'y', status: 'pending' }
  ];
  run('admApLoad()'); await tick();

  console.log('\napprove');
  calls.length = 0; run("admApApprove('11')"); await tick();
  ok('Approve sends the id with no edit', calls[0][0] === 'approve' && calls[0][1] === 11 && calls[0][2] === undefined, JSON.stringify(calls));
  ok('it says students can now see it and reloads the queue', /Students can now see it/.test(toasts[toasts.length - 1]) && calls.some(function (c) { return c[0] === 'list'; }));

  console.log('\nedit then approve');
  run("admApSetMode('11','edit')");
  var f = el('admApList').innerHTML;
  ok('Edit opens a form filled with the question, options and answer', /admApE_text_11/.test(f) && /Which is a strong acid\?/.test(f) && /Ethanoic\nHydrochloric\nCitric/.test(f) && /value="2"/.test(f));
  el('admApE_text_11').value = 'Which of these is a strong acid in water?';
  el('admApE_topic_11').value = 'Strength';
  el('admApE_opts_11').value = 'Ethanoic\n\n Hydrochloric \nCitric\n';
  el('admApE_ans_11').value = '2';
  el('admApE_expl_11').value = 'It ionises fully.';
  calls.length = 0; run("admApSaveApprove('11')"); await tick();
  var e = calls[0] && calls[0][2];
  ok('Save and approve sends the changes with blank lines dropped and the answer as a position', calls[0][0] === 'approve' && e.text === 'Which of these is a strong acid in water?' && e.options.join('|') === 'Ethanoic|Hydrochloric|Citric' && e.answer === 1 && e.topic === 'Strength' && e.explanation === 'It ionises fully.', JSON.stringify(calls[0]));
  ok('a theory question edits the reference answer and mark instead of options', (function () {
    run("admApSetMode('13','edit')"); var h = el('admApList').innerHTML;
    el('admApE_expected_13').value = 'Light bends as its speed changes.'; el('admApE_max_13').value = '6';
    el('admApE_text_13').value = 'Explain refraction.'; el('admApE_topic_13').value = 'Waves'; el('admApE_expl_13').value = '';
    calls.length = 0; run("admApSaveApprove('13')");
    return /admApE_expected_13/.test(h) && !/admApE_opts_13/.test(h) && calls[0][2].expected === 'Light bends as its speed changes.' && calls[0][2].maxMark === 6 && calls[0][2].options === undefined;
  })());
  await tick();

  console.log('\nreturn');
  run('admApLoad()'); await tick();
  run("admApSetMode('11','return')");
  calls.length = 0; el('admApR_11').value = 'ab'; run("admApReturn('11')"); await tick();
  ok('a reason that is too short is stopped on screen, nothing sent', calls.length === 0 && /at least 3/.test(toasts[toasts.length - 1]), toasts);
  el('admApR_11').value = '  Option B is also correct  '; run("admApReturn('11')"); await tick();
  ok('a good reason is sent trimmed', calls[0][0] === 'return' && calls[0][1] === 11 && calls[0][2] === 'Option B is also correct', JSON.stringify(calls[0]));
  ok('the admin is told it went back to the tutor', /Returned to the tutor/.test(toasts[toasts.length - 1]));

  console.log('\napprove a whole import');
  run('admApLoad()'); await tick();
  answer = false; calls.length = 0; run("admApBatch('IMP-A', 2)"); await tick();
  ok('declining the confirm sends nothing', calls.length === 0 && /Approve all 2 questions/.test(confirms[0]));
  answer = true; run("admApBatch('IMP-A', 2)"); await tick();
  ok('confirming sends the batch id and reports the count', calls[0][0] === 'batch' && calls[0][1] === 'IMP-A' && /Approved 2 questions/.test(toasts[toasts.length - 1]), JSON.stringify(calls[0]) + toasts[toasts.length - 1]);

  console.log('\nthe server says no');
  fail = 'Nobody can approve their own question.'; run('admApLoad()'); await tick();
  run("admApApprove('11')"); await tick();
  ok('the server\'s own words are shown', toasts[toasts.length - 1] === 'Nobody can approve their own question.');
  fail = null;
  run("admApApprove('11')"); await tick();
  ok('a refusal does not leave the buttons stuck', /Students can now see it/.test(toasts[toasts.length - 1]));

  console.log('\na failed load');
  sandbox.GOC.api.listApprovals = function () { return Promise.reject(new Error('Network down')); };
  run('admApLoad()'); await tick();
  ok('shows the reason on the screen', /Network down/.test(el('admApList').innerHTML));

  console.log('\nthe offline driver');
  var dsb = { console: console, location: { protocol: 'file:', href: 'file:///index.html' }, navigator: { userAgent: 'node' },
    setTimeout: function () { return 0; }, clearTimeout: function () {}, Promise: Promise, JSON: JSON, Math: Math, Date: Date,
    parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN, encodeURIComponent: encodeURIComponent };
  var dctx = vm.createContext(dsb);
  vm.runInContext('window = this; self = this;', dctx);
  ['js/goc-core.js', 'js/api.js'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), dctx, { filename: f }); });
  var mock = vm.runInContext('GOC.api._drivers.mock', dctx);
  function rej(p) { return p.then(function () { return null; }, function (e) { return e.message; }); }
  ok('before the console is unlocked every approval call is refused', (await rej(mock.listApprovals())) !== null);
  await mock.login('GOC-A-001', 'founder2027'); await mock.unlockConsole('2027');
  var lst = await mock.listApprovals();
  ok('offline there is nothing waiting', lst.count === 0 && lst.queue.length === 0);
  ok('approving, or approving an import, needs a server connection', /server connection/.test(await rej(mock.approveQuestion(1))) && /server connection/.test(await rej(mock.approveBatch('IMP-A'))));
  ok('a return without a reason is stopped with the same words as the server', /at least 3/.test(await rej(mock.returnQuestion(1, 'ab'))));
  ok('a return with a reason says it needs a server', /server connection/.test(await rej(mock.returnQuestion(1, 'Option C is wrong'))));

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
