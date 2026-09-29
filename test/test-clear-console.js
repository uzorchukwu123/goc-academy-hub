/* test-clear-console.js — the "Clear for resit" screen in the console, driven inside
   minidom against the mock driver: checkboxes, date filters (sent to the data
   layer, not applied in the page), the confirm dialog, the backup warning and the
   archive size warning. A real phone is still needed for touch behaviour.
   Run:  node test/test-clear-console.js  */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var md = require('./minidom.js');

var APP = process.env.GOC_DIR || path.join(__dirname, '..');
function read(f) { return fs.readFileSync(path.join(APP, f), 'utf8'); }

var html = read('index.html')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '');
var doc = new md.Doc();
doc.body.innerHTML = (html.match(/<body[^>]*>([\s\S]*)<\/body>/i) || [null, html])[1];

var confirmLog = [], confirmAnswer = true;
var sandbox = {
  document: doc, console: console,
  location: { protocol: 'file:', href: 'file:///index.html' },
  navigator: { userAgent: 'node' },
  innerWidth: 430, innerHeight: 924,
  matchMedia: function () { return { matches: false, addListener: function () {} }; },
  addEventListener: function () {}, removeEventListener: function () {},
  requestAnimationFrame: function (fn) { return setTimeout(fn, 0); },
  scrollTo: function () {}, alert: function () {}, confirm: function (m) { confirmLog.push(String(m)); return confirmAnswer; },
  setTimeout: function () { return 0; }, clearTimeout: function () {},
  setInterval: function () { return 0; }, clearInterval: function () {},
  Promise: Promise, JSON: JSON, Math: Math, Date: Date,
  parseInt: parseInt, parseFloat: parseFloat, isNaN: isNaN,
  encodeURIComponent: encodeURIComponent
};
var ctx = vm.createContext(sandbox);
vm.runInContext('window = this; self = this;', ctx);
['js/goc-core.js', 'js/api.js', 'js/app.js'].forEach(function (f) {
  try { vm.runInContext(read(f), ctx, { filename: f }); }
  catch (e) { console.log('THREW while loading ' + f + ': ' + e.message); process.exit(1); }
});
/* ---- tiny assertions (same shape as test-study.js) ---- */
var fails = 0, passes = 0;
function ok(name, cond, extra) {
  if (cond) { passes++; console.log('  pass  ' + name); }
  else { fails++; console.log('  FAIL  ' + name + (extra !== undefined ? '   (' + extra + ')' : '')); }
}
function head(t) { console.log('\n' + t); }
function id(x) { return doc.getElementById(x); }
function run(expr) { return vm.runInContext(expr, ctx); }
function text(x) { var e = id(x); return e ? e.textContent : '<missing ' + x + '>'; }
function flush() {
  return new Promise(function (done) {
    var n = 0;
    (function again() { if (++n > 12) return done(); setImmediate(again); })();
  });
}
function api(name) { return run('GOC.api.' + name); }
function shown(x) { var e = id(x); return !!e && e.classList.contains('show'); }
function screenNow() {
  var out = '';
  doc.querySelectorAll('.screen').forEach(function (s) {
    if (s.classList.contains('active')) out = s.getAttribute('id') || out;
  });
  return out;
}

var FOUNDER = 'GOC-A-001', FPW = 'founder2027', PASS = '2027';
function markup(x) { var e = id(x); return e ? e.innerHTML : ''; }
function count(x, sel) { var e = id(x); return e ? e.querySelectorAll(sel).length : -1; }
function set(x, v) { var e = id(x); if (e) e.value = v; return !!e; }
function spyOn(name, wrap) {
  var real = run('GOC.api.' + name);
  var calls = [];
  run('(function (f) { GOC.api.' + name + ' = f; })')(function () {
    calls.push([].slice.call(arguments));
    return wrap ? wrap(real, [].slice.call(arguments)) : real.apply(null, arguments);
  });
  return { calls: calls, restore: function () { run('(function (f) { GOC.api.' + name + ' = f; })')(real); } };
}

async function main() {
  head('set-up: a published question, one student who sat an objective paper');
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);
  await api('createQuestion')({ subject: 'Physics', section: 'objective', topic: 'Waves',
    text: 'A wave with a longer wavelength has a — frequency, at the same speed.',
    options: ['higher', 'lower', 'the same', 'undefined'], answer: 1 });
  await api('logout')();
  var reg = await api('createStudent')({ signupCode: 'GOC-2027', name: 'Ada Clear', password: 'chukwu#19',
    goal: 'JAMB / UTME', subjects: ['Use of English', 'Physics', 'Chemistry', 'Mathematics'] });
  var sid = reg.student.id;
  await api('login')(sid, 'chukwu#19');
  var paper = await api('startTest')({ period: 'weekly', section: 'objective', subject: 'Physics' });
  var resp = {}; paper.questions.forEach(function (q) { resp[q.id] = 0; });
  await api('submitTest')({ attemptId: paper.attemptId, responses: resp, timeUsedSec: 90 });
  await api('logout')();
  await api('login')(FOUNDER, FPW);
  await api('unlockConsole')(PASS);

  head('the screen: a checkbox on each row, date pickers, a disabled clear button');
  run('admOpen')('results');
  await flush();
  var rows = doc.querySelectorAll('#admRList .ad-resrow');
  ok('the sitting is listed', rows.length === 1, rows.length);
  ok('every row has a tick box', doc.querySelectorAll('#admRList input.ad-chk').length === rows.length);
  ok('there is a "Sat from" date picker', !!id('admRFrom') && id('admRFrom').type === 'date');
  ok('and a "Sat to" date picker', !!id('admRTo') && id('admRTo').type === 'date');
  ok('the clear button starts disabled and shows zero', id('admRClearBtn').disabled === true && /\(0\)/.test(id('admRClearBtn').textContent), id('admRClearBtn').textContent);

  head('ticking a row enables the button and keeps the tick across a repaint');
  var attemptId = run('admRCache')[0].id;
  run('admRToggle')(attemptId, true);
  ok('the button now counts one', /\(1\)/.test(id('admRClearBtn').textContent) && id('admRClearBtn').disabled === false, id('admRClearBtn').textContent);
  run('admRRender')();
  var box = doc.querySelectorAll('#admRList input.ad-chk')[0];
  ok('after a repaint the box is still ticked', box.checked === true, box.checked);
  run('admRToggle')(attemptId, false);
  run('admRRender')();
  ok('and un-ticking sticks too', doc.querySelectorAll('#admRList input.ad-chk')[0].checked === false);
  run('admRToggle')(attemptId, true);
  run('admRSelectNone')();
  ok('"select none" clears the ticks and the count', /\(0\)/.test(id('admRClearBtn').textContent));

  head('the date range is sent to the data layer, not filtered in the page');
  var spy = spyOn('listResults');
  set('admRFrom', '2000-01-01'); set('admRTo', '2100-12-31');
  run('admRSetFilter')();
  await flush();
  var sent = spy.calls[spy.calls.length - 1][0] || {};
  ok('the request carries "from" as a number', typeof sent.from === 'number', JSON.stringify(sent));
  ok('and "to" as a number', typeof sent.to === 'number' && sent.to > sent.from, JSON.stringify(sent));
  ok('"to" is the END of the last chosen day', new Date(sent.to).getHours() === 23 && new Date(sent.to).getMinutes() === 59, new Date(sent.to).toString());
  ok('a range around today still shows the sitting', count('admRList', '.ad-resrow') === 1);
  set('admRFrom', '2999-01-01'); set('admRTo', '');
  run('admRSetFilter')();
  await flush();
  var sent2 = spy.calls[spy.calls.length - 1][0] || {};
  ok('a "from" date is sent without a "to"', typeof sent2.from === 'number' && sent2.to === undefined, JSON.stringify(sent2));
  ok('a range in the far future shows the empty message', /No sittings match/.test(markup('admRList')), markup('admRList').slice(0, 120));
  set('admRFrom', ''); set('admRTo', '');
  run('admRSetFilter')();
  await flush();
  spy.restore();
  ok('clearing the dates brings the sitting back', count('admRList', '.ad-resrow') === 1);

  head('the confirm dialog: cancelling changes nothing');
  var clearSpy = spyOn('clearAttempts');
  run('admRToggle')(attemptId, true);
  confirmAnswer = false; confirmLog.length = 0;
  run('admRClearSelected')();
  await flush();
  ok('a dialog was shown', confirmLog.length === 1, confirmLog.length);
  ok('it names the student and says answers are not kept', confirmLog[0].indexOf(sid) > -1 && /answers are not/.test(confirmLog[0]), confirmLog[0]);
  ok('it says how much XP comes back', /XP will be taken back/.test(confirmLog[0]));
  ok('only the preview reached the data layer (dryRun), never a real clear',
     clearSpy.calls.length === 1 && clearSpy.calls[0][0].dryRun === true && !clearSpy.calls[0][0].confirm, JSON.stringify(clearSpy.calls.map(function (c) { return c[0]; })));
  ok('the screen says nothing was cleared', /Cancelled/.test(text('admRClearStatus')), text('admRClearStatus'));
  ok('the sitting is still on the record', count('admRList', '.ad-resrow') >= 1 && run('admRCache').length === 1);
  clearSpy.restore();

  head('confirming clears it — and a failed backup upload is flagged on screen');
  var spy2 = spyOn('clearAttempts', function (real, args) {
    return real.apply(null, args).then(function (r) { if (args[0].confirm) r.archiveBackup = 'failed'; return r; });
  });
  confirmAnswer = true; confirmLog.length = 0;
  run('admRSelectShown')();
  run('admRClearSelected')();
  await flush();
  ok('the real clear was sent after the preview', spy2.calls.length === 2 && spy2.calls[1][0].confirm === true, spy2.calls.length);
  ok('the status reports what was cleared', /Cleared 1 attempt/.test(text('admRClearStatus')), text('admRClearStatus'));
  ok('and warns that the backup copy could not be uploaded', /WARNING/.test(text('admRClearStatus')) && /backup/.test(text('admRClearStatus')), text('admRClearStatus'));
  ok('the list is refreshed and the sitting is gone', /No sittings match/.test(markup('admRList')) || count('admRList', '.ad-resrow') === 0);
  spy2.restore();

  head('the archive list warns when it is getting large');
  var spy3 = spyOn('listClearedAttempts', function (real, args) {
    return real.apply(null, args).then(function (r) { r.archive = { count: 900, bytes: 2500000, warn: true }; return r; });
  });
  run('admRLoadCleared')();
  await flush();
  ok('the cleared list shows the size warning', /getting large/.test(markup('admRCleared')) && /900 entries/.test(markup('admRCleared')), markup('admRCleared').slice(0, 200));
  ok('the entry itself is listed with a Restore button', /Restore/.test(markup('admRCleared')));
  spy3.restore();

  console.log('\n' + passes + ' passed, ' + fails + ' failed');
  process.exit(fails ? 1 : 0);
}
main().catch(function (e) { console.log('\nTEST RUN FAILED: ' + (e && e.stack || e)); process.exit(1); });
