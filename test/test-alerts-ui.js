/* test-alerts-ui.js — Phase 3C slice 6.6: the Alerts card on the console home (tutor marked a script),
   plus the offline driver's behaviour.
   node test/test-alerts-ui.js */
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');
var APP = process.env.GOC_DIR || path.join(__dirname, '..');
var app = fs.readFileSync(path.join(APP, 'js', 'app.js'), 'utf8');
var apiSrc = fs.readFileSync(path.join(APP, 'js', 'api.js'), 'utf8');
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

console.log('\nthe card is on the console home');
ok('the overview panel carries a hidden Alerts card', /id=\\"admAlCard\\" hidden/.test(app.replace(/\\'/g, "'")) || /id="admAlCard" hidden|id=\\"admAlCard\\" hidden/.test(app));
ok('opening the overview loads the alerts as well as the figures', /if\(section === 'overview'\)\{ admOverviewLoad\(\); admAlLoad\(\); \}/.test(app));
ok('the three drivers carry both alert methods', ['listAlerts', 'seenAlert'].every(function (m) { return (apiSrc.split(m + ':').length - 1) >= 3; }));

var calls = [], toasts = [], alerts = [], fail = null, opened = [];
var els = {};
function el(id) { return els[id] || (els[id] = { id: id, value: '', innerHTML: '', textContent: '', hidden: true }); }
var sandbox = {
  GOC: { api: {
    listAlerts: function () { calls.push(['list']); return fail === 'list' ? Promise.reject(new Error('down')) : Promise.resolve({ count: alerts.length, alerts: alerts.slice() }); },
    seenAlert: function (id) { calls.push(['seen', id]); return fail === 'seen' ? Promise.reject(new Error('Could not reach the server.')) : Promise.resolve({ ok: true }); }
  } },
  document: { getElementById: function (id) { return /^admAl(Card|List)$/.test(id) ? el(id) : (id === 'admSelect' ? el('admSelect') : null); } },
  esc: function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); },
  admWhen: function (v) { return 'WHEN(' + v + ')'; },
  admOpen: function (s) { opened.push(['open', s]); },
  admROpen: function (id) { opened.push(['script', id]); },
  toast: function (m) { toasts.push(m); },
  setTimeout: function (fn) { fn(); },
  Promise: Promise, String: String, Number: Number, Array: Array
};
var ctx = vm.createContext(sandbox);
var names = ['admAlLoad', 'admAlRender', 'admAlSeen', 'admAlOpen'];
var code = names.map(grab).join('\n');
ok('all the card functions exist', code.split('function ').length - 1 === names.length);
vm.runInContext('var admAlCache = [], admAlBusy = false;\n' + code, ctx);
function run(src) { return vm.runInContext(src, ctx); }
function tick() { return new Promise(function (r) { setTimeout(r, 5); }); }

(async function () {
  console.log('\nnothing to see');
  run('admAlLoad()'); await tick();
  ok('with no alerts the card stays hidden', el('admAlCard').hidden === true && el('admAlList').innerHTML === '');

  console.log('\nalerts');
  alerts = [
    { id: 'AL-2', kind: 'tutor-mark', tutorId: 'GOC-T-001', tutorName: 'Mrs <b>Ada</b> Obi', subject: 'Chemistry', attemptId: 'A1-7', scholarId: 'GOC-S-001', studentName: 'Gina', score: 17, maxScore: 20, percent: 85, changed: false, at: '2026-10-08T10:00:00Z', seen: false },
    { id: 'AL-1', kind: 'tutor-mark', tutorId: 'GOC-T-002', tutorName: 'Mr Eze', subject: 'Physics', attemptId: 'A1-9', scholarId: 'GOC-S-002', studentName: '', score: 9, maxScore: 20, percent: 45, changed: true, at: '2026-10-08T09:00:00Z', seen: false }
  ];
  run('admAlLoad()'); await tick();
  var h = el('admAlList').innerHTML;
  ok('the card shows and lists both, newest as the server sent them', el('admAlCard').hidden === false && h.indexOf('AL-2') < h.indexOf('AL-1') && /Chemistry script/.test(h) && /Physics script/.test(h));
  ok('each says who marked it, the student, the mark and the time', /GOC-S-001/.test(h) && /Gina/.test(h) && /85%/.test(h) && /17\/20/.test(h) && /WHEN\(2026-10-08T10:00:00Z\)/.test(h));
  ok('a changed mark says so', /Mr Eze changed the mark on a Physics script/.test(h) && /Changed/.test(h) && /Mrs .*marked a Chemistry script/.test(h));
  ok('tutor text is escaped (no markup gets through)', /Mrs &lt;b&gt;Ada&lt;\/b&gt; Obi/.test(h) && !/<b>Ada<\/b>/.test(h));
  ok('each has Open script and Seen', (h.match(/Open script/g) || []).length === 2 && (h.match(/>Seen</g) || []).length === 2);

  console.log('\nSeen');
  calls.length = 0; run("admAlSeen('AL-2')"); await tick();
  ok('Seen calls the server with that alert', calls.length === 1 && calls[0][0] === 'seen' && calls[0][1] === 'AL-2');
  h = el('admAlList').innerHTML;
  ok('it leaves the list at once and the other stays', !/Chemistry script/.test(h) && /Physics script/.test(h));
  run("admAlSeen('AL-1')"); await tick();
  ok('when the last one goes the card hides again', el('admAlCard').hidden === true);
  alerts = [alerts[0]]; run('admAlLoad()'); await tick();
  fail = 'seen'; run("admAlSeen('AL-2')"); await tick();
  ok('a failed Seen keeps the alert and shows the reason', /Chemistry script/.test(el('admAlList').innerHTML) && toasts.indexOf('Could not reach the server.') > -1);
  fail = null;
  ok('and Seen can be tried again', (function () { calls.length = 0; run("admAlSeen('AL-2')"); return calls.length === 1; })());
  await tick();

  console.log('\nOpen script');
  opened.length = 0; run("admAlOpen('A1-7')");
  ok('it opens the marking panel and then that script', opened[0][0] === 'open' && opened[0][1] === 'theorymark' && opened[1][0] === 'script' && opened[1][1] === 'A1-7', JSON.stringify(opened));

  console.log('\nthe server is down');
  fail = 'list'; alerts = []; run('admAlLoad()'); await tick();
  ok('a failed load hides the card instead of showing an error on the home screen', el('admAlCard').hidden === true);
  fail = null;

  console.log('\nthe offline driver');
  var m = apiSrc.match(/listAlerts: function \(\) \{\s*var e = requireUnlocked\(\); if \(e\) return e;\s*return ok\(\{ count: 0, alerts: \[\] \}\);/);
  ok('offline there are never alerts', !!m);
  ok('and marking them seen needs a server', /seenAlert: function \(\) \{\s*var e = requireUnlocked\(\); if \(e\) return e;\s*return fail\('Alerts need a server connection\.'\);/.test(apiSrc));

  console.log(fails ? '\n' + fails + ' check(s) FAILED' : '\nall checks passed');
  process.exit(fails ? 1 : 0);
})();
